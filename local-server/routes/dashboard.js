/**
 * routes/dashboard.js — Local stats computed from SQLite
 */

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

router.get('/stats', (req, res) => {
  try {
    const db       = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const date     = req.query.date || new Date().toISOString().split('T')[0];

    const where   = branchId ? 'AND branch_id = ?' : '';
    const params  = branchId ? [date, branchId] : [date];

    const revenue = db.prepare(`
      SELECT COALESCE(SUM(total),0) as total, COUNT(*) as orders
      FROM orders WHERE status='completed' AND date(created_at)=? ${where}
    `).get(...params);

    const tables  = db.prepare('SELECT COUNT(*) as total FROM tables' + (branchId ? ' WHERE branch_id=?' : '')).get(...(branchId?[branchId]:[]));
    const occupied= db.prepare("SELECT COUNT(*) as c FROM tables WHERE status='Occupied'" + (branchId ? ' AND branch_id=?' : '')).get(...(branchId?[branchId]:[]));

    const topItems= db.prepare(`
      SELECT oi.name, SUM(oi.qty) as qty, SUM(oi.price*oi.qty) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id=o._id
      WHERE o.status='completed' AND date(o.created_at)=? ${where}
      GROUP BY oi.name ORDER BY qty DESC LIMIT 5
    `).all(...params);

    res.json({
      success: true,
      data: {
        revenue: revenue.total,
        ordersCount: revenue.orders,
        tablesTotal: tables.total,
        tablesOccupied: occupied.c,
        topItems,
        date,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/admin', (req, res) => {
  res.json({ success: true, data: { message: 'Use cloud admin dashboard for multi-branch stats' } });
});

router.get('/dish-summary', (req, res) => {
  try {
    const db       = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const date     = req.query.date || new Date().toISOString().split('T')[0];
    const params   = branchId ? [date, branchId] : [date];
    const where    = branchId ? 'AND o.branch_id=?' : '';

    const items = db.prepare(`
      SELECT oi.name, SUM(oi.qty) as qty, SUM(oi.price*oi.qty) as revenue
      FROM order_items oi JOIN orders o ON oi.order_id=o._id
      WHERE date(o.created_at)=? ${where}
      GROUP BY oi.name ORDER BY qty DESC
    `).all(...params);

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/leakage-logs', (_req, res) => {
  res.json({ success: true, data: [] });
});

module.exports = router;
