# FansLeak Telegram Bot

One Telegram bot supports two separate Selar products on a unified Cloudflare Worker with D1 storage. The incoming deep link chooses the customer flow; customers are never shown an ambiguous product menu.

## Customer flows

### 1. FansLeak contact/assessment flow
1. The customer opens a creator profile's **Message / Request contact** button on FansLeak (or opens `/start contact_PROFILE_ID` in Telegram).
2. The bot generates a unique checkout code (e.g. `FL-7K4P9A`) with collision-exhaustion safety, persisting the pending order.
3. The bot sends the Selar checkout instructions with direct link and **Done** button.
4. **Optional Email Clue:** The customer can optionally send their email in Telegram at any time as a fallback reconciliation clue (`contact_requests.buyer_email`).
5. The customer enters their full name followed by the exact code in Selar's **customer name field** at checkout (e.g. `Joseph Unaogu FL-7K4P9A`).
6. After checkout, the customer returns to the bot and taps **Done** to confirm their submitted checkout name.
7. When Selar's New Sale event arrives, the bot reconciles the order by code (or unique fallback email if code is missing/mismatched).
8. **Admin Verification Exclusivity:** The bot notifies the admin with inline review buttons. Payments are **never** verified automatically.
9. **Separate Creator Authorization:** Even after payment verification, contact sharing remains blocked until explicit creator authorization is recorded.

### 2. Service order flow
1. The customer opens `https://t.me/KasiQueenbot?start=service_SERVICE_ID`.
2. The AI assistant chats with the customer to understand their service request.
3. When ready, the customer types `PAY`. The bot creates a unique checkout code and sends the service checkout link.
4. **Optional Email Clue:** The customer can optionally send their email in Telegram as a fallback reconciliation clue (`service_orders.buyer_email`).
5. The customer completes checkout on Selar with their full name and order code in the customer name field.
6. The customer returns to the bot and taps **Done**.
7. When Selar's New Sale event arrives, the bot reconciles the order by code (or unique fallback email).
8. The admin is notified to review and confirm payment manually via inline callback (`serviceverify:ORDER_ID`).
9. **Fulfilment:** Only after manual payment confirmation can the admin deliver service results using `/deliver ORDER_ID fulfilment details`. If delivery fails, state remains recoverable so the admin can retry.

---

## Profile Catalogue and Privacy Guarantees

- **Public Catalogue (`public/contact-catalogue.json`):**
  - Generated dynamically from visible site profiles by `scripts/generate-contact-catalogue.mjs`.
  - Exposes **only** public fields `{ id, name }`.
  - Creator handles, private social links, and phone numbers are **strictly excluded** from public JSON and client-side bundles.
- **Private Contact Storage:**
  - Creator contact handles are stored exclusively in private Cloudflare D1 storage (`creator_contacts` table) with `sharing_enabled = 0` by default.
  - Releasing contact details requires:
    1. Manually verified payment (`status = 'payment_verified'`).
    2. Genuine explicit creator consent (`sharing_enabled = 1` and `consent_confirmed_at IS NOT NULL`).
    3. Administrative approval action.
  - Revoking consent via `/disablecontact` immediately sets `sharing_enabled = 0` and nullifies `consent_confirmed_at`, blocking all release attempts.

---

## Stable Product Identifiers & Selar Integration

### Supported Products
- **Contact checkout:** `https://selar.com/j977zh71q8` (Product code: `j977zh71q8`)
- **Service checkout:** `https://selar.com/x19128f988` (Product code: `x19128f988`)
- **Test Products:** Duplicate/test product code `b9e1878f99` was deleted by the owner and must **never** be used. Product display names are intentionally not used as identifiers.

### Webhook Endpoints & Supported Payloads
All webhooks require the `x-selar-webhook-secret` header matching `SELAR_WEBHOOK_SECRET` via constant-time comparison (`safeEq`).

1. **New Sale (`/webhooks/selar`):**
   - Supported fields:
     - `reference`: unique Selar transaction/sale reference or receipt URL (`reference`, `transaction_reference`, `sale_reference`, `receipt_url`)
     - `customer_full_name`: customer name containing the `FL-XXXXXX` code (`customer_full_name`, `buyer_full_name`, `customer_name`, `name`)
     - `product_code`: exact product code (`product_code`, `all_product_codes`)
     - `buyer_email`: customer email (`email`, `buyer_email`, `customer_email`)
   - Normalization logic extracts order codes matching `/\bFL-[A-Z0-9]{6}\b/i`.
   - If the code is missing or mismatched, candidate orders are matched by unique fallback email.
   - Ambiguous matches (multiple pending orders sharing the same code or fallback email) fail closed (`ambiguous_match` / `ambiguous_email_match`) and alert the admin.
   - Duplicate sales are deduplicated via atomic `INSERT OR IGNORE INTO processed_sales`.

2. **Abandoned Cart (`/webhooks/selar-abandoned-cart`):**
   - Supported fields:
     - `customer_name`: customer name with order code (`customer_full_name`, `buyer_full_name`, `customer_name`)
     - `product_code`: exact product code
     - `abandoned_at`: ISO timestamp
   - Deduplicated using SHA-256 event keys in `processed_abandoned_carts`.
   - Sends a single reminder only when a pending order is uniquely matched.

### Missing Zapier Step (Operational Notice)
The current live Zapier Zap is ON, but its action is configured to append rows to "Zapier Tables". It does not currently POST events to the Cloudflare Worker. To complete the live connection, an external HTTP POST step must be configured in Zapier:
- URL: `https://fansleak-contact-bot.<subdomain>.workers.dev/webhooks/selar`
- Header: `x-selar-webhook-secret: <SELAR_WEBHOOK_SECRET>`
- Body: Pass through Selar event fields (`reference`, `customer_full_name`, `buyer_email`, `all_product_codes`).

---

## Payment Rules & Security Guardrails

- **Admin-Only Verification:** Webhooks, customer taps, and customer-submitted codes **never** verify payments automatically. Only an authenticated administrator in Telegram can confirm payment.
- **Price and Amount Ignored:** Payment amount, currency, and prices are never used to match orders or verify payments.
- **Failed Telegram Delivery Recovery:** If Telegram message delivery fails during fulfilment (`/deliver`) or approval (`approve`), order status is reverted so the admin can safely retry.
- **Privacy in Logs:** Creator contact information and private customer details are never exposed in log outputs or audit summaries.
- **Code Collision Safety:** Checkout code generation fails safely after 10 retry attempts without returning an unchecked code.

---

## D1 Database Migrations & Deployment

Migrations are tracked and verified via `scripts/migrate-d1.mjs`:
- `0001_baseline`: `contact-bot/schema.sql` (baseline tables and indexes)
- `0002_service_orders`: `contact-bot/migrations/0002_service_orders.sql`
- `0003_abandoned_carts`: `contact-bot/migrations/0003_abandoned_carts.sql`
- `0004_checkout_codes`: Idempotently inspects `PRAGMA table_info` before executing non-idempotent `ALTER TABLE` statements, preventing duplicate column errors.
- **Schema Verification:** Verifies all 7 required tables and their expected column schemas upon completion.

The GitHub Actions deployment workflow (`.github/workflows/deploy-contact-bot.yml`) is manual (`workflow_dispatch`) and runs preflight checks on all required secrets:
`CLOUDFLARE_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, and `SELAR_WEBHOOK_SECRET`.

---

## Admin Commands Reference

All administrative commands require the Telegram user ID to match `ADMIN_TELEGRAM_ID`:

- `/pending` — List pending contact requests awaiting payment verification or approval.
- `/orders` — List service orders awaiting payment verification or fulfilment.
- `/deliver ORDER_ID details` — Send fulfilment details to a service customer (only valid for verified orders).
- `/setcontact PROFILE_ID @handle` — Store a creator's Telegram handle with sharing disabled.
- `/enablecontact PROFILE_ID` — Record administrator attestation that the creator explicitly authorized contact sharing and enable sharing.
- `/disablecontact PROFILE_ID` — Immediately disable sharing and revoke creator consent attestation.
