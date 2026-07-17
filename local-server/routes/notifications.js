/**
 * routes/notifications.js
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, now } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const db       = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const list     = branchId
      ? db.prepare('SELECT * FROM notifications WHERE branch_id=? ORDER BY created_at DESC LIMIT 50').all(branchId)
      : db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/:id/read', (req, res) => {
  try {
    getDb().prepare('UPDATE notifications SET read_status=1 WHERE _id=?').run(req.params.id);
    res.json({ success: true, data: { message: 'Marked read' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM notifications WHERE _id=?').run(req.params.id);
    res.json({ success: true, data: { message: 'Deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
