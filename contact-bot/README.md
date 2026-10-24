# FansLeak Telegram Contact Bot

Cloudflare Worker + D1 backend for @KasiQueenbot. The bot logic is separate from payment handling; Selar is the first adapter. New providers should get a new verified webhook route which maps provider-specific events to the same internal sale shape.

## Flow and safeguards

- The bot fetches `/contact-catalogue.json` from the live site, generated from the same profile source as the sitemap. Adding a visible profile and deploying the site updates the catalogue automatically. Contact details are not part of that public catalogue.
- The buyer gives an email and must use the same email at Selar checkout. Payment events are matched only if email, exact NGN amount, optional product ID and a unique transaction reference check out and exactly one pending request matches.
- A payment event must be forwarded by a trusted integration to `POST /webhooks/selar` with header `X-Selar-Webhook-Secret`. The expected normalized body is:
  ```json
  {"reference":"unique-sale-reference","email":"buyer@example.com","amount":1500,"currency":"NGN","product_id":"your-product-id"}
  ```
  `amount` is in naira, not kobo. A payload may use `amount_minor` instead, in kobo.
- Confirm Selar's actual New Sale trigger fields in a test sale and map them in Zapier to this body. Do not send unverified browser redirects, buyer screenshots, or self-reported payment as proof.
- A verified sale does not automatically share a contact. Admin receives Approve/Reject buttons. Rejection requires any refund to be handled separately in Selar.
- Contacts are disabled by default. Admin uses `/setcontact PROFILE_ID @handle`, then `/enablecontact PROFILE_ID` only after verifying the creator explicitly consented. Both actions are audit logged. Approval is blocked without that consent flag.
- Admin commands/buttons require the configured numeric Telegram user ID.

## Setup (not deployed by this PR)

1. Create a Cloudflare D1 database named `fansleak-contact-requests` and put its ID into `wrangler.toml` in place of `REPLACE_WITH_D1_DATABASE_ID`.
2. From the repo root, apply the schema: `npx wrangler d1 execute fansleak-contact-requests --remote --file=contact-bot/schema.sql`.
3. Deploy from `contact-bot/` using Wrangler.
4. Set Worker secrets (never commit them): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, `SELAR_WEBHOOK_SECRET`.
5. Set Worker variables: `SELAR_CHECKOUT_URL` (actual Selar product URL), `CONTACT_PRICE_NGN` (actual product price), optional `SELAR_PRODUCT_ID`, `SITE_URL=https://fansleak.pages.dev`, `PAYMENT_PROVIDER=selar`.
6. Configure a Selar New Sale trigger in an integration such as Zapier and forward a normalized payload to `/webhooks/selar`, setting header `X-Selar-Webhook-Secret` to the same secret. Validate the trigger fields with a real test sale before production.
7. Set Telegram's webhook URL to `https://YOUR-WORKER-DOMAIN/telegram/webhook`, with Telegram's `secret_token` set to `TELEGRAM_WEBHOOK_SECRET`.
8. Configure the website button to open `https://t.me/KasiQueenbot?start=contact_PROFILE_ID`. The current button code is in the website integration PR.

## Portability

A future adapter (for example `/webhooks/paystack`) must validate its own authentic provider event and normalise it to the same internal sale structure. Do not simply change a provider label and reuse Selar validation.

## Launch gates

- The exact Selar event payload must be verified in your account; this code intentionally expects a normalized event from your forwarding integration.
- The checkout URL and price are not guessed or fabricated.
- The Worker, D1 database, webhook secrets and Telegram webhook still need to be deployed/configured and end-to-end tested before treating the bot as live.
