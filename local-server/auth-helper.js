/**
 * auth-helper.js — JWT helpers for the local Express server
 * Uses a local secret so tokens work fully offline.
 */

const jwt = require('jsonwebtoken');

const LOCAL_SECRET = 'petpooja-local-offline-jwt-secret-2024';
const TOKEN_EXPIRY  = '24h';

function signToken(payload) {
  return jwt.sign(payload, LOCAL_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  return jwt.verify(token, LOCAL_SECRET);
}

/**
 * Express middleware — validates Bearer token and attaches req.user
 */
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { signToken, verifyToken, authMiddleware };
