/**
 * routes/staff.js — Staff CRUD (branch-scoped)
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, logSync, now } = require('../db');

const router = express.Router();

// GET /api/v1/staff
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const branchId = req.query.branchId || req.user?.branchId;
    const list = branchId
      ? db.prepare('SELECT * FROM staff WHERE branch_id = ? ORDER BY name').all(branchId)
      : db.prepare('SELECT * FROM staff ORDER BY name').all();
    res.json({ success: true, data: list.map(formatStaff) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/v1/staff/:id
router.get('/:id', (req, res) => {
  try {
    const s = getDb().prepare('SELECT * FROM staff WHERE _id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: 'Staff not found' });
    res.json({ success: true, data: formatStaff(s) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/staff
router.post('/', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const _id  = body._id || uuidv4();
    const hash = bcrypt.hashSync(body.password || body.pin || 'changeme123', 10);

    db.prepare(`
      INSERT INTO staff (_id, branch_id, name, role, username, password_hash,
        email, phone, designation, employeeCode, branchAccess, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      _id,
      body.branchId || body.branch_id || req.user?.branchId || '',
      body.name, body.role,
      body.username || body.name?.toLowerCase().replace(/\s/g, '.'),
      hash,
      body.email || '', body.phone || '',
      body.designation || '', body.employeeCode || '',
      body.branchAccess || 'Single Branch', now()
    );

    const s = db.prepare('SELECT * FROM staff WHERE _id = ?').get(_id);
    logSync('staff', _id, 'INSERT', formatStaff(s));
    res.status(201).json({ success: true, data: formatStaff(s) });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(400).json({ success: false, message: 'Username already exists' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/v1/staff/:id
router.put('/:id', (req, res) => {
  try {
    const db   = getDb();
    const body = req.body;
    const id   = req.params.id;

    const existing = db.prepare('SELECT * FROM staff WHERE _id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Staff not found' });

    db.prepare(`
      UPDATE staff SET
        name = COALESCE(?, name), role = COALESCE(?, role),
        username = COALESCE(?, username), email = COALESCE(?, email),
        phone = COALESCE(?, phone), designation = COALESCE(?, designation),
        employeeCode = COALESCE(?, employeeCode),
        active = COALESCE(?, active), updated_at = ?
      WHERE _id = ?
    `).run(
      body.name, body.role, body.username, body.email,
      body.phone, body.designation, body.employeeCode,
      body.active !== undefined ? (body.active ? 1 : 0) : null,
      now(), id
    );

    const s = db.prepare('SELECT * FROM staff WHERE _id = ?').get(id);
    logSync('staff', id, 'UPDATE', formatStaff(s));
    res.json({ success: true, data: formatStaff(s) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/v1/staff/:id
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE staff SET active = 0, updated_at = ? WHERE _id = ?')
      .run(now(), req.params.id);
    logSync('staff', req.params.id, 'DELETE', { _id: req.params.id });
    res.json({ success: true, data: { message: 'Staff deactivated' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/v1/staff/:id/reset-password
router.post('/:id/reset-password', (req, res) => {
  try {
    const db       = getDb();
    const newPass  = req.body.newPassword || 'changeme123';
    const newHash  = bcrypt.hashSync(newPass, 10);
    db.prepare('UPDATE staff SET password_hash = ?, updated_at = ? WHERE _id = ?')
      .run(newHash, now(), req.params.id);
    res.json({ success: true, data: { message: 'Password reset to: ' + newPass } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

function formatStaff(s) {
  return {
    _id:         s._id,
    name:        s.name,
    role:        s.role,
    username:    s.username,
    email:       s.email || '',
    phone:       s.phone || '',
    designation: s.designation || '',
    employeeCode:s.employeeCode || '',
    branchId:    s.branch_id,
    branchIds:   [s.branch_id],
    branchAccess:s.branchAccess || 'Single Branch',
    active:      s.active === 1,
  };
}

module.exports = router;
