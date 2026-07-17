/**
 * routes/branches.js
 * The desktop belongs to ONE branch. Returns local branch_config.
 * Admin creates branches on the cloud; the desktop downloads its own config.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, logSync, now } = require('../db');

const router = express.Router();

// Helper to get fetch
const getFetch = () => {
  if (typeof fetch !== 'undefined') return fetch;
  try { return require('node-fetch'); } catch { return null; }
};

const CLOUD_API = 'https://arabia-mandi-orderingtool-backend.onrender.com/api/v1';

// GET /api/v1/branches — returns all branches (syncs from cloud if online, otherwise from local DB)
router.get('/', async (req, res) => {
  try {
    const db = getDb();

    // 1. Try fetching from cloud database to keep local SQLite in sync
    try {
      const fetchFunc = getFetch();
      if (fetchFunc) {
        const cloudRes = await fetchFunc(`${CLOUD_API}/branches`, { timeout: 4000 });
        if (cloudRes && cloudRes.ok) {
          const cloudData = await cloudRes.json();
          const cloudBranches = Array.isArray(cloudData) ? cloudData : (cloudData?.data || cloudData?.branches || []);
          if (Array.isArray(cloudBranches) && cloudBranches.length > 0) {
            const insertStmt = db.prepare(`
              INSERT OR REPLACE INTO branches (_id, name, branchCode, address, phone, isActive, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `);
            const checkConfig = db.prepare('SELECT COUNT(*) as c FROM branch_config').get();
            for (const b of cloudBranches) {
              if (!b || !b._id) continue;
              insertStmt.run(
                String(b._id),
                b.name || 'Branch',
                b.branchCode || '',
                b.address || '',
                b.phone || '',
                b.isActive === false || b.isActive === 0 ? 0 : 1
              );
            }
            // If branch_config is empty, seed with first active cloud branch
            if (!checkConfig || checkConfig.c === 0) {
              const first = cloudBranches[0];
              db.prepare(`
                INSERT OR REPLACE INTO branch_config (_id, name, branchCode, address, phone, gst, cgst, sgst, serviceCharge, timings, cloud_branch_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 2.5, 2.5, 0, ?, ?, ?)
              `).run(
                String(first._id), first.name || 'Branch', first.branchCode || '', first.address || '', first.phone || '',
                first.gst || '', first.timings || '11:00 AM - 11:30 PM', String(first._id), now()
              );
            }
          }
        }
      }
    } catch (e) {
      // Offline mode or cloud unreachable -> continue with local data
    }

    // 2. Fetch from local SQLite tables (branches + branch_config)
    const localBranches = db.prepare('SELECT * FROM branches WHERE isActive = 1 OR isActive IS NULL').all() || [];
    const localConfigs  = db.prepare('SELECT * FROM branch_config').all() || [];

    const branchMap = new Map();
    for (const b of localBranches) {
      branchMap.set(b._id, formatBranch(b));
    }
    for (const c of localConfigs) {
      if (!branchMap.has(c._id)) {
        branchMap.set(c._id, formatBranch(c));
      }
    }

    const list = Array.from(branchMap.values());
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/branches/:id
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    let branch = db.prepare('SELECT * FROM branch_config WHERE _id = ?').get(req.params.id);
    if (!branch) {
      branch = db.prepare('SELECT * FROM branches WHERE _id = ?').get(req.params.id);
    }
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.json({ success: true, data: formatBranch(branch) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/branches — create/update local branch config (first-time setup)
router.post('/', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const _id  = body._id || uuidv4();

    db.prepare(`
      INSERT OR REPLACE INTO branch_config
        (_id, name, branchCode, address, phone, gst, cgst, sgst, serviceCharge,
         timings, cloud_branch_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      _id, body.name, body.branchCode || '', body.address || '', body.phone || '',
      body.gst || '', body.taxes?.cgst ?? 2.5, body.taxes?.sgst ?? 2.5,
      body.taxes?.serviceCharge ?? 0, body.timings || '', body.cloud_branch_id || _id, now()
    );

    const branch = db.prepare('SELECT * FROM branch_config WHERE _id = ?').get(_id);
    logSync('branch_config', _id, 'INSERT', formatBranch(branch));

    res.json({ success: true, data: formatBranch(branch) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/v1/branches/:id
router.put('/:id', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const id   = req.params.id;

    db.prepare(`
      UPDATE branch_config SET
        name = COALESCE(?, name), branchCode = COALESCE(?, branchCode),
        address = COALESCE(?, address), phone = COALESCE(?, phone),
        gst = COALESCE(?, gst), updated_at = ?
      WHERE _id = ?
    `).run(body.name, body.branchCode, body.address, body.phone, body.gst, now(), id);

    const branch = db.prepare('SELECT * FROM branch_config WHERE _id = ?').get(id);
    if (branch) logSync('branch_config', id, 'UPDATE', formatBranch(branch));

    res.json({ success: true, data: branch ? formatBranch(branch) : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/v1/branches/:id/toggle-status — no-op locally (desktop is always active)
router.patch('/:id/toggle-status', (req, res) => {
  res.json({ success: true, data: { message: 'Status toggled' } });
});

// DELETE /api/v1/branches/:id — blocked on desktop
router.delete('/:id', (_req, res) => {
  res.status(403).json({ success: false, message: 'Cannot delete branch from desktop app' });
});

function formatBranch(b) {
  return {
    _id:        b._id,
    name:       b.name,
    branchCode: b.branchCode || '',
    address:    b.address || '',
    phone:      b.phone || '',
    gst:        b.gst || '',
    taxes: {
      cgst:          b.cgst ?? 2.5,
      sgst:          b.sgst ?? 2.5,
      serviceCharge: b.serviceCharge ?? 0,
    },
    timings:  b.timings || '',
    status:   'Active',
  };
}

module.exports = router;
