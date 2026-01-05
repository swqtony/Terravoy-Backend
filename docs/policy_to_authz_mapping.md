# RLS → API AuthZ Mapping

- 当前数据库：RLS 已开启但无 Policy；表对 anon/authenticated/service_role 授予 ALL。
- 本地 API 替代措施：
  - 所有业务接口要求通过认证的 token，`actor` 来自 token claims（`sub` / `role`）。
  - `X-Terra-Role` 仅用于非生产调试场景，生产以 token claims 为准。
  - `X-Terra-Token` 用于 dev token 兼容，生产以 Bearer JWT 为主。
  - 匹配接口基于 `ensure_profile_v2` 绑定 actor -> profile，校验请求归属（match-cancel/poll）。
  - 订单接口校验订单归属（traveler_id/host_id）并限制状态流转；非本人返回 403。
- 缺失的 RLS Policy 需在后续完善（如需 DB 级别约束）。
