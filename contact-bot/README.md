# FansLeak Telegram Contact Bot

Cloudflare Worker + D1 backend for @KasiQueenbot. Selar is the initial automated checkout adapter; manual bank-link payment is available alongside it. Payment URLs, price, product ID, and active provider are runtime configuration—not hard-coded into the bot. A future provider can be added as a separate adapter without rewriting Telegram request handling or the database workflow.

## Payment options

- Set `PAYMENT_PROVIDER=selar` to enable the Selar adapter. Set `PAYMENT_METHODS=selar,bank` to show both payment choices.
- Set `SELAR_CHECKOUT_URL`, `SELAR_PRODUCT_ID`, and `SELAR_WEBHOOK_SECRET` for Selar. The webhook accepts only a normalized sale notification forwarded by a trusted integration and checks the exact product ID, buyer email, NGN amount, and unique sale reference.
- Set `BANK_PAYMENT_URL` to the bank payment link you provide. After the buyer pays, the bot asks for a transfer reference and notifies the admin. The admin must check the actual bank transaction record and click **I verified the bank payment** or **Reject / not found**. A buyer's screenshot or claim never counts as verification. Bank payment then still needs final request approval.
- Set `CONTACT_PRICE_NGN` to the exact price in naira. It is shared by the payment options. Do not accept a sale at a different amount.
- If you later change providers, change `PAYMENT_PROVIDER` and implement/enable that provider's own verified webhook adapter. Never route another provider's payload through the Selar handler. Bank link payments can remain enabled independently.

## Important Selar policy note

Selar's published prohibited-business list includes adult entertainment and adult content. FansLeak includes adult-oriented profiles, so this use may breach Selar's rules and could lead to account suspension or removal. This implementation does not disguise the service or bypass compliance checks. Contact Selar and provide the real website/business model. The code can be configured to use Selar, but that is not a claim that Selar has approved the business. You decide whether to enable the configuration and accept the account risk.

## Request and privacy flow

1. A visitor clicks the profile's Message button, which opens `https://t.me/KasiQueenbot?start=contact_PROFILE_ID`.
2. The bot looks up the profile in `https://fansleak.pages.dev/contact-catalogue.json` and records the request.
3. The buyer provides an email address, then chooses Selar or the bank payment link.
4. Selar sale events are validated automatically; bank transfers are manually checked by the admin.
5. Admin approves or rejects the contact request after payment verification.
6. Creator contact details are disabled by default. Admin uses `/setcontact PROFILE_ID @handle`, then `/enablecontact PROFILE_ID` only after confirming that the creator explicitly authorised sharing. Both actions are audit logged.

## Deployment setup (not deployed by this PR)

1. Create a Cloudflare D1 database named `fansleak-contact-requests`; set its ID in `wrangler.toml` instead of `REPLACE_WITH_D1_DATABASE_ID`.
2. From `contact-bot/`, apply the schema: `npx wrangler d1 execute fansleak-contact-requests --remote --file=schema.sql`.
3. Deploy the Worker from `contact-bot/` using Wrangler.
4. Add Worker secrets (never commit them): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, `SELAR_WEBHOOK_SECRET`.
5. Add Worker variables: `CONTACT_PRICE_NGN`, `PAYMENT_PROVIDER=selar`, `PAYMENT_METHODS=selar,bank`, `SELAR_CHECKOUT_URL`, `SELAR_PRODUCT_ID`, `BANK_PAYMENT_URL`, `SITE_URL=https://fansleak.pages.dev`.
6. Configure a Selar **New Sale** trigger in an integration such as Zapier and forward a normalized JSON body to `POST /webhooks/selar`, using header `X-Selar-Webhook-Secret` set to the same secret. Expected body:
   ```json
   {"reference":"unique-sale-reference","email":"buyer@example.com","amount":1500,"currency":"NGN","product_id":"your-product-id"}
   ```
   `amount` is in naira; `amount_minor` may be supplied instead in kobo. Confirm actual Selar trigger fields using a test sale and map them correctly. The webhook requires the exact product ID.
7. Set Telegram's webhook URL to `https://YOUR-WORKER-DOMAIN/telegram/webhook`, with Telegram's `secret_token` set to `TELEGRAM_WEBHOOK_SECRET`.
8. Verify `GET /health` lists the expected payment methods, then test Selar and bank flows with low-risk test transactions before public launch.

## Admin commands

- `/pending` — list payment/request records requiring attention.
- `/setcontact PROFILE_ID @handle` — save a contact but keep sharing disabled.
- `/enablecontact PROFILE_ID` — record the admin's confirmation that creator sharing is authorised.

## Launch checks

- The Worker and D1 database have not yet been deployed by this PR.
- The real Selar product URL/ID, bank payment URL, price, admin Telegram numeric ID, and secret values must be configured in Cloudflare. Do not paste bot tokens or secrets into GitHub or this chat.
- Selar sale-event fields must be tested in the actual account; this code deliberately expects a normalized event from the forwarding integration.
- The website catalogue is generated from the existing visible profile source during the website build, so it stays in sync when new profiles are added and deployed.
