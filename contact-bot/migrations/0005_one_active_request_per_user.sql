-- Enforce the bot's existing one-active-request-per-user rule at the database
-- level so concurrent /start commands cannot create duplicate active requests.
-- Fails loudly if production already contains duplicate active rows for a user;
-- reconcile those rows manually (see contact-bot/README.md) before re-running.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_one_active_per_user
  ON contact_requests(telegram_user_id)
  WHERE status IN ('awaiting_email','pending_payment','payment_verified');
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_one_active_per_user
  ON service_orders(telegram_user_id)
  WHERE status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified');
