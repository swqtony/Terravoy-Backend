# TerraVoy Admin Audit Report

## 结论摘要
- 后端为 Node.js(Fastify) + Postgres，IM 相关为 Go 服务；前端为 Flutter，统一通过 `/functions/v1/*` 与后端交互。
- C 端鉴权以短信登录 + JWT(ACCESS/REFRESH) 为主，另有 Terra Token 与本地调试 JWT；无独立管理员用户体系。
- 已有订单/体验/内容/举报/媒体上传等主业务 API，但管理侧仅见少量 `/v1/admin/*` 接口（举报、私有媒体读取）。
- 部署以 docker-compose 为主，环境变量集中在 `.env.example`/`.env` 与 `server/src/config.js`。

## Step 0: 仓库概况

### 项目根目录结构树（深度 2）
后端 `/home/swqtony/projects/terravoy-backend`：
```
./.env.example
./.gitignore
./im-gateway
./im-gateway/Dockerfile
./im-gateway/go.mod
./im-gateway/go.sum
./im-gateway/internal
./im-gateway/main.go
./server
./server/Dockerfile
./server/README.md
./server/src
./server/package-lock.json
./server/verification
./server/tests
./server/node_modules
./server/package.json
./server/.gitkeep
./server/scripts
./IM_IMPLEMENTATION_GUIDE.md
./.env
./README.md
./IM_PREFLIGHT_TO_PROD_REPORT.md
./tools
./tools/payments_preflight.sql
./tools/curl_smoke_test.sh
./tests
./tests/golden
./docker-compose.yml
./im
./im/im-worker
./im/im-api
./im/scripts
./im/docker-compose.im.yml
./db
./db/migrations
./db/verify
./db/dumps
./db/init
./db/docker-compose.yml
./MIGRATION_SUMMARY.md
./docs
./docs/PUSH_FCM_SETUP.md
./docs/IM_MEDIA_FLOW.md
./docs/IM_MESSAGE_SEMANTICS.md
./docs/backend_id_mapping.md
./docs/local-dev.md
./docs/IM_GATEWAY.md
./docs/REDIS_KEYS.md
./docs/step_2_6_5_sms_mock_gateway_switch.md
./docs/auth_and_authorization.md
./docs/avatar_acceptance.md
./docs/payments_v2.md
./docs/IM_REDIS_PREFLIGHT.md
./docs/OBSERVABILITY.md
./docs/policy_to_authz_mapping.md
./docs/db-fix-null-composite.md
./docs/IM_THREAD_MODEL.md
./Makefile
./IM_MIGRATION_AUDIT.md
./scripts
./scripts/verify_step5.sh
./scripts/verify_step7.sh
./scripts/verify_step6.sh
./scripts/im_smoke_ws.js
./scripts/verify_media_upload.sh
./scripts/worker_selfcheck.js
./scripts/dev-compose.sh
./supabase
./supabase/.temp
```

前端 `/mnt/c/wsl_projects/TerraVoy`：
```
./.dart_tool
./.env
./.env.example
./.flutter-plugins-dependencies
./.git
./.idea
./.leancloud
./.metadata
./analysis_options.yaml
./android
./assets
./build
./db
./db/migrations
./devtools_options.yaml
./docs
./docs/audit
./ios
./l10n.yaml
./lib
./licenses
./linux
./macos
./plugins
./pubspec.lock
./pubspec.yaml
./README.md
./RUNNING.md
./scripts
./server
./server/src
./terravoy_mvp.iml
./terravoy_test
./test
./tools
./web
./windows
```

### README/RUNNING/DEPLOY 文档列表
后端：
- `README.md`
- `server/README.md`
- `docs/local-dev.md`
- `IM_PREFLIGHT_TO_PROD_REPORT.md`
- `IM_IMPLEMENTATION_GUIDE.md`
- `IM_MIGRATION_AUDIT.md`

前端：
- `README.md`
- `RUNNING.md`

### 依赖文件清单
后端：
- `server/package.json`
- `im/im-api/go.mod`
- `im/im-worker/go.mod`
- `im-gateway/go.mod`

前端：
- `pubspec.yaml`
- `terravoy_test/pubspec.yaml`

## Step 1: 技术栈识别（后端/前端）

### 后端
- 语言/框架：Node.js + Fastify（`server/package.json` 依赖 `fastify`），IM 相关服务为 Go（`go.mod`）。
- API 入口：`server/src/app.js`，启动脚本为 `npm run start`（`server/package.json`）。
- 多服务清单/端口（docker-compose）：
  - `api`：`PORT` 默认 3000（`docker-compose.yml`）
  - `worker`：同镜像、后台任务（`docker-compose.yml`）
  - `db`：Postgres 5432（`docker-compose.yml` / `db/docker-compose.yml`）
  - `im-db`：Postgres 5433（`im/docker-compose.im.yml`）
  - `im-redis`：Redis 6379（`im/docker-compose.im.yml`）
  - `im-api`：:8090（`im/docker-compose.im.yml`）
  - `im-gateway`：:8081（`im/docker-compose.im.yml`）
  - `im-worker`：后台任务（`im/docker-compose.im.yml`）

### 前端
- 语言/框架：Flutter（`pubspec.yaml`），移动端/桌面/WEB 目录齐全。
- API 调用方式：`LocalBackendClient` 统一调用 `/functions/v1/*`（`lib/services/local_backend/local_backend_client.dart`）。
- 后端地址配置：`BACKEND_BASE_URL` / `PUBLIC_MEDIA_BASE_URL` / `IM_API_BASE_URL` 等（`lib/services/local_backend/backend_config.dart`，`.env.example`）。

## Step 2: 鉴权与用户体系（最重要）

### C 端鉴权方式
结论：以短信登录 + JWT(access/refresh) 为主，另有 Terra Token 与本地调试 JWT。
- 短信登录：`/functions/v1/auth/sms/send`、`/functions/v1/auth/sms/verify` 发放 `accessToken` + `refreshToken`（`server/src/routes/authSms.js`）。
- JWT 校验：`AUTH_JWT_SECRET`（`server/src/plugins/authBearer.js`、`server/src/config.js`）。
- Terra Token：`/functions/v1/terra-auth` 颁发 Terra Token（`server/src/routes/supabaseAuth.js`、`server/src/utils/auth.js`）。
- 本地 JWT：`LOCAL_JWT_SECRET` 仅用于本地/开发（`server/src/services/authService.js`、`server/src/config.js`）。
- 前端 Bearer + 角色透传：`Authorization: Bearer` + `x-terra-role`（`lib/services/local_backend/local_backend_client.dart`）。

### Auth middleware/guard 入口
- 主鉴权入口：`server/src/services/authService.js`（`requireAuth`）。
- Bearer 验证：`server/src/plugins/authBearer.js`（`verifyAccessToken`）。
- 路由注册：`server/src/routes/index.js`。

### 用户表/字段（SQL）
结论：自建 `auth_users/auth_sessions/auth_sms_codes`，另有 `profiles` 等业务用户信息。
- `auth_users`：`id, phone, created_at, status`（`db/migrations/0012_auth_sms.sql`）
- `auth_sessions`：`user_id, refresh_token_hash, refresh_expires_at, device_id, revoked_at`（`db/migrations/0012_auth_sms.sql`）
- `auth_sms_codes`：验证码表（`db/migrations/0012_auth_sms.sql`）
- `profiles`：用户资料（在 `db/migrations/0001_supabase_schema.sql` 中定义）

### 管理员用户/权限
结论：无独立管理员用户/角色表，仅有“角色字段 + API Key”式门禁。
- 管理接口判断：admin key 或 terra token 的 `role=admin`（`server/src/routes/reports.js`、`server/src/routes/media.js`）。
- `ADMIN_API_KEY` 通过环境变量配置（`server/src/config.js`、`.env.example`）。
- `terra-auth` 接口只允许 `role=traveler/host`（`server/src/routes/supabaseAuth.js`），未见管理员 role 发放路径。

## Step 3: 现有业务域（体验/订单/内容/举报/存储）

### 体验（experiences）
结论：已存在完整体验表与主机端路由，状态包括 `draft/published/paused/archived/rejected`。
- 表结构：`experiences`（`db/migrations/0015_experiences_discover.sql`）
- 路由：`/functions/v1/host/experiences*`（`server/src/routes/experiences.js`）
- 状态流转：`draft -> published -> paused/archived` 等（`server/src/routes/experiences.js`）

### 订单（orders）
结论：订单表/状态机完整，含支付与状态日志。
- 状态枚举：`PENDING_HOST_CONFIRM, CONFIRMED, IN_SERVICE, COMPLETED, CANCELLED_*`（`db/migrations/0001_supabase_schema.sql`）
- 表结构：`orders` + `order_status_logs`（`db/migrations/0001_supabase_schema.sql`）
- 路由：`/functions/v1/orders*`、`/functions/v1/host/orders*`（`server/src/routes/orders.js`）
- 状态流转：`PENDING_PAYMENT -> PENDING_HOST_CONFIRM -> CONFIRMED -> IN_SERVICE -> COMPLETED` 等（`server/src/routes/orders.js`）

### 内容（posts/comments/media）
结论：广场帖子与评论表已具备，媒体表与上传接口已具备。
- discover_posts/comments/likes 表：`db/migrations/0015_experiences_discover.sql`
- 路由：`/functions/v1/discover/posts`（`server/src/routes/discoverPlaza.js`）
- 媒体表：`media_assets`（`db/migrations/0016_media_assets.sql`）
- 媒体上传接口：`/v1/media/upload-url`、`/v1/media/complete`（`server/src/routes/media.js`）

### 举报/风控（reports）
结论：举报表 + 基础管理接口已存在。
- `reports` 表：`db/migrations/0019_reports.sql`
- 提交举报：`/v1/reports`
- 管理端查询/更新：`/v1/admin/reports`（`server/src/routes/reports.js`）

### 上传存储
结论：使用 Ali OSS，私有读链支持“管理员读”接口。
- OSS 配置：`OSS_ENDPOINT/OSS_BUCKET_PUBLIC/OSS_BUCKET_PRIVATE` 等（`server/src/config.js`、`.env.example`）
- 服务实现：`server/src/services/storage/ossStorageService.js`
- 管理读取私有媒体：`/v1/admin/media/read-url`（`server/src/routes/media.js`）

## Step 4: 管理后台现状（如果已存在）
结论：未发现独立 admin 前端；后端仅有少量 `/v1/admin/*` API。
- 无 `admin/console/dashboard` 目录：`find . -iname '*admin*'` 为空。
- 已有管理端 API：
  - `/v1/admin/reports`（举报管理）
  - `/v1/admin/media/read-url`（私有媒体读链）
- RBAC：仅“角色字段 + API Key”检查（`server/src/routes/reports.js`、`server/src/routes/media.js`）。
- 审计日志：存在 `order_status_logs`、`media_audit_logs`（`db/migrations/0001_supabase_schema.sql`、`db/migrations/0018_media_assets_hardening.sql`），未见通用 admin 审计日志体系。

## Step 5: 部署与环境变量（后面要上生产）

### 部署配置
- `docker-compose.yml`（api/worker/db）
- `im/docker-compose.im.yml`（im-api/im-worker/im-gateway/redis/db）
- `db/docker-compose.yml`（独立 db）

### 环境变量引用点
后端：
- `server/src/config.js`（DB/JWT/支付/OSS/IM/ADMIN API KEY）
- `.env.example`

前端：
- `.env.example`
- `lib/services/local_backend/backend_config.dart`

重点变量（摘录）：
- DB：`POSTGRES_*`（`server/src/config.js` / `.env.example`）
- JWT/Token：`AUTH_JWT_SECRET`, `LOCAL_JWT_SECRET`, `TERRA_JWT_SECRET`（`server/src/config.js` / `.env.example`）
- 对象存储：`OSS_ENDPOINT`, `OSS_BUCKET_*`, `OSS_ACCESS_KEY_*`（`server/src/config.js` / `.env.example`）
- 支付：`WECHAT_PAY_*`, `ALIPAY_*`, `PAYMENT_*`（`server/src/config.js` / `.env.example`）
- 管理 API Key：`ADMIN_API_KEY`, `ADMIN_READ_URL_KEY`（`server/src/config.js` / `.env.example`）
- 前端后端地址：`BACKEND_BASE_URL`, `PUBLIC_MEDIA_BASE_URL`, `IM_API_BASE_URL`（前端 `.env.example`）

### 管理后台域名建议
结论：当前部署结构仅暴露 API（无 admin UI），建议将未来管理后台独立子域名（如 `admin.*`）并配合反代/鉴权隔离。

## Step 6: 建议的最小改动点（不做实现）
1) 管理员登录（独立于 C 端）：独立 admin 用户表/登录流程（避免复用 C 端用户）。
2) RBAC：角色/权限表 + 资源级权限点映射。
3) 审计日志：管理端操作日志（谁在什么时候改了什么）。
4) Admin API 边界：统一 `/v1/admin/*` 前缀 + 中间件（强制 admin auth）。
5) Admin Web 部署：独立前端包 + 反向代理 + 访问控制（可选内网/VPN）。

## 风险与缺口
P0
- 管理 API 仅依赖 `ADMIN_API_KEY` 或 token role=admin，且未见独立管理员身份体系与 RBAC，容易形成单点泄露风险（`server/src/routes/reports.js`、`server/src/routes/media.js`）。
- `.env.example` 中存在默认开发密钥与 `DEV_AUTH_BYPASS` 等配置项，生产若未覆盖可能导致鉴权弱化（`server/src/config.js`、`.env.example`）。

P1
- 缺少统一的管理端审计日志（仅见 `order_status_logs`/`media_audit_logs`），难以回溯管理操作。
- 前端无管理端 UI，管理功能需通过接口手动调用，效率与安全性较弱。

## 建议的后台模块划分（MVP 页面清单）
- 登录/权限：Admin 登录、角色与权限管理
- 用户管理：用户列表、账号状态、KYC 状态
- 体验管理：体验列表、状态审核、上下线
- 订单管理：订单列表、退款/争议处理
- 内容管理：广场帖子/评论审核
- 举报中心：举报列表、处理流转
- 媒体管理：私有媒体查看/封禁
- 审计日志：操作记录、导出
- 系统设置：支付/存储/短信配置可视化

## 证据列表（路径/命令输出索引）
E1. 后端结构树：`find . -maxdepth 2 -mindepth 1 -print`（后端根目录）
E2. 前端结构树：`find . -maxdepth 2 -mindepth 1 -print`（前端根目录）
E3. 后端服务与端口：`docker-compose.yml`, `im/docker-compose.im.yml`, `db/docker-compose.yml`
E4. 后端启动入口：`server/src/app.js`, `server/package.json`
E5. 鉴权实现：`server/src/services/authService.js`, `server/src/plugins/authBearer.js`, `server/src/routes/authSms.js`
E6. Terra Token：`server/src/routes/supabaseAuth.js`, `server/src/utils/auth.js`
E7. 用户与会话表：`db/migrations/0012_auth_sms.sql`, `db/migrations/0001_supabase_schema.sql`
E8. 体验业务：`db/migrations/0015_experiences_discover.sql`, `server/src/routes/experiences.js`
E9. 订单业务：`db/migrations/0001_supabase_schema.sql`, `server/src/routes/orders.js`
E10. 内容/广场：`db/migrations/0015_experiences_discover.sql`, `server/src/routes/discoverPlaza.js`
E11. 举报管理：`db/migrations/0019_reports.sql`, `server/src/routes/reports.js`
E12. 媒体与 OSS：`server/src/routes/media.js`, `server/src/services/storage/ossStorageService.js`
E13. 配置与环境变量：`server/src/config.js`, `.env.example`, 前端 `.env.example`, `lib/services/local_backend/backend_config.dart`
