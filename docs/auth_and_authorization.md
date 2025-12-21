# Auth & Authorization (内测级)

## 请求认证流程
1) **首选 Bearer JWT**  
   - Header: `Authorization: Bearer <token>`  
   - Token 内容：`sub`=LeanCloud userId，`role`=`traveler|host`，短期有效（默认 10 分钟，配置 `LOCAL_JWT_TTL_MIN`），签名密钥 `LOCAL_JWT_SECRET`。
2) **备选 LeanCloud SessionToken**  
   - Header: `X-LeanCloud-UserId` + `X-LeanCloud-SessionToken`（或 `X-LC-Session`）。  
   - 服务端调用 LeanCloud REST `/1.1/users/me` 校验。  
   - 校验通过后当前请求放行，并在响应头返回 `X-Local-JWT`（短期 JWT）。建议后续请求改用 Bearer JWT。
3) 缺少以上有效凭证 -> `401 Unauthorized`。

## 授权模型
- 统一函数：`authorize(actor, action, resource)`（server/src/services/authorize.js）
- 角色与归属：
  - 匹配：`match:start/poll/cancel` 仅 traveler，且请求/会话归属校验。
  - 订单：`create/cancel/review` 仅 traveler；`accept/reject` 仅 host；`start/end` host 或 traveler（订单归属）；详情/列表按归属过滤。
  - Profile/Trip：需通过认证；无额外角色限制。

## 数据库权限收紧
- 迁移 `db/migrations/0002_auth_lockdown.sql`：
  - 创建 `api_role`，授予应用用户 `terravoy`。
  - 撤销 `anon/authenticated/service_role` 在 public schema 上的表/序列/函数权限。
  - `api_role` 拥有 public 表的 CRUD、序列使用与函数执行权限（含默认权限）。

## 配置
- `.env` 关键变量：
  - `LOCAL_JWT_SECRET`, `LOCAL_JWT_TTL_MIN`（短期 JWT）
  - `LEAN_APP_ID`, `LEAN_APP_KEY`, `LEAN_SERVER`（SessionToken 校验）
  - 其余 DB/端口/terra dev token 见 `.env.example`

## 日志
- 每个请求日志包含 `actor`（来自 header/Bearer），`path`，`method`，便于审计越权。

## 与前端兼容
- 请求格式保持 Supabase Edge Function 风格（未改路径/字段）。  
- 如果前端暂未携带 Bearer，可继续用 `X-LeanCloud-UserId` + `X-LeanCloud-SessionToken`，服务端会返回 `X-Local-JWT`，建议前端后续改用 Bearer。
