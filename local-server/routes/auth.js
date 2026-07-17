/**
 * routes/auth.js — Local authentication
 * On login: tries local SQLite first, then cloud if online.
 * Returns same shape as cloud backend: { token, user }
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { getDb, now } = require('../db');
const { signToken, authMiddleware } = require('../auth-helper');
const { runSync } = require('../sync');

const router = express.Router();

const CLOUD_API = 'https://arabia-mandi-orderingtool-backend.onrender.com/api/v1';

// ─── POST /api/v1/auth/login ─────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const loginId = (username || email || '').trim();
    if (!loginId || !password) {
      return res.status(400).json({ success: false, message: 'Username/Email and password required' });
    }

    const db = getDb();
    let staff = db.prepare(
      'SELECT * FROM staff WHERE (username = ? OR email = ?) AND active = 1'
    ).get(loginId, loginId);

    // If not in staff, check users table
    if (!staff) {
      const userRow = db.prepare(
        'SELECT * FROM users WHERE (email = ? OR _id = ?) AND isActive = 1'
      ).get(loginId, loginId);
      if (userRow) {
        staff = {
          _id: userRow._id,
          branch_id: userRow.branchId || 'BRANCH-QA-100',
          name: userRow.name,
          role: userRow.role || 'Super Admin',
          username: userRow.email,
          password_hash: userRow.password,
          email: userRow.email,
          branchAccess: 'All Branches'
        };
      }
    }

    // ── Try local auth ────────────────────────────────────────────────────
    if (staff && staff.password_hash) {
      const valid = staff.password_hash.startsWith('$2')
        ? bcrypt.compareSync(password.trim(), staff.password_hash)
        : password.trim() === staff.password_hash;

      if (valid) {
        const branch = db.prepare('SELECT * FROM branch_config LIMIT 1').get() || { _id: staff.branch_id };
        const token  = signToken({
          _id:        staff._id,
          staffId:    staff._id,
          branchId:   staff.branch_id || branch?._id || 'BRANCH-QA-100',
          role:       staff.role,
          username:   staff.username,
          name:       staff.name,
          branchAccess: staff.branchAccess || 'Single Branch',
        });

        return res.json({
          success: true,
          data: {
            token,
            user: {
              _id:        staff._id,
              name:       staff.name,
              email:      staff.email || '',
              phone:      staff.phone || '',
              role:       staff.role,
              username:   staff.username,
              branchId:   staff.branch_id || branch?._id || 'BRANCH-QA-100',
              branchAccess: staff.branchAccess || 'Single Branch',
              designation: staff.designation || '',
              employeeCode: staff.employeeCode || '',
            },
          },
        });
      }
      // Wrong password
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // ── No local record — try cloud if online ─────────────────────────────
    try {
      const fetch = require('node-fetch');
      const cloudRes = await fetch(`${CLOUD_API}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: username.trim(), password: password.trim() }),
        timeout: 25000,
      });

      if (!cloudRes.ok) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const json    = await cloudRes.json();
      const cloudData = json?.data || json;
      const { token: cloudToken, user } = cloudData;

      // Cache staff locally for future offline use
      const hash = bcrypt.hashSync(password.trim(), 10);
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO staff
          (_id, branch_id, name, role, username, password_hash, email, phone,
           designation, employeeCode, branchAccess, active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);
      stmt.run(
        user._id, user.branchId || '', user.name, user.role,
        user.username || username.trim(), hash,
        user.email || '', user.phone || '',
        user.designation || '', user.employeeCode || '',
        user.branchAccess || 'Single Branch', now()
      );

      // Store cloud token in branch_config for sync service
      const existingBranch = db.prepare('SELECT _id FROM branch_config LIMIT 1').get();
      if (existingBranch) {
        db.prepare('UPDATE branch_config SET cloud_token = ? WHERE _id = ?').run(cloudToken, existingBranch._id);
      } else {
        db.prepare(`
          INSERT INTO branch_config (_id, name, branchCode, cloud_token, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(user.branchId || 'BR-01', user.branchName || 'Main Branch', 'MAIN', cloudToken, now());
      }

      // Immediately pull master data (menu, tables, categories) so local SQLite is fully primed right away
      await runSync().catch(e => console.warn('[Auth] Post-login sync error:', e.message));

      // Issue a local token (same payload, local secret)
      const localToken = signToken({
        _id:        user._id,
        staffId:    user._id,
        branchId:   user.branchId || '',
        role:       user.role,
        username:   user.username || username,
        name:       user.name,
        branchAccess: user.branchAccess || 'Single Branch',
      });

      return res.json({
        success: true,
        data: { token: localToken, user },
      });
    } catch (cloudErr) {
      console.warn('[Auth] Cloud auth failed, offline?', cloudErr.message);
      return res.status(401).json({
        success: false,
        message: 'No local account found and offline. Please connect to internet for first login.',
      });
    }
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/v1/auth/profile ─────────────────────────────────────────────────
router.get('/profile', authMiddleware, (req, res) => {
  const { _id, name, role, username, branchId, branchAccess } = req.user;
  res.json({
    success: true,
    data: { _id, name, role, username, branchId, branchAccess },
  });
});

// ─── PUT /api/v1/auth/change-password ────────────────────────────────────────
router.put('/change-password', authMiddleware, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db    = getDb();
    const staff = db.prepare('SELECT * FROM staff WHERE _id = ?').get(req.user._id);

    if (!staff || !bcrypt.compareSync(currentPassword, staff.password_hash)) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE staff SET password_hash = ?, updated_at = ? WHERE _id = ?')
      .run(newHash, now(), req.user._id);

    res.json({ success: true, data: { message: 'Password changed successfully' } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
