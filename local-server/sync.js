/**
 * sync.js — Background Cloud Sync Service
 * Reads unsynced events from sync_log → POSTs to cloud → marks synced.
 * Runs every 30 seconds when internet is available.
 */

const CLOUD_API  = 'https://arabia-mandi-orderingtool-backend.onrender.com/api/v1';
const SYNC_INTERVAL_MS = 30_000;

let timer       = null;
let isSyncing   = false;
let lastSyncAt  = null;
let pendingCount = 0;
let hasCloudToken = false;

function getSyncStatus() {
  return { isSyncing, lastSyncAt, pendingCount, hasCloudToken };
}

function startSyncService() {
  if (timer) return;
  console.log('[Sync] Service started — interval:', SYNC_INTERVAL_MS / 1000, 's');
  // Run immediately, then on interval
  runSync();
  timer = setInterval(runSync, SYNC_INTERVAL_MS);
}

function stopSyncService() {
  if (timer) { clearInterval(timer); timer = null; }
  console.log('[Sync] Service stopped');
}

async function pullFromCloud(db, token) {
  try {
    const fetch = require('node-fetch');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    // 1. Pull all branches
    try {
      const bRes = await fetch(`${CLOUD_API}/branches`, { timeout: 5000, headers });
      if (bRes.ok) {
        const bData = await bRes.json();
        const branches = Array.isArray(bData) ? bData : (bData?.data || bData?.branches || []);
        if (branches.length > 0) {
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO branches (_id, name, branchCode, address, phone, isActive, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `);
          for (const b of branches) {
            if (!b || !b._id) continue;
            stmt.run(String(b._id), b.name || 'Branch', b.branchCode || '', b.address || '', b.phone || '', b.isActive === false || b.isActive === 0 ? 0 : 1);
          }
        }
      }
    } catch (e) { console.warn('[Sync] Branches pull error:', e.message); }

    // 2. For every branch stored locally, sync its categories, items, sections, tables, printers
    const localBranches = db.prepare('SELECT _id FROM branches WHERE isActive=1 OR isActive IS NULL').all() || [];
    for (const br of localBranches) {
      const bid = br._id;
      if (!bid) continue;

      // Pull Categories
      try {
        const cRes = await fetch(`${CLOUD_API}/menu/categories?branchId=${bid}`, { timeout: 4000, headers });
        if (cRes.ok) {
          const cData = await cRes.json();
          const cats = Array.isArray(cData) ? cData : (cData?.data || cData?.categories || []);
          const cStmt = db.prepare(`INSERT OR REPLACE INTO categories (_id, branch_id, name, sort_order, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`);
          for (const c of cats) {
            if (c?._id) cStmt.run(String(c._id), String(bid), c.name || 'Category', c.sortOrder || c.sort_order || 0);
          }
        }
      } catch (e) { console.warn('[Sync] Categories pull error:', e.message); }

      // Pull Menu Items
      try {
        const mRes = await fetch(`${CLOUD_API}/menu/items?branchId=${bid}`, { timeout: 4000, headers });
        if (mRes.ok) {
          const mData = await mRes.json();
          const items = Array.isArray(mData) ? mData : (mData?.data || mData?.menuItems || []);
          const mStmt = db.prepare(`INSERT OR REPLACE INTO menu_items (_id, branch_id, category_id, name, price, available, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
          for (const it of items) {
            if (!it?._id) continue;
            const catId = it.categoryId || it.category_id || '';
            const avail = (it.isAvailable === false || it.available === false || it.available === 0) ? 0 : 1;
            mStmt.run(String(it._id), String(bid), String(catId), it.name || 'Dish', Number(it.price) || 0, avail);
          }
        }
      } catch (e) { console.warn('[Sync] Menu items pull error:', e.message); }

      // Pull Sections
      try {
        const sRes = await fetch(`${CLOUD_API}/sections?branchId=${bid}`, { timeout: 4000, headers });
        if (sRes.ok) {
          const sData = await sRes.json();
          const sections = Array.isArray(sData) ? sData : (sData?.data || sData?.sections || []);
          const sStmt = db.prepare(`INSERT OR REPLACE INTO sections (_id, branch_id, name, updated_at) VALUES (?, ?, ?, datetime('now'))`);
          for (const sec of sections) {
            if (sec?._id) sStmt.run(String(sec._id), String(bid), sec.name || 'Section');
          }
        }
      } catch (e) { console.warn('[Sync] Sections pull error:', e.message); }

      // Pull Tables (Safely preserving active local dine-in order state!)
      try {
        const tRes = await fetch(`${CLOUD_API}/tables?branchId=${bid}`, { timeout: 4000, headers });
        if (tRes.ok) {
          const tData = await tRes.json();
          const tables = Array.isArray(tData) ? tData : (tData?.data || tData?.tables || []);
          const checkStmt  = db.prepare('SELECT current_order_id, status FROM tables WHERE _id = ?');
          const updateStmt = db.prepare(`UPDATE tables SET branch_id=?, section_id=?, sectionName=?, tableNumber=?, capacity=?, status=COALESCE(?, status), updated_at=datetime('now') WHERE _id=?`);
          const insertStmt = db.prepare(`INSERT INTO tables (_id, branch_id, section_id, sectionName, tableNumber, capacity, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
          for (const tb of tables) {
            if (!tb?._id) continue;
            const secId = tb.sectionId || tb.section_id || 'sec-1';
            const existing = checkStmt.get(String(tb._id));
            if (existing) {
              // Only update status from cloud if table does NOT currently have an active local dine-in order
              const newStatus = existing.current_order_id ? existing.status : (tb.status || 'Available');
              updateStmt.run(String(bid), String(secId), tb.sectionName || 'Dining Hall', tb.tableNumber || 'TBL', Number(tb.capacity) || 4, newStatus, String(tb._id));
            } else {
              insertStmt.run(String(tb._id), String(bid), String(secId), tb.sectionName || 'Dining Hall', tb.tableNumber || 'TBL', Number(tb.capacity) || 4, tb.status || 'Available');
            }
          }
        }
      } catch (e) { console.warn('[Sync] Tables pull error:', e.message); }

      // Pull Network Printers
      try {
        const pRes = await fetch(`${CLOUD_API}/printers?branchId=${bid}`, { timeout: 4000, headers });
        if (pRes.ok) {
          const pData = await pRes.json();
          const printers = Array.isArray(pData) ? pData : (pData?.data || pData?.printers || []);
          const pStmt = db.prepare(`INSERT OR REPLACE INTO printers (_id, branch_id, name, ip, ip_address, port, type, duty, role, sections, isActive, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
          for (const pr of printers) {
            if (!pr?._id) continue;
            const ip = pr.ip || pr.ipAddress || pr.ip_address || '';
            const active = (pr.isActive === false || pr.is_active === 0) ? 0 : 1;
            const secStr = Array.isArray(pr.sections) ? JSON.stringify(pr.sections) : (pr.sections || '["ALL"]');
            pStmt.run(String(pr._id), String(bid), pr.name || 'Printer', ip, ip, Number(pr.port) || 9100, pr.type || 'thermal', pr.duty || 'KOT', pr.role || 'kitchen', secStr, active, active);
          }
        }
      } catch (e) { console.warn('[Sync] Printers pull error:', e.message); }
    }
  } catch (err) {
    console.warn('[Sync] Pull error:', err.message);
  }
}

async function runSync() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // Lazy-import to avoid circular dep at startup
    const { getDb } = require('./db');
    const db        = getDb();

    // Check internet connectivity first
    const online = await checkOnline();
    if (!online) {
      console.log('[Sync] Offline or cloud unreachable — skipping this cycle');
      isSyncing = false;
      return;
    }

    // Get cloud token from branch_config
    const branch = db.prepare('SELECT cloud_token FROM branch_config LIMIT 1').get();
    const token  = branch?.cloud_token;
    hasCloudToken = !!token;

    // 1. Pull latest master data from cloud into local SQLite using Authorization token
    await pullFromCloud(db, token);

    // 2. Check and push locally occurring events from sync_log up to cloud
    const rows = db.prepare(
      'SELECT * FROM sync_log WHERE synced=0 ORDER BY id ASC LIMIT 100'
    ).all();

    pendingCount = db.prepare('SELECT COUNT(*) as c FROM sync_log WHERE synced=0').get().c;

    if (!rows.length) {
      isSyncing = false;
      return;
    }

    if (!token) {
      console.warn('[Sync] No cloud token stored — waiting for online login to resume sync');
      isSyncing = false;
      return;
    }

    // POST batch to cloud
    const fetch    = require('node-fetch');
    const payload  = rows.map(r => ({
      id:        r.id,
      table:     r.table_name,
      recordId:  r.record_id,
      action:    r.action,
      payload:   JSON.parse(r.payload),
      createdAt: r.created_at,
    }));

    const response = await fetch(`${CLOUD_API}/sync/upload`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body:    JSON.stringify({ items: payload }),
      timeout: 10_000,
    });

    if (response.ok) {
      // Mark all as synced
      const ids = rows.map(r => r.id);
      db.prepare(
        `UPDATE sync_log SET synced=1 WHERE id IN (${ids.map(() => '?').join(',')})`
      ).run(...ids);

      lastSyncAt   = new Date().toISOString();
      pendingCount = db.prepare('SELECT COUNT(*) as c FROM sync_log WHERE synced=0').get().c;
      console.log(`[Sync] ✓ Pushed ${rows.length} events to cloud. Pending: ${pendingCount}`);
    } else {
      const txt = await response.text().catch(() => '');
      console.warn('[Sync] Cloud rejected batch:', response.status, txt.slice(0, 200));
    }
  } catch (err) {
    console.warn('[Sync] Cycle error:', err.message);
  } finally {
    isSyncing = false;
  }
}

async function checkOnline() {
  try {
    const fetch = require('node-fetch');
    const res   = await fetch(`${CLOUD_API.replace('/api/v1', '/api')}/health`, { method: 'GET', timeout: 4000 });
    if (res.ok || res.status < 500) return true;
  } catch {}

  try {
    const fetch = require('node-fetch');
    const res   = await fetch('https://1.1.1.1', { method: 'HEAD', timeout: 3000 });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

module.exports = { startSyncService, stopSyncService, getSyncStatus, runSync };
