/**
 * routes/orders.js — Full order lifecycle
 * create → add-items → KOT → bill → payment
 * Broadcasts to mobile clients via Socket.IO on every mutation.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, logSync, now } = require('../db');

const router = express.Router();

// ─── GET all orders ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const db       = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const status   = req.query.status;

    let query  = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (branchId) { query += ' AND branch_id = ?'; params.push(branchId); }
    if (status)   { query += ' AND status = ?';    params.push(status); }
    query += ' ORDER BY created_at DESC';

    const orders = db.prepare(query).all(...params);
    const result = orders.map(o => enrichOrder(db, o));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET single order ─────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const o  = db.prepare('SELECT * FROM orders WHERE _id = ?').get(req.params.id);
    if (!o) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, data: enrichOrder(db, o) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /orders — create new order ─────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const _id  = body._id || body.id || uuidv4();
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

    db.prepare(`
      INSERT INTO orders (_id, branch_id, table_id, tableNumber, staff_id, status,
        subtotal, tax, discount, total, note, orderNumber, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', 0, 0, 0, 0, ?, ?, ?, ?)
    `).run(
      _id,
      body.branchId || req.user?.branchId,
      body.tableId || body.table_id || '',
      body.tableNumber || '',
      body.staffId || req.user?._id || '',
      body.note || '', orderNumber, now(), now()
    );

    // Add initial items if provided
    if (body.items?.length) {
      insertItems(db, _id, body.items);
      recalcTotals(db, _id);
    }

    // Set table to Occupied
    if (body.tableId) {
      db.prepare("UPDATE tables SET status = 'Occupied', current_order_id = ?, updated_at = ? WHERE _id = ?")
        .run(_id, now(), body.tableId);
      const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(body.tableId);
      if (t) broadcastTableUpdate(req.io, t);
    }

    const order = enrichOrder(db, db.prepare('SELECT * FROM orders WHERE _id = ?').get(_id));
    logSync('orders', _id, 'INSERT', order);
    broadcastOrderUpdate(req.io, order);

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /orders/:id/add-items ───────────────────────────────────────────────
router.post('/:id/add-items', (req, res) => {
  try {
    const db      = getDb();
    const orderId = req.params.id;
    const { items } = req.body;

    insertItems(db, orderId, items);
    recalcTotals(db, orderId);

    const order = enrichOrder(db, db.prepare('SELECT * FROM orders WHERE _id = ?').get(orderId));
    logSync('orders', orderId, 'UPDATE', order);
    broadcastOrderUpdate(req.io, order);

    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /orders/:id/status ─────────────────────────────────────────────────
router.patch('/:id/status', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE _id = ?')
      .run(req.body.status, now(), req.params.id);
    const order = enrichOrder(db, db.prepare('SELECT * FROM orders WHERE _id = ?').get(req.params.id));
    logSync('orders', req.params.id, 'UPDATE', order);
    broadcastOrderUpdate(req.io, order);
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /orders/:id/kot ─────────────────────────────────────────────────────
router.post('/:id/kot', (req, res) => {
  try {
    const db      = getDb();
    const orderId = req.params.id;

    // Only include items not yet KOT-printed
    const newItems = db.prepare(
      "SELECT * FROM order_items WHERE order_id = ? AND kot_printed = 0"
    ).all(orderId);

    if (!newItems.length) {
      return res.status(400).json({ success: false, message: 'No new items to KOT' });
    }

    const kotCount = db.prepare('SELECT COUNT(*) as c FROM kots WHERE order_id = ?').get(orderId).c;
    const kotId    = uuidv4();

    db.prepare('INSERT INTO kots (_id, order_id, items_json, printed_at, status, kotNumber) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kotId, orderId, JSON.stringify(newItems), now(), 'printed', kotCount + 1);

    // Mark items as printed
    db.prepare('UPDATE order_items SET kot_printed = 1, updated_at = ? WHERE order_id = ? AND kot_printed = 0')
      .run(now(), orderId);

    const order = enrichOrder(db, db.prepare('SELECT * FROM orders WHERE _id = ?').get(orderId));
    broadcastOrderUpdate(req.io, order);
    if (req.io) {
      const kotPayload = { kotId, orderId, items: newItems };
      req.io.to(`branch_${order.branchId}`).emit('kot_ready', kotPayload);
      req.io.to(`branch_${order.branchId}`).emit('kot:generated', kotPayload);
      req.io.emit('kot_ready', kotPayload);
      req.io.emit('kot:generated', kotPayload);
    }

    logSync('kots', kotId, 'INSERT', { kotId, orderId });
    res.json({ success: true, data: { ...order, latestKot: { _id: kotId, items: newItems, kotNumber: kotCount + 1 } } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /orders/:id/bill ────────────────────────────────────────────────────
router.post('/:id/bill', (req, res) => {
  try {
    const db      = getDb();
    const orderId = req.params.id;
    const order   = db.prepare('SELECT * FROM orders WHERE _id = ?').get(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const billId = uuidv4();
    db.prepare(`
      INSERT INTO bills (_id, order_id, branch_id, subtotal, tax, discount, total, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)
    `).run(billId, orderId, order.branch_id, order.subtotal, order.tax, order.discount, order.total, now());

    db.prepare("UPDATE orders SET status = 'billed', updated_at = ? WHERE _id = ?").run(now(), orderId);

    const bill  = db.prepare('SELECT * FROM bills WHERE _id = ?').get(billId);
    const full  = enrichOrder(db, db.prepare('SELECT * FROM orders WHERE _id = ?').get(orderId));
    logSync('bills', billId, 'INSERT', bill);
    broadcastOrderUpdate(req.io, full);
    if (req.io) {
      req.io.to(`branch_${order.branch_id}`).emit('bill:generated', bill);
      req.io.emit('bill:generated', bill);
    }

    res.json({ success: true, data: { ...full, bill } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /orders/payment ─────────────────────────────────────────────────────
router.post('/payment', (req, res) => {
  try {
    const db = getDb();
    const { billId, paymentMethods } = req.body;
    const { cash = 0, card = 0, upi = 0 } = paymentMethods || {};
    const total = cash + card + upi;

    const bill = db.prepare('SELECT * FROM bills WHERE _id = ?').get(billId);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });

    const payId = uuidv4();
    db.prepare('INSERT INTO payments (_id, order_id, bill_id, cash, card, upi, total, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(payId, bill.order_id, billId, cash, card, upi, total, now());

    db.prepare("UPDATE bills SET status = 'paid' WHERE _id = ?").run(billId);
    db.prepare("UPDATE orders SET status = 'completed', updated_at = ? WHERE _id = ?").run(now(), bill.order_id);

    // Release table
    const order = db.prepare('SELECT * FROM orders WHERE _id = ?').get(bill.order_id);
    if (order?.table_id) {
      db.prepare("UPDATE tables SET status = 'Available', current_order_id = NULL, updated_at = ? WHERE _id = ?")
        .run(now(), order.table_id);
      const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(order.table_id);
      if (t) broadcastTableUpdate(req.io, t);
    }

    const full = enrichOrder(db, db.prepare('SELECT * FROM orders WHERE _id = ?').get(bill.order_id));
    logSync('payments', payId, 'INSERT', { payId, billId, cash, card, upi, total });
    broadcastOrderUpdate(req.io, full);

    res.json({ success: true, data: full });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /orders/sync-local ──────────────────────────────────────────────────
router.post('/sync-local', (req, res) => {
  // Accept order data synced from offline session — merge into local DB
  try {
    const db   = getDb();
    const body = req.body;
    const _id  = body._id || uuidv4();

    const existing = db.prepare('SELECT _id FROM orders WHERE _id = ?').get(_id);
    if (!existing) {
      db.prepare(`
        INSERT OR REPLACE INTO orders (_id, branch_id, table_id, tableNumber, staff_id,
          status, subtotal, tax, discount, total, note, orderNumber, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        _id, body.branchId, body.tableId, body.tableNumber, body.staffId,
        body.status || 'completed', body.subtotal || 0, body.tax || 0,
        body.discount || 0, body.total || 0, body.note || '',
        body.orderNumber || _id.slice(0, 8), body.created_at || now(), now()
      );
    }

    logSync('orders', _id, existing ? 'UPDATE' : 'INSERT', body);
    res.json({ success: true, data: { _id } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function insertItems(db, orderId, items) {
  const stmt = db.prepare(`
    INSERT INTO order_items (_id, order_id, menu_item_id, menuItemId, name, price, qty, quantity, notes, kot_printed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  for (const item of items) {
    const q = item.qty || item.quantity || 1;
    stmt.run(uuidv4(), orderId, item.menuItemId || item._id || '', item.menuItemId || item._id || '', item.name, item.price, q, q, item.notes || '', now());
  }
}

function recalcTotals(db, orderId) {
  const items  = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const branch = db.prepare('SELECT * FROM branch_config LIMIT 1').get();
  const subtotal = items.reduce((s, i) => s + i.price * (i.qty || i.quantity || 1), 0);
  const cgst   = (branch?.cgst ?? 2.5) / 100;
  const sgst   = (branch?.sgst ?? 2.5) / 100;
  const tax    = subtotal * (cgst + sgst);
  const total  = subtotal + tax;

  db.prepare('UPDATE orders SET subtotal = ?, tax = ?, total = ?, updated_at = ? WHERE _id = ?')
    .run(subtotal, tax, total, now(), orderId);
}

function enrichOrder(db, o) {
  if (!o) return null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o._id);
  const kots  = db.prepare('SELECT * FROM kots WHERE order_id = ? ORDER BY kotNumber').all(o._id);
  const bill  = db.prepare("SELECT * FROM bills WHERE order_id = ? AND status = 'unpaid' LIMIT 1").get(o._id)
              || db.prepare("SELECT * FROM bills WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").get(o._id);

  return {
    _id:         o._id,
    branchId:    o.branch_id,
    tableId:     o.table_id,
    tableNumber: o.tableNumber,
    staffId:     o.staff_id,
    status:      o.status,
    subtotal:    o.subtotal,
    tax:         o.tax,
    discount:    o.discount,
    total:       o.total,
    note:        o.note || '',
    orderNumber: o.orderNumber,
    createdAt:   o.created_at,
    updatedAt:   o.updated_at,
    items:       items.map(i => ({
      _id: i._id,
      menuItemId: i.menu_item_id || i.menuItemId || i.menuItem_id || '',
      name: i.name,
      price: i.price,
      qty: i.qty || i.quantity || 1,
      notes: i.notes,
      kotPrinted: i.kot_printed === 1,
    })),
    kots: kots.map(k => ({
      _id: k._id, kotNumber: k.kotNumber,
      items: JSON.parse(k.items_json || '[]'), printedAt: k.printed_at, status: k.status,
    })),
    bill: bill ? {
      _id: bill._id, subtotal: bill.subtotal, tax: bill.tax,
      discount: bill.discount, total: bill.total, status: bill.status,
    } : null,
  };
}

function broadcastOrderUpdate(io, order) {
  if (!io || !order) return;
  io.to(`branch_${order.branchId}`).emit('order_updated', order);
  io.to(`branch_${order.branchId}`).emit('order:created', order);
  io.to(`branch_${order.branchId}`).emit('place_order', order);
  io.emit('order_updated', order);
  io.emit('order:created', order);
  io.emit('place_order', order);
}

function broadcastTableUpdate(io, table) {
  if (!io || !table) return;
  const payload = {
    _id: table._id, tableId: table._id, status: table.status, currentOrderId: table.current_order_id,
  };
  io.to(`branch_${table.branch_id}`).emit('table_updated', payload);
  io.to(`branch_${table.branch_id}`).emit('table:status_changed', payload);
  io.to(`branch_${table.branch_id}`).emit('table_status', payload);
  io.emit('table_updated', payload);
  io.emit('table:status_changed', payload);
  io.emit('table_status', payload);
}

module.exports = router;
