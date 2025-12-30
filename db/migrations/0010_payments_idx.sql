-- Add composite unique index for payments(provider, provider_txn_id)
-- This replaces the previous single-column index on provider_txn_id if we want multi-provider support with potentially colliding IDs (unlikely but safe).
-- Actually, the previous index was: payments_provider_txn_key ON public.payments(provider_txn_id)

-- Drop the old index if strict provider scoping is needed.
DROP INDEX IF EXISTS public.payments_provider_txn_key;

-- Create the new composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_txn_composite_idx
  ON public.payments(provider, provider_txn_id)
  WHERE provider_txn_id IS NOT NULL;
