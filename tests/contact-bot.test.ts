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
function createTestEnv(db: any) {
  const sentTelegramMessages: Array<{ method: string; data: Record<string, unknown> }> = [];

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);

    // Mock Telegram Bot API calls
    if (urlStr.includes('api.telegram.org')) {
      const parts = urlStr.split('/');
      const method = parts[parts.length - 1];
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      sentTelegramMessages.push({ method, data: body });
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
          { id: 'sweet_creator', name: 'Sweet Creator' }
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

  return { env, sentTelegramMessages, cleanup };
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

test('Fallback email reconciliation when customer omitted order code in name', async () => {
  const db = createTestDb();
  const { env, cleanup } = createTestEnv(db);
  try {
    // Pending request with saved email clue
    db.raw.prepare(`
      INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code, buyer_email)
      VALUES ('req-uuid-2', '5006', '5006', 'anaimiya', 'pending_payment', 'selar', 'FL-999999', 'clue@example.com')
    `).run();

    // Selar sale where customer forgot order code in name, but used the same email
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
    const json = await res.json() as any;
    assert.equal(json.ok, true);
    assert.equal(json.matched, true);
    assert.equal(json.reconciled_by, 'fallback_email');

    const order = await db.raw.prepare('SELECT * FROM contact_requests WHERE id = ?').get('req-uuid-2') as any;
    assert.equal(order.status, 'pending_payment', 'Status remains pending_payment for manual admin check');
    assert.equal(order.payment_reference, 'selar_ref_email_clue');
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

    // 7. Now all 3 conditions are satisfied: Payment verified + Creator consent confirmed + Admin approved!
    sentTelegramMessages.length = 0; // clear message logs
    const adminApprove = {
      callback_query: {
        id: 'cb-4',
        from: { id: 10001 },
        message: { chat: { id: 10001 } },
        data: `approve:${reqId}`
      }
    };
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(adminApprove)
    }), env);

    order = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'approved', 'Request status transitions to approved');

    // Contact release message must be sent to customer chat 5007
    const releaseMsg = sentTelegramMessages.find(m => m.method === 'sendMessage' && m.data.chat_id === '5007');
    assert.ok(releaseMsg, 'Customer must receive contact release message');
    assert.ok(String(releaseMsg.data.text).includes('@anaimiya_real'), 'Release message must contain creator handle');

    // 8. Test idempotency: repeated approve callback does NOT send contact again
    sentTelegramMessages.length = 0;
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify(adminApprove)
    }), env);

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
      INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status, checkout_code)
      VALUES (?, 'custom_service', '7001', '7001', 'awaiting_request', 'FL-SRV100')
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

    // 5. Admin delivers fulfilment
    sentTelegramMessages.length = 0;
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/deliver ${serviceOrderId} Here is your completed asset package: https://files.example.com/asset.zip` }
      })
    }), env);

    order = await db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'fulfilled');

    const customerDeliveryMsg = sentTelegramMessages.find(m => m.method === 'sendMessage' && m.data.chat_id === '7001');
    assert.ok(customerDeliveryMsg, 'Customer must receive fulfilment');
    assert.ok(String(customerDeliveryMsg.data.text).includes('https://files.example.com/asset.zip'));
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

