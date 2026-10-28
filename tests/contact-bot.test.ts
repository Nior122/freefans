import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../contact-bot/src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Helper to create an in-memory D1 mock backed by real SQLite with all migrations
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0002_service_orders.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0003_abandoned_carts.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0004_checkout_codes.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0005_one_active_request_per_user.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0006_receipt_review.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0007_front_desk_multi_requests.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0008_delivery_drafts.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0009_service_delivery_drafts.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0010_admin_message_drafts.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0011_admin_broadcast_drafts.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0012_hidden_profiles.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0013_admin_pending_actions.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0014_remove_creator_sharing_permissions.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0015_service_delivery_draft_media.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0016_admin_draft_recovery_actions.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0017_limit_unverified_service_orders.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0018_clear_delivered_media_references.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0019_admin_broadcast_recipients.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0020_receipt_review_actions.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0021_admin_order_deletion_actions.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0022_user_language_preferences.sql'), 'utf8'));

  return {
    raw: db,
    prepare(query: string) {
      let boundValues: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          boundValues = values;
          return this;
        },
        async first<T = Record<string, unknown>>() {
          const stmt = db.prepare(query);
          const row = stmt.get(...(boundValues as any[]));
          return (row as T) ?? null;
        },
        async all<T = Record<string, unknown>>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...(boundValues as any[]));
          return { results: results as T[] };
        },
        async run() {
          const stmt = db.prepare(query);
          const result = stmt.run(...(boundValues as any[]));
          return {
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid)
            }
          };
        }
      };
    }
  };
}

function seedLanguage(db: any, userId: number | string, language = 'en') {
  db.raw.prepare(`
    INSERT INTO user_language_preferences(telegram_user_id,telegram_chat_id,language_code,pending_start_payload)
    VALUES(?,?,?,NULL)
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      telegram_chat_id=excluded.telegram_chat_id,
      language_code=excluded.language_code,
      pending_start_payload=NULL,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).run(String(userId), String(userId), language);
}

// Create a test environment with mock fetch to intercept Telegram API calls and catalogue fetch
function createTestEnv(db: any, options: { failTelegramMethods?: Set<string> } = {}) {
  const sentTelegramMessages: Array<{ method: string; data: Record<string, unknown> }> = [];
  const failTelegramMethods = options.failTelegramMethods || new Set<string>();

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);

    // Mock Telegram Bot API calls
    if (urlStr.includes('api.telegram.org')) {
      const parts = urlStr.split('/');
      const method = parts[parts.length - 1];
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      sentTelegramMessages.push({ method, data: body });
      if (failTelegramMethods.has(method)) {
        return new Response(JSON.stringify({ ok: false, description: 'synthetic Telegram delivery failure' }), {
          status: 502,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 12345 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Mock Public Catalogue endpoint
    if (urlStr.endsWith('/contact-catalogue.json')) {
      return new Response(JSON.stringify({
        version: 1,
        generatedAt: new Date().toISOString(),
        profiles: [
          { id: 'anaimiya', name: 'Anaimiya' },
          { id: 'rosebeck', name: 'RoseBeck' },
          { id: 'sweet_creator', name: 'Sweet Creator' },
          { id: 'emanuela.ebony', name: 'Emanuela Ebony' }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });
  };

  // Temporarily override global fetch for Worker tests
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as any;

  const env = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'test-bot-token-12345',
    TELEGRAM_WEBHOOK_SECRET: 'test-tg-webhook-secret-999',
    ADMIN_TELEGRAM_ID: '10001',
    SELAR_CHECKOUT_URL: 'https://selar.com/j977zh71q8',
    SELAR_PRODUCT_ID: 'j977zh71q8',
    SERVICE_CHECKOUT_URL: 'https://selar.com/x19128f988',
    SERVICE_PRODUCT_ID: 'x19128f988',
    PAYMENT_PROVIDER: 'selar',
    PAYMENT_METHODS: 'selar',
    SITE_URL: 'https://fansleak.pages.dev'
  };

  const cleanup = () => {
    globalThis.fetch = originalFetch;
  };

  return { env, sentTelegramMessages, cleanup, failTelegramMethods };
}

test('Worker health check endpoint returns 200 with service information', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    const res = await worker.fetch(new Request('https://worker.local/health'), env);
    assert.equal(res.status, 200);
    const data = await res.json() as any;
    assert.equal(data.ok, true);
    assert.equal(data.service, 'fansleak-contact-bot');
    assert.equal(data.provider, 'selar');
    assert.deepEqual(data.methods, ['selar']);
  } finally {
    cleanup();
  }
});

test('Telegram webhook validates secret token', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    // Missing secret
    const resNoSecret = await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      body: JSON.stringify({ message: { text: '/start' } })
    }), env);
    assert.equal(resNoSecret.status, 401);

    // Wrong secret
    const resBadSecret = await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
      body: JSON.stringify({ message: { text: '/start' } })
    }), env);
    assert.equal(resBadSecret.status, 401);

    // Valid secret
    const resValid = await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ message: { chat: { id: 123 }, text: '/start' } })
    }), env);
    assert.equal(resValid.status, 200);
  } finally {
    cleanup();
  }
});

test('Customer starting contact request generates unique FL-XXXXXX code and persists order', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5001);
    const update = {
      message: {
        chat: { id: 5001 },
        from: { id: 5001, username: 'customer_joe' },
        text: '/start contact_anaimiya'
      }
    };

    const res = await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(update)
    }), env);
    assert.equal(res.status, 200);

    // Verify row in database
    const order = await db.raw.prepare('SELECT * FROM contact_requests WHERE telegram_user_id = ?').get('5001') as any;
    assert.ok(order, 'Order row must be created');
    assert.equal(order.profile_id, 'anaimiya');
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.payment_method, 'selar');
    assert.match(order.checkout_code, /^FL-[0-9A-Z]{6}$/, 'Order code must match FL-XXXXXX');

    // Verify message sent to customer
    const sent = sentTelegramMessages.find(m => m.method === 'sendMessage' && m.data.chat_id === '5001');
    assert.ok(sent, 'Message must be sent to customer');
    const greeting = String(sent.data.text);
    assert.ok(greeting.includes('Hi babe! I’m Annie for Anaimiya.'));
    assert.ok(greeting.includes(`I’ve started your hot request. Your code is:\n\n👉 <b>${order.checkout_code}</b> 👈`), 'The unique checkout code must be bold, prominent, and on its own line');
    assert.ok(greeting.includes('Tap the <b>Pay now</b> button below to open checkout.'));
    assert.ok(greeting.includes(`write your full name and the code exactly like this:\n\n<b>John Doe ${order.checkout_code}</b>`), 'The example name must include this request’s actual code');
    assert.ok(greeting.includes('This lets me match your payment fast. Do not use email — it will not work.'));
    assert.ok(greeting.includes('all her sexy videos, fresh OnlyFans leaks, way more hot photos of her'));
    assert.ok(greeting.includes('Ready to unlock it all? 🔥'));

    const greetingButtons = ((sent.data.reply_markup as any)?.inline_keyboard || []).flat();
    const payNowButton = greetingButtons.find((button: any) => button.text === '💳 Pay now');
    assert.ok(payNowButton, 'The website-originated greeting must preserve the Pay now button');
    assert.equal(payNowButton.callback_data, `pay_selar:${order.id}`);

    await tgPost(env, callbackFrom(5001, payNowButton.callback_data));
    const checkoutMessage = messagesTo(sentTelegramMessages, '5001').find(m => String(m.data.text).includes('Open the checkout here:'));
    assert.ok(checkoutMessage, 'The Pay now button must send checkout instructions');
    const checkoutButtons = ((checkoutMessage.data.reply_markup as any)?.inline_keyboard || []).flat();
    const openCheckoutButton = checkoutButtons.find((button: any) => button.text === 'Open Checkout ↗️');
    assert.equal(openCheckoutButton?.url, `${env.SELAR_CHECKOUT_URL}?add_to_cart=1`);
  } finally {
    cleanup();
  }
});

test('Direct /start opens Annie welcome, service menu, and channel checkout using service product', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 6101);
    await tgPost(env, userMsg(6101, '/start'));
    const welcome = messagesTo(sentTelegramMessages, '6101').find(m => String(m.data.text).includes('Hey babe, what do you want?'));
    const welcomeText = String(welcome?.data.text);
    assert.ok(welcomeText.includes('💋 <b>Hey babe, what do you want?</b>'));
    assert.ok(welcomeText.includes('Go to our website and see hot photo previews. Look at sexy girls with perfect bodies and naughty poses. These photos are fire and will make you hard. Only photos. No videos.💋'));
    assert.ok(welcomeText.includes('Want the real hot stuff? Join our Telegram channel right now. You get all the OnlyFans videos, fresh leaks, dirty chats, full videos, and new nasty drops every day. This is where it gets wild and addictive.🔞'));
    const welcomeButtons = (welcome?.data.reply_markup as any)?.inline_keyboard?.flat() || [];
    assert.ok(welcomeButtons.some((b: any) => b.text === '📸 Website Photo Previews' && b.url === 'https://fansleak.pages.dev'));
    assert.ok(welcomeButtons.some((b: any) => b.text === '🔥 Telegram Channel' && b.callback_data === 'services:join'));

    // The persistent reply keyboard is set by a short follow-up so the
    // customer always has a 🚀 Start button beside the message box.
    const startTip = messagesTo(sentTelegramMessages, '6101').at(-1);
    assert.ok(String(startTip?.data.text).includes('tap <b>🚀 Start</b>'));
    const startKeyboard = (startTip?.data.reply_markup as any) || {};
    assert.equal(startKeyboard.is_persistent, true);
    assert.equal(startKeyboard.resize_keyboard, true);
    assert.ok((startKeyboard.keyboard || []).flat().some((b: any) => b.text === '🚀 Start'));

    // Tapping that persistent button sends its label as text and must behave
    // exactly like /start, even mid-conversation.
    const beforeRestart = messagesTo(sentTelegramMessages, '6101').length;
    await tgPost(env, userMsg(6101, '🚀 Start'));
    const afterRestart = messagesTo(sentTelegramMessages, '6101').slice(beforeRestart);
    assert.ok(afterRestart.some(m => String(m.data.text).includes('Hey babe, what do you want?')), '🚀 Start must reopen the welcome menu');

    await tgPost(env, callbackFrom(6101, 'services:view', 'services-view'));
    const menu = messagesTo(sentTelegramMessages, '6101').at(-1);
    assert.match(String(menu?.data.text), /photos only — no videos/i);
    assert.match(String(menu?.data.text), /authorised content shared with permission/i);
    assert.ok((menu?.data.reply_markup as any)?.inline_keyboard?.flat().some((b: any) => b.text === '📸 Visit the website ✨' && b.url === 'https://fansleak.pages.dev'));
    assert.ok((menu?.data.reply_markup as any)?.inline_keyboard?.flat().some((b: any) => b.callback_data === 'services:join'));

    await tgPost(env, callbackFrom(6101, 'services:join', 'services-join'));
    const order = db.raw.prepare('SELECT * FROM service_orders WHERE telegram_user_id = ?').get('6101') as any;
    assert.ok(order, 'Channel subscription must create a service order');
    assert.equal(order.service_id, 'telegram_channel');
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.payment_method, 'selar');
    assert.match(order.checkout_code, /^FL-[0-9A-Z]{6}$/);
    assert.match(String(order.request_text), /services menu/i);

    const checkoutMessage = messagesTo(sentTelegramMessages, '6101').at(-1);
    const buttons = (checkoutMessage?.data.reply_markup as any)?.inline_keyboard?.flat() || [];
    assert.ok(buttons.some((b: any) => b.text === '💳 Pay now' && String(b.url).startsWith('https://selar.com/x19128f988')));
    assert.ok(buttons.some((b: any) => b.text === '✅ Done — checkout completed'));
    assert.ok(buttons.some((b: any) => b.text === "🔎 I've paid — check again"));
    assert.match(String(checkoutMessage?.data.text), new RegExp(order.checkout_code));
    assert.doesNotMatch(
      messagesTo(sentTelegramMessages, String(env.ADMIN_TELEGRAM_ID)).map(m => String(m.data.text)).join("\n"),
      /New channel subscription order|Source: Telegram bot → View our services/
    );
    assert.match(String(checkoutMessage?.data.text), /👉 <b>Unique code = FL-[0-9A-Z]{6}<\/b> 👈/);
    assert.match(String(checkoutMessage?.data.text), /<b>Example:<\/b>\n<code>John Doe FL-[0-9A-Z]{6}<\/code>/);
    assert.match(String(checkoutMessage?.data.text), /You're about to join our channel/);
  } finally {
    cleanup();
  }
});

test('Starting request with invalid profile fails closed', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5002);
    // Non-existent profile
    const update = {
      message: {
        chat: { id: 5002 },
        from: { id: 5002 },
        text: '/start contact_non_existent_profile'
      }
    };

    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(update)
    }), env);

    const order = await db.raw.prepare('SELECT * FROM contact_requests WHERE telegram_user_id = ?').get('5002');
    assert.equal(order, undefined, 'No order should be created for non-existent profile');

    const sent = sentTelegramMessages.find(m => m.data.chat_id === '5002');
    assert.ok(String(sent?.data.text).includes('not currently listed on our website'));
  } finally {
    cleanup();
  }
});

test('Separate service orders are created and isolated from contact requests', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 6001);
    const update = {
      message: {
        chat: { id: 6001 },
        from: { id: 6001, username: 'service_user' },
        text: '/start service_consultation1'
      }
    };

    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(update)
    }), env);

    const serviceOrder = await db.raw.prepare('SELECT * FROM service_orders WHERE telegram_user_id = ?').get('6001') as any;
    assert.ok(serviceOrder, 'Service order must exist in service_orders table');
    assert.equal(serviceOrder.service_id, 'consultation1');
    assert.equal(serviceOrder.status, 'awaiting_request');
    assert.match(serviceOrder.checkout_code, /^FL-[0-9A-Z]{6}$/);

    // Verify contact_requests has NO entry for this user
    const contactOrder = await db.raw.prepare('SELECT * FROM contact_requests WHERE telegram_user_id = ?').get('6001');
    assert.equal(contactOrder, undefined, 'Service orders must not enter contact_requests table');
  } finally {
    cleanup();
  }
});

test('Selar webhook authentication, product routing, and idempotent reconciliation', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    // 1. Insert a pending contact request
    const code = 'FL-7K4P9A';
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, telegram_username, profile_id, status, payment_method, checkout_code, checkout_name)
      VALUES ('req-uuid-1', '5005', '5005', 'testbuyer', 'anaimiya', 'pending_payment', 'selar', ?, 'Joseph Unaogu')
    `).run(code);

    // 2. Reject webhook with invalid secret
    const resBadSecret = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'wrong' },
      body: JSON.stringify({ reference: 'selar_ref_001', product_code: env.SELAR_PRODUCT_ID, customer_full_name: `Joseph Unaogu ${code}` })
    }), env);
    assert.equal(resBadSecret.status, 401);

    // 3. Reject wrong product code (e.g. deleted product b9e1878f99)
    const resWrongProduct = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({ reference: 'selar_ref_002', product_code: 'b9e1878f99', customer_full_name: `Joseph Unaogu ${code}` })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });
    assert.equal(resWrongProduct.status, 422);

    // 4. Valid Selar sale event matching the order code
    const resValid = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        reference: 'selar_ref_100',
        product_code: env.SELAR_PRODUCT_ID,
        customer_full_name: `Joseph Unaogu ${code}`,
        email: 'joseph@example.com'
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });
    assert.equal(resValid.status, 200);
    const validJson = await resValid.json() as any;
    assert.equal(validJson.ok, true);
    assert.equal(validJson.matched, true);

    // CRITICAL: Order status MUST STILL BE 'pending_payment' (never auto-verified!)
    const orderAfterSale = await db.raw.prepare('SELECT * FROM contact_requests WHERE id = ?').get('req-uuid-1') as any;
    assert.equal(orderAfterSale.status, 'pending_payment', 'Webhook alone must never auto-verify payment');
    assert.equal(orderAfterSale.payment_reference, 'selar_ref_100', 'Payment reference must be attached for admin inspection');

    // 5. Test idempotency: repeated delivery of identical sale reference returns duplicate
    const resDuplicate = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        reference: 'selar_ref_100',
        product_code: env.SELAR_PRODUCT_ID,
        customer_full_name: `Joseph Unaogu ${code}`,
        email: 'joseph@example.com'
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });
    assert.equal(resDuplicate.status, 200);
    const dupJson = await resDuplicate.json() as any;
    assert.equal(dupJson.duplicate, true, 'Repeated webhook delivery must be detected as duplicate');
  } finally {
    cleanup();
  }
});

test('Exact saved full checkout name reconciles only when no conflicting FL code is supplied', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, checkout_name)
      VALUES ('full-name-match', '5101', '5101', 'anaimiya', 'pending_payment', 'selar', 'FL-NAME01', 'Joseph Simon Unaogu')
    `).run();

    const partial = await selarPost(env, { reference: 'ref-partial-name', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Joseph FL-UNKNWN' });
    assert.deepEqual(await partial.json(), { ok: true, matched: false, reason: 'no_unique_code_or_name_match' });
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).length, 0, 'partial name must not notify admin');

    const conflictingCode = await selarPost(env, { reference: 'ref-full-name-conflicting-code', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Joseph Simon Unaogu FL-UNKNWN' });
    assert.deepEqual(await conflictingCode.json(), { ok: true, matched: false, reason: 'no_unique_code_or_name_match' }, 'a supplied FL code that does not belong to the name-matched order is conflicting evidence and must block name-only attachment');
    assert.equal((db.raw.prepare('SELECT payment_reference FROM contact_requests WHERE id=?').get('full-name-match') as any).payment_reference, null);
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).length, 0, 'conflicting code/name evidence must not notify admin as an attached sale');

    const exact = await selarPost(env, { reference: 'ref-full-name', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Joseph Simon Unaogu' });
    const exactJson = await exact.json() as any;
    assert.equal(exactJson.matched, true);
    assert.equal(exactJson.reconciled_by, 'exact_full_name');
    const order = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id=?').get('full-name-match') as any;
    assert.equal(order.status, 'pending_payment', 'full-name reconciliation must still require manual verification');
    assert.equal(order.payment_reference, 'ref-full-name');
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 1);
  } finally {
    cleanup();
  }
});

test('A unique email never attaches a Selar sale when code and exact-name evidence do not match', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, checkout_name, buyer_email)
      VALUES ('req-uuid-2', '5006', '5006', 'anaimiya', 'pending_payment', 'selar', 'FL-999999', 'Joseph Solo Name', 'clue@example.com')
    `).run();

    const res = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        reference: 'selar_ref_email_clue',
        product_code: env.SELAR_PRODUCT_ID,
        customer_full_name: 'Joseph Solo Name Without Code',
        email: 'clue@example.com'
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, matched: false, reason: 'no_unique_code_or_name_match' });
    const order = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id = ?').get('req-uuid-2') as any;
    assert.equal(order.status, 'pending_payment', 'email evidence must never verify payment');
    assert.equal(order.payment_reference, null, 'email evidence must never attach a payment reference');
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 0, 'an email-only sale must not be presented as attached');
    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get() as any).cnt, 0, 'an unmatched email-only event is not consumed');
  } finally {
    cleanup();
  }
});

test('Verified request delivery sends only admin-composed fulfilment, with no stored creator contact', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    const requestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '9501', '9501', 'anaimiya', 'payment_verified', 'selar', 'ref-approved', 'FL-READY1')`).run(requestId);

    await tgPost(env, adminMsg('/setcontact anaimiya @synthetic_retired_handle'));
    assert.equal(db.raw.prepare('SELECT contact_value FROM creator_contacts WHERE profile_id=?').get('anaimiya'), undefined, 'the retired command must not save a creator contact');
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('does not store or share a creator contact')));
    db.raw.prepare("INSERT INTO creator_contacts(profile_id,contact_value) VALUES('anaimiya','@synthetic_legacy_contact')").run();

    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `approve:${requestId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(requestId) as any).status, 'payment_verified');
    assert.equal(messagesTo(sentTelegramMessages, '9501').filter(m => String(m.data.text || '').includes('@synthetic_retired_handle')).length, 0, 'Opening a draft must not send any stored creator contact');

    const draft = db.raw.prepare('SELECT id FROM delivery_drafts WHERE request_id=?').get(requestId) as any;
    assert.ok(draft, 'A verified request can open the delivery draft with no saved creator contact or retired permission commands');
    await tgPost(env, adminMsg('Here is the admin-prepared fulfilment for your request.'));
    await tgPost(env, callbackFrom(10001, `draft:send:${draft.id}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(requestId) as any).status, 'approved');
    assert.equal(messagesTo(sentTelegramMessages, '9501').filter(m => String(m.data.text || '').includes('Here is the admin-prepared fulfilment for your request.')).length, 1, 'Only the admin-composed fulfilment is delivered after confirmation');
    assert.equal(messagesTo(sentTelegramMessages, '9501').filter(m => String(m.data.text || '').includes('@synthetic_retired_handle')).length, 0, 'No creator contact is appended to delivery');
    assert.equal(messagesTo(sentTelegramMessages, '9501').filter(m => String(m.data.text || '').includes('@synthetic_legacy_contact')).length, 0, 'A pre-existing legacy creator_contacts row is ignored by delivery');

    await tgPost(env, adminMsg('/help'));
    const help = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(!help.includes('/setcontact'));
    assert.ok(!help.includes('/enablecontact'));
    assert.ok(!help.includes('/disablecontact'));
    assert.ok(!help.includes('/authorizecontact'));
    assert.ok(help.includes('no stored creator contact to share'));
  } finally {
    cleanup();
  }
});

test('Service order delivery safeguards and fulfilment flow', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const serviceOrderId = crypto.randomUUID();
    db.raw.prepare(`
      INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, checkout_code, checkout_name)
      VALUES (?, 'custom_service', '7001', '7001', 'awaiting_request', 'FL-SRV100', 'Customer One')
    `).run(serviceOrderId);

    // 1. Customer typing PAY moves to pending_payment and sends checkout instructions
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 7001 }, from: { id: 7001 }, text: 'I want a custom banner designed' }
      })
    }), env);

    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 7001 }, from: { id: 7001 }, text: 'PAY' }
      })
    }), env);

    let order = await db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'pending_payment');

    // 2. Admin cannot deliver before payment is verified
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/deliver ${serviceOrderId} here is your link` }
      })
    }), env);

    order = await db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'pending_payment', 'Delivery blocked before payment verification');

    // 3. Selar payment webhook arrives for service product
    await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        reference: 'selar_srv_ref_1',
        product_code: env.SERVICE_PRODUCT_ID,
        customer_full_name: 'Customer One FL-SRV100',
        email: 'customer1@example.com'
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    // 4. Admin confirms payment manually via serviceverify
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        callback_query: {
          id: 'cb-srv-1',
          from: { id: 10001 },
          message: { chat: { id: 10001 } },
          data: `serviceverify:${serviceOrderId}`
        }
      })
    }), env);

    order = await db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'payment_verified');

    // 5. Admin creates a draft; creating it must not send or fulfil automatically.
    sentTelegramMessages.length = 0;
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/deliver ${serviceOrderId} Here is your completed asset package: https://files.example.com/asset.zip` }
      })
    }), env);

    order = await db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'payment_verified', 'Draft creation must not mark an order fulfilled');
    assert.equal(sentTelegramMessages.some(m => m.method === 'sendMessage' && m.data.chat_id === '7001'), false, 'Customer receives nothing before explicit confirmation');
    const preview = sentTelegramMessages.find(m => m.method === 'sendMessage' && String(m.data.chat_id) === '10001' && String(m.data.text).includes('Service fulfilment draft'));
    assert.ok(preview, 'Admin receives a preview');
    assert.ok(String(preview.data.text).includes('https://files.example.com/asset.zip'));
    const sendButton = (preview.data.reply_markup as any).inline_keyboard.flat().find((b: any) => String(b.callback_data).startsWith('service-delivery:send:'));
    assert.ok(sendButton, 'Preview has explicit send confirmation button');
    await tgPost(env, callbackFrom(10001, sendButton.callback_data, 'cb-service-send'));

    order = await db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'fulfilled');
    const customerDeliveryMsg = sentTelegramMessages.find(m => m.method === 'sendMessage' && String(m.data.chat_id) === '7001');
    assert.ok(customerDeliveryMsg, 'Customer must receive fulfilment only after confirmation');
    assert.ok(String(customerDeliveryMsg.data.text).includes('https://files.example.com/asset.zip'));
    const draft = db.raw.prepare('SELECT status FROM service_delivery_drafts WHERE service_order_id=?').get(serviceOrderId) as any;
    assert.equal(draft.status, 'sent');
  } finally {
    cleanup();
  }
});

test('Selar abandoned-cart webhook authentication and deduplication', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    const code = 'FL-CART99';
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, checkout_name)
      VALUES ('req-cart-1', '8001', '8001', 'anaimiya', 'pending_payment', 'selar', ?, 'Cart Customer')
    `).run(code);

    // 1. Unauthorised webhook without secret returns 401
    const resNoAuth = await worker.fetch(new Request('https://worker.local/webhooks/selar-abandoned-cart', {
      method: 'POST',
      body: JSON.stringify({ product_code: env.SELAR_PRODUCT_ID, customer_name: `Cart Customer ${code}`, abandoned_at: '2026-10-26T00:00:00Z' })
    }), env);
    assert.equal(resNoAuth.status, 401);

    // 2. Valid abandoned cart event
    const resValid = await worker.fetch(new Request('https://worker.local/webhooks/selar-abandoned-cart', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        product_code: env.SELAR_PRODUCT_ID,
        customer_name: `Cart Customer ${code}`,
        abandoned_at: '2026-10-26T00:00:00Z'
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(resValid.status, 200);
    const validJson = await resValid.json() as any;
    assert.equal(validJson.ok, true);
    assert.equal(validJson.matched, true);
    assert.equal(validJson.reminder_sent, true);

    // 3. Repeated delivery of the exact same event returns duplicate
    const resDup = await worker.fetch(new Request('https://worker.local/webhooks/selar-abandoned-cart', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        product_code: env.SELAR_PRODUCT_ID,
        customer_name: `Cart Customer ${code}`,
        abandoned_at: '2026-10-26T00:00:00Z'
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(resDup.status, 200);
    const dupJson = await resDup.json() as any;
    assert.equal(dupJson.duplicate, true);
  } finally {
    cleanup();
  }
});

test('Service order email is saved only as audit information and never reconciles a sale', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    const userId = '9100';
    const serviceOrderId = 'srv-email-1';
    const code = 'FL-SRVEM1';

    db.raw.prepare(`
      INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, checkout_code, request_text)
      VALUES (?, 'custom-ai', ?, ?, 'pending_payment', ?, 'I need custom design work')
    `).run(serviceOrderId, userId, userId, code);

    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ message: { chat: { id: 9100 }, from: { id: 9100 }, text: 'client@example.com' } })
    }), env);

    const savedOrder = db.raw.prepare('SELECT buyer_email FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(savedOrder.buyer_email, 'client@example.com');
    const customerAck = sentTelegramMessages.find(m => m.data.chat_id === '9100' && String(m.data.text).includes('saved with your order information') && String(m.data.text).includes('cannot match or verify payment'));
    assert.ok(customerAck, 'Customer should be told the email is audit information only and cannot match payment');

    const saleRes = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({ reference: 'selar-srv-email-ref-1', buyer_email: 'client@example.com', customer_full_name: 'Client Without Code', product_code: env.SERVICE_PRODUCT_ID })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(saleRes.status, 200);
    assert.deepEqual(await saleRes.json(), { ok: true, matched: false, reason: 'no_unique_code_or_name_match' });
    const updatedOrder = db.raw.prepare('SELECT status, payment_method, payment_reference FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(updatedOrder.status, 'pending_payment', 'email evidence is not payment verification');
    assert.equal(updatedOrder.payment_reference, null, 'email evidence must not attach the sale');
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 0);
  } finally {
    cleanup();
  }
});

test('Ambiguous shared email is not enough to reconcile a sale', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    db.raw.prepare(`
      INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, checkout_code, buyer_email)
      VALUES ('srv-amb-1', 'srv-1', '9201', '9201', 'pending_payment', 'FL-AMB001', 'shared@example.com'),
             ('srv-amb-2', 'srv-2', '9202', '9202', 'pending_payment', 'FL-AMB002', 'shared@example.com')
    `).run();

    const saleRes = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        reference: 'selar-amb-ref-1',
        buyer_email: 'shared@example.com',
        customer_full_name: 'Ambiguous Customer',
        product_code: env.SERVICE_PRODUCT_ID
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(saleRes.status, 200);
    assert.deepEqual(await saleRes.json(), { ok: true, matched: false, reason: 'no_unique_code_or_name_match' });
    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get() as any).cnt, 0);
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).length, 0);
  } finally {
    cleanup();
  }
});

test('Checkout code collision exhaust fails safely without returning unchecked code', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 9301);
    // Create a mock DB where prepare('SELECT id FROM ...') always returns a collision
    const collidingDb = {
      ...db,
      prepare(query: string) {
        if (query.includes('SELECT id FROM contact_requests WHERE checkout_code=?') ||
            query.includes('SELECT id FROM service_orders WHERE checkout_code=?')) {
          return {
            bind() { return this; },
            async first() { return { id: 'colliding-id' }; },
            async all() { return { results: [{ id: 'colliding-id' }] }; },
            async run() { return { meta: { changes: 1 } }; }
          };
        }
        return db.prepare(query);
      }
    };

    const res = await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 9301 }, from: { id: 9301 }, text: '/start contact_anaimiya' }
      })
    }), { ...env, DB: collidingDb as any });

    assert.equal(res.status, 200);
    // Should not crash and no row with unchecked code should be inserted into real DB
    const count = db.raw.prepare("SELECT count(*) as cnt FROM contact_requests WHERE telegram_user_id='9301'").get() as any;
    assert.equal(count.cnt, 0);
  } finally {
    cleanup();
  }
});

test('Uncertain service delivery outcome locks the draft against duplicate sending', async () => {
  const db = createTestDb();
  let failNextTgSend = false;
  const sentTelegramMessages: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('api.telegram.org')) {
      if (failNextTgSend && urlStr.includes('sendMessage')) {
        failNextTgSend = false;
        return new Response(JSON.stringify({ ok: false, description: 'Simulated network outage' }), { status: 500 });
      }
      sentTelegramMessages.push({ method: urlStr.split('/').pop(), data: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }
    return originalFetch(url, init);
  };
  const env: any = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    ADMIN_TELEGRAM_ID: '10001',
    SERVICE_CHECKOUT_URL: 'https://selar.com/x19128f988',
    SERVICE_PRODUCT_ID: 'x19128f988'
  };
  try {
    const serviceOrderId = '11111111-2222-3333-4444-555555555555';
    db.raw.prepare(`
      INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, checkout_code)
      VALUES (?, 'custom-work', '9401', '9401', 'payment_verified', 'FL-DELIV1')
    `).run(serviceOrderId);

    await tgPost(env, adminMsg(`/deliver ${serviceOrderId} Fulfilment package contents`));
    const preview = sentTelegramMessages.find(m => m.method === 'sendMessage' && String(m.data.chat_id) === '10001' && String(m.data.text).includes('Service fulfilment draft'));
    assert.ok(preview, 'Admin must receive a draft preview');
    const sendButton = (preview.data.reply_markup as any).inline_keyboard.flat().find((b: any) => String(b.callback_data).startsWith('service-delivery:send:'));
    assert.ok(sendButton);

    failNextTgSend = true;
    await tgPost(env, callbackFrom(10001, sendButton.callback_data, 'cb-service-fail'));
    const order = db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'payment_verified', 'Uncertain send must not mark the order fulfilled');
    const draft = db.raw.prepare('SELECT status FROM service_delivery_drafts WHERE service_order_id=?').get(serviceOrderId) as any;
    assert.equal(draft.status, 'sending', 'Uncertain send remains locked to avoid duplicate delivery');
    assert.equal(sentTelegramMessages.some(m => m.method === 'sendMessage' && String(m.data.chat_id) === '9401'), false, 'Failed send must not be treated as delivered');

    await tgPost(env, adminMsg(`/deliver ${serviceOrderId} Fulfilment package contents`));
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendMessage' && String(m.data.chat_id) === '9401').length, 0, 'A locked uncertain delivery cannot be retried blindly');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Non-admin users cannot use retired creator-contact commands to create records', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(9999, '/setcontact anaimiya @synthetic_attacker_handle'));
    assert.equal(db.raw.prepare("SELECT * FROM creator_contacts WHERE profile_id='anaimiya'").get(), undefined);
    await tgPost(env, userMsg(9999, '/enablecontact anaimiya'));
    await tgPost(env, userMsg(9999, '/disablecontact anaimiya'));
    assert.equal(db.raw.prepare("SELECT * FROM creator_contacts WHERE profile_id='anaimiya'").get(), undefined);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Additional negative-security and edge-case coverage
// ---------------------------------------------------------------------------

function tgPost(env: any, payload: any) {
  return worker.fetch(new Request('https://worker.local/telegram/webhook', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
    body: JSON.stringify(payload)
  }), env);
}
function userMsg(userId: number, text: string) {
  return { message: { chat: { id: userId }, from: { id: userId }, text } };
}
function adminMsg(text: string) {
  return userMsg(10001, text);
}
function callbackFrom(userId: number, data: string, id = 'cb-test') {
  return { callback_query: { id, from: { id: userId }, message: { chat: { id: userId } }, data } };
}
function selarPost(env: any, body: any, secret = 'selar-secret-123') {
  return worker.fetch(new Request('https://worker.local/webhooks/selar', {
    method: 'POST',
    headers: { 'x-selar-webhook-secret': secret },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });
}
function messagesTo(sent: any[], chatId: string) {
  return sent.filter(m => m.method === 'sendMessage' && String(m.data.chat_id) === chatId);
}

test('Admin natural-language queries are allowlisted and command suffixes are normalized', async () => {
  const db=createTestDb();
  const {env,cleanup,sentTelegramMessages}=createTestEnv(db);
  try {
    const id=crypto.randomUUID();
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)").run(id,'6000','6000','anaimiya','pending_payment','FL-AI0001');
    await tgPost(env,adminMsg('show pending contact requests'));
    assert.ok(sentTelegramMessages.some(m=>String(m.data.text||'').includes('FL-AI0001')),'allowlisted read-only query returns actual database data');
    sentTelegramMessages.length=0;
    await tgPost(env,adminMsg('/pending@KasiQueenbot'));
    assert.ok(sentTelegramMessages.some(m=>String(m.data.text||'').includes(id)),'Telegram @BotName suffixes are normalized for supported admin commands');
    await tgPost(env,adminMsg('/setcontact@KasiQueenbot anaimiya @synthetic_retired_handle'));
    assert.equal(db.raw.prepare("SELECT contact_value FROM creator_contacts WHERE profile_id='anaimiya'").get(),undefined,'the retired creator-contact command cannot save a contact even with a bot suffix');
    await tgPost(env,callbackFrom(9999,'admin:consentconfirm:anaimiya'));
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action='creator_consent_confirmed'").get() && (db.raw.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action='creator_consent_confirmed'").get() as any).n,0,'the removed permission workflow cannot be invoked by non-admin users');
  } finally { cleanup(); }
});
test('Dotted profile IDs resolve via the Telegram-safe start parameter; malformed IDs fail closed', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5101);
    seedLanguage(db, 5102);
    seedLanguage(db, 5103);
    await tgPost(env, userMsg(5101, '/start contact_emanuela_dot_ebony'));
    const order = db.raw.prepare('SELECT * FROM contact_requests WHERE telegram_user_id = ?').get('5101') as any;
    assert.ok(order, 'Encoded dotted profile ID must create a request');
    assert.equal(order.profile_id, 'emanuela.ebony');
    assert.equal(order.status, 'pending_payment');
    const greeting = messagesTo(sentTelegramMessages, '5101')[0];
    assert.ok(String(greeting.data.text).includes('Emanuela Ebony'));

    await tgPost(env, userMsg(5102, '/start contact_../../etc'));
    assert.equal(db.raw.prepare('SELECT * FROM contact_requests WHERE telegram_user_id = ?').get('5102'), undefined);
    assert.ok(String(messagesTo(sentTelegramMessages, '5102')[0].data.text).includes('Invalid profile link'));

    await tgPost(env, userMsg(5103, '/start contact_'));
    assert.equal(db.raw.prepare('SELECT * FROM contact_requests WHERE telegram_user_id = ?').get('5103'), undefined);
  } finally {
    cleanup();
  }
});

test('An open contact request does not block a service purchase, and an open service order does not block a contact request', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5191);
    seedLanguage(db, 5192);
    await tgPost(env, userMsg(5191, '/start contact_anaimiya'));
    await tgPost(env, userMsg(5191, '/start service_website'));
    assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM contact_requests WHERE telegram_user_id='5191'").get() as any).n, 1);
    assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM service_orders WHERE telegram_user_id='5191'").get() as any).n, 1);
    assert.ok(messagesTo(sentTelegramMessages, '5191').some(m => String(m.data.text).includes('Tell me what you need')));

    await tgPost(env, userMsg(5192, '/start service_website'));
    await tgPost(env, userMsg(5192, '/start contact_rosebeck'));
    assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM service_orders WHERE telegram_user_id='5192'").get() as any).n, 1);
    assert.equal((db.raw.prepare("SELECT COUNT(*) AS n FROM contact_requests WHERE telegram_user_id='5192'").get() as any).n, 1);
  } finally {
    cleanup();
  }
});

test('Customer can have up to three unpaid contact requests and still gets payment-check buttons', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5110);
    await tgPost(env, userMsg(5110, '/start contact_anaimiya'));
    await tgPost(env, userMsg(5110, '/start contact_rosebeck'));
    await tgPost(env, userMsg(5110, '/start contact_sweet_creator'));
    const count = db.raw.prepare("SELECT count(*) AS cnt FROM contact_requests WHERE telegram_user_id='5110' AND status IN ('awaiting_email','pending_payment')").get() as any;
    assert.equal(count.cnt, 3, 'Customer may have three unpaid contact requests');
    await tgPost(env, userMsg(5110, '/start contact_emanuela_dot_ebony'));
    const afterLimit = db.raw.prepare("SELECT count(*) AS cnt FROM contact_requests WHERE telegram_user_id='5110' AND status IN ('awaiting_email','pending_payment')").get() as any;
    assert.equal(afterLimit.cnt, 3, 'Fourth unpaid request must be blocked');
    const limitMessage = messagesTo(sentTelegramMessages, '5110').at(-1);
    assert.ok(String(limitMessage?.data.text).includes('3 requests awaiting payment'));
    const markup = limitMessage?.data.reply_markup as any;
    assert.ok(markup?.inline_keyboard?.flat().some((button: any) => String(button.text).includes('Check')));
    // The customer can still chat while all three requests are pending.
    await tgPost(env, userMsg(5110, 'Can you explain what happens next?'));
    assert.ok(messagesTo(sentTelegramMessages, '5110').some(m => String(m.data.text).includes("I'm here to help with your FansLeak requests") || String(m.data.text).includes('front-desk assistant') || String(m.data.text).includes("I'm Annie")));
  } finally {
    cleanup();
  }
});

test('Non-admin users cannot invoke admin callbacks or commands', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const reqId = crypto.randomUUID();
    const svcId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5120', '5120', 'anaimiya', 'pending_payment', 'selar', 'ref-attack-1', 'FL-ATK001')`).run(reqId);
    db.raw.prepare(`INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, 'svc', '5121', '5121', 'pending_payment', 'selar', 'ref-attack-2', 'FL-ATK002')`).run(svcId);
    // A pre-existing legacy contact row must never be disclosed by delivery callbacks.
    db.raw.prepare(`INSERT INTO creator_contacts (profile_id, contact_value)
      VALUES ('anaimiya', '@synthetic_legacy_handle')`).run();

    const attacker = 9999;
    for (const data of [`selarverify:${reqId}`, `approve:${reqId}`, `reject:${reqId}`, `serviceverify:${svcId}`]) {
      await tgPost(env, callbackFrom(attacker, data));
    }
    for (const text of ['/enablecontact rosebeck', '/disablecontact anaimiya', '/setcontact rosebeck @evil_handle', `/deliver ${svcId} pwned`, `/verify ${reqId} FORGEDREF`, `/verifyservice ${svcId} FORGEDREF`, '/pending', '/orders']) {
      await tgPost(env, userMsg(attacker, text));
    }

    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any).status, 'pending_payment');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(svcId) as any).status, 'pending_payment');
    assert.equal((db.raw.prepare("SELECT contact_value FROM creator_contacts WHERE profile_id='anaimiya'").get() as any).contact_value, '@synthetic_legacy_handle', 'retired commands must not alter a legacy contact row');
    assert.equal(db.raw.prepare("SELECT * FROM creator_contacts WHERE profile_id='rosebeck'").get(), undefined, 'Attacker /setcontact must not store a contact');
    for (const chat of ['5120', '5121']) {
      assert.equal(messagesTo(sentTelegramMessages, chat).filter(m => String(m.data.text).includes('@synthetic_legacy_handle') || String(m.data.text).includes('pwned')).length, 0);
    }
    assert.equal(messagesTo(sentTelegramMessages, '9999').filter(m => String(m.data.text).includes(reqId) || String(m.data.text).includes('@synthetic_legacy_handle')).length, 0, 'Admin listings must not leak to non-admins');
  } finally {
    cleanup();
  }
});

test('Selar webhook negative cases and mismatched code/name never mutate payment state', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    const reqId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, checkout_name)
      VALUES (?, '5130', '5130', 'anaimiya', 'pending_payment', 'selar', 'FL-NEG001', 'Real Name')`).run(reqId);
    const validSale = { reference: 'ref-neg-1', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Real Name FL-NEG001', email: 'buyer5130@example.com' };

    assert.equal((await selarPost(env, validSale, 'wrong-secret')).status, 401, 'bad secret');
    assert.equal((await selarPost(env, '{not json')).status, 400, 'malformed JSON');
    assert.equal((await selarPost(env, { reference: 'ref-neg-2', customer_full_name: 'Real Name FL-NEG001' })).status, 400, 'missing product code');
    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-3', product_code: 'unknown-product' })).status, 422, 'wrong product');

    const noCode = await selarPost(env, { reference: 'ref-neg-4', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'No Code Here', email: 'nobody@example.com' });
    assert.equal(noCode.status, 200);
    assert.deepEqual(await noCode.json(), { ok: true, matched: false, reason: 'no_unique_code_or_name_match' });

    const codeMatchNameMismatch = await selarPost(env, { ...validSale, reference: 'ref-neg-5', customer_full_name: 'Other Person FL-NEG001' });
    const codeMatchJson = await codeMatchNameMismatch.json() as any;
    assert.equal(codeMatchJson.matched, false, 'a saved checkout name must agree with the code, and email is never a fallback');
    assert.equal(codeMatchJson.reason, 'no_unique_code_or_name_match');
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 0, 'mismatched identity clues must not attach a sale');

    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-6', status: 'failed' })).status, 422, 'explicitly non-paid events are rejected');
    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-7', padding: 'A'.repeat(70000) })).status, 413, 'oversized payload');

    const order = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.payment_reference, null, 'mismatched name/code must not attach a payment reference');
    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get() as any).cnt, 0, 'unmatched sale events are not consumed');
  } finally {
    cleanup();
  }
});

test('Duplicate Selar webhook delivery records one sale and one admin notification', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const reqId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, checkout_name)
      VALUES (?, '5140', '5140', 'anaimiya', 'pending_payment', 'selar', 'FL-DUP001', 'Buyer Person')`).run(reqId);
    const sale = { reference: 'ref-dup-1', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Buyer Person FL-DUP001', email: 'dup@example.com' };

    assert.equal((await (await selarPost(env, sale)).json()).matched, true);
    assert.equal((await (await selarPost(env, sale)).json()).duplicate, true);
    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get() as any).cnt, 1);
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 1);
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any).status, 'pending_payment', 'Duplicate delivery must not verify or deliver');
  } finally {
    cleanup();
  }
});

test('Saved email is audit information only and checkout-name confirmation never verifies payment', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5150);
    seedLanguage(db, 5151);
    await tgPost(env, userMsg(5150, '/start contact_anaimiya'));
    let order = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='5150'").get() as any;

    await tgPost(env, userMsg(5150, 'buyer5150@example.com'));
    order = db.raw.prepare('SELECT * FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.equal(order.buyer_email, 'buyer5150@example.com');
    assert.equal(order.status, 'pending_payment', 'Saving email audit information must not verify payment');
    assert.ok(messagesTo(sentTelegramMessages, '5150').some(m => String(m.data.text).includes('cannot match or verify payment')));
    assert.ok(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).some(m => String(m.data.text).includes('email for audit context') && String(m.data.text).includes('cannot match, attach, verify, or approve')));

    await tgPost(env, callbackFrom(5150, `pay_selar:${order.id}`));
    await tgPost(env, callbackFrom(5150, `done:${order.id}`));
    await tgPost(env, userMsg(5150, `Buyer Name ${order.checkout_code}`));
    order = db.raw.prepare('SELECT * FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.equal(order.checkout_name, 'Buyer Name');
    assert.equal(order.status, 'pending_payment', 'Checkout completion taps must not verify payment');
    assert.equal(order.payment_reference, null);

    // An email sent while the name prompt is open is still saved only as audit information.
    await tgPost(env, userMsg(5151, '/start contact_rosebeck'));
    const second = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='5151'").get() as any;
    await tgPost(env, callbackFrom(5151, `done:${second.id}`));
    await tgPost(env, userMsg(5151, 'buyer5151@example.com'));
    assert.equal((db.raw.prepare('SELECT buyer_email FROM contact_requests WHERE id=?').get(second.id) as any).buyer_email, 'buyer5151@example.com');
  } finally {
    cleanup();
  }
});

test('Request delivery still requires manual payment verification and explicit send confirmation', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const unverifiedId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5160', '5160', 'anaimiya', 'pending_payment', 'selar', 'ref-unverified', 'FL-UNV001')`).run(unverifiedId);
    await tgPost(env, callbackFrom(10001, `approve:${unverifiedId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(unverifiedId) as any).status, 'pending_payment');
    assert.equal(messagesTo(sentTelegramMessages, '5160').length, 0);

    const okId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5162', '5162', 'anaimiya', 'payment_verified', 'selar', 'ref-ok-1', 'FL-OK0001')`).run(okId);
    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `approve:${okId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'payment_verified');
    assert.equal(messagesTo(sentTelegramMessages, '5162').length, 0, 'opening a delivery draft sends nothing');
    const draft = db.raw.prepare('SELECT id FROM delivery_drafts WHERE request_id=?').get(okId) as any;
    assert.ok(draft);
    await tgPost(env, adminMsg('Your admin-prepared request fulfilment is ready.'));
    await tgPost(env, callbackFrom(10001, `draft:send:${draft.id}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'approved');
    assert.equal(messagesTo(sentTelegramMessages, '5162').filter(m => String(m.data.text || '').includes('Your admin-prepared request fulfilment is ready.')).length, 1);
  } finally {
    cleanup();
  }
});

test('Contact and service callbacks cannot mutate each other; verification is idempotent', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    const contactId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5170', '5170', 'anaimiya', 'pending_payment', 'selar', 'ref-x-c', 'FL-XC0001')`).run(contactId);
    db.raw.prepare(`INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, 'svc', '5171', '5171', 'pending_payment', 'selar', 'ref-x-s', 'FL-XS0001')`).run(serviceId);

    await tgPost(env, callbackFrom(10001, `serviceverify:${contactId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment', 'serviceverify must not touch contact requests');
    await tgPost(env, callbackFrom(10001, `selarverify:${serviceId}`));
    await tgPost(env, callbackFrom(10001, `approve:${serviceId}`));
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceId) as any).status, 'pending_payment', 'Contact callbacks must not touch service orders');

    await tgPost(env, callbackFrom(10001, `selarverify:${contactId}`));
    await tgPost(env, callbackFrom(10001, `selarverify:${contactId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'payment_verified');
    assert.equal((db.raw.prepare("SELECT count(*) AS cnt FROM admin_audit WHERE action='selar_payment_admin_verified' AND request_id=?").get(contactId) as any).cnt, 1, 'Repeated verification must be a no-op');

    await tgPost(env, callbackFrom(10001, `serviceverify:${serviceId}`));
    await tgPost(env, callbackFrom(10001, `serviceverify:${serviceId}`));
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceId) as any).status, 'payment_verified');
    assert.equal((db.raw.prepare("SELECT count(*) AS cnt FROM admin_audit WHERE action='service_payment_admin_verified' AND request_id=?").get(serviceId) as any).cnt, 1);
  } finally {
    cleanup();
  }
});

test('Admin manual verification by Selar reference works without a webhook and cannot be reused', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const contactId = crypto.randomUUID();
    const secondContactId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code)
      VALUES (?, '5180', '5180', 'anaimiya', 'pending_payment', 'selar', 'FL-MAN001')`).run(contactId);
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code)
      VALUES (?, '5182', '5182', 'rosebeck', 'pending_payment', 'selar', 'FL-MAN002')`).run(secondContactId);
    db.raw.prepare(`INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, checkout_code)
      VALUES (?, 'svc', '5181', '5181', 'pending_payment', 'FL-MAN003')`).run(serviceId);

    await tgPost(env, userMsg(9999, `/verify ${contactId} SELARREF1`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment', 'Non-admin manual verification must fail');

    await tgPost(env, adminMsg('/verify not-a-uuid SELARREF1'));
    await tgPost(env, adminMsg(`/verify ${contactId} SELARREF1`));
    let contact = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id=?').get(contactId) as any;
    assert.equal(contact.status, 'payment_verified');
    assert.equal(contact.payment_reference, 'SELARREF1');
    assert.equal((db.raw.prepare('SELECT request_id FROM processed_sales WHERE provider_reference=?').get('SELARREF1') as any).request_id, contactId);
    assert.equal(messagesTo(sentTelegramMessages, '5180').filter(m => String(m.data.text).includes('@')).length, 0, 'Manual verification alone must not send contact details');

    // Consent + approval are still separate gates after manual verification.
    await tgPost(env, callbackFrom(10001, `approve:${contactId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'payment_verified');

    await tgPost(env, adminMsg(`/verify ${contactId} SELARREF1`));
    assert.equal((db.raw.prepare("SELECT count(*) AS cnt FROM admin_audit WHERE action='selar_payment_admin_verified_manual_reference' AND request_id=?").get(contactId) as any).cnt, 1, 'Repeated manual verification must be a no-op');

    await tgPost(env, adminMsg(`/verify ${secondContactId} SELARREF1`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(secondContactId) as any).status, 'pending_payment', 'One Selar reference must never verify two orders');

    await tgPost(env, adminMsg(`/verifyservice ${serviceId} SELARREF2`));
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceId) as any).status, 'payment_verified');

    // A late webhook for the manually verified reference is a duplicate, not a regression.
    const late = await selarPost(env, { reference: 'SELARREF1', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Buyer FL-MAN001' });
    assert.equal((await late.json()).duplicate, true);
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'payment_verified');
  } finally {
    cleanup();
  }
});

test('A blocked customer chat cannot roll back admin payment verification', async () => {
  const db = createTestDb();
  const sent: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const urlStr = String(url);
    if (urlStr.includes('api.telegram.org')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (urlStr.includes('sendMessage') && String(body.chat_id) === '5200') {
        return new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
      }
      sent.push({ method: urlStr.split('/').pop(), data: body });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  }) as any;
  const env: any = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'test-bot-token-12345',
    TELEGRAM_WEBHOOK_SECRET: 'test-tg-webhook-secret-999',
    ADMIN_TELEGRAM_ID: '10001',
    SELAR_CHECKOUT_URL: 'https://selar.com/j977zh71q8',
    SELAR_PRODUCT_ID: 'j977zh71q8',
    PAYMENT_PROVIDER: 'selar',
    PAYMENT_METHODS: 'selar',
    SITE_URL: 'https://fansleak.pages.dev'
  };
  try {
    const reqId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5200', '5200', 'anaimiya', 'pending_payment', 'selar', 'ref-blocked-customer', 'FL-BLK001')`).run(reqId);

    await tgPost(env, callbackFrom(10001, `selarverify:${reqId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any).status, 'payment_verified', 'Verification must persist even when the customer cannot be messaged');
    const adminPrompt = sent.find(m => m.method === 'sendMessage' && String(m.data.chat_id) === '10001' && JSON.stringify(m.data.reply_markup || {}).includes(`approve:${reqId}`));
    assert.ok(adminPrompt, 'Admin must still receive the approval prompt');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI support output is HTML-escaped before it is sent to customers', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const envWithAi = {
      ...env,
      AI: { run: async () => ({ response: 'Tap <a href="https://evil.example">here</a> & pay <b>now</b>' }) }
    };
    await tgPost(envWithAi, userMsg(5190, 'how do I pay?'));
    const reply = messagesTo(sentTelegramMessages, '5190')[0];
    assert.ok(reply, 'AI reply must be sent');
    assert.ok(!String(reply.data.text).includes('<a href='), 'Raw AI HTML must not reach Telegram');
    assert.ok(String(reply.data.text).includes('&lt;a href=&quot;'));
    // A plain AI chat reply (no workflow buttons of its own) carries the
    // website/channel navigation buttons.
    const aiButtons = ((reply.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(aiButtons.some((b: any) => b.text === '📸 View website' && b.url === 'https://fansleak.pages.dev'));
    assert.ok(aiButtons.some((b: any) => b.text === '🔥 Telegram Channel' && b.callback_data === 'services:join'));
  } finally {
    cleanup();
  }
});

function photoMsg(userId: number, messageId: number, fileUniqueId = 'photo-unique-1') {
  return {
    message: {
      message_id: messageId,
      chat: { id: userId, type: 'private' },
      from: { id: userId, username: `customer_${userId}` },
      caption: 'private caption must not be copied to admin',
      photo: [
        { file_id: 'photo-file-small', file_unique_id: `${fileUniqueId}-small`, file_size: 1000, width: 90, height: 90 },
        { file_id: 'photo-file-large', file_unique_id: fileUniqueId, file_size: 9000, width: 900, height: 900 }
      ]
    }
  };
}

function documentMsg(userId: number, messageId: number, mimeType: string, fileName: string, fileUniqueId = 'document-unique-1') {
  return {
    message: {
      message_id: messageId,
      chat: { id: userId, type: 'private' },
      from: { id: userId, username: `customer_${userId}` },
      document: {
        file_id: `document-file-${messageId}`,
        file_unique_id: fileUniqueId,
        file_name: fileName,
        mime_type: mimeType,
        file_size: 12000
      }
    }
  };
}

test('Paid claim with an attached Selar sale uses manual verification and does not request a receipt', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5210);
    await tgPost(env, userMsg(5210, '/start contact_anaimiya'));
    const order = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='5210'").get() as any;
    const saleResponse = await selarPost(env, {
      reference: 'ref-paid-claim-found',
      product_code: env.SELAR_PRODUCT_ID,
      customer_full_name: `Buyer Person ${order.checkout_code}`,
      email: 'buyer5210@example.com'
    });
    assert.equal((await saleResponse.json()).matched, true);

    await tgPost(env, userMsg(5210, 'I have paid'));

    const customerMessages = messagesTo(sentTelegramMessages, '5210');
    assert.ok(customerMessages.some(m => String(m.data.text).includes('found a sale record already attached')));
    assert.ok(customerMessages.some(m => String(m.data.text).includes('not</b> need to send a receipt')));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM receipt_review_prompts WHERE telegram_user_id='5210'").get().cnt, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM payment_receipt_submissions').get().cnt, 0);
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendPhoto' || m.method === 'sendDocument').length, 0);
    const saved = db.raw.prepare('SELECT status,payment_reference FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.equal(saved.status, 'pending_payment', 'The paid claim must not verify the payment');
    assert.equal(saved.payment_reference, 'ref-paid-claim-found');
  } finally {
    cleanup();
  }
});

test('Missing sale prompts for a Selar receipt photo, forwards it once, and never verifies the order', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 5211);
    await tgPost(env, userMsg(5211, '/start contact_anaimiya'));
    const order = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='5211'").get() as any;

    await tgPost(env, photoMsg(5211, 8099, 'too-early-photo'));
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendPhoto').length, 0, 'A photo sent before the checkout-name step must not be forwarded yet');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM payment_receipt_submissions').get().cnt, 0);
    assert.ok(db.raw.prepare("SELECT order_id FROM checkout_name_prompts WHERE telegram_user_id='5211'").get());

    await tgPost(env, callbackFrom(5211, `done:${order.id}`));
    await tgPost(env, userMsg(5211, `Buyer Receipt ${order.checkout_code}`));

    const prompt = db.raw.prepare("SELECT * FROM receipt_review_prompts WHERE telegram_user_id='5211'").get() as any;
    assert.ok(prompt, 'A missing backend sale after checkout-name entry must create a receipt prompt');
    assert.equal(prompt.order_id, order.id);
    assert.ok(messagesTo(sentTelegramMessages, '5211').some(m => String(m.data.text).includes('forward your <b>payment receipt</b>')));

    const receipt = photoMsg(5211, 8101);
    await tgPost(env, receipt);

    const forwards = sentTelegramMessages.filter(m => m.method === 'sendPhoto');
    assert.equal(forwards.length, 1);
    assert.equal(String(forwards[0].data.chat_id), env.ADMIN_TELEGRAM_ID);
    assert.equal(forwards[0].data.photo, 'photo-file-large', 'The largest Telegram photo size should be forwarded');
    const caption = String(forwards[0].data.caption || '');
    assert.ok(caption.includes(order.id));
    assert.ok(caption.includes(order.checkout_code));
    assert.ok(caption.includes('Buyer Receipt'));
    assert.ok(caption.includes('<b>Verify</b> asks for the exact reference'));
    assert.ok(caption.includes('<b>Reject &amp; message</b> opens a follow-up composer'));
    assert.ok(caption.includes('<b>Just reject</b> cancels now'));
    assert.ok(!caption.includes(`/verify ${order.id} EXACT_SELAR_REFERENCE`), 'Receipt review should use buttons instead of only showing a verify command');
    const receiptButtons = ((forwards[0].data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(receiptButtons.some((button: any) => button.text === '✅ Verify' && button.callback_data === `receipt:verify:c:${order.id}`));
    assert.ok(receiptButtons.some((button: any) => button.text === '🚫 Reject & message' && button.callback_data === `receipt:reject:c:${order.id}`));
    assert.ok(receiptButtons.some((button: any) => button.text === '⛔ Just reject' && button.callback_data === `receipt:rejectnow:c:${order.id}`));
    assert.ok(caption.includes('has NOT changed the order status'));
    assert.ok(!caption.includes('private caption must not be copied'), 'Customer captions must not be copied into the admin receipt context');

    const submission = db.raw.prepare('SELECT * FROM payment_receipt_submissions WHERE order_id=?').get(order.id) as any;
    assert.equal(submission.status, 'forwarded');
    assert.equal(submission.telegram_file_id, '', 'Telegram file pointer must be cleared after the receipt reaches the admin');
    assert.equal(submission.telegram_file_unique_id, null, 'Duplicate-media identifier must also be cleared after forwarding');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM receipt_review_prompts WHERE telegram_user_id='5211'").get().cnt, 0);

    await tgPost(env, receipt);
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendPhoto').length, 1, 'Duplicate Telegram receipt update must not forward twice');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM payment_receipt_submissions WHERE order_id=?').get(order.id).cnt, 1);

    const saved = db.raw.prepare('SELECT status,payment_reference FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.equal(saved.status, 'pending_payment', 'A receipt must never verify, approve, or fulfil an order');
    assert.equal(saved.payment_reference, null);
  } finally {
    cleanup();
  }
});

test('Service receipt fallback rejects unsupported documents and forwards a PDF with service verification context', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,payment_method,checkout_code,checkout_name)
      VALUES (?, 'public-service', '5212', '5212', 'service_buyer', 'pending_payment', 'selar', 'FL-SVC001', 'Service Buyer')`).run(orderId);

    await tgPost(env, userMsg(5212, '/paid'));
    assert.ok(db.raw.prepare("SELECT order_id FROM receipt_review_prompts WHERE telegram_user_id='5212'").get());

    await tgPost(env, documentMsg(5212, 8201, 'application/zip', 'receipt.zip', 'zip-unique'));
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendDocument').length, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM payment_receipt_submissions').get().cnt, 0);
    assert.ok(db.raw.prepare("SELECT order_id FROM receipt_review_prompts WHERE telegram_user_id='5212'").get(), 'Unsupported media must leave the receipt prompt open');

    await tgPost(env, documentMsg(5212, 8202, 'application/pdf', 'selar-receipt.pdf', 'pdf-unique'));
    const forwards = sentTelegramMessages.filter(m => m.method === 'sendDocument');
    assert.equal(forwards.length, 1);
    assert.equal(String(forwards[0].data.chat_id), env.ADMIN_TELEGRAM_ID);
    assert.equal(forwards[0].data.document, 'document-file-8202');
    assert.ok(!String(forwards[0].data.caption || '').includes(`/verifyservice ${orderId} EXACT_SELAR_REFERENCE`));
    const serviceReceiptButtons = ((forwards[0].data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(serviceReceiptButtons.some((button: any) => button.text === '✅ Verify' && button.callback_data === `receipt:verify:s:${orderId}`));
    assert.ok(serviceReceiptButtons.some((button: any) => button.text === '🚫 Reject & message' && button.callback_data === `receipt:reject:s:${orderId}`));
    assert.ok(serviceReceiptButtons.some((button: any) => button.text === '⛔ Just reject' && button.callback_data === `receipt:rejectnow:s:${orderId}`));

    const saved = db.raw.prepare('SELECT status,payment_reference FROM service_orders WHERE id=?').get(orderId) as any;
    assert.equal(saved.status, 'pending_payment');
    assert.equal(saved.payment_reference, null);
  } finally {
    cleanup();
  }
});

test('Receipt delivery failure is recorded and the same submission can be retried without duplication', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup, failTelegramMethods } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, '5213', '5213', 'anaimiya', 'pending_payment', 'selar', 'FL-RTY001', 'Retry Buyer')`).run(orderId);

    await tgPost(env, userMsg(5213, 'I have paid'));
    failTelegramMethods.add('sendPhoto');
    const receipt = photoMsg(5213, 8301, 'retry-photo-unique');
    await tgPost(env, receipt);

    const submission = db.raw.prepare('SELECT * FROM payment_receipt_submissions WHERE order_id=?').get(orderId) as any;
    assert.equal(submission.status, 'delivery_failed');
    assert.ok(db.raw.prepare("SELECT order_id FROM receipt_review_prompts WHERE telegram_user_id='5213'").get(), 'A failed forward must leave a retryable prompt');
    assert.ok(messagesTo(sentTelegramMessages, '5213').some(m => String(m.data.text).includes("couldn't forward that receipt")));

    failTelegramMethods.delete('sendPhoto');
    await tgPost(env, receipt);

    const rows = db.raw.prepare('SELECT * FROM payment_receipt_submissions WHERE order_id=?').all(orderId) as any[];
    assert.equal(rows.length, 1, 'Retrying the same Telegram receipt must reuse one submission record');
    assert.equal(rows[0].id, submission.id);
    assert.equal(rows[0].status, 'forwarded');
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendPhoto').length, 2, 'One failed attempt and one successful retry are expected');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM receipt_review_prompts WHERE telegram_user_id='5213'").get().cnt, 0);
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'pending_payment');
  } finally {
    cleanup();
  }
});

test('Receipt Verify button requires the exact Selar reference and reuses manual verification safeguards', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const contactId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, '5221', '5221', 'anaimiya', 'pending_payment', 'selar', 'FL-RBUT01', 'Button Buyer')`).run(contactId);

    await tgPost(env, callbackFrom(9999, `receipt:verify:c:${contactId}`, 'cb-receipt-nonadmin'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_receipt_verify_prompts').get().cnt, 0, 'A non-admin cannot open receipt verification');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment');

    await tgPost(env, callbackFrom(10001, `receipt:verify:c:${contactId}`, 'cb-receipt-verify'));
    const prompt = db.raw.prepare('SELECT * FROM admin_receipt_verify_prompts WHERE order_id=?').get(contactId) as any;
    assert.ok(prompt, 'Verify button must open an exact-reference prompt when no sale is attached');
    assert.equal(prompt.order_kind, 'contact');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment', 'Tapping Verify must not itself verify payment');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get().cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('screenshot and this button alone have <b>not</b> verified payment')));
    const promptPanel = messagesTo(sentTelegramMessages, '10001').find(m => String(m.data.text).includes('exact Selar reference only'));
    const promptButtons = ((promptPanel?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(promptButtons.some((b: any) => b.text === '✖️ Cancel verification' && b.callback_data === `receipt:cancel:c:${contactId}`));
    assert.ok(promptButtons.some((b: any) => b.text === '⛔ Just reject' && b.callback_data === `receipt:rejectnow:c:${contactId}`));

    await tgPost(env, adminMsg('two words'));
    assert.ok(db.raw.prepare('SELECT * FROM admin_receipt_verify_prompts WHERE order_id=?').get(contactId), 'An invalid multi-word reply must keep the prompt open');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment');
    // The invalid-reference reply must keep Cancel verification visible on
    // the newest admin message, not only on the scrolled-away prompt panel.
    const invalidReply = messagesTo(sentTelegramMessages, '10001').filter(m => String(m.data.text).includes('Send the <b>exact Selar reference only</b>')).at(-1);
    const invalidButtons = ((invalidReply?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(invalidButtons.some((b: any) => b.text === '✖️ Cancel verification' && b.callback_data === `receipt:cancel:c:${contactId}`));

    await tgPost(env, adminMsg('SELAR-RECEIPT-REF-1'));
    const savedContact = db.raw.prepare('SELECT status,payment_reference FROM contact_requests WHERE id=?').get(contactId) as any;
    assert.equal(savedContact.status, 'payment_verified');
    assert.equal(savedContact.payment_reference, 'SELAR-RECEIPT-REF-1');
    assert.equal((db.raw.prepare("SELECT request_id FROM processed_sales WHERE provider_reference='SELAR-RECEIPT-REF-1'").get() as any).request_id, contactId);
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_receipt_verify_prompts').get().cnt, 0, 'A consumed verification prompt must be deleted');
    assert.ok(messagesTo(sentTelegramMessages, '5221').some(m => String(m.data.text).includes('Your payment has been confirmed')));

    const serviceId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, 'telegram_channel', '5222', '5222', 'pending_payment', 'selar', 'FL-RBUT02', 'Cancel Buyer')`).run(serviceId);
    await tgPost(env, callbackFrom(10001, `receipt:verify:s:${serviceId}`, 'cb-receipt-service-verify'));
    assert.ok(db.raw.prepare('SELECT * FROM admin_receipt_verify_prompts WHERE order_id=?').get(serviceId));
    await tgPost(env, callbackFrom(10001, `receipt:cancel:s:${serviceId}`, 'cb-receipt-service-cancel'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_receipt_verify_prompts').get().cnt, 0);
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceId) as any).status, 'pending_payment', 'Cancelling receipt verification must leave the service order unchanged');

    const composerContactId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, '5223', '5223', 'rosebeck', 'pending_payment', 'selar', 'FL-RBUT03', 'Composer Buyer')`).run(composerContactId);
    await tgPost(env, callbackFrom(10001, `receipt:verify:c:${composerContactId}`, 'cb-receipt-composer-verify'));
    assert.ok(db.raw.prepare('SELECT * FROM admin_receipt_verify_prompts WHERE order_id=?').get(composerContactId));
    await tgPost(env, adminMsg('/message FL-RBUT03 First support note'));
    await tgPost(env, adminMsg('Updated support note'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_receipt_verify_prompts').get().cnt, 0, 'Opening another composer must cancel the dormant receipt prompt instead of letting it capture draft text');
    assert.equal((db.raw.prepare('SELECT status,payment_reference FROM contact_requests WHERE id=?').get(composerContactId) as any).status, 'pending_payment');
    assert.equal((db.raw.prepare('SELECT status,payment_reference FROM contact_requests WHERE id=?').get(composerContactId) as any).payment_reference, null);
    assert.equal(latestSupportDraft(db, composerContactId).message_text, 'Updated support note');
  } finally {
    cleanup();
  }
});

test('Receipt Reject button opens a follow-up composer and rejects only on its explicit send', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, 'telegram_channel', '5231', '5231', 'pending_payment', 'selar', 'FL-RREJ01', 'Reject Buyer')`).run(orderId);

    await tgPost(env, callbackFrom(10001, `receipt:reject:s:${orderId}`, 'cb-receipt-reject'));
    const draft = latestSupportDraft(db, orderId);
    assert.ok(draft, 'Reject must open a client follow-up composer');
    assert.equal(draft.purpose, 'rejection');
    assert.equal(draft.status, 'draft');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'pending_payment', 'Opening the rejection composer must not reject the order yet');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5231').length, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('not rejected yet')));

    await tgPost(env, supportPhotoPayload(8401, 'Please send a clearer Selar payment receipt if you completed checkout.'));
    const updatedDraft = latestSupportDraft(db, orderId);
    assert.equal(updatedDraft.message_text, 'Please send a clearer Selar payment receipt if you completed checkout.');
    assert.equal(updatedDraft.media_file_id, 'photo-file-large');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'pending_payment');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5231').length, 0, 'Composing the rejection follow-up must not message the client');

    await tgPost(env, callbackFrom(10001, `support-message:preview:${draft.id}`, 'cb-rejection-preview'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5231').length, 0, 'Preview must not message the client or reject the order');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'pending_payment');

    await tgPost(env, adminMsg('yes'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5231').length, 0, 'YES must not send a rejection follow-up');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'pending_payment');
    assert.equal((db.raw.prepare('SELECT status FROM admin_message_drafts WHERE id=?').get(draft.id) as any).status, 'draft');

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-rejection-send'));
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'cancelled');
    const sentDraft = db.raw.prepare('SELECT status,media_file_id FROM admin_message_drafts WHERE id=?').get(draft.id) as any;
    assert.equal(sentDraft.status, 'sent');
    assert.equal(sentDraft.media_file_id, null);
    const customerCalls = customerTelegramCalls(sentTelegramMessages, '5231');
    assert.equal(customerCalls.length, 1, 'The client must receive exactly one rejection follow-up');
    assert.equal(customerCalls[0].method, 'sendPhoto');
    assert.equal(customerCalls[0].data.photo, 'photo-file-large');
    const caption = String(customerCalls[0].data.caption || '');
    assert.ok(caption.includes('Your order FL-RREJ01 was rejected after payment review.'));
    assert.ok(caption.includes('Please send a clearer Selar payment receipt'));
    assert.ok(db.raw.prepare("SELECT id FROM admin_audit WHERE action='admin_receipt_rejected' AND request_id=?").get(orderId));
    assert.ok(db.raw.prepare("SELECT id FROM admin_audit WHERE action='admin_rejection_message_customer' AND request_id=?").get(orderId));
  } finally {
    cleanup();
  }
});

test('Receipt Just reject confirms first, then rejects immediately and tells the client payment was not made', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const contactId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, '5241', '5241', 'anaimiya', 'pending_payment', 'selar', 'FL-RJUS01', 'Just Reject Buyer')`).run(contactId);

    // Non-admin tap is refused and changes nothing.
    await tgPost(env, callbackFrom(5241, `receipt:rejectnow:c:${contactId}`, 'cb-justreject-nonadmin'));
    await tgPost(env, callbackFrom(5241, `receipt:confirmreject:c:${contactId}`, 'cb-justreject-nonadmin-confirm'));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5241').length, 0);

    // First admin tap only asks for confirmation.
    await tgPost(env, callbackFrom(10001, `receipt:rejectnow:c:${contactId}`, 'cb-justreject-ask'));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'pending_payment', 'The first Just reject tap must not reject yet');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5241').length, 0);
    const confirmPanel = messagesTo(sentTelegramMessages, '10001').filter(m => String(m.data.text).includes('Just reject — no follow-up')).at(-1);
    const confirmButtons = ((confirmPanel?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(confirmButtons.some((b: any) => b.text === '⛔ Yes, reject now' && b.callback_data === `receipt:confirmreject:c:${contactId}`));
    assert.ok(confirmButtons.some((b: any) => b.text.includes('Cancel') && b.callback_data === `receipt:cancel:c:${contactId}`));

    // Confirmation rejects immediately, audits, and notifies the client.
    await tgPost(env, callbackFrom(10001, `receipt:confirmreject:c:${contactId}`, 'cb-justreject-confirm'));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(contactId) as any).status, 'rejected');
    assert.ok(db.raw.prepare("SELECT id FROM admin_audit WHERE action='admin_receipt_rejected_without_followup' AND request_id=?").get(contactId));
    const clientCalls = customerTelegramCalls(sentTelegramMessages, '5241');
    assert.equal(clientCalls.length, 1, 'The client must receive exactly one cancellation notice');
    assert.ok(String(clientCalls[0].data.text).includes('was cancelled because payment wasn\'t made'));
    assert.ok(String(clientCalls[0].data.text).includes('FL-RJUS01'));
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('rejected now')));

    // A repeated confirm tap cannot reject or notify twice.
    await tgPost(env, callbackFrom(10001, `receipt:confirmreject:c:${contactId}`, 'cb-justreject-repeat'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5241').length, 1, 'A stale confirm tap must not notify the client twice');

    // Just reject from inside an open rejection composer cancels that draft.
    const serviceId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, 'telegram_channel', '5242', '5242', 'pending_payment', 'selar', 'FL-RJUS02', 'Composer Just Reject')`).run(serviceId);
    await tgPost(env, callbackFrom(10001, `receipt:reject:s:${serviceId}`, 'cb-justreject-open-composer'));
    const composerDraft = latestSupportDraft(db, serviceId);
    assert.equal(composerDraft.purpose, 'rejection');
    assert.equal(composerDraft.status, 'draft');
    const composerSummary = messagesTo(sentTelegramMessages, '10001').filter(m => String(m.data.text).includes('Rejection follow-up draft')).at(-1);
    const composerButtons = ((composerSummary?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(composerButtons.some((b: any) => b.text === '⛔ Reject now (no follow-up)' && b.callback_data === `receipt:rejectnow:s:${serviceId}`), 'The rejection composer must offer an immediate-reject escape');

    await tgPost(env, callbackFrom(10001, `receipt:confirmreject:s:${serviceId}`, 'cb-justreject-composer-confirm'));
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceId) as any).status, 'cancelled');
    assert.equal((db.raw.prepare('SELECT status FROM admin_message_drafts WHERE id=?').get(composerDraft.id) as any).status, 'cancelled', 'The open rejection draft must be cancelled when Just reject executes');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '5242').length, 1);

    // The attached-reference Verify panel exposes Cancel verification and Just reject.
    const attachedId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,payment_method,checkout_code,checkout_name,payment_reference)
      VALUES (?, '5243', '5243', 'rosebeck', 'pending_payment', 'selar', 'FL-RJUS03', 'Attached Buyer', 'SELAR-ATT-1')`).run(attachedId);
    await tgPost(env, callbackFrom(10001, `receipt:verify:c:${attachedId}`, 'cb-attached-verify'));
    const attachedPanel = messagesTo(sentTelegramMessages, '10001').filter(m => String(m.data.text).includes('Attached Selar reference')).at(-1);
    const attachedButtons = ((attachedPanel?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(attachedButtons.some((b: any) => b.text === '✖️ Cancel verification' && b.callback_data === `receipt:cancel:c:${attachedId}`));
    assert.ok(attachedButtons.some((b: any) => b.text === '⛔ Just reject' && b.callback_data === `receipt:rejectnow:c:${attachedId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(attachedId) as any).status, 'pending_payment', 'Showing the attached panel must not change the order');
  } finally {
    cleanup();
  }
});

function customerTelegramCalls(sent: any[], chatId: string) {
  return sent.filter(m => ['sendMessage', 'sendPhoto', 'sendDocument', 'sendVideo'].includes(m.method) && String(m.data.chat_id) === chatId);
}

function latestSupportDraft(db: any, orderId: string) {
  return db.raw.prepare('SELECT * FROM admin_message_drafts WHERE order_id=? ORDER BY rowid DESC LIMIT 1').get(orderId) as any;
}

function supportPhotoPayload(messageId: number, caption?: string) {
  const payload: any = photoMsg(10001, messageId, `support-photo-${messageId}`);
  if (caption === undefined) delete payload.message.caption;
  else payload.message.caption = caption;
  return payload;
}

function supportDocumentPayload(messageId: number, caption?: string) {
  const payload: any = documentMsg(10001, messageId, 'application/pdf', `support-${messageId}.pdf`, `support-document-${messageId}`);
  if (caption !== undefined) payload.message.caption = caption;
  return payload;
}

test('Admin Desk support draft sends plain text only after explicit confirmation and does not change order state', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8101', '8101', 'anaimiya', 'pending_payment', 'FL-SUPP01')`).run(orderId);

    await tgPost(env, userMsg(9999, '/message FL-SUPP01 This must not be sent'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_message_drafts').get().cnt, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8101').length, 0);

    await tgPost(env, adminMsg('/order FL-SUPP01'));
    const inspection = messagesTo(sentTelegramMessages, '10001').find(m => {
      const buttons = ((m.data.reply_markup as any)?.inline_keyboard || []).flat();
      return buttons.some((button: any) => button.callback_data === `admin:message:contact:${orderId}`);
    });
    assert.ok(inspection, 'Order inspection must offer a direct Message this customer button');
    await tgPost(env, callbackFrom(10001, `admin:message:contact:${orderId}`, 'cb-support-direct-open'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8101').length, 0, 'Opening the individual composer must not message the customer');
    await tgPost(env, adminMsg('Hello, I am checking your request and will update you here.'));
    const draft = latestSupportDraft(db, orderId);
    assert.ok(draft);
    assert.equal(draft.status, 'draft');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8101').length, 0, 'Composing a support draft must not message the customer');
    const draftSummary = messagesTo(sentTelegramMessages, '10001').find(m => String(m.data.text).includes('Customer support draft') && String(m.data.text).includes('FL-SUPP01'));
    assert.ok(draftSummary);
    const callbacks = (draftSummary.data.reply_markup as any).inline_keyboard.flat().map((b: any) => String(b.callback_data));
    assert.ok(callbacks.some((data: string) => data === `support-message:preview:${draft.id}`));
    assert.ok(callbacks.some((data: string) => data === `support-message:send:${draft.id}`));
    assert.ok(callbacks.some((data: string) => data === `support-message:cancel:${draft.id}`));

    await tgPost(env, callbackFrom(9999, `support-message:send:${draft.id}`, 'cb-support-non-admin'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8101').length, 0, 'A non-admin callback must not send a support draft');
    assert.equal(latestSupportDraft(db, orderId).status, 'draft');

    await tgPost(env, callbackFrom(10001, `support-message:preview:${draft.id}`, 'cb-support-preview'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8101').length, 0, 'Preview must not message the customer');
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Customer support preview') && String(m.data.text).includes('pending_payment')));

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-send'));
    const customerCalls = customerTelegramCalls(sentTelegramMessages, '8101');
    assert.equal(customerCalls.length, 1);
    assert.equal(customerCalls[0].method, 'sendMessage');
    assert.ok(String(customerCalls[0].data.text).includes('Message from FansLeak support'));
    assert.ok(String(customerCalls[0].data.text).includes('checking your request'));
    assert.equal(latestSupportDraft(db, orderId).status, 'sent');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'pending_payment');

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-send-repeat'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8101').length, 1, 'A repeated send callback must not duplicate the support message');

    const audits = db.raw.prepare('SELECT action,details FROM admin_audit WHERE request_id=? ORDER BY id').all(orderId) as any[];
    assert.ok(audits.some(a => a.action === 'admin_support_draft_created'));
    assert.ok(audits.some(a => a.action === 'admin_message_customer'));
    assert.equal(audits.some(a => String(a.details || '').includes('checking your request')), false, 'Audit details must not store the support message body');
  } finally {
    cleanup();
  }
});

test('Admin Desk support draft sends text with one photo to a service order without fulfilling it', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code)
      VALUES (?, 'custom-work', '8202', '8202', 'payment_verified', 'FL-SERV01')`).run(orderId);

    await tgPost(env, adminMsg(`/message ${orderId.toUpperCase()}`));
    let draft = latestSupportDraft(db, orderId);
    assert.ok(draft);
    await tgPost(env, adminMsg('Here is your update with the attached image.'));
    await tgPost(env, supportPhotoPayload(9101));
    draft = latestSupportDraft(db, orderId);
    assert.equal(draft.media_kind, 'photo');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8202').length, 0);

    await tgPost(env, callbackFrom(10001, `support-message:preview:${draft.id}`, 'cb-support-photo-preview'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'sendPhoto' && String(m.data.chat_id) === '10001'), 'Admin preview should show the actual attachment');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8202').length, 0);

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-photo-send'));
    const customerCalls = customerTelegramCalls(sentTelegramMessages, '8202');
    assert.equal(customerCalls.length, 1);
    assert.equal(customerCalls[0].method, 'sendPhoto');
    assert.equal(customerCalls[0].data.photo, 'photo-file-large');
    assert.ok(String(customerCalls[0].data.caption).includes('Here is your update'));
    assert.equal(latestSupportDraft(db, orderId).status, 'sent');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'payment_verified', 'A support message must not fulfil the service order');

    const audits = db.raw.prepare('SELECT details FROM admin_audit WHERE request_id=?').all(orderId) as any[];
    assert.equal(audits.some(a => String(a.details || '').includes('photo-file-large')), false, 'Audit details must not store Telegram file IDs');
  } finally {
    cleanup();
  }
});

test('Admin Desk support draft can send a media-only document selected by order code', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8303', '8303', 'anaimiya', 'approved', 'FL-DOC001')`).run(orderId);

    await tgPost(env, supportDocumentPayload(9201, '/message FL-DOC001'));
    const draft = latestSupportDraft(db, orderId);
    assert.ok(draft);
    assert.equal(draft.message_text, null);
    assert.equal(draft.media_kind, 'document');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8303').length, 0);

    await tgPost(env, callbackFrom(10001, `support-message:preview:${draft.id}`, 'cb-support-doc-preview'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'sendDocument' && String(m.data.chat_id) === '10001'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8303').length, 0);

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-doc-send'));
    const customerCalls = customerTelegramCalls(sentTelegramMessages, '8303');
    assert.equal(customerCalls.length, 1);
    assert.equal(customerCalls[0].method, 'sendDocument');
    assert.equal(customerCalls[0].data.document, 'document-file-9201');
    assert.equal(Object.prototype.hasOwnProperty.call(customerCalls[0].data, 'caption'), false, 'Media-only support messages should not invent a caption');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'approved');
  } finally {
    cleanup();
  }
});

test('Admin Desk support drafts can attach and send a video file', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8304', '8304', 'anaimiya', 'approved', 'FL-VID001')`).run(orderId);

    await tgPost(env, adminMsg('/message FL-VID001'));
    const draft = latestSupportDraft(db, orderId);
    await tgPost(env, {
      message: {
        chat: { id: 10001, type: 'private' },
        from: { id: 10001 },
        video: { file_id: 'video-file-9301', file_unique_id: 'video-unique-9301', mime_type: 'video/mp4', file_size: 12000, duration: 4 }
      }
    });
    const saved = db.raw.prepare('SELECT media_kind,media_file_id,media_mime_type FROM admin_message_drafts WHERE id=?').get(draft.id) as any;
    assert.equal(saved.media_kind, 'document');
    assert.equal(saved.media_file_id, 'video-file-9301');
    assert.equal(saved.media_mime_type, 'video/mp4');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8304').length, 0);

    await tgPost(env, callbackFrom(10001, `support-message:preview:${draft.id}`, 'cb-support-video-preview'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'sendVideo' && String(m.data.chat_id) === '10001'), 'admin preview must use the Telegram video method for a video file_id');
    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-video-send'));
    const customerCalls = customerTelegramCalls(sentTelegramMessages, '8304');
    assert.equal(customerCalls.length, 1);
    assert.equal(customerCalls[0].method, 'sendVideo');
    assert.equal(customerCalls[0].data.video, 'video-file-9301');
  } finally {
    cleanup();
  }
});

test('Admin Desk support drafts can be cancelled and expire without sending', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8404', '8404', 'anaimiya', 'pending_payment', 'FL-CANC01')`).run(orderId);

    await tgPost(env, adminMsg('/message FL-CANC01 First unsent support draft'));
    const cancelledDraft = latestSupportDraft(db, orderId);
    await tgPost(env, callbackFrom(10001, `support-message:cancel:${cancelledDraft.id}`, 'cb-support-cancel'));
    assert.equal(latestSupportDraft(db, orderId).status, 'cancelled');
    await tgPost(env, callbackFrom(10001, `support-message:send:${cancelledDraft.id}`, 'cb-support-cancelled-send'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8404').length, 0);

    await tgPost(env, adminMsg('/message FL-CANC01 Second support draft'));
    const expiredDraft = latestSupportDraft(db, orderId);
    assert.notEqual(expiredDraft.id, cancelledDraft.id);
    db.raw.prepare("UPDATE admin_message_drafts SET expires_at=datetime('now','-1 minute') WHERE id=?").run(expiredDraft.id);
    await tgPost(env, callbackFrom(10001, `support-message:send:${expiredDraft.id}`, 'cb-support-expired-send'));
    assert.equal(latestSupportDraft(db, orderId).status, 'expired');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8404').length, 0);
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'pending_payment');
  } finally {
    cleanup();
  }
});

test('Admin Desk support order selection rejects invalid, missing, and ambiguous references', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const contactId = crypto.randomUUID();
    const serviceId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8606', '8606', 'anaimiya', 'pending_payment', 'FL-DUP001')`).run(contactId);
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code)
      VALUES (?, 'custom-work', '8607', '8607', 'pending_payment', 'FL-DUP001')`).run(serviceId);

    await tgPost(env, adminMsg('/message FL-DUP001 This must not be composed'));
    await tgPost(env, adminMsg('/message FL-123 Invalid reference'));
    await tgPost(env, adminMsg(`/message ${crypto.randomUUID()} Missing order`));

    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_message_drafts').get().cnt, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8606').length, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8607').length, 0);
    const adminTexts = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || ''));
    assert.ok(adminTexts.some(text => text.includes('matches more than one order')));
    assert.ok(adminTexts.some(text => text.includes('full order UUID or an order code')));
    assert.ok(adminTexts.some(text => text.includes('No request or service order matched')));
  } finally {
    cleanup();
  }
});

test('Admin Desk support media captions enforce the Telegram limit before claiming a send', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code)
      VALUES (?, 'custom-work', '8808', '8808', 'payment_verified', 'FL-CAPT01')`).run(orderId);

    await tgPost(env, adminMsg(`/message FL-CAPT01 ${'x'.repeat(1100)}`));
    await tgPost(env, supportPhotoPayload(9301));
    let draft = latestSupportDraft(db, orderId);
    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-caption-too-long'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8808').length, 0);
    assert.equal(latestSupportDraft(db, orderId).status, 'draft', 'A blocked caption send must remain editable and unclaimed');

    await tgPost(env, adminMsg('Short support update.'));
    draft = latestSupportDraft(db, orderId);
    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-caption-short-send'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8808').length, 1);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8808')[0].method, 'sendPhoto');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(orderId) as any).status, 'payment_verified');
  } finally {
    cleanup();
  }
});

test('Uncertain Admin Desk support send locks the draft and blocks blind retries for the same order', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup, failTelegramMethods } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8707', '8707', 'anaimiya', 'pending_payment', 'FL-UNCT01')`).run(orderId);

    await tgPost(env, adminMsg('/message FL-UNCT01'));
    await tgPost(env, supportPhotoPayload(9401));
    const draft = latestSupportDraft(db, orderId);
    failTelegramMethods.add('sendPhoto');

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-uncertain-send'));
    assert.equal(latestSupportDraft(db, orderId).status, 'sending');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8707').filter(m => m.method === 'sendPhoto').length, 1, 'The failed Telegram attempt should be the only customer-send attempt');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'pending_payment');
    const audits = db.raw.prepare('SELECT action,details FROM admin_audit WHERE request_id=? ORDER BY id').all(orderId) as any[];
    assert.ok(audits.some(a => a.action === 'admin_support_message_uncertain'));
    assert.equal(audits.some(a => a.action === 'admin_message_customer'), false);
    assert.equal(audits.some(a => String(a.details || '').includes('photo-file-large')), false);

    await tgPost(env, callbackFrom(10001, `support-message:send:${draft.id}`, 'cb-support-uncertain-retry'));
    await tgPost(env, adminMsg('/message FL-UNCT01 Another message'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8707').filter(m => m.method === 'sendPhoto').length, 1, 'An uncertain support send must not be retried blindly');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_message_drafts WHERE order_id=?').get(orderId).cnt, 1);
    assert.equal(latestSupportDraft(db, orderId).status, 'sending');
  } finally {
    cleanup();
  }
});

test('General support drafts and protected request-delivery drafts cannot overlap', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8909', '8909', 'anaimiya', 'payment_verified', 'FL-ISO001')`).run(orderId);
    await tgPost(env, adminMsg('/message FL-ISO001 General support only'));
    const supportDraft = latestSupportDraft(db, orderId);
    await tgPost(env, callbackFrom(10001, `approve:${orderId}`, 'cb-delivery-blocked-by-support'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM delivery_drafts WHERE request_id=?').get(orderId).cnt, 0, 'An open support draft must block opening the protected delivery composer');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8909').length, 0);

    await tgPost(env, callbackFrom(10001, `support-message:cancel:${supportDraft.id}`, 'cb-support-cancel-before-delivery'));
    await tgPost(env, callbackFrom(10001, `approve:${orderId}`, 'cb-delivery-open-after-support-cancel'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM delivery_drafts WHERE request_id=? AND status=\'draft\'').get(orderId).cnt, 1);

    await tgPost(env, adminMsg('/message FL-ISO001 This support draft must not open'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_message_drafts WHERE order_id=?').get(orderId).cnt, 1, 'The protected delivery draft must block a new general support draft');
    assert.equal(latestSupportDraft(db, orderId).status, 'cancelled');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8909').length, 0);
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'payment_verified');
  } finally {
    cleanup();
  }
});

test('A backend sale arriving after the receipt prompt supersedes receipt forwarding', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,payment_method,checkout_code,checkout_name)
      VALUES (?, '5214', '5214', 'anaimiya', 'pending_payment', 'selar', 'FL-LATE01', 'Late Buyer')`).run(orderId);

    await tgPost(env, userMsg(5214, 'I have paid'));
    assert.ok(db.raw.prepare("SELECT order_id FROM receipt_review_prompts WHERE telegram_user_id='5214'").get());

    db.raw.prepare(`INSERT INTO processed_sales
      (provider_reference,buyer_email,amount_minor,currency,product_id,request_id)
      VALUES ('ref-arrived-after-prompt', 'late@example.com', 0, 'UNK', ?, ?)`).run(env.SELAR_PRODUCT_ID, orderId);

    await tgPost(env, photoMsg(5214, 8401, 'late-sale-photo'));
    assert.equal(sentTelegramMessages.filter(m => m.method === 'sendPhoto').length, 0, 'Receipt must not be forwarded once backend evidence exists');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM payment_receipt_submissions').get().cnt, 0);
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM receipt_review_prompts WHERE telegram_user_id='5214'").get().cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '5214').some(m => String(m.data.text).includes('found a sale record already attached')));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'pending_payment');
  } finally {
    cleanup();
  }
});




test('Admin natural-language profile deletion is refused; explicit /hideprofile remains confirmation-gated', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, adminMsg('delete profile Anaimiya'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE admin_telegram_id='10001' AND status='pending'").get().cnt, 0, 'Natural-language profile deletion must not prepare a hide action');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles").get().cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('not an AI or natural-language action') && String(m.data.text).includes('/hideprofile')));

    await tgPost(env, adminMsg('please remove the Anaimiya profile'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE admin_telegram_id='10001' AND status='pending'").get().cnt, 0, 'Assistant phrasing must not prepare profile deletion either');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles").get().cnt, 0);

    await tgPost(env, adminMsg('/hideprofile anaimiya'));
    const pending = db.raw.prepare("SELECT id,action,payload,status FROM admin_pending_actions WHERE admin_telegram_id='10001' AND status='pending'").get() as any;
    assert.ok(pending, 'Explicit /hideprofile should still prepare the manual reversible hide');
    assert.equal(pending.action, 'hide_profile');
    assert.equal(pending.payload, 'anaimiya');
    assert.equal(pending.status, 'pending');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles").get().cnt, 0);

    await tgPost(env, adminMsg('yes'));
    assert.equal(db.raw.prepare("SELECT status FROM admin_pending_actions WHERE id=?").get(pending.id).status, 'completed');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles WHERE profile_id='anaimiya'").get().cnt, 1);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('hidden from website listings')));
  } finally {
    cleanup();
  }
});

test('Admin broadcast requires explicit confirmation and sends once to every saved client chat', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const insertContact = db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    insertContact.run(crypto.randomUUID(), '8102', '8102', 'anaimiya', 'pending_payment', 'FL-BCAST1');
    insertContact.run(crypto.randomUUID(), '8103', '8103', 'anaimiya', 'rejected', 'FL-BCAST2');
    insertContact.run(crypto.randomUUID(), '8104', '8104', 'anaimiya', 'awaiting_email', 'FL-BCAST3');
    insertContact.run(crypto.randomUUID(), '10001', '10001', 'anaimiya', 'approved', 'FL-BCASTA');
    const insertService = db.raw.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    insertService.run(crypto.randomUUID(), 'telegram_channel', '8102', '8102', 'fulfilled', 'FL-BCAST4');
    insertService.run(crypto.randomUUID(), 'telegram_channel', '8105', '8105', 'awaiting_request', 'FL-BCAST5');
    insertService.run(crypto.randomUUID(), 'telegram_channel', '8106', '8106', 'cancelled', 'FL-BCAST6');
    insertService.run(crypto.randomUUID(), 'telegram_channel', '8107', '8107', 'payment_review', 'FL-BCAST7');
    const expectedRecipients = ['8102', '8103', '8104', '8105', '8106', '8107'];

    await tgPost(env, adminMsg('/admin'));
    const adminHome = messagesTo(sentTelegramMessages, '10001').find(m => String(m.data.text).includes('Admin Desk'));
    const adminButtons = ((adminHome?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(adminButtons.some((button: any) => button.text === '📣 Broadcast to all clients' && button.callback_data === 'admin:broadcast_help'));
    await tgPost(env, callbackFrom(10001, 'admin:broadcast_help', 'cb-broadcast-help'));
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Current audience: <b>6</b> unique saved client chats')));

    await tgPost(env, userMsg(9999, '/broadcast This must not be sent'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_broadcast_drafts').get().cnt, 0);

    await tgPost(env, adminMsg('send mass message to all clients: Service update: your order status is available.'));
    const draft = db.raw.prepare("SELECT id,status FROM admin_broadcast_drafts WHERE admin_telegram_id='10001'").get() as any;
    assert.ok(draft);
    assert.equal(draft.status, 'draft');
    for (const recipient of expectedRecipients) {
      assert.equal(customerTelegramCalls(sentTelegramMessages, recipient).length, 0, 'Composing a broadcast must not message clients');
    }

    await tgPost(env, callbackFrom(10001, `broadcast:preview:${draft.id}`, 'cb-broadcast-preview'));
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Recipients: 6 unique saved client chats')));
    for (const recipient of expectedRecipients) {
      assert.equal(customerTelegramCalls(sentTelegramMessages, recipient).length, 0, 'Preview must not message clients');
    }

    await tgPost(env, callbackFrom(10001, `broadcast:send:${draft.id}`, 'cb-broadcast-send'));
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").get(draft.id).status, 'sent');
    for (const recipient of expectedRecipients) {
      assert.equal(customerTelegramCalls(sentTelegramMessages, recipient).length, 1, `Client ${recipient} must receive the broadcast exactly once`);
    }
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=? AND telegram_chat_id='10001'").get(draft.id).cnt, 0, 'The admin chat must be excluded from the client audience');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=? AND status='sent'").get(draft.id).cnt, expectedRecipients.length);
    const audit = db.raw.prepare("SELECT action,details FROM admin_audit WHERE action='admin_broadcast_sent'").get() as any;
    assert.ok(audit);
    assert.ok(String(audit.details).includes('recipients=6'));
    assert.equal(String(audit.details).includes('Service update:'), false, 'Broadcast audit must not store the message body');

    await tgPost(env, callbackFrom(10001, `broadcast:send:${draft.id}`, 'cb-broadcast-send-repeat'));
    await tgPost(env, adminMsg('yes'));
    for (const recipient of expectedRecipients) {
      assert.equal(customerTelegramCalls(sentTelegramMessages, recipient).length, 1, 'A completed broadcast cannot be resent');
    }
  } finally {
    cleanup();
  }
});

test('Admin broadcast is batched through the recipient ledger and scheduled continuation sends the remainder once', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const insertContact = db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    const recipients: string[] = [];
    for (let i = 0; i < 26; i++) {
      const chatId = String(9000 + i);
      recipients.push(chatId);
      insertContact.run(crypto.randomUUID(), chatId, chatId, 'anaimiya', i % 2 ? 'rejected' : 'pending_payment', `FL-B${String(i).padStart(5, '0')}`);
    }

    await tgPost(env, adminMsg('/broadcast Batch update for every client.'));
    const draft = db.raw.prepare("SELECT id FROM admin_broadcast_drafts WHERE admin_telegram_id='10001'").get() as any;
    await tgPost(env, callbackFrom(10001, `broadcast:send:${draft.id}`, 'cb-broadcast-batch-send'));

    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").get(draft.id).status, 'sending');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=? AND status='sent'").get(draft.id).cnt, 25);
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=? AND status='pending'").get(draft.id).cnt, 1);
    assert.equal(recipients.filter(recipient => customerTelegramCalls(sentTelegramMessages, recipient).length === 1).length, 25);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Broadcast in progress')));

    await worker.scheduled({ cron: '*/5 * * * *' } as any, env);
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").get(draft.id).status, 'sent');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=? AND status='sent'").get(draft.id).cnt, 26);
    for (const recipient of recipients) {
      assert.equal(customerTelegramCalls(sentTelegramMessages, recipient).length, 1, `Scheduled continuation must not duplicate client ${recipient}`);
    }
  } finally {
    cleanup();
  }
});

test('Admin can stop remaining broadcast recipients without resending completed clients', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const insertContact = db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    for (let i = 0; i < 26; i++) {
      const chatId = String(9100 + i);
      insertContact.run(crypto.randomUUID(), chatId, chatId, 'anaimiya', 'pending_payment', `FL-S${String(i).padStart(5, '0')}`);
    }

    await tgPost(env, adminMsg('/broadcast Stop after the first batch.'));
    const draft = db.raw.prepare("SELECT id FROM admin_broadcast_drafts WHERE admin_telegram_id='10001'").get() as any;
    await tgPost(env, callbackFrom(10001, `broadcast:send:${draft.id}`, 'cb-broadcast-stop-send'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9125').length, 0);

    await tgPost(env, callbackFrom(10001, `broadcast:stop:${draft.id}`, 'cb-broadcast-stop'));
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").get(draft.id).status, 'partial');
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_recipients WHERE broadcast_id=? AND telegram_chat_id='9125'").get(draft.id).status, 'cancelled');

    await worker.scheduled({ cron: '*/5 * * * *' } as any, env);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9125').length, 0, 'A stopped broadcast must not later send cancelled recipients');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9100').length, 1, 'Stopping must not resend completed recipients');
  } finally {
    cleanup();
  }
});

test('Stale in-flight broadcast recipient becomes uncertain and is never blind-retried', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const draftId = crypto.randomUUID();
    db.raw.prepare("INSERT INTO admin_broadcast_drafts(id,admin_telegram_id,message_text,status,expires_at) VALUES(?,'10001','Ledger safety update','sending',datetime('now','+30 minutes'))").run(draftId);
    db.raw.prepare("INSERT INTO admin_broadcast_recipients(broadcast_id,telegram_chat_id,status,attempted_at) VALUES(?, '9201','sending',datetime('now','-11 minutes'))").run(draftId);
    db.raw.prepare("INSERT INTO admin_broadcast_recipients(broadcast_id,telegram_chat_id,status) VALUES(?, '9202','pending')").run(draftId);

    await worker.scheduled({ cron: '*/5 * * * *' } as any, env);

    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_recipients WHERE broadcast_id=? AND telegram_chat_id='9201'").get(draftId).status, 'uncertain');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9201').length, 0, 'The stale in-flight recipient must not be blind-retried by the test process');
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_recipients WHERE broadcast_id=? AND telegram_chat_id='9202'").get(draftId).status, 'sent');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9202').length, 1);
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").get(draftId).status, 'partial');
  } finally {
    cleanup();
  }
});

test('Broadcast media caption is saved, previewed exactly, and delivered with the media', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const insertContact = db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    insertContact.run(crypto.randomUUID(), '8241', '8241', 'anaimiya', 'pending_payment', 'FL-BMED01');
    insertContact.run(crypto.randomUUID(), '8242', '8242', 'rosebeck', 'rejected', 'FL-BMED02');

    await tgPost(env, adminMsg('/broadcast'));
    await tgPost(env, supportPhotoPayload(8501, 'Weekend broadcast caption'));
    const draft = db.raw.prepare("SELECT * FROM admin_broadcast_drafts WHERE admin_telegram_id='10001'").get() as any;
    assert.ok(draft);
    assert.equal(draft.message_text, 'Weekend broadcast caption', 'The Telegram media caption must be saved as broadcast text');
    assert.equal(draft.media_kind, 'photo');
    assert.equal(draft.media_file_id, 'photo-file-large');
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('media caption was saved as the broadcast text')));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8241').length, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8242').length, 0);

    await tgPost(env, callbackFrom(10001, `broadcast:preview:${draft.id}`, 'cb-broadcast-media-preview'));
    const adminPreview = sentTelegramMessages.find(m => m.method === 'sendPhoto' && String(m.data.chat_id) === '10001');
    assert.ok(adminPreview, 'Broadcast preview must show the admin the actual media');
    assert.equal(adminPreview.data.photo, 'photo-file-large');
    assert.equal(adminPreview.data.caption, 'Weekend broadcast caption', 'Broadcast preview must use the exact saved caption');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=?').get(draft.id).cnt, 0, 'Preview must not create the recipient ledger');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8241').length, 0, 'Preview must not send to clients');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8242').length, 0, 'Preview must not send to clients');

    await tgPost(env, callbackFrom(10001, `broadcast:send:${draft.id}`, 'cb-broadcast-media-send'));
    assert.equal((db.raw.prepare('SELECT status FROM admin_broadcast_drafts WHERE id=?').get(draft.id) as any).status, 'sent');
    for (const recipient of ['8241', '8242']) {
      const calls = customerTelegramCalls(sentTelegramMessages, recipient);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, 'sendPhoto');
      assert.equal(calls[0].data.photo, 'photo-file-large');
      assert.equal(calls[0].data.caption, 'Weekend broadcast caption', 'Text and media must be delivered together');
    }
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_recipients WHERE broadcast_id=? AND status='sent'").get(draft.id).cnt, 2);
  } finally {
    cleanup();
  }
});

test('A media message captioned /broadcast creates one draft with both media and text', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)")
      .run(crypto.randomUUID(), '8251', '8251', 'anaimiya', 'pending_payment', 'FL-BMED03');

    await tgPost(env, supportPhotoPayload(8502, '/broadcast One-step broadcast text'));
    const draft = db.raw.prepare("SELECT * FROM admin_broadcast_drafts WHERE admin_telegram_id='10001'").get() as any;
    assert.ok(draft, 'Captioned /broadcast media must create a broadcast draft');
    assert.equal(draft.message_text, 'One-step broadcast text');
    assert.equal(draft.media_kind, 'photo');
    assert.equal(draft.media_file_id, 'photo-file-large');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8251').length, 0, 'Creating the draft must not send it');

    await tgPost(env, callbackFrom(10001, `broadcast:send:${draft.id}`, 'cb-broadcast-one-step-send'));
    const calls = customerTelegramCalls(sentTelegramMessages, '8251');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendPhoto');
    assert.equal(calls[0].data.caption, 'One-step broadcast text');
  } finally {
    cleanup();
  }
});

test('Clients cannot list creators in the bot, while the private admin can view and search profiles', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(6200, '/creators'));
    await tgPost(env, userMsg(6200, '/profiles rose'));
    const clientText = messagesTo(sentTelegramMessages, '6200').map(m => String(m.data.text || '')).join('\n');
    assert.ok(clientText.includes('listed on our website'));
    assert.ok(!clientText.includes('Anaimiya'));
    assert.ok(!clientText.includes('RoseBeck'));
    assert.ok(!clientText.includes('emanuela.ebony'));

    await tgPost(env, adminMsg('/profiles'));
    const adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('Current website profiles (4)'));
    assert.ok(adminText.includes('Anaimiya'));
    assert.ok(adminText.includes('RoseBeck'));
    assert.ok(adminText.includes('Emanuela Ebony'));

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/profiles rose'));
    const searchText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(searchText.includes('RoseBeck'));
    assert.ok(!searchText.includes('Anaimiya'));

    sentTelegramMessages.length = 0;
    await tgPost(env, { message: { chat: { id: -1006200 }, from: { id: 10001 }, text: '/profiles' } });
    const groupText = messagesTo(sentTelegramMessages, '-1006200').map(m => String(m.data.text || '')).join('\n');
    assert.ok(groupText.includes('private Admin Desk'));
    assert.ok(!groupText.includes('Anaimiya'));
  } finally {
    cleanup();
  }
});

test('Bulk pending closure is snapshot-bound and excludes verified and payment-review orders', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    const contactPending = crypto.randomUUID();
    const contactChangedAfterPreview = crypto.randomUUID();
    const contactVerified = crypto.randomUUID();
    const contactCreatedAfterPreview = crypto.randomUUID();
    const servicePending = crypto.randomUUID();
    const serviceAwaiting = crypto.randomUUID();
    const serviceVerified = crypto.randomUUID();
    const serviceReview = crypto.randomUUID();

    const insertContact = db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)`);
    insertContact.run(contactPending, '7001', '7001', 'anaimiya', 'pending_payment', 'FL-CLS001');
    insertContact.run(contactChangedAfterPreview, '7002', '7002', 'anaimiya', 'pending_manual_payment', 'FL-CLS002');
    insertContact.run(contactVerified, '7003', '7003', 'anaimiya', 'payment_verified', 'FL-CLS003');
    const insertService = db.raw.prepare(`INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code) VALUES(?,?,?,?,?,?)`);
    insertService.run(servicePending, 'svc', '7101', '7101', 'pending_payment', 'FL-CLS101');
    insertService.run(serviceAwaiting, 'svc', '7102', '7102', 'awaiting_request', 'FL-CLS102');
    insertService.run(serviceVerified, 'svc', '7103', '7103', 'payment_verified', 'FL-CLS103');
    insertService.run(serviceReview, 'svc', '7104', '7104', 'payment_review', 'FL-CLS104');

    await tgPost(env, adminMsg('/expirepending'));
    const pending = db.raw.prepare("SELECT id,payload,status FROM admin_pending_actions WHERE action='close_pending_orders'").get() as any;
    assert.ok(pending);
    assert.equal(pending.status, 'pending');
    const snapshot = JSON.parse(pending.payload);
    assert.deepEqual(snapshot.contacts.map((x: any) => x.id).sort(), [contactPending, contactChangedAfterPreview].sort());
    assert.deepEqual(snapshot.services.map((x: any) => x.id).sort(), [servicePending, serviceAwaiting].sort());
    assert.ok(!pending.payload.includes(contactVerified));
    assert.ok(!pending.payload.includes(serviceVerified));
    assert.ok(!pending.payload.includes(serviceReview));

    insertContact.run(contactCreatedAfterPreview, '7004', '7004', 'anaimiya', 'pending_payment', 'FL-CLS004');
    db.raw.prepare("UPDATE contact_requests SET status='payment_verified' WHERE id=?").run(contactChangedAfterPreview);

    await tgPost(env, adminMsg('yes'));
    const status = (table: string, id: string) => (db.raw.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id) as any).status;
    assert.equal(status('contact_requests', contactPending), 'expired');
    assert.equal(status('contact_requests', contactChangedAfterPreview), 'payment_verified', 'an order whose status changed after preview must be skipped');
    assert.equal(status('contact_requests', contactVerified), 'payment_verified');
    assert.equal(status('contact_requests', contactCreatedAfterPreview), 'pending_payment', 'an order created after preview must not be swept into the old confirmation');
    assert.equal(status('service_orders', servicePending), 'cancelled');
    assert.equal(status('service_orders', serviceAwaiting), 'cancelled');
    assert.equal(status('service_orders', serviceVerified), 'payment_verified');
    assert.equal(status('service_orders', serviceReview), 'payment_review');
    assert.equal(status('admin_pending_actions', pending.id), 'completed');
  } finally {
    cleanup();
  }
});

test('Permanent single-order deletion requires confirmation, removes child records, and retains payment/audit ledgers', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)")
      .run(orderId, '9101', '9101', 'anaimiya', 'pending_payment', 'FL-DEL001');
    db.raw.prepare("INSERT INTO checkout_name_prompts(telegram_user_id,order_id,order_kind) VALUES('9101',?,'contact')").run(orderId);
    db.raw.prepare("INSERT INTO receipt_review_prompts(telegram_user_id,order_id,order_kind) VALUES('9101',?,'contact')").run(orderId);
    db.raw.prepare(`INSERT INTO payment_receipt_submissions
      (id,order_id,order_kind,telegram_user_id,telegram_chat_id,telegram_message_id,media_kind,telegram_file_id,telegram_file_unique_id,mime_type,file_size,status,admin_telegram_id)
      VALUES(?,?,'contact','9101','9101',91001,'photo','synthetic-file-id','synthetic-unique-id','image/jpeg',123,'forwarded','10001')`)
      .run(crypto.randomUUID(), orderId);
    db.raw.prepare(`INSERT INTO delivery_drafts(id,request_id,admin_telegram_id,checkout_code,message_text,status,expires_at)
      VALUES(?,?,'10001','FL-DEL001','Synthetic cancelled delivery','cancelled','2999-01-01 00:00:00')`)
      .run(crypto.randomUUID(), orderId);
    db.raw.prepare(`INSERT INTO admin_message_drafts(id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,message_text,status,expires_at)
      VALUES(?,?,'contact','10001','9101','9101','FL-DEL001','Synthetic cancelled support','cancelled','2999-01-01 00:00:00')`)
      .run(crypto.randomUUID(), orderId);
    db.raw.prepare(`INSERT INTO processed_sales(provider_reference,buyer_email,amount_minor,currency,product_id,request_id)
      VALUES('synthetic-sale-del001','buyer@example.invalid',100,'USD','synthetic-product',?)`).run(orderId);
    db.raw.prepare(`INSERT INTO processed_abandoned_carts(event_key,product_code,request_id,abandoned_at)
      VALUES('synthetic-cart-del001','synthetic-product',?,datetime('now'))`).run(orderId);
    db.raw.prepare(`INSERT INTO admin_audit(admin_telegram_id,action,request_id,profile_id,details)
      VALUES('10001','synthetic_existing_audit',?,'anaimiya','Synthetic retained audit')`).run(orderId);

    await tgPost(env, userMsg(9999, '/deleteorder FL-DEL001'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE status='pending'").get().cnt, 0, 'A non-admin must not prepare deletion');
    await tgPost(env, callbackFrom(9999, `admin:deleteorder:contact:${orderId}`, 'cb-delete-nonadmin'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE status='pending'").get().cnt, 0, 'A non-admin callback must not prepare deletion');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 1);

    await tgPost(env, adminMsg('/order FL-DEL001'));
    assert.ok(sentTelegramMessages.some(m => JSON.stringify(m.data.reply_markup || {}).includes(`admin:deleteorder:contact:${orderId}`)), 'Order inspection should expose the permanent-delete preparation button');

    await tgPost(env, adminMsg('/deleteorder FL-DEL001'));
    const pending = db.raw.prepare("SELECT id,action,payload,status FROM admin_pending_actions WHERE action='delete_order' AND status='pending'").get() as any;
    assert.ok(pending);
    assert.ok(String(pending.payload).includes(orderId));
    assert.ok(String(pending.payload).includes('pending_payment'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 1, 'Preview alone must not delete the order');
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Permanently delete this order?') && String(m.data.text).includes('customer will <b>not</b> be notified')));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9101').length, 0);

    db.raw.prepare(`INSERT INTO admin_receipt_verify_prompts(admin_telegram_id,order_id,order_kind,expires_at)
      VALUES('10001',?,'contact','2999-01-01 00:00:00')`).run(orderId);
    await tgPost(env, callbackFrom(10001, `admin-action:confirm:${pending.id}`, 'cb-delete-confirm'));

    assert.equal(db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pending.id).status, 'completed');
    const count = (query: string, ...values: any[]) => (db.raw.prepare(query).get(...values) as any).cnt;
    assert.equal(count('SELECT count(*) AS cnt FROM contact_requests WHERE id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM checkout_name_prompts WHERE order_id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM receipt_review_prompts WHERE order_id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM payment_receipt_submissions WHERE order_id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM admin_message_drafts WHERE order_id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM admin_receipt_verify_prompts WHERE order_id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM delivery_drafts WHERE request_id=?', orderId), 0);
    assert.equal(count('SELECT count(*) AS cnt FROM processed_sales WHERE request_id=?', orderId), 1, 'Used sale references must stay blocked from reuse');
    assert.equal(count('SELECT count(*) AS cnt FROM processed_abandoned_carts WHERE request_id=?', orderId), 1, 'Webhook event deduplication must be retained');
    assert.equal(count("SELECT count(*) AS cnt FROM admin_audit WHERE request_id=? AND action='synthetic_existing_audit'", orderId), 1);
    assert.equal(count("SELECT count(*) AS cnt FROM admin_audit WHERE request_id=? AND action='admin_order_permanently_deleted'", orderId), 1);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9101').length, 0, 'Permanent admin clearing is silent to the customer');
  } finally {
    cleanup();
  }
});

test('Permanent deletion skips orders changed after preview or with a draft mid-send', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const changedId = crypto.randomUUID();
    db.raw.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code) VALUES(?,?,?,?,?,?)")
      .run(changedId, 'telegram_channel', '9102', '9102', 'pending_payment', 'FL-DEL002');

    await tgPost(env, adminMsg('/deleteorder FL-DEL002'));
    let pending = db.raw.prepare("SELECT id FROM admin_pending_actions WHERE action='delete_order' AND status='pending'").get() as any;
    assert.ok(pending);
    db.raw.prepare("UPDATE service_orders SET status='payment_verified' WHERE id=?").run(changedId);
    await tgPost(env, adminMsg('yes'));

    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(changedId) as any).status, 'payment_verified', 'A changed order must be skipped');
    assert.equal(db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pending.id).status, 'completed');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_audit WHERE request_id=? AND action='admin_order_permanently_deleted'").get(changedId).cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('changed or no longer exists')));

    const sendingId = crypto.randomUUID();
    const sendingDraftId = crypto.randomUUID();
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)")
      .run(sendingId, '9103', '9103', 'anaimiya', 'pending_payment', 'FL-DEL003');
    db.raw.prepare(`INSERT INTO admin_message_drafts(id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,message_text,status,expires_at)
      VALUES(?,?,'contact','10001','9103','9103','FL-DEL003','Synthetic uncertain support send','sending','2999-01-01 00:00:00')`)
      .run(sendingDraftId, sendingId);

    await tgPost(env, callbackFrom(10001, `admin:deleteorder:contact:${sendingId}`, 'cb-delete-sending-prepare'));
    pending = db.raw.prepare("SELECT id FROM admin_pending_actions WHERE action='delete_order' AND status='pending'").get() as any;
    assert.ok(pending);
    await tgPost(env, callbackFrom(10001, `admin-action:confirm:${pending.id}`, 'cb-delete-sending-confirm'));

    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(sendingId).cnt, 1, 'A mid-send order must not be deleted');
    assert.equal((db.raw.prepare('SELECT status FROM admin_message_drafts WHERE id=?').get(sendingDraftId) as any).status, 'sending');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_audit WHERE request_id=? AND action='admin_order_permanently_deleted'").get(sendingId).cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('mid-send')));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9103').length, 0);
  } finally {
    cleanup();
  }
});

test('Bulk permanent deletion is scope-bound, snapshot-bound, and silent to customers', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const ids = {
      contactPending: crypto.randomUUID(),
      contactAwaiting: crypto.randomUUID(),
      contactVerified: crypto.randomUUID(),
      contactApproved: crypto.randomUUID(),
      contactRejected: crypto.randomUUID(),
      contactAfterPreview: crypto.randomUUID(),
      servicePending: crypto.randomUUID(),
      serviceReview: crypto.randomUUID(),
      serviceVerified: crypto.randomUUID(),
      serviceFulfilled: crypto.randomUUID(),
      serviceCancelled: crypto.randomUUID()
    };
    const insertContact = db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    insertContact.run(ids.contactPending, '9201', '9201', 'anaimiya', 'pending_payment', 'FL-BDEL01');
    insertContact.run(ids.contactAwaiting, '9202', '9202', 'anaimiya', 'awaiting_email', 'FL-BDEL02');
    insertContact.run(ids.contactVerified, '9203', '9203', 'anaimiya', 'payment_verified', 'FL-BDEL03');
    insertContact.run(ids.contactApproved, '9204', '9204', 'anaimiya', 'approved', 'FL-BDEL04');
    insertContact.run(ids.contactRejected, '9205', '9205', 'anaimiya', 'rejected', 'FL-BDEL05');
    const insertService = db.raw.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code) VALUES(?,?,?,?,?,?)");
    insertService.run(ids.servicePending, 'telegram_channel', '9301', '9301', 'pending_payment', 'FL-BDEL11');
    insertService.run(ids.serviceReview, 'telegram_channel', '9302', '9302', 'payment_review', 'FL-BDEL12');
    insertService.run(ids.serviceVerified, 'telegram_channel', '9303', '9303', 'payment_verified', 'FL-BDEL13');
    insertService.run(ids.serviceFulfilled, 'telegram_channel', '9304', '9304', 'fulfilled', 'FL-BDEL14');
    insertService.run(ids.serviceCancelled, 'telegram_channel', '9305', '9305', 'cancelled', 'FL-BDEL15');
    const exists = (table: string, id: string) => Boolean(db.raw.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id));

    await tgPost(env, adminMsg('/admin'));
    assert.ok(sentTelegramMessages.some(m => JSON.stringify(m.data.reply_markup || {}).includes('admin:clear_orders') && JSON.stringify(m.data.reply_markup || {}).includes('admin:assistant_help')), 'Admin Desk should expose clear-orders and assistant help');

    await tgPost(env, callbackFrom(10001, 'admin:clear_orders', 'cb-clear-chooser'));
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Clear orders permanently')));
    assert.ok(sentTelegramMessages.some(m => ['admin:clearorders:pending', 'admin:clearorders:finished', 'admin:clearorders:all'].every(callback => JSON.stringify(m.data.reply_markup || {}).includes(callback))));

    await tgPost(env, callbackFrom(10001, 'admin:clearorders:pending', 'cb-clear-pending'));
    let pending = db.raw.prepare("SELECT id,payload FROM admin_pending_actions WHERE action='delete_orders_bulk' AND status='pending'").get() as any;
    assert.ok(pending);
    let payload = JSON.parse(pending.payload);
    assert.equal(payload.scope, 'pending');
    assert.deepEqual(payload.contacts.map((x: any) => x.id).sort(), [ids.contactPending, ids.contactAwaiting].sort());
    assert.deepEqual(payload.services.map((x: any) => x.id), [ids.servicePending]);
    assert.ok(!pending.payload.includes(ids.contactVerified));
    assert.ok(!pending.payload.includes(ids.serviceReview));
    assert.ok(!pending.payload.includes(ids.contactApproved));

    insertContact.run(ids.contactAfterPreview, '9206', '9206', 'anaimiya', 'pending_payment', 'FL-BDEL06');
    db.raw.prepare("UPDATE contact_requests SET status='payment_verified' WHERE id=?").run(ids.contactPending);
    await tgPost(env, adminMsg('yes'));

    assert.equal(exists('contact_requests', ids.contactAwaiting), false);
    assert.equal(exists('service_orders', ids.servicePending), false);
    assert.equal(exists('contact_requests', ids.contactPending), true, 'Changed snapshot order must remain');
    assert.equal(exists('contact_requests', ids.contactAfterPreview), true, 'Order created after preview must remain');
    assert.equal(exists('contact_requests', ids.contactVerified), true);
    assert.equal(exists('service_orders', ids.serviceReview), true);
    assert.equal(db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pending.id).status, 'completed');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_audit WHERE action='admin_orders_permanently_deleted_bulk'").get().cnt, 1);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9202').length, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9301').length, 0);

    await tgPost(env, adminMsg('/clearorders finished'));
    pending = db.raw.prepare("SELECT id,payload FROM admin_pending_actions WHERE action='delete_orders_bulk' AND status='pending'").get() as any;
    assert.ok(pending);
    payload = JSON.parse(pending.payload);
    assert.equal(payload.scope, 'finished');
    assert.deepEqual(payload.contacts.map((x: any) => x.id).sort(), [ids.contactApproved, ids.contactRejected].sort());
    assert.deepEqual(payload.services.map((x: any) => x.id).sort(), [ids.serviceFulfilled, ids.serviceCancelled].sort());
    assert.ok(!pending.payload.includes(ids.contactVerified));
    assert.ok(!pending.payload.includes(ids.serviceReview));
    await tgPost(env, adminMsg('yes'));

    assert.equal(exists('contact_requests', ids.contactApproved), false);
    assert.equal(exists('contact_requests', ids.contactRejected), false);
    assert.equal(exists('service_orders', ids.serviceFulfilled), false);
    assert.equal(exists('service_orders', ids.serviceCancelled), false);
    assert.equal(exists('contact_requests', ids.contactVerified), true, 'Finished scope must exclude payment_verified');
    assert.equal(exists('service_orders', ids.serviceReview), true, 'Finished scope must exclude payment_review');

    await tgPost(env, adminMsg('/clearorders all'));
    pending = db.raw.prepare("SELECT id,payload FROM admin_pending_actions WHERE action='delete_orders_bulk' AND status='pending'").get() as any;
    assert.ok(pending);
    payload = JSON.parse(pending.payload);
    assert.equal(payload.scope, 'all');
    assert.equal(payload.contacts.length, 3);
    assert.equal(payload.services.length, 2);
    await tgPost(env, callbackFrom(10001, `admin-action:confirm:${pending.id}`, 'cb-clear-all-confirm'));

    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests').get().cnt, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM service_orders').get().cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('Bulk permanent deletion finished')));
    for (const chatId of ['9201', '9202', '9203', '9204', '9205', '9206', '9301', '9302', '9303', '9304', '9305']) {
      assert.equal(customerTelegramCalls(sentTelegramMessages, chatId).length, 0, `Bulk clearing must not notify ${chatId}`);
    }
  } finally {
    cleanup();
  }
});

test('Admin assistant crafts drafts and prepares deletions but never sends, deletes, or verifies by itself', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)")
      .run(orderId, '9401', '9401', 'anaimiya', 'pending_payment', 'FL-AST001');
    const craftedSupport = 'Hi there — sorry for the delay. We are checking it now and will update you here shortly.';
    const craftedBroadcast = 'Hello everyone, we have fresh updates for you today. Thank you for being here.';
    const envWithAi = {
      ...env,
      AI: {
        run: async (_model: string, input: any) => {
          const system = String(input?.messages?.[0]?.content || '');
          const user = String(input?.messages?.[1]?.content || '');
          if (system.includes('strict intent classifier')) {
            if (user.includes('friendly message to customer')) {
              return { response: JSON.stringify({ action: 'message_customer', ref: 'FL-AST001', instruction: 'Apologise for the delay and say we are checking it now' }) };
            }
            if (user.includes('broadcast')) {
              return { response: JSON.stringify({ action: 'broadcast', instruction: 'Tell all clients there are fresh updates today' }) };
            }
            if (user.includes('get rid of that test order')) {
              return { response: JSON.stringify({ action: 'delete_order', ref: 'FL-AST001' }) };
            }
            return { response: JSON.stringify({ action: 'none' }) };
          }
          if (system.includes('You write short')) {
            return { response: user.includes('all clients') ? craftedBroadcast : craftedSupport };
          }
          return { response: 'unused' };
        }
      }
    };

    await tgPost(envWithAi, adminMsg('Please write a friendly message to customer FL-AST001 apologising for the delay and saying we are checking it now'));
    const supportDraft = latestSupportDraft(db, orderId);
    assert.ok(supportDraft, 'Assistant should open the existing support draft flow');
    assert.equal(supportDraft.status, 'draft');
    assert.equal(supportDraft.purpose, 'support');
    assert.equal(supportDraft.message_text, craftedSupport);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9401').length, 0, 'Assistant drafting must not send to the customer');
    await tgPost(env, callbackFrom(10001, `support-message:cancel:${supportDraft.id}`, 'cb-assistant-support-cancel'));
    assert.equal((db.raw.prepare('SELECT status FROM admin_message_drafts WHERE id=?').get(supportDraft.id) as any).status, 'cancelled');

    await tgPost(envWithAi, adminMsg('Write a short broadcast telling all clients we have fresh updates today'));
    const broadcastDraft = db.raw.prepare('SELECT * FROM admin_broadcast_drafts ORDER BY rowid DESC LIMIT 1').get() as any;
    assert.ok(broadcastDraft, 'Assistant should open the existing broadcast draft flow');
    assert.equal(broadcastDraft.status, 'draft');
    assert.equal(broadcastDraft.message_text, craftedBroadcast);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9401').length, 0, 'Assistant broadcast drafting must not send');
    await tgPost(env, callbackFrom(10001, `broadcast:cancel:${broadcastDraft.id}`, 'cb-assistant-broadcast-cancel'));
    assert.equal((db.raw.prepare('SELECT status FROM admin_broadcast_drafts WHERE id=?').get(broadcastDraft.id) as any).status, 'cancelled');

    await tgPost(env, adminMsg('Verify the payment for FL-AST001'));
    const orderAfterVerifyAttempt = db.raw.prepare('SELECT status,payment_reference FROM contact_requests WHERE id=?').get(orderId) as any;
    assert.equal(orderAfterVerifyAttempt.status, 'pending_payment');
    assert.equal(orderAfterVerifyAttempt.payment_reference, null);
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales WHERE request_id=?').get(orderId).cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text).includes('verify or confirm payments')));

    await tgPost(env, adminMsg('delete order FL-AST001'));
    let pending = db.raw.prepare("SELECT id FROM admin_pending_actions WHERE action='delete_order' AND status='pending'").get() as any;
    assert.ok(pending, 'Deterministic delete phrase should prepare, not execute, deletion');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 1);
    await tgPost(env, callbackFrom(10001, `admin-action:cancel:${pending.id}`, 'cb-assistant-delete-cancel'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 1, 'Cancelling a prepared deletion must leave the order intact');

    await tgPost(envWithAi, adminMsg('Please get rid of that test order FL-AST001 for me'));
    pending = db.raw.prepare("SELECT id FROM admin_pending_actions WHERE action='delete_order' AND status='pending'").get() as any;
    assert.ok(pending, 'AI-classified delete wording should stop at a confirmation preview');
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 1, 'AI classification alone must not delete');
    await tgPost(env, adminMsg('yes'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 0);
    assert.equal(db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pending.id).status, 'completed');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '9401').length, 0);
  } finally {
    cleanup();
  }
});

test('A voice transcript cannot prepare permanent order deletion', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  const baseFetch = globalThis.fetch;
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,?,?,?,?,?)")
      .run(orderId, '9501', '9501', 'anaimiya', 'pending_payment', 'FL-VCE001');

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.includes('/getFile?')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/delete-test.ogg', file_size: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlText.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return (baseFetch as any)(url, init);
    }) as any;
    const voiceEnv = {
      ...env,
      AI: {
        run: async (model: string) => model === '@cf/openai/whisper' ? { text: 'delete order FL-VCE001' } : { response: 'unused' }
      }
    };

    await tgPost(voiceEnv, {
      message: {
        chat: { id: 10001 },
        from: { id: 10001 },
        voice: { file_id: 'voice-delete-test', file_unique_id: 'voice-delete-unique', file_size: 3, duration: 1 }
      }
    });

    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(orderId).cnt, 1);
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE status='pending'").get().cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('will not run that consequential admin action from a voice transcript')));
  } finally {
    globalThis.fetch = baseFetch;
    cleanup();
  }
});

test('Admin callbacks fail closed outside the private Admin Desk chat', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const requestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7201', '7201', 'anaimiya', 'payment_verified', 'FL-GRP001')`).run(requestId);

    await tgPost(env, {
      callback_query: {
        id: 'cb-admin-group',
        from: { id: 10001 },
        message: { chat: { id: -1007201 } },
        data: `approve:${requestId}`
      }
    });

    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM delivery_drafts WHERE request_id=?').get(requestId) as any).cnt, 0);
    assert.ok(sentTelegramMessages.some(m => m.method === 'answerCallbackQuery' && String(m.data.text || '').includes('Admin private chat only')));
  } finally {
    cleanup();
  }
});

test('A voice-transcribed YES cannot execute a pending consequential admin action', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  const baseFetch = globalThis.fetch;
  try {
    const pendingId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO admin_pending_actions(id,admin_telegram_id,action,payload,status,expires_at)
      VALUES (?, '10001', 'hide_profile', 'anaimiya', 'pending', datetime('now','+10 minutes'))`).run(pendingId);

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.includes('/getFile?')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/test.ogg', file_size: 3 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (urlText.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return (baseFetch as any)(url, init);
    }) as any;
    const voiceEnv = {
      ...env,
      AI: {
        run: async (model: string) => model === '@cf/openai/whisper' ? { text: 'yes' } : { response: 'unused' }
      }
    };

    await tgPost(voiceEnv, {
      message: {
        chat: { id: 10001 },
        from: { id: 10001 },
        voice: { file_id: 'voice-yes-test', file_unique_id: 'voice-yes-unique', file_size: 3, duration: 1 }
      }
    });

    assert.equal((db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pendingId) as any).status, 'pending');
    assert.equal((db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles WHERE profile_id='anaimiya'").get() as any).cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('will not run that consequential admin action from a voice transcript')));

    globalThis.fetch = baseFetch;
    await tgPost(env, adminMsg('yes'));
    assert.equal((db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pendingId) as any).status, 'completed', 'an explicitly typed YES remains valid for the same pending action');
    assert.equal((db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles WHERE profile_id='anaimiya'").get() as any).cnt, 1);
  } finally {
    globalThis.fetch = baseFetch;
    cleanup();
  }
});

test('Request delivery can send one admin-attached video after explicit confirmation', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const requestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7301', '7301', 'anaimiya', 'payment_verified', 'FL-DVID01')`).run(requestId);

    await tgPost(env, callbackFrom(10001, `approve:${requestId}`, 'cb-delivery-video-open'));
    const draft = db.raw.prepare('SELECT id FROM delivery_drafts WHERE request_id=?').get(requestId) as any;
    assert.ok(draft);
    await tgPost(env, {
      message: {
        chat: { id: 10001, type: 'private' },
        from: { id: 10001 },
        video: { file_id: 'delivery-video-file', file_unique_id: 'delivery-video-unique', mime_type: 'video/mp4', file_size: 12000, duration: 4 }
      }
    });
    const saved = db.raw.prepare('SELECT media_kind,media_file_id,media_mime_type FROM delivery_drafts WHERE id=?').get(draft.id) as any;
    assert.equal(saved.media_kind, 'document');
    assert.equal(saved.media_file_id, 'delivery-video-file');
    assert.equal(saved.media_mime_type, 'video/mp4');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7301').length, 0);

    await tgPost(env, callbackFrom(10001, `draft:send:${draft.id}`, 'cb-delivery-video-send'));
    const calls = customerTelegramCalls(sentTelegramMessages, '7301');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'sendVideo');
    assert.equal(calls[0].data.video, 'delivery-video-file');
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(requestId) as any).status, 'approved');
  } finally {
    cleanup();
  }
});

test('Release 2: one admin composer spans all draft workflows and YES cannot become service fulfilment text', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const serviceOrderId = crypto.randomUUID();
    const contactRequestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,telegram_username,request_text,status,payment_method,payment_reference,checkout_code)
      VALUES (?, 'custom_service', '7401', '7401', 'service_customer', 'Customer: Please prepare the synthetic package.', 'payment_verified', 'selar', 'synthetic-service-ref', 'FL-R2SVC1')`).run(serviceOrderId);
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7402', '7402', 'anaimiya', 'payment_verified', 'FL-R2REQ1')`).run(contactRequestId);

    await tgPost(env, adminMsg('/deliver FL-R2SVC1'));
    const serviceDraft = db.raw.prepare('SELECT * FROM service_delivery_drafts WHERE service_order_id=?').get(serviceOrderId) as any;
    assert.ok(serviceDraft, 'FL code must open the service fulfilment composer');
    assert.equal(serviceDraft.status, 'draft');
    assert.equal(String(serviceDraft.message_text || ''), '');

    await tgPost(env, adminMsg('/message FL-R2REQ1 This support draft must not open'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_message_drafts').get().cnt, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('Another composer is already open') && String(m.data.text || '').includes('service fulfilment')));

    await tgPost(env, adminMsg('/broadcast This broadcast must not open'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM admin_broadcast_drafts').get().cnt, 0);

    await tgPost(env, callbackFrom(10001, `approve:${contactRequestId}`, 'cb-r2-approve-conflict'));
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM delivery_drafts').get().cnt, 0);

    await tgPost(env, adminMsg('YES'));
    assert.equal(String((db.raw.prepare('SELECT message_text FROM service_delivery_drafts WHERE id=?').get(serviceDraft.id) as any).message_text || ''), '', 'YES must not be captured as service fulfilment text');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7401').length, 0, 'YES must not send service fulfilment');
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('YES was') && String(m.data.text || '').includes('not') && String(m.data.text || '').includes('added as delivery text')));

    await tgPost(env, adminMsg('Your synthetic service package is ready.'));
    assert.equal((db.raw.prepare('SELECT message_text FROM service_delivery_drafts WHERE id=?').get(serviceDraft.id) as any).message_text, 'Your synthetic service package is ready.');

    await tgPost(env, {
      message: {
        chat: { id: 10001, type: 'private' },
        from: { id: 10001 },
        video: { file_id: 'service-r2-video', file_unique_id: 'service-r2-video-unique', mime_type: 'video/mp4', file_size: 14000, duration: 5 }
      }
    });
    const withMedia = db.raw.prepare('SELECT media_kind,media_file_id,media_mime_type FROM service_delivery_drafts WHERE id=?').get(serviceDraft.id) as any;
    assert.equal(withMedia.media_kind, 'document');
    assert.equal(withMedia.media_file_id, 'service-r2-video');
    assert.equal(withMedia.media_mime_type, 'video/mp4');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7401').length, 0);

    await tgPost(env, adminMsg('x'.repeat(1100)));
    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `service-delivery:send:${serviceDraft.id}`, 'cb-r2-service-caption-too-long'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'answerCallbackQuery' && String(m.data.text || '').includes('media caption')), 'Over-limit media caption is rejected before claiming the send');
    assert.equal((db.raw.prepare('SELECT status FROM service_delivery_drafts WHERE id=?').get(serviceDraft.id) as any).status, 'draft');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7401').length, 0);

    await tgPost(env, adminMsg('Short synthetic fulfilment note.'));
    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `service-delivery:preview:${serviceDraft.id}`, 'cb-r2-service-preview'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'sendVideo' && String(m.data.chat_id) === '10001'), 'Admin preview sends media to the Admin Desk only');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7401').length, 0);

    await tgPost(env, callbackFrom(10001, `service-delivery:send:${serviceDraft.id}`, 'cb-r2-service-send'));
    const customerCalls = customerTelegramCalls(sentTelegramMessages, '7401');
    assert.equal(customerCalls.length, 1);
    assert.equal(customerCalls[0].method, 'sendVideo');
    assert.equal(customerCalls[0].data.video, 'service-r2-video');
    assert.ok(String(customerCalls[0].data.caption || '').includes('Short synthetic fulfilment note.'));
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any).status, 'fulfilled');
    assert.equal((db.raw.prepare('SELECT status FROM service_delivery_drafts WHERE id=?').get(serviceDraft.id) as any).status, 'sent');

    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `service-delivery:send:${serviceDraft.id}`, 'cb-r2-service-send-repeat'));
    const repeatText = sentTelegramMessages.filter(m => m.method === 'answerCallbackQuery').map(m => String(m.data.text || '')).join('\n');
    assert.ok(repeatText.includes('was already sent'), 'A stale service Send button identifies the sent state');
    assert.ok(!repeatText.includes('expired or is no longer active'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7401').length, 0);
  } finally {
    cleanup();
  }
});

test('Release 2: stale request-delivery buttons distinguish sent, cancelled, and expired; Prepare preserves draft content', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  const callbackTexts = () => sentTelegramMessages.filter(m => m.method === 'answerCallbackQuery').map(m => String(m.data.text || '')).join('\n');
  try {
    const firstRequestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7501', '7501', 'anaimiya', 'payment_verified', 'FL-R2STA1')`).run(firstRequestId);

    await tgPost(env, callbackFrom(10001, `approve:${firstRequestId}`, 'cb-r2-first-open'));
    const firstDraft = db.raw.prepare('SELECT * FROM delivery_drafts WHERE request_id=?').get(firstRequestId) as any;
    assert.ok(firstDraft);
    await tgPost(env, adminMsg('Keep this exact admin-composed fulfilment.'));
    assert.equal((db.raw.prepare('SELECT message_text FROM delivery_drafts WHERE id=?').get(firstDraft.id) as any).message_text, 'Keep this exact admin-composed fulfilment.');

    await tgPost(env, callbackFrom(10001, `approve:${firstRequestId}`, 'cb-r2-first-reopen'));
    assert.equal((db.raw.prepare('SELECT message_text FROM delivery_drafts WHERE id=?').get(firstDraft.id) as any).message_text, 'Keep this exact admin-composed fulfilment.', 'A stale Prepare button must not erase the existing draft');

    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `draft:preview:${firstDraft.id}`, 'cb-r2-first-preview'));
    assert.ok(callbackTexts().includes('Preview only'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7501').length, 0);

    await tgPost(env, callbackFrom(10001, `draft:send:${firstDraft.id}`, 'cb-r2-first-send'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7501').length, 1);
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(firstRequestId) as any).status, 'approved');
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('Delivery sent once')));

    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `draft:send:${firstDraft.id}`, 'cb-r2-first-send-repeat'));
    assert.ok(callbackTexts().includes('was already sent'));
    assert.ok(!callbackTexts().includes('expired or is no longer active'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7501').length, 0);

    const secondRequestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7502', '7502', 'rosebeck', 'payment_verified', 'FL-R2STA2')`).run(secondRequestId);
    await tgPost(env, callbackFrom(10001, `approve:${secondRequestId}`, 'cb-r2-second-open'));
    const secondDraft = db.raw.prepare('SELECT * FROM delivery_drafts WHERE request_id=?').get(secondRequestId) as any;
    await tgPost(env, callbackFrom(10001, `draft:cancel:${secondDraft.id}`, 'cb-r2-second-cancel'));
    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `draft:send:${secondDraft.id}`, 'cb-r2-second-cancelled-send'));
    assert.ok(callbackTexts().includes('was already cancelled'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7502').length, 0);

    const thirdRequestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7503', '7503', 'sweet_creator', 'payment_verified', 'FL-R2STA3')`).run(thirdRequestId);
    await tgPost(env, callbackFrom(10001, `approve:${thirdRequestId}`, 'cb-r2-third-open'));
    const thirdDraft = db.raw.prepare('SELECT * FROM delivery_drafts WHERE request_id=?').get(thirdRequestId) as any;
    db.raw.prepare("UPDATE delivery_drafts SET expires_at='2000-01-01 00:00:00' WHERE id=?").run(thirdDraft.id);
    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `draft:send:${thirdDraft.id}`, 'cb-r2-third-expired-send'));
    assert.ok(callbackTexts().includes('draft expired'));
    assert.equal((db.raw.prepare('SELECT status FROM delivery_drafts WHERE id=?').get(thirdDraft.id) as any).status, 'expired');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7503').length, 0);
  } finally {
    cleanup();
  }
});

test('Release 2: legacy multiple editable drafts fail closed for ordinary text, media, and YES', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const contactRequestId = crypto.randomUUID();
    const serviceOrderId = crypto.randomUUID();
    const deliveryDraftId = crypto.randomUUID();
    const serviceDraftId = crypto.randomUUID();
    const broadcastDraftId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7601', '7601', 'anaimiya', 'payment_verified', 'FL-R2AMB1')`).run(contactRequestId);
    db.raw.prepare(`INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code)
      VALUES (?, 'custom_service', '7602', '7602', 'payment_verified', 'FL-R2AMB2')`).run(serviceOrderId);
    db.raw.prepare(`INSERT INTO delivery_drafts(id,request_id,admin_telegram_id,checkout_code,message_text,status,expires_at)
      VALUES (?, ?, '10001', 'FL-R2AMB1', 'Original request text', 'draft', datetime('now','+30 minutes'))`).run(deliveryDraftId, contactRequestId);
    db.raw.prepare(`INSERT INTO service_delivery_drafts(id,service_order_id,admin_telegram_id,message_text,status,expires_at)
      VALUES (?, ?, '10001', 'Original service text', 'draft', datetime('now','+30 minutes'))`).run(serviceDraftId, serviceOrderId);
    db.raw.prepare(`INSERT INTO admin_broadcast_drafts(id,admin_telegram_id,message_text,status,expires_at)
      VALUES (?, '10001', 'Original broadcast text', 'draft', datetime('now','+30 minutes'))`).run(broadcastDraftId);

    await tgPost(env, adminMsg('Ambiguous replacement text'));
    await tgPost(env, {
      message: {
        chat: { id: 10001, type: 'private' },
        from: { id: 10001 },
        photo: [{ file_id: 'ambiguous-photo', file_unique_id: 'ambiguous-photo-unique', file_size: 1200, width: 100, height: 100 }]
      }
    });
    await tgPost(env, adminMsg('YES'));

    assert.equal((db.raw.prepare('SELECT message_text FROM delivery_drafts WHERE id=?').get(deliveryDraftId) as any).message_text, 'Original request text');
    assert.equal((db.raw.prepare('SELECT message_text FROM service_delivery_drafts WHERE id=?').get(serviceDraftId) as any).message_text, 'Original service text');
    assert.equal((db.raw.prepare('SELECT message_text FROM admin_broadcast_drafts WHERE id=?').get(broadcastDraftId) as any).message_text, 'Original broadcast text');
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM delivery_drafts WHERE media_file_id='ambiguous-photo'").get().cnt, 0);
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM service_delivery_drafts WHERE media_file_id='ambiguous-photo'").get().cnt, 0);
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_broadcast_drafts WHERE media_file_id='ambiguous-photo'").get().cnt, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7601').length, 0);
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7602').length, 0);
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('Another composer is already open')));
  } finally {
    cleanup();
  }
});

test('Release 2: deterministic order and profile inspection exposes the right records without changing state', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const serviceOrderId = crypto.randomUUID();
    const pendingServiceOrderId = crypto.randomUUID();
    const contactRequestId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,telegram_username,request_text,status,payment_method,payment_reference,checkout_code,checkout_name,buyer_email)
      VALUES (?, 'custom_service', '7701', '7701', 'inspection_customer', 'Customer: Build the synthetic inspection package with blue accents.', 'payment_verified', 'selar', 'synthetic-inspection-ref', 'FL-R2ORD1', 'Inspection Customer FL-R2ORD1', 'inspection@example.test')`).run(serviceOrderId);
    db.raw.prepare(`INSERT INTO service_orders
      (id,service_id,telegram_user_id,telegram_chat_id,request_text,status,checkout_code)
      VALUES (?, 'custom_service', '7702', '7702', 'Customer: Pending synthetic request text must stay hidden.', 'pending_payment', 'FL-R2ORD2')`).run(pendingServiceOrderId);
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7703', '7703', 'anaimiya', 'pending_payment', 'FL-R2ORD3')`).run(contactRequestId);
    db.raw.prepare("INSERT INTO hidden_profiles(profile_id,hidden_by_admin,reason) VALUES ('rosebeck','10001','Synthetic inspection hide')").run();
    db.raw.prepare("INSERT INTO hidden_profiles(profile_id,hidden_by_admin,reason) VALUES ('ghost_profile','10001','Synthetic stale override')").run();

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/orders custom_service'));
    let adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('FL-R2ORD1'));
    assert.ok(adminText.includes('/order FL-R2ORD1'));
    assert.ok(!adminText.includes('FL-R2ORD3'), 'Order search must filter deterministically');

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/order FL-R2ORD1'));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('Service order inspection'));
    assert.ok(adminText.includes('Build the synthetic inspection package'));
    assert.ok(adminText.includes('synthetic-inspection-ref'));
    assert.ok(adminText.includes('email never matches or verifies payment'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7701').length, 0);
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any).status, 'payment_verified');

    sentTelegramMessages.length = 0;
    await tgPost(env, callbackFrom(10001, `admin:service:${serviceOrderId}`, 'cb-r2-service-inspect'));
    assert.ok(messagesTo(sentTelegramMessages, '10001').some(m => String(m.data.text || '').includes('Saved service request')));

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/order FL-R2ORD2'));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('stays hidden until'));
    assert.ok(!adminText.includes('Pending synthetic request text must stay hidden'));

    sentTelegramMessages.length = 0;
    await tgPost(env, userMsg(9999, '/order FL-R2ORD1'));
    const nonAdminText = messagesTo(sentTelegramMessages, '9999').map(m => String(m.data.text || '')).join('\n');
    assert.ok(!nonAdminText.includes('Build the synthetic inspection package'));
    assert.ok(!nonAdminText.includes('synthetic-inspection-ref'));

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/profile anaimiya'));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('Profile inspection'));
    assert.ok(adminText.includes('Current visibility'));
    assert.ok(adminText.includes('pending_payment'));

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/profiles hidden'));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('Hidden website profiles'));
    assert.ok(adminText.includes('rosebeck'));
    assert.ok(adminText.includes('ghost_profile'));
    assert.ok(adminText.includes('source missing'));

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg('/profile ghost_profile'));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('without a live source profile'));

    await tgPost(env, adminMsg('/hideprofile anaimiya'));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('reversible hide'));
    assert.ok(adminText.includes('not physical deletion'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles WHERE profile_id='anaimiya'").get().cnt, 0, 'Hide preview alone must not change visibility');

    await tgPost(env, adminMsg('YES'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles WHERE profile_id='anaimiya'").get().cnt, 1);
    await tgPost(env, adminMsg('/restoreprofile anaimiya'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM hidden_profiles WHERE profile_id='anaimiya'").get().cnt, 0);
    assert.equal(db.raw.prepare('SELECT count(*) AS cnt FROM contact_requests WHERE id=?').get(contactRequestId).cnt, 1, 'Visibility changes retain order records');
  } finally {
    cleanup();
  }
});

test('Release 2: stale sending draft recovery requires a separate confirmation and never resends', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const serviceOrderId = crypto.randomUUID();
    const serviceDraftId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,status,checkout_code)
      VALUES (?, 'custom_service', '7801', '7801', 'payment_verified', 'FL-R2REC1')`).run(serviceOrderId);
    db.raw.prepare(`INSERT INTO service_delivery_drafts(id,service_order_id,admin_telegram_id,message_text,status,expires_at,updated_at)
      VALUES (?, ?, '10001', 'Synthetic locked fulfilment', 'sending', datetime('now','+30 minutes'), datetime('now','-10 minutes'))`).run(serviceDraftId, serviceOrderId);

    await tgPost(env, adminMsg('/drafts'));
    let adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes(`/recoverdraft service ${serviceDraftId}`));

    await tgPost(env, adminMsg(`/recoverdraft service ${serviceDraftId}`));
    const pending = db.raw.prepare("SELECT * FROM admin_pending_actions WHERE action='recover_draft' AND status='pending'").get() as any;
    assert.ok(pending);
    assert.equal((db.raw.prepare('SELECT status FROM service_delivery_drafts WHERE id=?').get(serviceDraftId) as any).status, 'sending', 'Recovery preview alone must not unlock the draft');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7801').length, 0);

    await tgPost(env, adminMsg('YES'));
    assert.equal((db.raw.prepare('SELECT status FROM service_delivery_drafts WHERE id=?').get(serviceDraftId) as any).status, 'cancelled');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any).status, 'payment_verified', 'Recovery must not fulfil or otherwise change the order');
    assert.equal((db.raw.prepare('SELECT status FROM admin_pending_actions WHERE id=?').get(pending.id) as any).status, 'completed');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '7801').length, 0, 'Recovery must never resend');
    assert.ok((db.raw.prepare("SELECT action FROM admin_audit WHERE action='admin_draft_recovered_cancelled'").get() as any)?.action === 'admin_draft_recovered_cancelled');

    await tgPost(env, adminMsg('/deliver FL-R2REC1 Fresh synthetic replacement'));
    const reopened = db.raw.prepare('SELECT status,message_text,media_file_id FROM service_delivery_drafts WHERE id=?').get(serviceDraftId) as any;
    assert.equal(reopened.status, 'draft');
    assert.equal(reopened.message_text, 'Fresh synthetic replacement');
    assert.equal(reopened.media_file_id, null);

    const contactRequestId = crypto.randomUUID();
    const supportDraftId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '7802', '7802', 'anaimiya', 'pending_payment', 'FL-R2REC2')`).run(contactRequestId);
    db.raw.prepare(`INSERT INTO admin_message_drafts(id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,message_text,status,expires_at,updated_at)
      VALUES (?, ?, 'contact', '10001', '7802', '7802', 'FL-R2REC2', 'Recent locked support', 'sending', datetime('now','+30 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run(supportDraftId, contactRequestId);

    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg(`/recoverdraft support ${supportDraftId}`));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('not old enough for recovery'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE status='pending'").get().cnt, 0);
    assert.equal((db.raw.prepare('SELECT status FROM admin_message_drafts WHERE id=?').get(supportDraftId) as any).status, 'sending');

    db.raw.prepare("UPDATE service_delivery_drafts SET status='sent' WHERE id=?").run(serviceDraftId);
    sentTelegramMessages.length = 0;
    await tgPost(env, adminMsg(`/recoverdraft service ${serviceDraftId}`));
    adminText = messagesTo(sentTelegramMessages, '10001').map(m => String(m.data.text || '')).join('\n');
    assert.ok(adminText.includes('was already sent'));
    assert.equal(db.raw.prepare("SELECT count(*) AS cnt FROM admin_pending_actions WHERE status='pending'").get().cnt, 0);
  } finally {
    cleanup();
  }
});


test('Annie shows previous unpaid order details, cancels and deletes it, then returns to the two service options', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 6201);
    await tgPost(env, userMsg(6201, '/start'));
    await tgPost(env, callbackFrom(6201, 'services:join', 'first-join'));
    const first = db.raw.prepare("SELECT * FROM service_orders WHERE telegram_user_id='6201'").get() as any;
    assert.ok(first);
    await tgPost(env, callbackFrom(6201, 'services:join', 'second-join'));
    const prompt = messagesTo(sentTelegramMessages, '6201').at(-1);
    assert.match(String(prompt?.data.text), new RegExp(first.checkout_code));
    const cancelButton = ((prompt?.data.reply_markup as any)?.inline_keyboard || []).flat().find((b: any) => String(b.callback_data).startsWith('order:cancel:'));
    assert.ok(cancelButton, 'Previous unpaid order must have a cancel button');
    await tgPost(env, callbackFrom(6201, String(cancelButton.callback_data), 'cancel-old-order'));
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE id=?").get(first.id).n, 0, 'Cancelled unpaid order must be deleted');
    const afterCancel = messagesTo(sentTelegramMessages, '6201').at(-1);
    const buttons = ((afterCancel?.data.reply_markup as any)?.inline_keyboard || []).flat();
    assert.ok(buttons.some((b: any) => b.text === '📸 Visit the website ✨'));
    assert.ok(buttons.some((b: any) => b.callback_data === 'services:join'));
  } finally { cleanup(); }
});

test('Channel flow allows up to three unverified orders and blocks a fourth', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, callbackFrom(6202, 'services:join', 'join-1'));
    for (let i = 2; i <= 3; i++) {
      await tgPost(env, callbackFrom(6202, 'services:join', 'prompt-' + i));
      await tgPost(env, callbackFrom(6202, 'services:continue', 'continue-' + i));
    }
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE telegram_user_id='6202' AND status='pending_payment'").get().n, 3);
    await tgPost(env, callbackFrom(6202, 'services:join', 'join-at-limit'));
    const last = messagesTo(sentTelegramMessages, '6202').at(-1);
    assert.match(String(last?.data.text), /limit of <b>3 unpaid orders/i);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE telegram_user_id='6202'").get().n, 3);
  } finally { cleanup(); }
});

test('Previously fulfilled channel order offers Start again and creates a fresh order without deleting history', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    db.raw.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,payment_method,checkout_code) VALUES(?,?,?,?,?,'fulfilled','selar',?)")
      .run('6203-previous-order', 'telegram_channel', '6203', '6203', 'hot_customer', 'FL-ABC123');
    await tgPost(env, callbackFrom(6203, 'services:join', 'join-after-complete'));
    const prompt = messagesTo(sentTelegramMessages, '6203').at(-1);
    assert.match(String(prompt?.data.text), /previous channel order was completed/i);
    assert.ok(((prompt?.data.reply_markup as any)?.inline_keyboard || []).flat().some((b: any) => b.callback_data === 'services:restart'));
    await tgPost(env, callbackFrom(6203, 'services:restart', 'restart-order'));
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE telegram_user_id='6203'").get().n, 2);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE id='6203-previous-order' AND status='fulfilled'").get().n, 1);
  } finally { cleanup(); }
});

test('Hourly cleanup deletes unpaid orders older than 48 hours and tells the customer', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    db.raw.prepare("INSERT INTO service_orders(id,service_id,telegram_user_id,telegram_chat_id,telegram_username,status,payment_method,checkout_code,created_at) VALUES(?,?,?,?,?,'pending_payment','selar',?,datetime('now','-49 hours'))")
      .run('6204-expired-service', 'telegram_channel', '6204', '6204', 'expire_me', 'FL-EXP123');
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,telegram_username,profile_id,status,payment_method,checkout_code,created_at) VALUES(?,?,?,?,?,'pending_payment','selar',?,datetime('now','-49 hours'))")
      .run('6205-expired-contact', '6205', '6205', 'expire_contact', 'anaimiya', 'FL-EXP456');
    await worker.scheduled({} as any, env);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE id='6204-expired-service'").get().n, 0);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM contact_requests WHERE id='6205-expired-contact'").get().n, 0);
    assert.match(messagesTo(sentTelegramMessages, '6204').map(m => String(m.data.text)).join('\n'), /deleted because checkout wasn't completed within 48 hours/i);
    assert.match(messagesTo(sentTelegramMessages, '6205').map(m => String(m.data.text)).join('\n'), /deleted because checkout wasn't completed within 48 hours/i);
  } finally { cleanup(); }
});

test('Language picker gates a first plain /start, saves every supported choice, and resumes the localized welcome', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const cases = [
      { user: 6301, code: 'en', welcome: 'Hey babe, what do you want?', start: '🚀 Start', language: '🌐 Language' },
      { user: 6302, code: 'es', welcome: 'Hola, guapo, ¿qué quieres?', start: '🚀 Inicio', language: '🌐 Idioma' },
      { user: 6303, code: 'de', welcome: 'Hey mein Hübscher, was hättest du gern?', start: '🚀 Start', language: '🌐 Sprache' },
      { user: 6304, code: 'fr', welcome: 'Salut beau gosse, qu’est-ce qui te ferait plaisir ?', start: '🚀 Démarrer', language: '🌐 Langue' },
      { user: 6305, code: 'ar', welcome: 'مرحبًا حبيبي، ماذا تريد؟', start: '🚀 ابدأ', language: '🌐 اللغة' },
      { user: 6306, code: 'pt', welcome: 'Olá, querido, o que queres?', start: '🚀 Iniciar', language: '🌐 Idioma' }
    ];
    const expectedCallbacks = ['language:set:en', 'language:set:es', 'language:set:de', 'language:set:fr', 'language:set:ar', 'language:set:pt'];
    for (const item of cases) {
      await tgPost(env, userMsg(item.user, '/start'));
      const picker = messagesTo(sentTelegramMessages, String(item.user)).at(-1);
      assert.ok(String(picker?.data.text).includes('Choose your language'), 'A first plain /start must show the language picker');
      assert.ok(String(picker?.data.text).includes('اختر لغتك'), 'The picker heading must include Arabic script');
      const buttons = ((picker?.data.reply_markup as any)?.inline_keyboard || []).flat();
      assert.deepEqual(buttons.map((b: any) => b.callback_data), expectedCallbacks);
      assert.equal((db.raw.prepare('SELECT count(*) AS n FROM contact_requests WHERE telegram_user_id=?').get(String(item.user)) as any).n, 0);
      assert.equal((db.raw.prepare('SELECT count(*) AS n FROM service_orders WHERE telegram_user_id=?').get(String(item.user)) as any).n, 0);

      await tgPost(env, callbackFrom(item.user, `language:set:${item.code}`, `lang-${item.code}`));
      const pref = db.raw.prepare('SELECT language_code,pending_start_payload FROM user_language_preferences WHERE telegram_user_id=?').get(String(item.user)) as any;
      assert.equal(pref.language_code, item.code);
      assert.equal(pref.pending_start_payload, null);
      const customerMessages = messagesTo(sentTelegramMessages, String(item.user));
      assert.ok(customerMessages.some(m => String(m.data.text).includes(item.welcome)), `The ${item.code} welcome must be shown after selection`);
      const tip = customerMessages.at(-1);
      const replyButtons = (((tip?.data.reply_markup as any)?.keyboard || []) as any[]).flat().map((b: any) => b.text);
      assert.ok(replyButtons.includes(item.start), `The ${item.code} Start button must be persistent`);
      assert.ok(replyButtons.includes(item.language), `The ${item.code} Language button must be persistent`);

      const beforeSecondStart = customerMessages.length;
      await tgPost(env, userMsg(item.user, '/start'));
      const secondStart = messagesTo(sentTelegramMessages, String(item.user)).slice(beforeSecondStart);
      assert.ok(secondStart.some(m => String(m.data.text).includes(item.welcome)), 'A saved language must be restored on the next /start');
      assert.ok(!secondStart.some(m => String(m.data.text).includes('Choose your language')), 'A saved language must not force the picker again');
    }
  } finally {
    cleanup();
  }
});

test('Language picker preserves a pending profile start, resumes it in Portuguese exactly once, and keeps payment callbacks intact', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(6311, '/start contact_anaimiya'));
    assert.equal((db.raw.prepare("SELECT count(*) AS n FROM contact_requests WHERE telegram_user_id='6311'").get() as any).n, 0, 'No order may be created before language selection');
    const pending = db.raw.prepare("SELECT language_code,pending_start_payload FROM user_language_preferences WHERE telegram_user_id='6311'").get() as any;
    assert.deepEqual([pending.language_code, pending.pending_start_payload], [null, 'contact_anaimiya']);

    await tgPost(env, callbackFrom(6311, 'language:set:pt', 'lang-profile-pt'));
    const order = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='6311'").get() as any;
    assert.ok(order, 'Selecting Portuguese must resume the preserved profile start');
    assert.equal(order.profile_id, 'anaimiya');
    assert.match(order.checkout_code, /^FL-[0-9A-Z]{6}$/);
    const savedPref = db.raw.prepare("SELECT language_code,pending_start_payload FROM user_language_preferences WHERE telegram_user_id='6311'").get() as any;
    assert.deepEqual([savedPref.language_code, savedPref.pending_start_payload], ['pt', null]);

    const customerMessages = messagesTo(sentTelegramMessages, '6311');
    assert.ok(customerMessages.some(m => String(m.data.text).includes('Idioma guardado')));
    const greeting = customerMessages.find(m => String(m.data.text).includes('Sou a Annie para Anaimiya.'));
    assert.ok(greeting, 'The resumed greeting must be in Portuguese');
    assert.ok(String(greeting.data.text).includes(`<b>John Doe ${order.checkout_code}</b>`), 'The FL code must remain unchanged in Portuguese instructions');
    const payButton = (((greeting.data.reply_markup as any)?.inline_keyboard || []) as any[]).flat().find((b: any) => b.callback_data === `pay_selar:${order.id}`);
    assert.ok(payButton, 'The existing pay_selar callback must be preserved');

    await tgPost(env, callbackFrom(6311, payButton.callback_data, 'pt-pay-now'));
    const checkoutMessage = messagesTo(sentTelegramMessages, '6311').find(m => String(m.data.text).includes(String(env.SELAR_CHECKOUT_URL)) && String(m.data.text).includes(order.checkout_code));
    assert.ok(checkoutMessage, 'Portuguese checkout instructions must preserve the URL and FL code');
    const openCheckout = (((checkoutMessage.data.reply_markup as any)?.inline_keyboard || []) as any[]).flat().find((b: any) => b.url);
    assert.equal(openCheckout?.url, `${env.SELAR_CHECKOUT_URL}?add_to_cart=1`);

    await tgPost(env, callbackFrom(6311, 'language:set:pt', 'lang-profile-pt-again'));
    assert.equal((db.raw.prepare("SELECT count(*) AS n FROM contact_requests WHERE telegram_user_id='6311'").get() as any).n, 1, 'A repeated language tap must not resume the cleared start again');
  } finally {
    cleanup();
  }
});

test('Language picker preserves a pending service start and resumes it in Arabic script', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(6312, '/start service_consultation1'));
    assert.equal((db.raw.prepare("SELECT count(*) AS n FROM service_orders WHERE telegram_user_id='6312'").get() as any).n, 0);
    assert.equal((db.raw.prepare("SELECT pending_start_payload FROM user_language_preferences WHERE telegram_user_id='6312'").get() as any).pending_start_payload, 'service_consultation1');

    await tgPost(env, callbackFrom(6312, 'language:set:ar', 'lang-service-ar'));
    const order = db.raw.prepare("SELECT * FROM service_orders WHERE telegram_user_id='6312'").get() as any;
    assert.ok(order, 'Selecting Arabic must resume the preserved service start');
    assert.equal(order.service_id, 'consultation1');
    assert.equal(order.status, 'awaiting_request');
    assert.match(order.checkout_code, /^FL-[0-9A-Z]{6}$/);
    const welcome = messagesTo(sentTelegramMessages, '6312').find(m => String(m.data.text).includes(order.id));
    assert.ok(welcome, 'The service welcome must include the order reference');
    assert.match(String(welcome.data.text), /[\u0600-\u06FF]/, 'The resumed service welcome must render Arabic script');
    assert.ok(String(welcome.data.text).includes('اكتب PAY'));
    assert.equal((db.raw.prepare("SELECT pending_start_payload FROM user_language_preferences WHERE telegram_user_id='6312'").get() as any).pending_start_payload, null);
  } finally {
    cleanup();
  }
});

test('Switching language with /language or the localized button preserves an order and its checkout-name prompt', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    seedLanguage(db, 6313, 'en');
    await tgPost(env, userMsg(6313, '/start contact_anaimiya'));
    const order = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='6313'").get() as any;
    assert.ok(order);
    await tgPost(env, callbackFrom(6313, `done:${order.id}`, 'lang-switch-done'));
    assert.ok(db.raw.prepare("SELECT order_id FROM checkout_name_prompts WHERE telegram_user_id='6313'").get(), 'The checkout-name prompt must be open before switching');

    await tgPost(env, userMsg(6313, '/language'));
    assert.ok(String(messagesTo(sentTelegramMessages, '6313').at(-1)?.data.text).includes('Choose your language'));
    await tgPost(env, callbackFrom(6313, 'language:set:es', 'lang-switch-es'));
    assert.ok(messagesTo(sentTelegramMessages, '6313').some(m => String(m.data.text).includes('Tus solicitudes y pedidos actuales no han cambiado.')));
    let saved = db.raw.prepare('SELECT status,checkout_code,checkout_name FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.deepEqual([saved.status, saved.checkout_code, saved.checkout_name], ['pending_payment', order.checkout_code, null]);
    assert.ok(db.raw.prepare("SELECT order_id FROM checkout_name_prompts WHERE telegram_user_id='6313'").get(), 'Switching language must not consume the checkout-name prompt');

    await tgPost(env, userMsg(6313, '🌐 Idioma'));
    assert.ok(String(messagesTo(sentTelegramMessages, '6313').at(-1)?.data.text).includes('Choose your language'), 'The localized Language button must reopen the picker instead of being treated as a checkout name');
    assert.ok(db.raw.prepare("SELECT order_id FROM checkout_name_prompts WHERE telegram_user_id='6313'").get(), 'The localized Language button must not consume the prompt');
    await tgPost(env, callbackFrom(6313, 'language:set:de', 'lang-switch-de'));
    assert.equal((db.raw.prepare("SELECT language_code FROM user_language_preferences WHERE telegram_user_id='6313'").get() as any).language_code, 'de');
    assert.ok(db.raw.prepare("SELECT order_id FROM checkout_name_prompts WHERE telegram_user_id='6313'").get());

    await tgPost(env, userMsg(6313, `Buyer Name ${order.checkout_code}`));
    saved = db.raw.prepare('SELECT status,checkout_code,checkout_name FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.deepEqual([saved.status, saved.checkout_code, saved.checkout_name], ['pending_payment', order.checkout_code, 'Buyer Name']);
    assert.equal(db.raw.prepare("SELECT count(*) AS n FROM checkout_name_prompts WHERE telegram_user_id='6313'").get().n, 0);
  } finally {
    cleanup();
  }
});

test('Invalid language callbacks fail safely, the admin cannot save a customer language, and missing preferences fall back to English', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(6314, '/start'));
    await tgPost(env, callbackFrom(6314, 'language:set:xx', 'lang-invalid'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'answerCallbackQuery' && String(m.data.text).includes('That language option is not available.')));
    assert.equal((db.raw.prepare("SELECT language_code FROM user_language_preferences WHERE telegram_user_id='6314'").get() as any).language_code, null);

    await tgPost(env, userMsg(6314, '/creators'));
    assert.ok(String(messagesTo(sentTelegramMessages, '6314').at(-1)?.data.text).includes('Creator profiles are listed on our website'), 'An ongoing message with no saved language must fall back to English');
    assert.equal((db.raw.prepare("SELECT language_code FROM user_language_preferences WHERE telegram_user_id='6314'").get() as any).language_code, null);

    await tgPost(env, callbackFrom(10001, 'language:set:es', 'lang-admin-blocked'));
    assert.ok(sentTelegramMessages.some(m => m.method === 'answerCallbackQuery' && String(m.data.text).includes('Open your private chat with this bot to choose a language.')));
    assert.equal(db.raw.prepare("SELECT * FROM user_language_preferences WHERE telegram_user_id='10001'").get(), undefined);
  } finally {
    cleanup();
  }
});
