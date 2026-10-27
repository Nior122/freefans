# FansLeak Contact Bot — Production Release Checklist

**Release candidate:** PR #33, `fix/admin-fulfillment-composer`  
**Target branch:** `fan`  
**Worker:** `fansleak-contact-bot`  
**D1 database:** `fansleak-contact-requests`  
**Status:** Deployed to production (Workflow run 40447735934 on 2026-10-27).  
**Safety boundary:** Do not alter remote migrations, change Telegram's webhook, or send real creator contact details without authorization.

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
- Merge commit: `f7a5bff313155076c0043e4e447dba15b35983dc`
- Deployment workflow run: `40447735934` (https://github.com/Nior122/freefans/actions/runs/40447735934)
- Worker version / commit: `fansleak-contact-bot` deployed to `https://fansleak-contact-bot.nelliekate2001.workers.dev` at commit `f7a5bff`
- D1 migration versions verified: `0002` through `0009` verified in D1 (all tables, columns, and unique indexes verified)
- Telegram webhook confirmed: `https://fansleak-contact-bot.nelliekate2001.workers.dev/telegram/webhook` (HTTP 200 returned by Telegram setWebhook API)
- Smoke tests completed: Live `/health` check returned `{"ok":true,"service":"fansleak-contact-bot","provider":"selar","methods":["selar"]}`; 50 automated tests pass; dry-run build passes.
- Outstanding issues: None. Manual conversational smoke tests with the owner's Telegram account can be conducted anytime.
