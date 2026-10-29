-- Durable delivery state for the informational "payment found" customer
-- message. This does not verify, approve, or fulfil any order: the configured
-- admin still has to check Selar and confirm payment manually.
ALTER TABLE processed_sales
  ADD COLUMN customer_notification_status TEXT NOT NULL DEFAULT 'pending'
  CHECK(customer_notification_status IN ('pending','sending','sent','failed','uncertain','cancelled'));

ALTER TABLE processed_sales
  ADD COLUMN customer_notification_attempts INTEGER NOT NULL DEFAULT 0
  CHECK(customer_notification_attempts >= 0);

ALTER TABLE processed_sales
  ADD COLUMN customer_notified_at TEXT;

ALTER TABLE processed_sales
  ADD COLUMN customer_notification_attempted_at TEXT;

ALTER TABLE processed_sales
  ADD COLUMN customer_notification_updated_at TEXT;

-- Existing rows have no trustworthy delivery evidence, so do not blind-retry
-- them. Service sales received before the PR #57 deployment window began are
-- the one safe exception: that production code had no service
-- payment-found customer message at all, so a still-pending service order can
-- be recovered exactly once by the new tracked sender.
UPDATE processed_sales
SET customer_notification_status='uncertain',
    customer_notification_updated_at=received_at;

UPDATE processed_sales
SET customer_notification_status='pending'
WHERE received_at < '2026-10-29T13:56:44Z'
  AND EXISTS (
    SELECT 1
    FROM service_orders
    WHERE service_orders.id = processed_sales.request_id
      AND service_orders.status = 'pending_payment'
      AND service_orders.payment_reference = processed_sales.provider_reference
  );

CREATE INDEX IF NOT EXISTS idx_processed_sales_customer_notification
  ON processed_sales(customer_notification_status, received_at);
