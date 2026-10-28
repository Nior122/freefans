import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAllMigrations,
  verifySchema,
  getAppliedMigrations,
  getTableColumns,
  getTableNames,
  EXPECTED_SCHEMA,
  EXPECTED_UNIQUE_INDEXES
} from '../scripts/lib/db-migrations.mjs';
import { parseWranglerJsonOutput, verifyRemoteSchema } from '../scripts/migrate-d1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('Migration: fresh database migrates to fully verified schema', () => {
  const db = new DatabaseSync(':memory:');
  const result = applyAllMigrations(db);

  assert.equal(result.ok, true);
  assert.equal(result.verifiedTables.length, 15);

  const applied = getAppliedMigrations(db);
  assert.deepEqual(applied, [
    '0001_baseline',
    '0002_service_orders',
    '0003_abandoned_carts',
    '0004_checkout_codes',
    '0005_one_active_request_per_user',
    '0006_receipt_review',
    '0007_front_desk_multi_requests',
    '0008_delivery_drafts',
    '0009_service_delivery_drafts',
    '0010_admin_message_drafts',
    '0011_admin_broadcast_drafts',
    '0012_hidden_profiles',
    '0013_admin_pending_actions',
    '0014_remove_creator_sharing_permissions',
    '0015_service_delivery_draft_media',
    '0016_admin_draft_recovery_actions',
    '0017_limit_unverified_service_orders'
  ]);

  const verified = verifySchema(db);
  assert.equal(verified.ok, true);
});

test('Migration: fully migrated database is completely idempotent when re-migrated', () => {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);

  // Run migration again on already fully migrated database
  const secondResult = applyAllMigrations(db);
  assert.equal(secondResult.ok, true);

  const verified = verifySchema(db);
  assert.equal(verified.ok, true);
});

test('Migration: partially migrated database (baseline only) migrates safely', () => {
  const db = new DatabaseSync(':memory:');
  // Apply only baseline schema manually
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'schema.sql'), 'utf8'));

  const tablesBefore = getTableNames(db);
  assert.ok(tablesBefore.includes('contact_requests'));
  assert.ok(!tablesBefore.includes('service_orders'));

  // Now apply remaining migrations
  const result = applyAllMigrations(db);
  assert.equal(result.ok, true);

  const verified = verifySchema(db);
  assert.equal(verified.ok, true);
  const tablesAfter = getTableNames(db);
  assert.ok(tablesAfter.includes('service_orders'));
  assert.ok(tablesAfter.includes('checkout_name_prompts'));
});

test('Migration: partially migrated database with existing prompts table but missing columns adds columns safely', () => {
  const db = new DatabaseSync(':memory:');
  // Apply baseline, service orders, and abandoned carts
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0002_service_orders.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0003_abandoned_carts.sql'), 'utf8'));

  // Pre-create checkout_name_prompts table ONLY (columns not yet on contact_requests/service_orders)
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkout_name_prompts (
      telegram_user_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      order_kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const contactColsBefore = getTableColumns(db, 'contact_requests');
  assert.ok(!contactColsBefore.includes('checkout_code'));

  // Run safe migration
  const result = applyAllMigrations(db);
  assert.equal(result.ok, true);

  const contactColsAfter = getTableColumns(db, 'contact_requests');
  assert.ok(contactColsAfter.includes('checkout_code'));
  assert.ok(contactColsAfter.includes('checkout_name'));

  const verified = verifySchema(db);
  assert.equal(verified.ok, true);
});

test('Migration 0017: service customers can have up to three unverified orders, never four', () => {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);

  const insertContact = (id, user, status) => db.prepare(
    'INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status) VALUES (?,?,?,?,?)'
  ).run(id, user, user, 'anaimiya', status);

  insertContact('req-active-1', '7001', 'pending_payment');
  insertContact('req-active-2', '7001', 'pending_payment');
  insertContact('req-active-3', '7001', 'pending_payment');
  const count = db.prepare("SELECT COUNT(*) AS count FROM contact_requests WHERE telegram_user_id='7001' AND status='pending_payment'").get();
  assert.equal(count.count, 3, 'Multiple pending contact requests remain allowed');
  insertContact('req-done-1', '7001', 'approved');
  insertContact('req-active-4', '7002', 'pending_payment');

  for (let i = 1; i <= 3; i++) {
    db.prepare("INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status) VALUES (?,?,?,?,'pending_payment')")
      .run('svc-' + i, 'telegram_channel', '7003', '7003');
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM service_orders WHERE telegram_user_id='7003' AND status='pending_payment'").get().count, 3);
  assert.throws(
    () => db.prepare("INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status) VALUES ('svc-4','telegram_channel','7003','7003','pending_payment')").run(),
    /max_three_unverified_service_orders/i
  );
});

test('Migration 0010: only one editable general support draft is allowed per admin', () => {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);

  const insertDraft = (id, adminId, status) => db.prepare(`
    INSERT INTO admin_message_drafts
      (id,order_id,order_kind,admin_telegram_id,telegram_user_id,telegram_chat_id,checkout_code,status,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, `order-${id}`, 'contact', adminId, '7201', '7201', 'FL-DRAFT1', status, '2999-01-01 00:00:00');

  insertDraft('support-draft-1', '10001', 'draft');
  assert.throws(
    () => insertDraft('support-draft-2', '10001', 'draft'),
    /UNIQUE constraint failed/i,
    'A second editable support draft for the same admin must be rejected'
  );

  insertDraft('support-draft-other-admin', '10002', 'draft');
  db.prepare("UPDATE admin_message_drafts SET status='cancelled' WHERE id='support-draft-1'").run();
  insertDraft('support-draft-3', '10001', 'draft');
});

test('Migrations 0015-0016: service media columns and draft-recovery confirmations preserve existing rows', () => {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);

  db.prepare(`
    INSERT INTO service_delivery_drafts
      (id,service_order_id,admin_telegram_id,message_text,media_kind,media_file_id,media_mime_type,status,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run('service-draft-media', 'service-order-media', '10001', 'Ready', 'photo', 'synthetic-file-id', 'image/jpeg', 'draft', '2999-01-01 00:00:00');

  db.prepare(`
    INSERT INTO admin_pending_actions
      (id,admin_telegram_id,action,payload,status,expires_at)
    VALUES (?,?,?,?,?,?)
  `).run('recovery-action-1', '10001', 'recover_draft', '{"kind":"service","draftId":"service-draft-media","updatedAt":"2026-01-01T00:00:00.000Z"}', 'pending', '2999-01-01 00:00:00');

  const draft = db.prepare("SELECT media_kind,media_file_id,media_mime_type FROM service_delivery_drafts WHERE id='service-draft-media'").get();
  assert.equal(draft.media_kind, 'photo');
  assert.equal(draft.media_file_id, 'synthetic-file-id');
  assert.equal(draft.media_mime_type, 'image/jpeg');

  assert.throws(
    () => db.prepare(`
      INSERT INTO admin_pending_actions
        (id,admin_telegram_id,action,payload,status,expires_at)
      VALUES (?,?,?,?,?,?)
    `).run('recovery-action-2', '10001', 'hide_profile', 'anaimiya', 'pending', '2999-01-01 00:00:00'),
    /UNIQUE constraint failed/i,
    'Rebuilding pending actions must preserve the one-pending-confirmation guard'
  );
});

test('Migration 0005: pre-existing duplicate active rows block migration without data changes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0002_service_orders.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0003_abandoned_carts.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0004_checkout_codes.sql'), 'utf8'));
  db.exec(`
    INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status) VALUES
      ('dup-1', '7101', '7101', 'anaimiya', 'pending_payment'),
      ('dup-2', '7101', '7101', 'rosebeck', 'pending_payment');
  `);

  assert.throws(() => applyAllMigrations(db), /Migration 0005/);
  const rows = db.prepare("SELECT id FROM contact_requests WHERE telegram_user_id='7101' ORDER BY id").all();
  assert.deepEqual(rows.map(r => r.id), ['dup-1', 'dup-2'], 'Blocked migration must not alter existing rows');

  // After manual reconciliation, migration completes.
  db.exec("UPDATE contact_requests SET status='rejected' WHERE id='dup-2'");
  const result = applyAllMigrations(db);
  assert.equal(result.ok, true);
});

test('Migration 0006: receipt submission indexes reject duplicate Telegram updates and duplicate files', () => {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);

  const insertSubmission = (id, orderId, userId, messageId, fileUniqueId) => db.prepare(`
    INSERT INTO payment_receipt_submissions
      (id,order_id,order_kind,telegram_user_id,telegram_chat_id,telegram_message_id,media_kind,telegram_file_id,telegram_file_unique_id,status)
    VALUES (?,?,?,?,?,?,?,?,?,'forwarding')
  `).run(id, orderId, 'contact', userId, userId, messageId, 'photo', `file-${id}`, fileUniqueId);

  insertSubmission('receipt-1', 'order-1', '7201', 9001, 'unique-file-1');

  assert.throws(
    () => insertSubmission('receipt-duplicate-update', 'order-2', '7201', 9001, 'different-file'),
    /UNIQUE constraint failed/i,
    'A redelivered Telegram message must not create a second receipt submission'
  );
  assert.throws(
    () => insertSubmission('receipt-duplicate-file', 'order-1', '7202', 9002, 'unique-file-1'),
    /UNIQUE constraint failed/i,
    'The same Telegram file must not be recorded twice for one order'
  );

  // Different customers, messages, orders, and files remain valid.
  insertSubmission('receipt-2', 'order-2', '7202', 9003, 'unique-file-2');
});

test('Migration: partially migrated database with pre-existing columns does not fail on ALTER TABLE', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'schema.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0002_service_orders.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0003_abandoned_carts.sql'), 'utf8'));

  // Manually add checkout_code beforehand (simulating partial run or manual fix)
  db.exec("ALTER TABLE contact_requests ADD COLUMN checkout_code TEXT;");

  // Running applyAllMigrations must NOT throw "duplicate column name: checkout_code"
  assert.doesNotThrow(() => {
    applyAllMigrations(db);
  });

  const verified = verifySchema(db);
  assert.equal(verified.ok, true);
});

test('Remote migration runner: parses wrangler JSON output and surfaces D1 failures', () => {
  assert.deepEqual(
    parseWranglerJsonOutput(JSON.stringify([{ results: [{ version: '0001_baseline' }], success: true, meta: {} }])),
    [{ version: '0001_baseline' }]
  );
  assert.deepEqual(parseWranglerJsonOutput(JSON.stringify([{ results: [], success: true, meta: {} }])), []);
  assert.throws(
    () => parseWranglerJsonOutput(JSON.stringify([{ results: [], success: false, error: { text: 'near "x": syntax error' } }])),
    /D1 query failed/
  );
  assert.throws(() => parseWranglerJsonOutput('not json at all'), /did not return JSON/);
});

test('Remote migration runner: never builds shell strings from SQL (production regression, run 40278428624)', () => {
  // The 2026-10-26 production deploy failed because SQL was interpolated into a
  // shell command via JSON.stringify(), which delivered literal "\n" escapes to
  // D1 instead of newlines. Pin the argv-array implementation against regression.
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'migrate-d1.mjs'), 'utf8');
  assert.ok(source.includes('execFileSync('), 'migrate-d1 must execute wrangler via an argument array');
  assert.ok(!source.includes('execSync(cmd'), 'migrate-d1 must not execute a constructed shell string');
  assert.ok(!source.includes('--command=${JSON.stringify'), 'SQL must never be JSON-stringified into a shell command');
});

function completeRemoteSchemaSnapshot() {
  return {
    tables: Object.keys(EXPECTED_SCHEMA),
    columnsByTable: Object.fromEntries(
      Object.entries(EXPECTED_SCHEMA).map(([table, columns]) => [table, [...columns]])
    ),
    uniqueIndexes: EXPECTED_UNIQUE_INDEXES.map(index => ({ ...index, unique: 1 }))
  };
}

test('Remote migration verifier: accepts all required tables, columns, and unique indexes', () => {
  const result = verifyRemoteSchema(completeRemoteSchemaSnapshot());
  assert.equal(result.ok, true);
  assert.equal(result.verifiedTables.length, 15);
});

test('Remote migration verifier: fails when a required column is missing', () => {
  const snapshot = completeRemoteSchemaSnapshot();
  snapshot.columnsByTable.contact_requests = snapshot.columnsByTable.contact_requests.filter(column => column !== 'checkout_name');

  assert.throws(
    () => verifyRemoteSchema(snapshot),
    /missing column\(s\): contact_requests: \[checkout_name\]/
  );
});

test('Remote migration verifier: fails when a required unique index is missing', () => {
  const snapshot = completeRemoteSchemaSnapshot();
  snapshot.uniqueIndexes = snapshot.uniqueIndexes.filter(index => index.name !== 'idx_service_orders_checkout_code');

  assert.throws(
    () => verifyRemoteSchema(snapshot),
    /missing unique index\(es\): idx_service_orders_checkout_code/
  );
});

test('Remote migration verifier: fails if a required index exists but is not unique', () => {
  const snapshot = completeRemoteSchemaSnapshot();
  snapshot.uniqueIndexes = snapshot.uniqueIndexes.map(index =>
    index.name === 'idx_contact_requests_checkout_code' ? { ...index, unique: 0 } : index
  );

  assert.throws(
    () => verifyRemoteSchema(snapshot),
    /missing unique index\(es\): idx_contact_requests_checkout_code/
  );
});
