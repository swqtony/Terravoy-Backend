-- Orders system schema (orders, logs, reviews, settlements)

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM (
      'PENDING_HOST_CONFIRM',
      'CONFIRMED',
      'IN_SERVICE',
      'COMPLETED',
      'CANCELLED_REFUNDED',
      'CANCELLED_BY_TRAVELER',
      'DISPUTED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM (
      'UNPAID',
      'PAID',
      'REFUNDING',
      'REFUNDED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_log_type') THEN
    CREATE TYPE service_log_type AS ENUM (
      'START',
      'END',
      'NOTE'
    );
  END IF;
END $$;

-- Tables
CREATE TABLE IF NOT EXISTS public.orders (
  id               bigserial PRIMARY KEY,
  order_no         text UNIQUE NOT NULL,

  traveler_id      uuid NOT NULL,
  host_id          uuid NOT NULL,
  experience_id    text NOT NULL,

  start_time       timestamptz NOT NULL,
  end_time         timestamptz,
  people_count     integer NOT NULL DEFAULT 1,

  status           order_status NOT NULL DEFAULT 'PENDING_HOST_CONFIRM',
  payment_status   payment_status NOT NULL DEFAULT 'UNPAID',

  total_amount     numeric(10,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'CNY',

  platform_fee     numeric(10,2) DEFAULT 0,
  host_earnings    numeric(10,2) DEFAULT 0,

  traveler_note    text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  confirmed_at     timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,

  cancelled_reason text,
  cancelled_by     text
);

CREATE TABLE IF NOT EXISTS public.order_status_logs (
  id           bigserial PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  from_status  order_status,
  to_status    order_status NOT NULL,

  actor_id     uuid,
  actor_role   text,

  reason       text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_logs (
  id            bigserial PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  event_type    service_log_type NOT NULL,

  actor_id      uuid,
  actor_role    text,

  message       text,

  location      text,
  latitude      numeric(9,6),
  longitude     numeric(9,6),

  attachment_url text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reviews (
  id             bigserial PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

  from_user_id   uuid NOT NULL,
  to_user_id     uuid NOT NULL,

  rating         integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz,

  CONSTRAINT reviews_order_id_unique UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS public.settlements (
  id             bigserial PRIMARY KEY,

  order_id       bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  host_id        uuid NOT NULL,

  total_amount   numeric(10,2) NOT NULL,
  platform_fee   numeric(10,2) NOT NULL,
  host_earnings  numeric(10,2) NOT NULL,

  status         text NOT NULL DEFAULT 'PENDING', -- PENDING / PAID / FAILED
  payout_method  text,
  payout_ref     text,
  payout_at      timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now()
);
