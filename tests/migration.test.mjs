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
  getTableNames
} from '../scripts/lib/db-migrations.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('Migration: fresh database migrates to fully verified schema', () => {
  const db = new DatabaseSync(':memory:');
  const result = applyAllMigrations(db);

  assert.equal(result.ok, true);
  assert.equal(result.verifiedTables.length, 7);

  const applied = getAppliedMigrations(db);
  assert.deepEqual(applied, [
    '0001_baseline',
    '0002_service_orders',
    '0003_abandoned_carts',
    '0004_checkout_codes',
    '0005_one_active_request_per_user'
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

test('Migration 0005: database rejects a second active request for the same user', () => {
  const db = new DatabaseSync(':memory:');
  applyAllMigrations(db);

  const insertContact = (id, user, status) => db.prepare(
    'INSERT INTO contact_requests (id, telegram_user_id, telegram_chat_id, profile_id, status) VALUES (?,?,?,?,?)'
  ).run(id, user, user, 'anaimiya', status);

  insertContact('req-active-1', '7001', 'pending_payment');
  assert.throws(
    () => insertContact('req-active-2', '7001', 'payment_verified'),
    /UNIQUE constraint failed/i,
    'Second active contact request for one user must be rejected by the database'
  );
  // Non-active rows and other users are unaffected.
  insertContact('req-done-1', '7001', 'approved');
  insertContact('req-active-3', '7002', 'pending_payment');

  db.prepare("INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status) VALUES ('svc-1','svc','7003','7003','pending_payment')").run();
  assert.throws(
    () => db.prepare("INSERT INTO service_orders (id, service_id, telegram_user_id, telegram_chat_id, status) VALUES ('svc-2','svc','7003','7003','awaiting_request')").run(),
    /UNIQUE constraint failed/i
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
