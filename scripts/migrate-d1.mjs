#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WRANGLER_CONFIG = path.join(ROOT, 'contact-bot', 'wrangler.toml');
const DB_NAME = 'fansleak-contact-requests';

function runWranglerCommand(command) {
  const cmd = `npx --yes wrangler@4 d1 execute ${DB_NAME} --remote --json --command=${JSON.stringify(command)} --config=${JSON.stringify(WRANGLER_CONFIG)}`;
  const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(output);
  if (Array.isArray(parsed) && parsed[0]?.results) {
    return parsed[0].results;
  }
  return [];
}

function runWranglerFile(filePath) {
  const cmd = `npx --yes wrangler@4 d1 execute ${DB_NAME} --remote --file=${JSON.stringify(filePath)} --config=${JSON.stringify(WRANGLER_CONFIG)}`;
  execSync(cmd, { encoding: 'utf8', stdio: 'inherit' });
}

export function migrateRemote() {
  console.log(`[migrate-d1] Ensuring migration tracking table exists on ${DB_NAME}...`);
  runWranglerCommand(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const appliedRows = runWranglerCommand("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.map(r => r.version));
  console.log(`[migrate-d1] Applied migrations so far: ${Array.from(applied).join(', ') || 'none'}`);

  // Migration 1: baseline schema
  if (!applied.has('0001_baseline')) {
    console.log('[migrate-d1] Applying baseline schema...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'schema.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0001_baseline')");
  }

  // Migration 2: service orders
  if (!applied.has('0002_service_orders')) {
    console.log('[migrate-d1] Applying 0002_service_orders migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0002_service_orders.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0002_service_orders')");
  }

  // Migration 3: abandoned carts
  if (!applied.has('0003_abandoned_carts')) {
    console.log('[migrate-d1] Applying 0003_abandoned_carts migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0003_abandoned_carts.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0003_abandoned_carts')");
  }

  // Migration 4: checkout codes (handled safely and idempotently)
  if (!applied.has('0004_checkout_codes')) {
    console.log('[migrate-d1] Checking columns for 0004_checkout_codes migration...');
    const contactCols = runWranglerCommand("PRAGMA table_info(contact_requests)").map(r => r.name);
    if (!contactCols.includes('checkout_code')) {
      console.log('[migrate-d1] Adding column checkout_code to contact_requests...');
      runWranglerCommand("ALTER TABLE contact_requests ADD COLUMN checkout_code TEXT;");
    }
    if (!contactCols.includes('checkout_name')) {
      console.log('[migrate-d1] Adding column checkout_name to contact_requests...');
      runWranglerCommand("ALTER TABLE contact_requests ADD COLUMN checkout_name TEXT;");
    }

    const serviceCols = runWranglerCommand("PRAGMA table_info(service_orders)").map(r => r.name);
    if (!serviceCols.includes('checkout_code')) {
      console.log('[migrate-d1] Adding column checkout_code to service_orders...');
      runWranglerCommand("ALTER TABLE service_orders ADD COLUMN checkout_code TEXT;");
    }
    if (!serviceCols.includes('checkout_name')) {
      console.log('[migrate-d1] Adding column checkout_name to service_orders...');
      runWranglerCommand("ALTER TABLE service_orders ADD COLUMN checkout_name TEXT;");
    }

    runWranglerCommand(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_checkout_code ON contact_requests(checkout_code) WHERE checkout_code IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_checkout_code ON service_orders(checkout_code) WHERE checkout_code IS NOT NULL;
      CREATE TABLE IF NOT EXISTS checkout_name_prompts (
        telegram_user_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')),
        created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);

    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0004_checkout_codes')");
    console.log('[migrate-d1] 0004_checkout_codes migration complete.');
  }

  // Final complete schema verification
  console.log('[migrate-d1] Verifying complete schema...');
  const tables = runWranglerCommand("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  const requiredTables = [
    'contact_requests', 'creator_contacts', 'processed_sales', 'admin_audit',
    'service_orders', 'processed_abandoned_carts', 'checkout_name_prompts'
  ];
  const missingTables = requiredTables.filter(t => !tables.includes(t));
  if (missingTables.length > 0) {
    throw new Error(`[migrate-d1] Verification failed: missing table(s): ${missingTables.join(', ')}`);
  }

  console.log('[migrate-d1] All migrations safely applied and verified successfully.');
}

if (process.argv.includes('--remote')) {
  try {
    migrateRemote();
  } catch (err) {
    console.error('[migrate-d1] Remote migration error:', err);
    process.exit(1);
  }
}
