# TerraVoy Local API

快速验证（任何时刻 clone 后可跑通）：
```
docker compose up -d --build
docker compose exec api npm run db:migrate
bash tools/curl_smoke_test.sh
```

鉴权/授权模型详见：`docs/auth_and_authorization.md`（新增 LeanCloud SessionToken 校验 + 短期本地 JWT，DB 权限收紧）。

## 环境
- Node.js 20+
- Docker (用于 `docker compose up`)
- Postgres 16（compose 内置）

复制 `.env.example` 为 `.env`，可按需调整端口和数据库参数。

## 一键启动
```bash
docker compose up -d --build
```

## 数据库迁移
（容器内或本机均可）
```bash
# 确保数据库已启动
npm run db:migrate --prefix server
```
迁移文件位于 `db/migrations/0001_supabase_schema.sql`，来源于 Supabase dump。

## 路由概览
- 健康检查：`GET /health` -> `{ ok: true }`
- Supabase 兼容：
  - `POST /functions/v1/auth-supabase-login`
  - `POST /functions/v1/terra-auth`
  - `POST /functions/v1/profile-bootstrap`
  - `POST /functions/v1/profile-update`
  - `POST /functions/v1/trip-card-create`
  - `POST /functions/v1/match-start`
  - `POST /functions/v1/match-poll`
  - `POST /functions/v1/match-cancel`
  - `POST /functions/v1/match-attach-conversation`
  - `POST /functions/v1/match-get-partner`
  - `POST /functions/v1/preferences-update|preferences-fetch`（返回 501，原项目未提供实现）
  - 订单多路复用：`/functions/v1/orders`（支持 x-route/x-path 兼容 supabase edge，或直接调用 `/orders/create`, `/orders/{id}/accept|reject|cancel|start|end|mark_paid|review`, `/orders/my`, `/host/orders`, `/orders/{id}`）
- 偏好持久化：`GET|PUT|DELETE /api/v1/preferences/match`（任意 JSON 按原样存储/读取；`match-start` 在缺省时会自动复用）
- Storage 占位：`/storage/*` 与 `/functions/v1/storage/*` 统一返回 501（文件上传/UGC/认证材料由 LeanCloud 负责）

所有需要用户身份的接口读取 `X-LeanCloud-UserId`（必填），`X-Terra-Role`（host/traveler，可选，默认 traveler），`X-Terra-Token`（开发模式未校验，支持 dev token）。

## 定时任务
- 内置作业：每 10 分钟自动关闭超 12 小时未确认的订单（等价 Supabase cron 逻辑）。启动时自动运行。

## 冒烟测试
```bash
bash tools/curl_smoke_test.sh
```
覆盖 /health、基本匹配/订单流程（需先跑迁移）。
