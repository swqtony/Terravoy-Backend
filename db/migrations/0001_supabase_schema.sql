


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."order_status" AS ENUM (
    'PENDING_HOST_CONFIRM',
    'CONFIRMED',
    'IN_SERVICE',
    'COMPLETED',
    'CANCELLED_REFUNDED',
    'CANCELLED_BY_TRAVELER',
    'DISPUTED'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'UNPAID',
    'PAID',
    'REFUNDING',
    'REFUNDED'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."service_log_type" AS ENUM (
    'START',
    'END',
    'NOTE'
);


ALTER TYPE "public"."service_log_type" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."match_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_a_id" "uuid" NOT NULL,
    "profile_b_id" "uuid" NOT NULL,
    "request_a_id" "uuid",
    "request_b_id" "uuid",
    "trip_card_a_id" "uuid",
    "trip_card_b_id" "uuid",
    "match_score" integer,
    "conversation_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."match_sessions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attach_conversation_to_session"("p_session_id" "uuid", "p_conversation_id" "text", "p_force" boolean DEFAULT false) RETURNS "public"."match_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result match_sessions;
begin
  update match_sessions
  set conversation_id = case
    when p_force then p_conversation_id
    else coalesce(conversation_id, p_conversation_id)
  end
  where id = p_session_id
  returning * into result;

  if result is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  return result;
end;
$$;


ALTER FUNCTION "public"."attach_conversation_to_session"("p_session_id" "uuid", "p_conversation_id" "text", "p_force" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."attach_conversation_to_session"("p_session_id" "uuid", "p_conversation_id" "text", "p_force" boolean) IS 'Attach (or reuse existing) conversation_id to a match_session and return the row.';



CREATE OR REPLACE FUNCTION "public"."cancel_match"("p_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.match_requests
  set status = 'cancelled'
  where id = p_request_id
    and status = 'waiting';
end;
$$;


ALTER FUNCTION "public"."cancel_match"("p_request_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trip_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "destination_city" "text" NOT NULL,
    "destination_country" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trip_cards" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_trip_card"("p_profile_id" "uuid", "p_destination_city" "text", "p_start_date" "date", "p_end_date" "date", "p_destination_country" "text" DEFAULT NULL::"text") RETURNS "public"."trip_cards"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  card public.trip_cards%rowtype;
begin
  insert into public.trip_cards (
    profile_id,
    destination_city,
    destination_country,
    start_date,
    end_date
  ) values (
    p_profile_id,
    p_destination_city,
    p_destination_country,
    p_start_date,
    p_end_date
  )
  returning * into card;

  return card;
end;
$$;


ALTER FUNCTION "public"."create_trip_card"("p_profile_id" "uuid", "p_destination_city" "text", "p_start_date" "date", "p_end_date" "date", "p_destination_country" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_profile_v2"("p_leancloud_user_id" "text", "p_supabase_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  existing_id uuid;
BEGIN
  -- leancloud_user_id is the external identity used by IM and display layers.
  IF p_leancloud_user_id IS NULL OR length(trim(p_leancloud_user_id)) = 0 THEN
    RAISE EXCEPTION 'LEAN_USER_ID_REQUIRED';
  END IF;

  SELECT id INTO existing_id
  FROM public.profiles
  WHERE leancloud_user_id = p_leancloud_user_id
  LIMIT 1;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF p_supabase_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET leancloud_user_id = p_leancloud_user_id
    WHERE id = p_supabase_user_id
    RETURNING id INTO existing_id;
    IF existing_id IS NOT NULL THEN
      RETURN existing_id;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, leancloud_user_id, is_completed)
  VALUES (COALESCE(p_supabase_user_id, gen_random_uuid()), p_leancloud_user_id, false)
  ON CONFLICT (leancloud_user_id) DO UPDATE
    SET leancloud_user_id = EXCLUDED.leancloud_user_id
  RETURNING id INTO existing_id;

  RETURN existing_id;
END;
$$;


ALTER FUNCTION "public"."ensure_profile_v2"("p_leancloud_user_id" "text", "p_supabase_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ensure_profile_v2"("p_leancloud_user_id" "text", "p_supabase_user_id" "uuid") IS 'Ensure a profile exists for the given LeanCloud user (external IM/display identity); returns profile id with is_completed unchanged (defaults false).';



CREATE TABLE IF NOT EXISTS "public"."match_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "trip_card_id" "uuid" NOT NULL,
    "preferred_gender" "text",
    "preferred_age_min" integer,
    "preferred_age_max" integer,
    "preferred_languages" "text"[],
    "city_scope_mode" "text" DEFAULT 'Strict'::"text" NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."match_requests" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_match_request"("p_profile_id" "uuid") RETURNS "public"."match_requests"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  req public.match_requests%rowtype;
begin
  select *
  into req
  from public.match_requests
  where profile_id = p_profile_id
    and status = 'waiting'
  order by created_at desc
  limit 1;

  return req;
end;
$$;


ALTER FUNCTION "public"."get_active_match_request"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_match_session"("p_profile_id" "uuid") RETURNS "public"."match_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  sess public.match_sessions%rowtype;
begin
  select *
  into sess
  from public.match_sessions
  where profile_a_id = p_profile_id
     or profile_b_id = p_profile_id
  order by created_at desc
  limit 1;

  return sess;
end;
$$;


ALTER FUNCTION "public"."get_latest_match_session"("p_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_match"("p_profile_id" "uuid", "p_trip_card_id" "uuid", "p_preferred_gender" "text" DEFAULT NULL::"text", "p_preferred_age_min" integer DEFAULT NULL::integer, "p_preferred_age_max" integer DEFAULT NULL::integer, "p_preferred_languages" "text"[] DEFAULT NULL::"text"[], "p_city_scope_mode" "text" DEFAULT 'Strict'::"text") RETURNS "public"."match_sessions"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  req  public.match_requests%rowtype;
  sess public.match_sessions%rowtype;
begin
  -- 1. 先创建一条匹配请求
  insert into public.match_requests (
    profile_id,
    trip_card_id,
    preferred_gender,
    preferred_age_min,
    preferred_age_max,
    preferred_languages,
    city_scope_mode
  ) values (
    p_profile_id,
    p_trip_card_id,
    p_preferred_gender,
    p_preferred_age_min,
    p_preferred_age_max,
    p_preferred_languages,
    coalesce(p_city_scope_mode, 'Strict')
  )
  returning * into req;

  -- 2. 立刻用这条请求去尝试匹配
  sess := public.try_match(req.id);

  -- 3. 把匹配结果（可能是 null，可能是 match_sessions 一行）返回
  return sess;
end;
$$;


ALTER FUNCTION "public"."start_match"("p_profile_id" "uuid", "p_trip_card_id" "uuid", "p_preferred_gender" "text", "p_preferred_age_min" integer, "p_preferred_age_max" integer, "p_preferred_languages" "text"[], "p_city_scope_mode" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."try_match"("p_request_id" "uuid") RETURNS "public"."match_sessions"
    LANGUAGE "plpgsql"
    AS $$
declare
  -- A 侧数据
  req_a   public.match_requests%rowtype;
  trip_a  public.trip_cards%rowtype;
  prof_a  public.profiles%rowtype;

  -- B 侧数据
  req_b   public.match_requests%rowtype;
  trip_b  public.trip_cards%rowtype;
  prof_b  public.profiles%rowtype;

  -- 匹配结果
  sess    public.match_sessions%rowtype;
begin
  --------------------------------------------------------------------
  -- 1. 拿到 A 的请求、行程、画像
  --------------------------------------------------------------------
  select *
  into req_a
  from public.match_requests
  where id = p_request_id
    and status = 'waiting';

  if req_a.id is null then
    -- 请求不存在或不是 waiting 状态，直接返回 null
    return null;
  end if;

  select * into trip_a from public.trip_cards  where id = req_a.trip_card_id;
  select * into prof_a from public.profiles    where id = req_a.profile_id;

  --------------------------------------------------------------------
  -- 2. 在队列中寻找一个 B（双向偏好都满足）
  --------------------------------------------------------------------
  select mr.*
  into req_b
  from public.match_requests mr
  join public.trip_cards tc   on tc.id  = mr.trip_card_id
  join public.profiles   pf   on pf.id  = mr.profile_id
  where
    -- B 必须在等待中
    mr.status = 'waiting'
    -- 不能是同一条请求 / 同一用户
    and mr.id <> req_a.id
    and mr.profile_id <> req_a.profile_id

    -- ✅ 行程城市：暂时要求同城市（之后你可以换成城市范围/打分）
    and tc.destination_city = trip_a.destination_city

    -- ✅ 时间：行程区间必须有重叠
    and daterange(tc.start_date, tc.end_date, '[]')
        && daterange(trip_a.start_date, trip_a.end_date, '[]')

    ----------------------------------------------------------------
    -- ✅ 单向 1：B 满足 A 的偏好（A 想要什么样的人）
    ----------------------------------------------------------------
    -- 性别：如果 A 设了 preferred_gender，则 B 的性别必须符合
    and (
      req_a.preferred_gender is null
      or req_a.preferred_gender = 'any'
      or req_a.preferred_gender = pf.gender
    )

    -- 年龄下限：B 的年龄 >= A 想要的最小年龄（如果 A 设置了）
    and (
      req_a.preferred_age_min is null
      or pf.age is null
      or pf.age >= req_a.preferred_age_min
    )

    -- 年龄上限：B 的年龄 <= A 想要的最大年龄（如果 A 设置了）
    and (
      req_a.preferred_age_max is null
      or pf.age is null
      or pf.age <= req_a.preferred_age_max
    )

    ----------------------------------------------------------------
    -- ✅ 单向 2：A 也要满足 B 的偏好（B 想要什么样的人）
    ----------------------------------------------------------------
    -- 性别：如果 B 设了 preferred_gender，则 A 的性别必须符合
    and (
      mr.preferred_gender is null
      or mr.preferred_gender = 'any'
      or mr.preferred_gender = prof_a.gender
    )

    -- 年龄下限：A 的年龄 >= B 想要的最小年龄（如果 B 设置了）
    and (
      mr.preferred_age_min is null
      or prof_a.age is null
      or prof_a.age >= mr.preferred_age_min
    )

    -- 年龄上限：A 的年龄 <= B 想要的最大年龄（如果 B 设置了）
    and (
      mr.preferred_age_max is null
      or prof_a.age is null
      or prof_a.age <= mr.preferred_age_max
    )

    ----------------------------------------------------------------
    -- （语言、城市范围、打分逻辑可以后续继续往这里加）
    ----------------------------------------------------------------
  limit 1
  for update skip locked;

  -- 没找到合适的 B，返回 null
  if req_b.id is null then
    return null;
  end if;

  --------------------------------------------------------------------
  -- 2.1 根据选中的 req_b 查出 B 的行程和画像（备用）
  --------------------------------------------------------------------
  select * into trip_b from public.trip_cards where id = req_b.trip_card_id;
  select * into prof_b from public.profiles   where id = req_b.profile_id;

  --------------------------------------------------------------------
  -- 3. 创建 match_session 记录（匹配结果）
  --------------------------------------------------------------------
  insert into public.match_sessions (
    profile_a_id, profile_b_id,
    request_a_id, request_b_id,
    trip_card_a_id, trip_card_b_id,
    status
  ) values (
    req_a.profile_id, req_b.profile_id,
    req_a.id,         req_b.id,
    req_a.trip_card_id, req_b.trip_card_id,
    'pending'
  )
  returning * into sess;

  --------------------------------------------------------------------
  -- 4. 把两条请求标记为 matched
  --------------------------------------------------------------------
  update public.match_requests
  set status = 'matched'
  where id in (req_a.id, req_b.id);

  --------------------------------------------------------------------
  -- 5. 返回这条匹配会话
  --------------------------------------------------------------------
  return sess;
end;
$$;


ALTER FUNCTION "public"."try_match"("p_request_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "leancloud_user_id" "text" NOT NULL,
    "gender" "text",
    "age" integer,
    "first_language" "text",
    "second_language" "text",
    "home_city" "text",
    "region" "text" DEFAULT 'INTL'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_completed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_profile_from_questionnaire"("p_profile_id" "uuid", "p_gender" "text", "p_age" integer, "p_first_language" "text", "p_second_language" "text", "p_home_city" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  prof public.profiles%rowtype;
begin
  update public.profiles
  set
    gender = p_gender,
    age = p_age,
    first_language = p_first_language,
    second_language = p_second_language,
    home_city = p_home_city,
    is_completed = true
  where id = p_profile_id
  returning * into prof;

  return prof;
end;
$$;


ALTER FUNCTION "public"."update_profile_from_questionnaire"("p_profile_id" "uuid", "p_gender" "text", "p_age" integer, "p_first_language" "text", "p_second_language" "text", "p_home_city" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_status_logs" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "from_status" "public"."order_status",
    "to_status" "public"."order_status" NOT NULL,
    "actor_id" "uuid",
    "actor_role" "text",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_status_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."order_status_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."order_status_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."order_status_logs_id_seq" OWNED BY "public"."order_status_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" bigint NOT NULL,
    "order_no" "text" NOT NULL,
    "traveler_id" "uuid" NOT NULL,
    "host_id" "uuid" NOT NULL,
    "experience_id" "text" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone,
    "people_count" integer DEFAULT 1 NOT NULL,
    "status" "public"."order_status" DEFAULT 'PENDING_HOST_CONFIRM'::"public"."order_status" NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'UNPAID'::"public"."payment_status" NOT NULL,
    "total_amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'CNY'::"text" NOT NULL,
    "platform_fee" numeric(10,2) DEFAULT 0,
    "host_earnings" numeric(10,2) DEFAULT 0,
    "traveler_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_reason" "text",
    "cancelled_by" "text"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."orders_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."orders_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."orders_id_seq" OWNED BY "public"."orders"."id";



CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "from_user_id" "uuid" NOT NULL,
    "to_user_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."reviews_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."reviews_id_seq" OWNED BY "public"."reviews"."id";



CREATE TABLE IF NOT EXISTS "public"."service_logs" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "event_type" "public"."service_log_type" NOT NULL,
    "actor_id" "uuid",
    "actor_role" "text",
    "message" "text",
    "location" "text",
    "latitude" numeric(9,6),
    "longitude" numeric(9,6),
    "attachment_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."service_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."service_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."service_logs_id_seq" OWNED BY "public"."service_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."settlements" (
    "id" bigint NOT NULL,
    "order_id" bigint NOT NULL,
    "host_id" "uuid" NOT NULL,
    "total_amount" numeric(10,2) NOT NULL,
    "platform_fee" numeric(10,2) NOT NULL,
    "host_earnings" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "payout_method" "text",
    "payout_ref" "text",
    "payout_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."settlements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."settlements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."settlements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."settlements_id_seq" OWNED BY "public"."settlements"."id";



ALTER TABLE ONLY "public"."order_status_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."order_status_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."orders_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."reviews" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."reviews_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."service_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."service_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."settlements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."settlements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."match_requests"
    ADD CONSTRAINT "match_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_status_logs"
    ADD CONSTRAINT "order_status_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_order_no_key" UNIQUE ("order_no");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_leancloud_user_id_key" UNIQUE ("leancloud_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_order_id_unique" UNIQUE ("order_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_logs"
    ADD CONSTRAINT "service_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trip_cards"
    ADD CONSTRAINT "trip_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_requests"
    ADD CONSTRAINT "match_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_requests"
    ADD CONSTRAINT "match_requests_trip_card_id_fkey" FOREIGN KEY ("trip_card_id") REFERENCES "public"."trip_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_profile_a_id_fkey" FOREIGN KEY ("profile_a_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_profile_b_id_fkey" FOREIGN KEY ("profile_b_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_request_a_id_fkey" FOREIGN KEY ("request_a_id") REFERENCES "public"."match_requests"("id");



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_request_b_id_fkey" FOREIGN KEY ("request_b_id") REFERENCES "public"."match_requests"("id");



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_trip_card_a_id_fkey" FOREIGN KEY ("trip_card_a_id") REFERENCES "public"."trip_cards"("id");



ALTER TABLE ONLY "public"."match_sessions"
    ADD CONSTRAINT "match_sessions_trip_card_b_id_fkey" FOREIGN KEY ("trip_card_b_id") REFERENCES "public"."trip_cards"("id");



ALTER TABLE ONLY "public"."order_status_logs"
    ADD CONSTRAINT "order_status_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_logs"
    ADD CONSTRAINT "service_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trip_cards"
    ADD CONSTRAINT "trip_cards_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE "public"."match_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_status_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trip_cards" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."match_sessions" TO "anon";
GRANT ALL ON TABLE "public"."match_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."match_sessions" TO "service_role";



GRANT ALL ON FUNCTION "public"."attach_conversation_to_session"("p_session_id" "uuid", "p_conversation_id" "text", "p_force" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."attach_conversation_to_session"("p_session_id" "uuid", "p_conversation_id" "text", "p_force" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_conversation_to_session"("p_session_id" "uuid", "p_conversation_id" "text", "p_force" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_match"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_match"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_match"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."trip_cards" TO "anon";
GRANT ALL ON TABLE "public"."trip_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."trip_cards" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_trip_card"("p_profile_id" "uuid", "p_destination_city" "text", "p_start_date" "date", "p_end_date" "date", "p_destination_country" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_trip_card"("p_profile_id" "uuid", "p_destination_city" "text", "p_start_date" "date", "p_end_date" "date", "p_destination_country" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_trip_card"("p_profile_id" "uuid", "p_destination_city" "text", "p_start_date" "date", "p_end_date" "date", "p_destination_country" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_profile_v2"("p_leancloud_user_id" "text", "p_supabase_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_profile_v2"("p_leancloud_user_id" "text", "p_supabase_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_profile_v2"("p_leancloud_user_id" "text", "p_supabase_user_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."match_requests" TO "anon";
GRANT ALL ON TABLE "public"."match_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."match_requests" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_match_request"("p_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_match_request"("p_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_match_request"("p_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_latest_match_session"("p_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_match_session"("p_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_match_session"("p_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."start_match"("p_profile_id" "uuid", "p_trip_card_id" "uuid", "p_preferred_gender" "text", "p_preferred_age_min" integer, "p_preferred_age_max" integer, "p_preferred_languages" "text"[], "p_city_scope_mode" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."start_match"("p_profile_id" "uuid", "p_trip_card_id" "uuid", "p_preferred_gender" "text", "p_preferred_age_min" integer, "p_preferred_age_max" integer, "p_preferred_languages" "text"[], "p_city_scope_mode" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_match"("p_profile_id" "uuid", "p_trip_card_id" "uuid", "p_preferred_gender" "text", "p_preferred_age_min" integer, "p_preferred_age_max" integer, "p_preferred_languages" "text"[], "p_city_scope_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."try_match"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."try_match"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."try_match"("p_request_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON FUNCTION "public"."update_profile_from_questionnaire"("p_profile_id" "uuid", "p_gender" "text", "p_age" integer, "p_first_language" "text", "p_second_language" "text", "p_home_city" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_profile_from_questionnaire"("p_profile_id" "uuid", "p_gender" "text", "p_age" integer, "p_first_language" "text", "p_second_language" "text", "p_home_city" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_profile_from_questionnaire"("p_profile_id" "uuid", "p_gender" "text", "p_age" integer, "p_first_language" "text", "p_second_language" "text", "p_home_city" "text") TO "service_role";



GRANT ALL ON TABLE "public"."order_status_logs" TO "anon";
GRANT ALL ON TABLE "public"."order_status_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."order_status_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_status_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_status_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_status_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."reviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."service_logs" TO "anon";
GRANT ALL ON TABLE "public"."service_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."service_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."service_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."service_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."service_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."settlements" TO "anon";
GRANT ALL ON TABLE "public"."settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."settlements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."settlements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."settlements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."settlements_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";





