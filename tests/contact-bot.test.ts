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
    assert.ok(String(sent.data.text).includes(order.checkout_code));
    assert.ok(String(sent.data.text).includes('Anaimiya'));
  } finally {
    cleanup();
  }
});

test('Starting request with invalid profile fails closed', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
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
    assert.ok(String(sent?.data.text).includes('not currently in the public FansLeak catalogue'));
  } finally {
    cleanup();
  }
});

test('Separate service orders are created and isolated from contact requests', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
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

test('Unknown code can reconcile only by exact full checkout name, never partial name', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, checkout_name)
      VALUES ('full-name-match', '5101', '5101', 'anaimiya', 'pending_payment', 'selar', 'FL-NAME01', 'Joseph Simon Unaogu')
    `).run();

    const partial = await selarPost(env, { reference: 'ref-partial-name', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Joseph FL-UNKNWN' });
    assert.deepEqual(await partial.json(), { ok: true, matched: false, reason: 'no_unique_code_or_full_name_match' });
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).length, 0, 'partial name must not notify admin');

    const exact = await selarPost(env, { reference: 'ref-full-name', product_code: env.SELAR_PRODUCT_ID, customer_full_name: 'Joseph Simon Unaogu FL-UNKNWN' });
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

test('A sale without a unique code is not attached by email and does not notify admin', async () => {
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
    assert.deepEqual(await res.json(), { ok: true, matched: false, reason: 'no_unique_code_or_full_name_match' });
    const order = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id = ?').get('req-uuid-2') as any;
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.payment_reference, null);
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).length, 0, 'unmatched sales must not generate unsolicited admin alerts');
  } finally {
    cleanup();
  }
});

test('Admin authorization, payment verification, explicit consent, and fulfilment release safeguards', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const reqId = crypto.randomUUID();
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5007', '5007', 'anaimiya', 'pending_payment', 'selar', 'ref_verified_01', 'FL-ABC123')
    `).run(reqId);

    // 1. Non-admin attempt to verify payment is REJECTED
    const nonAdminVerify = {
      callback_query: {
        id: 'cb-1',
        from: { id: 9999 }, // not ADMIN_TELEGRAM_ID (10001)
        message: { chat: { id: 9999 } },
        data: `selarverify:${reqId}`
      }
    };
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(nonAdminVerify)
    }), env);

    let order = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'pending_payment', 'Non-admin cannot verify payment');

    // 2. Admin verifies payment -> status becomes 'payment_verified'
    const adminVerify = {
      callback_query: {
        id: 'cb-2',
        from: { id: 10001 },
        message: { chat: { id: 10001 } },
        data: `selarverify:${reqId}`
      }
    };
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(adminVerify)
    }), env);

    order = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'payment_verified', 'Admin callback verifies payment');

    // 3. Admin attempts to approve, but creator consent is NOT yet confirmed
    // (no row in creator_contacts yet)
    const adminApproveNoConsent = {
      callback_query: {
        id: 'cb-3',
        from: { id: 10001 },
        message: { chat: { id: 10001 } },
        data: `approve:${reqId}`
      }
    };
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(adminApproveNoConsent)
    }), env);

    order = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'payment_verified', 'Must NOT approve if creator consent is missing');

    // 4. Admin uses /setcontact -> sharing is disabled by default (0)
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: '/setcontact anaimiya @anaimiya_real' }
      })
    }), env);

    let contact = await db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get('anaimiya') as any;
    assert.ok(contact, 'Creator contact saved');
    assert.equal(contact.contact_value, '@anaimiya_real');
    assert.equal(contact.sharing_enabled, 0, 'Sharing must be disabled by default');
    assert.equal(contact.consent_confirmed_at, null, 'Consent must be null initially');

    // 5. Still fails closed if sharing_enabled is 0
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(adminApproveNoConsent)
    }), env);

    order = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'payment_verified', 'Must NOT approve while sharing is disabled');

    // 6. Admin enables consent via /enablecontact
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: '/enablecontact anaimiya' }
      })
    }), env);

    contact = await db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get('anaimiya') as any;
    assert.equal(contact.sharing_enabled, 1);
    assert.ok(contact.consent_confirmed_at !== null);

    // 7. Payment and consent are ready, but approval waits for the draft confirmation.
    sentTelegramMessages.length = 0;
    const adminApprove = { callback_query: { id: "cb-4", from: { id: 10001 }, message: { chat: { id: 10001 } }, data: "approve:" + reqId } };
    await worker.fetch(new Request("https://worker.local/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(adminApprove) }), env);
    order = await db.raw.prepare("SELECT status FROM contact_requests WHERE id=?").get(reqId) as any;
    assert.equal(order.status, "payment_verified", "Opening a draft must not approve or deliver");
    const draft = db.raw.prepare("SELECT id,status FROM delivery_drafts WHERE request_id=?").get(reqId) as any;
    assert.ok(draft);
    assert.equal(draft.status, "draft");

    // A second request must not create a concurrent editable draft that could
    // receive the wrong customer's custom message or attachment.
    const secondReqId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, checkout_code)
      VALUES (?, '5008', '5008', 'anaimiya', 'payment_verified', 'FL-SECOND1')`).run(secondReqId);
    await worker.fetch(new Request("https://worker.local/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify({ callback_query: { id: "cb-second-draft", from: { id: 10001 }, message: { chat: { id: 10001 } }, data: "approve:" + secondReqId } }) }), env);
    assert.equal(db.raw.prepare("SELECT id FROM delivery_drafts WHERE request_id=?").get(secondReqId), undefined, "Overlapping contact draft is blocked");

    await worker.fetch(new Request("https://worker.local/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify({ message: { chat: { id: 10001 }, from: { id: 10001 }, text: "Your approved creator contact is ready." } }) }), env);
    await worker.fetch(new Request("https://worker.local/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify({ callback_query: { id: "cb-preview", from: { id: 10001 }, message: { chat: { id: 10001 } }, data: "draft:preview:" + draft.id } }) }), env);
    assert.ok(sentTelegramMessages.some(m => String(m.data.text || "").includes("Preview only")));
    await worker.fetch(new Request("https://worker.local/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify({ callback_query: { id: "cb-send", from: { id: 10001 }, message: { chat: { id: 10001 } }, data: "draft:send:" + draft.id } }) }), env);
    order = await db.raw.prepare("SELECT status FROM contact_requests WHERE id=?").get(reqId) as any;
    assert.equal(order.status, "approved", "Confirmed draft transitions request to approved");
    const releaseMsg = sentTelegramMessages.find(m => m.method === "sendMessage" && String(m.data.chat_id) === "5007");
    assert.ok(releaseMsg, "Customer receives the confirmed delivery");
    assert.ok(String(releaseMsg.data.text).includes("@anaimiya_real"));
    sentTelegramMessages.length = 0;
    await worker.fetch(new Request("https://worker.local/telegram/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(adminApprove) }), env);
    const repeatOrder = await db.raw.prepare("SELECT status FROM contact_requests WHERE id=?").get(reqId) as any;
    assert.equal(repeatOrder.status, "approved");
    assert.equal(sentTelegramMessages.some(m => String(m.data.chat_id) === "5007" && String(m.data.text || "").includes("@anaimiya_real")), false, "Repeated approval cannot re-send contact details");
    // 9. Test consent revocation via /disablecontact
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: '/disablecontact anaimiya' }
      })
    }), env);

    contact = await db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get('anaimiya') as any;
    assert.equal(contact.sharing_enabled, 0, 'Consent must be revoked');
    assert.equal(contact.consent_confirmed_at, null, 'Timestamp must be cleared');

    // Future requests for this creator fail closed even if payment is verified
    const newReqId = crypto.randomUUID();
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5008', '5008', 'anaimiya', 'payment_verified', 'selar', 'ref_verified_02', 'FL-REVOKE')
    `).run(newReqId);

    const approveRevoked = {
      callback_query: {
        id: 'cb-5',
        from: { id: 10001 },
        message: { chat: { id: 10001 } },
        data: `approve:${newReqId}`
      }
    };
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(approveRevoked)
    }), env);

    const revokedOrder = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(newReqId) as any;
    assert.equal(revokedOrder.status, 'payment_verified', 'Must NOT approve when consent is revoked');
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
    const preview = sentTelegramMessages.find(m => m.method === 'sendMessage' && String(m.data.chat_id) === '10001' && String(m.data.text).includes('Service fulfilment preview'));
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

test('Service order email is saved as a clue but never attaches a sale without code and name', async () => {
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
    const customerAck = sentTelegramMessages.find(m => m.data.chat_id === '9100' && String(m.data.text).includes('saved as a fallback reconciliation clue'));
    assert.ok(customerAck, 'Customer should receive fallback clue confirmation');

    const saleRes = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({ reference: 'selar-srv-email-ref-1', buyer_email: 'client@example.com', customer_full_name: 'Client Without Code', product_code: env.SERVICE_PRODUCT_ID })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(saleRes.status, 200);
    assert.deepEqual(await saleRes.json(), { ok: true, matched: false, reason: 'no_unique_code_or_full_name_match' });
    const updatedOrder = db.raw.prepare('SELECT status, payment_method, payment_reference FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(updatedOrder.status, 'pending_payment');
    assert.equal(updatedOrder.payment_reference, null);
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 0);
  } finally {
    cleanup();
  }
});

test('A sale with no unique code match is not reconciled by shared email or alerted', async () => {
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
    assert.deepEqual(await saleRes.json(), { ok: true, matched: false, reason: 'no_unique_code_or_full_name_match' });
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
    const preview = sentTelegramMessages.find(m => m.method === 'sendMessage' && String(m.data.chat_id) === '10001' && String(m.data.text).includes('Service fulfilment preview'));
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

test('Creator consent revocation and non-admin restrictions', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    const nonAdminId = 9999;
    const profileId = 'testprofile';

    // 1. Non-admin cannot set contact
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: nonAdminId }, from: { id: nonAdminId }, text: `/setcontact ${profileId} @secret_handle` }
      })
    }), env);

    let contact = db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get(profileId) as any;
    assert.equal(contact, undefined, 'Non-admin must not be able to set contact');

    // 2. Admin sets contact and enables consent
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/setcontact ${profileId} @valid_handle` }
      })
    }), env);

    contact = db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get(profileId) as any;
    assert.equal(contact.contact_value, '@valid_handle');
    assert.equal(contact.sharing_enabled, 0);

    // Admin attestation confirms consent
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/enablecontact ${profileId}` }
      })
    }), env);

    contact = db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get(profileId) as any;
    assert.equal(contact.sharing_enabled, 1);
    assert.ok(contact.consent_confirmed_at);

    // 3. Admin revokes consent with /disablecontact
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/disablecontact ${profileId}` }
      })
    }), env);

    contact = db.raw.prepare('SELECT * FROM creator_contacts WHERE profile_id=?').get(profileId) as any;
    assert.equal(contact.sharing_enabled, 0);
    assert.equal(contact.consent_confirmed_at, null);

    // 4. Contact release must be blocked when consent is revoked.
    // Must be a real UUID: admin callbacks reject non-UUID ids before any
    // consent logic runs, so a fake id would make this assertion vacuous.
    const requestId = crypto.randomUUID();
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code)
      VALUES (?, '9501', '9501', ?, 'payment_verified', 'selar', 'FL-REVOK1')
    `).run(requestId, profileId);

    sentTelegramMessages.length = 0;
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        callback_query: {
          id: 'cb-approve-blocked',
          from: { id: 10001 },
          message: { chat: { id: 10001 } },
          data: `approve:${requestId}`
        }
      })
    }), env);

    const reqStatus = db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(requestId) as any;
    assert.equal(reqStatus.status, 'payment_verified', 'Request status must not change to approved');

    const customerMsg = sentTelegramMessages.find(m => m.data.chat_id === '9501');
    assert.equal(customerMsg, undefined, 'No contact details should be sent to customer when consent is revoked');
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
    await tgPost(env,adminMsg('/setcontact@KasiQueenbot anaimiya @anaimiya_real'));
    const contact=db.raw.prepare("SELECT contact_value,sharing_enabled,consent_confirmed_at FROM creator_contacts WHERE profile_id='anaimiya'").get() as any;
    assert.equal(contact.contact_value,'@anaimiya_real');
    assert.equal(contact.sharing_enabled,0,'saving a contact must not imply consent');
    await tgPost(env,callbackFrom(9999,'admin:consent'));
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action='creator_consent_confirmed'").get() && (db.raw.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action='creator_consent_confirmed'").get() as any).n,0,'non-admin cannot record consent');
  } finally { cleanup(); }
});
test('Dotted profile IDs resolve via the Telegram-safe start parameter; malformed IDs fail closed', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
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
    await tgPost(env, userMsg(5110, '/start contact_anaimiya'));
    await tgPost(env, userMsg(5110, '/start contact_rosebeck'));
    await tgPost(env, userMsg(5110, '/start contact_sweet_creator'));
    const count = db.raw.prepare("SELECT count(*) AS cnt FROM contact_requests WHERE telegram_user_id='5110' AND status IN ('awaiting_email','pending_payment')").get() as any;
    assert.equal(count.cnt, 3, 'Customer may have three unpaid contact requests');
    await tgPost(env, userMsg(5110, '/start contact_emanuela_dot_ebony'));
    const afterLimit = db.raw.prepare("SELECT count(*) AS cnt FROM contact_requests WHERE telegram_user_id='5110' AND status IN ('awaiting_email','pending_payment')").get() as any;
    assert.equal(afterLimit.cnt, 3, 'Fourth unpaid request must be blocked');
    const limitMessage = messagesTo(sentTelegramMessages, '5110').at(-1);
    assert.ok(String(limitMessage?.data.text).includes('3 contact requests'));
    const markup = limitMessage?.data.reply_markup as any;
    assert.ok(markup?.inline_keyboard?.flat().some((button: any) => String(button.text).includes('Check')));
    // The customer can still chat while all three requests are pending.
    await tgPost(env, userMsg(5110, 'Can you explain what happens next?'));
    assert.ok(messagesTo(sentTelegramMessages, '5110').some(m => String(m.data.text).includes("I'm here to help with your FansLeak requests") || String(m.data.text).includes('front-desk assistant')));
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
    // Consent is fully enabled, so any authorization bypass WOULD leak the handle.
    db.raw.prepare(`INSERT INTO creator_contacts (profile_id, contact_value, sharing_enabled, consent_confirmed_at)
      VALUES ('anaimiya', '@anaimiya_real', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run();

    const attacker = 9999;
    for (const data of [`selarverify:${reqId}`, `approve:${reqId}`, `reject:${reqId}`, `serviceverify:${svcId}`]) {
      await tgPost(env, callbackFrom(attacker, data));
    }
    for (const text of ['/enablecontact rosebeck', '/disablecontact anaimiya', '/setcontact rosebeck @evil_handle', `/deliver ${svcId} pwned`, `/verify ${reqId} FORGEDREF`, `/verifyservice ${svcId} FORGEDREF`, '/pending', '/orders']) {
      await tgPost(env, userMsg(attacker, text));
    }

    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any).status, 'pending_payment');
    assert.equal((db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(svcId) as any).status, 'pending_payment');
    assert.equal((db.raw.prepare("SELECT sharing_enabled FROM creator_contacts WHERE profile_id='anaimiya'").get() as any).sharing_enabled, 1, 'Attacker /disablecontact must not change consent');
    assert.equal(db.raw.prepare("SELECT * FROM creator_contacts WHERE profile_id='rosebeck'").get(), undefined, 'Attacker /setcontact must not store a contact');
    for (const chat of ['5120', '5121']) {
      assert.equal(messagesTo(sentTelegramMessages, chat).filter(m => String(m.data.text).includes('@anaimiya_real') || String(m.data.text).includes('pwned')).length, 0);
    }
    assert.equal(messagesTo(sentTelegramMessages, '9999').filter(m => String(m.data.text).includes(reqId) || String(m.data.text).includes('@anaimiya_real')).length, 0, 'Admin listings must not leak to non-admins');
  } finally {
    cleanup();
  }
});

test('Selar webhook negative cases never mutate payment state', async () => {
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
    assert.deepEqual(await noCode.json(), { ok: true, matched: false, reason: 'no_unique_code_or_full_name_match' });

    const codeMatchNameMismatch = await selarPost(env, { ...validSale, reference: 'ref-neg-5', customer_full_name: 'Other Person FL-NEG001' });
    const codeMatchJson = await codeMatchNameMismatch.json() as any;
    assert.equal(codeMatchJson.matched, true, 'a unique code is sufficient even when the full name differs');
    assert.equal(codeMatchJson.reconciled_by, 'unique_code');
    assert.equal(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).filter(m => String(m.data.text).includes('Selar sale received')).length, 1, 'a unique code match must notify admin');

    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-6', status: 'failed' })).status, 422, 'explicitly non-paid events are rejected');
    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-7', padding: 'A'.repeat(70000) })).status, 413, 'oversized payload');

    const order = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.payment_reference, 'ref-neg-5', 'the unique-code sale is attached for manual review only');
    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get() as any).cnt, 1, 'only the valid unique-code sale is consumed');
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

test('Contact fallback email and checkout-name confirmation never verify payment', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(5150, '/start contact_anaimiya'));
    let order = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='5150'").get() as any;

    await tgPost(env, userMsg(5150, 'buyer5150@example.com'));
    order = db.raw.prepare('SELECT * FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.equal(order.buyer_email, 'buyer5150@example.com');
    assert.equal(order.status, 'pending_payment', 'Saving an email clue must not verify payment');
    assert.ok(messagesTo(sentTelegramMessages, '5150').some(m => String(m.data.text).includes('does not verify payment')));
    assert.ok(messagesTo(sentTelegramMessages, env.ADMIN_TELEGRAM_ID).some(m => String(m.data.text).includes('reconciliation clue for contact request')));

    await tgPost(env, callbackFrom(5150, `pay_selar:${order.id}`));
    await tgPost(env, callbackFrom(5150, `done:${order.id}`));
    await tgPost(env, userMsg(5150, `Buyer Name ${order.checkout_code}`));
    order = db.raw.prepare('SELECT * FROM contact_requests WHERE id=?').get(order.id) as any;
    assert.equal(order.checkout_name, 'Buyer Name');
    assert.equal(order.status, 'pending_payment', 'Checkout completion taps must not verify payment');
    assert.equal(order.payment_reference, null);

    // An email sent while the name prompt is open is still saved as a clue.
    await tgPost(env, userMsg(5151, '/start contact_rosebeck'));
    const second = db.raw.prepare("SELECT * FROM contact_requests WHERE telegram_user_id='5151'").get() as any;
    await tgPost(env, callbackFrom(5151, `done:${second.id}`));
    await tgPost(env, userMsg(5151, 'buyer5151@example.com'));
    assert.equal((db.raw.prepare('SELECT buyer_email FROM contact_requests WHERE id=?').get(second.id) as any).buyer_email, 'buyer5151@example.com');
  } finally {
    cleanup();
  }
});

test('Approval fails closed for unverified payment, another creator consent, and consent lookup failure', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, adminMsg('/setcontact anaimiya @anaimiya_real'));
    await tgPost(env, adminMsg('/enablecontact anaimiya'));

    const unverifiedId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5160', '5160', 'anaimiya', 'pending_payment', 'selar', 'ref-unverified', 'FL-UNV001')`).run(unverifiedId);
    await tgPost(env, callbackFrom(10001, `approve:${unverifiedId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(unverifiedId) as any).status, 'pending_payment');
    assert.equal(messagesTo(sentTelegramMessages, '5160').length, 0, 'Unverified requests must receive nothing');

    const wrongCreatorId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5161', '5161', 'rosebeck', 'payment_verified', 'selar', 'ref-wrong-creator', 'FL-WRG001')`).run(wrongCreatorId);
    await tgPost(env, callbackFrom(10001, `approve:${wrongCreatorId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(wrongCreatorId) as any).status, 'payment_verified', 'Consent for a different creator must not authorize delivery');
    assert.equal(messagesTo(sentTelegramMessages, '5161').length, 0);

    const okId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, payment_reference, checkout_code)
      VALUES (?, '5162', '5162', 'anaimiya', 'pending_payment', 'selar', 'ref-ok-1', 'FL-OK0001')`).run(okId);
    await tgPost(env, callbackFrom(10001, `selarverify:${okId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'payment_verified');
    assert.equal(messagesTo(sentTelegramMessages, '5162').filter(m => String(m.data.text).includes('@anaimiya_real')).length, 0, 'No pre-approval customer message may contain the creator handle');

    const failingDb = {
      prepare(query: string) {
        if (query.includes('creator_contacts')) throw new Error('simulated D1 failure');
        return db.prepare(query);
      }
    };
    await tgPost({ ...env, DB: failingDb }, callbackFrom(10001, `approve:${okId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'payment_verified', 'A failed consent query must not approve or disclose');
    assert.equal(messagesTo(sentTelegramMessages, '5162').filter(m => String(m.data.text).includes('@anaimiya_real')).length, 0);

    await tgPost(env, callbackFrom(10001, `approve:${okId}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'payment_verified', 'Preparing a draft does not approve the request');
    assert.equal(messagesTo(sentTelegramMessages, '5162').filter(m => String(m.data.text).includes('@anaimiya_real')).length, 0, 'No contact is disclosed before send confirmation');
    const draft = db.raw.prepare('SELECT id FROM delivery_drafts WHERE request_id=?').get(okId) as any;
    assert.ok(draft);
    await tgPost(env, adminMsg('Here is your authorized creator contact.'));
    await tgPost(env, callbackFrom(10001, `draft:send:${draft.id}`));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'approved');
    assert.equal(messagesTo(sentTelegramMessages, '5162').filter(m => String(m.data.text).includes('@anaimiya_real')).length, 1, 'Handle is sent exactly once after explicit confirmation');
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
    assert.ok(customerMessages.some(m => String(m.data.text).includes('found a Selar sale record already attached')));
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
    assert.ok(messagesTo(sentTelegramMessages, '5211').some(m => String(m.data.text).includes('forward your <b>Selar receipt</b>')));

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
    assert.ok(caption.includes(`/verify ${order.id} EXACT_SELAR_REFERENCE`));
    assert.ok(caption.includes('has NOT changed the order status'));
    assert.ok(!caption.includes('private caption must not be copied'), 'Customer captions must not be copied into the admin receipt context');

    const submission = db.raw.prepare('SELECT * FROM payment_receipt_submissions WHERE order_id=?').get(order.id) as any;
    assert.equal(submission.status, 'forwarded');
    assert.equal(submission.telegram_file_unique_id, 'photo-unique-1');
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
    assert.ok(String(forwards[0].data.caption || '').includes(`/verifyservice ${orderId} EXACT_SELAR_REFERENCE`));

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

function customerTelegramCalls(sent: any[], chatId: string) {
  return sent.filter(m => ['sendMessage', 'sendPhoto', 'sendDocument'].includes(m.method) && String(m.data.chat_id) === chatId);
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

    await tgPost(env, adminMsg('/message fl-supp01 Hello, I am checking your request and will update you here.'));
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
    assert.ok(adminTexts.some(text => text.includes('No contact request or service order matched')));
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

test('General support drafts and protected contact-delivery drafts cannot overlap', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const orderId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests
      (id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code)
      VALUES (?, '8909', '8909', 'anaimiya', 'payment_verified', 'FL-ISO001')`).run(orderId);
    db.raw.prepare(`INSERT INTO creator_contacts
      (profile_id,contact_value,sharing_enabled,consent_confirmed_at)
      VALUES ('anaimiya', '@synthetic_contact', 1, '2026-01-01T00:00:00.000Z')`).run();

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
    assert.ok(messagesTo(sentTelegramMessages, '5214').some(m => String(m.data.text).includes('found a Selar sale record already attached')));
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(orderId) as any).status, 'pending_payment');
  } finally {
    cleanup();
  }
});




test('Admin natural-language profile deletion waits for YES, then hides profile persistently', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, adminMsg('delete profile Anaimiya'));
    const pending = db.raw.prepare("SELECT id,action,payload,status FROM admin_pending_actions WHERE admin_telegram_id='10001'").get() as any;
    assert.ok(pending);
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

test('Admin broadcast requires explicit confirmation and sends to recent-order customers once', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const id = crypto.randomUUID();
    db.raw.prepare("INSERT INTO contact_requests(id,telegram_user_id,telegram_chat_id,profile_id,status,checkout_code) VALUES(?,'8102','8102','anaimiya','pending_payment','FL-BCAST1')").run(id);
    await tgPost(env, adminMsg('/broadcast Service update: your order status is available.'));
    const draft = db.raw.prepare("SELECT id,status FROM admin_broadcast_drafts WHERE admin_telegram_id='10001'").get() as any;
    assert.ok(draft);
    assert.equal(draft.status, 'draft');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8102').length, 0);
    await tgPost(env, adminMsg('yes'));
    assert.equal(db.raw.prepare("SELECT status FROM admin_broadcast_drafts WHERE id=?").get(draft.id).status, 'sent');
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8102').length, 1);
    await tgPost(env, adminMsg('yes'));
    assert.equal(customerTelegramCalls(sentTelegramMessages, '8102').length, 1, 'A completed broadcast cannot be resent by a second yes');
  } finally {
    cleanup();
  }
});
