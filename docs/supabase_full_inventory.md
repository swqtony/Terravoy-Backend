# Supabase Full Inventory

## Database (schema)
Source: `supabase_raw/schema.sql` (pg_dump from project `gsyisbqznxknnmpinvpr`).

- **Enums**
  - `order_status` (`PENDING_HOST_CONFIRM`, `CONFIRMED`, `IN_SERVICE`, `COMPLETED`, `CANCELLED_REFUNDED`, `CANCELLED_BY_TRAVELER`, `DISPUTED`)
  - `payment_status` (`UNPAID`, `PAID`, `REFUNDING`, `REFUNDED`)
  - `service_log_type` (`START`, `END`, `NOTE`)

- **Tables**
  - `profiles` – uuid PK; `leancloud_user_id` unique; fields: gender, age, first_language, second_language, home_city, region (default `INTL`), is_completed (bool), created_at.
  - `trip_cards` – uuid PK; profile_id FK profiles cascade; destination_city (text, required), destination_country, start_date, end_date, created_at.
  - `match_requests` – uuid PK; profile_id FK profiles cascade; trip_card_id FK trip_cards cascade; preferred_gender/age_min/age_max/languages[]; city_scope_mode default `Strict`; status default `waiting`; created_at.
  - `match_sessions` – uuid PK; profile_a_id/profile_b_id FK profiles cascade; request_a_id/request_b_id FK match_requests; trip_card_a_id/trip_card_b_id FK trip_cards; match_score int; conversation_id text; status default `pending`; created_at.
  - `orders` – bigserial PK; order_no unique; traveler_id uuid; host_id uuid; experience_id text; start_time/end_time; people_count default 1; status `order_status`; payment_status `payment_status`; total_amount numeric(10,2); currency default `CNY`; platform_fee/host_earnings; traveler_note; paid_at/confirmed_at/started_at/completed_at/cancelled_at; cancelled_reason/by; created_at.
  - `order_status_logs` – bigserial PK; order_id FK orders cascade; from_status/to_status; actor_id/actor_role; reason; created_at.
  - `service_logs` – bigserial PK; order_id FK orders cascade; event_type; actor_id/actor_role; message; location/lat/long; attachment_url; created_at.
  - `reviews` – bigserial PK; order_id FK orders cascade UNIQUE; from_user_id/to_user_id uuid; rating int check 1..5; comment; created_at/updated_at.
  - `settlements` – bigserial PK; order_id FK orders cascade; host_id uuid; total_amount/platform_fee/host_earnings; status text default `PENDING`; payout_method/ref; payout_at; created_at.

- **Functions (SQL)**
  - `attach_conversation_to_session(p_session_id uuid, p_conversation_id text, p_force boolean default false) RETURNS match_sessions`
  - `cancel_match(p_request_id uuid) RETURNS void`
  - `create_trip_card(p_profile_id uuid, p_destination_city text, p_start_date date, p_end_date date, p_destination_country text default null) RETURNS trip_cards`
  - `ensure_profile_v2(p_leancloud_user_id text, p_supabase_user_id uuid default null) RETURNS uuid`
  - `get_active_match_request(p_profile_id uuid) RETURNS match_requests`
  - `get_latest_match_session(p_profile_id uuid) RETURNS match_sessions`
  - `start_match(p_profile_id uuid, p_trip_card_id uuid, p_preferred_gender text default null, p_preferred_age_min int default null, p_preferred_age_max int default null, p_preferred_languages text[] default null, p_city_scope_mode text default 'Strict') RETURNS match_sessions`
  - `try_match(p_request_id uuid) RETURNS match_sessions`
  - `update_profile_from_questionnaire(p_profile_id uuid, p_gender text, p_age int, p_first_language text, p_second_language text, p_home_city text) RETURNS profiles`

- **Triggers**
  - None present in dump.

- **Indexes / Constraints**
  - PKs as above; unique: `profiles.leancloud_user_id`, `orders.order_no`, `reviews.order_id`.
  - FKs as above (cascades on core relations); sequences for bigserial tables.

- **RLS / Policies**
  - Row Level Security enabled（查询结果）：`profiles`, `trip_cards`, `match_requests`, `match_sessions`, `orders`, `order_status_logs`, `service_logs`, `reviews`, `settlements`；storage schema：`buckets`, `buckets_analytics`, `buckets_vectors`, `objects`, `prefixes`, `s3_multipart_uploads`, `s3_multipart_uploads_parts`, `vector_indexes`, `migrations`.
  - 当前 dump/查询均未见任何 `CREATE POLICY` 记录，等于“开了 RLS 但未配置策略”，实际访问依赖 grants。

## Edge Functions (from `/supabase/functions`)
- `auth-supabase-login` – creates/authenticates Supabase user for a LeanCloud user; returns access/refresh tokens.
- `terra-auth` – issues Terra JWT after ensuring profile.
- `profile-bootstrap` – ensure profile via RPC and return `{profileId,isCompleted}`.
- `profile-update` – calls `update_profile_from_questionnaire`.
- `trip-card-create` – inserts into `trip_cards`.
- `match-start` – traveler start match; uses RPC `ensure_profile_v2`, `start_match`, `get_active_match_request`, `try_match`, and table `match_sessions`/`match_requests`; may create LeanCloud conversation via `_shared/leancloud.ts`.
- `match-poll` – polls match status; uses RPC `ensure_profile_v2`, `try_match`, tables `match_requests`, `match_sessions`, `profiles`.
- `match-cancel` – cancels match via RPC `cancel_match` after ownership check.
- `match-attach-conversation` – wraps RPC `attach_conversation_to_session`.
- `match-get-partner` – fetch counterpart profile/leancloud id for a session.
- `orders` – multiplexed router for orders lifecycle (create/mark_paid/accept/reject/cancel/start/end/review/list/detail/cron auto-close); touches `orders`, `order_status_logs`, `service_logs`, `reviews`; uses RPC `ensure_profile_v2`.

## Storage
- data dump 显示 storage.* 表均无行（空 buckets/objects 等）；RLS 标记已开启（见上），但未见任何 policy。仍建议在迁移时确认是否需要创建本地存储替代（目前视为未使用）。
- 线下共识：文件上传/UGC/体验发布/认证材料均由 LeanCloud 负责，本地后端不实现 Storage；相关路由统一返回 501（见 `server/src/routes/storage.js`）。

## Cron / Scheduled Jobs
- Edge function `orders` exposes `POST /cron/auto_close_unconfirmed` (manual HTTP trigger). No other scheduled jobs visible in code; dashboard schedule unknown without Supabase console export.

## Data (optional)
- `supabase_raw/data.sql` present (data-only dump from linked project).
