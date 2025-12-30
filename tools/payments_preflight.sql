-- Payments v2 preflight checks (read-only).

-- Duplicate provider transaction IDs per provider.
SELECT provider, provider_txn_id, COUNT(*) AS dup_count
FROM payments
WHERE provider_txn_id IS NOT NULL
GROUP BY provider, provider_txn_id
HAVING COUNT(*) > 1;

-- Payments succeeded but orders not marked PAID.
SELECT o.id AS order_id, o.payment_status, p.id AS payment_id, p.created_at
FROM orders o
JOIN payments p ON p.order_id = o.id
WHERE p.status = 'succeeded' AND o.payment_status <> 'PAID'
ORDER BY p.created_at ASC;

-- Stuck payment intents.
SELECT id, order_id, status, updated_at
FROM payment_intents
WHERE status IN ('requires_confirmation', 'processing', 'requires_action')
ORDER BY updated_at ASC
LIMIT 50;

-- Failed webhook events backlog.
SELECT provider, COUNT(*) AS failed_count
FROM webhook_events
WHERE status = 'failed'
GROUP BY provider;

-- Refunds stuck in processing.
SELECT id, order_id, status, updated_at
FROM refunds
WHERE status = 'processing'
ORDER BY updated_at ASC
LIMIT 50;
