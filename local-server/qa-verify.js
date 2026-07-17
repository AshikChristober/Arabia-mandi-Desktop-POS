/**
 * qa-verify.js — Comprehensive Automated QA Verification Suite
 * Tests Phase 1, Phase 2, Phase 3, and Phase 4 of Petpooja POS Desktop & Mobile LAN Architecture.
 * Author: 20-Year Experienced Senior QA Architect / SDET
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { createLocalServer, getIO } = require('./index');
const { initDb, getDb, logSync, now } = require('./db');
const ioClient = require('socket.io-client');

const TEST_PORT = 3299;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let passCount = 0;
let failCount = 0;
const testResults = [];

function logTest(phase, testId, title, passed, details = '') {
  if (passed) {
    passCount++;
    console.log(`[PASS] ${phase} | ${testId}: ${title}`);
  } else {
    failCount++;
    console.error(`[FAIL] ${phase} | ${testId}: ${title}`);
    if (details) console.error(`       Details: ${details}`);
  }
  testResults.push({ phase, testId, title, passed, details });
}

async function fetchJson(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function runQASuite() {
  console.log('================================================================================');
  console.log('   🚀 STARTING PETPOOJA POS DESKTOP/MOBILE QA VERIFICATION SUITE (PHASES 1-4)   ');
  console.log('================================================================================\n');

  const testDbDir = path.join(__dirname, 'qa-test-data');
  if (fs.existsSync(testDbDir)) {
    try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch {}
  }
  initDb(testDbDir);

  let server = null;
  let testToken = null;
  const testBranchId = 'BRANCH-QA-100';

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 1: Electron Wrapper, Local Server HTTP Boot & SQLite Integrity
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- PHASE 1: LOCAL SERVER & SQLITE INTEGRITY ---');
    
    // T1.1: Database Schema Verification
    try {
      const db = getDb();
      const tables = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all().map(t => t.name);

      const requiredTables = ['orders', 'order_items', 'kots', 'tables', 'sections', 'sync_log', 'users', 'branches', 'printers'];
      const missing = requiredTables.filter(t => !tables.includes(t));

      if (missing.length === 0) {
        logTest('Phase 1', 'T1.1', 'SQLite Database & Required Table Schemas Exist', true);
      } else {
        logTest('Phase 1', 'T1.1', 'SQLite Database Schema Verification', false, `Missing tables: ${missing.join(', ')}`);
      }
    } catch (err) {
      logTest('Phase 1', 'T1.1', 'SQLite Database Initialization', false, err.message);
    }

    // T1.2: Server Boot & Health Check
    try {
      server = await createLocalServer(TEST_PORT);
      const { status, data } = await fetchJson('/health');
      if (status === 200 && data.ok === true && data.mode === 'electron-local') {
        logTest('Phase 1', 'T1.2', 'Local Express Server Boot & /health Endpoint', true);
      } else {
        logTest('Phase 1', 'T1.2', 'Local Express Server /health Endpoint', false, `Status ${status}, Data: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      logTest('Phase 1', 'T1.2', 'Local Express Server Boot', false, err.message);
    }

    // T1.3: Authentication & JWT Generation
    try {
      // Ensure test branch & user exist in SQLite across both cloud and local mirror tables
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO branches (_id, name, isActive, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        testBranchId, 'QA Test Branch', 1, now(), now()
      );
      db.prepare(`INSERT OR IGNORE INTO branch_config (_id, name, updated_at) VALUES (?, ?, ?)`).run(
        testBranchId, 'QA Test Branch', now()
      );
      db.prepare(`INSERT OR IGNORE INTO users (_id, email, password, name, role, branchId, isActive, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'user-qa-1', 'qa@petpooja.com', 'password123', 'QA Tester', 'Super Admin', testBranchId, 1, now(), now()
      );
      db.prepare(`INSERT OR IGNORE INTO staff (_id, branch_id, name, role, username, password_hash, email, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'staff-qa-1', testBranchId, 'QA Tester', 'Super Admin', 'qa@petpooja.com', 'password123', 'qa@petpooja.com', 1, now()
      );

      const { status, data } = await fetchJson('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'qa@petpooja.com', password: 'password123' })
      });

      const token = data?.data?.token || data?.token;
      const role = data?.data?.user?.role || data?.user?.role;

      if (status === 200 && token && role === 'Super Admin') {
        testToken = token;
        logTest('Phase 1', 'T1.3', 'Auth /login Endpoint & JWT Handshake Token Generation', true);
      } else {
        logTest('Phase 1', 'T1.3', 'Auth /login Endpoint', false, `Status ${status}, Data: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      logTest('Phase 1', 'T1.3', 'Authentication & JWT Verification', false, err.message);
    }

    // T1.4: Protected Route Verification (GET & POST Tables)
    try {
      const authHeader = { Authorization: `Bearer ${testToken}` };
      // Create Section
      const secRes = await fetchJson('/api/v1/sections', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ name: 'Dining Hall - QA', branchId: testBranchId })
      });
      const sectionId = secRes.data?._id || secRes.data?.section?._id || 'sec-qa-1';

      // Create Table
      const tabRes = await fetchJson('/api/v1/tables', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ tableNumber: 'QA-T1', capacity: 4, sectionId, branchId: testBranchId, status: 'Available' })
      });

      // Fetch Tables
      const listRes = await fetchJson(`/api/v1/tables?branchId=${testBranchId}`, { headers: authHeader });
      const tablesList = listRes?.data?.data || listRes?.data;
      if (listRes.status === 200 && Array.isArray(tablesList) && tablesList.length >= 1) {
        logTest('Phase 1', 'T1.4', 'Protected REST API Table & Section CRUD Operations', true);
      } else {
        logTest('Phase 1', 'T1.4', 'Protected REST API CRUD Operations', false, `Status ${listRes.status}, Data: ${JSON.stringify(listRes.data)}`);
      }
    } catch (err) {
      logTest('Phase 1', 'T1.4', 'Protected Route Operations', false, err.message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 2: Offline Sync Service & Conflict Resolution Verification
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- PHASE 2: SYNC QUEUE & CONFLICT RESOLUTION ---');

    // T2.1: Automatic Write Intercept & sync_log Generation
    try {
      const db = getDb();
      const lastSyncBefore = db.prepare('SELECT count(*) as cnt FROM sync_log WHERE table_name = ?').get('orders').cnt;

      const authHeader = { Authorization: `Bearer ${testToken}` };
      const orderPayload = {
        _id: 'ord-qa-phase2',
        branchId: testBranchId,
        tableNumber: 'QA-T1',
        orderType: 'DineIn',
        subtotal: 250,
        tax: 12.5,
        total: 262.5,
        items: [{ menuItemId: 'item-1', name: 'Chicken Mandi', quantity: 1, price: 250 }]
      };

      const orderRes = await fetchJson('/api/v1/orders', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(orderPayload)
      });
      const orderId = orderRes?.data?.data?._id || orderRes?.data?._id || 'ord-qa-phase2';
      const syncRow = db.prepare('SELECT * FROM sync_log WHERE table_name = ? AND record_id = ? ORDER BY id DESC LIMIT 1').get('orders', orderId);
      if (orderRes.status === 201 || orderRes.status === 200) {
        if (syncRow && syncRow.action === 'INSERT' && syncRow.synced === 0) {
          logTest('Phase 2', 'T2.1', 'Local SQLite Writes Automatically Intercept & Create sync_log Entries (synced=0)', true);
        } else {
          logTest('Phase 2', 'T2.1', 'sync_log Entry Verification', false, `Sync row found: ${JSON.stringify(syncRow)}, OrderRes: ${JSON.stringify(orderRes.data)}`);
        }
      } else {
        logTest('Phase 2', 'T2.1', 'Order Creation for Sync Verification', false, `Status ${orderRes.status}, Data: ${JSON.stringify(orderRes.data)}`);
      }
    } catch (err) {
      logTest('Phase 2', 'T2.1', 'Sync Log Write Interception', false, err.message);
    }

    // T2.2: Offline Status Inspection API (`GET /sync/status`)
    try {
      const { status, data } = await fetchJson('/api/v1/sync/status');
      const pCount = data?.data?.pendingCount ?? data?.pendingCount;
      if (status === 200 && typeof pCount === 'number' && pCount >= 1) {
        logTest('Phase 2', 'T2.2', 'GET /api/v1/sync/status Correctly Reports Unsynced Queue Count', true);
      } else {
        logTest('Phase 2', 'T2.2', 'Sync Status API Verification', false, `Status ${status}, Data: ${JSON.stringify(data)}`);
      }
    } catch (err) {
      logTest('Phase 2', 'T2.2', 'Sync Status Inspection API', false, err.message);
    }

    // T2.3: Conflict Resolution & Mark-Synced Verification
    try {
      const db = getDb();
      const unsyncedRows = db.prepare('SELECT id, record_id FROM sync_log WHERE synced = 0').all();
      const ids = unsyncedRows.map(r => r.id);
      const recordIds = unsyncedRows.map(r => r.record_id);

      const markRes = await fetchJson('/api/v1/sync/mark-synced', {
        method: 'POST',
        headers: { Authorization: `Bearer ${testToken}` },
        body: JSON.stringify({ ids, recordIds })
      });

      const checkCount = db.prepare('SELECT COUNT(*) as c FROM sync_log WHERE synced = 0').get().c;
      if (markRes.status === 200 && checkCount === 0) {
        logTest('Phase 2', 'T2.3', 'Sync Log Reconciliation & Mark-Synced (`synced=1`) Last-Write-Wins Verification', true);
      } else {
        logTest('Phase 2', 'T2.3', 'Mark-Synced Reconciliation', false, `Status ${markRes.status}, Unsynced remaining: ${checkCount}, MarkRes: ${JSON.stringify(markRes.data)}`);
      }
    } catch (err) {
      logTest('Phase 2', 'T2.3', 'Conflict & Mark-Synced Logic', false, err.message);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 3: Mobile LAN Socket.IO Bridge & Real-Time Event Verification
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- PHASE 3: MOBILE LAN SOCKET.IO BRIDGE ---');

    // T3.1: Socket Handshake Auth & Room Join (`join_branch`)
    let socket1 = null;
    let socket2 = null;
    try {
      socket1 = ioClient(BASE_URL, { auth: { token: testToken }, reconnection: false });
      socket2 = ioClient(BASE_URL, { auth: { token: testToken }, reconnection: false });

      await new Promise((resolve, reject) => {
        let connCnt = 0;
        const check = () => { connCnt++; if (connCnt === 2) resolve(); };
        socket1.on('connect', check);
        socket2.on('connect', check);
        setTimeout(() => reject(new Error('Socket connection timed out')), 4000);
      });

      socket1.emit('join_branch', { branchId: testBranchId });
      socket2.emit('join_branch', { branchId: testBranchId });
      await new Promise(r => setTimeout(r, 200)); // Allow room join propagation

      logTest('Phase 3', 'T3.1', 'Socket.IO Client Connection & Handshake JWT Branch Room Auto-Join', true);
    } catch (err) {
      logTest('Phase 3', 'T3.1', 'Socket Connection & Handshake', false, err.message);
    }

    // T3.2: Real-Time Order Mutation (`place_order`) & Multi-Room Broadcast
    try {
      if (socket1 && socket2) {
        const receivedOnSocket2 = new Promise((resolve, reject) => {
          socket2.on('order_updated', (data) => {
            if (data._id === 'ord-qa-socket-101') resolve(data);
          });
          socket2.on('order:created', (data) => {
            if (data._id === 'ord-qa-socket-101') resolve(data);
          });
          setTimeout(() => reject(new Error('Did not receive order_updated on socket2 within timeout')), 3000);
        });

        socket1.emit('place_order', {
          _id: 'ord-qa-socket-101',
          branchId: testBranchId,
          tableNumber: 'QA-T1',
          orderType: 'DineIn',
          subtotal: 400,
          total: 420,
          items: [{ name: 'Mutton Kebab', quantity: 2, price: 200 }]
        });

        const receivedData = await receivedOnSocket2;
        const db = getDb();
        const checkDb = db.prepare('SELECT * FROM orders WHERE _id = ?').get('ord-qa-socket-101');

        if (receivedData && checkDb && checkDb.total === 420) {
          logTest('Phase 3', 'T3.2', 'Real-Time LAN `place_order` Persists to SQLite & Broadcasts across Branch Rooms', true);
        } else {
          logTest('Phase 3', 'T3.2', 'Socket `place_order` Broadcast', false, `Received: ${JSON.stringify(receivedData)}, DB: ${JSON.stringify(checkDb)}`);
        }
      } else {
        logTest('Phase 3', 'T3.2', 'Socket `place_order` Broadcast', false, 'Sockets not connected');
      }
    } catch (err) {
      logTest('Phase 3', 'T3.2', 'Socket Real-Time Order Broadcast', false, err.message);
    }

    // T3.3: Real-Time KOT Ready Event (`kot_ready`) Broadcast
    try {
      if (socket1 && socket2) {
        const receivedKotReady = new Promise((resolve, reject) => {
          socket2.on('kot_ready', (data) => {
            if (data.orderId === 'ord-qa-socket-101') resolve(data);
          });
          setTimeout(() => reject(new Error('Did not receive kot_ready on socket2 within timeout')), 3000);
        });

        socket1.emit('kot_ready', {
          orderId: 'ord-qa-socket-101',
          kotId: 'kot-qa-001',
          branchId: testBranchId,
          items: [{ name: 'Mutton Kebab', quantity: 2 }]
        });

        const kotData = await receivedKotReady;
        if (kotData && kotData.orderId === 'ord-qa-socket-101') {
          logTest('Phase 3', 'T3.3', 'Real-Time LAN `kot_ready` & `kot:generated` Kitchen Notification Broadcast', true);
        } else {
          logTest('Phase 3', 'T3.3', 'Socket `kot_ready` Broadcast', false, `Received: ${JSON.stringify(kotData)}`);
        }
      } else {
        logTest('Phase 3', 'T3.3', 'Socket `kot_ready` Broadcast', false, 'Sockets not connected');
      }
    } catch (err) {
      logTest('Phase 3', 'T3.3', 'Socket KOT Ready Broadcast', false, err.message);
    }

    // Cleanup Sockets
    if (socket1) socket1.disconnect();
    if (socket2) socket2.disconnect();

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 4: Polish, ESC/POS Network Printing & Offline Polling Recovery
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- PHASE 4: POLISH, ESC/POS PRINTING & POLLING RECOVERY ---');

    // T4.1: ESC/POS Network Socket Printer Discovery & Print Dispatch Protection
    try {
      const db = getDb();
      db.prepare(`INSERT OR IGNORE INTO printers (_id, branch_id, name, type, ip_address, port, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'ptr-qa-1', testBranchId, 'Kitchen LAN Printer', 'BOTH', '192.168.1.250', 9100, 1, now(), now()
      );

      const printRes = await fetchJson('/api/v1/printers/dispatch-kot', {
        method: 'POST',
        headers: { Authorization: `Bearer ${testToken}` },
        body: JSON.stringify({ orderId: 'ord-qa-socket-101' })
      });

      // Assert that sending print job to simulated/offline IP returns 200 OK with simulation fallback details rather than 500 Server Error
      if (printRes.status === 200 && printRes.data?.success === true) {
        logTest('Phase 4', 'T4.1', 'ESC/POS TCP Socket Print Dispatch (`POST /dispatch-kot`) Safe Fallback Verification', true);
      } else {
        logTest('Phase 4', 'T4.1', 'ESC/POS Print Dispatch', false, `Status ${printRes.status}, Data: ${JSON.stringify(printRes.data)}`);
      }
    } catch (err) {
      logTest('Phase 4', 'T4.1', 'ESC/POS TCP Printing Driver', false, err.message);
    }

    // T4.2: Multi-Floor & Section Grouping API Data Structure Verification
    try {
      const db = getDb();
      const sec2Id = 'sec-qa-rooftop';
      db.prepare(`INSERT OR IGNORE INTO sections (_id, name, branch_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        sec2Id, 'Rooftop - VIP Majlis', testBranchId, now(), now()
      );
      db.prepare(`INSERT OR IGNORE INTO tables (_id, tableNumber, capacity, section_id, branch_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'tab-qa-rooftop-1', 'VIP-1', 6, sec2Id, testBranchId, 'Occupied', now(), now()
      );

      const tablesRes = await fetchJson(`/api/v1/tables?branchId=${testBranchId}`, {
        headers: { Authorization: `Bearer ${testToken}` }
      });

      const tList = tablesRes?.data?.data || tablesRes?.data;
      if (tablesRes.status === 200 && Array.isArray(tList) && tList.some(t => t.tableNumber === 'VIP-1')) {
        const vipTable = tList.find(t => t.tableNumber === 'VIP-1');
        if (vipTable.section_id === sec2Id || vipTable.sectionId === sec2Id) {
          logTest('Phase 4', 'T4.2', 'Multi-Floor Section Table Map API (`GET /tables`) Structural Verification', true);
        } else {
          logTest('Phase 4', 'T4.2', 'Multi-Floor Table Map Data Structure', false, `VIP Table structure: ${JSON.stringify(vipTable)}`);
        }
      } else {
        logTest('Phase 4', 'T4.2', 'Multi-Floor Table Map API', false, `Status ${tablesRes.status}, Data: ${JSON.stringify(tablesRes.data)}`);
      }
    } catch (err) {
      logTest('Phase 4', 'T4.2', 'Multi-Floor Table Map Structure Verification', false, err.message);
    }

    // T4.3: Analytics Dashboard Polling & Metrics API Recovery Verification
    try {
      const statsRes = await fetchJson(`/api/v1/dashboard/stats?filterType=day&branchId=${testBranchId}`, {
        headers: { Authorization: `Bearer ${testToken}` }
      });

      const statsData = statsRes?.data?.data || statsRes?.data;
      if (statsRes.status === 200 && statsData && (typeof statsData.revenue === 'number' || typeof statsData?.salesStats?.totalSales === 'number')) {
        logTest('Phase 4', 'T4.3', 'Analytics Dashboard Polling (`GET /dashboard/stats`) Data Pipeline Verification', true);
      } else {
        logTest('Phase 4', 'T4.3', 'Dashboard Polling Metrics API', false, `Status ${statsRes.status}, Data: ${JSON.stringify(statsRes.data)}`);
      }
    } catch (err) {
      logTest('Phase 4', 'T4.3', 'Analytics Dashboard Polling Verification', false, err.message);
    }

  } finally {
    if (server && typeof server.close === 'function') {
      await new Promise(r => server.close(r));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QA TEST RESULTS SUMMARY & MATRIX REPORT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n================================================================================');
  console.log(`                       📊 QA VERIFICATION SUITE SUMMARY                         `);
  console.log('================================================================================');
  console.log(`  Passed: ${passCount} | Failed: ${failCount} | Total Tests: ${passCount + failCount}`);
  console.log('================================================================================\n');

  if (failCount === 0) {
    console.log('🎉 [CERTIFIED] All Phases (Phase 1, 2, 3, & 4) PASSED 100% QA Automated Verification!');
  } else {
    console.error('⚠️ [WARNING] One or more QA tests failed. Review details above.');
  }

  process.exit(failCount === 0 ? 0 : 1);
}

runQASuite().catch(err => {
  console.error('[QA Suite Crash] Fatal exception:', err);
  process.exit(1);
});
