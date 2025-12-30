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
	OSSEndpoint          string
	OSSBucketPublic      string
	OSSAccessKeyID       string
	OSSAccessKeySecret   string
	OSSPublicBaseURL     string
	OSSUploadExpiresSecs int
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
)

const rateLua = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_hits = tonumber(ARGV[2])
local now = redis.call('TIME')
local now_ms = (now[1] * 1000) + math.floor(now[2] / 1000)
local window_start = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
local count = redis.call('ZCARD', key)
if count >= max_hits then
  local earliest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldest = tonumber(earliest[2]) or now_ms
  local retry_after_ms = oldest + window_ms - now_ms
  if retry_after_ms < 0 then retry_after_ms = 0 end
  return {0, retry_after_ms}
end
redis.call('ZADD', key, now_ms, tostring(now_ms))
redis.call('PEXPIRE', key, window_ms + 1000)
return {1, 0}
`

func main() {
	cfg := loadConfig()
	setupLogger()

	prometheus.MustRegister(httpDuration)

	pool, err := pgxpool.New(context.Background(), cfg.DBDsn)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect failed")
	}
	redisClient := newRedisClient(cfg.RedisURL)

	router := chi.NewRouter()
	router.Use(traceMiddleware)
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
		OSSEndpoint:          env("OSS_ENDPOINT", ""),
		OSSBucketPublic:      env("OSS_BUCKET_PUBLIC", ""),
		OSSAccessKeyID:       env("OSS_ACCESS_KEY_ID", ""),
		OSSAccessKeySecret:   env("OSS_ACCESS_KEY_SECRET", ""),
		OSSPublicBaseURL:     env("OSS_PUBLIC_BASE_URL", ""),
		OSSUploadExpiresSecs: envInt("OSS_UPLOAD_EXPIRES_SECONDS", 900),
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
	if payload.Type != "match" && payload.Type != "order" && payload.Type != "support" {
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
	if payload.Type != "support" && len(payload.Members) < 2 {
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
	if payload.Type == "match" {
		err = tx.QueryRow(ctx, `
			insert into chat_threads (type, match_session_id)
			values ($1, $2)
			on conflict (match_session_id)
			do update set updated_at = now()
			returning id, type, status, match_session_id, order_id, last_seq, last_message_at`,
			payload.Type, payload.MatchSessionID,
		).Scan(&row.ID, &row.Type, &row.Status, &row.MatchSessionID, &row.OrderID, &row.LastSeq, &row.LastMessageAt)
	} else if payload.Type == "order" {
		err = tx.QueryRow(ctx, `
			insert into chat_threads (type, order_id)
			values ($1, $2)
			on conflict (order_id)
			do update set updated_at = now()
			returning id, type, status, match_session_id, order_id, last_seq, last_message_at`,
			payload.Type, payload.OrderID,
		).Scan(&row.ID, &row.Type, &row.Status, &row.MatchSessionID, &row.OrderID, &row.LastSeq, &row.LastMessageAt)
	} else {
		err = tx.QueryRow(ctx, `
			insert into chat_threads (type)
			values ($1)
			returning id, type, status, match_session_id, order_id, last_seq, last_message_at`,
			payload.Type,
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
		set last_read_seq = greatest(last_read_seq, $1), updated_at = now()
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
	err := pool.QueryRow(r.Context(), `
		select t.type, t.last_seq
		from chat_threads t
		join chat_thread_members m on m.thread_id = t.id
		where t.id = $1 and m.user_id = $2`,
		threadID, userID,
	).Scan(&ttype, &lastSeq)
	if err != nil {
		writeError(w, r, http.StatusForbidden, "FORBIDDEN", "not a member")
		return
	}
	afterSeq := queryInt64(r, "afterSeq")
	beforeSeq := queryInt64(r, "beforeSeq")
	limit := clampInt(queryInt(r, "limit", 50), 1, 200)
	retentionDays := cfg.RetentionOrderDays
	if ttype == "match" {
		retentionDays = cfg.RetentionMatchDays
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
	if redisClient != nil {
		if allowed, _ := checkRate(redisClient, fmt.Sprintf("im:rate:user:%s", userID), cfg.RateUserWindowMs, cfg.RateUserMax); !allowed {
			writeError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "user rate limited")
			return
		}
		if allowed, _ := checkRate(redisClient, fmt.Sprintf("im:rate:thread:%s", payload.ThreadID), cfg.RateThreadWindowMs, cfg.RateThreadMax); !allowed {
			writeError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "thread rate limited")
			return
		}
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
	writeJSON(w, r, http.StatusOK, map[string]any{
		"msg_id":     msgID,
		"seq":        nextSeq,
		"created_at": createdAt,
	})
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
		on conflict (user_id, platform)
		do update set token = excluded.token, updated_at = now()`,
		userID, payload.Platform, payload.Token,
	)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SERVER_ERROR", "db error")
		return
	}
	writeJSON(w, r, http.StatusOK, map[string]any{"ok": true})
}

func handleMediaUpload(w http.ResponseWriter, r *http.Request, cfg Config) {
	var payload struct {
		Scope string `json:"scope"`
		Ext   string `json:"ext"`
		Mime  string `json:"mime"`
		Size  int64  `json:"size"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid json")
		return
	}
	if payload.Scope != "im_message" {
		writeError(w, r, http.StatusBadRequest, "INVALID_SCOPE", "invalid scope")
		return
	}
	if !isAllowedExt(payload.Ext) || payload.Size <= 0 {
		writeError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "invalid ext/size")
		return
	}
	if cfg.OSSEndpoint == "" || cfg.OSSBucketPublic == "" || cfg.OSSAccessKeyID == "" || cfg.OSSAccessKeySecret == "" {
		writeError(w, r, http.StatusBadRequest, "MISCONFIG", "oss not configured")
		return
	}
	client, err := oss.New(cfg.OSSEndpoint, cfg.OSSAccessKeyID, cfg.OSSAccessKeySecret)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "STORAGE_ERROR", "oss error")
		return
	}
	bucket, err := client.Bucket(cfg.OSSBucketPublic)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "STORAGE_ERROR", "oss error")
		return
	}
	userID := ctxValue(r, ctxUserID)
	objectKey := formatObjectKey("public", payload.Scope, userID, payload.Ext)
	expires := time.Duration(cfg.OSSUploadExpiresSecs) * time.Second
	signedURL, err := bucket.SignURL(objectKey, oss.HTTPPut, int64(expires.Seconds()), oss.ContentType(payload.Mime))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "STORAGE_ERROR", "oss error")
		return
	}
	publicURL := buildPublicURL(cfg, objectKey)
	writeJSON(w, r, http.StatusOK, map[string]any{
		"object_key": objectKey,
		"upload_url": signedURL,
		"public_url": publicURL,
		"expires_at": time.Now().Add(expires).Format(time.RFC3339),
	})
}

func formatObjectKey(visibility, scope, userID, ext string) string {
	now := time.Now().UTC()
	return fmt.Sprintf("%s/%s/%s/%04d/%02d/%s.%s",
		visibility, scope, userID, now.Year(), int(now.Month()), randomID("obj"), ext)
}

func buildPublicURL(cfg Config, objectKey string) string {
	base := strings.TrimRight(cfg.OSSPublicBaseURL, "/")
	if base == "" {
		base = fmt.Sprintf("https://%s.%s", cfg.OSSBucketPublic, strings.TrimPrefix(cfg.OSSEndpoint, "https://"))
	}
	return fmt.Sprintf("%s/%s", base, objectKey)
}

func isAllowedExt(ext string) bool {
	switch strings.ToLower(ext) {
	case "jpg", "jpeg", "png", "webp", "gif":
		return true
	default:
		return false
	}
}

func checkRate(client *redis.Client, key string, windowMs int, max int) (bool, int64) {
	res, err := client.Eval(context.Background(), rateLua, []string{key}, windowMs, max).Result()
	if err != nil {
		return true, 0
	}
	values, ok := res.([]interface{})
	if !ok || len(values) < 2 {
		return true, 0
	}
	allowed, _ := values[0].(int64)
	retry, _ := values[1].(int64)
	return allowed == 1, retry
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
