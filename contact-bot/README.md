# FansLeak Telegram Bot

One Telegram bot supports two separate Selar products. The incoming link chooses the flow; customers are not shown a product menu.

## Customer flows

### FansLeak contact/assessment

1. The customer opens a profile's Message link.
2. The bot collects the customer's email in Telegram.
3. The bot creates a unique checkout code such as `FL-7K4P9A` and sends the Selar checkout instructions.
4. The customer must enter their full name followed by the exact code in Selar's **name field**, for example `Joseph Unaogu FL-7K4P9A`.
5. After checkout, the customer taps **Done**. If the name and code have not been submitted to the bot yet, it asks the customer to send the exact name used at checkout, including the code.
6. A matching Selar New Sale event notifies the admin. The bot does not verify payment. The admin checks Selar manually and uses the confirmation button only after confirming the payment. Contact approval and creator-authorised contact sharing remain separate steps.

### Second product/service

1. The customer opens `https://t.me/KasiQueenbot?start=service_SERVICE_ID`.
2. The AI assistant chats with the customer to understand the request. The customer types `PAY` when ready.
3. The bot sends checkout instructions with a unique code, to be entered after the customer's full name in Selar's **name field**.
4. The customer taps **Done** and, if asked, sends the exact full name including the code.
5. A matching Selar New Sale event notifies the admin. The bot does not mark the order paid. The admin checks Selar manually and confirms payment using the button. Fulfilment is sent with `/deliver ORDER_ID service details` only after manual confirmation.

## Selar event mapping

The existing Zapier New Sale workflow should POST to `/webhooks/selar` with `X-Selar-Webhook-Secret` and normalized fields:

- `reference`: unique Selar sale/transaction reference
- `customer_full_name`: full name exactly as Selar received it, including the `FL-XXXXXX` code
- `product_code`: the exact Selar product code

The existing Abandoned Cart workflow should POST to `/webhooks/selar-abandoned-cart` with the same secret and:

- `customer_name`: full name entered in Selar, including the code
- `product_code`: the exact Selar product code
- `abandoned_at`: the event timestamp

Both endpoints route to the correct order by the configured product code plus the unique code in the customer's name. Abandoned-cart events send a customer reminder only when the name/code matches one pending order. Duplicate abandoned-cart events are deduplicated. An event with missing or ambiguous fields fails closed.

**Important:** the current Zapier trigger samples showed a product-code mismatch during inspection. Confirm the real field mappings and product codes before any live launch. Do not send a test purchase or test message to production for this check.

## Payment rules

- **The admin alone confirms payment.** A New Sale event only triggers an admin notification; it never changes an order to payment-verified by itself.
- Amount, currency, and the product's configured price are not used to match an order or verify payment.
- A customer's Done tap or submitted name/code is not proof of payment.
- A name/code mismatch, missing code, unknown product code, or ambiguous match does not verify payment.
- Contact requests still require the existing separate admin approval and creator authorisation before sharing contact details.
- Service fulfilment remains blocked until an admin manually confirms payment.

## Runtime and deployment

- Cloudflare Worker + D1; the Worker has not been deployed by this change.
- Migration `0004_checkout_codes.sql` adds per-order checkout codes and tracks the customer-name prompt after Done.
- The GitHub Actions deploy workflow is manual. Do not run it without explicit authorization; it applies D1 migrations, deploys the Worker, updates secrets, and connects Telegram's webhook.
- Existing Zapier configuration is not changed by this PR.
- Required GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_TELEGRAM_ID`, and `SELAR_WEBHOOK_SECRET`.

## Admin commands

- `/pending` — contact requests awaiting payment verification or approval.
- `/orders` — service orders awaiting payment or fulfilment.
- `/deliver ORDER_ID service details` — send fulfilment to a service customer after manual payment confirmation.
- `/setcontact PROFILE_ID @handle` and `/enablecontact PROFILE_ID` — manage creator contact sharing consent.
