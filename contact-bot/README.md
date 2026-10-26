# FansLeak Telegram Bot

One Telegram bot supports two separate Selar products on a unified Cloudflare Worker with D1 storage. The incoming deep link chooses the customer flow; customers are never shown an ambiguous product menu.

**Core safety rule, enforced in code and tests:** a webhook, an email, an order code, or a customer tap can *never* verify a payment. Only the configured Telegram administrator can verify payment, and creator contact details are only sent when *all* of these are true for the same request and creator:

1. Payment was manually verified by the administrator (`status = 'payment_verified'`).
2. The administrator approves the specific request (`approve` callback).
3. Creator sharing consent is explicitly recorded (`creator_contacts.sharing_enabled = 1` **and** `consent_confirmed_at IS NOT NULL`) for that exact profile, re-checked immediately before the contact is sent.

Missing rows, failed queries, revoked consent, unknown statuses, and identity mismatches all fail closed (nothing is sent).

## Customer flows

### 1. FansLeak contact/assessment flow

1. The customer opens a creator profile's **Message / Request contact** button on FansLeak (`/start contact_PROFILE_ID`). Profile IDs containing `.` are encoded as `_dot_` because Telegram start parameters only allow `A–Z a–z 0–9 _ -`; the bot resolves both forms against the live catalogue.
2. The bot loads the public catalogue (see below), rejects unknown/malformed profile IDs, and refuses to create a second active request for the same Telegram user.
3. A unique `FL-XXXXXX` checkout code is generated, checked against both order tables, and stored on a `pending_payment` request. **No email is required to start checkout.**
4. The customer taps **Pay with Selar**, opens the configured checkout, and enters their full name followed by the exact code in Selar's **customer name field** (e.g. `Joseph Unaogu FL-7K4P9A`).
5. After checkout, the customer taps **Done** and sends the exact name + code they used. This only records `checkout_name`; it never confirms payment.
6. **Optional fallback email:** at any point the customer may send an email address. It is stored on their pending request, the admin is alerted, and it is only ever a *reconciliation clue*. Customers are told never to send passwords, PINs, or OTPs.
7. When the sale webhook arrives, the bot reconciles (code first, then a unique fallback email) and asks the admin to verify manually. If the webhook never arrives, the admin can verify with `/verify` after checking Selar directly (see Admin commands).
8. After payment verification, the admin separately approves or rejects. Approval sends the creator's contact only if creator consent is recorded (see the rule above).

### 2. Service order flow (fully separate)

1. The customer opens `https://t.me/<BOT_USERNAME>?start=service_SERVICE_ID`.
2. The bot creates a `service_orders` row (with its own `FL-XXXXXX` code) and the assistant chats to understand the request. The code is shown when the customer types `PAY` and receives the service checkout link.
3. Checkout, **Done**, fallback email, webhook reconciliation, and manual verification (`serviceverify:` callback or `/verifyservice`) mirror the contact flow but only ever touch `service_orders`.
4. After manual payment verification, the admin delivers with `/deliver ORDER_ID fulfilment text`. Delivery is a single status-claimed send; if Telegram delivery fails the order reverts to `payment_verified` so the admin can retry. Service orders never release creator contacts, and contact callbacks never mutate service orders (covered by tests).

---

## Public catalogue and privacy

- `scripts/generate-contact-catalogue.mjs` runs in the site `prebuild` and writes `public/contact-catalogue.json` from the visible site profiles. Entries contain **only** `{ id, name }` — stable public profile ID and display name. New profiles appear automatically on the next site build; there is no separate hardcoded creator list in the bot.
- The bot fetches `${SITE_URL}/contact-catalogue.json` at request time, validates each entry, and only ever carries `id` + `name` into bot logic. Creator Telegram handles live exclusively in the private D1 `creator_contacts` table and are never present in public JSON, client bundles, pre-approval messages, webhook responses, or logs.
- To regenerate manually: `node scripts/generate-contact-catalogue.mjs` (then commit the result; `npm test` fails if the committed catalogue drifts from the source profiles). Output is deterministic except for the `generatedAt` timestamp.
- Regenerate + verify locally with: `npm test` (includes catalogue privacy, completeness, handle-leak, and Telegram start-parameter tests).

---

## Configuration

Never commit secret values. The names below are the complete set the code reads.

### Worker secrets (set with `wrangler secret put`, or by the deploy workflow)

| Name | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Bot API token. Never logged. |
| `TELEGRAM_WEBHOOK_SECRET` | Expected `x-telegram-bot-api-secret-token` header on `/telegram/webhook`. Required; the endpoint fails closed without it. Must match Telegram's `secret_token` rules (`A–Z a–z 0–9 _ -`, 1–256 chars). |
| `ADMIN_TELEGRAM_ID` | The single Telegram user ID allowed to verify/approve/deliver/manage contacts. Sale webhooks return `503 admin_not_configured` until this is set. |
| `SELAR_WEBHOOK_SECRET` | Expected `x-selar-webhook-secret` header on both Selar webhook endpoints (constant-time compared). Required; endpoints fail closed without it. |
| `SELAR_CHECKOUT_URL`, `SELAR_PRODUCT_ID` | Contact product checkout URL and exact Selar product code. |
| `SERVICE_CHECKOUT_URL`, `SERVICE_PRODUCT_ID` | Service product checkout URL and exact product code (must differ from the contact product). |

### Worker variables (`contact-bot/wrangler.toml`, non-secret)

`SITE_URL` (catalogue origin), `PAYMENT_PROVIDER=selar`, `PAYMENT_METHODS=selar`, `AI_MODEL`, plus the `DB` (D1) and `AI` (Workers AI, optional — the bot works without it) bindings.

### GitHub / site configuration

- Repository Actions secrets used by `.github/workflows/deploy-contact-bot.yml`: `CLOUDFLARE_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, `SELAR_WEBHOOK_SECRET`. The four Selar product URLs/codes are `workflow_dispatch` inputs, validated before any production change.
- Cloudflare Pages-variable `VITE_TELEGRAM_BOT_USERNAME` (public bot username, no `@`) controls the website button. It defaults in code when unset. See `.env.example`.

### Supported products

- Contact checkout: `https://selar.com/j977zh71q8` (product code `j977zh71q8`)
- Service checkout: `https://selar.com/x19128f988` (product code `x19128f988`)
- Duplicate/test product code `b9e1878f99` was deleted by the owner and must never be configured. Product *display names* are never used as identifiers — only exact product codes.

---

## Webhooks (Selar via Zapier)

Both endpoints require header `x-selar-webhook-secret: <SELAR_WEBHOOK_SECRET>`, reject oversized bodies (>64 KiB, `413`), malformed JSON (`400`), wrong products (`422`), and events that explicitly report a non-paid status (`failed`, `refunded`, `pending`, … → `422 unsupported_event` + admin alert). Amount/currency are never used to match or verify.

### `POST /webhooks/selar` — new sale

Accepted field aliases (Zapier should pass the Selar values through under any one of each group):

| Bot field | Accepted payload keys |
| --- | --- |
| Unique sale reference (required, dedup key) | `reference`, `transaction_reference`, `transactionReference`, `sale_reference`, `saleReference`, `receipt_url`, `receiptUrl` |
| Customer name incl. `FL-XXXXXX` code (required) | `customer_full_name`, `buyer_full_name`, `customer_name`, `full_name`, `fullName`, `name`, `customer.name` |
| Exact product code (required, single product only) | `product_code`, `productCode`, `all_product_codes`, `allProductCodes` |
| Buyer email (optional clue) | `email`, `buyer_email`, `customer_email`, `customerEmail`, `customer.email` |

Processing: route by exact product code → extract code with `/\bFL-[A-Z0-9]{6}\b/i` → match the unique `pending_payment` order (name must also match if the customer confirmed a checkout name) → otherwise try a **unique** fallback-email match. Ambiguous, missing, or mismatched matches return `200 { matched: false, reason }`, alert the admin, and change nothing. A matched sale attaches `payment_reference` (status stays `pending_payment`), records `processed_sales` with `INSERT OR IGNORE` (duplicate deliveries return `{ duplicate: true }` with no repeated alerts), and sends the admin a **Confirm payment manually** prompt. If processing fails after the dedup marker is written, the marker is removed so a sender retry can reprocess, and the admin is alerted.

### `POST /webhooks/selar-abandoned-cart`

Required: customer name (aliases above) containing the code, exact product code (aliases above), and a parseable `abandoned_at` timestamp. Events are deduplicated by a SHA-256 key in `processed_abandoned_carts`; a reminder is sent only for a uniquely matched still-pending order, and it never contains creator contact details or claims a payment was received.

### Zapier operational notice (action required outside this repo)

The live Zap is ON but appends rows to Zapier Tables; it does **not** POST to this Worker yet. Add Webhooks-by-Zapier POST steps to:

- `https://fansleak-contact-bot.<subdomain>.workers.dev/webhooks/selar`
- `https://fansleak-contact-bot.<subdomain>.workers.dev/webhooks/selar-abandoned-cart`

…each with header `x-selar-webhook-secret` and the field mapping above. Until then, use `/verify` / `/verifyservice` (below) — payments checked in the Selar dashboard never need to wait for Zapier.

### `POST /telegram/webhook` and `GET /health`

Telegram updates require the `x-telegram-bot-api-secret-token` header to match `TELEGRAM_WEBHOOK_SECRET`; bodies over 256 KiB are rejected. Handling errors are logged without tokens and the endpoint still returns `200` so Telegram does not redeliver updates into duplicate orders. `GET /health` returns `{ ok, service, provider, methods }` only.

---

## Admin commands (only `ADMIN_TELEGRAM_ID`; everyone else is rejected)

- `/help` — list these commands.
- `/pending` — contact requests awaiting payment verification/final approval (shows status, order code, and whether a sale reference is attached).
- `/orders` — recent service orders (request text stays hidden until payment is verified).
- `/verify REQUEST_UUID SELAR_REFERENCE` — manually verify a **contact** payment after checking it in Selar. Sets `payment_verified`, records the reference in `processed_sales` (so one reference can never verify two orders and a late webhook becomes a duplicate), audits the action, and offers Approve/Reject. It does **not** approve or send contact details.
- `/verifyservice ORDER_UUID SELAR_REFERENCE` — same for a **service** order.
- Inline buttons on webhook alerts: **Confirm payment manually** (`selarverify:` / `serviceverify:`), then **Approve & send contact** / **Reject** for contact requests. All are idempotent; repeats are no-ops.
- `/deliver ORDER_UUID fulfilment text` — send fulfilment for a `payment_verified` service order (exactly-once claim, retry-safe on Telegram failure).
- `/setcontact PROFILE_ID @handle` — store a creator's Telegram handle with sharing **disabled** and any previous consent cleared.
- `/enablecontact PROFILE_ID` — record the admin's attestation that the creator *explicitly authorised* sharing this contact; sets `sharing_enabled = 1` and `consent_confirmed_at`.
- `/disablecontact PROFILE_ID` — immediately revoke sharing (`sharing_enabled = 0`, `consent_confirmed_at = NULL`). Future approvals fail closed, including an approval already in flight (consent is re-checked just before sending).

Every verification, approval, rejection, consent change, and fulfilment writes an `admin_audit` row (admin ID, action, request/order + profile IDs, details incl. payment reference where relevant, timestamp).

Reviewing ambiguous sales: the admin alert states the reason (`name_mismatch`, `ambiguous_match`, `ambiguous_email_match`, `missing_order_code`, `no_matching_pending_order`, wrong product, non-paid status). Confirm the real payment in Selar, find the intended request via `/pending` / `/orders` (match the `FL-XXXXXX` code, never the amount), then `/verify …` with the exact Selar reference. Emails shown in alerts are customer-provided clues, never proof.

---

## D1 schema and migrations

Baseline `contact-bot/schema.sql` (`0001_baseline`) plus ordered migrations:

| Version | File | Contents |
| --- | --- | --- |
| `0002_service_orders` | `contact-bot/migrations/0002_service_orders.sql` | `service_orders` table + indexes |
| `0003_abandoned_carts` | `contact-bot/migrations/0003_abandoned_carts.sql` | `processed_abandoned_carts` dedup table |
| `0004_checkout_codes` | `contact-bot/migrations/0004_checkout_codes.sql` | `checkout_code`/`checkout_name` columns, per-table unique code indexes, `checkout_name_prompts`. **Non-idempotent as a raw file** (bare `ALTER TABLE`s) — always apply through `scripts/migrate-d1.mjs`, which checks `PRAGMA table_info` first. Tests apply it directly only to fresh databases. |
| `0005_one_active_request_per_user` | `contact-bot/migrations/0005_one_active_request_per_user.sql` | Partial unique indexes: one active contact request / service order per Telegram user. Blocks with a clear error if duplicate active rows already exist; reconcile manually (keep the newest legitimate request, reject/cancel the rest), then re-run. |

Apply/inspect with `node scripts/migrate-d1.mjs --remote` (requires Wrangler auth; used by the deploy workflow *before* the Worker deploy, so a failed migration leaves the old Worker running). It tracks applied versions in `schema_migrations` and verifies all 7 tables, expected columns, and the unique indexes afterwards. Applied versions can be inspected read-only:

```bash
npx wrangler@4 d1 execute fansleak-contact-requests --remote \
  --config contact-bot/wrangler.toml \
  --command "SELECT version, applied_at FROM schema_migrations ORDER BY version"
```

Duplicate-active pre-check for `0005` (repeat for `service_orders` with its active statuses `awaiting_request, awaiting_email, pending_payment, payment_verified`):

```sql
SELECT telegram_user_id, COUNT(*) FROM contact_requests
WHERE status IN ('awaiting_email','pending_payment','payment_verified')
GROUP BY telegram_user_id HAVING COUNT(*) > 1;
```

Local schema logic lives in `scripts/lib/db-migrations.mjs` and is exercised by `tests/migration.test.mjs` (fresh, partial, and repeat migrations against real SQLite).

---

## Tests and validation

```bash
npm ci
npm test                    # catalogue + migration + full bot integration suite (real in-memory SQLite)
npx tsc --noEmit            # website + bot + tests type-check
npx wrangler@4 deploy --dry-run --outdir /tmp/fansleak-contact-bot-build --config contact-bot/wrangler.toml
npm run build               # website production build (regenerates catalogue + sitemap, prerenders, SEO check)
```

CI (`.github/workflows/check-contact-bot.yml`) runs the test suite, `tsc`, and the Wrangler dry-run on pull requests and on pushes to `fan` for bot/catalogue/test/config changes. It needs no production secrets and never deploys.

---

## Production rollout (performed separately by the owner — NOT done by code changes alone)

1. Merge the reviewed PR into `fan`.
2. Run **Actions → Deploy FansLeak contact bot → Run workflow** *from `fan`*, entering both Selar checkout URLs and exact product codes. It preflights secrets, applies migrations (including `0005`) with verification, deploys the Worker, writes Worker secrets, and reconnects the Telegram webhook. If the `0005` pre-check reports duplicate active rows, reconcile them as described above and re-run.
3. In Zapier, add the two POST steps described in the webhook section (sale + abandoned cart) with the shared secret header; send test events and confirm the admin receives reconciliation prompts (and that nothing auto-verifies).
4. Confirm Cloudflare Pages serves the rebuilt site (fresh `contact-catalogue.json`, Message buttons) and that `VITE_TELEGRAM_BOT_USERNAME` matches the live bot if it ever changes.
5. Smoke-test with the owner's own Telegram account: start a contact request from a profile (including a dotted-ID profile), confirm the code/instructions, and verify no creator handle appears anywhere before admin approval. Only store/enable a creator contact (`/setcontact`, then `/enablecontact`) after that creator has explicitly authorised sharing.
6. Make a real low-value Selar purchase using the name + code format; confirm webhook reconciliation → manual verification → approval → single contact delivery, and that duplicate webhook deliveries are ignored.
