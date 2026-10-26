-- FansLeak front-desk policy: allow up to three unpaid contact requests per
-- Telegram account. The Worker enforces the three-request cap and checks the
-- count before inserting. Keep the separate one-active-service-order guard.
DROP INDEX IF EXISTS idx_contact_requests_one_active_per_user;
