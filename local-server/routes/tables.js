/**
 * routes/tables.js — Table management + status operations
 * Broadcasts table status changes via Socket.IO to mobile clients.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, logSync, now } = require('../db');

const router = express.Router();

// GET /api/v1/tables
router.get('/', (req, res) => {
  try {
    const db       = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const list     = branchId
      ? db.prepare('SELECT * FROM tables WHERE branch_id = ? ORDER BY tableNumber').all(branchId)
      : db.prepare('SELECT * FROM tables ORDER BY tableNumber').all();
    res.json({ success: true, data: list.map(formatTable) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/tables/:id
router.get('/:id', (req, res) => {
  try {
    const t = getDb().prepare('SELECT * FROM tables WHERE _id = ?').get(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Table not found' });
    res.json({ success: true, data: formatTable(t) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tables
router.post('/', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const _id  = body._id || uuidv4();
    db.prepare(`
      INSERT INTO tables (_id, branch_id, section_id, sectionName, tableNumber, capacity, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      _id,
      body.branchId || req.user?.branchId,
      body.sectionId || body.section_id || '',
      body.sectionName || '',
      body.tableNumber || `T-${_id.slice(0, 4)}`,
      body.capacity || 4,
      body.status || 'Available',
      now()
    );
    const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(_id);
    logSync('tables', _id, 'INSERT', formatTable(t));
    res.status(201).json({ success: true, data: formatTable(t) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/v1/tables/:id
router.put('/:id', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const id   = req.params.id;

    db.prepare(`
      UPDATE tables SET
        tableNumber = COALESCE(?, tableNumber),
        capacity    = COALESCE(?, capacity),
        status      = COALESCE(?, status),
        sectionId   = COALESCE(?, section_id),
        sectionName = COALESCE(?, sectionName),
        updated_at  = ?
      WHERE _id = ?
    `).run(body.tableNumber, body.capacity, body.status, body.sectionId, body.sectionName, now(), id);

    const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(id);
    if (t) {
      logSync('tables', id, 'UPDATE', formatTable(t));
      broadcastTableUpdate(req.io, t);
    }
    res.json({ success: true, data: t ? formatTable(t) : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/v1/tables/:id
router.delete('/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM tables WHERE _id = ?').run(req.params.id);
    logSync('tables', req.params.id, 'DELETE', { _id: req.params.id });
    res.json({ success: true, data: { message: 'Table deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tables/reserve
router.post('/reserve', (req, res) => {
  try {
    const db = getDb();
    const { tableId, customerName, phone, guests, reservedDate, reservedTime } = req.body;
    const reservation = JSON.stringify({ customerName, phone, guests, reservedDate, reservedTime });
    db.prepare("UPDATE tables SET status = 'Reserved', reservation = ?, updated_at = ? WHERE _id = ?")
      .run(reservation, now(), tableId);
    const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(tableId);
    if (t) broadcastTableUpdate(req.io, t);
    res.json({ success: true, data: formatTable(t) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tables/cancel-reservation
router.post('/cancel-reservation', (req, res) => {
  try {
    const db = getDb();
    const { tableId } = req.body;
    db.prepare("UPDATE tables SET status = 'Available', reservation = NULL, updated_at = ? WHERE _id = ?")
      .run(now(), tableId);
    const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(tableId);
    if (t) broadcastTableUpdate(req.io, t);
    res.json({ success: true, data: formatTable(t) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tables/merge
router.post('/merge', (req, res) => {
  try {
    const db = getDb();
    const { primaryTableId, targetTableId } = req.body;
    db.prepare("UPDATE tables SET status = 'Merged', updated_at = ? WHERE _id = ?")
      .run(now(), targetTableId);
    const primary = db.prepare('SELECT * FROM tables WHERE _id = ?').get(primaryTableId);
    const target  = db.prepare('SELECT * FROM tables WHERE _id = ?').get(targetTableId);
    if (primary) broadcastTableUpdate(req.io, primary);
    if (target)  broadcastTableUpdate(req.io, target);
    res.json({ success: true, data: { primary: formatTable(primary), target: formatTable(target) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tables/separate
router.post('/separate', (req, res) => {
  try {
    const db = getDb();
    const { tableId } = req.body;
    db.prepare("UPDATE tables SET status = 'Available', updated_at = ? WHERE _id = ?")
      .run(now(), tableId);
    const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(tableId);
    if (t) broadcastTableUpdate(req.io, t);
    res.json({ success: true, data: formatTable(t) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/tables/release
router.post('/release', (req, res) => {
  try {
    const db = getDb();
    const { tableId } = req.body;
    db.prepare("UPDATE tables SET status = 'Available', current_order_id = NULL, reservation = NULL, updated_at = ? WHERE _id = ?")
      .run(now(), tableId);
    const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(tableId);
    if (t) broadcastTableUpdate(req.io, t);
    res.json({ success: true, data: formatTable(t) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTable(t) {
  if (!t) return null;
  return {
    _id:         t._id,
    tableNumber: t.tableNumber,
    sectionId:   t.section_id || t.sectionId,
    sectionName: t.sectionName || '',
    branchId:    t.branch_id,
    capacity:    t.capacity || 4,
    status:      t.status || 'Available',
    currentOrderId: t.current_order_id || null,
    reservation: t.reservation ? JSON.parse(t.reservation) : null,
  };
}

function broadcastTableUpdate(io, table) {
  if (!io || !table) return;
  const formatted = formatTable(table);
  const statusPayload = { ...formatted, tableId: table._id, status: table.status };
  io.to(`branch_${table.branch_id}`).emit('table_updated', formatted);
  io.to(`branch_${table.branch_id}`).emit('table:status_changed', statusPayload);
  io.to(`branch_${table.branch_id}`).emit('table_status', statusPayload);
  io.emit('table_updated', formatted);
  io.emit('table:status_changed', statusPayload);
  io.emit('table_status', statusPayload);
}

module.exports = router;
