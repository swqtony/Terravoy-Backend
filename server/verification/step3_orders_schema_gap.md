# Step 3.0 Orders 字段映射与缺口

## App 端 BookingOrder 字段（来源）

- `lib/models/order_models.dart:150-200` 定义了 BookingOrder 字段集合（含 experienceTitle/cover、city、traveler/host 名称头像、meetingPoint、languagePreference、channel、tags、timeline、visibleToTraveler/Host、conversationId、paymentStatus 等）。

## 后端 orders 现有字段（来源）

- 表结构：`db/migrations/0001_supabase_schema.sql:553-576`
- 支付扩展：`db/migrations/0008_payments.sql:45-46`、`db/migrations/0009_payments_v2.sql:90-97`
- 列表返回字段：`server/src/routes/orders.js:424-439` 与 `453-468`
- 详情返回字段：`server/src/routes/orders.js:482-515`

## 字段对照（App → Backend）

| App 字段 | 后端字段/来源 | 是否已有 | 差异说明/风险 |
|---|---|---|---|
| id / orderNo | `orders.id`, `orders.order_no` | 有 | App 后端映射：`order_service_backend.dart:168-180` |
| travelerId / hostId | `orders.traveler_id`, `orders.host_id` | 有 | 列表/详情均返回（`orders.js:428-443` / `457-472`） |
| experienceId | `orders.experience_id` | 有 | 列表返回（`orders.js:428-431` / `457-458`） |
| scheduleAt | `orders.start_time` | 有 | App 映射 `start_time`（`order_service_backend.dart:174-188`） |
| guests | `orders.people_count` | 有 | App 映射 `people_count` |
| amount | `orders.total_amount` | 有 | App 映射 `total_amount` |
| currency | `orders.currency` | 有 | App 映射 `currency` |
| status | `orders.status` + `payment_status` | 有 | App 状态映射 `order_service_backend.dart:169-247` |
| paymentStatus | `orders.payment_status` | 有 | 列表/详情返回（`orders.js:428-439`） |
| paymentIntentId | `orders.payment_intent_id` | 有 | 列表/详情返回（`orders.js:428-439`） |
| paymentMethod | `orders.payment_method` | 表有/查询无 | 表字段存在（`0009_payments_v2.sql:90-97`），但列表/详情查询未返回 |
| paidAt | `orders.paid_at` | 有 | 列表/详情返回（`orders.js:428-439`） |
| createdAt | `orders.created_at` | 有 | 列表/详情返回 |
| hostLeancloudUserId / travelerLeancloudUserId | profiles.leancloud_user_id join | 有 | 列表/详情返回（`orders.js:430-432` / `459-461`） |
| travelerReviewed / hostReviewed / reviewVisible / reviewRevealAt | reviews + attachReviewStatus | 有 | `orders.js:42-53` / `482-515` |
| travelerReview / hostReview | reviews 表 | 有（详情） | 详情接口返回 reviews（`orders.js:487-515`） |
| experienceTitle | 无 | 缺失 | 后端 orders 查询不含体验标题字段；需 join experience 表或冗余字段 |
| experienceCover | 无 | 缺失 | 同上 |
| city | 无 | 缺失 | 需要 join 或冗余字段 |
| travelerName / travelerAvatar | 无 | 缺失 | 需 join profiles 或 user 表扩展 |
| hostName / hostAvatar | 无 | 缺失 | 需 join profiles 或 user 表扩展 |
| meetingPoint | 无 | 缺失 | 需 join experience 表或订单冗余字段 |
| languagePreference | 无 | 缺失 | 当前后端订单无对应字段 |
| channel | 无 | 缺失 | App 使用固定 `channel='backend'`，但后端无字段 |
| tags | 无 | 缺失 | App 期望列表字段，后端无对应字段 |
| timeline | 无 | 缺失 | App 用于状态时间线渲染（`booking_page.dart:367-409`） |
| visibleToTraveler / visibleToHost | 无 | 缺失 | 旧方案用于过滤；后端当前未提供 |
| timeSlotLabel | 无 | 缺失 | 后端无字段 |
| notes | `orders.traveler_note` | 有 | App 映射 `traveler_note`（`order_service_backend.dart:207`） |
| contactPhone | 无 | 缺失 | 后端订单无字段 |
| conversationId | 无 | 缺失 | App 需要绑定聊天线程（`my_bookings_page_impl.dart:333-337` / `host_orders_page.dart:479-483`） |
| travelerVerified / travelerVerifiedLevel | 无 | 缺失 | App 期望字段；后端无 |
| hostCertificationStatus / hostCertificationBadge | 无 | 缺失 | App 期望字段；后端无 |
| pricePerGuest | 无 | 缺失 | 后端无字段；App 置空 |
