/**
 * index.js — Local Express + Socket.IO Server
 * Runs inside the Electron main process on port 3001.
 * All routes mirror the cloud backend API structure.
 * Mobiles connect via Socket.IO on the same port.
 */

const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { Server } = require('socket.io');

const { verifyToken, authMiddleware } = require('./auth-helper');
const { getDb, logSync, now }       = require('./db');
const { v4: uuidv4 }                = require('uuid');

// Route modules
const authRoutes          = require('./routes/auth');
const branchRoutes        = require('./routes/branches');
const staffRoutes         = require('./routes/staff');
const sectionRoutes       = require('./routes/sections');
const tableRoutes         = require('./routes/tables');
const menuRoutes          = require('./routes/menu');
const orderRoutes         = require('./routes/orders');
const printerRoutes       = require('./routes/printers');
const dashboardRoutes     = require('./routes/dashboard');
const notificationRoutes  = require('./routes/notifications');
const syncRoutes          = require('./routes/sync-routes');

let io = null;

/** Returns the Socket.IO instance so routes can broadcast events */
function getIO() { return io; }

async function createLocalServer(port) {
  const app        = express();
  const httpServer = http.createServer(app);

  // ── Socket.IO (for mobile waiter clients on LAN) ──────────────────────────
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  io.on('connection', (socket) => {
    console.log('[Socket.IO] Mobile connected:', socket.id);

    // Auto-join branch room if JWT token is passed in socket handshake
    const token = socket.handshake?.auth?.token;
    if (token) {
      try {
        const user = verifyToken(token);
        if (user?.branchId) {
          socket.join(`branch_${user.branchId}`);
          console.log(`[Socket.IO] Client ${socket.id} auto-joined branch_${user.branchId}`);
        }
      } catch (err) {
        console.warn(`[Socket.IO] Handshake auth verification failed for ${socket.id}:`, err.message);
      }
    }

    socket.on('join_branch', ({ branchId }) => {
      if (!branchId) return;
      socket.join(`branch_${branchId}`);
      console.log(`[Socket.IO] Client ${socket.id} joined branch_${branchId}`);
    });

    // Real-time order placement from waiter mobile over LAN
    socket.on('place_order', async (data) => {
      try {
        const db = getDb();
        const _id = data._id || uuidv4();
        const branchId = data.branchId || data.branch_id || '';
        const orderNumber = data.orderNumber || `ORD-${Date.now().toString().slice(-6)}`;
        const subtotal = data.subtotal || 0;
        const tax = data.tax || 0;
        const total = data.total || subtotal + tax;

        db.prepare(`
          INSERT INTO orders (_id, branch_id, table_id, tableNumber, staff_id, orderNumber, orderType, subtotal, tax, discount, total, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          _id, branchId, data.tableId || '', data.tableNumber || '', data.staffId || '',
          orderNumber, data.orderType || 'DineIn', subtotal, tax, data.discount || 0,
          total, data.status || 'active', now(), now()
        );

        if (Array.isArray(data.items)) {
          const insertItem = db.prepare(`
            INSERT INTO order_items (_id, order_id, menuItem_id, name, variantName, price, quantity, notes, kot_sequence, kot_printed, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const item of data.items) {
            insertItem.run(
              uuidv4(), _id, item.menuItemId || item.menuItem_id || '',
              item.name || '', item.variantName || 'Regular',
              item.price || 0, item.quantity || 1, item.notes || '',
              item.kotSequence || 1, item.kotPrinted || 0, now(), now()
            );
          }
        }

        const full = db.prepare('SELECT * FROM orders WHERE _id = ?').get(_id);
        if (full) {
          logSync('orders', _id, 'INSERT', full);
          io.to(`branch_${branchId}`).emit('order_updated', full);
          io.to(`branch_${branchId}`).emit('order:created', full);
          io.to(`branch_${branchId}`).emit('place_order', full);
          io.emit('order_updated', full);
          io.emit('order:created', full);
          io.emit('place_order', full);
        }
      } catch (err) {
        console.error('[Socket.IO] place_order error:', err.message);
      }
    });

    // Real-time KOT ready event handling over LAN
    socket.on('kot_ready', async (data) => {
      try {
        const { orderId, kotId, items, branchId } = data;
        if (orderId) {
          getDb().prepare('UPDATE order_items SET kot_printed = 1, updated_at = ? WHERE order_id = ? AND kot_printed = 0').run(now(), orderId);
        }
        const room = branchId ? `branch_${branchId}` : null;
        if (room) {
          io.to(room).emit('kot_ready', data);
          io.to(room).emit('kot:generated', data);
        }
        io.emit('kot_ready', data);
        io.emit('kot:generated', data);
      } catch (err) {
        console.error('[Socket.IO] kot_ready error:', err.message);
      }
    });

    // Real-time table status update over LAN
    socket.on('table_status', async (data) => {
      try {
        const { tableId, status, branchId } = data;
        if (tableId && status) {
          const db = getDb();
          db.prepare('UPDATE tables SET status = ?, updated_at = ? WHERE _id = ?').run(status, now(), tableId);
          const t = db.prepare('SELECT * FROM tables WHERE _id = ?').get(tableId);
          if (t) {
            logSync('tables', tableId, 'UPDATE', t);
            const payload = {
              _id: t._id, tableId: t._id, status: t.status, currentOrderId: t.current_order_id,
              tableNumber: t.tableNumber, branchId: t.branch_id
            };
            const room = t.branch_id || branchId;
            if (room) {
              io.to(`branch_${room}`).emit('table_updated', payload);
              io.to(`branch_${room}`).emit('table:status_changed', payload);
              io.to(`branch_${room}`).emit('table_status', payload);
            }
            io.emit('table_updated', payload);
            io.emit('table:status_changed', payload);
            io.emit('table_status', payload);
          }
        }
      } catch (err) {
        console.error('[Socket.IO] table_status error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log('[Socket.IO] Mobile disconnected:', socket.id);
    });
  });

  // ── Middleware ─────────────────────────────────────────────────────────────
  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10mb' }));

  // Inject io into requests for route-level broadcasting
  app.use((req, _res, next) => {
    req.io = io;
    next();
  });

  // ── Routes (all under /api/v1 to mirror cloud backend) ────────────────────
  app.use('/api/v1/auth',          authRoutes);
  app.use('/api/v1/branches',      branchRoutes);   // public — needed before login to populate dropdown
  app.use('/api/v1/staff',         authMiddleware, staffRoutes);
  app.use('/api/v1/sections',      authMiddleware, sectionRoutes);
  app.use('/api/v1/tables',        authMiddleware, tableRoutes);
  app.use('/api/v1/menu',          authMiddleware, menuRoutes);
  app.use('/api/v1/orders',        authMiddleware, orderRoutes);
  app.use('/api/v1/printers',      authMiddleware, printerRoutes);
  app.use('/api/v1/dashboard',     authMiddleware, dashboardRoutes);
  app.use('/api/v1/notifications', authMiddleware, notificationRoutes);
  app.use('/api/v1/sync',          syncRoutes);

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => res.json({ ok: true, mode: 'electron-local' }));

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

  // ── Start listening ───────────────────────────────────────────────────────
  await new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  return httpServer;
}

module.exports = { createLocalServer, getIO };
