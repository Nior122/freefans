# FansLeak Telegram Bot

One Telegram bot, two separate Selar products, and two distinct customer journeys. The link the customer opens decides the workflow; customers are not shown a universal product menu.

## The two links

1. **FansLeak contact and assessment:** `https://t.me/KasiQueenbot?start=contact_PROFILE_ID`
   - The profile ID comes from the FansLeak profile's Message button.
   - The bot starts the contact request immediately, collects the customer's email, and sends the customer to the contact/assessment Selar checkout.
   - The contact product's price, checkout URL, and Selar product code are configured separately.
   - A validated sale event is matched to the contact product and request. The admin still verifies the payment and separately approves/rejects the request. Contact sharing requires recorded creator authorisation.

2. **Second service/product purchase:** `https://t.me/KasiQueenbot?start=service_SERVICE_ID`
   - The service ID identifies the second link; no product menu is shown.
   - The AI chats with the customer to understand their request, asks clarifying questions, and shows the configured fixed price when the customer types `PAY`. No email is collected in Telegram.
   - The checkout message includes a unique FansLeak order ID. Configure a required Selar custom checkout field named **FansLeak order ID** and have the trusted webhook adapter pass that field as `order_id` to this Worker. Selar may still request its standard checkout details separately.
   - A validated sale event must match the second product code, exact NGN amount, and exact pending FansLeak order ID. The bot marks that order paid and notifies the admin and customer. Unpaid request text is hidden from `/orders` and is not sent to the admin.
   - The admin sends fulfilment using `/deliver ORDER_ID service details`. The bot forwards those details to the Telegram chat attached to that order and marks it fulfilled. `/deliver` refuses orders that are not payment-verified.

## Selar configuration

Selar is the same payment provider for both products, but each product has its own configuration:

- Contact: `CONTACT_PRICE_NGN`, `SELAR_CHECKOUT_URL`, `SELAR_PRODUCT_ID`
- Second product: `SERVICE_PRICE_NGN`, `SERVICE_CHECKOUT_URL`, `SERVICE_PRODUCT_ID`
- Shared: `SELAR_WEBHOOK_SECRET`

Do not assume a URL slug is the provider's actual product identifier without checking the real Selar event. The webhook expects a trusted forwarding integration to send a normalized payload to `POST /webhooks/selar` with `X-Selar-Webhook-Secret`. The normalized contact-sale payload must contain a unique sale reference, buyer email, amount, currency, product code, and an authoritative successful-payment status. The normalized service-sale payload must contain a unique sale reference, the `FansLeak order ID` custom field mapped to `order_id`, amount, currency, product code, and an authoritative successful-payment status; service-sale matching does not depend on email. A generic “New Sale” event without trustworthy status must not be treated as proof of payment. If a sale matches zero or multiple pending orders, no order is unlocked; the admin is notified for reconciliation.

The contact and service workflows share the Selar webhook but are separated by exact product code and price. Contact payments continue through the contact verification/approval process; service purchases use the separate order table and fulfilment process. The raw Selar custom-field payload mapping still must be verified against a real test sale before launch; until then, missing/unrecognized order IDs fail closed and no service request is released.

## Admin commands

- `/pending` — contact requests awaiting payment verification or approval.
- `/orders` — second-product orders awaiting payment or fulfilment.
- `/deliver ORDER_ID service details` — send fulfilment details to a payment-verified service customer.
- `/setcontact PROFILE_ID @handle` — save a creator contact with sharing disabled.
- `/enablecontact PROFILE_ID` — record admin confirmation that the creator authorised sharing.

## Runtime and database

Cloudflare Worker + D1 for `@KasiQueenbot`; Workers AI is customer support only. It cannot confirm payment, approve contact requests, or release contact details. The `service_orders` table is included in `schema.sql` and must be applied before the updated Worker is launched. This change has not been deployed or applied to the live D1 database.

## Deployment workflow

The GitHub Actions deployment workflow is manual only. It accepts separate contact and second-product prices, checkout URLs, and Selar product codes, configures the shared bot/webhook secrets, deploys the Worker, and connects Telegram's webhook. Do not run it until both product configurations and the real normalized Selar event mapping have been verified.

Required GitHub repository Actions secrets: `CLOUDFLARE_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, and `SELAR_WEBHOOK_SECRET`. Never paste secret values into GitHub issues or chat messages.

## Current status

- Changes are on the feature branch / PR only.
- No Worker deployment, Telegram webhook connection, live D1 migration, or PR merge has been performed.
- Test the real Selar payload mapping and run the non-deploying Wrangler compile check before launch.
