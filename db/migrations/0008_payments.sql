-- Add payment intent and payment records, plus pending payment status.

DO $$
BEGIN
  ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mock',
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  status text NOT NULL DEFAULT 'requires_confirmation',
  idempotency_key text,
  client_secret text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_order_active_idx
  ON public.payment_intents(order_id)
  WHERE status IN ('requires_confirmation', 'created');

CREATE TABLE IF NOT EXISTS public.payments (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  intent_id bigint REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mock',
  provider_txn_id text,
  status text NOT NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_txn_key
  ON public.payments(provider_txn_id)
  WHERE provider_txn_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_intent_id bigint;

