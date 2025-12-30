-- Payments v2: webhook events, payment attempts, refunds, and audit fields.

CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  intent_id bigint REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mock',
  status text NOT NULL,
  amount numeric(10,2),
  currency text DEFAULT 'CNY',
  idempotency_key text,
  error_code text,
  error_message text,
  request_id text,
  actor_id uuid,
  actor_role text,
  actor_ip text,
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_intent_idempotency_idx
  ON public.payment_attempts(intent_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_attempts_order_idx
  ON public.payment_attempts(order_id);

CREATE INDEX IF NOT EXISTS payment_attempts_status_idx
  ON public.payment_attempts(status, created_at);

CREATE TABLE IF NOT EXISTS public.refunds (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  payment_id bigint REFERENCES public.payments(id) ON DELETE SET NULL,
  intent_id bigint REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mock',
  provider_refund_id text,
  status text NOT NULL DEFAULT 'requested',
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  reason text,
  idempotency_key text,
  requested_by uuid,
  requested_role text,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  last_error text,
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS refunds_provider_refund_key
  ON public.refunds(provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS refunds_order_idempotency_idx
  ON public.refunds(order_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS refunds_order_idx
  ON public.refunds(order_id);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb,
  signature text,
  status text NOT NULL DEFAULT 'received',
  retry_count integer NOT NULL DEFAULT 0,
  last_error text,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  order_id bigint REFERENCES public.orders(id) ON DELETE SET NULL,
  intent_id bigint REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  payment_id bigint REFERENCES public.payments(id) ON DELETE SET NULL,
  refund_id bigint REFERENCES public.refunds(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_event_key
  ON public.webhook_events(provider, event_id);

CREATE INDEX IF NOT EXISTS webhook_events_status_idx
  ON public.webhook_events(status, received_at);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS refund_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_payment_attempt_status text,
  ADD COLUMN IF NOT EXISTS last_payment_attempt_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS provider_intent_id text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS captured_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS settled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.order_status_logs
  ADD COLUMN IF NOT EXISTS request_id text,
  ADD COLUMN IF NOT EXISTS actor_ip text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_order_idempotency_idx
  ON public.payment_intents(order_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_order_idx
  ON public.payments(order_id);
