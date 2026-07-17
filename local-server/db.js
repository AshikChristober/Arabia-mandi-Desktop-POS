/**
 * db.js — SQLite Database Layer
 * Uses better-sqlite3 (synchronous, fast, zero-config).
 * All tables mirror the cloud schema but use TEXT _id (UUIDs).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

// ─── Init ────────────────────────────────────────────────────────────────────

function initDb(userDataPath) {
  if (db) return db;

  const dbDir = path.join(userDataPath, 'petpooja-data');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'petpooja.db');
  db = new Database(dbPath);

  // Performance: WAL mode + foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations();
  console.log('[DB] Initialized at:', dbPath);
  return db;
}

function getDb() {
  if (!db) throw new Error('[DB] Not initialized. Call initDb() first from main.js.');
  return db;
}

// ─── Schema Migrations ────────────────────────────────────────────────────────

function runMigrations() {
  db.exec(`
    -- Branch configuration (one row per desktop — this machine's branch)
    CREATE TABLE IF NOT EXISTS branch_config (
      _id             TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      branchCode      TEXT,
      address         TEXT,
      phone           TEXT,
      gst             TEXT,
      cgst            REAL DEFAULT 2.5,
      sgst            REAL DEFAULT 2.5,
      serviceCharge   REAL DEFAULT 0,
      timings         TEXT,
      cloud_branch_id TEXT,
      cloud_token     TEXT,
      last_synced_at  TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    -- Branches table (cloud mirror)
    CREATE TABLE IF NOT EXISTS branches (
      _id        TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      branchCode TEXT,
      address    TEXT,
      phone      TEXT,
      isActive   INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Users table (cloud mirror for auth compatibility)
    CREATE TABLE IF NOT EXISTS users (
      _id        TEXT PRIMARY KEY,
      email      TEXT UNIQUE,
      password   TEXT,
      name       TEXT,
      role       TEXT,
      branchId   TEXT,
      isActive   INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Staff members for this branch
    CREATE TABLE IF NOT EXISTS staff (
      _id           TEXT PRIMARY KEY,
      branch_id     TEXT,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email         TEXT,
      phone         TEXT,
      designation   TEXT,
      employeeCode  TEXT,
      branchAccess  TEXT DEFAULT 'Single Branch',
      active        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now')),
      updated_at    TEXT DEFAULT (datetime('now'))
    );

    -- Sections (dining hall, rooftop, etc.)
    CREATE TABLE IF NOT EXISTS sections (
      _id        TEXT PRIMARY KEY,
      branch_id  TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Tables
    CREATE TABLE IF NOT EXISTS tables (
      _id              TEXT PRIMARY KEY,
      branch_id        TEXT NOT NULL,
      section_id       TEXT,
      sectionName      TEXT,
      tableNumber      TEXT NOT NULL,
      capacity         INTEGER DEFAULT 4,
      status           TEXT DEFAULT 'Available',
      current_order_id TEXT,
      reservation      TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    -- Menu categories
    CREATE TABLE IF NOT EXISTS categories (
      _id        TEXT PRIMARY KEY,
      branch_id  TEXT NOT NULL,
      name       TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Menu items
    CREATE TABLE IF NOT EXISTS menu_items (
      _id         TEXT PRIMARY KEY,
      branch_id   TEXT NOT NULL,
      category_id TEXT,
      name        TEXT NOT NULL,
      price       REAL NOT NULL,
      available   INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    -- Orders
    CREATE TABLE IF NOT EXISTS orders (
      _id          TEXT PRIMARY KEY,
      branch_id    TEXT NOT NULL,
      table_id     TEXT,
      tableNumber  TEXT,
      staff_id     TEXT,
      orderNumber  TEXT,
      orderType    TEXT DEFAULT 'DineIn',
      status       TEXT DEFAULT 'open',
      subtotal     REAL DEFAULT 0,
      tax          REAL DEFAULT 0,
      discount     REAL DEFAULT 0,
      total        REAL DEFAULT 0,
      note         TEXT,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    -- Order line items
    CREATE TABLE IF NOT EXISTS order_items (
      _id          TEXT PRIMARY KEY,
      order_id     TEXT NOT NULL,
      menu_item_id TEXT,
      menuItemId   TEXT,
      menuItem_id  TEXT,
      name         TEXT NOT NULL,
      variantName  TEXT DEFAULT 'Regular',
      price        REAL NOT NULL,
      quantity     INTEGER DEFAULT 1,
      qty          INTEGER DEFAULT 1,
      notes        TEXT,
      kot_sequence INTEGER DEFAULT 1,
      kot_printed  INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now'))
    );

    -- KOTs (Kitchen Order Tickets)
    CREATE TABLE IF NOT EXISTS kots (
      _id        TEXT PRIMARY KEY,
      order_id   TEXT NOT NULL,
      items_json TEXT NOT NULL,
      printed_at TEXT,
      status     TEXT DEFAULT 'pending',
      kotNumber  INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Bills
    CREATE TABLE IF NOT EXISTS bills (
      _id        TEXT PRIMARY KEY,
      order_id   TEXT NOT NULL,
      branch_id  TEXT,
      subtotal   REAL DEFAULT 0,
      tax        REAL DEFAULT 0,
      discount   REAL DEFAULT 0,
      total      REAL DEFAULT 0,
      status     TEXT DEFAULT 'unpaid',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Payments
    CREATE TABLE IF NOT EXISTS payments (
      _id      TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      bill_id  TEXT,
      cash     REAL DEFAULT 0,
      card     REAL DEFAULT 0,
      upi      REAL DEFAULT 0,
      total    REAL NOT NULL,
      paid_at  TEXT DEFAULT (datetime('now'))
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      _id        TEXT PRIMARY KEY,
      branch_id  TEXT,
      message    TEXT,
      type       TEXT DEFAULT 'info',
      read_status INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Network printers
    CREATE TABLE IF NOT EXISTS printers (
      _id        TEXT PRIMARY KEY,
      branch_id  TEXT NOT NULL,
      name       TEXT NOT NULL,
      ip         TEXT,
      ip_address TEXT,
      port       INTEGER DEFAULT 9100,
      type       TEXT DEFAULT 'thermal',
      duty       TEXT DEFAULT 'KOT',
      role       TEXT DEFAULT 'kitchen',
      sections   TEXT DEFAULT '["ALL"]',
      isActive   INTEGER DEFAULT 1,
      is_active  INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Sync queue: every mutation is logged here for cloud push
    CREATE TABLE IF NOT EXISTS sync_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id  TEXT NOT NULL,
      action     TEXT NOT NULL,
      payload    TEXT NOT NULL,
      synced     INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_orders_branch    ON orders(branch_id);
    CREATE INDEX IF NOT EXISTS idx_orders_table     ON orders(table_id);
    CREATE INDEX IF NOT EXISTS idx_order_items      ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_sync_log_synced  ON sync_log(synced);
    CREATE INDEX IF NOT EXISTS idx_tables_branch    ON tables(branch_id);
    CREATE INDEX IF NOT EXISTS idx_menu_items_cat   ON menu_items(category_id);
  `);

  // Safe migrations for existing DBs
  const safeAlter = (sql) => { try { db.exec(sql); } catch {} };
  // branches table (may be missing on older installs)
  safeAlter("ALTER TABLE branches ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE branches ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE staff ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE staff ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE orders ADD COLUMN orderType TEXT DEFAULT 'DineIn'");
  safeAlter("ALTER TABLE orders ADD COLUMN orderNumber TEXT");
  safeAlter("ALTER TABLE sections ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE tables ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE categories ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE menu_items ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE printers ADD COLUMN ip_address TEXT");
  safeAlter("ALTER TABLE printers ADD COLUMN ip TEXT");
  safeAlter("ALTER TABLE printers ADD COLUMN is_active INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE printers ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");
  safeAlter("ALTER TABLE order_items ADD COLUMN menuItemId TEXT");
  safeAlter("ALTER TABLE order_items ADD COLUMN menuItem_id TEXT");
  safeAlter("ALTER TABLE order_items ADD COLUMN menu_item_id TEXT");
  safeAlter("ALTER TABLE order_items ADD COLUMN variantName TEXT DEFAULT 'Regular'");
  safeAlter("ALTER TABLE order_items ADD COLUMN quantity INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE order_items ADD COLUMN kot_sequence INTEGER DEFAULT 1");
  safeAlter("ALTER TABLE order_items ADD COLUMN created_at TEXT DEFAULT (datetime('now'))");

  // Always seed default offline accounts using INSERT OR IGNORE so local POS login works offline right away
  try {
    const bcrypt = require('bcryptjs');
    const adminHash = bcrypt.hashSync('admin123', 10);
    const receptionHash = bcrypt.hashSync('reception123', 10);
    const imranHash = bcrypt.hashSync('imran123', 10);
    const tariqHash = bcrypt.hashSync('POS#Tariq2026', 10);
    const rameshHash = bcrypt.hashSync('Mandi#Ramesh99', 10);
    const johnHash = bcrypt.hashSync('Jubilee@2026', 10);

    const seedStaff = db.prepare(`
      INSERT OR IGNORE INTO staff (_id, branch_id, name, role, username, password_hash, email, branchAccess, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `);

    seedStaff.run('STAFF-ADMIN-001', 'BRANCH-QA-100', 'Super Admin', 'Super Admin', 'admin', adminHash, 'admin@arabiamandi.com', 'All Branches');
    seedStaff.run('STAFF-REC-001', 'BRANCH-QA-100', 'Receptionist POS', 'Receptionist', 'reception', receptionHash, 'reception@arabiamandi.com', 'Single Branch');
    seedStaff.run('STAFF-IMRAN-001', 'BR-BANJARA', 'Imran Qureshi', 'Manager', 'imran', imranHash, 'imran@arabiamandi.com', 'All Branches');
    seedStaff.run('STAFF-TARIQ-001', 'BR-JUBILEE', 'Mohammed Tariq', 'Receptionist', 'tariq.pos', tariqHash, 'tariq.reception@arabiamandi.com', 'Single Branch');
    seedStaff.run('STAFF-RAMESH-001', 'BR-BANJARA', 'Ramesh Cashier', 'Cashier', 'ramesh.cashier', rameshHash, 'ramesh.cashier@arabiamandi.com', 'Single Branch');
    seedStaff.run('STAFF-JOHN-001', 'BR-JUBILEE', 'John Doe Manager', 'Manager', 'john.manager', johnHash, 'johndoe@arabianmandi.com', 'All Branches');

    console.log('[DB] Seeded offline accounts (admin, reception, imran, tariq.pos, ramesh.cashier, john.manager)');
  } catch (err) {
    console.error('[DB] Error seeding offline accounts:', err.message);
  }

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Write a mutation to sync_log so it gets pushed to cloud later */
function logSync(tableName, recordId, action, payload) {
  try {
    getDb()
      .prepare(
        'INSERT INTO sync_log (table_name, record_id, action, payload) VALUES (?, ?, ?, ?)'
      )
      .run(tableName, recordId, action, JSON.stringify(payload));
  } catch (err) {
    console.error('[DB] Failed to write sync_log:', err.message);
  }
}

/** Generate a timestamp string */
function now() {
  return new Date().toISOString();
}

module.exports = { initDb, getDb, logSync, now };
