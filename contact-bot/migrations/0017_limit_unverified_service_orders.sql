-- Keep the Telegram channel subscription flow capped at three unverified orders per user.
-- Payment-linked orders remain in the review queue and cannot be cancelled as unpaid.
CREATE TRIGGER IF NOT EXISTS trg_service_orders_max_three_unverified_insert
BEFORE INSERT ON service_orders
WHEN NEW.status IN ('awaiting_request','awaiting_email','pending_payment')
  AND NEW.payment_reference IS NULL
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM service_orders
    WHERE telegram_user_id = NEW.telegram_user_id
      AND status IN ('awaiting_request','awaiting_email','pending_payment')
      AND payment_reference IS NULL
  ) >= 3 THEN RAISE(ABORT, 'max_three_unverified_service_orders') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_orders_max_three_unverified_update
BEFORE UPDATE OF status, payment_reference, telegram_user_id ON service_orders
WHEN NEW.status IN ('awaiting_request','awaiting_email','pending_payment')
  AND NEW.payment_reference IS NULL
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM service_orders
    WHERE telegram_user_id = NEW.telegram_user_id
      AND id <> NEW.id
      AND status IN ('awaiting_request','awaiting_email','pending_payment')
      AND payment_reference IS NULL
  ) >= 3 THEN RAISE(ABORT, 'max_three_unverified_service_orders') END;
END;
