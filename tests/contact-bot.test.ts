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
    const repeatOrder = await db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(repeatOrder.status, 'approved', 'Repeated approve must not change the final status');
    const repeatRelease = sentTelegramMessages.find(m => m.method === 'sendMessage' && m.data.chat_id === '5007' && String(m.data.text).includes('@anaimiya_real'));
    assert.equal(repeatRelease, undefined, 'Repeated approve must not re-send creator contact details');

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

test('Service order email fallback collection and reconciliation', async () => {
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

    // 1. Customer sends fallback email
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 9100 }, from: { id: 9100 }, text: 'client@example.com' }
      })
    }), env);

    const savedOrder = db.raw.prepare('SELECT buyer_email FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(savedOrder.buyer_email, 'client@example.com');

    const customerAck = sentTelegramMessages.find(m => m.data.chat_id === '9100' && String(m.data.text).includes('saved as a fallback reconciliation clue'));
    assert.ok(customerAck, 'Customer should receive fallback clue confirmation');

    const adminAlert = sentTelegramMessages.find(m => m.data.chat_id === env.ADMIN_TELEGRAM_ID && String(m.data.text).includes('reconciliation clue for service order'));
    assert.ok(adminAlert, 'Admin should be alerted about customer-provided clue');

    // 2. Selar webhook arrives without code in name, matches by saved email
    const saleRes = await worker.fetch(new Request('https://worker.local/webhooks/selar', {
      method: 'POST',
      headers: { 'x-selar-webhook-secret': 'selar-secret-123' },
      body: JSON.stringify({
        reference: 'selar-srv-email-ref-1',
        buyer_email: 'client@example.com',
        customer_full_name: 'Client Without Code',
        product_code: env.SERVICE_PRODUCT_ID
      })
    }), { ...env, SELAR_WEBHOOK_SECRET: 'selar-secret-123' });

    assert.equal(saleRes.status, 200);
    const saleJson = await saleRes.json() as any;
    assert.equal(saleJson.ok, true);
    assert.equal(saleJson.matched, true);
    assert.equal(saleJson.reconciled_by, 'fallback_email');

    const updatedOrder = db.raw.prepare('SELECT status, payment_method, payment_reference FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(updatedOrder.status, 'pending_payment', 'Payment must still require admin manual verification');
    assert.equal(updatedOrder.payment_method, 'selar');
    assert.equal(updatedOrder.payment_reference, 'selar-srv-email-ref-1');
  } finally {
    cleanup();
  }
});

test('Ambiguous fallback email matching rejects candidate matches and alerts admin', async () => {
  const db = createTestDb();
  const { env, cleanup, sentTelegramMessages } = createTestEnv(db);
  try {
    // Two service orders with the same email in pending_payment
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
    const saleJson = await saleRes.json() as any;
    assert.equal(saleJson.matched, false);
    assert.equal(saleJson.reason, 'ambiguous_email_match');

    const adminMsg = sentTelegramMessages.find(m => m.data.chat_id === env.ADMIN_TELEGRAM_ID && String(m.data.text).includes('ambiguous email match'));
    assert.ok(adminMsg, 'Admin must be notified of ambiguous email match');
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

test('Telegram delivery failure reverts status allowing administrative retry', async () => {
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

    // 1. Deliver with failed Telegram send
    failNextTgSend = true;
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/deliver ${serviceOrderId} Fulfilment package contents` }
      })
    }), env);

    // Order status should be reverted back to payment_verified so admin can retry
    let order = db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'payment_verified');

    // 2. Retry delivery (succeeds)
    await worker.fetch(new Request('https://worker.local/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({
        message: { chat: { id: 10001 }, from: { id: 10001 }, text: `/deliver ${serviceOrderId} Fulfilment package contents` }
      })
    }), env);

    order = db.raw.prepare('SELECT status FROM service_orders WHERE id=?').get(serviceOrderId) as any;
    assert.equal(order.status, 'fulfilled');
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

test('Repeated /start commands do not create duplicate active requests', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    await tgPost(env, userMsg(5110, '/start contact_anaimiya'));
    await tgPost(env, userMsg(5110, '/start contact_rosebeck'));
    const count = db.raw.prepare("SELECT count(*) AS cnt FROM contact_requests WHERE telegram_user_id='5110'").get() as any;
    assert.equal(count.cnt, 1, 'Second /start must not create another active request');
    const row = db.raw.prepare("SELECT profile_id FROM contact_requests WHERE telegram_user_id='5110'").get() as any;
    assert.equal(row.profile_id, 'anaimiya', 'Active request must stay bound to the original creator');
    assert.ok(messagesTo(sentTelegramMessages, '5110').some(m => String(m.data.text).includes('already have a request in progress')));
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
  const { env, cleanup } = createTestEnv(db);
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
    assert.deepEqual(await noCode.json(), { ok: true, matched: false, reason: 'missing_order_code' });

    const nameMismatch = await selarPost(env, { ...validSale, reference: 'ref-neg-5', customer_full_name: 'Other Person FL-NEG001' });
    assert.equal((await nameMismatch.json()).reason, 'name_mismatch');

    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-6', status: 'failed' })).status, 422, 'explicitly non-paid events are rejected');
    assert.equal((await selarPost(env, { ...validSale, reference: 'ref-neg-7', padding: 'A'.repeat(70000) })).status, 413, 'oversized payload');

    const order = db.raw.prepare('SELECT status, payment_reference FROM contact_requests WHERE id=?').get(reqId) as any;
    assert.equal(order.status, 'pending_payment');
    assert.equal(order.payment_reference, null);
    assert.equal((db.raw.prepare('SELECT count(*) AS cnt FROM processed_sales').get() as any).cnt, 0, 'Rejected events must not be consumed');
  } finally {
    cleanup();
  }
});

test('Duplicate Selar webhook delivery records one sale and one admin notification', async () => {
  const db = createTestDb();
  const { env, sentTelegramMessages, cleanup } = createTestEnv(db);
  try {
    const reqId = crypto.randomUUID();
    db.raw.prepare(`INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status, payment_method, checkout_code)
      VALUES (?, '5140', '5140', 'anaimiya', 'pending_payment', 'selar', 'FL-DUP001')`).run(reqId);
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
    assert.equal((db.raw.prepare('SELECT status FROM contact_requests WHERE id=?').get(okId) as any).status, 'approved');
    assert.equal(messagesTo(sentTelegramMessages, '5162').filter(m => String(m.data.text).includes('@anaimiya_real')).length, 1, 'Handle is sent exactly once, after all gates pass');
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


