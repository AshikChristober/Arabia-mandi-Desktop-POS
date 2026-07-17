import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Staff,
  UserRole,
  Branch,
  Section,
  Table,
  MenuCategory,
  MenuItem,
  ActiveOrder,
  Notification,
  SyncQueueItem,
  Printer,
} from '../types/erp.types';
import { MOCK_STAFF } from '../constants/mockData';
import {
  authApi,
  branchApi,
  staffApi,
  tableApi,
  menuApi,
  printerApi,
  setToken,
  clearToken,
} from '../services/api.service';

export interface ERPState {
  currentUser: Staff | null;
  activeRole?: UserRole;
  isAuthenticated: boolean;
  activeScreen: string;
  previousScreenBeforePrinterRouting?: string;
  printerMappingPrinterId: string | null;
  posViewMode?: 'TABLES' | 'ORDERING';
  showLiveOrdersOnly: boolean;
  branches: Branch[];
  currentBranch: Branch;
  branchFilterId: string;
  sections: Section[];
  tables: Table[];
  selectedTableId: string;
  categories: MenuCategory[];
  selectedCategory: string;
  menuItems: MenuItem[];
  searchQuery: string;
  activeOrders: Record<string, ActiveOrder>;
  notifications: Notification[];
  isOfflineMode: boolean;
  syncQueue: SyncQueueItem[];
  isSyncing: boolean;
  staffList: Staff[];

  printModal: { isOpen: boolean; type?: string; data?: any; orderData?: any; kotData?: any; [key: string]: any };
  reservationModal: { isOpen: boolean; tableId?: string };
  mergeTableModal: { isOpen: boolean; tableId?: string };

  login: (pin: string, role?: UserRole) => boolean;
  loginWithApi: (pin: string, role?: any) => Promise<boolean>;
  logout: () => void;
  setActiveScreen: (screen: string) => void;
  openPrinterRouting: (printerId: string) => void;
  closePrinterRouting: () => void;
  setShowLiveOrdersOnly: (val: boolean) => void;
  setBranchFilterId: (branchId: string) => void;
  setCurrentBranch: (branchId: string) => void;
  setSelectedTable: (tableId: string) => void;
  setPosViewMode: (mode: 'TABLES' | 'ORDERING') => void;
  setSelectedCategory: (categoryId: string) => void;
  setSearchQuery: (query: string) => void;
  setOfflineMode: (offline: boolean) => void;

  fetchBranches: () => Promise<void>;
  fetchTables: (branchId?: string) => Promise<void>;
  fetchMenuData: (branchId?: string) => Promise<void>;
  fetchStaffList: () => Promise<void>;
  fetchPrinters: (branchId?: string) => Promise<void>;
  scanLANPrinters: () => Promise<Printer[]>;
  printers: Printer[];
  discoveredPrinters: Printer[];
  addPrinter: (printer: Partial<Printer>) => Promise<Printer>;
  updatePrinter: (id: string, updates: Partial<Printer>) => Promise<Printer>;
  deletePrinter: (id: string) => Promise<void>;
  testPrintJob: (printerId: string) => Promise<boolean>;
  printKOTBySection: (kot: any, tableId: string) => Promise<void>;
  addBranch: (branch: Partial<Branch>) => Promise<Branch>;
  updateBranch: (idOrBranch: any, updates?: any) => Promise<Branch>;
  deleteBranch: (id: string) => Promise<void>;
  toggleBranchStatus: (id: string) => void;

  addTable: (table: Partial<Table>) => void;
  updateTableStatus: (tableId: string, status: any) => void;
  updateTableName: (tableId: string, tableNumber: string) => Promise<void>;
  updateTableDetails: (tableId: string, data: { tableNumber?: string; capacity?: number }) => Promise<void>;
  openReservationModal: (tableId: string) => void;
  closeReservationModal: () => void;
  createReservation: (...args: any[]) => void;
  unreserveTable: (tableId: string) => void;
  checkExpiredReservations: () => void;
  openMergeModal: (tableId: string) => void;
  closeMergeModal: () => void;
  mergeTables: (sourceId: string, targetId: string) => void;
  separateTables: (tableId: string) => void;

  toggleMenuItemAvailability: (itemId: string) => void;
  addMenuItem: (item: Partial<MenuItem>) => void;
  updateMenuItem: (id: string, updates: Partial<MenuItem>) => Promise<void>;
  deleteMenuItem: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<MenuCategory>;

  openPrintModal: (type?: string, data?: any) => void;
  closePrintModal: () => void;

  addItemToOrder: (item: MenuItem, variantIdx: number, addons?: any[], notes?: string) => void;
  updateOrderItemQty: (itemIdx: number, delta: number) => void;
  removeOrderItem: (itemIdx: number) => void;
  holdOrder: (tableId?: string) => void;
  cancelOrder: () => void;
  generateKOT: (withPrint?: boolean) => void;
  isSettling: boolean;
  settlementError: string | null;
  settlementSuccess: string | null;
  settleOrder: (payment: { cash: number; card: number; upi: number; other?: number }) => Promise<void>;
  // Legacy aliases kept for backwards compat — both delegate to settleOrder
  generateBill: () => void;
  processPayment: (payment?: { cash?: number; card?: number; upi?: number; other?: number }) => void;

  markNotificationRead: (id: string) => void;
  triggerSyncQueue: () => void;
  checkSyncStatus: () => Promise<void>;

  addUser: (user: Partial<Staff>) => void;
  updateUser: (id?: any, updates?: any) => void;
  deleteUser: (id: string) => void;
  resetUserPassword: (id: string) => void;
}

// API base is handled by api.service.ts

/**
 * Reconstructs kotPrinted flags on order items by cross-checking existing KOTs.
 * Uses menuItemId for matching — NOT item._id — because Mongoose assigns new
 * subdocument _ids to items copied into kots[].items, so _id comparison fails.
 */
function reconstructKotPrinted(order: any): any {
  if (!order?.kots?.length || !order?.items?.length) return order;

  // Collect all menuItemIds that appear in any previous KOT
  const alreadyPrintedMenuIds = new Set<string>();
  for (const kot of order.kots) {
    for (const kotItem of kot.items || []) {
      const menuId = String(kotItem.menuItemId || '');
      if (menuId && menuId !== 'undefined') alreadyPrintedMenuIds.add(menuId);
    }
  }

  const updatedItems = order.items.map((item: any) => {
    if (item.kotPrinted) return item; // already flagged, skip
    const menuId = String(item.menuItemId || '');
    return alreadyPrintedMenuIds.has(menuId) ? { ...item, kotPrinted: true } : item;
  });

  return { ...order, items: updatedItems };
}

const syncOrderToBackend = async (order: any, get: any) => {

  try {
    const { orderApi } = await import('../services/api.service');
    const branch = get().currentBranch;
    const table = get().tables.find((t: any) => t._id === order.tableId);
    
    const res = await orderApi.syncLocal({
      ...order,
      branchId: order.branchId || branch?._id,
      tableNumber: order.tableNumber || table?.tableNumber || 'TBL',
      staffId: order.staffId || get().currentUser?._id,
    });
    if (res?._id && get().activeOrders[order.tableId]) {
      useERPStore.setState((state) => {
        const current = state.activeOrders[order.tableId];
        if (!current) return state;
        return {
          activeOrders: {
            ...state.activeOrders,
            [order.tableId]: {
              ...current,
              _id: res._id,
              dbOrderId: res._id,
            },
          },
        };
      });
    }
  } catch (err) {
    console.error('Failed to sync local order to backend:', err);
  }
};

export const useERPStore = create<ERPState>()(
  persist(
    (set, get) => ({
  currentUser: null,
  activeRole: undefined,
  isAuthenticated: false,
  activeScreen: 'POS_WORKSPACE',
  previousScreenBeforePrinterRouting: undefined,
  printerMappingPrinterId: null,
  posViewMode: 'TABLES',
  showLiveOrdersOnly: false,
  branches: [],
  currentBranch: { _id: '', name: '', branchCode: '', address: '', phone: '', gst: '', taxes: { cgst: 0, sgst: 0, serviceCharge: 0 }, timings: '', status: 'Active' as const },
  branchFilterId: 'ALL',
  sections: [],
  tables: [],
  selectedTableId: '',
  categories: [],
  selectedCategory: 'ALL',
  menuItems: [],
  searchQuery: '',
  activeOrders: {},
  notifications: [
    {
      id: 'n1',
      type: 'info',
      title: 'System Initialized',
      message: 'Arabia Mandi POS & Admin environment loaded successfully.',
      timestamp: 'Just now',
      read: false,
    },
  ],
  isOfflineMode: false,
  syncQueue: [],
  isSyncing: false,
  isSettling: false,
  settlementError: null,
  settlementSuccess: null,
  staffList: MOCK_STAFF,
  printers: [],
  discoveredPrinters: [],

  printModal: { isOpen: false },
  reservationModal: { isOpen: false },
  mergeTableModal: { isOpen: false },

  login: (credential1: string, credential2?: any) => {
    const staffList = get().staffList;
    // 1. Try matching by username/email/pin + password/role
    let staff = staffList.find(
      (s) =>
        (s.username === credential1 || s.email === credential1 || s.pin === credential1) &&
        (!credential2 || s.password === credential2 || s.role === credential2)
    );
    // 2. Try matching username/email/pin alone
    if (!staff) {
      staff = staffList.find(
        (s) => s.username === credential1 || s.email === credential1 || s.pin === credential1
      );
    }
    // 3. Try matching role directly
    if (!staff) {
      staff = staffList.find((s) => s.role === credential1);
    }
    // 4. Default fallbacks if exact string passed
    if (!staff && credential1?.toLowerCase().includes('admin')) {
      staff = staffList.find((s) => s.role === 'Super Admin');
    }
    if (!staff && credential1?.toLowerCase().includes('tariq')) {
      staff = staffList.find((s) => s.role === 'Receptionist');
    }

    if (staff) {
      set({
        currentUser: staff,
        activeRole: staff.role,
        isAuthenticated: true,
        activeScreen: staff.role === 'Super Admin' ? 'ADMIN_ANALYTICS' : 'POS_WORKSPACE',
      });
      return true;
    }
    return false;
  },

  loginWithApi: async (username: string, password: string) => {
    try {
      const cleanUser = (username || '').trim();
      const cleanPass = (password || '').trim();
      const result = await authApi.login(cleanUser, cleanPass);
      const { token, user } = result;
      setToken(token);
      // Map backend user to Staff shape
      const staffObj: Staff = {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        role: user.role as UserRole,
        pin: '',
        branchIds: user.branchAccess === 'All Branches' ? ['ALL'] : [user.branchId],
        active: true,
        username: cleanUser,
        employeeCode: user.employeeCode || '',
        designation: user.designation,
        branchAccess: user.branchAccess,
      };
      set({
        currentUser: staffObj,
        activeRole: user.role as UserRole,
        isAuthenticated: true,
        activeScreen: user.role === 'Super Admin' ? 'ADMIN_ANALYTICS' : 'POS_WORKSPACE',
      });
      // Hydrate branch-scoped data — always pass branchId so data is isolated per branch
      const bId = user.branchId as string | undefined;
      get().fetchBranches();
      get().fetchTables(bId);
      get().fetchMenuData(bId);   // ← scoped menu
      get().fetchStaffList();
      get().fetchPrinters(bId);   // ← must pass branchId to avoid cross-branch leakage
      return true;
    } catch (err: any) {
      throw err;
    }
  },

  logout: () => {
    clearToken();
    localStorage.removeItem('petpooja_erp_session');
    set({
      isAuthenticated: false,
      currentUser: null,
      activeRole: undefined,
      activeScreen: 'POS_WORKSPACE',
      previousScreenBeforePrinterRouting: undefined,
      printerMappingPrinterId: null,
      // ── Clear ALL branch-scoped data so it never leaks into the next session ──
      printers: [],
      discoveredPrinters: [],
      tables: [],
      sections: [],
      activeOrders: {},
      selectedTableId: '',
    });
  },

  setActiveScreen: (screen) => set({ activeScreen: screen }),
  openPrinterRouting: (printerId) =>
    set((state) => ({
      printerMappingPrinterId: printerId,
      previousScreenBeforePrinterRouting:
        state.activeScreen === 'PRINTER_ROUTING'
          ? state.previousScreenBeforePrinterRouting || 'POS_WORKSPACE'
          : state.activeScreen,
      activeScreen: 'PRINTER_ROUTING',
    })),
  closePrinterRouting: () =>
    set((state) => ({
      activeScreen: state.previousScreenBeforePrinterRouting || 'POS_WORKSPACE',
      previousScreenBeforePrinterRouting: undefined,
      printerMappingPrinterId: null,
    })),

  setBranchFilterId: (branchId) => {
    if (branchId !== 'ALL') {
      const b = get().branches.find((br) => br._id === branchId);
      if (b) {
        set({ branchFilterId: branchId, currentBranch: b });
        // Reload ALL branch-scoped data for the newly selected branch
        get().fetchTables(branchId);
        get().fetchPrinters(branchId);
        get().fetchMenuData();
        return;
      }
    }
    set({ branchFilterId: branchId });
  },

  setCurrentBranch: (branchId) => {
    const b = get().branches.find((br) => br._id === branchId) || get().branches[0];
    set({ currentBranch: b, branchFilterId: branchId });
    // Reload ALL branch-scoped data for the new branch
    get().fetchTables(branchId);
    get().fetchPrinters(branchId);
    get().fetchMenuData();
  },

  setSelectedTable: (tableId) => set({ selectedTableId: tableId }),
  setPosViewMode: (mode) => set({ posViewMode: mode }),
  setShowLiveOrdersOnly: (val) => set({ showLiveOrdersOnly: val }),
  setSelectedCategory: (categoryId) => set({ selectedCategory: categoryId }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setOfflineMode: (offline) => set({ isOfflineMode: offline }),

  fetchBranches: async () => {
    // Retry up to 5 times — handles Render cloud cold-start (can take 30s+)
    // and the local Electron server still booting on first launch
    const delays = [0, 2000, 5000, 10000, 20000];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) {
        await new Promise(r => setTimeout(r, delays[attempt]));
      }
      try {
        const data = await branchApi.getAll();
        const list = Array.isArray(data) ? data : (data?.data || data?.branches || []);
        if (list.length > 0) {
          const current = get().currentBranch;
          const updatedCurrent = list.find((b: any) => b._id === current?._id) || list[0] || null;
          set({ branches: list, currentBranch: updatedCurrent });
          return; // success — stop retrying
        }
      } catch {
        // network error or local server not ready yet — retry
      }
    }
    // All retries exhausted — keep whatever was already in state
  },

  fetchTables: async (branchId?: string) => {
    try {
      const data = await tableApi.getAll(branchId);
      const list = Array.isArray(data) ? data : (data?.data || data?.tables || []);
      set({
        tables: list,
        selectedTableId: list.length > 0 ? (get().selectedTableId && list.some((t: any) => t._id === get().selectedTableId) ? get().selectedTableId : list[0]._id) : ''
      });
    } catch {
      set({ tables: [], selectedTableId: '' });
    }
  },

  fetchMenuData: async (branchId?: string) => {
    try {
      const resolvedBranchId = branchId || get().currentUser?.branchIds?.[0];
      const [catData, itemData] = await Promise.all([
        menuApi.getAllCategories(resolvedBranchId),
        menuApi.getAllItems(resolvedBranchId),
      ]);
      const cats  = Array.isArray(catData)  ? catData  : (catData?.data  || catData?.categories || []);
      const items = Array.isArray(itemData) ? itemData : (itemData?.data || itemData?.menuItems  || []);
      set({ categories: cats, menuItems: items });
    } catch {
      set({ categories: [], menuItems: [] });
    }
  },

  fetchStaffList: async () => {
    try {
      const data = await staffApi.getAll();
      const list = Array.isArray(data) ? data : (data?.data || data?.staff || []);
      if (list.length > 0) set({ staffList: list });
    } catch {
      // keep mock fallback
    }
  },

  fetchPrinters: async (branchId?: string) => {
    try {
      const data = await printerApi.getAll(branchId);
      const list = Array.isArray(data) ? data : (data?.data || data?.printers || []);
      set({ printers: list });
    } catch {
      // Keep existing printers
    }
  },

  scanLANPrinters: async () => {
    try {
      const currentBranchId = get().currentBranch?._id || (get().currentUser?.branchId as string | undefined);
      const data = await printerApi.scanLAN(currentBranchId);
      const foundPrinters = data?.foundPrinters ?? (Array.isArray(data) ? data : []);
      const allSaved      = data?.savedPrinters ?? [];
      // Filter saved printers strictly to current branch only — prevents cross-branch leakage
      const savedPrinters = currentBranchId
        ? allSaved.filter((p: any) => p.branchId && String(p.branchId) === String(currentBranchId))
        : allSaved;
      set({
        discoveredPrinters: foundPrinters,
        printers: savedPrinters.length > 0 ? savedPrinters : get().printers,
      });
      return foundPrinters;
    } catch {
      // Offline / LAN discovery fallback
    }
    set({ discoveredPrinters: [] });
    return [];
  },


  addPrinter: async (printerData) => {
    try {
      const branchId = printerData.branchId || get().currentBranch?._id || get().currentUser?.branchId;
      const created = await printerApi.create({ ...printerData, branchId });
      const newPrinter = created?.printer || created;
      set((state) => ({ printers: [...state.printers, newPrinter] }));
      return newPrinter;
    } catch {
      const chosenDuty = printerData.duty || 'KOT';
      const chosenRole = printerData.role || (chosenDuty === 'RECEIPT' ? 'cashier' : chosenDuty === 'BOTH' ? 'both' : 'kitchen');
      const newPrinter: Printer = {
        _id: `prn-${Date.now()}`,
        name: printerData.name || 'Network Printer',
        ip: printerData.ip || '192.168.1.200',
        port: printerData.port || 9100,
        type: printerData.type || 'thermal',
        duty: chosenDuty,
        role: chosenRole,
        sections: printerData.sections || ['ALL'],
        branchId: printerData.branchId || get().currentBranch?._id || get().currentUser?.branchId,
        isActive: true,
      };
      set((state) => ({ printers: [...state.printers, newPrinter] }));
      return newPrinter;
    }
  },

  updatePrinter: async (idOrPrinter: any, updates?: any) => {
    const id = typeof idOrPrinter === 'string' ? idOrPrinter : idOrPrinter?._id;
    const patch = typeof idOrPrinter === 'string' ? updates : idOrPrinter;
    try { await printerApi.update(id, patch); } catch { /* offline */ }
    set((state) => ({
      printers: state.printers.map((p) => (p._id === id ? { ...p, ...patch } : p)),
    }));
    return get().printers.find((p) => p._id === id)!;
  },

  deletePrinter: async (id) => {
    const branchId = get().currentBranch?._id || (get().currentUser?.branchId as string | undefined);
    try { await printerApi.delete(id, branchId); } catch { /* offline */ }
    set((state) => ({ printers: state.printers.filter((p) => p._id !== id) }));
  },

  testPrintJob: async (printerId) => {
    try {
      await printerApi.printJob(printerId, {
        type: 'TEST',
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  },

  printKOTBySection: async (kot, tableId) => {
    const { printers, currentBranch } = get();
    const order = get().activeOrders[tableId];
    if (!printers || printers.length === 0) return;

    // Helper to check if a printer is permitted to print KOT tickets
    const canPrintKOT = (p: Printer) => p.isActive !== false && p.duty !== 'RECEIPT' && p.role !== 'cashier' && p.role !== 'receipt';

    // 1. Try sending directly to our new high-speed backend LAN multi-printer dispatcher
    try {
      const { printerApi } = await import('../services/api.service');
      await printerApi.dispatchKOT({
        ...kot,
        tableId,
        tableNumber: order?.tableNumber,
        orderId: order?.dbOrderId || order?._id,
        orderNumber: order?.orderNumber,
        branchId: order?.branchId || currentBranch._id,
        branchName: currentBranch.name,
      });
      return; // Backend successfully split & dispatched over LAN to KOT-permitted printers!
    } catch {
      // If backend dispatcher unavailable or offline, fall back to client-side grouping
    }

    // Group order items strictly by assigned target printer
    const itemsByPrinterId: Record<string, any[]> = {};

    kot.items?.forEach((it: any) => {
      // 1. If dish has a specific printerId assigned, verify that printer allows KOT and route exclusively
      if (it.printerId && it.printerId !== '' && it.printerId !== 'none') {
        const targetP = printers.find((p) => p._id === it.printerId && canPrintKOT(p));
        if (targetP) {
          if (!itemsByPrinterId[targetP._id]) itemsByPrinterId[targetP._id] = [];
          itemsByPrinterId[targetP._id].push(it);
          return;
        }
      }

      // 2. Otherwise, check if a KOT-eligible printer explicitly matches the dish's section
      const itemSection = it.sections?.[0] || it.section;
      if (itemSection && itemSection !== 'ALL') {
        const sectionPrinter = printers.find((p) => canPrintKOT(p) && p.sections?.includes(itemSection));
        if (sectionPrinter) {
          if (!itemsByPrinterId[sectionPrinter._id]) itemsByPrinterId[sectionPrinter._id] = [];
          itemsByPrinterId[sectionPrinter._id].push(it);
          return;
        }
      }

      // 3. If dish has NO printerId assigned and no section printer matches,
      // DO NOT automatically print it to printers[0] or any Receipt Only printer!
    });

    // Send KOT jobs only to the designated KOT-eligible printers
    for (const [printerId, items] of Object.entries(itemsByPrinterId)) {
      if (!items || items.length === 0) continue;
      const targetPrinter = printers.find((p) => p._id === printerId && canPrintKOT(p));
      if (!targetPrinter) continue;

      const payload = {
        type: 'KOT',
        tableId,
        kotNumber: kot.kotNumber,
        timestamp: kot.timestamp,
        section: items[0]?.sections?.[0] || 'Kitchen',
        branchName: currentBranch.name,
        items,
      };

      try {
        const { printerApi } = await import('../services/api.service');
        await printerApi.printJob(targetPrinter._id, payload);
      } catch {
        set((state) => ({
          syncQueue: [
            ...state.syncQueue,
            {
              id: `sync-print-${Date.now()}`,
              action: 'printJob',
              payload: { printerId: targetPrinter._id, payload },
              createdAt: Date.now(),
            },
          ],
        }));
      }
    }
  },

  addBranch: async (branchData) => {
    try {
      const created = await branchApi.create(branchData);
      const newBranch = created?.branch || created;
      set((state) => ({ branches: [...state.branches, newBranch], currentBranch: newBranch }));
      return newBranch;
    } catch {
      const newBranch: Branch = {
        _id: `br-${Date.now()}`,
        branchCode: branchData.branchCode || `BR-${Date.now()}`,
        name: branchData.name || 'New Branch',
        address: branchData.address || '',
        phone: branchData.phone || '',
        gst: branchData.gst || '',
        taxes: branchData.taxes || { cgst: 2.5, sgst: 2.5, serviceCharge: 0 },
        receiptSettings: branchData.receiptSettings || {
          invoicePrefix: 'INV-', headerText: 'Welcome!', footerText: 'Thank you!',
          printLogo: false, autoPrintOnCheckout: true, useThermalFormat: true, paperWidth: '80mm',
        },
        timings: branchData.timings || '11:00 AM - 11:30 PM',
        managerName: branchData.managerName || '',
        managerId: branchData.managerId || '',
        sections: branchData.sections || [],
      };
      set((state) => ({ branches: [...state.branches, newBranch], currentBranch: newBranch }));
      return newBranch;
    }
  },

  updateBranch: async (idOrBranch: any, updates?: any) => {
    const id = typeof idOrBranch === 'string' ? idOrBranch : idOrBranch._id;
    const patch = typeof idOrBranch === 'string' ? updates : idOrBranch;
    try { await branchApi.update(id, patch); } catch { /* offline fallback */ }
    const updated = get().branches.map((b) => b._id === id ? { ...b, ...patch } : b);
    const updatedBranch = updated.find((b) => b._id === id) || get().currentBranch;
    set({ branches: updated, currentBranch: updatedBranch });
    return updatedBranch;
  },

  deleteBranch: async (id) => {
    try {
      await branchApi.delete(id);
      set((state) => ({ branches: state.branches.filter((b) => b._id !== id) }));
    } catch (err: any) {
      alert(err.message || 'Failed to delete branch. At least one branch must remain.');
    }
  },

  toggleBranchStatus: (id) => {
    set((state) => ({
      branches: state.branches.map((b) =>
        b._id === id ? { ...b, isActive: !b.isActive } : b
      ),
    }));
  },

  addTable: async (tableData) => {
    const payload = {
      branchId: get().currentBranch._id,
      sectionId: tableData.sectionId || 'sec-1',
      sectionName: tableData.sectionName || 'Dining Hall',
      tableNumber: tableData.tableNumber || `T-${get().tables.length + 1}`,
      capacity: tableData.capacity || 4,
      status: 'Available',
    };
    try {
      const created = await tableApi.create(payload);
      const newTable = created?.data || created?.table || created;
      set((state) => {
        const nextState: any = { tables: [...state.tables, newTable] };
        if (!state.selectedTableId) {
          nextState.selectedTableId = newTable._id;
        }
        return nextState;
      });
    } catch {
      const fallbackTable: Table = {
        _id: `tbl-${Date.now()}`,
        ...payload,
        status: (payload.status || 'Available') as Table['status'],
      };
      set((state) => ({ tables: [...state.tables, fallbackTable] }));
    }
  },

  updateTableStatus: async (tableId, status) => {
    set((state) => ({
      tables: state.tables.map((t) => (t._id === tableId ? { ...t, status } : t)),
    }));
    try {
      await tableApi.update(tableId, { status });
    } catch {
      // offline mode fallback
    }
  },

  updateTableName: async (tableId, tableNumber) => {
    set((state) => ({
      tables: state.tables.map((t) => (t._id === tableId ? { ...t, tableNumber } : t)),
    }));
    try {
      await tableApi.update(tableId, { tableNumber });
    } catch {
      // offline mode fallback
    }
  },

  updateTableDetails: async (tableId, data) => {
    set((state) => ({
      tables: state.tables.map((t) => (t._id === tableId ? { ...t, ...data } : t)),
    }));
    try {
      await tableApi.update(tableId, data);
    } catch {
      // offline mode fallback
    }
  },

  openReservationModal: (tableId) => {
    set({ reservationModal: { isOpen: true, tableId } });
  },
  closeReservationModal: () => {
    set({ reservationModal: { isOpen: false } });
  },
  createReservation: (tableIdsOrId, nameOrObj, phone, guests, reservedDate, reservedTime, extraTableIds) => {
    const targetTableIds = Array.isArray(tableIdsOrId)
      ? tableIdsOrId
      : [tableIdsOrId, ...(extraTableIds || [])];

    const reservationObj =
      typeof nameOrObj === 'object'
        ? nameOrObj
        : {
            customerName: nameOrObj,
            phone: phone || '',
            guests: guests || 4,
            reservedAt: new Date().toISOString(),
            reservedDate: reservedDate || new Date().toISOString().split('T')[0],
            reservedTime: reservedTime || 'Immediate',
            expiresAt: '',
            reservedTables: targetTableIds,
          };

    set((state) => ({
      tables: state.tables.map((t) =>
        targetTableIds.includes(t._id)
          ? { ...t, status: 'Reserved', reservation: reservationObj }
          : t
      ),
      reservationModal: { isOpen: false },
    }));
  },
  unreserveTable: (tableId) => {
    set((state) => ({
      tables: state.tables.map((t) =>
        t._id === tableId ? { ...t, status: 'Available', reservation: undefined } : t
      ),
    }));
  },
  checkExpiredReservations: () => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    set((state) => {
      let expiredCount = 0;
      const updatedTables = state.tables.map((t) => {
        if (t.status === 'Reserved' && t.reservation?.reservedTime && !state.activeOrders[t._id]) {
          const todayStr = now.toISOString().split('T')[0];
          const isTodayOrEarlier = !t.reservation.reservedDate || t.reservation.reservedDate <= todayStr;
          const resTimeStr = t.reservation.reservedTime;
          const [hStr, mStr] = resTimeStr.split(':');
          const resHours = parseInt(hStr, 10);
          const resMins = parseInt(mStr, 10);
          if (isTodayOrEarlier && !isNaN(resHours) && !isNaN(resMins)) {
            const reservedMinutes = resHours * 60 + resMins;
            // Expire if more than 15 mins past reserved time today
            if (nowMinutes - reservedMinutes >= 15 && nowMinutes - reservedMinutes < 720) {
              expiredCount++;
              return { ...t, status: 'Available' as const, reservation: undefined };
            }
          }
        }
        return t;
      });

      if (expiredCount > 0) {
        return {
          tables: updatedTables,
          notifications: [
            {
              id: 'exp-' + Date.now(),
              type: 'warning',
              title: 'Reservation Auto-Released',
              message: `${expiredCount} reserved table(s) auto-released due to 15+ min grace period expiry without order.`,
              timestamp: 'Just now',
              read: false,
            },
            ...state.notifications,
          ],
        };
      }
      return state;
    });
  },
  openMergeModal: (tableId) => {
    set({ mergeTableModal: { isOpen: true, tableId } });
  },
  closeMergeModal: () => {
    set({ mergeTableModal: { isOpen: false } });
  },
  mergeTables: (sourceId, targetId) => {
    set((state) => ({
      tables: state.tables.map((t) =>
        t._id === sourceId
          ? { ...t, status: 'Merged', mergedWith: [targetId] }
          : t
      ),
      mergeTableModal: { isOpen: false },
    }));
  },
  separateTables: (tableId) => {
    set((state) => ({
      tables: state.tables.map((t) =>
        t._id === tableId ? { ...t, mergedWith: [], status: 'Available' } : t
      ),
    }));
  },

  toggleMenuItemAvailability: async (itemId) => {
    try { await menuApi.toggleAvailability(itemId); } catch { /* offline */ }
    set((state) => ({
      menuItems: state.menuItems.map((item) =>
        item._id === itemId
          ? { ...item, available: !item.available, active: !item.available }
          : item
      ),
    }));
  },

  addMenuItem: async (itemData) => {
    const payload = {
      branchId: get().currentBranch._id,
      categoryId: itemData.categoryId || 'cat-1',
      name: itemData.name || 'New Item',
      description: itemData.description || '',
      variants: itemData.variants || [{ name: 'Regular', price: 100 }],
      addons: itemData.addons || [],
      badge: itemData.badge,
      sections: itemData.sections || ['ALL'],
      taxRate: itemData.taxRate !== undefined ? Number(itemData.taxRate) : 5,
      ...(itemData.core != null && { core: itemData.core }),
      available: true,
      active: true,
    };
    try {
      const created = await menuApi.createItem(payload);
      const newItem = created?.menuItem || created;
      set((state) => ({ menuItems: [...state.menuItems, newItem] }));
    } catch {
      const newItem: MenuItem = { _id: `mi-${Date.now()}`, ...payload, printerId: 'prn-1' };
      set((state) => ({ menuItems: [...state.menuItems, newItem] }));
    }
  },

  updateMenuItem: async (id, updates) => {
    try {
      await menuApi.updateItem(id, updates);
      set((state) => ({
        menuItems: state.menuItems.map((item) => (item._id === id ? { ...item, ...updates } : item)),
      }));
    } catch (error) {
      console.warn('Failed to update menu item', error);
      set((state) => ({
        menuItems: state.menuItems.map((item) => (item._id === id ? { ...item, ...updates } : item)),
      }));
    }
  },

  deleteMenuItem: async (id) => {
    try {
      await menuApi.deleteItem(id);
      set((state) => ({
        menuItems: state.menuItems.filter((item) => item._id !== id),
      }));
    } catch (error) {
      console.warn('Failed to delete menu item', error);
      set((state) => ({
        menuItems: state.menuItems.filter((item) => item._id !== id),
      }));
    }
  },

  addCategory: async (name: string) => {
    try {
      const created = await menuApi.createCategory({
        name: name.trim(),
        displayOrder: get().categories.length + 1,
        active: true,
      });
      const newCat = created?.category || created?.data || created;
      set((state) => ({ categories: [...state.categories, newCat] }));
      return newCat;
    } catch {
      const newCat = {
        _id: `cat-${Date.now()}`,
        name: name.trim(),
        displayOrder: get().categories.length + 1,
        active: true,
      };
      set((state) => ({ categories: [...state.categories, newCat] }));
      return newCat;
    }
  },

  openPrintModal: (type = 'BILL', data = null) => {
    set({ printModal: { isOpen: true, type, data } });
  },
  closePrintModal: () => {
    set({ printModal: { isOpen: false } });
  },

  addItemToOrder: (item, variantIdx, addons = [], notes = '') => {
    let tableId = get().selectedTableId;
    if (!tableId) {
      const allTables = get().tables;
      if (allTables.length > 0) {
        tableId = allTables[0]._id;
        set({ selectedTableId: tableId });
      } else {
        return; // No tables exist
      }
    }
    const variant = (item.variants && item.variants[variantIdx]) || (item.variants && item.variants[0]) || { name: 'Standard', price: (item as any).price || 0 };
    const rawOrder = get().activeOrders[tableId] || {
      orderId: `ord-${Date.now()}`,
      tableId,
      branchId: get().currentBranch?._id,
      tableNumber: get().tables.find(t => t._id === tableId)?.tableNumber || 'TBL',
      staffId: get().currentUser?._id,
      orderNumber: `#ORD-${Math.floor(Math.random() * 9000 + 1000)}`,
      items: [],
      kots: [],
      subtotal: 0,
      cgst: 0,
      sgst: 0,
      total: 0,
      status: 'Active',
    };
    // Reconstruct kotPrinted flags from KOT history so legacy orders show
    // correct grey-out state even if the kotPrinted field wasn't set before.
    const order = reconstructKotPrinted(rawOrder);


    const newItem = {
      id: `item-${Date.now()}`,
      menuItemId: item._id,
      name: item.name,
      variantName: variant.name,
      price: Number(variant.price) || 0,
      quantity: 1,
      taxRate: (item.taxRate !== undefined && item.taxRate !== null) ? Number(item.taxRate) : 5,
      addons,
      notes,
    };

    const newItems = [...order.items, newItem];
    let subtotal = 0;
    let totalTax = 0;
    newItems.forEach((i) => {
      const itemSubtotal = ((Number(i.price) || 0) + (i.addons || []).reduce((acc: number, a: any) => acc + (Number(a.price) || 0), 0)) * (Number(i.quantity) || 1);
      subtotal += itemSubtotal;
      const tRate = (i.taxRate !== undefined && i.taxRate !== null) ? Number(i.taxRate) : 5;
      totalTax += itemSubtotal * (tRate / 100);
    });

    const cgst = totalTax / 2;
    const sgst = totalTax / 2;
    const total = subtotal + cgst + sgst;

    const updatedOrder = { ...order, items: newItems, subtotal, cgst, sgst, total, status: 'Active' };

    set((state) => ({
      activeOrders: {
        ...state.activeOrders,
        [tableId]: updatedOrder,
      },
      tables: state.tables.map((t) =>
        t._id === tableId ? { ...t, status: 'Occupied' } : t
      ),
    }));

    syncOrderToBackend(updatedOrder, get);
  },

  updateOrderItemQty: (itemIdx, delta) => {
    const tableId = get().selectedTableId;
    const order = get().activeOrders[tableId];
    if (!order) return;
    const updatedItems = order.items
      .map((item, idx) =>
        idx === itemIdx ? { ...item, quantity: item.quantity + delta } : item
      )
      .filter((i) => i.quantity > 0);

    let subtotal = 0;
    let totalTax = 0;
    updatedItems.forEach((i) => {
      const itemSubtotal = ((Number(i.price) || 0) + (i.addons || []).reduce((acc: number, a: any) => acc + (Number(a.price) || 0), 0)) * (Number(i.quantity) || 1);
      subtotal += itemSubtotal;
      const tRate = (i.taxRate !== undefined && i.taxRate !== null) ? Number(i.taxRate) : 5;
      totalTax += itemSubtotal * (tRate / 100);
    });

    const cgst = totalTax / 2;
    const sgst = totalTax / 2;
    const total = subtotal + cgst + sgst;

    // If all items are removed after KOTs were already generated, mark KOTs as Cancelled
    const isCancelled = updatedItems.length === 0 && (order.kots || []).length > 0;
    const kots = (order.kots || []).map((k: any) => ({
      ...k,
      status: isCancelled ? 'Cancelled' : 'Modified',
    }));

    const updatedOrder = {
      ...order,
      items: updatedItems,
      kots,
      status: isCancelled ? 'Cancelled' : order.status,
      subtotal,
      cgst,
      sgst,
      total,
    };

    if (isCancelled || updatedItems.length === 0) {
      const activeOrdersCopy = { ...get().activeOrders };
      delete activeOrdersCopy[tableId];
      set((state) => ({
        activeOrders: activeOrdersCopy,
        tables: state.tables.map((t) =>
          t._id === tableId ? { ...t, status: 'Available' } : t
        ),
      }));
    } else {
      set((state) => ({
        activeOrders: {
          ...state.activeOrders,
          [tableId]: updatedOrder,
        },
      }));
    }

    syncOrderToBackend(updatedOrder, get);
  },

  removeOrderItem: (itemIdx) => {
    get().updateOrderItemQty(itemIdx, -999);
  },

  cancelOrder: () => {
    const tableId = get().selectedTableId;
    const order = get().activeOrders[tableId];
    if (!order) return;

    const kots = (order.kots || []).map((k: any) => ({ ...k, status: 'Cancelled' }));
    const updatedOrder = {
      ...order,
      status: 'Cancelled',
      kots,
    };

    const activeOrdersCopy = { ...get().activeOrders };
    delete activeOrdersCopy[tableId];

    set((state) => ({
      activeOrders: activeOrdersCopy,
      tables: state.tables.map((t) =>
        t._id === tableId ? { ...t, status: 'Available' } : t
      ),
      viewMode: 'TABLES',
    }));

    syncOrderToBackend(updatedOrder, get);
  },

  holdOrder: (tableId) => {
    const targetId = tableId || get().selectedTableId;
    const order = get().activeOrders[targetId];
    if (!order) return;

    const updatedOrder = { ...order, status: 'Hold' };
    set((state) => ({
      activeOrders: {
        ...state.activeOrders,
        [targetId]: updatedOrder,
      },
      tables: state.tables.map((t) =>
        t._id === targetId ? { ...t, status: 'Hold' as const } : t
      ),
      posViewMode: 'TABLES',
    }));

    syncOrderToBackend(updatedOrder, get);
  },

  generateKOT: (withPrint: boolean = true) => {
    const tableId = get().selectedTableId;
    const raw = get().activeOrders[tableId];
    if (!raw || raw.items.length === 0) return;

    // Reconstruct kotPrinted from KOT history (handles legacy persisted orders)
    const order = reconstructKotPrinted(raw);

    // Only new (not yet KOT-printed) items count
    const newItems = order.items.filter((item: any) => !item.kotPrinted);
    if (newItems.length === 0) return; // nothing new to send


    const nextSeq = order.kots.length + 1;
    const newKot = {
      id: `kot-${Date.now()}`,
      kotNumber: `KOT-${nextSeq}`,
      sequence: nextSeq,
      items: newItems,   // ← only new items in this KOT record
      printedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      printedBy: get().currentUser?.name || 'POS Staff',
      status: 'Active',
      withPrint,
    };

    // Mark all current items as printed → they go grey immediately
    const updatedItems = order.items.map((item: any) => ({ ...item, kotPrinted: true }));
    const updatedOrder = {
      ...order,
      status: 'Active' as const,
      items: updatedItems,
      kots: [...order.kots, newKot],
    };

    set((state) => ({
      activeOrders: {
        ...state.activeOrders,
        [tableId]: updatedOrder,
      },
      tables: state.tables.map((t) =>
        t._id === tableId ? { ...t, status: 'Occupied' } : t
      ),
    }));

    // Sync to backend
    (async () => {
      let backendHandled = false;
      try {
        const { orderApi } = await import('../services/api.service');
        const dbOrderId = order.dbOrderId || order._id;
        if (dbOrderId && !dbOrderId.startsWith('local-')) {
          const res = await orderApi.generateKOT(dbOrderId, withPrint);
          backendHandled = true;

          // ── Sync backend's authoritative item list back to local state ────
          // The backend knows the definitive kotPrinted state (cross-checks
          // KOT history for legacy orders). Merge it into the local store.
          const backendOrder = res?.data?.order;
          if (backendOrder?.items) {
            const backendItemMap = new Map(
              backendOrder.items.map((i: any) => [String(i._id), i])
            );
            useERPStore.setState((state) => {
              const cur = state.activeOrders[tableId];
              if (!cur) return state;
              const mergedItems = cur.items.map((localItem: any) => {
                const backendItem = backendItemMap.get(String(localItem._id || localItem.id));
                return backendItem ? { ...localItem, kotPrinted: !!(backendItem as any).kotPrinted } : localItem;
              });
              return {
                activeOrders: {
                  ...state.activeOrders,
                  [tableId]: { ...cur, items: mergedItems },
                },
              };
            });
          }
          return;
        }
      } catch {
        // Non-fatal: backend unreachable
      }

      if (!backendHandled) {
        if (withPrint) {
          get().printKOTBySection(newKot, tableId);
        }
        syncOrderToBackend(updatedOrder, get);
      }
    })();
  },



  // ─────────────────────────────────────────────────────────────────────────
  // UNIFIED SETTLEMENT — single atomic action for all 3 settlement paths.
  // UI is only cleared AFTER the backend confirms order = Completed.
  // ─────────────────────────────────────────────────────────────────────────
  settleOrder: async (paymentMethods) => {
    const tableId = get().selectedTableId;
    const order = get().activeOrders[tableId];
    if (!order || get().isSettling) return;

    const table = get().tables.find((t) => t._id === tableId);
    const branch = get().currentBranch;

    // Lock UI — prevent double-clicks and show spinner
    set({ isSettling: true, settlementError: null });

    try {
      const { orderApi } = await import('../services/api.service');

      // ── Step 1: Sync order to DB ─────────────────────────────────────────
      // NOTE: api.service request() already unwraps {success, data} envelope,
      // so syncRes IS the order object directly (not syncRes.data).
      let dbOrderId = order.dbOrderId || order._id;
      try {
        const syncRes = await orderApi.syncLocal({
          ...order,
          branchId: order.branchId || branch?._id,
          tableNumber: order.tableNumber || table?.tableNumber || 'TBL',
          staffId: order.staffId || get().currentUser?._id,
        });
        // syncRes is the unwrapped order object
        if ((syncRes as any)?._id) dbOrderId = (syncRes as any)._id;
      } catch (syncErr: any) {
        // syncLocal failure is non-fatal if we already have a dbOrderId
        // (e.g. KOT was already synced earlier in this session)
        console.warn('[settleOrder] syncLocal failed (non-fatal):', syncErr?.message);
        if (!dbOrderId) throw new Error(`Cannot reach server: ${syncErr?.message || 'Network error'}. Check your connection and retry.`);
      }

      // ── Step 2: Generate bill (idempotent — safe if already exists) ───────
      let dbBillId: string | undefined = order.dbBillId;
      let billNumber: string | undefined = order.billNumber;
      if (!dbBillId || dbBillId === dbOrderId || dbBillId.startsWith('ORD-') || dbBillId.startsWith('#ORD')) {
        // billRes is the unwrapped bill object
        const billRes = await orderApi.generateBill(
          dbOrderId,
          order.branchId || branch?._id || 'BR-MAIN'
        ) as any;
        const actualBill = billRes?.bill || (billRes?._id && (billRes?.orderId || billRes?.order_id) ? billRes : null) || billRes;
        if (!actualBill?._id) throw new Error('Bill could not be generated. Please try again.');
        dbBillId = actualBill._id;
        billNumber = actualBill.billNumber || billRes?.billNumber;
      }

      // ── Step 3: Process payment → DB: order=Completed, bill=Paid ─────────
      const doPayment = async (targetBillId: string) => {
        return orderApi.processPayment(targetBillId, {
          cash:  paymentMethods.cash,
          card:  paymentMethods.card,
          upi:   paymentMethods.upi,
          other: paymentMethods.other || 0,
        } as any);
      };

      try {
        await doPayment(dbBillId!);
      } catch (payErr: any) {
        if (payErr?.message?.toLowerCase().includes('bill not found') || payErr?.statusCode === 404) {
          console.warn('[settleOrder] Bill not found during payment, regenerating bill and retrying...');
          const billRes = await orderApi.generateBill(
            dbOrderId,
            order.branchId || branch?._id || 'BR-MAIN'
          ) as any;
          const actualBill = billRes?.bill || (billRes?._id && (billRes?.orderId || billRes?.order_id) ? billRes : null) || billRes;
          if (!actualBill?._id) throw new Error('Bill could not be regenerated.');
          dbBillId = actualBill._id;
          billNumber = actualBill.billNumber || billRes?.billNumber;
          await doPayment(dbBillId!);
        } else {
          throw payErr;
        }
      }

      // ── Step 4: [Skipped, was building bill receipt data which is no longer used] ─────────

      // ── Step 5: ONLY NOW clear UI — backend confirmed Completed ───────────
      set((state) => {
        const nextOrders = { ...state.activeOrders };
        delete nextOrders[tableId];
        return {
          isSettling: false,
          settlementError: null,
          settlementSuccess: null, // will be set below after printer
          activeOrders: nextOrders,
          tables: state.tables.map((t) =>
            t._id === tableId ? { ...t, status: 'Available' } : t
          ),
        };
      });

      // ── Step 6: Send to assigned receipt printer silently ─────────────────
      let printerOk = false;
      try {
        const { printerApi } = await import('../services/api.service');
        const receiptPrinter = get().printers.find(
          (p) => p.isActive !== false &&
            (p.duty === 'RECEIPT' || p.duty === 'BOTH' ||
             p.role === 'cashier' || p.role === 'both' || p.role === 'receipt')
        );
        if (receiptPrinter?._id) {
          await printerApi.printJob(receiptPrinter._id, {
            type: 'BILL',
            tableId: table?._id || tableId,
            billNumber: billNumber || `BILL-${order.orderNumber}`,
            branchName: branch.name,
            subtotal: order.subtotal,
            cgst: order.cgst,
            sgst: order.sgst,
            grandTotal: order.total,
            paymentStatus: 'Paid',
            paymentMethods,
            items: order.items,
          });
          printerOk = true;
        } else {
          printerOk = true; // no printer configured — not an error
        }
      } catch (printErr: any) {
        console.warn('[settleOrder] Printer send failed (non-fatal):', printErr?.message);
      }

      // ── Step 7: Show success toast ────────────────────────────────────────
      const successMsg = printerOk
        ? `✓ Order settled & receipt sent to printer`
        : `✓ Order settled (printer unreachable — check printer connection)`;
      set({ settlementSuccess: successMsg });
      // Auto-dismiss after 4 seconds
      setTimeout(() => set({ settlementSuccess: null }), 4000);

    } catch (err: any) {
      // ── On failure: unlock but DO NOT clear the order ────────────────────
      const msg = err?.message || 'Settlement failed. Please try again.';
      console.error('[settleOrder] Failed:', msg, err);
      set({ isSettling: false, settlementError: msg });
    }
  },

  // Legacy wrappers — delegate to settleOrder so old call-sites still work
  generateBill: async () => {
    const order = get().activeOrders[get().selectedTableId];
    if (!order) return;
    await get().settleOrder({ cash: order.total, card: 0, upi: 0 });
  },

  processPayment: async (paymentParam) => {
    const order = get().activeOrders[get().selectedTableId];
    if (!order) return;
    const cash  = paymentParam?.cash  ?? (order.paymentMethod === 'Cash' || !order.paymentMethod ? order.total : 0);
    const card  = paymentParam?.card  ?? (order.paymentMethod === 'Card'  ? order.total : 0);
    const upi   = paymentParam?.upi   ?? (order.paymentMethod === 'UPI'   ? order.total : 0);
    const other = paymentParam?.other ?? 0;
    await get().settleOrder({ cash, card, upi, other });
  },

  markNotificationRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));
  },

  triggerSyncQueue: async () => {
    set({ isSyncing: true });
    try {
      const { syncApi } = await import('../services/api.service');
      const res = await syncApi.upload([]);
      const pending = res?.data?.pending !== undefined ? res.data.pending : 0;
      set({
        syncQueue: Array(pending).fill({ id: 'pending' }),
        isSyncing: false,
      });
    } catch (err) {
      console.error('Trigger sync error:', err);
      set({ isSyncing: false });
    }
  },

  checkSyncStatus: async () => {
    try {
      const { syncApi } = await import('../services/api.service');
      const res = await syncApi.getStatus();
      if (res?.data) {
        const pending = res.data.pending !== undefined ? res.data.pending : res.data.pendingCount || 0;
        set({
          syncQueue: Array(pending).fill({ id: 'pending' }),
          isSyncing: !!res.data.isSyncing,
        });
      }
    } catch {
      // Ignore errors when offline or starting up
    }
  },

  addUser: async (user) => {
    try {
      const created = await staffApi.create(user);
      const newStaff = created?.staff || created?.data || created;
      set((state) => ({ staffList: [...state.staffList, newStaff] }));
    } catch (err) {
      console.error('Failed to create user on backend:', err);
      throw err;
    }
  },

  updateUser: async (idOrStaff: any, updates?: any) => {
    const id = typeof idOrStaff === 'string' ? idOrStaff : idOrStaff?._id;
    const patch = typeof idOrStaff === 'string' ? updates : idOrStaff;
    try {
      const updated = await staffApi.update(id, patch);
      const updatedStaff = updated?.staff || updated?.data || updated || patch;
      set((state) => ({
        staffList: state.staffList.map((s) => (s._id === id ? { ...s, ...updatedStaff } : s)),
      }));
    } catch (err) {
      console.error('Failed to update user on backend:', err);
      throw err;
    }
  },

  deleteUser: async (id) => {
    try { await staffApi.delete(id); } catch { /* offline */ }
    set((state) => ({ staffList: state.staffList.filter((s) => s._id !== id) }));
  },

  resetUserPassword: async (id) => {
    try { await staffApi.resetPassword(id); } catch { /* offline */ }
  },
}),
{
  name: 'petpooja_erp_session',
  partialize: (state) => ({
    currentUser: state.currentUser,
    activeRole: state.activeRole,
    isAuthenticated: state.isAuthenticated,
    activeScreen: state.activeScreen,
    currentBranch: state.currentBranch,
    branchFilterId: state.branchFilterId,
    selectedTableId: state.selectedTableId,
    activeOrders: state.activeOrders,
  }),
})
);
