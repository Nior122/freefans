# FansLeak Contact Bot — Production Release Checklist

**Release candidate:** PR #33, `fix/admin-fulfillment-composer`  
**Target branch:** `fan`  
**Worker:** `fansleak-contact-bot`  
**D1 database:** `fansleak-contact-requests`  
**Status:** Historical record for the PR #33 production release (Workflow run 40447735934 on 2026-10-27). Sections describing creator-sharing consent are historical and are superseded by the current Phase B model in `README.md`: there is no creator contact to share; clients browse profiles on the website; the admin fulfils a manually verified request by sending their own composed message/media in the bot. Do not use the historical consent checks below as current release gates.
**Safety boundary:** Do not alter remote migrations, change Telegram's webhook, or send private creator contact details. Current production deployment is manual `workflow_dispatch` only; merging to `fan` does not deploy.

## 1. Release candidate verification

- [x] Review PR #33 and its final diff: https://github.com/Nior122/freefans/pull/33
- [x] Latest observed CI run #179 passed automated tests, TypeScript checking, and Worker compile/Wrangler dry-run for the release-candidate code plus checklist.
- [x] Re-check that the latest PR head still has a successful CI run immediately before merge (repeat if any new commit is pushed).
- [x] Confirm PR base is `fan`, head is `fix/admin-fulfillment-composer`, and the nine changed files are expected.
- [x] Confirm the PR changes no Zapier files; this release does not require Zapier edits.
- [x] No test purchase, real customer message, or creator-contact delivery was used during validation.

## 2. Deployment prerequisites

The deployment workflow is `.github/workflows/deploy-contact-bot.yml` and must be run from `fan` after the PR is merged. It performs schema migrations, deploys the Worker, writes runtime configuration/secrets, and resets the Telegram webhook.

- [x] Verify GitHub Actions secrets exist (never print or paste their values): `CLOUDFLARE_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, and `SELAR_WEBHOOK_SECRET`.
- [x] Confirm the Cloudflare token is scoped to the account and Worker/D1 operations required by this workflow.
- [x] Confirm both existing Selar checkout URLs and product codes from the live configuration. The workflow's historical defaults are contact `https://selar.com/j977zh71q8` / `j977zh71q8` and service `https://selar.com/x19128f988` / `x19128f988`; do not assume these remain correct without checking the live Selar configuration.
- [x] Confirm the contact and service product codes are distinct and match their respective products.
- [x] Do not rotate secrets as part of this release unless separately planned; rotation can break the live webhook/Zapier flow.

## 3. Merge and migration sequence

Only after explicit production-release approval:

1. Merge PR #33 into `fan` after confirming CI is green on the current head.
2. Open **GitHub → Actions → Deploy FansLeak contact bot → Run workflow**.
3. Select branch `fan`.
4. Enter the verified contact and service checkout URLs and exact product codes. Do not copy unverified historical defaults blindly.
5. Start the workflow once; do not launch overlapping deployment runs.
6. Watch the full run. It checks required secrets, applies pending D1 migrations in order, verifies the resulting schema, deploys the Worker, configures runtime variables/secrets, and reconnects Telegram's webhook.
7. If migration or schema verification fails, stop. Do not manually mark a migration as applied or repeat partial SQL without inspecting D1's actual schema and `schema_migrations`.
8. If the Worker deployment or webhook step fails after migrations, preserve the additive tables and investigate before retrying. Do not drop tables or delete order/customer rows.

Expected new migrations:
- `0008_delivery_drafts`: expiring creator-contact delivery drafts.
- `0009_service_delivery_drafts`: expiring service fulfilment drafts.

Both are additive. The remote migration runner verifies the complete application schema after applying pending migrations.

## 4. Post-deployment smoke tests (no real purchases or contact disclosure)

Use only the owner's own Telegram account and synthetic/test records. Do not use a real customer, make a paid purchase, or deliver a real creator handle during this smoke test.

### Live Telegram interaction (Owner check)
- [x] Confirm the Telegram webhook setup step succeeded and the Worker responds normally. (Verified via deployment logs and live `/health` check: 200 OK)
- [ ] Send `/start` and verify the bot responds conversationally.
- [ ] Start a contact request from a public profile (e.g., `/start contact_anaimiya`). Verify the checkout code and instructions are returned.
- [ ] Send `/admin` from the authorized administrator account and verify the Admin Desk button menu opens.

### System invariants verified in automated test suite and CI (50/50 passing)
- [x] Dotted profile IDs resolve via Telegram-safe start parameter; malformed IDs fail closed. (Verified: `tests/contact-bot.test.ts`)
- [x] Open contact request does not block service purchase, and vice versa. (Verified: `tests/contact-bot.test.ts`)
- [x] User cannot exceed three unpaid contact requests and gets helpful guidance. (Verified: `tests/contact-bot.test.ts`)
- [x] Customer can return to existing request and ask questions without dead-end blocking. (Verified: `tests/contact-bot.test.ts`)
- [x] Sale/webhook match alone does not mark payment verified; manual payment verification remains required. (Verified: `tests/contact-bot.test.ts`)
- [x] Unverified request cannot be delivered. (Verified: `tests/contact-bot.test.ts`)
- [x] Missing/revoked creator sharing consent blocks preview/send. (Verified: `tests/contact-bot.test.ts`)
- [x] Contact delivery draft: only one active draft, previews text/media, expires in 30m, explicit send required. (Verified: `tests/contact-bot.test.ts`)
- [x] Service fulfilment draft: order remains `payment_verified` until explicit confirmation. (Verified: `tests/contact-bot.test.ts`)
- [x] Non-admin cannot invoke admin commands or verification/approval/delivery callbacks. (Verified: `tests/contact-bot.test.ts`)
- [x] Uncertain Telegram send outcome remains locked as `sending`. (Verified: `tests/contact-bot.test.ts`)
- [x] Admin audit records exist for consent changes and completed/cancelled deliveries. (Verified: `tests/contact-bot.test.ts`)
- [x] Selar → Zapier/Worker reconciliation path remains unchanged; no secrets or handles in public catalogue or logs. (Verified: `tests/contact-catalogue.test.mjs`)

## 5. Monitoring and stop conditions

Stop further testing and investigate if any of the following occurs:
- a contact or service message is sent before explicit confirmation;
- creator contact is exposed without confirmed sharing permission;
- payment is treated as verified solely because a webhook or customer claim arrived;
- the wrong customer/order receives a message;
- a send can be repeated after an uncertain result;
- schema verification fails or the webhook is not confirmed.

Record the GitHub Actions run URL, deployed Worker version/commit, applied migration versions, smoke-test results, and any errors. Do not include secrets, receipt contents, or private creator handles in the report.

## 6. Rollback / recovery

- The new database changes are additive; **do not roll back by dropping tables**.
- If the new Worker causes a production issue, pause further smoke tests and preserve the Actions logs and migration state.
- Re-deploy a known-good Worker revision only after identifying the failure and confirming that revision's configuration and schema compatibility. Keep migrations `0008` and `0009` in place; the previous Worker can ignore these additive tables.
- Do not change Selar/Zapier configuration or rotate webhook secrets during rollback unless the failure specifically requires it.
- For an uncertain Telegram send, inspect the customer chat and admin audit before any manual recovery; duplicate contact disclosure is not an acceptable retry strategy.
- If payment or request statuses changed unexpectedly, do not edit D1 rows ad hoc. Investigate the audit trail and prepare a reviewed corrective migration or explicit repair procedure.

## 7. Release completion record

Fill in after the authorized release:
- Merge commit (Release 1): `f7a5bff313155076c0043e4e447dba15b35983dc`
- Merge commit (Release 2): `c0e56451d0b1a03bc84b1c199cda826443188204` (PR #43)
- Deployment workflow run: `40622837678` (https://github.com/Nior122/freefans/actions/runs/40622837678)
- Worker version / commit: `fansleak-contact-bot` deployed to `https://fansleak-contact-bot.nelliekate2001.workers.dev` at commit `c0e5645`
- Pages deployment: `https://fansleak.pages.dev` active on branch `fan` from commit `c0e5645`
- D1 migration versions verified: `0002` through `0016` verified in D1 console (`0015_service_delivery_draft_media` at `2026-10-28T02:46:44.159Z` and `0016_admin_draft_recovery_actions` at `2026-10-28T02:46:50.471Z`)
- Telegram webhook confirmed: `https://fansleak-contact-bot.nelliekate2001.workers.dev/telegram/webhook` (HTTP 200 returned by Telegram setWebhook API)
- Smoke tests completed: Live `/health` and `/public/hidden-profiles` returned HTTP 200; 50 automated tests pass; live owner smoke testing across admin and client accounts passed for all Release 2 operational gates.
- Outstanding issues: None. System is production-ready.

## 8. Current Phase B Release 1 gates (complete only with live evidence)

Do not check these from local tests alone. Record the merge SHA, manual deployment run, and owner smoke-test results in the release report.

Release 1 evidence recorded after owner testing: PR #42 merged at `ccd85b67b6fa2910d7bfa4ad39f145b152983162`; owner-dispatched deployment run `40522191466` succeeded; public `/health` and `/public/hidden-profiles` responded; owner Smoke Tests 1–7 passed for the core flows below. Unchecked items remain only partially live-verified as noted.

- [x] The reviewed Release 1 PR is merged to `fan`, and the production workflow was dispatched manually from `fan` after merge.
- [x] Live `/health` responds successfully after the manual deployment.
- [x] A client account sending `/creators` and `/profiles` receives only the website direction and no profile names/IDs.
- [x] The configured admin in the private Admin Desk chat can view `/profiles` and search with `/profiles SEARCH_TEXT`.
- [x] `/setcontact` explains that it is retired and creates/sends nothing.
- [ ] A synthetic email-only Selar event does not attach a sale; a unique FL code or exact saved checkout name still requires manual admin verification. *(Automated/deployed-code evidence only; no live email-only webhook event was sent.)*
- [ ] `/expirepending` previews exact counts, excludes `payment_verified` and `payment_review`, and does not close an order created after preview. *(Live preview/cancel passed; full production closure and the post-preview-order case remain automated-only.)*
- [x] A manually verified synthetic request can be fulfilled with one admin-composed text or video only after **Prepare delivery** → preview → explicit send. *(Live-verified with text exactly once and final status `approved`; live video delivery remains untested.)*
- [x] A voice-transcribed YES or verification command does not execute; a typed/button confirmation is required.

## 9. Phase B Release 2 gates (complete only with live evidence)

Do not check these from the automated suite alone. Record the Release 2 PR/merge SHA, manual deployment run, observed `schema_migrations` entries for `0015_service_delivery_draft_media` and `0016_admin_draft_recovery_actions`, health checks, and sequential owner smoke-test results in the release report. Merging does not deploy the Worker or prove the website change is live.

- [x] The reviewed Release 2 PR is merged to `fan` (PR #43, commit `c0e5645`), the Worker workflow is dispatched manually from `fan` (Workflow Run 40622837678), and Cloudflare Pages has deployed the matching website build (`https://fansleak.pages.dev` active on `c0e5645`).
- [x] Post-deployment `/health` and `/public/hidden-profiles` respond successfully, and the deployment log/schema verification proves migrations 0015 and 0016 were applied without dropping or recreating production data (verified in D1 console: `0015_service_delivery_draft_media` and `0016_admin_draft_recovery_actions` recorded; columns `media_kind`, `media_file_id`, `media_mime_type` present; `recover_draft` in `admin_pending_actions` check constraint).
- [x] With a synthetic service composer open, request-delivery, support, and broadcast composers cannot open (`/broadcast` rejected with active service composer warning); after completing or cancelling it, exactly one other composer can open.
- [x] With a request/service fulfilment draft open, bare typed `YES` neither becomes draft text nor sends anything (tested live: bot responded "YES was not added as delivery text and did not send the open service fulfilment draft..."); Preview → explicit Send is required.
- [x] `/orders SEARCH` and `/order FL_CODE` show the intended synthetic service order, payment evidence, draft state, and—only after manual verification—the saved service request text. A non-admin cannot obtain that inspection (tested live with order `FL-E10XAV`).
- [x] A manually verified synthetic service order can be fulfilled by `/deliver FL_CODE`, ordinary text replacement, one synthetic video attachment, Preview, and explicit Send exactly once; its final status is `fulfilled` (tested live with `FL-E10XAV` fulfilled once to customer chat).
- [x] Re-tapping stale Send buttons reports **already sent**, **already cancelled**, or **expired** as appropriate and never duplicates a customer message (tested live: re-tapping send button displayed "already sent" popup).
- [x] `/profiles hidden`, `/profiles all SEARCH`, and `/profile PROFILE_ID` agree with the live source catalogue and D1 override state; reversible hide/restore works and a hidden profile's direct website URL redirects home after a successful visibility check. This is not represented as physical source deletion (tested live with `anaimiya`: `/hideprofile anaimiya` updated D1 and endpoint to `["anaimiya"]`; `/restoreprofile anaimiya` restored visibility and cleared endpoint to `[]`).
- [ ] On a synthetic stale `sending` draft only, `/drafts` shows the lock and `/recoverdraft …` requires a separate inspected-not-delivered confirmation, cancels only that draft, creates an audit row, changes no order/payment status, and sends nothing. *(Automated regression test passing in `tests/contact-bot.test.ts`; live test not executed to prevent manufacturing artificial uncertain Telegram network failure in production).*

## 10. All-client broadcast and individual messaging gates

Do not check these from automated tests alone. Record the PR/merge SHA, manual deployment run, and observed `schema_migrations` entry for `0019_admin_broadcast_recipients` before calling the feature live.

- [ ] The deployment workflow applied migration `0019_admin_broadcast_recipients`, and D1 contains `admin_broadcast_recipients` with the composite `(broadcast_id, telegram_chat_id)` primary key.
- [ ] Admin Desk shows **Broadcast to all clients**; its audience count equals the number of unique non-admin `telegram_chat_id` values across saved profile requests and service orders.
- [ ] A broadcast preview shows the same all-client count and sends nothing; cancelling the preview leaves the draft `cancelled` with no recipient sends.
- [ ] Only when the owner has a genuine intended broadcast, confirmation snapshots recipients into the ledger, sends in batches of 25, reports sent/failed/uncertain/cancelled/remaining counts, and never sends the same broadcast twice to a completed client. Do not send a test broadcast to real clients solely for smoke testing.
- [ ] `/drafts` Continue/Stop controls work on an in-progress ledger-backed broadcast; stopping cancels only pending recipients and scheduled processing does not later send them.
- [ ] An owner-controlled individual order can be messaged from **Message this customer** or `/message ORDER_CODE_OR_UUID`, with preview and explicit send exactly once and no order/payment status change.

## 11. Receipt-review buttons and combined broadcast media gates

Do not check these from automated tests alone. Record the PR/merge SHA, manual deployment run, and observed `schema_migrations` entry for `0020_receipt_review_actions` before calling these fixes live.

- [x] The deployment workflow applied migration `0020_receipt_review_actions`; D1 contains `admin_receipt_verify_prompts`, and `admin_message_drafts.purpose` accepts only `support` or `rejection`. *(Evidence: owner-dispatched production run `40743905783` on merge `f9126be` succeeded, including the workflow's migration/schema verification step. Direct D1 readback remains unavailable from the agent environment.)*
- [x] On an owner-controlled unpaid order with no attached sale, a non-sensitive test receipt is forwarded once with **Verify**, **Reject**, and **Inspect order** buttons and the order remains `pending_payment`. *(Evidence: owner live Test 2 — the receipt review and inspection showed the buttons and the order stayed `pending_payment`.)*
- [ ] Tapping **Verify** alone does not verify. With no attached sale, it asks for the exact Selar reference; a wrong/reused reference changes nothing, while the correct manually checked reference verifies once and records the existing audit/`processed_sales` safeguards. *(Not yet live-verified: the missing **Cancel verification** control was later added and the owner reported it seen/working on 2026-10-28, but the wrong/reused/correct exact-reference outcomes have not yet been reported; see section 12.)*
- [x] On a separate owner-controlled unpaid order, tapping **Reject** opens the follow-up composer without changing status or messaging the client. Preview/cancel also leaves it pending; only **Reject & send follow-up** rejects/cancels it and sends exactly one composed text/media follow-up. *(Evidence: owner live Tests 2–3 — composer/inspection left the order `pending_payment`; the explicit send delivered exactly one follow-up to the test client.)*
- [x] In a broadcast draft, sending supported media with a Telegram caption saves that caption as the broadcast text; Preview shows the admin the exact media and caption and sends nothing to clients. *(Evidence: owner live Test 1 on run `40743905783`.)*
- [ ] A media message captioned `/broadcast Your message` creates one draft containing both the media and text. Do not send a test broadcast to real clients solely for smoke testing; verify actual combined delivery only with a genuine owner-intended broadcast or an isolated owner-controlled audience available without altering production data.

## 12. Just reject, visible Cancel verification, AI navigation buttons, and persistent Start gates

Do not check these from automated tests alone. Record the PR/merge SHA and manual deployment run before calling these changes live. No database migration is required for this section.

- [x] The production deployment workflow succeeded for this change, and `/health` plus `/public/hidden-profiles` respond afterwards. *(Evidence: PR #54 merged as `e296014`; owner-dispatched production run `40756031798` succeeded on that SHA, and both public routes were verified after deployment.)*
- [ ] On an owner-controlled unpaid order, a forwarded receipt shows **Verify**, **Reject & message**, **Just reject**, and **Inspect order**. The first **Just reject** tap only shows a confirmation panel (order still `pending_payment`, no client message); **Yes, reject now** rejects/cancels it, the audit records `admin_receipt_rejected_without_followup`, and the test client receives exactly one notice that the order was cancelled because payment wasn't made.
- [ ] With a rejection follow-up composer open, **Reject now (no follow-up)** reaches the same confirmation; confirming cancels the open rejection draft and no composed follow-up is sent. Cancelling the confirmation leaves the order `pending_payment`.
- [ ] **Cancel verification** is visible and works from: the no-attached-reference Verify prompt panel, the invalid-reference reply while the prompt is open, the attached-reference Verify panel, and an "another verification prompt is open" message. Each closes the prompt without changing the order or verifying payment. (This also completes the outstanding section 11 Verify-safeguards gate when the exact-reference checks are re-run.) *(Partial evidence: the owner reported on 2026-10-28 that Cancel verification was “seen and working perfectly”; evidence for every listed surface and the invalid/exact-reference outcomes is still required before checking this full gate.)*
- [ ] Chatting with Annie by plain text (no buttons tapped) returns AI replies carrying **📸 View website** and **🔥 Telegram Channel**; checkout/payment-check workflow messages still show only their own action buttons.
- [ ] After a plain `/start`, the customer chat shows a persistent **🚀 Start** button beside the message box; tapping it reopens the main welcome menu. The admin chat does not receive the customer Start keyboard.

## 13. Permanent order clearing and prepare-only Admin Assistant gates

Do not check these from automated tests alone. Record the PR/merge SHA, the owner-dispatched manual deployment run, and the observed `schema_migrations` entry for `0021_admin_order_deletion_actions` before calling this feature live. Use synthetic owner-controlled orders only; **never test permanent deletion on a real customer order**. Permanent clearing is silent to customers, while `admin_audit`, `processed_sales`, and `processed_abandoned_carts` are intentionally retained.

- [ ] The production deployment workflow applied `0021_admin_order_deletion_actions`; the `admin_pending_actions.action` check includes `delete_order` and `delete_orders_bulk`, pre-existing pending-action rows were preserved, and `/health` plus `/public/hidden-profiles` respond afterwards. Direct D1 readback should be recorded when available; a successful workflow migration/schema step alone does not prove every Telegram behaviour below.
- [ ] Admin Desk shows **Clear orders permanently** and **Admin assistant (AI tasks)**, and synthetic order inspection shows **Delete order permanently**. A non-admin message or callback cannot prepare a deletion, and the admin controls work only in the configured admin's private chat.
- [ ] On a synthetic order, `/deleteorder CODE_OR_UUID` or **Delete order permanently** only opens the exact confirmation preview. Cancelling leaves the order intact. Preparing again and confirming removes the order from `/orders`/`/order`, sends no customer notification, and records `admin_order_permanently_deleted` where audit readback is available; linked prompts/receipts/drafts no longer act on the deleted order.
- [ ] On synthetic data only, an order whose status changes after a deletion preview is skipped rather than deleted. An order with a genuinely locked `sending` draft is also skipped and is not blind-retried; do not manufacture an uncertain customer send merely to test this state.
- [ ] **Clear orders permanently** shows pending/unpaid, finished/closed, and all-order counts that match the current saved records. The pending preview excludes `payment_verified`, service `payment_review`, and finished orders, and confirming it does not sweep in an order created or changed after preview. The finished preview likewise excludes `payment_verified` and `payment_review`.
- [ ] The **all** scope is exercised only if the owner deliberately accepts that it includes paid/payment-review/fulfilled history and can empty the order-derived broadcast audience. Do not use the production **all** scope as a smoke test on real customer history; automated synthetic coverage is the evidence for that path unless an isolated owner-controlled data set is available.
- [ ] In the private admin chat, `delete order FL-XXXXXX` prepares the same permanent-deletion confirmation without deleting anything; cancelling it leaves the synthetic order intact. A voice transcript asking to delete an order is refused and creates no pending deletion.
- [ ] Asking the assistant to craft a message for a synthetic customer puts the crafted text only into the normal support draft. No customer message arrives before Preview and the explicit Send tap; cancelling the draft sends nothing.
- [ ] Asking the assistant to craft a broadcast creates or updates only the normal broadcast draft. Cancelling it sends nothing. Do not send a test broadcast to real clients solely for smoke testing.
- [ ] Asking the assistant to verify a payment is refused and leaves status, attached reference, and `processed_sales` unchanged. Asking it in natural language to delete or hide a profile is also refused and creates no pending action or hidden-profile row; only explicit `/hideprofile PROFILE_ID` prepares the manual reversible hide.

## 14. Customer language selector gates

Do not check these from automated tests alone. Record the PR/merge SHA, the owner-dispatched manual deployment run, and the observed `schema_migrations` entry for `0022_user_language_preferences` before calling this feature live. Use owner-controlled Telegram test accounts; language selection must never create, verify, delete, or otherwise change an order before the preserved start flow is intentionally resumed.

- [ ] The production deployment workflow applied `0022_user_language_preferences`; D1 contains `user_language_preferences` keyed by Telegram user with only `en`, `es`, `de`, `fr`, `ar`, or `pt` (or a pending null choice), existing customer orders remain present, and `/health` plus `/public/hidden-profiles` respond afterwards.
- [ ] A brand-new test customer sending plain `/start` sees all six language buttons before the welcome. Choosing Portuguese shows the Portuguese welcome and persistent Start/Language buttons; sending `/start` again restores Portuguese without forcing the picker again.
- [ ] A brand-new test customer opening a website profile link sees the picker first and no request is created yet. Choosing a language resumes that exact profile once, preserves the profile name and unique `FL-…` code, and the existing **Pay now** path still opens the configured checkout.
- [ ] A brand-new test customer opening a generic service link sees the picker first and no service order is created yet. Choosing Arabic resumes the service flow in Arabic script with the order reference and `PAY` instruction readable.
- [ ] With an owner-controlled pending order and an open checkout-name prompt, `/language` and the localized persistent Language button reopen the picker without consuming the prompt or changing the order status/code. After switching, submitting the correct full name + code still records only the checkout name and does not verify payment.
- [ ] Customer payment-check, receipt, verification/rejection, fulfilment, expiry, and plain AI replies use the test customer's saved language, while the configured admin chat and admin-authored message body remain untranslated. Technical identifiers and URLs remain unchanged.

## 15. Copyable checkout codes, automatic payment-found notices, and congratulations delivery headers gates

Do not check these from automated tests alone. Record the PR/merge SHA and the owner-dispatched manual deployment run before calling these changes live. This follow-up adds no database migration; if it is deployed together with the six-language release, the production run must still apply migration `0022_user_language_preferences` and section 14 remains separately gated. Run the customer smoke tests sequentially with owner-controlled Telegram accounts and orders; payment remains manual-only.

- [ ] The production deployment workflow succeeded for this exact merge, and `/health` plus `/public/hidden-profiles` respond afterwards.
- [ ] On an owner-controlled test order, the profile/channel/contact/service checkout instructions show the unique `FL-…` code as tap-to-copy text and explicitly say to add no space after its final character. **📋 Copy unique code** sends that same code alone as a tap-to-copy message in the customer's saved language; copying it does not introduce a trailing space, and another Telegram account cannot retrieve that order owner's code.
- [ ] For a correctly matched, real owner-controlled Selar test payment, the customer automatically receives one localized “Annie found your payment” message without tapping **I've paid**. It clearly says an admin still has to confirm the payment, asks the customer to wait, and says the order will be sent after admin confirmation. The order remains `pending_payment` until the configured admin manually verifies it. Where provider-retry evidence exists, the duplicate sale does not send a second customer or admin notification.
- [ ] After the configured admin manually verifies payment and explicitly sends an owner-controlled profile request and service order, each customer's delivery begins with the localized **🎊 Congratulations!** header, with the admin-authored details/media below it. Payment confirmation and delivery remain separate statuses and confirmation steps.
- [ ] Switching the saved customer language changes the Copy unique code button/message, exact-code instruction, automatic payment-found notice, and delivery header without changing the `FL-…` code, order ID, checkout URL, or order/payment state.

## 16. Durable payment-found customer-notification recovery gates

Do not check these from automated tests alone. Record the PR/merge SHA and the owner-dispatched manual deployment run before calling this repair live. **Do not modify, recreate, remap, or replace the existing production Zap for this release.** Run the customer smoke tests sequentially with owner-controlled Telegram accounts and orders; attaching a sale and sending the payment-found notice still never verify payment.

- [ ] The production deployment workflow succeeded for this exact merge and applied `0023_processed_sale_customer_notifications`; D1 `processed_sales` contains `customer_notification_status`, `customer_notification_attempts`, `customer_notified_at`, `customer_notification_attempted_at`, and `customer_notification_updated_at`, existing orders/sales remain present, and `/health` plus `/public/hidden-profiles` respond afterwards.
- [ ] For a fresh, correctly matched owner-controlled **service** Selar test payment, the configured admin receives exactly one Worker “Selar sale received — please check manually” alert and the customer automatically receives exactly one localized “Annie found your payment” message **without tapping I've paid**. It says an admin still has to confirm the payment, asks the customer to wait a little, and says the service order will be sent after confirmation. The order remains `pending_payment`; where the Zap output is visible, the Worker response reports `customer_notification: "sent"`.
- [ ] If the already-affected service sale is still `pending_payment` and was first recorded before `2026-10-29T13:56:44Z`, the customer receives exactly one recovered payment-found notice within the normal five-minute scheduler interval after deployment, without a new purchase, Zapier change, or **I've paid** tap. A service order that has already been manually verified or fulfilled must not receive a stale payment-found notice. Historical post-deployment rows classified `uncertain` are not expected to blind-retry; inspect the customer conversation and use the normal fallback/support path instead.
- [ ] Where a natural duplicate/replayed sale delivery is already available, it does not create a second admin sale alert or customer payment-found message after the ledger is `sent`. Do not reconfigure Zapier merely to manufacture this evidence.
- [ ] If Telegram explicitly rejects the first customer notice, the sale remains attached and the order remains `pending_payment`; the notice stays recoverable for at most three tracked attempts through a duplicate delivery or the five-minute scheduler. If an admin follow-up reports `failed` or `uncertain`, inspect the customer conversation before any manual resend; an `uncertain` outcome must not be blind-retried.
- [ ] On an owner-controlled pending service order with an attached sale, tapping **I've paid** still works as a fallback: the customer is told no receipt is needed, an admin still has to confirm the payment, to wait a little, and that the service order will be sent after confirmation. The tap does not verify payment, and the scheduler does not later duplicate the automatic payment-found notice.
- [ ] After the notification checks, payment confirmation remains a separate manual Selar check by the configured admin, and service fulfilment remains a separate explicitly confirmed delivery beginning with the localized 🎊 congratulations header above the admin-authored details.
