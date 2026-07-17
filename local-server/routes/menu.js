/**
 * routes/menu.js — Menu categories and items
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, logSync, now } = require('../db');

const router = express.Router();

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', (req, res) => {
  try {
    const db       = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const list     = branchId
      ? db.prepare('SELECT * FROM categories WHERE branch_id = ? ORDER BY sort_order').all(branchId)
      : db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const db   = getDb();
    const _id  = uuidv4();
    const max  = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM categories').get().m;
    db.prepare('INSERT INTO categories (_id, branch_id, name, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(_id, req.body.branchId || req.user?.branchId, req.body.name, max + 1, now());
    const c = db.prepare('SELECT * FROM categories WHERE _id = ?').get(_id);
    logSync('categories', _id, 'INSERT', c);
    res.status(201).json({ success: true, data: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE categories SET name = ?, updated_at = ? WHERE _id = ?')
      .run(req.body.name, now(), req.params.id);
    const c = db.prepare('SELECT * FROM categories WHERE _id = ?').get(req.params.id);
    if (c) logSync('categories', req.params.id, 'UPDATE', c);
    res.json({ success: true, data: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM categories WHERE _id = ?').run(req.params.id);
    logSync('categories', req.params.id, 'DELETE', { _id: req.params.id });
    res.json({ success: true, data: { message: 'Category deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Menu Items ────────────────────────────────────────────────────────────────

router.get('/items', (req, res) => {
  try {
    const db         = getDb();
    const branchId   = req.query.branchId || req.user?.branchId;
    const categoryId = req.query.categoryId;

    let query = 'SELECT i.*, c.name as categoryName FROM menu_items i LEFT JOIN categories c ON i.category_id = c._id';
    const params = [];
    const where  = [];

    if (branchId)   { where.push('i.branch_id = ?');   params.push(branchId); }
    if (categoryId) { where.push('i.category_id = ?'); params.push(categoryId); }
    if (where.length) query += ' WHERE ' + where.join(' AND ');
    query += ' ORDER BY c.sort_order, i.name';

    const list = db.prepare(query).all(...params);
    res.json({ success: true, data: list.map(formatItem) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/items/:id', (req, res) => {
  try {
    const item = getDb().prepare('SELECT * FROM menu_items WHERE _id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, data: formatItem(item) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/items', (req, res) => {
  try {
    const db   = getDb();
    const _id  = uuidv4();
    const body = req.body;
    db.prepare(`
      INSERT INTO menu_items (_id, branch_id, category_id, name, price, available, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `).run(
      _id,
      body.branchId || req.user?.branchId,
      body.categoryId || body.category_id || '',
      body.name, body.price, now()
    );
    const item = db.prepare('SELECT * FROM menu_items WHERE _id = ?').get(_id);
    logSync('menu_items', _id, 'INSERT', formatItem(item));
    res.status(201).json({ success: true, data: formatItem(item) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/items/:id', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const id   = req.params.id;
    db.prepare(`
      UPDATE menu_items SET
        name        = COALESCE(?, name),
        price       = COALESCE(?, price),
        category_id = COALESCE(?, category_id),
        available   = COALESCE(?, available),
        updated_at  = ?
      WHERE _id = ?
    `).run(body.name, body.price, body.categoryId || body.category_id, body.available !== undefined ? (body.available ? 1 : 0) : null, now(), id);
    const item = db.prepare('SELECT * FROM menu_items WHERE _id = ?').get(id);
    if (item) logSync('menu_items', id, 'UPDATE', formatItem(item));
    res.json({ success: true, data: item ? formatItem(item) : null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/items/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM menu_items WHERE _id = ?').run(req.params.id);
    logSync('menu_items', req.params.id, 'DELETE', { _id: req.params.id });
    res.json({ success: true, data: { message: 'Item deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/items/:id/availability', (req, res) => {
  try {
    const db   = getDb();
    const item = db.prepare('SELECT * FROM menu_items WHERE _id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    const newVal = item.available ? 0 : 1;
    db.prepare('UPDATE menu_items SET available = ?, updated_at = ? WHERE _id = ?')
      .run(newVal, now(), req.params.id);
    const updated = db.prepare('SELECT * FROM menu_items WHERE _id = ?').get(req.params.id);
    logSync('menu_items', req.params.id, 'UPDATE', formatItem(updated));
    res.json({ success: true, data: formatItem(updated) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

function formatItem(i) {
  return {
    _id:         i._id,
    name:        i.name,
    price:       i.price,
    categoryId:  i.category_id,
    categoryName:i.categoryName || '',
    branchId:    i.branch_id,
    available:   i.available === 1,
  };
}

module.exports = router;
