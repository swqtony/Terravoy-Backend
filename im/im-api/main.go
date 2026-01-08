package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"terravoy/im/im-api/internal/redisx"
)

type Config struct {
	Addr                 string
	DBDsn                string
	RedisURL             string
	AuthJWTSecret        string
	RetentionMatchDays   int
	RetentionOrderDays   int
	PresenceTTLSeconds   int
	PresenceRefreshSec   int
	RateUserMax          int
	RateUserWindowMs     int
	RateThreadMax        int
	RateThreadWindowMs   int
	EnvName              string
	OSSEndpoint          string
	OSSBucketIM          string
	OSSAccessKeyID       string
	OSSAccessKeySecret   string
	OSSIMPublicBaseURL   string
	OSSUploadExpiresSecs   int
	OSSIMUploadExpiresSecs int
	OSSIMRetentionDays     int  // IM 消息媒体文件保留天数，0=不自动配置生命周期
}

type ctxKey string

const (
	ctxUserID  ctxKey = "user_id"
	ctxTraceID ctxKey = "trace_id"
)

var (
	httpDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "im_api_http_duration_ms",
			Help:    "IM API HTTP duration in ms",
			Buckets: []float64{5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000},
		},
		[]string{"method", "route", "status"},
	)
	dbWriteLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "db_write_latency_ms",
		Help:    "IM API DB write latency in ms",
		Buckets: []float64{5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000},
	})
	messagesWrittenTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "messages_written_total",
		Help: "Total messages written by IM API",
	})
)

func main() {
	cfg := loadConfig()
	setupLogger()

	prometheus.MustRegister(httpDuration)
	prometheus.MustRegister(dbWriteLatency, messagesWrittenTotal)

	pool, err := pgxpool.New(context.Background(), cfg.DBDsn)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	redisClient := newRedisClient(cfg.RedisURL)

	// 自动配置 OSS IM Bucket 生命周期规则
	setupOSSLifecycle(cfg)

	router := chi.NewRouter()
	router.Use(traceMiddleware)
	router.Use(accessLogMiddleware)
	router.Use(metricsMiddleware)
	router.Get("/metrics", promhttp.Handler().ServeHTTP)
	router.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, http.StatusOK, map[string]any{"ok": true})
	})

	router.Route("/v1", func(r chi.Router) {
		r.With(authMiddleware(cfg.AuthJWTSecret)).Get("/threads", func(w http.ResponseWriter, r *http.Request) {
			handleListThreads(w, r, pool)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Post("/threads/ensure", func(w http.ResponseWriter, r *http.Request) {
			handleEnsureThread(w, r, pool)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Post("/threads/{id}/read", func(w http.ResponseWriter, r *http.Request) {
			handleReadThread(w, r, pool)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Get("/threads/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
			handleListMessages(w, r, pool, cfg)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Post("/messages", func(w http.ResponseWriter, r *http.Request) {
			handleCreateMessage(w, r, pool, redisClient, cfg)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Get("/threads/{id}/permission", func(w http.ResponseWriter, r *http.Request) {
			handlePermission(w, r, pool)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Get("/threads/{id}/members", func(w http.ResponseWriter, r *http.Request) {
			handleThreadMembers(w, r, pool)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Post("/push/token", func(w http.ResponseWriter, r *http.Request) {
			handlePushToken(w, r, pool)
		})
		r.With(authMiddleware(cfg.AuthJWTSecret)).Post("/media/upload-url", func(w http.ResponseWriter, r *http.Request) {
			handleMediaUpload(w, r, cfg)
		})
	})

	server := &http.Server{
		Addr:         cfg.Addr,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	log.Info().Str("addr", cfg.Addr).Msg("im-api listening")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal().Err(err).Msg("server failed")
	}
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
		Addr:                 env("IM_API_ADDR", ":8090"),
		DBDsn:                env("IM_DB_DSN", ""),
		RedisURL:             env("IM_REDIS_URL", ""),
		AuthJWTSecret:        env("AUTH_JWT_SECRET", ""),
		RetentionMatchDays:   envInt("IM_RETENTION_MATCH_DAYS", 14),
		RetentionOrderDays:   envInt("IM_RETENTION_ORDER_DAYS", 180),
		PresenceTTLSeconds:   envInt("IM_PRESENCE_TTL_SECONDS", 75),
		PresenceRefreshSec:   envInt("IM_PRESENCE_REFRESH_SECONDS", 30),
		RateUserMax:          envInt("IM_RATE_USER_MAX", 20),
		RateUserWindowMs:     envInt("IM_RATE_USER_WINDOW_MS", 10000),
		RateThreadMax:        envInt("IM_RATE_THREAD_MAX", 30),
		RateThreadWindowMs:   envInt("IM_RATE_THREAD_WINDOW_MS", 10000),
		EnvName:              env("NODE_ENV", "dev"),
		OSSEndpoint:          env("OSS_ENDPOINT", ""),
		OSSBucketIM:          env("OSS_BUCKET_IM", ""),
		OSSAccessKeyID:       env("OSS_ACCESS_KEY_ID", ""),
		OSSAccessKeySecret:   env("OSS_ACCESS_KEY_SECRET", ""),
		OSSIMPublicBaseURL:   env("OSS_IM_PUBLIC_BASE_URL", ""),
		OSSUploadExpiresSecs:   envInt("OSS_UPLOAD_EXPIRES_SECONDS", 900),
		OSSIMUploadExpiresSecs: envInt("OSS_IM_UPLOAD_EXPIRES_SECONDS", envInt("OSS_UPLOAD_EXPIRES_SECONDS", 900)),
		OSSIMRetentionDays:     envInt("OSS_IM_RETENTION_DAYS", 90), // 默认90天
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

// setupOSSLifecycle 自动配置 OSS IM Bucket 的生命周期规则
// 根据 OSSIMRetentionDays 设置消息媒体文件的过期删除规则
func setupOSSLifecycle(cfg Config) {
	if cfg.OSSIMRetentionDays <= 0 {
		log.Info().Msg("OSS lifecycle disabled (OSS_IM_RETENTION_DAYS <= 0)")
		return
	}
	if cfg.OSSEndpoint == "" || cfg.OSSBucketIM == "" || cfg.OSSAccessKeyID == "" || cfg.OSSAccessKeySecret == "" {
		log.Warn().Msg("OSS lifecycle skipped: missing OSS configuration")
		return
	}

	client, err := oss.New(cfg.OSSEndpoint, cfg.OSSAccessKeyID, cfg.OSSAccessKeySecret)
	if err != nil {
		log.Error().Err(err).Msg("OSS lifecycle: failed to create client")
		return
	}

	// 定义生命周期规则：im/ 前缀下的文件在 N 天后过期删除
	ruleID := "im-message-media-expire"
	rules := []oss.LifecycleRule{
		{
			ID:     ruleID,
			Prefix: "im/",
			Status: "Enabled",
			Expiration: &oss.LifecycleExpiration{
				Days: cfg.OSSIMRetentionDays,
			},
		},
	}

	// SetBucketLifecycle 是 Client 的方法，不是 Bucket 的方法
	err = client.SetBucketLifecycle(cfg.OSSBucketIM, rules)
	if err != nil {
		log.Error().Err(err).Int("days", cfg.OSSIMRetentionDays).Msg("OSS lifecycle: failed to set rule")
		return
	}

	log.Info().
		Str("bucket", cfg.OSSBucketIM).
		Str("prefix", "im/").
		Int("expire_days", cfg.OSSIMRetentionDays).
		Msg("OSS lifecycle rule configured successfully")
}


func traceMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trace := r.Header.Get("X-Trace-Id")
		if trace == "" {
			trace = randomID("trace")
		}
		ctx := context.WithValue(r.Context(), ctxTraceID, trace)
		w.Header().Set("X-Trace-Id", trace)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func accessLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &wrapWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		trace := ctxValue(r, ctxTraceID)
		log.Info().
			Str("trace_id", trace).
			Str("method", r.Method).
			Str("path", r.URL.Path).
			Int("status", wrapped.status).
			Int64("latency_ms", time.Since(start).Milliseconds()).
			Msg("im-api access")
	})
}

func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &wrapWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(ww, r)
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = r.URL.Path
		}
		httpDuration.WithLabelValues(r.Method, route, strconv.Itoa(ww.status)).
			Observe(float64(time.Since(start).Milliseconds()))
	})
}

type wrapWriter struct {
	http.ResponseWriter
	status int
}

func (w *wrapWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func authMiddleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			parts := strings.Split(auth, " ")
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				writeError(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "missing bearer token")
				return
			}
			sub, err := verifyJWT(parts[1], secret)
			if err != nil {
				writeError(w, r, http.StatusUnauthorized, "AUTH_INVALID", "invalid token")
				return
			}
			ctx := context.WithValue(r.Context(), ctxUserID, sub)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func verifyJWT(tokenString, secret string) (string, error) {
	if secret == "" {
		return "", errors.New("missing secret")
	}
	parsed, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected alg")
		}
		return []byte(secret), nil
	})
	if err != nil || !parsed.Valid {
		return "", errors.New("invalid token")
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid claims")
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", errors.New("missing sub")
	}
	return sub, nil
}

func handleEnsureThread(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool) {
	type member struct {
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	var payload struct {
		Type           string   `json:"type"`
		MatchSessionID string   `json:"match_session_id"`
		OrderID        string   `json:"order_id"`
		Members        []member `json:"members"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid json")
		return
	}
	if payload.Type != "match" && payload.Type != "order" {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid type")
		return
	}
	if payload.Type == "match" && payload.MatchSessionID == "" {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "match_session_id required")
		return
	}
	if payload.Type == "order" && payload.OrderID == "" {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "order_id required")
		return
	}
	if len(payload.Members) < 2 {
		writeError(w, r, http.StatusBadRequest, "INVALID_MEMBERS", "members required")
		return
	}
	userID := ctxValue(r, ctxUserID)
	found := false
	for _, m := range payload.Members {
		if m.UserID == userID {
			found = true
			break
		}
	}
	if !found {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}

	ctx := r.Context()
	tx, err := pool.Begin(ctx)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	defer tx.Rollback(ctx)

	var row struct {
		ID             string
		Type           string
		Status         string
		MatchSessionID *string
		OrderID        *string
		LastSeq        int64
		LastMessageAt  *time.Time
	}
	retentionDays := 14
	if payload.Type == "order" {
		retentionDays = 180
	}
	if payload.Type == "match" {
		err = tx.QueryRow(ctx, `
			insert into chat_threads (type, match_session_id, retention_days, sync_policy)
			values ($1, $2, $3, 'local_first')
			on conflict (match_session_id)
			do update set updated_at = now()
			returning id, type, status, match_session_id, order_id, last_seq, last_message_at`,
			payload.Type, payload.MatchSessionID, retentionDays,
		).Scan(&row.ID, &row.Type, &row.Status, &row.MatchSessionID, &row.OrderID, &row.LastSeq, &row.LastMessageAt)
	} else if payload.Type == "order" {
		err = tx.QueryRow(ctx, `
			insert into chat_threads (type, order_id, retention_days, sync_policy)
			values ($1, $2, $3, 'local_first')
			on conflict (order_id)
			do update set updated_at = now()
			returning id, type, status, match_session_id, order_id, last_seq, last_message_at`,
			payload.Type, payload.OrderID, retentionDays,
		).Scan(&row.ID, &row.Type, &row.Status, &row.MatchSessionID, &row.OrderID, &row.LastSeq, &row.LastMessageAt)
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	for _, m := range payload.Members {
		if m.UserID == "" || (m.Role != "traveler" && m.Role != "host") {
			writeError(w, r, http.StatusBadRequest, "INVALID_MEMBERS", "invalid member")
			return
		}
		_, err = tx.Exec(ctx, `
			insert into chat_thread_members (thread_id, user_id, role)
			values ($1, $2, $3)
			on conflict do nothing`,
			row.ID, m.UserID, m.Role,
		)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{
		"thread_id":       row.ID,
		"type":            row.Type,
		"status":          row.Status,
		"match_session_id": row.MatchSessionID,
		"order_id":        row.OrderID,
		"last_seq":        row.LastSeq,
		"last_message_at": row.LastMessageAt,
	})
}

func handleListThreads(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool) {
	userID := ctxValue(r, ctxUserID)
	limit := clampInt(queryInt(r, "limit", 50), 1, 200)
	offset := clampInt(queryInt(r, "offset", 0), 0, 10000)
	rows, err := pool.Query(r.Context(), `
		with last_messages as (
			select distinct on (thread_id) thread_id, id, type, content, created_at, seq
			from chat_messages
			order by thread_id, seq desc
		)
		select t.id, t.type, t.status, t.match_session_id, t.order_id,
		       t.last_seq, t.last_message_at, m.last_read_seq,
		       greatest(t.last_seq - m.last_read_seq, 0) as unread_count,
		       lm.type as last_type, lm.content as last_content, lm.created_at as last_created_at, lm.seq as last_seq_msg
		from chat_thread_members m
		join chat_threads t on t.id = m.thread_id
		left join last_messages lm on lm.thread_id = t.id
		where m.user_id = $1
		order by coalesce(t.last_message_at, t.updated_at) desc
		limit $2 offset $3`,
		userID, limit, offset,
	)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	defer rows.Close()
	threads := []map[string]any{}
	for rows.Next() {
		var (
			id, ttype, status string
			matchID, orderID  *string
			lastSeq           int64
			lastAt            *time.Time
			lastRead          int64
			unread            int64
			lastType          *string
			lastContent       []byte
			lastCreated       *time.Time
			lastSeqMsg        *int64
		)
		if err := rows.Scan(&id, &ttype, &status, &matchID, &orderID, &lastSeq, &lastAt, &lastRead, &unread, &lastType, &lastContent, &lastCreated, &lastSeqMsg); err != nil {
			writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
			return
		}
		var preview any = nil
		if lastType != nil {
			preview = map[string]any{
				"type":      *lastType,
				"content":   json.RawMessage(lastContent),
				"created_at": lastCreated,
				"seq":       lastSeqMsg,
			}
		}
		threads = append(threads, map[string]any{
			"id":               id,
			"type":             ttype,
			"status":           status,
			"match_session_id": matchID,
			"order_id":         orderID,
			"last_seq":         lastSeq,
			"last_message_at":  lastAt,
			"last_read_seq":    lastRead,
			"unread_count":     unread,
			"last_message_preview": preview,
		})
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"threads": threads})
}

func handleReadThread(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool) {
	userID := ctxValue(r, ctxUserID)
	threadID := chi.URLParam(r, "id")
	var payload struct {
		LastReadSeq int64 `json:"last_read_seq"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.LastReadSeq < 0 {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "last_read_seq required")
		return
	}
	tag, err := pool.Exec(r.Context(), `
		update chat_thread_members
		set last_read_seq = greatest(last_read_seq, $1)
		where thread_id = $2 and user_id = $3`,
		payload.LastReadSeq, threadID, userID,
	)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"last_read_seq": payload.LastReadSeq})
}

func handleListMessages(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, cfg Config) {
	userID := ctxValue(r, ctxUserID)
	threadID := chi.URLParam(r, "id")
	var ttype string
	var lastSeq int64
	var retentionDays int
	err := pool.QueryRow(r.Context(), `
		select t.type, t.last_seq, t.retention_days
		from chat_threads t
		join chat_thread_members m on m.thread_id = t.id
		where t.id = $1 and m.user_id = $2`,
		threadID, userID,
	).Scan(&ttype, &lastSeq, &retentionDays)
	if err != nil {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}
	afterSeq := queryInt64(r, "afterSeq")
	beforeSeq := queryInt64(r, "beforeSeq")
	limit := clampInt(queryInt(r, "limit", 50), 1, 200)
	if retentionDays <= 0 {
		retentionDays = cfg.RetentionOrderDays
		if ttype == "match" {
			retentionDays = cfg.RetentionMatchDays
		}
	}
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	conds := []string{"thread_id = $1", "created_at >= $2"}
	args := []any{threadID, cutoff}
	if afterSeq != nil {
		args = append(args, *afterSeq)
		conds = append(conds, fmt.Sprintf("seq > $%d", len(args)))
	}
	if beforeSeq != nil {
		args = append(args, *beforeSeq)
		conds = append(conds, fmt.Sprintf("seq < $%d", len(args)))
	}
	args = append(args, limit)
	query := fmt.Sprintf(`
		select id, thread_id, sender_id, client_msg_id, seq, type, content, created_at
		from chat_messages
		where %s
		order by seq desc
		limit $%d`, strings.Join(conds, " and "), len(args))
	rows, err := pool.Query(r.Context(), query, args...)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	defer rows.Close()
	type msg struct {
		ID          string          `json:"id"`
		ThreadID    string          `json:"thread_id"`
		SenderID    string          `json:"sender_id"`
		ClientMsgID string          `json:"client_msg_id"`
		Seq         int64           `json:"seq"`
		Type        string          `json:"type"`
		Content     json.RawMessage `json:"content"`
		CreatedAt   time.Time       `json:"created_at"`
	}
	messages := []msg{}
	for rows.Next() {
		var m msg
		if err := rows.Scan(&m.ID, &m.ThreadID, &m.SenderID, &m.ClientMsgID, &m.Seq, &m.Type, &m.Content, &m.CreatedAt); err != nil {
			writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
			return
		}
		messages = append(messages, m)
	}
	// reverse to ascending seq
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	response := map[string]any{
		"messages": messages,
	}
	// report truncation
	var minSeq int64
	_ = pool.QueryRow(r.Context(), `
		select coalesce(min(seq), 0)
		from chat_messages
		where thread_id = $1 and created_at >= $2`, threadID, cutoff,
	).Scan(&minSeq)
	if lastSeq > 0 && minSeq > 1 {
		response["truncated"] = true
		response["server_min_seq"] = minSeq
	} else {
		response["truncated"] = false
		response["server_min_seq"] = minSeq
	}
	writeJSON(w, r, http.StatusOK, response)
}

func handleCreateMessage(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, redisClient *redis.Client, cfg Config) {
	userID := ctxValue(r, ctxUserID)
	start := time.Now()
	var payload struct {
		ThreadID    string          `json:"thread_id"`
		ClientMsgID string          `json:"client_msg_id"`
		Type        string          `json:"type"`
		Content     json.RawMessage `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid json")
		return
	}
	if payload.ThreadID == "" || payload.ClientMsgID == "" || payload.Type == "" {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "thread_id/client_msg_id/type required")
		return
	}
	if payload.Type != "text" && payload.Type != "image" && payload.Type != "system" && payload.Type != "order_event" {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid message type")
		return
	}
	if payload.Type == "image" {
		normalized, err := normalizeImageContent(payload.Content, userID, cfg)
		if err != nil {
			writeError(w, r, http.StatusBadRequest, "INVALID_IMAGE_CONTENT", err.Error())
			return
		}
		payload.Content = normalized
	}
	if allowed, _, err := redisx.AllowRate(r.Context(), redisClient, redisx.KeyRateUser(userID), cfg.RateUserWindowMs, cfg.RateUserMax); err == nil && !allowed {
		writeError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "user rate limited")
		return
	}
	if allowed, _, err := redisx.AllowRate(r.Context(), redisClient, redisx.KeyRateThread(payload.ThreadID), cfg.RateThreadWindowMs, cfg.RateThreadMax); err == nil && !allowed {
		writeError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "thread rate limited")
		return
	}

	ctx := r.Context()
	tx, err := pool.Begin(ctx)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	defer tx.Rollback(ctx)

	var existing struct {
		ID        string
		Seq       int64
		CreatedAt time.Time
	}
	err = tx.QueryRow(ctx, `
		select id, seq, created_at
		from chat_messages
		where sender_id = $1 and client_msg_id = $2
		limit 1`,
		userID, payload.ClientMsgID,
	).Scan(&existing.ID, &existing.Seq, &existing.CreatedAt)
	if err == nil && existing.ID != "" {
		_ = tx.Commit(ctx)
		writeJSON(w, r, http.StatusOK, map[string]any{
			"msg_id":     existing.ID,
			"seq":        existing.Seq,
			"created_at": existing.CreatedAt,
		})
		return
	}

	var threadStatus string
	err = tx.QueryRow(ctx, `
		select t.status
		from chat_threads t
		join chat_thread_members m on m.thread_id = t.id
		where t.id = $1 and m.user_id = $2`,
		payload.ThreadID, userID,
	).Scan(&threadStatus)
	if err != nil {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}
	if threadStatus != "active" {
		writeError(w, r, http.StatusConflict, "THREAD_INACTIVE", "thread not active")
		return
	}
	var nextSeq int64
	err = tx.QueryRow(ctx, `
		update chat_threads
		set last_seq = last_seq + 1,
		    last_message_at = now(),
		    updated_at = now()
		where id = $1 and status = 'active'
		returning last_seq`,
		payload.ThreadID,
	).Scan(&nextSeq)
	if err != nil || nextSeq == 0 {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "seq allocate failed")
		return
	}
	var msgID string
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		insert into chat_messages (thread_id, sender_id, client_msg_id, seq, type, content)
		values ($1, $2, $3, $4, $5, $6)
		returning id, created_at`,
		payload.ThreadID, userID, payload.ClientMsgID, nextSeq, payload.Type, payload.Content,
	).Scan(&msgID, &createdAt)
	if err != nil {
		if pgErr, ok := err.(*pgconn.PgError); ok && pgErr.Code == "23505" {
			var existingID string
			var existingSeq int64
			var existingAt time.Time
			_ = tx.QueryRow(ctx, `
				select id, seq, created_at
				from chat_messages
				where sender_id = $1 and client_msg_id = $2
				limit 1`,
				userID, payload.ClientMsgID,
			).Scan(&existingID, &existingSeq, &existingAt)
			_ = tx.Commit(ctx)
			writeJSON(w, r, http.StatusOK, map[string]any{
				"msg_id":     existingID,
				"seq":        existingSeq,
				"created_at": existingAt,
			})
			return
		}
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	enqueuePushJobs(ctx, pool, redisClient, payload.ThreadID, userID, msgID, nextSeq, payload.Type, payload.Content, createdAt)
	latencyMs := time.Since(start).Milliseconds()
	dbWriteLatency.Observe(float64(latencyMs))
	messagesWrittenTotal.Inc()
	trace := ctxValue(r, ctxTraceID)
	log.Info().
		Str("trace_id", trace).
		Str("user_id", userID).
		Str("thread_id", payload.ThreadID).
		Str("msg_id", msgID).
		Int64("seq", nextSeq).
		Int64("latency_ms", latencyMs).
		Str("err_code", "").
		Msg("message written")
	writeJSON(w, r, http.StatusOK, map[string]any{
		"msg_id":     msgID,
		"seq":        nextSeq,
		"created_at": createdAt,
	})
}

type imageContent struct {
	URL       string `json:"url"`
	ObjectKey string `json:"object_key"`
	Mime      string `json:"mime"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Size      int64  `json:"size"`
}

func normalizeImageContent(raw json.RawMessage, userID string, cfg Config) (json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errors.New("image content required")
	}
	var content imageContent
	if err := json.Unmarshal(raw, &content); err != nil {
		return nil, errors.New("invalid image content")
	}
	content.ObjectKey = strings.TrimSpace(content.ObjectKey)
	content.URL = strings.TrimSpace(content.URL)
	content.Mime = strings.TrimSpace(content.Mime)
	if content.URL == "" || content.Mime == "" {
		return nil, errors.New("url/mime required")
	}
	if content.Width <= 0 || content.Height <= 0 || content.Size <= 0 {
		return nil, errors.New("width/height/size required")
	}
	if !strings.HasPrefix(content.Mime, "image/") {
		return nil, errors.New("mime must be image/*")
	}
	objectKey, err := parseObjectKeyFromURL(content.URL, cfg)
	if err != nil {
		return nil, err
	}
	if content.ObjectKey != "" && content.ObjectKey != objectKey {
		return nil, errors.New("object_key mismatch")
	}
	content.ObjectKey = objectKey
	if err := validateIMObjectKey(content.ObjectKey, cfg.EnvName); err != nil {
		return nil, err
	}
	ext := ""
	if idx := strings.LastIndex(content.ObjectKey, "."); idx != -1 && idx < len(content.ObjectKey)-1 {
		ext = content.ObjectKey[idx+1:]
	}
	if ext == "" || !isAllowedExt(ext) {
		return nil, errors.New("object_key ext invalid")
	}
	normalized, err := json.Marshal(content)
	if err != nil {
		return nil, errors.New("invalid image content")
	}
	return normalized, nil
}

func enqueuePushJobs(ctx context.Context, pool *pgxpool.Pool, redisClient *redis.Client, threadID, senderID, msgID string, seq int64, msgType string, content json.RawMessage, createdAt time.Time) {
	if redisClient == nil {
		return
	}
	rows, err := pool.Query(ctx, `
		select user_id
		from chat_thread_members
		where thread_id = $1 and user_id <> $2`, threadID, senderID)
	if err != nil {
		log.Error().Err(err).Msg("push enqueue members query failed")
		return
	}
	defer rows.Close()
	preview := buildPushPreview(msgType, content)
	for rows.Next() {
		var toUserID string
		if err := rows.Scan(&toUserID); err != nil {
			log.Error().Err(err).Msg("push enqueue scan failed")
			continue
		}
		if isUserOnline(ctx, redisClient, toUserID) {
			continue
		}
		payload := map[string]any{
			"to_user_id":       toUserID,
			"thread_id":        threadID,
			"msg_id":           msgID,
			"seq":              seq,
			"msg_type":         msgType,
			"preview":          preview,
			"created_at":       createdAt.Format(time.RFC3339),
			"attempt":          0,
			"available_at_ms":  0,
		}
		if _, err := redisClient.XAdd(ctx, &redis.XAddArgs{Stream: redisx.PushStreamKey, Values: payload}).Result(); err != nil {
			log.Error().Err(err).Str("to_user_id", toUserID).Msg("push enqueue failed")
		}
	}
}

func isUserOnline(ctx context.Context, redisClient *redis.Client, userID string) bool {
	if redisClient == nil || userID == "" {
		return false
	}
	key := redisx.KeyPresence(userID)
	exists, err := redisClient.Exists(ctx, key).Result()
	if err != nil {
		return false
	}
	return exists > 0
}

func buildPushPreview(msgType string, content json.RawMessage) string {
	switch msgType {
	case "image":
		return "[图片]"
	case "order_event":
		return "[订单更新]"
	case "system":
		return ""
	default:
		var body map[string]any
		if err := json.Unmarshal(content, &body); err == nil {
			if text, ok := body["text"].(string); ok {
				return text
			}
		}
	}
	return ""
}

func handlePermission(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool) {
	userID := ctxValue(r, ctxUserID)
	threadID := chi.URLParam(r, "id")
	var exists bool
	err := pool.QueryRow(r.Context(), `
		select exists(
			select 1 from chat_thread_members
			where thread_id = $1 and user_id = $2
		)`,
		threadID, userID,
	).Scan(&exists)
	if err != nil || !exists {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"allowed": true})
}

func handleThreadMembers(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool) {
	userID := ctxValue(r, ctxUserID)
	threadID := chi.URLParam(r, "id")
	var exists bool
	err := pool.QueryRow(r.Context(), `
		select exists(
			select 1 from chat_thread_members
			where thread_id = $1 and user_id = $2
		)`,
		threadID, userID,
	).Scan(&exists)
	if err != nil || !exists {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}
	rows, err := pool.Query(r.Context(), `
		select user_id, role
		from chat_thread_members
		where thread_id = $1`, threadID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	defer rows.Close()
	members := []map[string]any{}
	for rows.Next() {
		var uid string
		var role string
		if err := rows.Scan(&uid, &role); err != nil {
			writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
			return
		}
		members = append(members, map[string]any{
			"user_id": uid,
			"role":    role,
		})
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"members": members})
}

func handlePushToken(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool) {
	userID := ctxValue(r, ctxUserID)
	var payload struct {
		Platform string `json:"platform"`
		Token    string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid json")
		return
	}
	if payload.Platform != "android" || payload.Token == "" {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "platform/token required")
		return
	}
	_, err := pool.Exec(r.Context(), `
		insert into device_tokens (user_id, platform, token, updated_at)
		values ($1, $2, $3, now())
		on conflict (platform, token)
		do update set user_id = excluded.user_id, updated_at = now()`,
		userID, payload.Platform, payload.Token,
	)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"ok": true})
}

func handleMediaUpload(w http.ResponseWriter, r *http.Request, cfg Config) {
	trace := ctxValue(r, ctxTraceID)
	var payload struct {
		Scope    string `json:"scope"`
		Filename string `json:"filename"`
		Ext      string `json:"ext"`
		Mime     string `json:"mime"`
		Size     int64  `json:"size"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		log.Warn().Str("trace_id", trace).Msg("im media upload invalid json")
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid json")
		return
	}
	if payload.Scope != "im_message" {
		log.Warn().Str("trace_id", trace).Msg("im media upload invalid scope")
		writeError(w, r, http.StatusBadRequest, "INVALID_SCOPE", "invalid scope")
		return
	}
	ext := strings.TrimPrefix(strings.ToLower(payload.Ext), ".")
	if ext == "" && payload.Filename != "" {
		if idx := strings.LastIndex(payload.Filename, "."); idx != -1 && idx < len(payload.Filename)-1 {
			ext = strings.ToLower(payload.Filename[idx+1:])
		}
	}
	if !isAllowedExt(ext) || payload.Size <= 0 {
		log.Warn().Str("trace_id", trace).Msg("im media upload invalid ext/size")
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid ext/size")
		return
	}
	if cfg.OSSEndpoint == "" || cfg.OSSBucketIM == "" || cfg.OSSAccessKeyID == "" || cfg.OSSAccessKeySecret == "" || cfg.OSSIMPublicBaseURL == "" {
		log.Warn().Str("trace_id", trace).Msg("im media upload misconfig")
		writeError(w, r, http.StatusBadRequest, "MISCONFIG", "oss not configured")
		return
	}
	client, err := oss.New(cfg.OSSEndpoint, cfg.OSSAccessKeyID, cfg.OSSAccessKeySecret)
	if err != nil {
		log.Error().Str("trace_id", trace).Msg("im media upload oss init failed")
		writeError(w, r, http.StatusInternalServerError, "STORAGE_ERROR", "oss error")
		return
	}
	bucket, err := client.Bucket(cfg.OSSBucketIM)
	if err != nil {
		log.Error().Str("trace_id", trace).Msg("im media upload bucket error")
		writeError(w, r, http.StatusInternalServerError, "STORAGE_ERROR", "oss error")
		return
	}
	objectKey := formatIMObjectKey(cfg.EnvName, ext)
	expiresSec := int64(cfg.OSSIMUploadExpiresSecs)
	if expiresSec <= 0 {
		expiresSec = int64(cfg.OSSUploadExpiresSecs)
	}
	if expiresSec <= 0 {
		expiresSec = 900
	}
	signedURL, err := bucket.SignURL(objectKey, oss.HTTPPut, expiresSec, oss.ContentType(payload.Mime))
	if err != nil {
		log.Error().Str("trace_id", trace).Msg("im media upload sign failed")
		writeError(w, r, http.StatusInternalServerError, "STORAGE_ERROR", "oss error")
		return
	}
	log.Info().Str("trace_id", trace).Str("object_key", objectKey).Int64("expires_in", expiresSec).Msg("im media upload url issued")
	resp := map[string]any{
		"success":    true,
		"upload_url": signedURL,
		"object_key": objectKey,
		"expires_in": expiresSec,
		"method":     "PUT",
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func formatIMObjectKey(env, ext string) string {
	now := time.Now().UTC()
	env = sanitizeEnvName(env)
	return fmt.Sprintf("im/%s/%04d/%02d/%s.%s",
		env, now.Year(), int(now.Month()), newUUID(), ext)
}

func parseObjectKeyFromURL(url string, cfg Config) (string, error) {
	base := strings.TrimRight(cfg.OSSIMPublicBaseURL, "/")
	if base == "" {
		return "", errors.New("public base url required")
	}
	if !strings.HasPrefix(url, base+"/") {
		return "", errors.New("url invalid")
	}
	key := strings.TrimPrefix(url, base+"/")
	if key == "" {
		return "", errors.New("url invalid")
	}
	return key, nil
}

func validateIMObjectKey(key, env string) error {
	parts := strings.Split(key, "/")
	if len(parts) != 5 {
		return errors.New("object_key format invalid")
	}
	if parts[0] != "im" {
		return errors.New("object_key prefix invalid")
	}
	if parts[1] != sanitizeEnvName(env) {
		return errors.New("object_key env invalid")
	}
	if len(parts[2]) != 4 || !isAllDigits(parts[2]) {
		return errors.New("object_key year invalid")
	}
	if len(parts[3]) != 2 || !isAllDigits(parts[3]) {
		return errors.New("object_key month invalid")
	}
	filename := parts[4]
	dot := strings.LastIndex(filename, ".")
	if dot <= 0 || dot == len(filename)-1 {
		return errors.New("object_key filename invalid")
	}
	id := filename[:dot]
	if !isUUID(id) {
		return errors.New("object_key uuid invalid")
	}
	return nil
}

func sanitizeEnvName(env string) string {
	env = strings.ToLower(strings.TrimSpace(env))
	if env == "" {
		return "dev"
	}
	clean := make([]rune, 0, len(env))
	for _, r := range env {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			clean = append(clean, r)
		}
	}
	if len(clean) == 0 {
		return "dev"
	}
	return string(clean)
}

func isAllDigits(val string) bool {
	for _, r := range val {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isUUID(val string) bool {
	if len(val) != 36 {
		return false
	}
	for i, r := range val {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') {
				continue
			}
			return false
		}
	}
	return true
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		b[0], b[1], b[2], b[3],
		b[4], b[5],
		b[6], b[7],
		b[8], b[9],
		b[10], b[11], b[12], b[13], b[14], b[15],
	)
}

func isAllowedExt(ext string) bool {
	switch strings.ToLower(ext) {
	case "jpg", "jpeg", "png", "webp", "gif":
		return true
	default:
		return false
	}
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

func writeJSON(w http.ResponseWriter, r *http.Request, status int, body any) {
	trace := ctxValue(r, ctxTraceID)
	resp := map[string]any{
		"success": true,
		"data":    body,
		"traceId": trace,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(resp)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code string, message string) {
	trace := ctxValue(r, ctxTraceID)
	log.Error().
		Str("trace_id", trace).
		Int("status", status).
		Str("code", code).
		Msg(message)
	resp := map[string]any{
		"success": false,
		"code":    code,
		"message": message,
		"traceId": trace,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(resp)
}

func ctxValue(r *http.Request, key ctxKey) string {
	if r == nil {
		return ""
	}
	val := r.Context().Value(key)
	if val == nil {
		return ""
	}
	if s, ok := val.(string); ok {
		return s
	}
	return ""
}

func queryInt(r *http.Request, key string, fallback int) int {
	val := r.URL.Query().Get(key)
	if val == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return fallback
	}
	return parsed
}

func queryInt64(r *http.Request, key string) *int64 {
	val := r.URL.Query().Get(key)
	if val == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func randomID(prefix string) string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("%s_%s", prefix, hex.EncodeToString(buf))
}
