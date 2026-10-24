# FansLeak Telegram Contact Bot

The bot uses Cloudflare Workers AI for customer support when a message does not match an active payment/request step. AI replies can explain the flow, but cannot verify payments, approve requests, or release contacts.

Cloudflare Worker + D1 backend for @KasiQueenbot. Selar is the initial automated checkout adapter; manual bank-link payment is available alongside it. Payment URLs, price, product ID, and active provider are runtime configuration—not hard-coded into the bot. A future provider can be added as a separate adapter without rewriting Telegram request handling or the database workflow.

## Payment options

- Set `PAYMENT_PROVIDER=selar` to enable the Selar adapter. Set `PAYMENT_METHODS=selar,bank` to show both payment choices.
- Set `SELAR_CHECKOUT_URL`, `SELAR_PRODUCT_ID`, and `SELAR_WEBHOOK_SECRET` for Selar. The webhook accepts only a normalized sale notification forwarded by a trusted integration and requires an explicit successful payment status (`paid`, `completed`, `success`, or `successful`), explicit currency, exact product ID, buyer email, NGN amount, unique sale reference, and a request that selected Selar. Missing status/currency/product fields are rejected; the handler never assumes a generic New Sale event proves payment.
- Set `BANK_PAYMENT_URL` to the bank payment link you provide. After the buyer pays, the bot asks for a transfer reference and notifies the admin. The admin must check the actual bank transaction record and click **I verified the bank payment** or **Reject / not found**. A buyer's screenshot or claim never counts as verification. Bank payment then still needs final request approval.
- Set `CONTACT_PRICE_NGN` to the exact price in naira. It is shared by the payment options. Do not accept a sale at a different amount.
- Workers AI is bound as `AI` in `wrangler.toml`; `AI_MODEL` selects the model. The AI is customer support only and cannot verify payment, approve requests, or release contact details.
- If you later change providers, change `PAYMENT_PROVIDER` and implement/enable that provider's own verified webhook adapter. Never route another provider's payload through the Selar handler. Bank link payments can remain enabled independently.

## Request and privacy flow

1. A visitor clicks the profile's Message button, which opens `https://t.me/KasiQueenbot?start=contact_PROFILE_ID`.
2. The bot looks up the profile in `https://fansleak.pages.dev/contact-catalogue.json` and records the request.
3. The buyer provides an email address, then chooses Selar or the bank payment link.
4. Selar sale events are validated automatically; bank transfers are manually checked by the admin.
5. Admin approves or rejects the contact request after payment verification.
6. Creator contact details are disabled by default. Admin uses `/setcontact PROFILE_ID @handle`, then `/enablecontact PROFILE_ID` only after confirming that the creator explicitly authorised sharing. Both actions are audit logged.

## Deployment setup

The D1 database is already created and its schema has been applied. The Worker is not yet deployed.

1. Add these GitHub repository Actions secrets under **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN` — token with permission to edit Workers and D1 in the configured Cloudflare account.
   - `TELEGRAM_BOT_TOKEN` — token for `@KasiQueenbot`.
   - `TELEGRAM_WEBHOOK_SECRET` — a random 1–256 character value using only letters, numbers, underscores or hyphens.
   - `ADMIN_TELEGRAM_ID` — your numeric Telegram user ID.
   - `SELAR_WEBHOOK_SECRET` — a separate strong random secret for the incoming Selar integration.
2. Merge this PR into the repository's default branch so GitHub exposes the manual deployment workflow.
3. Open **Actions → Deploy FansLeak contact bot → Run workflow**. Supply the exact contact price in NGN, the real Selar checkout URL, exact Selar product ID, and bank payment URL/instructions.
4. The workflow deploys the Worker, stores runtime values and secrets, and connects Telegram's webhook. It is manual-dispatch only; it will not deploy automatically on every push.
5. Configure the Selar integration to send a normalized payload to `POST /webhooks/selar` with header `X-Selar-Webhook-Secret`. The payload must contain a real unique sale reference, buyer email, amount, currency, exact product ID and an authoritative successful payment status. If Selar's available trigger does not supply trustworthy payment status, do not fabricate it; keep automated Selar verification disabled until a trustworthy source is available.
6. The Worker URL is `https://fansleak-contact-bot.<your-workers.dev-subdomain>.workers.dev`. The deployment workflow automatically sets Telegram's webhook URL after deploying and configuring the required secrets.

## Admin commands

- `/pending` — list payment/request records requiring attention.
- `/setcontact PROFILE_ID @handle` — save a contact but keep sharing disabled.
- `/enablecontact PROFILE_ID` — record the admin's confirmation that creator sharing is authorised.

## Launch checks

- The Worker and D1 database have not yet been deployed by this PR.
- The real Selar product URL/ID, bank payment URL, price, admin Telegram numeric ID, and secret values must be configured in Cloudflare. Do not paste bot tokens or secrets into GitHub or this chat.
- Selar sale-event fields must be tested in the actual account; this code deliberately expects a normalized event from the forwarding integration.
- The website catalogue is generated from the existing visible profile source during the website build, so it stays in sync when new profiles are added and deployed.
