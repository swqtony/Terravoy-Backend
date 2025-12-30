package main

import (
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
)

type Config struct {
	WsAddr             string
	ApiBaseURL         string
	RedisURL           string
	AuthJWTSecret      string
	PresenceTTLSeconds int
	PresenceRefreshSec int
	RateUserMax        int
	RateUserWindowMs   int
	RateThreadMax      int
	RateThreadWindowMs int
}

type IncomingMessage struct {
	Type        string          `json:"type"`
	Token       string          `json:"token,omitempty"`
	ThreadID    string          `json:"thread_id,omitempty"`
	ClientMsgID string          `json:"client_msg_id,omitempty"`
	MsgType     string          `json:"msg_type,omitempty"`
	Content     json.RawMessage `json:"content,omitempty"`
	LastReadSeq int64           `json:"last_read_seq,omitempty"`
	TraceID     string          `json:"trace_id,omitempty"`
}

type OutgoingMessage struct {
	Type        string          `json:"type"`
	ThreadID    string          `json:"thread_id,omitempty"`
	MsgID       string          `json:"msg_id,omitempty"`
	ClientMsgID string          `json:"client_msg_id,omitempty"`
	Seq         int64           `json:"seq,omitempty"`
	SenderID    string          `json:"sender_id,omitempty"`
	MsgType     string          `json:"msg_type,omitempty"`
	Content     json.RawMessage `json:"content,omitempty"`
	CreatedAt   string          `json:"created_at,omitempty"`
	TraceID     string          `json:"trace_id,omitempty"`
	Code        string          `json:"code,omitempty"`
	Message     string          `json:"message,omitempty"`
	UserID      string          `json:"user_id,omitempty"`
}

type Conn struct {
	id         string
	ws         *websocket.Conn
	send       chan []byte
	userID     string
	token      string
	subs       map[string]struct{}
	closeOnce  sync.Once
	closeCh    chan struct{}
	connected  time.Time
	traceIDGen func() string
}

type Hub struct {
	mu            sync.RWMutex
	conns         map[string]*Conn
	connsByUser   map[string]map[string]*Conn
	subsByThread  map[string]map[string]*Conn
}

func NewHub() *Hub {
	return &Hub{
		conns:        make(map[string]*Conn),
		connsByUser:  make(map[string]map[string]*Conn),
		subsByThread: make(map[string]map[string]*Conn),
	}
}

func (h *Hub) addConn(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[c.id] = c
}

func (h *Hub) removeConn(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.conns, c.id)
	if c.userID != "" {
		if userMap, ok := h.connsByUser[c.userID]; ok {
			delete(userMap, c.id)
			if len(userMap) == 0 {
				delete(h.connsByUser, c.userID)
			}
		}
	}
	for threadID := range c.subs {
		if subs, ok := h.subsByThread[threadID]; ok {
			delete(subs, c.id)
			if len(subs) == 0 {
				delete(h.subsByThread, threadID)
			}
		}
	}
}

func (h *Hub) bindUser(c *Conn, userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c.userID = userID
	if h.connsByUser[userID] == nil {
		h.connsByUser[userID] = make(map[string]*Conn)
	}
	h.connsByUser[userID][c.id] = c
}

func (h *Hub) subscribe(c *Conn, threadID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c.subs[threadID] = struct{}{}
	if h.subsByThread[threadID] == nil {
		h.subsByThread[threadID] = make(map[string]*Conn)
	}
	h.subsByThread[threadID][c.id] = c
}

func (h *Hub) fanout(threadID string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.subsByThread[threadID] {
		select {
		case c.send <- msg:
		default:
			c.close()
		}
	}
}

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(_ *http.Request) bool { return true },
	}
	luaSlidingWindow = `
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
)

var (
	metricConnections = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "im_gateway_connections",
		Help: "Active websocket connections",
	})
	metricMsgSendTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "im_gateway_msg_send_total",
		Help: "Total messages sent via gateway",
	})
	metricMsgSendErrors = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "im_gateway_msg_send_errors_total",
		Help: "Total message send errors",
	})
	metricWriteLatency = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "im_gateway_write_db_latency_ms",
		Help:    "Latency for message write API",
		Buckets: []float64{5, 10, 25, 50, 100, 250, 500, 1000},
	})
)

func main() {
	cfg := loadConfig()
	setupLogger()
	prometheus.MustRegister(metricConnections, metricMsgSendTotal, metricMsgSendErrors, metricWriteLatency)

	redisClient := newRedisClient(cfg.RedisURL)
	hub := NewHub()
	httpClient := &http.Client{Timeout: 10 * time.Second}

	http.Handle("/metrics", promhttp.Handler())
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := &Conn{
			id:         randomID("conn"),
			ws:         conn,
			send:       make(chan []byte, 128),
			subs:       make(map[string]struct{}),
			closeCh:    make(chan struct{}),
			connected:  time.Now(),
			traceIDGen: func() string { return randomID("trace") },
		}
		hub.addConn(c)
		metricConnections.Inc()
		log.Info().Str("connId", c.id).Msg("ws connected")
		go c.writePump()
		go c.readPump(cfg, hub, redisClient, httpClient)
	})

	server := &http.Server{
		Addr:              cfg.WsAddr,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Info().Str("addr", cfg.WsAddr).Msg("im-gateway listening")
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
		WsAddr:             getEnv("IM_WS_ADDR", ":8081"),
		ApiBaseURL:         getEnv("IM_API_BASE_URL", "http://localhost:3000"),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379/0"),
		AuthJWTSecret:      getEnv("AUTH_JWT_SECRET", ""),
		PresenceTTLSeconds: getEnvInt("IM_PRESENCE_TTL_SECONDS", 75),
		PresenceRefreshSec: getEnvInt("IM_PRESENCE_REFRESH_SECONDS", 30),
		RateUserMax:        getEnvInt("IM_RATE_USER_MAX", 20),
		RateUserWindowMs:   getEnvInt("IM_RATE_USER_WINDOW_MS", 10000),
		RateThreadMax:      getEnvInt("IM_RATE_THREAD_MAX", 30),
		RateThreadWindowMs: getEnvInt("IM_RATE_THREAD_WINDOW_MS", 10000),
	}
}

func newRedisClient(url string) *redis.Client {
	opt, err := redis.ParseURL(url)
	if err != nil {
		log.Warn().Err(err).Msg("redis url invalid")
		return redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	}
	return redis.NewClient(opt)
}

func (c *Conn) close() {
	c.closeOnce.Do(func() {
		close(c.closeCh)
		_ = c.ws.Close()
		metricConnections.Dec()
	})
}

func (c *Conn) writePump() {
	pingTicker := time.NewTicker(30 * time.Second)
	defer func() {
		pingTicker.Stop()
		c.close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-pingTicker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.closeCh:
			return
		}
	}
}

func (c *Conn) readPump(cfg Config, hub *Hub, redisClient *redis.Client, httpClient *http.Client) {
	defer func() {
		hub.removeConn(c)
		c.close()
	}()
	c.ws.SetReadLimit(1 << 20)
	_ = c.ws.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.ws.SetPongHandler(func(string) error {
		_ = c.ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		var msg IncomingMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			c.sendError("", "INVALID_JSON", "invalid message")
			continue
		}
		switch msg.Type {
		case "auth":
			c.handleAuth(cfg, hub, redisClient, msg)
		case "sub":
			c.handleSub(cfg, hub, httpClient, msg)
		case "msg":
			c.handleMsg(cfg, hub, redisClient, httpClient, msg)
		case "read":
			c.handleRead(cfg, httpClient, msg)
		default:
			c.sendError(msg.TraceID, "UNKNOWN_TYPE", "unknown type")
		}
	}
}

func (c *Conn) handleAuth(cfg Config, hub *Hub, redisClient *redis.Client, msg IncomingMessage) {
	if msg.Token == "" {
		c.sendError(msg.TraceID, "AUTH_REQUIRED", "token required")
		return
	}
	userID, err := verifyJWT(msg.Token, cfg.AuthJWTSecret)
	if err != nil {
		c.sendError(msg.TraceID, "AUTH_INVALID", "invalid token")
		return
	}
	c.token = msg.Token
	hub.bindUser(c, userID)
	c.startPresence(redisClient, cfg, userID)
	c.sendJSON(OutgoingMessage{Type: "auth_ok", UserID: userID, TraceID: msg.TraceID})
	log.Info().Str("connId", c.id).Str("userId", userID).Msg("auth ok")
}

func (c *Conn) handleSub(cfg Config, hub *Hub, httpClient *http.Client, msg IncomingMessage) {
	if c.userID == "" {
		c.sendError(msg.TraceID, "AUTH_REQUIRED", "auth required")
		return
	}
	if msg.ThreadID == "" {
		c.sendError(msg.TraceID, "INVALID_REQUEST", "thread_id required")
		return
	}
	ok, err := apiCheckPermission(httpClient, cfg.ApiBaseURL, c.token, msg.ThreadID)
	if err != nil || !ok {
		c.sendError(msg.TraceID, "FORBIDDEN", "not allowed")
		return
	}
	hub.subscribe(c, msg.ThreadID)
	c.sendJSON(OutgoingMessage{Type: "sub_ok", ThreadID: msg.ThreadID, TraceID: msg.TraceID})
}

func (c *Conn) handleMsg(cfg Config, hub *Hub, redisClient *redis.Client, httpClient *http.Client, msg IncomingMessage) {
	if c.userID == "" {
		c.sendError(msg.TraceID, "AUTH_REQUIRED", "auth required")
		return
	}
	if msg.ThreadID == "" || msg.ClientMsgID == "" || msg.MsgType == "" {
		c.sendError(msg.TraceID, "INVALID_REQUEST", "thread_id/client_msg_id/msg_type required")
		return
	}
	if _, ok := c.subs[msg.ThreadID]; !ok {
		c.sendError(msg.TraceID, "NOT_SUBSCRIBED", "subscribe first")
		return
	}
	if allowed, retry := checkRate(redisClient, fmt.Sprintf("im:rate:user:%s", c.userID), cfg.RateUserWindowMs, cfg.RateUserMax); !allowed {
		c.sendError(msg.TraceID, "RATE_LIMITED", fmt.Sprintf("retry_after_ms:%d", retry))
		return
	}
	if allowed, retry := checkRate(redisClient, fmt.Sprintf("im:rate:thread:%s", msg.ThreadID), cfg.RateThreadWindowMs, cfg.RateThreadMax); !allowed {
		c.sendError(msg.TraceID, "RATE_LIMITED", fmt.Sprintf("retry_after_ms:%d", retry))
		return
	}

	start := time.Now()
	resp, err := apiPostMessage(httpClient, cfg.ApiBaseURL, c.token, msg.ThreadID, msg.ClientMsgID, msg.MsgType, msg.Content)
	metricWriteLatency.Observe(float64(time.Since(start).Milliseconds()))
	if err != nil {
		metricMsgSendErrors.Inc()
		c.sendError(msg.TraceID, "SEND_FAILED", "write failed")
		return
	}
	metricMsgSendTotal.Inc()
	ack := OutgoingMessage{
		Type:        "ack",
		ClientMsgID: msg.ClientMsgID,
		MsgID:       resp.MsgID,
		Seq:         resp.Seq,
		TraceID:     msg.TraceID,
	}
	c.sendJSON(ack)

	broadcast := OutgoingMessage{
		Type:      "msg",
		ThreadID:  msg.ThreadID,
		MsgID:     resp.MsgID,
		Seq:       resp.Seq,
		SenderID:  c.userID,
		MsgType:   msg.MsgType,
		Content:   msg.Content,
		CreatedAt: resp.CreatedAt,
		TraceID:   msg.TraceID,
	}
	if payload, err := json.Marshal(broadcast); err == nil {
		hub.fanout(msg.ThreadID, payload)
	}
}

func (c *Conn) handleRead(cfg Config, httpClient *http.Client, msg IncomingMessage) {
	if c.userID == "" {
		c.sendError(msg.TraceID, "AUTH_REQUIRED", "auth required")
		return
	}
	if msg.ThreadID == "" {
		c.sendError(msg.TraceID, "INVALID_REQUEST", "thread_id required")
		return
	}
	if msg.LastReadSeq < 0 {
		c.sendError(msg.TraceID, "INVALID_REQUEST", "last_read_seq required")
		return
	}
	if err := apiPostRead(httpClient, cfg.ApiBaseURL, c.token, msg.ThreadID, msg.LastReadSeq); err != nil {
		c.sendError(msg.TraceID, "READ_FAILED", "read failed")
		return
	}
	c.sendJSON(OutgoingMessage{Type: "read_ok", ThreadID: msg.ThreadID, TraceID: msg.TraceID})
}

func (c *Conn) startPresence(redisClient *redis.Client, cfg Config, userID string) {
	if redisClient == nil {
		return
	}
	key := fmt.Sprintf("im:online:%s", userID)
	ctx := context.Background()
	_ = redisClient.Set(ctx, key, c.id, time.Duration(cfg.PresenceTTLSeconds)*time.Second).Err()
	ticker := time.NewTicker(time.Duration(cfg.PresenceRefreshSec) * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = redisClient.Set(ctx, key, c.id, time.Duration(cfg.PresenceTTLSeconds)*time.Second).Err()
			case <-c.closeCh:
				return
			}
		}
	}()
}

func (c *Conn) sendJSON(msg OutgoingMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.send <- data:
	default:
		c.close()
	}
}

func (c *Conn) sendError(traceID, code, message string) {
	if traceID == "" && c.traceIDGen != nil {
		traceID = c.traceIDGen()
	}
	c.sendJSON(OutgoingMessage{Type: "error", Code: code, Message: message, TraceID: traceID})
}

func apiCheckPermission(client *http.Client, baseURL, token, threadID string) (bool, error) {
	url := fmt.Sprintf("%s/v1/threads/%s/permission", strings.TrimRight(baseURL, "/"), threadID)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200, nil
}

type messageResp struct {
	Success bool `json:"success"`
	Data    struct {
		MsgID     string `json:"msg_id"`
		Seq       int64  `json:"seq"`
		CreatedAt string `json:"created_at"`
	} `json:"data"`
}

func apiPostMessage(client *http.Client, baseURL, token, threadID, clientMsgID, msgType string, content json.RawMessage) (*messageResp, error) {
	payload := map[string]interface{}{
		"thread_id":    threadID,
		"client_msg_id": clientMsgID,
		"type":        msgType,
		"content":     json.RawMessage(content),
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/messages", strings.TrimRight(baseURL, "/"))
	req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("write status %d", resp.StatusCode)
	}
	var data messageResp
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return &data, nil
}

func apiPostRead(client *http.Client, baseURL, token, threadID string, lastRead int64) error {
	payload := map[string]interface{}{
		"last_read_seq": lastRead,
	}
	body, _ := json.Marshal(payload)
	url := fmt.Sprintf("%s/v1/threads/%s/read", strings.TrimRight(baseURL, "/"), threadID)
	req, _ := http.NewRequest("POST", url, strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("read status %d", resp.StatusCode)
	}
	return nil
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

func checkRate(client *redis.Client, key string, windowMs int, max int) (bool, int64) {
	if client == nil {
		return true, 0
	}
	ctx := context.Background()
	res, err := client.Eval(ctx, luaSlidingWindow, []string{key}, windowMs, max).Result()
	if err != nil {
		return true, 0
	}
	values, ok := res.([]interface{})
	if !ok || len(values) < 2 {
		return true, 0
	}
	allowed := values[0].(int64) == 1
	retryMs := values[1].(int64)
	return allowed, retryMs
}

func randomID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}
