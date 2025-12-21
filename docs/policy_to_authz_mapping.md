# RLS → API AuthZ Mapping

- 当前数据库：RLS 已开启但无 Policy；表对 anon/authenticated/service_role 授予 ALL。
- 本地 API 替代措施：
  - 所有业务接口要求 `X-LeanCloud-UserId` 作为 actor。
  - `X-Terra-Role`（host/traveler）用于订单/匹配流程中的角色判断；未提供时默认 traveler。
  - `X-Terra-Token` 仅做占位（dev token 允许），未来可扩展 JWT 校验。
  - 匹配接口基于 `ensure_profile_v2` 绑定 actor -> profile，校验请求归属（match-cancel/poll）。
  - 订单接口校验订单归属（traveler_id/host_id）并限制状态流转；非本人返回 403。
- 缺失的 RLS Policy 需在后续完善（如需 DB 级别约束）。
