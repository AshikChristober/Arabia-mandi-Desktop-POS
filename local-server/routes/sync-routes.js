/**
 * routes/sync-routes.js — Sync status endpoint for the UI
 */

const express = require('express');
const { getDb } = require('../db');
const { getSyncStatus } = require('../sync');

const router = express.Router();

router.get('/status', (_req, res) => {
  try {
    const db      = getDb();
    const pending = db.prepare('SELECT COUNT(*) as c FROM sync_log WHERE synced=0').get().c;
    const status  = getSyncStatus();
    res.json({ success: true, data: { ...status, pending, pendingCount: pending } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/upload', async (_req, res) => {
  try {
    const { runSync } = require('../sync');
    await runSync();
    const db = getDb();
    const pending = db.prepare('SELECT COUNT(*) as c FROM sync_log WHERE synced=0').get().c;
    res.json({ success: true, data: { pending, message: 'Immediate sync cycle completed.' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/mark-synced', (req, res) => {
  try {
    const db  = getDb();
    const ids = req.body.ids || [];
    const recordIds = req.body.recordIds || req.body.record_ids || [];
    if (ids.length) {
      db.prepare(`UPDATE sync_log SET synced=1 WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);
    }
    if (recordIds.length) {
      db.prepare(`UPDATE sync_log SET synced=1 WHERE record_id IN (${recordIds.map(()=>'?').join(',')})`).run(...recordIds);
    }
    res.json({ success: true, data: { marked: ids.length + recordIds.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
