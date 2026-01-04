package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"terravoy/im/im-gateway/internal/redisx"
)

type Config struct {
	Addr              string
	APIBaseURL        string
	RedisURL          string
	AuthJWTSecret     string
	PresenceTTL       time.Duration
	PresenceRefresh   time.Duration
	GatewayID         string
	RateUserMax       int
	RateUserWindowMs  int
	RateThreadMax     int
	RateThreadWindowMs int
}

type ctxKey string

const (
	ctxTraceID ctxKey = "trace_id"
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(_ *http.Request) bool { return true },
	}
	wsConnections = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "ws_connections",
		Help: "Active websocket connections",
	})
	wsInbound = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "msg_in_total",
		Help: "Inbound websocket messages",
	})
	wsOutbound = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "msg_out_total",
		Help: "Outbound websocket messages",
	})
	wsErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "errors_total",
		Help: "Websocket handler errors",
	})
)

type inboundMsg struct {
	Type        string          `json:"type"`
	Token       string          `json:"token"`
	ThreadID    string          `json:"thread_id"`
	MsgType     string          `json:"msg_type"`
	Content     json.RawMessage `json:"content"`
	ClientMsgID string          `json:"client_msg_id"`
	LastReadSeq int64           `json:"last_read_seq"`
	TraceID     string          `json:"trace_id"`
}

type outboundMsg struct {
	Type     string      `json:"type"`
	TraceID  string      `json:"trace_id,omitempty"`
	Payload  interface{} `json:"payload,omitempty"`
	Code     string      `json:"code,omitempty"`
	Message  string      `json:"message,omitempty"`
}

type Conn struct {
	ws        *websocket.Conn
	userID    string
	token     string
	headerToken string
	traceID   string
	send      chan []byte
	subs      map[string]bool
}

type Hub struct {
	mu          sync.RWMutex
	conns       map[*Conn]bool
	userConns   map[string]map[*Conn]bool
	threadSubs  map[string]map[*Conn]bool
}

func newHub() *Hub {
	return &Hub{
		conns:      map[*Conn]bool{},
		userConns:  map[string]map[*Conn]bool{},
		threadSubs: map[string]map[*Conn]bool{},
	}
}

func (h *Hub) addConn(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c] = true
}

func (h *Hub) removeConn(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns, c)
	if c.userID != "" {
		if set, ok := h.userConns[c.userID]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.userConns, c.userID)
			}
		}
	}
	for threadID := range c.subs {
		if set, ok := h.threadSubs[threadID]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.threadSubs, threadID)
			}
		}
	}
}

func (h *Hub) attachUser(c *Conn, userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c.userID = userID
	if _, ok := h.userConns[userID]; !ok {
		h.userConns[userID] = map[*Conn]bool{}
	}
	h.userConns[userID][c] = true
}

func (h *Hub) subscribe(c *Conn, threadID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c.subs == nil {
		c.subs = map[string]bool{}
	}
	c.subs[threadID] = true
	if _, ok := h.threadSubs[threadID]; !ok {
		h.threadSubs[threadID] = map[*Conn]bool{}
	}
	h.threadSubs[threadID][c] = true
}

func (h *Hub) broadcast(threadID string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.threadSubs[threadID] {
		select {
		case c.send <- payload:
		default:
		}
	}
}

func main() {
	cfg := loadConfig()
	setupLogger()

	prometheus.MustRegister(wsConnections, wsInbound, wsOutbound, wsErrors)

	redisClient := newRedisClient(cfg.RedisURL)
	hub := newHub()
	httpClient := &http.Client{Timeout: 8 * time.Second}

	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWS(w, r, cfg, hub, redisClient, httpClient)
	})

	server := &http.Server{
		Addr:    cfg.Addr,
		Handler: traceMiddleware(mux),
	}
	log.Info().Str("addr", cfg.Addr).Msg("im-gateway listening")
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal().Err(err).Msg("gateway crashed")
	}
}

func loadConfig() Config {
	return Config{
		Addr:            env("IM_WS_ADDR", ":8081"),
		APIBaseURL:      strings.TrimRight(env("IM_API_BASE_URL", "http://localhost:8090"), "/"),
		RedisURL:        env("REDIS_URL", "redis://localhost:6379/0"),
		AuthJWTSecret:   env("AUTH_JWT_SECRET", ""),
		PresenceTTL:     75 * time.Second,
		PresenceRefresh: 30 * time.Second,
		GatewayID:       env("IM_GATEWAY_ID", randomID("gw")),
		RateUserMax:       envInt("IM_RATE_USER_MAX", 20),
		RateUserWindowMs:  envInt("IM_RATE_USER_WINDOW_MS", 10000),
		RateThreadMax:     envInt("IM_RATE_THREAD_MAX", 30),
		RateThreadWindowMs: envInt("IM_RATE_THREAD_WINDOW_MS", 10000),
	}
}

func setupLogger() {
	zerolog.TimeFieldFormat = time.RFC3339
}

func env(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		parsed, err := strconv.Atoi(val)
		if err == nil {
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
		w.Header().Set("X-Trace-Id", trace)
		ctx := context.WithValue(r.Context(), ctxTraceID, trace)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func handleWS(w http.ResponseWriter, r *http.Request, cfg Config, hub *Hub, rdb *redis.Client, httpClient *http.Client) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		wsErrors.Inc()
		return
	}
	trace := ctxValue(r.Context(), ctxTraceID)
	c := &Conn{
		ws:      conn,
		traceID: trace,
		headerToken: extractBearer(r.Header.Get("Authorization")),
		send:    make(chan []byte, 16),
		subs:    map[string]bool{},
	}
	hub.addConn(c)
	wsConnections.Inc()
	log.Info().Str("trace_id", trace).Msg("ws connected")
	go writeLoop(c)
	readLoop(c, cfg, hub, rdb, httpClient)
	hub.removeConn(c)
	wsConnections.Dec()
	if c.userID != "" {
		clearPresence(context.Background(), rdb, c.userID)
	}
	_ = conn.Close()
	log.Info().Str("trace_id", trace).Msg("ws closed")
}

func readLoop(c *Conn, cfg Config, hub *Hub, rdb *redis.Client, httpClient *http.Client) {
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(cfg.PresenceRefresh)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if c.userID != "" {
					refreshPresence(context.Background(), rdb, c.userID, cfg.GatewayID, cfg.PresenceTTL)
				}
			case <-stop:
				return
			}
		}
	}()
	defer close(stop)
	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		wsInbound.Inc()
		var msg inboundMsg
		if err := json.Unmarshal(data, &msg); err != nil {
			sendError(c, "INVALID_JSON", "invalid json")
			continue
		}
		if msg.TraceID != "" {
			c.traceID = msg.TraceID
		}
		switch msg.Type {
		case "auth":
			if c.userID != "" {
				sendError(c, "ALREADY_AUTH", "already authenticated")
				continue
			}
			token := extractBearer(msg.Token)
			if token == "" {
				token = c.headerToken
			}
			userID, err := verifyToken(token, cfg.AuthJWTSecret)
			if err != nil {
				sendError(c, "UNAUTHORIZED", "invalid token")
				continue
			}
			c.token = token
			hub.attachUser(c, userID)
			refreshPresence(context.Background(), rdb, userID, cfg.GatewayID, cfg.PresenceTTL)
			sendAuthOK(c, map[string]string{"user_id": userID})
		case "sub":
			if c.userID == "" {
				sendError(c, "UNAUTHORIZED", "auth required")
				continue
			}
			if msg.ThreadID == "" {
				sendError(c, "INVALID_REQUEST", "thread_id required")
				continue
			}
			if !checkPermission(httpClient, cfg.APIBaseURL, c.token, msg.ThreadID) {
				sendError(c, "FORBIDDEN", "not a member")
				continue
			}
			hub.subscribe(c, msg.ThreadID)
			sendAck(c, map[string]any{"action": "sub", "thread_id": msg.ThreadID})
		case "msg":
			if c.userID == "" {
				sendError(c, "UNAUTHORIZED", "auth required")
				continue
			}
			if msg.ThreadID == "" || msg.MsgType == "" {
				sendError(c, "INVALID_REQUEST", "thread_id/msg_type required")
				continue
			}
			if allowed, _, err := redisx.AllowRate(context.Background(), rdb, redisx.KeyRateUser(c.userID), cfg.RateUserWindowMs, cfg.RateUserMax); err == nil && !allowed {
				sendError(c, "RATE_LIMITED", "user rate limited")
				continue
			}
			if allowed, _, err := redisx.AllowRate(context.Background(), rdb, redisx.KeyRateThread(msg.ThreadID), cfg.RateThreadWindowMs, cfg.RateThreadMax); err == nil && !allowed {
				sendError(c, "RATE_LIMITED", "thread rate limited")
				continue
			}
			resp, err := createMessage(httpClient, cfg.APIBaseURL, c.token, msg.ThreadID, msg.ClientMsgID, msg.MsgType, msg.Content)
			if err != nil {
				sendError(c, "SEND_FAILED", err.Error())
				continue
			}
			sendAck(c, map[string]any{
				"action":        "msg",
				"thread_id":     msg.ThreadID,
				"client_msg_id": msg.ClientMsgID,
				"msg_id":        resp.MsgID,
				"seq":           resp.Seq,
			})
			out := map[string]any{
				"thread_id":  msg.ThreadID,
				"msg_id":     resp.MsgID,
				"seq":        resp.Seq,
				"created_at": resp.CreatedAt,
				"sender_id":  c.userID,
				"msg_type":   msg.MsgType,
				"content":    json.RawMessage(msg.Content),
			}
			broadcast(hub, msg.ThreadID, c.traceID, out)
		case "read":
			if c.userID == "" {
				sendError(c, "UNAUTHORIZED", "auth required")
				continue
			}
			if msg.ThreadID == "" || msg.LastReadSeq <= 0 {
				sendError(c, "INVALID_REQUEST", "thread_id/last_read_seq required")
				continue
			}
			if err := updateRead(httpClient, cfg.APIBaseURL, c.token, msg.ThreadID, msg.LastReadSeq); err != nil {
				sendError(c, "READ_FAILED", err.Error())
				continue
			}
			sendAck(c, map[string]any{"action": "read", "thread_id": msg.ThreadID, "last_read_seq": msg.LastReadSeq})
		case "ping":
			if c.userID != "" {
				refreshPresence(context.Background(), rdb, c.userID, cfg.GatewayID, cfg.PresenceTTL)
			}
			sendAck(c, map[string]string{"action": "ping"})
		default:
			sendError(c, "UNKNOWN_TYPE", "unsupported type")
		}
	}
}

func writeLoop(c *Conn) {
	for payload := range c.send {
		_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := c.ws.WriteMessage(websocket.TextMessage, payload); err != nil {
			return
		}
		wsOutbound.Inc()
	}
}

func sendAuthOK(c *Conn, payload interface{}) {
	msg := outboundMsg{Type: "auth_ok", TraceID: c.traceID, Payload: payload}
	sendJSON(c, msg)
}

func sendAck(c *Conn, payload interface{}) {
	msg := outboundMsg{Type: "ack", TraceID: c.traceID, Payload: payload}
	sendJSON(c, msg)
}

func sendError(c *Conn, code, message string) {
	wsErrors.Inc()
	msg := outboundMsg{Type: "error", TraceID: c.traceID, Code: code, Message: message}
	sendJSON(c, msg)
}

func sendJSON(c *Conn, msg outboundMsg) {
	data, _ := json.Marshal(msg)
	select {
	case c.send <- data:
	default:
		wsErrors.Inc()
		_ = c.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "slow consumer"), time.Now().Add(2*time.Second))
		_ = c.ws.Close()
	}
}

func broadcast(hub *Hub, threadID, trace string, payload map[string]any) {
	msg := outboundMsg{
		Type:    "msg",
		TraceID: trace,
		Payload: payload,
	}
	data, _ := json.Marshal(msg)
	hub.broadcast(threadID, data)
}

func extractBearer(raw string) string {
	if raw == "" {
		return ""
	}
	parts := strings.SplitN(raw, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "bearer") {
		return strings.TrimSpace(parts[1])
	}
	return strings.TrimSpace(raw)
}

func verifyToken(token, secret string) (string, error) {
	if token == "" || secret == "" {
		return "", errors.New("missing token")
	}
	parsed, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
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

func refreshPresence(ctx context.Context, rdb *redis.Client, userID, gatewayID string, ttl time.Duration) {
	if rdb == nil || userID == "" {
		return
	}
	key := redisx.KeyPresence(userID)
	_ = rdb.Set(ctx, key, gatewayID, ttl).Err()
}

func clearPresence(ctx context.Context, rdb *redis.Client, userID string) {
	if rdb == nil || userID == "" {
		return
	}
	key := redisx.KeyPresence(userID)
	_ = rdb.Del(ctx, key).Err()
}

type apiResponse struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Code    string          `json:"code"`
	Message string          `json:"message"`
}

type createMsgResp struct {
	MsgID     string `json:"msg_id"`
	Seq       int64  `json:"seq"`
	CreatedAt string `json:"created_at"`
}

func createMessage(client *http.Client, baseURL, token, threadID, clientMsgID, msgType string, content json.RawMessage) (*createMsgResp, error) {
	if clientMsgID == "" {
		clientMsgID = randomID("client")
	}
	body := map[string]any{
		"thread_id":     threadID,
		"client_msg_id": clientMsgID,
		"type":          msgType,
		"content":       json.RawMessage(content),
	}
	raw, err := doAPI(client, baseURL, token, http.MethodPost, "/v1/messages", body)
	if err != nil {
		return nil, err
	}
	var resp createMsgResp
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, errors.New("invalid im-api response")
	}
	return &resp, nil
}

func updateRead(client *http.Client, baseURL, token, threadID string, seq int64) error {
	body := map[string]any{"last_read_seq": seq}
	_, err := doAPI(client, baseURL, token, http.MethodPost, fmt.Sprintf("/v1/threads/%s/read", threadID), body)
	return err
}

func checkPermission(client *http.Client, baseURL, token, threadID string) bool {
	_, err := doAPI(client, baseURL, token, http.MethodGet, fmt.Sprintf("/v1/threads/%s/permission", threadID), nil)
	return err == nil
}

func doAPI(client *http.Client, baseURL, token, method, path string, body interface{}) (json.RawMessage, error) {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequest(method, baseURL+path, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var parsed apiResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if !parsed.Success {
		return nil, errors.New(parsed.Message)
	}
	return parsed.Data, nil
}

func ctxValue(ctx context.Context, key ctxKey) string {
	if ctx == nil {
		return ""
	}
	val := ctx.Value(key)
	if val == nil {
		return ""
	}
	if s, ok := val.(string); ok {
		return s
	}
	return ""
}

func randomID(prefix string) string {
	now := time.Now().UnixNano()
	return fmt.Sprintf("%s_%d", prefix, now)
}
