/**
 * preload.js — Electron Preload Script
 * Runs in renderer context with Node access.
 * Exposes safe APIs to React via contextBridge.
 *
 * CRITICAL: window.__ELECTRON_LOCAL_API__ makes api.service.ts
 * redirect all calls to the local Express server on port 3001
 * instead of the cloud backend. This variable is UNDEFINED in
 * the browser, so production web behaviour is completely unchanged.
 */

const { contextBridge, ipcRenderer } = require('electron');

// ── Core: redirect React API calls to local server ──────────────────────────
contextBridge.exposeInMainWorld('__ELECTRON_LOCAL_API__', 'http://localhost:3001/api/v1');

// ── Electron helper APIs exposed to React ────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  /** Returns this machine's LAN IP (shown in UI so mobiles can connect) */
  getLocalIP: () => ipcRenderer.invoke('get-local-ip'),

  /** Returns sync status: { lastSyncAt, pendingCount, isSyncing } */
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),

  /** Whether we are running inside Electron */
  isElectron: true,
});
