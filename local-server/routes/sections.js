/**
 * routes/sections.js — Dining sections (Dining Hall, Rooftop, etc.)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, logSync, now } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const list = branchId
      ? db.prepare('SELECT * FROM sections WHERE branch_id = ?').all(branchId)
      : db.prepare('SELECT * FROM sections').all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const db  = getDb();
    const _id = uuidv4();
    db.prepare('INSERT INTO sections (_id, branch_id, name, updated_at) VALUES (?, ?, ?, ?)')
      .run(_id, req.body.branchId || req.user?.branchId, req.body.name, now());
    const s = db.prepare('SELECT * FROM sections WHERE _id = ?').get(_id);
    logSync('sections', _id, 'INSERT', s);
    res.status(201).json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE sections SET name = ?, updated_at = ? WHERE _id = ?')
      .run(req.body.name, now(), req.params.id);
    const s = db.prepare('SELECT * FROM sections WHERE _id = ?').get(req.params.id);
    if (s) logSync('sections', req.params.id, 'UPDATE', s);
    res.json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM sections WHERE _id = ?').run(req.params.id);
    logSync('sections', req.params.id, 'DELETE', { _id: req.params.id });
    res.json({ success: true, data: { message: 'Section deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
