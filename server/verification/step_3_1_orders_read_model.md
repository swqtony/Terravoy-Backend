# Step 3.1 Orders Read Model 字段对齐

## 1) App 订单 UI 需要字段清单（最小上线集合）

### 列表（/orders/my, /host/orders）
- 基础：id, orderNo, status, createdAt, scheduleAt(startTime), guests, amount, currency
- 体验信息：experienceId, experienceTitle, experienceCover, city, meetingPoint
- 双方展示：travelerId, travelerName, travelerAvatar, hostId, hostName, hostAvatar
- 聊天：conversationId
- 支付：paymentStatus, paymentMethod, paidAt, paymentIntentId
- 评价：travelerReviewed, hostReviewed, reviewVisible, reviewRevealAt
- 可选：languagePreference, tags, timeSlotLabel, timeline

### 详情（/orders/{id}）
- 列表字段超集
- notes(travelerNote), contactPhone
- cancellationPolicy（无字段时返回 null）
- refundStatus/refundId/refundAt（如有退款表）

## 2) 后端字段来源与映射（事实）

| App 字段 | 后端来源 | 说明 |
|---|---|---|
| id / orderNo | orders.id / orders.order_no | 订单主键与编号 |
| status | orders.status | 保持原状态机 |
| createdAt | orders.created_at | ISO8601 输出 |
| scheduleAt | orders.start_time | 对应 App scheduleAt |
| guests | orders.people_count | 对应 App guests |
| amount | orders.total_amount | numeric → number |
| currency | orders.currency | 默认 CNY |
| experienceId | orders.experience_id | 下单时写入 |
| experienceTitle | orders.experience_title | 新增列（0014） |
| experienceCover | orders.experience_cover | 新增列（0014） |
| city | orders.city | 新增列（0014） |
| meetingPoint | orders.meeting_point | 新增列（0014） |
| travelerId / hostId | orders.traveler_id / orders.host_id | profile id |
| travelerName | orders.traveler_name / profiles.nickname / fallback | 读模型优先订单列，其次 profiles.nickname |
| hostName | orders.host_name / profiles.nickname / fallback | 同上 |
| travelerAvatar / hostAvatar | orders.traveler_avatar / orders.host_avatar | 新增列（0014），目前可为空 |
| conversationId | orders.conversation_id | 新增列（0014） |
| paymentStatus | orders.payment_status | 付款状态 |
| paymentMethod | orders.payment_method 或 orders.payment_provider | payments_v2 扩展列 |
| paidAt | orders.paid_at | 支付时间 |
| paymentIntentId | orders.payment_intent_id | intents 列 |
| travelerReviewed / hostReviewed | reviews exists 子查询 | orders.js attachReviewStatus |
| reviewVisible / reviewRevealAt | attachReviewStatus | 订单详情中返回 |
| languagePreference | orders.language_preference → 响应字段 language | 与 App 解析对齐 |
| tags | orders.tags | jsonb 列，默认 [] |
| timeSlotLabel | orders.time_slot_label | 新增列（0014） |
| timeline | 读模型默认 [] | DB 无列时返回空数组 |
| notes | orders.traveler_note | 详情返回 |
| contactPhone | orders.contact_phone | 新增列（0014） |
| refundStatus / refundId / refundAt | refunds 表 + orders.refund_status/refund_at | detail 使用最新退款记录（orders.js fetchOrder） |

> 读模型组装器：`server/src/readModels/orderReadModel.js`

## 3) curl 验证（脱敏示例）

> 说明：以下 curl 可直接执行；响应示例已脱敏。

### 1) traveler list
```bash
curl -X GET "$BASE_URL/functions/v1/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-route: /orders/my"
```
示例响应：
```json
{"success":true,"data":[{"id":"1","order_no":"ORD***","status":"PENDING_PAYMENT","created_at":"2024-12-29T12:00:00.000Z","start_time":"2024-12-30T08:00:00.000Z","people_count":1,"total_amount":199,"currency":"CNY","experience_id":"exp_***","experience_title":"","experience_cover":"","city":"","meeting_point":"","traveler_id":"***","traveler_name":"user_****","traveler_avatar":"","host_id":"***","host_name":"user_****","host_avatar":"","conversation_id":null,"payment_status":"UNPAID","payment_method":null,"payment_intent_id":null,"paid_at":null,"traveler_reviewed":false,"host_reviewed":false,"review_visible":false,"review_reveal_at":null,"language":"","tags":[],"time_slot_label":null,"timeline":[],"visible_to_traveler":true,"visible_to_host":true}]}
```

### 2) host list
```bash
curl -X GET "$BASE_URL/functions/v1/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-route: /host/orders"
```

### 3) detail
```bash
curl -X GET "$BASE_URL/functions/v1/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-route: /orders/1"
```
示例响应（节选）：
```json
{"success":true,"data":{"order":{"id":"1","order_no":"ORD***","meeting_point":"","contact_phone":null,"refund_status":null,"refund_id":null,"refund_at":null},"serviceLogs":[],"reviews":{"visible":false,"reveal_at":null,"traveler_reviewed":false,"host_reviewed":false,"traveler":null,"host":null}}}
```

### 4) list 字段断言（keys）
```bash
curl -X GET "$BASE_URL/functions/v1/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-route: /orders/my" | jq '.[0] | keys'
```

### 5) detail 字段断言（order keys）
```bash
curl -X GET "$BASE_URL/functions/v1/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-route: /orders/1" | jq '.data.order | keys'
```

### 6) payment 字段断言
```bash
curl -X GET "$BASE_URL/functions/v1/orders" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-route: /orders/1" | jq '.data.order | {payment_status, payment_method, paid_at, payment_intent_id}'
```

