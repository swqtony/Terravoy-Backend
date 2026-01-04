package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/messaging"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"google.golang.org/api/option"
)

type Config struct {
	DBDsn              string
	RedisURL           string
	RetentionMatchDays int
	RetentionOrderDays int
	PushMaxRetries     int
	PushBackoffMs      int
	FCMServiceJSON     string
	FCMServicePath     string
}

const (
	streamKey = "im:push:stream"
	dlqKey    = "im:push:dlq"
	groupName = "im-push-workers"
)

func main() {
	cfg := loadConfig()
	setupLogger()

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DBDsn)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	redisClient := newRedisClient(cfg.RedisURL)

	pushClient := initFCM(ctx, cfg)

	if redisClient != nil {
		ensureStreamGroup(ctx, redisClient)
		go consumePush(ctx, redisClient, pool, pushClient, cfg)
	}
	go retentionLoop(ctx, pool, cfg)

	log.Info().Msg("im-worker started")
	select {}
}

func setupLogger() {
	zerolog.TimeFieldFormat = time.RFC3339
	if strings.ToLower(os.Getenv("NODE_ENV")) == "production" {
		return
	}
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stdout, TimeFormat: time.RFC3339})
}

func loadConfig() Config {
	return Config{
		DBDsn:              env("IM_DB_DSN", ""),
		RedisURL:           env("IM_REDIS_URL", ""),
		RetentionMatchDays: envInt("IM_RETENTION_MATCH_DAYS", 14),
		RetentionOrderDays: envInt("IM_RETENTION_ORDER_DAYS", 180),
		PushMaxRetries:     envInt("PUSH_MAX_RETRIES", 5),
		PushBackoffMs:      envInt("PUSH_RETRY_BACKOFF_MS", 1000),
		FCMServiceJSON:     env("FCM_SERVICE_ACCOUNT_JSON", ""),
		FCMServicePath:     env("FCM_SERVICE_ACCOUNT_PATH", ""),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func newRedisClient(url string) *redis.Client {
	if url == "" {
		return nil
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return redis.NewClient(&redis.Options{Addr: url})
	}
	return redis.NewClient(opt)
}

func initFCM(ctx context.Context, cfg Config) *messaging.Client {
	if cfg.FCMServiceJSON == "" && cfg.FCMServicePath == "" {
		log.Warn().Msg("FCM disabled: missing service account")
		return nil
	}
	opts := []option.ClientOption{}
	if cfg.FCMServiceJSON != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(cfg.FCMServiceJSON)))
	} else {
		opts = append(opts, option.WithCredentialsFile(cfg.FCMServicePath))
	}
	app, err := firebase.NewApp(ctx, nil, opts...)
	if err != nil {
		log.Error().Err(err).Msg("FCM init failed")
		return nil
	}
	client, err := app.Messaging(ctx)
	if err != nil {
		log.Error().Err(err).Msg("FCM messaging init failed")
		return nil
	}
	return client
}

func ensureStreamGroup(ctx context.Context, client *redis.Client) {
	_, err := client.XGroupCreateMkStream(ctx, streamKey, groupName, "0").Result()
	if err != nil && !strings.Contains(err.Error(), "BUSYGROUP") {
		log.Error().Err(err).Msg("stream group init failed")
	}
}

func consumePush(ctx context.Context, rdb *redis.Client, pool *pgxpool.Pool, fcm *messaging.Client, cfg Config) {
	consumer := fmt.Sprintf("worker-%d", time.Now().UnixNano())
	for {
		streams, err := rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    groupName,
			Consumer: consumer,
			Streams:  []string{streamKey, ">"},
			Count:    10,
			Block:    5 * time.Second,
		}).Result()
		if err != nil && !errorsIsRedisNil(err) {
			log.Error().Err(err).Msg("stream read failed")
			continue
		}
		for _, stream := range streams {
			for _, msg := range stream.Messages {
				if err := handlePushMessage(ctx, rdb, pool, fcm, cfg, msg); err != nil {
					log.Error().Err(err).Msg("push handling failed")
				}
			}
		}
	}
}

func handlePushMessage(ctx context.Context, rdb *redis.Client, pool *pgxpool.Pool, fcm *messaging.Client, cfg Config, msg redis.XMessage) error {
	payload := map[string]string{}
	for k, v := range msg.Values {
		payload[k] = fmt.Sprintf("%v", v)
	}
	availableAt, _ := strconv.ParseInt(payload["available_at_ms"], 10, 64)
	if availableAt > 0 && time.Now().UnixMilli() < availableAt {
		_ = rdb.XAck(ctx, streamKey, groupName, msg.ID).Err()
		_, _ = rdb.XAdd(ctx, &redis.XAddArgs{Stream: streamKey, Values: payload}).Result()
		return nil
	}
	toUserID := payload["to_user_id"]
	msgID := payload["msg_id"]
	threadID := payload["thread_id"]
	seq := payload["seq"]
	attempt, _ := strconv.Atoi(payload["attempt"])
	dedupKey := fmt.Sprintf("im:push:sent:%s:%s", msgID, toUserID)
	if exists, _ := rdb.Get(ctx, dedupKey).Result(); exists != "" {
		_ = rdb.XAck(ctx, streamKey, groupName, msg.ID).Err()
		return nil
	}
	tokens, err := fetchDeviceTokens(ctx, pool, toUserID)
	if err != nil {
		return err
	}
	if len(tokens) == 0 {
		_ = rdb.XAck(ctx, streamKey, groupName, msg.ID).Err()
		return nil
	}
	if fcm == nil {
		log.Warn().Str("user_id", toUserID).Msg("FCM not configured")
		return retryOrDLQ(ctx, rdb, msg, payload, attempt, cfg.PushMaxRetries, cfg.PushBackoffMs, "fcm_not_configured")
	}
	resp, err := fcm.SendMulticast(ctx, &messaging.MulticastMessage{
		Tokens: tokens,
		Data: map[string]string{
			"thread_id": threadID,
			"seq":       seq,
			"msg_id":    msgID,
		},
	})
	if err == nil && resp.FailureCount == 0 {
		_ = rdb.Set(ctx, dedupKey, "1", 7*24*time.Hour).Err()
		_ = rdb.XAck(ctx, streamKey, groupName, msg.ID).Err()
		return nil
	}
	return retryOrDLQ(ctx, rdb, msg, payload, attempt, cfg.PushMaxRetries, cfg.PushBackoffMs, "push_failed")
}

func fetchDeviceTokens(ctx context.Context, pool *pgxpool.Pool, userID string) ([]string, error) {
	rows, err := pool.Query(ctx, `
		select token
		from device_tokens
		where user_id = $1 and platform = 'android'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, nil
}

func retryOrDLQ(ctx context.Context, rdb *redis.Client, msg redis.XMessage, payload map[string]string, attempt int, maxRetries int, backoffBase int, errCode string) error {
	if attempt+1 >= maxRetries {
		payload["error"] = errCode
		payload["failed_at_ms"] = fmt.Sprintf("%d", time.Now().UnixMilli())
		_, _ = rdb.XAdd(ctx, &redis.XAddArgs{Stream: dlqKey, Values: payload}).Result()
		_ = rdb.XAck(ctx, streamKey, groupName, msg.ID).Err()
		return nil
	}
	_ = rdb.XAck(ctx, streamKey, groupName, msg.ID).Err()
	payload["attempt"] = strconv.Itoa(attempt + 1)
	payload["available_at_ms"] = fmt.Sprintf("%d", time.Now().UnixMilli()+backoffMs(backoffBase, attempt+1))
	_, _ = rdb.XAdd(ctx, &redis.XAddArgs{Stream: streamKey, Values: payload}).Result()
	return nil
}

func backoffMs(base int, attempt int) int64 {
	ms := int64(base) * int64(1<<attempt)
	if ms > 60000 {
		return 60000
	}
	return ms
}

func retentionLoop(ctx context.Context, pool *pgxpool.Pool, cfg Config) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	runRetention(ctx, pool, cfg)
	for range ticker.C {
		runRetention(ctx, pool, cfg)
	}
}

func runRetention(ctx context.Context, pool *pgxpool.Pool, cfg Config) {
	matchCutoff := time.Now().AddDate(0, 0, -cfg.RetentionMatchDays)
	orderCutoff := time.Now().AddDate(0, 0, -cfg.RetentionOrderDays)
	_, err := pool.Exec(ctx, `
		delete from chat_messages
		where thread_id in (
			select id from chat_threads where type = 'match'
		) and created_at < $1`, matchCutoff)
	if err != nil {
		log.Error().Err(err).Msg("match retention delete failed")
	}
	_, err = pool.Exec(ctx, `
		delete from chat_messages
		where thread_id in (
			select id from chat_threads where type = 'order'
		) and created_at < $1`, orderCutoff)
	if err != nil {
		log.Error().Err(err).Msg("order retention delete failed")
	}
}

func errorsIsRedisNil(err error) bool {
	return err == redis.Nil
}
