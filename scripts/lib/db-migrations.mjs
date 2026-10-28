import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

export const MIGRATIONS = [
  {
    version: '0001_baseline',
    description: 'Baseline contact-requests and creator-contacts tables',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'schema.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0002_service_orders',
    description: 'Separate service_orders table and indexes',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0002_service_orders.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0003_abandoned_carts',
    description: 'Processed abandoned-carts tracking table and index',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0003_abandoned_carts.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0004_checkout_codes',
    description: 'Idempotent checkout_code and checkout_name columns and prompt table',
    apply(db) {
      // 1. Check contact_requests columns
      const contactCols = getTableColumns(db, 'contact_requests');
      if (!contactCols.includes('checkout_code')) {
        db.exec("ALTER TABLE contact_requests ADD COLUMN checkout_code TEXT;");
      }
      if (!contactCols.includes('checkout_name')) {
        db.exec("ALTER TABLE contact_requests ADD COLUMN checkout_name TEXT;");
      }

      // 2. Check service_orders columns
      const serviceCols = getTableColumns(db, 'service_orders');
      if (!serviceCols.includes('checkout_code')) {
        db.exec("ALTER TABLE service_orders ADD COLUMN checkout_code TEXT;");
      }
      if (!serviceCols.includes('checkout_name')) {
        db.exec("ALTER TABLE service_orders ADD COLUMN checkout_name TEXT;");
      }

      // 3. Unique indexes and prompts table
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_requests_checkout_code ON contact_requests(checkout_code) WHERE checkout_code IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_checkout_code ON service_orders(checkout_code) WHERE checkout_code IS NOT NULL;
        CREATE TABLE IF NOT EXISTS checkout_name_prompts (
          telegram_user_id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          order_kind TEXT NOT NULL CHECK(order_kind IN ('contact','service')),
          created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
      `);
    }
  },
  {
    version: '0005_one_active_request_per_user',
    description: 'Partial unique indexes allowing one active request/order per Telegram user',
    apply(db) {
      assertNoDuplicateActiveRows(db);
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0005_one_active_request_per_user.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0006_receipt_review',
    description: 'Manual receipt-review prompt and idempotent submission tracking tables',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0006_receipt_review.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0007_front_desk_multi_requests',
    description: 'Allow up to three unpaid contact requests per Telegram user',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0007_front_desk_multi_requests.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0008_delivery_drafts',
    description: 'Request-bound expiring creator-contact delivery drafts',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0008_delivery_drafts.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0009_service_delivery_drafts',
    description: 'Expiring service fulfilment drafts requiring explicit confirmation',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0009_service_delivery_drafts.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0010_admin_message_drafts',
    description: 'General expiring Admin Desk customer-support drafts with optional media',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0010_admin_message_drafts.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0011_admin_broadcast_drafts',
    description: 'Expiring admin-confirmed broadcast drafts with optional media',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0011_admin_broadcast_drafts.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0012_hidden_profiles',
    description: 'Persistent admin-controlled profile visibility overrides',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0012_hidden_profiles.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0013_admin_pending_actions',
    description: 'Durable, expiring admin confirmation actions',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0013_admin_pending_actions.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0014_remove_creator_sharing_permissions',
    description: 'Remove retired creator-sharing permission columns while preserving contacts',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0014_remove_creator_sharing_permissions.sql'), 'utf8');
      db.exec(sql);
    }
  },
  {
    version: '0015_service_delivery_draft_media',
    description: 'Optional single media attachment for service fulfilment drafts',
    apply(db) {
      const columns = getTableColumns(db, 'service_delivery_drafts');
      if (!columns.includes('media_kind')) {
        db.exec("ALTER TABLE service_delivery_drafts ADD COLUMN media_kind TEXT CHECK(media_kind IS NULL OR media_kind IN ('photo','document'));");
      }
      if (!columns.includes('media_file_id')) {
        db.exec('ALTER TABLE service_delivery_drafts ADD COLUMN media_file_id TEXT;');
      }
      if (!columns.includes('media_mime_type')) {
        db.exec('ALTER TABLE service_delivery_drafts ADD COLUMN media_mime_type TEXT;');
      }
    }
  },
  {
    version: '0016_admin_draft_recovery_actions',
    description: 'Allow audited recovery confirmations for stale locked drafts',
    apply(db) {
      const sql = fs.readFileSync(path.join(ROOT, 'contact-bot', 'migrations', '0016_admin_draft_recovery_actions.sql'), 'utf8');
      db.exec(sql);
    }
  }
];

export const ACTIVE_STATUSES = {
  contact_requests: ['awaiting_email', 'pending_payment', 'payment_verified'],
  service_orders: ['awaiting_request', 'awaiting_email', 'pending_payment', 'payment_verified']
};

export function findDuplicateActiveUsers(db, table) {
  const statuses = ACTIVE_STATUSES[table];
  if (!statuses) throw new Error(`Unknown table for duplicate-active check: ${table}`);
  const placeholders = statuses.map(() => '?').join(',');
  try {
    return db.prepare(
      `SELECT telegram_user_id, COUNT(*) AS active_count FROM ${table} WHERE status IN (${placeholders}) GROUP BY telegram_user_id HAVING COUNT(*) > 1`
    ).all(...statuses);
  } catch {
    return [];
  }
}

export function assertNoDuplicateActiveRows(db) {
  const problems = [];
  for (const table of Object.keys(ACTIVE_STATUSES)) {
    const rows = findDuplicateActiveUsers(db, table);
    if (rows.length > 0) problems.push(`${table}: ${rows.length} user(s) with multiple active rows`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Migration 0005 cannot create its unique indexes yet: ${problems.join('; ')}. ` +
      'Reconcile the duplicate active rows manually (keep the newest legitimate request, ' +
      'reject/cancel the rest) and re-run the migration. No data was changed by this check.'
    );
  }
}

export function getTableColumns(db, tableName) {
  try {
    const rows = db.prepare ? db.prepare(`PRAGMA table_info(${tableName})`).all() : [];
    return rows.map(r => r.name);
  } catch {
    return [];
  }
}

export function getTableNames(db) {
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    return rows.map(r => r.name);
  } catch {
    return [];
  }
}

export function ensureMigrationTracking(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

export function getAppliedMigrations(db) {
  ensureMigrationTracking(db);
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all();
  return rows.map(r => r.version);
}

export function recordMigration(db, version) {
  ensureMigrationTracking(db);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(?)").run(version);
}

/**
 * Applies all pending migrations safely and idempotently.
 */
export function applyAllMigrations(db) {
  ensureMigrationTracking(db);
  const applied = new Set(getAppliedMigrations(db));

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.version)) {
      migration.apply(db);
      recordMigration(db, migration.version);
    }
  }

  return verifySchema(db);
}

export const EXPECTED_SCHEMA = {
  contact_requests: [
    'id', 'telegram_user_id', 'telegram_chat_id', 'telegram_username',
    'profile_id', 'buyer_email', 'status', 'payment_method',
    'manual_payment_reference', 'payment_reference', 'payment_amount_minor',
    'payment_currency', 'created_at', 'updated_at', 'checkout_code', 'checkout_name'
  ],
  creator_contacts: [
    'profile_id', 'contact_value', 'contact_type', 'updated_at'
  ],
  processed_sales: [
    'provider_reference', 'buyer_email', 'amount_minor', 'currency',
    'product_id', 'request_id', 'received_at'
  ],
  admin_audit: [
    'id', 'admin_telegram_id', 'action', 'profile_id', 'request_id',
    'details', 'created_at'
  ],
  service_orders: [
    'id', 'service_id', 'telegram_user_id', 'telegram_chat_id',
    'telegram_username', 'request_text', 'buyer_email', 'status',
    'payment_method', 'payment_reference', 'payment_amount_minor',
    'payment_currency', 'created_at', 'updated_at', 'checkout_code', 'checkout_name'
  ],
  processed_abandoned_carts: [
    'event_key', 'product_code', 'request_id', 'abandoned_at', 'processed_at'
  ],
  checkout_name_prompts: [
    'telegram_user_id', 'order_id', 'order_kind', 'created_at'
  ],
  receipt_review_prompts: [
    'telegram_user_id', 'order_id', 'order_kind', 'created_at'
  ],
  payment_receipt_submissions: [
    'id', 'order_id', 'order_kind', 'telegram_user_id', 'telegram_chat_id',
    'telegram_message_id', 'media_kind', 'telegram_file_id',
    'telegram_file_unique_id', 'mime_type', 'file_size', 'status',
    'admin_telegram_id', 'created_at', 'updated_at'
  ],
  delivery_drafts: [
    'id', 'request_id', 'admin_telegram_id', 'checkout_code', 'message_text',
    'media_kind', 'media_file_id', 'media_mime_type', 'status', 'expires_at',
    'delivered_at', 'created_at', 'updated_at'
  ],
  service_delivery_drafts: [
    'id', 'service_order_id', 'admin_telegram_id', 'message_text', 'media_kind',
    'media_file_id', 'media_mime_type', 'status', 'expires_at', 'delivered_at',
    'created_at', 'updated_at'
  ],
  admin_message_drafts: [
    'id', 'order_id', 'order_kind', 'admin_telegram_id', 'telegram_user_id',
    'telegram_chat_id', 'checkout_code', 'message_text', 'media_kind',
    'media_file_id', 'media_mime_type', 'status', 'expires_at',
    'delivered_at', 'created_at', 'updated_at'
  ],
  admin_broadcast_drafts: [
    'id', 'admin_telegram_id', 'message_text', 'media_kind', 'media_file_id',
    'media_mime_type', 'status', 'expires_at', 'created_at', 'updated_at'
  ],
  hidden_profiles: ['profile_id', 'hidden_by_admin', 'reason', 'hidden_at'],
  admin_pending_actions: ['id', 'admin_telegram_id', 'action', 'payload', 'status', 'expires_at', 'created_at', 'updated_at']
};

export const EXPECTED_UNIQUE_INDEXES = [
  { table: 'contact_requests', name: 'idx_contact_requests_checkout_code' },
  { table: 'service_orders', name: 'idx_service_orders_checkout_code' },
  { table: 'payment_receipt_submissions', name: 'idx_payment_receipt_submissions_telegram_message' },
  { table: 'payment_receipt_submissions', name: 'idx_payment_receipt_submissions_order_file' },
  { table: 'admin_message_drafts', name: 'idx_admin_message_drafts_one_editable_per_admin' },
  { table: 'admin_broadcast_drafts', name: 'idx_admin_broadcast_one_editable_per_admin' },
  { table: 'admin_pending_actions', name: 'idx_admin_pending_actions_one_pending_per_admin' }
];

/**
 * Shared structural verifier used by both local migration tests and the remote D1 runner.
 * uniqueIndexes entries must include the table, name, and SQLite unique flag.
 */
export function verifySchemaShape({ tables, columnsByTable, uniqueIndexes }) {
  const missingTables = Object.keys(EXPECTED_SCHEMA).filter(table => !tables.includes(table));
  if (missingTables.length > 0) {
    throw new Error(`Schema verification failed: missing table(s): ${missingTables.join(', ')}`);
  }

  const missingColumns = {};
  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    const actualColumns = columnsByTable[table] ?? [];
    const missing = expectedColumns.filter(column => !actualColumns.includes(column));
    if (missing.length > 0) missingColumns[table] = missing;
  }
  if (Object.keys(missingColumns).length > 0) {
    const details = Object.entries(missingColumns).map(([table, columns]) => `${table}: [${columns.join(', ')}]`).join('; ');
    throw new Error(`Schema verification failed: missing column(s): ${details}`);
  }

  const missingIndexes = EXPECTED_UNIQUE_INDEXES.filter(expected =>
    !uniqueIndexes.some(actual =>
      actual.table === expected.table && actual.name === expected.name &&
      (actual.unique === true || actual.unique === 1)
    )
  );
  if (missingIndexes.length > 0) {
    throw new Error(`Schema verification failed: missing unique index(es): ${missingIndexes.map(index => index.name).join(', ')}`);
  }

  return { ok: true, verifiedTables: Object.keys(EXPECTED_SCHEMA) };
}

/**
 * Validates complete schema integrity: all tables, required columns, and required unique indexes exist.
 */
export function verifySchema(db) {
  const tables = getTableNames(db);
  const columnsByTable = Object.fromEntries(
    Object.keys(EXPECTED_SCHEMA).map(table => [table, getTableColumns(db, table)])
  );
  const uniqueIndexes = [];
  for (const table of Object.keys(EXPECTED_SCHEMA)) {
    try {
      for (const index of db.prepare(`PRAGMA index_list(${table})`).all()) {
        uniqueIndexes.push({ table, name: index.name, unique: index.unique });
      }
    } catch {
      // The shared verifier will report missing required indexes.
    }
  }
  return verifySchemaShape({ tables, columnsByTable, uniqueIndexes });
}
