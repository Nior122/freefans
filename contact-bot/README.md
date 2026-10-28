# FansLeak Telegram Bot

One Telegram bot supports two separate Selar products on a unified Cloudflare Worker with D1 storage. Profile deep links open the selected model request; a direct `/start` opens Annie's welcome and service menu. The menu routes channel subscriptions to the separate service product.

**Core safety rule, enforced in code and tests:** a webhook, an email, an order code, a customer tap, a customer saying they paid, or a submitted receipt can *never* verify a payment. Only the configured Telegram administrator can verify payment. There is **no creator contact to store, authorize, or share**. A verified profile request is fulfilled only when both of these are true for the same request:

1. Payment was manually verified by the administrator (`status = 'payment_verified'`).
2. The administrator prepares their own delivery message and/or media for that exact customer and explicitly confirms sending it.

The Worker does not append anything from the legacy `creator_contacts` table. Missing rows, failed queries, unknown statuses, and identity mismatches fail closed (nothing is sent).

## Customer flows

### 1. FansLeak profile-request/assessment flow

1. Customers browse profile photo previews on the FansLeak website. The profile **Subscribe** button opens the Telegram bot with that profile's stable ID in `/start contact_PROFILE_ID`, so Annie can greet the customer with the selected model and generate the existing unique checkout code. Profile IDs containing `.` are encoded as `_dot_` because Telegram start parameters only allow `A–Z a–z 0–9 _ -`; the bot resolves both forms against the live catalogue.
2. The bot loads the public catalogue (see below), rejects unknown/malformed profile IDs, and permits up to three unpaid contact requests per Telegram user; contact and service purchases are independent.
3. A unique `FL-XXXXXX` checkout code is generated, checked against both order tables, and stored on a `pending_payment` request. **No email is required to start checkout.**
4. The customer taps **Pay with Selar**, opens the configured checkout, and enters their full name followed by the exact code in Selar's **customer name field** (e.g. `John Doe FL-7K4P9A`).
5. After checkout, the customer taps **Done** or **I've paid — check for my sale** (or sends `/paid` / “I have paid”). The bot first checks the existing backend records. If no sale is attached and the checkout name has not been recorded, it asks for the exact name + code; that only records `checkout_name` and never confirms payment.
6. **Optional email:** at any point the customer may send an email address. It may be stored on their pending request as audit information and shown to the admin, but it can never match, attach, verify, or approve an order. Customers are told never to send passwords, PINs, or OTPs.
7. When the sale webhook arrives, the bot attaches it for admin review only if either (a) the supplied checkout code identifies exactly one pending order and any saved checkout name agrees with the supplied name, or (b) no checkout code was supplied and the distinctive full customer name exactly matches one saved checkout name after case/whitespace normalization. A supplied code that belongs to a different order is conflicting evidence and blocks name-only attachment. Full-name matching never uses partial names and must be unique. Email and price are never used as matching criteria. Unmatched or ambiguous webhook events return without an unsolicited admin notification. If the customer taps a paid-check button and no sale is attached, the receipt-review fallback below asks for a Selar receipt; the admin must check Selar directly before using `/verify`.
8. After manual payment verification, the admin separately prepares the customer's fulfilment. The customer receives only the message, media, or other content the admin composed in the delivery draft and explicitly confirmed; no creator contact is added.

### Front-desk conversation and request limits

- Customers can continue chatting while any profile request is pending. The assistant receives a small read-only summary of that Telegram user's own recent requests and service orders, so it can explain saved statuses without exposing other customers' data or private creator information.
- Up to **three unpaid profile requests** may be open per Telegram account. A request in `awaiting_email` or `pending_payment` counts toward the limit. Once an admin manually verifies payment, that request no longer counts toward the three unpaid slots; payment verification and delivery remain separate manual steps.
- At the limit, the bot offers inline **🔎 Check** buttons for the customer's own pending requests instead of a cold block. Each request's checkout instructions also include a **🔎 I've paid — check again** button.
- Messages such as “I've paid, please check again” invoke the deterministic paid-claim handler, which re-reads the customer's saved order and attached sale reference. The AI cannot verify payment or run arbitrary commands. If no sale is attached, the existing name/receipt/admin reconciliation path is used; repeated claims do not themselves mark payment verified.
- Contact requests are independent records with separate codes and statuses. Service-order creation and its one-active-order constraint remain separate.

## 2. Service order flow (fully separate)

1. A customer who opens the bot directly sees Annie's welcome message and the **👀 View our services 🔞** button. The service menu explains the website's photo-only model previews and the Telegram channel subscription.
2. The website button opens `https://fansleak.pages.dev`. The channel **🔥 Join now — Subscribe** button creates a `service_orders` row with service ID `telegram_channel`, assigns a unique `FL-XXXXXX` code, and immediately shows the configured `SERVICE_CHECKOUT_URL` checkout plus the existing payment-check buttons. The release workflow should configure this product as `https://selar.com/x19128f988` with its matching product code.
3. Admin notifications and `/orders` / `/order` inspection distinguish the source: profile requests are from the FansLeak website's model Subscribe button; channel subscriptions are from Telegram → View our services → Subscribe. The two product routes remain separate and payment is still verified manually.
3. Checkout, **Done**, **I've paid**, optional email audit information, webhook reconciliation, receipt review, and manual verification (`serviceverify:` callback or `/verifyservice`) mirror the profile-request flow but only ever touch `service_orders`.
4. After manual payment verification, the admin enters `/deliver FL-XXXXXX [fulfilment text]` or uses the full service-order UUID. This opens the one editable service-fulfilment composer for 30 minutes; the admin can then send/replace ordinary text and attach one Telegram photo, video, or PDF/image document. A media caption is the service-ready header plus the fulfilment text and is rejected before any send claim if it exceeds Telegram's 1024-character caption limit. The admin must preview the draft and tap **Confirm and send**; the order remains `payment_verified` until Telegram accepts the send. Confirmed sends are status-claimed and audited. If Telegram's response is uncertain, the draft remains locked as `sending` to prevent a blind duplicate; `/drafts` provides the audited stale-lock recovery path described below. Service fulfilment is separate from profile-request delivery, and callbacks for one flow never mutate the other (covered by tests).

### Paid-claim and Selar receipt-review fallback

This fallback is used only after the customer claims payment through **Done**, **I've paid — check for my sale**, `/paid`, or an equivalent short “I have paid” message:

1. The bot loads only that Telegram user's current contact request or service order and checks both its attached `payment_reference` and `processed_sales.request_id`.
2. If a backend sale is already attached, the customer is told that it is in the existing manual-verification queue. **No receipt is requested** and no duplicate admin prompt is created.
3. If the order is already `payment_verified`, the customer is told that manual verification has already happened and which existing next step applies. Receipts are not accepted for closed/completed orders.
4. If no backend sale is attached and `checkout_name` is missing, the bot first collects the exact Selar checkout name + `FL-XXXXXX` code. After that, it checks the backend records again.
5. Only if there is still no attached sale does it create a `receipt_review_prompts` row and ask the customer, in their private bot chat, to forward the Selar receipt as a Telegram photo or a PDF/JPG/PNG/WebP document (20 MB maximum based on Telegram's reported size).
6. The Worker re-checks for a sale immediately before accepting and again immediately before forwarding, so a late Selar/Zapier sale supersedes the receipt path. It sends the Telegram `file_id` directly to `ADMIN_TELEGRAM_ID` with the order UUID, flow, public profile/service ID, checkout code/name, saved email clue, Telegram user context, submission ID, and the exact `/verify …` or `/verifyservice …` command for use *only after* checking Selar.
7. `payment_receipt_submissions` records delivery state (`forwarding`, `forwarded`, `delivery_failed`, or `superseded`) and Telegram file identifiers only — not receipt contents, filenames, captions, or OCR text. Unique indexes on `(telegram_user_id, telegram_message_id)` and `(order_id, telegram_file_unique_id)`, plus a status-claimed forward, make duplicate updates and retries idempotent. A Telegram delivery failure leaves the prompt open and the submission retryable.
8. A forwarded receipt is evidence only. It never sets `payment_reference`, `payment_verified`, `approved`, or `fulfilled`, and it never bypasses manual payment verification or the admin's separate delivery confirmation.

Receipts are accepted only in a private chat (`chat_id` matching the sender). Unsupported files are rejected without creating a submission. Logs contain only sanitized Telegram delivery errors; bot tokens, captions, filenames, and file contents are not logged.

---

## Public catalogue and privacy

- `scripts/generate-contact-catalogue.mjs` runs in the site `prebuild` and writes `public/contact-catalogue.json` from the visible site profiles. Entries contain **only** `{ id, name }` — stable public profile ID and display name. New profiles appear automatically on the next site build; there is no separate hardcoded creator list in the bot.
- The bot fetches `${SITE_URL}/contact-catalogue.json` at request time, validates each entry, and only ever carries `id` + `name` into bot logic. Clients cannot list those profiles in the bot; only the configured admin can use `/profiles` in the private Admin Desk chat. The legacy D1 `creator_contacts` table may still exist for historical schema compatibility, but the Worker no longer reads or writes it for request delivery and no new creator contact should be stored there.
- To regenerate manually: `node scripts/generate-contact-catalogue.mjs` (then commit the result; `npm test` fails if the committed catalogue drifts from the source profiles). Output is deterministic except for the `generatedAt` timestamp.
- Regenerate + verify locally with: `npm test` (includes catalogue privacy, completeness, handle-leak, and Telegram start-parameter tests).

### Profile hiding is not physical deletion

`/hideprofile` (and its legacy `/deleteprofile` alias) stores a reversible override in D1. The Worker excludes that ID from Telegram requests, the website removes it from listings/search, and the direct website profile route waits for the visibility result and redirects hidden IDs home instead of rendering the profile first. A visibility-service outage is deliberately fail-open for site availability, so that direct-route block depends on a successful `/public/hidden-profiles` response.

Hiding does **not** delete the website source profile, generated catalogue/sitemap input, prerendered HTML, JavaScript bundle, search-engine cache, saved orders, payment records, or audit history. Permanent public removal requires removing the profile from the website source, rebuilding/redeploying the site, and allowing external caches/indexes to refresh. `/restoreprofile` only removes the D1 override; it cannot make a profile appear if the website source no longer contains it.

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

Processing: route by exact product code → extract a code with `/\bFL-[A-Z0-9]{6}\b/i` → if a code was supplied, match only the unique `pending_payment` order with that exact code (and require any saved checkout name to agree); if no code was supplied, match only by a distinctive exact normalized full customer name saved on exactly one pending order. A supplied code for another order is conflicting evidence and blocks name-only attachment. Email and price are never used as matching criteria. Ambiguous or unmatched events return `200 { matched: false, reason: "no_unique_code_or_name_match" }` without an unsolicited admin notification, and change nothing. A matched sale attaches `payment_reference` (status stays `pending_payment`), records `processed_sales` with `INSERT OR IGNORE` (duplicate deliveries return `{ duplicate: true }` with no repeated alerts), and sends the admin a **Confirm payment manually** prompt. If processing fails after the dedup marker is written, the marker is removed so a sender retry can reprocess, and the admin is alerted.

### `POST /webhooks/selar-abandoned-cart`

Required: customer name (aliases above) containing the code, exact product code (aliases above), and a parseable `abandoned_at` timestamp. Events are deduplicated by a SHA-256 key in `processed_abandoned_carts`; a reminder is sent only for a uniquely matched still-pending order, and it never contains creator contact details or claims a payment was received.

### Zapier operational notice (preserve the existing production Zaps)

The owner confirmed on 2026-10-26 that the existing Selar **New Sale → Worker** Zap is ON and already posts to this Worker. Preserve both existing production Selar Zaps and their current configuration: do not recreate, turn off, re-map, or replace them as part of the receipt-review fallback. That fallback is implemented entirely in Telegram, the Worker, and D1 and requires **no Zapier change**.

The New Sale Zap remains the primary reconciliation path: when it attaches a backend sale record, the paid-claim flow uses the existing manual-verification queue and does not request a receipt. The receipt path is only for a customer whose pending order still has no attached sale record. Do not change any Abandoned Cart automation under the receipt-fallback task.

For a *fresh* environment only, configure Webhooks by Zapier POST steps to:

- `https://fansleak-contact-bot.<subdomain>.workers.dev/webhooks/selar`
- `https://fansleak-contact-bot.<subdomain>.workers.dev/webhooks/selar-abandoned-cart`

…each with header `x-selar-webhook-secret` and the field mapping above. This fresh-environment note is not an instruction to modify the existing production Zaps.

### `POST /telegram/webhook` and `GET /health`

Telegram updates require the `x-telegram-bot-api-secret-token` header to match `TELEGRAM_WEBHOOK_SECRET`; bodies over 256 KiB are rejected. Handling errors are logged without tokens and the endpoint still returns `200` so Telegram does not redeliver updates into duplicate orders. `GET /health` returns `{ ok, service, provider, methods }` only.

---

## Admin commands (only `ADMIN_TELEGRAM_ID`; everyone else is rejected)

Open `/admin` in the private bot chat for the button-based Admin Desk. Admin commands, callbacks, draft editing, and admin media require both the configured admin Telegram user ID and the private chat whose chat ID equals that user ID.

Only **one editable admin composer** may be open at a time across profile-request delivery, service fulfilment, customer support, and broadcast. Opening another composer is blocked with the current composer's type/reference and a cancel button. Ordinary admin text and media edit only that sole composer; if legacy data somehow contains multiple editable drafts, ordinary text/media and YES fail closed instead of guessing. Request/service fulfilment sends always require their draft's explicit Preview → Send button: a bare typed `YES` is never captured as delivery text and never sends those workflows. `YES` remains valid for one-at-a-time durable pending actions and for the established support/broadcast draft confirmation paths when that draft is the sole composer.

Use `/message FL-XXXXXX [your message]` or the full order UUID to open an expiring customer-support draft for the Telegram account linked to that order. The draft accepts plain text and one Telegram photo, video, or PDF/image document; nothing is sent until the admin previews it and taps **Send to customer**. Support drafts are separate from request delivery and service fulfilment and do not alter payment, approval, delivery, or fulfilment status. Unknown slash commands from the configured admin return an admin-specific help hint instead of being treated as customer chat. A voice transcript is echoed first; a voice-derived YES, payment verification, or rejection is not executed—the admin must tap a button or type the exact command/YES.


- `/admin` or `/menu` — open the button-based Admin Desk.
- `/help` — list these commands.
- `/pending` — contact requests awaiting payment verification/final approval (shows status, order code, and whether a sale reference is attached).
- `/orders [search text]` — search the latest 100 profile requests and latest 100 service orders by FL code, UUID, profile/service, Telegram username, kind, or status. Each result gives the exact `/order …` command.
- `/order ORDER_CODE_OR_UUID` — deterministic private inspection of one order: status/timestamps, customer destination, checkout name and email audit clue, attached sale/payment reference, receipt prompt/submission state, related delivery/support drafts, and next safe action buttons. Saved service request text is shown in separate chunks **only after manual payment verification** (`payment_verified` or `fulfilled`).
- `/drafts` — inspect every editable or locked `sending` admin draft, its workflow/reference, text/media presence, timestamps, cancel buttons, and any available stale-lock recovery command.
- `/recoverdraft request|service|support|broadcast DRAFT_UUID` — prepare an audited cancellation of a `sending` draft locked for at least five minutes. The admin must first inspect the recipient conversation and then separately confirm that the exact message was not delivered. Recovery only changes that exact draft to `cancelled`; it never sends/resends and never changes payment or order status.
- `/verify REQUEST_UUID SELAR_REFERENCE` — manually verify a **profile-request** payment after checking it in Selar. Sets `payment_verified`, records the reference in `processed_sales` (so one reference can never verify two orders and a late webhook becomes a duplicate), audits the action, and offers **Prepare delivery** / **Reject**. It does **not** send request fulfilment by itself.
- `/verifyservice ORDER_UUID SELAR_REFERENCE` — same for a **service** order.
- Inline buttons on webhook alerts: **Confirm payment manually** (`selarverify:` / `serviceverify:`), then **Prepare delivery** / **Reject** for profile requests. The internal `approve:` callback name is retained for compatibility; it only opens a draft and sends nothing until the admin confirms the composed delivery.
- Receipt-review messages: when no backend sale is attached, the bot may send the admin a customer-submitted Selar receipt photo/document with order context and an exact `/verify …` / `/verifyservice …` command. Compare it with Selar first; the receipt alone changes nothing.
- `/deliver ORDER_CODE_OR_UUID [fulfilment text]` — open the expiring service-fulfilment composer for a `payment_verified` service order. Text is optional at open time; ordinary text replaces it while this is the sole composer, and one photo, video, or PDF/image document may be attached. Preview it and explicitly confirm before anything is sent. Media captions over Telegram's 1024-character limit are rejected before the send is claimed.
- `/message ORDER_CODE_OR_UUID [message]` — open a 30-minute support draft for the customer attached to a profile request or service order. Add or replace text, optionally attach one photo, video, or PDF/image document, preview it, then explicitly send or cancel. It does not change payment, approval, delivery, or fulfilment status; an uncertain Telegram send remains locked against blind retries.
- `/setcontact`, `/enablecontact`, `/disablecontact`, and `/authorizecontact` — **retired**. They save nothing and send nothing. FansLeak has no creator contact to share; after manually verifying payment, use **Prepare delivery** and send the customer the admin's chosen message/media through the bot.

Every verification, approval/delivery, rejection, and fulfilment writes an `admin_audit` row (admin ID, action, request/order + profile IDs, details incl. payment reference where relevant, timestamp).

Reviewing ambiguous sales: the admin alert states the reason (wrong product, non-paid status, or no unique code/name match). Confirm the real payment in Selar, find the intended request via `/pending`, `/orders SEARCH`, and `/order CODE_OR_UUID` (use the `FL-XXXXXX` code or exact saved checkout name, never email or amount), then `/verify …` with the exact Selar reference. Any email shown is audit context only, never matching evidence or proof.

Stale inline buttons in older Telegram messages now report the saved draft state instead of one generic expiry message: **already sent**, **locked in sending**, **already cancelled**, **expired**, or broadcast **partial**. Tapping a stale Prepare-delivery button for the currently editable request draft reopens it without erasing its existing text/media.

There is no physical order-deletion command. Rejecting, expiring, or cancelling an order changes its status and retains the order, payment evidence, drafts, receipts metadata, and audit history for reconciliation. Physical deletion would require a separately reviewed data-retention/database procedure and is not part of routine Admin Desk operation.

---

## D1 schema and migrations

Baseline `contact-bot/schema.sql` (`0001_baseline`) plus ordered migrations:

| Version | File | Contents |
| --- | --- | --- |
| `0002_service_orders` | `contact-bot/migrations/0002_service_orders.sql` | `service_orders` table + indexes |
| `0003_abandoned_carts` | `contact-bot/migrations/0003_abandoned_carts.sql` | `processed_abandoned_carts` dedup table |
| `0004_checkout_codes` | `contact-bot/migrations/0004_checkout_codes.sql` | `checkout_code`/`checkout_name` columns, per-table unique code indexes, `checkout_name_prompts`. **Non-idempotent as a raw file** (bare `ALTER TABLE`s) — always apply through `scripts/migrate-d1.mjs`, which checks `PRAGMA table_info` first. Tests apply it directly only to fresh databases. |
| `0005_one_active_request_per_user` | `contact-bot/migrations/0005_one_active_request_per_user.sql` | Partial unique indexes: one active contact request / service order per Telegram user. Blocks with a clear error if duplicate active rows already exist; reconcile manually (keep the newest legitimate request, reject/cancel the rest), then re-run. |
| `0006_receipt_review` | `contact-bot/migrations/0006_receipt_review.sql` | `receipt_review_prompts` and `payment_receipt_submissions` for the manual receipt fallback, including unique Telegram-message/file indexes for idempotent retries. It stores file identifiers and delivery state only, never receipt contents/captions. |
| `0007_front_desk_multi_requests` | `contact-bot/migrations/0007_front_desk_multi_requests.sql` | Removes the one-active-contact-request unique index. The Worker allows up to three unpaid contact requests per Telegram account; service orders retain their separate one-active-order guard. |
| `0008_delivery_drafts` | `contact-bot/migrations/0008_delivery_drafts.sql` | Expiring request-bound admin delivery drafts, optional single media attachment, send-state lock, and delivery audit support. |
| `0009_service_delivery_drafts` | `contact-bot/migrations/0009_service_delivery_drafts.sql` | Expiring service fulfilment drafts requiring a preview and explicit admin confirmation before sending. |
| `0010_admin_message_drafts` | `contact-bot/migrations/0010_admin_message_drafts.sql` | Dedicated expiring general customer-support drafts for either order type, with optional single media, one editable draft per admin, and a send-state lock. |
| `0011_admin_broadcast_drafts` | `contact-bot/migrations/0011_admin_broadcast_drafts.sql` | Expiring admin broadcast drafts with optional media and send-state tracking. |
| `0012_hidden_profiles` | `contact-bot/migrations/0012_hidden_profiles.sql` | Reversible website/catalogue profile-visibility overrides. |
| `0013_admin_pending_actions` | `contact-bot/migrations/0013_admin_pending_actions.sql` | Expiring one-at-a-time admin confirmations for profile hiding and snapshot-bound pending-order closure. |
| `0014_remove_creator_sharing_permissions` | `contact-bot/migrations/0014_remove_creator_sharing_permissions.sql` | Historical migration that removed sharing/consent columns from the now-legacy `creator_contacts` table. Current request delivery does not read that table. |
| `0015_service_delivery_draft_media` | `contact-bot/migrations/0015_service_delivery_draft_media.sql` | Adds optional `media_kind`, `media_file_id`, and `media_mime_type` to service fulfilment drafts. The local/remote migration runners check `PRAGMA table_info` before each `ALTER TABLE`, so the raw SQL file should be applied through `scripts/migrate-d1.mjs` rather than run repeatedly by hand. |
| `0016_admin_draft_recovery_actions` | `contact-bot/migrations/0016_admin_draft_recovery_actions.sql` | Rebuilds `admin_pending_actions` to permit `recover_draft` while preserving every existing pending-action row and recreating the one-pending-action unique index. This supports audited cancellation of stale locked drafts without resending. |

Apply/inspect with `node scripts/migrate-d1.mjs --remote` (requires Wrangler auth; used by the deploy workflow *before* the Worker deploy, so a failed migration leaves the old Worker running). It tracks applied versions in `schema_migrations` and verifies all 15 application tables, expected columns, and the unique indexes afterwards. Applied versions can be inspected read-only:

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

Use [`PRODUCTION-RELEASE-CHECKLIST.md`](./PRODUCTION-RELEASE-CHECKLIST.md) for the release gate, deployment sequence, smoke tests, stop conditions, and rollback guidance. It is a preparation document; it does not authorize or trigger production changes.

1. Merge the reviewed PR into `fan`. Merging or pushing to `fan` does **not** deploy the Worker.
2. Manually run **Actions → Deploy FansLeak contact bot → Run workflow** *from `fan`*, entering both Selar checkout URLs and exact product codes. It preflights secrets, applies all pending migrations with verification, deploys the Worker, writes Worker secrets, and reconnects the Telegram webhook. If the `0005` pre-check reports duplicate active rows, reconcile them as described above and re-run.
3. Preserve the existing production Zapier configuration. The receipt fallback requires no Zapier change; only use the fresh-environment POST notes above when provisioning a genuinely new environment.
4. Confirm Cloudflare Pages serves the rebuilt site (fresh `contact-catalogue.json`; each profile's Subscribe button opens the matching `contact_PROFILE_ID` Telegram deep link) and that `VITE_TELEGRAM_BOT_USERNAME` matches the live bot if it ever changes. Separately test direct `/start` → View our services → website or channel Subscribe.
5. Smoke-test with owner-controlled Telegram accounts: confirm a client sending `/creators` or `/profiles` receives only the website direction and no profile list; confirm the configured admin in the private chat can use `/profiles` and `/profiles SEARCH`; start a profile request (including a dotted-ID profile) and confirm the code/instructions. Do not use the retired creator-contact commands—no creator contact exists in this flow.
6. Make a real low-value Selar purchase using the name + code format; confirm webhook reconciliation → manual verification → admin delivery draft → explicit send of only the admin-composed message/media, and that duplicate webhook deliveries are ignored.
7. Separately smoke-test a paid claim with no attached sale using an owner-controlled test order and a non-sensitive test receipt image: confirm the bot requests the receipt only after the backend check, forwards it once to the admin with order context, leaves the order `pending_payment`, and does not verify until the admin checks Selar and uses `/verify` or `/verifyservice`. Never use a real creator's private contact as a test fixture.
8. For Release 2, use sequential owner-controlled tests: open one composer and prove the other three cannot open; prove bare `YES` does not become/send request or service fulfilment; inspect a verified service order with `/order CODE`, attach a synthetic video through `/deliver CODE`, preview and send exactly once; tap the stale Send button and confirm it says **already sent**; test `/profiles hidden`, `/profile`, reversible hide/restore, and the direct website profile URL after hiding. Test stale-lock recovery only on a synthetic locked draft after inspecting the recipient chat—never induce an uncertain send to a real customer.


## Admin Desk commands and multimodal support

The private Telegram Admin Desk supports these explicit commands:

- `/profiles [search text]` — admin-only private-chat list/search of currently visible website profile IDs and names, sent in safe chunks. `/profiles hidden` lists reversible D1 overrides (including stale IDs no longer in the live source catalogue), and `/profiles all [search]` lists source profiles with visible/hidden markers. Clients sending `/profiles` or `/creators` are directed to the website and receive no list.
- `/profile PROFILE_ID_OR_NAME` — inspect one source profile's visibility, hidden-override metadata, and saved request counts by status. A hidden ID absent from the live source catalogue is reported as a stale override rather than as a restorable public profile.
- `/hideprofile PROFILE_ID` — preview and confirm reversibly hiding a profile from public listings/search, its direct profile page after a successful visibility check, and the Telegram request catalogue. `/deleteprofile` is a legacy alias; neither command physically deletes website source files or order/audit records.
- `/restoreprofile PROFILE_ID` — remove the reversible hidden-profile override. If the ID is absent from the live source catalogue, the bot says it still will not appear until the website source is restored/redeployed.
- `/orders [search text]` — search recent contact requests and service orders; `/order CODE_OR_UUID` opens the full deterministic inspection described above.
- `/drafts` and `/recoverdraft …` — inspect the sole editable composer and locked sends, and prepare audited stale-lock cancellation without resending.
- `/reject FL-XXXXXX` — reject a contact request or cancel a service order and notify its customer. This is a status change with records retained, not physical order deletion.
- `/message FL-XXXXXX Your message` — open a private support draft for one customer; text and supported media are sent only after confirmation.
- `/broadcast Your message` — draft a message to up to 100 customers with active/recent order records. Send a photo, video, or document while this is the sole open composer to attach media. Preview before sending. Replying `YES` confirms an active broadcast draft only when no durable pending action is waiting and the broadcast is the sole editable composer.
- `/expirepending` — preview and confirm closure of the exact unpaid order IDs/statuses captured at preview time. It excludes `payment_verified` and `payment_review`, skips orders changed or created after preview, retains records for audit, and does not verify payment.
- `/setcontact`, `/enablecontact`, `/disablecontact`, `/authorizecontact` — retired no-ops with an explanatory reply. There is no creator-contact authorization workflow because no creator contact is shared.

Natural-language admin aliases include `list profiles`, `show orders`, `delete profile PROFILE_NAME`, `reject order FL-XXXXXX`, `delete all pending orders`, and `send mass messages to clients`. Destructive or bulk actions require confirmation. Payment verification remains a separate manual admin action.

The bot also supports Telegram voice notes through Workers AI Whisper, image questions through the configured vision path, and optional spoken replies through MeloTTS. Voice transcripts are echoed to the admin. A voice-derived YES, `/verify`, `/verifyservice`, or rejection is blocked and must be repeated by an explicit button tap or typed command/YES. Workers AI features are metered beyond any applicable account allowance and must not be represented as unconditionally free; live behaviour still requires deployed-Worker testing.
