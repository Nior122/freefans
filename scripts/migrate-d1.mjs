#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { EXPECTED_SCHEMA, EXPECTED_UNIQUE_INDEXES, verifySchemaShape } from './lib/db-migrations.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WRANGLER_CONFIG = path.join(ROOT, 'contact-bot', 'wrangler.toml');
const DB_NAME = 'fansleak-contact-requests';

/** Validate a remote schema snapshot using the same expectations as local migrations. */
export function verifyRemoteSchema(snapshot) {
  return verifySchemaShape(snapshot);
}

// Wrangler is invoked with an argument array, never a shell string. The previous
// implementation interpolated JSON.stringify(sql) into a shell command, which
// delivered multiline SQL to D1 with literal "\n" escape sequences instead of
// newlines and failed the 2026-10-26 production deploy (run 40278428624) on the
// first statement. Argument arrays pass SQL through byte-for-byte.
function execNpx(args, stdio) {
  try {
    return execFileSync('npx', ['--yes', 'wrangler@4', ...args], {
      encoding: 'utf8',
      stdio,
      // cmd.exe cannot launch npx.cmd without a shell; POSIX (CI) runs shell-free.
      shell: process.platform === 'win32',
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (err) {
    const detail = [err.stdout, err.stderr]
      .filter(v => typeof v === 'string' && v.trim())
      .join('\n')
      .trim()
      .slice(0, 2000);
    throw new Error(
      `[migrate-d1] wrangler ${args.slice(0, 3).join(' ')} failed (exit ${err.status ?? 'unknown'})` +
      (detail ? `:\n${detail}` : `: ${err.message}`)
    );
  }
}

export function parseWranglerJsonOutput(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end < start) {
    throw new Error(`[migrate-d1] Wrangler did not return JSON output: ${output.slice(0, 500) || '(empty output)'}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new Error(`[migrate-d1] Could not parse Wrangler JSON output: ${output.slice(0, 500)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('[migrate-d1] Wrangler returned an unexpected empty result set.');
  }
  const first = parsed[0];
  if (first && first.success === false) {
    throw new Error(`[migrate-d1] D1 query failed: ${JSON.stringify(first.error ?? first).slice(0, 1000)}`);
  }
  return Array.isArray(first?.results) ? first.results : [];
}

function runWranglerCommand(command) {
  const output = execNpx(
    ['d1', 'execute', DB_NAME, '--remote', '--json', `--command=${command}`, `--config=${WRANGLER_CONFIG}`],
    ['ignore', 'pipe', 'pipe']
  );
  return parseWranglerJsonOutput(String(output ?? ''));
}

function runWranglerFile(filePath) {
  execNpx(
    ['d1', 'execute', DB_NAME, '--remote', `--file=${filePath}`, `--config=${WRANGLER_CONFIG}`],
    'inherit'
  );
}

export function migrateRemote() {
  console.log(`[migrate-d1] Ensuring migration tracking table exists on ${DB_NAME}...`);
  runWranglerCommand("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')))");

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

    // One statement per D1 call: a single --command must never bundle several
    // statements, and each statement's success is then individually verified.
    runWranglerCommand("CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_checkout_code ON contact_requests(checkout_code) WHERE checkout_code IS NOT NULL");
    runWranglerCommand("CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_checkout_code ON service_orders(checkout_code) WHERE checkout_code IS NOT NULL");
    runWranglerCommand("CREATE TABLE IF NOT EXISTS checkout_name_prompts (telegram_user_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')), created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')))");

    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0004_checkout_codes')");
    console.log('[migrate-d1] 0004_checkout_codes migration complete.');
  }

  // Migration 5: one active request/order per Telegram user (partial unique indexes).
  // Pre-check duplicates: index creation fails if a user already has multiple active
  // rows, so surface that as an operator action instead of a raw SQLite error.
  if (!applied.has('0005_one_active_request_per_user')) {
    console.log('[migrate-d1] Checking for duplicate active rows before 0005_one_active_request_per_user...');
    const duplicateChecks = [
      ['contact_requests', "SELECT telegram_user_id, COUNT(*) AS active_count FROM contact_requests WHERE status IN ('awaiting_email','pending_payment','payment_verified') GROUP BY telegram_user_id HAVING COUNT(*) > 1"],
      ['service_orders', "SELECT telegram_user_id, COUNT(*) AS active_count FROM service_orders WHERE status IN ('awaiting_request','awaiting_email','pending_payment','payment_verified') GROUP BY telegram_user_id HAVING COUNT(*) > 1"]
    ];
    for (const [table, query] of duplicateChecks) {
      const duplicates = runWranglerCommand(query);
      if (duplicates.length > 0) {
        throw new Error(
          `[migrate-d1] ${table} has ${duplicates.length} Telegram user(s) with multiple active rows. ` +
          'Reconcile them manually (keep the newest legitimate request, reject/cancel the rest), then re-run. No data was changed by this check.'
        );
      }
    }
    console.log('[migrate-d1] Applying 0005_one_active_request_per_user migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0005_one_active_request_per_user.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0005_one_active_request_per_user')");
  }

  // Migration 6: manual receipt-review prompt and submission tracking. The SQL
  // is entirely CREATE ... IF NOT EXISTS and contains no customer-data changes.
  if (!applied.has('0006_receipt_review')) {
    console.log('[migrate-d1] Applying 0006_receipt_review migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0006_receipt_review.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0006_receipt_review')");
  }

  // Migration 7: allow up to three unpaid contact requests per Telegram user.
  // Keep the separate service-order active-request index intact.
  if (!applied.has('0007_front_desk_multi_requests')) {
    console.log('[migrate-d1] Applying 0007_front_desk_multi_requests migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0007_front_desk_multi_requests.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0007_front_desk_multi_requests')");
  }

  // Migration 8: request-bound creator-contact delivery drafts.
  if (!applied.has('0008_delivery_drafts')) {
    console.log('[migrate-d1] Applying 0008_delivery_drafts migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0008_delivery_drafts.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0008_delivery_drafts')");
  }

  // Migration 9: service fulfilment drafts requiring explicit confirmation.
  if (!applied.has('0009_service_delivery_drafts')) {
    console.log('[migrate-d1] Applying 0009_service_delivery_drafts migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0009_service_delivery_drafts.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0009_service_delivery_drafts')");
  }

  // Migration 10: general Admin Desk customer-support drafts. This remains
  // separate from contact delivery and service fulfilment state.
  if (!applied.has('0010_admin_message_drafts')) {
    console.log('[migrate-d1] Applying 0010_admin_message_drafts migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0010_admin_message_drafts.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0010_admin_message_drafts')");
  }

  // Migration 11: admin-confirmed broadcast drafts with optional media.
  if (!applied.has('0011_admin_broadcast_drafts')) {
    console.log('[migrate-d1] Applying 0011_admin_broadcast_drafts migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0011_admin_broadcast_drafts.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0011_admin_broadcast_drafts')");
  }

  // Migration 12: persistent profile visibility overrides controlled by the Admin Desk.
  if (!applied.has('0012_hidden_profiles')) {
    console.log('[migrate-d1] Applying 0012_hidden_profiles migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0012_hidden_profiles.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0012_hidden_profiles')");
  }

  // Migration 13: durable admin action confirmation state.
  if (!applied.has('0013_admin_pending_actions')) {
    console.log('[migrate-d1] Applying 0013_admin_pending_actions migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0013_admin_pending_actions.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0013_admin_pending_actions')");
  }

  // Migration 14: remove retired creator-sharing permission columns while
  // preserving every saved contact and all order/payment/audit history.
  if (!applied.has('0014_remove_creator_sharing_permissions')) {
    console.log('[migrate-d1] Applying 0014_remove_creator_sharing_permissions migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0014_remove_creator_sharing_permissions.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0014_remove_creator_sharing_permissions')");
  }

  // Migration 15: optional media on service fulfilment drafts. Column checks
  // make a retry after a partially applied remote ALTER safe and idempotent.
  if (!applied.has('0015_service_delivery_draft_media')) {
    console.log('[migrate-d1] Applying 0015_service_delivery_draft_media migration...');
    const serviceDraftCols = runWranglerCommand('PRAGMA table_info(service_delivery_drafts)').map(r => r.name);
    if (!serviceDraftCols.includes('media_kind')) {
      runWranglerCommand("ALTER TABLE service_delivery_drafts ADD COLUMN media_kind TEXT CHECK(media_kind IS NULL OR media_kind IN ('photo','document'))");
    }
    if (!serviceDraftCols.includes('media_file_id')) {
      runWranglerCommand('ALTER TABLE service_delivery_drafts ADD COLUMN media_file_id TEXT');
    }
    if (!serviceDraftCols.includes('media_mime_type')) {
      runWranglerCommand('ALTER TABLE service_delivery_drafts ADD COLUMN media_mime_type TEXT');
    }
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0015_service_delivery_draft_media')");
  }

  // Migration 16: allow durable audited recovery of a stale locked draft.
  // Inspect the existing table definition so an already-rebuilt table is not
  // rebuilt again if a prior run stopped before recording the version.
  if (!applied.has('0016_admin_draft_recovery_actions')) {
    console.log('[migrate-d1] Applying 0016_admin_draft_recovery_actions migration...');
    const pendingActionSchema = runWranglerCommand("SELECT sql FROM sqlite_master WHERE type='table' AND name='admin_pending_actions' LIMIT 1");
    const pendingActionSql = String(pendingActionSchema[0]?.sql || '');
    if (!pendingActionSql.includes("'recover_draft'")) {
      runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0016_admin_draft_recovery_actions.sql'));
    } else {
      runWranglerCommand("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_pending_actions_one_pending_per_admin ON admin_pending_actions(admin_telegram_id) WHERE status='pending'");
    }
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0016_admin_draft_recovery_actions')");
  }

  // Migration 17: allow up to three unverified service orders per Telegram user.
  if (!applied.has('0017_limit_unverified_service_orders')) {
    console.log('[migrate-d1] Applying 0017_limit_unverified_service_orders migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0017_limit_unverified_service_orders.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0017_limit_unverified_service_orders')");
  }

  // Migration 18: clear delivered/closed Telegram media references.
  if (!applied.has('0018_clear_delivered_media_references')) {
    console.log('[migrate-d1] Applying 0018_clear_delivered_media_references migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0018_clear_delivered_media_references.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0018_clear_delivered_media_references')");
  }

  // Migration 19: durable snapshot and delivery ledger for all-client broadcasts.
  if (!applied.has('0019_admin_broadcast_recipients')) {
    console.log('[migrate-d1] Applying 0019_admin_broadcast_recipients migration...');
    runWranglerFile(path.join(ROOT, 'contact-bot', 'migrations', '0019_admin_broadcast_recipients.sql'));
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0019_admin_broadcast_recipients')");
  }

  // Migration 20: receipt-review button state. The purpose-column check keeps
  // a retry safe if a prior remote ALTER succeeded before version recording.
  if (!applied.has('0020_receipt_review_actions')) {
    console.log('[migrate-d1] Applying 0020_receipt_review_actions migration...');
    const adminMessageDraftCols = runWranglerCommand('PRAGMA table_info(admin_message_drafts)').map(r => r.name);
    if (!adminMessageDraftCols.includes('purpose')) {
      runWranglerCommand("ALTER TABLE admin_message_drafts ADD COLUMN purpose TEXT NOT NULL DEFAULT 'support' CHECK (purpose IN ('support', 'rejection'))");
    }
    runWranglerCommand("CREATE TABLE IF NOT EXISTS admin_receipt_verify_prompts (admin_telegram_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, order_kind TEXT NOT NULL CHECK (order_kind IN ('contact', 'service')), expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))");
    runWranglerCommand('CREATE INDEX IF NOT EXISTS idx_admin_receipt_verify_prompts_order ON admin_receipt_verify_prompts(order_kind, order_id)');
    runWranglerCommand("INSERT OR IGNORE INTO schema_migrations(version) VALUES('0020_receipt_review_actions')");
  }

  // Final complete schema verification. These expectations are shared with the
  // local migration verifier to prevent the two definitions drifting apart.
  console.log('[migrate-d1] Verifying complete schema...');
  const tables = runWranglerCommand("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  const columnsByTable = {};
  const uniqueIndexes = [];
  for (const table of Object.keys(EXPECTED_SCHEMA)) {
    columnsByTable[table] = runWranglerCommand(`PRAGMA table_info(${table})`).map(row => row.name);
    for (const index of runWranglerCommand(`PRAGMA index_list(${table})`)) {
      uniqueIndexes.push({ table, name: index.name, unique: index.unique });
    }
  }
  verifyRemoteSchema({ tables, columnsByTable, uniqueIndexes });

  console.log('[migrate-d1] All migrations safely applied and verified successfully.');
}

if (process.argv.includes('--remote')) {
  try {
    migrateRemote();
  } catch (err) {
    console.error('[migrate-d1] Remote migration error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
