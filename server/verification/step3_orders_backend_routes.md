# Step 3.0 Orders 后端路由能力盘点

> 来源：`server/src/routes/orders.js`

## 入口与路由分发

- 单入口：`/functions/v1/orders`（`app.all`）
  - 行号：`server/src/routes/orders.js:521-589`
  - 路由识别：读取 `x-route` / `x-path` / query.route（`orders.js:122-137`）
  - 鉴权：`requireAuth`（`orders.js:523-528`）

## 支持的 x-route 子路径（事实存在）

- `POST /orders/create` — `handleCreate`（`orders.js:536-538`）
  - body 字段：experienceId, hostId, startTime, endTime, peopleCount, totalAmount, currency?, travelerNote?（`orders.js:140-150`）
  - 返回：order（`orders.js:192-193`）
- `POST /orders/{id}/mark_paid` — `handleMarkPaid`（`orders.js:539-542`）
- `POST /orders/{id}/accept` — `handleAccept`（`orders.js:543-546`）
- `POST /orders/{id}/reject` — `handleReject`（`orders.js:547-550`）
- `POST /orders/{id}/cancel` — `handleCancel`（`orders.js:551-554`）
- `POST /orders/{id}/start` — `handleStart`（`orders.js:555-558`）
- `POST /orders/{id}/end` — `handleEnd`（`orders.js:559-562`）
- `POST /orders/{id}/review` — `handleReview`（`orders.js:563-566`）
  - body 字段：rating, comment（`orders.js:313-323`）
- `GET /orders/experience/{id}/reviews_summary` — `handleExperienceReviewSummary`（`orders.js:567-569`）
- `GET /orders/my` — `handleMyOrders`（`orders.js:571-572`）
  - query：status?（`orders.js:533-535` + `424-450`）
- `GET /host/orders` — `handleHostOrders`（`orders.js:574-575`）
  - query：status?（`orders.js:533-535` + `453-479`）
- `GET /orders/{id}` — `handleDetail`（`orders.js:577-579`）
  - 返回：order + serviceLogs + reviews（`orders.js:510-515`）

## 返回字段（事实存在）

- 列表：`handleMyOrders`/`handleHostOrders` 返回 rows + review 状态（`orders.js:424-451` / `453-479`）
  - 字段示例：id, order_no, experience_id, host_id/traveler_id, start_time, status, payment_status, payment_intent_id, paid_at, completed_at, total_amount, currency, created_at, hostLeancloudUserId, travelerLeancloudUserId, traveler_reviewed, host_reviewed（`orders.js:428-439` / `457-468`）
- 详情：`handleDetail` 返回 order + serviceLogs + reviews（`orders.js:482-515`）

