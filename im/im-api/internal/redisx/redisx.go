package redisx

import (
	"context"
	"errors"

	"github.com/redis/go-redis/v9"
)

const (
	keyPresencePrefix = "im:online:"
	keyRateUserPrefix = "im:rate:user:"
	keyRateThreadPrefix = "im:rate:thread:"

	PushStreamKey = "im:push:stream"
	PushDLQKey    = "im:push:dlq"
)

var rateScript = redis.NewScript(`
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
`)

func KeyPresence(userID string) string {
	return keyPresencePrefix + userID
}

func KeyRateUser(userID string) string {
	return keyRateUserPrefix + userID
}

func KeyRateThread(threadID string) string {
	return keyRateThreadPrefix + threadID
}

func AllowRate(ctx context.Context, client *redis.Client, key string, windowMs int, max int) (bool, int64, error) {
	if client == nil {
		return true, 0, nil
	}
	res, err := rateScript.Run(ctx, client, []string{key}, windowMs, max).Result()
	if err != nil {
		return false, 0, err
	}
	values, ok := res.([]interface{})
	if !ok || len(values) < 2 {
		return false, 0, errors.New("rate limiter invalid response")
	}
	allowed, _ := values[0].(int64)
	retry, _ := values[1].(int64)
	return allowed == 1, retry, nil
}
