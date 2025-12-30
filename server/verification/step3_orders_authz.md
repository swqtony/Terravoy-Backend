# Step 3.0 Orders 权限模型与越权防护（后端）

## 鉴权来源

- `server/src/routes/orders.js:521-528` — `/functions/v1/orders` 入口统一 `requireAuth(req)`
- `server/src/services/authService.js:54-115` — `requireAuth` 支持：
  - `x-terra-token`（terra token）
  - `Authorization: Bearer <accessToken>`（自建 access token）
  - LeanCloud headers（x-leancloud-user-id + sessionToken）

## 角色与归属校验（事实）

- `handleCreate`：`authorize(..., 'orders:create')`（`orders.js:154-156`）
- `handleMarkPaid`：
  - `authorize(..., 'orders:mark_paid', { travelerId: profileId })`（`orders.js:197-199`）
  - 订单归属检查：`order.traveler_id !== profileId` → 403（`orders.js:204-206`）
- `handleAccept`：
  - `authorize(..., 'orders:accept', { hostId: order.host_id })`（`orders.js:231-234`）
  - 只允许 host 接受订单（依赖 authorize 规则）
- `handleReject`：`authorize(..., 'orders:reject', { hostId: order.host_id })`（`orders.js:255-257`）
- `handleCancel`：`authorize(..., 'orders:cancel', { travelerId: order.traveler_id })`（`orders.js:275-277`）
- `handleStart`：`authorize(..., 'orders:start', { hostId: order.host_id })`（`orders.js:295-297`）
- `handleEnd`：`authorize(..., 'orders:end', { hostId: order.host_id })`（`orders.js:340-342`）
- `handleReview`：
  - `authorize(..., 'orders:review', { hostId: order.host_id, travelerId: order.traveler_id })`（`orders.js:312-314`）
  - 校验角色只能评价对方（`orders.js:324-336`）
- `handleDetail`：`authorize(..., 'orders:detail', { hostId: order.host_id, travelerId: order.traveler_id })`（`orders.js:482-486`）

## 越权与状态机限制

- 越权返回 403 或 400：
  - `handleMarkPaid` 限制 traveler 归属（`orders.js:204-206`）
  - `handleAccept` / `handleReject` / `handleCancel` 等依赖 authorize（上文）
- 状态迁移限制：
  - 只能按 PENDING/PENDING_PAYMENT → CONFIRMED → IN_SERVICE → COMPLETED 走（`orders.js:196-343` 相关 handler 内部校验）

