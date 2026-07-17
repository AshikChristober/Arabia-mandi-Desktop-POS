/**
 * api.service.ts
 * Central Axios-based HTTP client for all backend API calls.
 * Base URL: http://localhost:5000/api/v1
 */

const getBaseUrl = (): string => {
  // Electron desktop app: preload.js sets this to http://localhost:3001/api/v1
  // Called on every request so Electron URL is always used even if injected late.
  if ((window as any).__ELECTRON_LOCAL_API__) return (window as any).__ELECTRON_LOCAL_API__;
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  return `https://arabia-mandi-orderingtool-backend.onrender.com/api/v1`;
};

// NOTE: Do NOT freeze this into a const — call getBaseUrl() on each request
// so the Electron preload injection is always respected.

// ─── Token helpers ───────────────────────────────────────────────
export const getToken = (): string | null => localStorage.getItem('erp_token');

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ─── Generic fetch wrapper ───────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: any
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Non-JSON response from ${path}`);
  }

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('erp_token');
      import('../stores/erp.store').then(({ useERPStore }) => {
        useERPStore.getState().logout();
      }).catch(() => {});
    }
    throw new Error(json?.message || `Request failed: ${res.status}`);
  }

  // Unwrap { success: true, data: {...} } envelope from backend
  return json?.data !== undefined ? json.data : json;
}

const cleanBody = (body: any) => {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const cleaned = { ...body };
    delete cleaned._id;
    delete cleaned.__v;
    delete cleaned.createdAt;
    delete cleaned.updatedAt;
    return cleaned;
  }
  return body;
};

const get  = <T>(path: string)              => request<T>('GET',    path);
const post = <T>(path: string, body: any)   => request<T>('POST',   path, body);
const put  = <T>(path: string, body: any)   => request<T>('PUT',    path, cleanBody(body));
const patch= <T>(path: string, body?: any)  => request<T>('PATCH',  path, cleanBody(body));
const del  = <T>(path: string)              => request<T>('DELETE', path);

// ────────────────────────────────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    post<any>('/auth/login', { username, password }),

  getProfile: () => get<any>('/auth/profile'),

  changePassword: (currentPassword: string, newPassword: string) =>
    put<any>('/auth/change-password', { currentPassword, newPassword }),
};

// ────────────────────────────────────────────────────────────────────────────
// BRANCHES
// ────────────────────────────────────────────────────────────────────────────
export const branchApi = {
  getAll: () => get<any>('/branches'),
  getById: (id: string) => get<any>(`/branches/${id}`),
  create: (data: any) => post<any>('/branches', data),
  update: (id: string, data: any) => put<any>(`/branches/${id}`, data),
  delete: (id: string) => del<any>(`/branches/${id}`),
  toggleStatus: (id: string) => patch<any>(`/branches/${id}/toggle-status`),
};

// ────────────────────────────────────────────────────────────────────────────
// STAFF
// ────────────────────────────────────────────────────────────────────────────
export const staffApi = {
  getAll: (branchId?: string) =>
    get<any>(`/staff${branchId ? `?branchId=${branchId}` : ''}`),
  getById: (id: string) => get<any>(`/staff/${id}`),
  create: (data: any) => post<any>('/staff', data),
  update: (id: string, data: any) => put<any>(`/staff/${id}`, data),
  delete: (id: string) => del<any>(`/staff/${id}`),
  resetPassword: (id: string) => post<any>(`/staff/${id}/reset-password`, {}),
};

// ────────────────────────────────────────────────────────────────────────────
// SECTIONS
// ────────────────────────────────────────────────────────────────────────────
export const sectionApi = {
  getAll: (branchId?: string) =>
    get<any>(`/sections${branchId ? `?branchId=${branchId}` : ''}`),
  create: (data: any) => post<any>('/sections', data),
  update: (id: string, data: any) => put<any>(`/sections/${id}`, data),
  delete: (id: string) => del<any>(`/sections/${id}`),
};

// ────────────────────────────────────────────────────────────────────────────
// TABLES
// ────────────────────────────────────────────────────────────────────────────
export const tableApi = {
  getAll: (branchId?: string) =>
    get<any>(`/tables${branchId ? `?branchId=${branchId}` : ''}`),
  getById: (id: string) => get<any>(`/tables/${id}`),
  create: (data: any) => post<any>('/tables', data),
  update: (id: string, data: any) => put<any>(`/tables/${id}`, data),
  delete: (id: string) => del<any>(`/tables/${id}`),
  reserve: (data: any) => post<any>('/tables/reserve', data),
  cancelReservation: (tableId: string) =>
    post<any>('/tables/cancel-reservation', { tableId }),
  merge: (primaryTableId: string, targetTableId: string) =>
    post<any>('/tables/merge', { primaryTableId, targetTableId }),
  separate: (tableId: string) => post<any>('/tables/separate', { tableId }),
  release: (tableId: string) => post<any>('/tables/release', { tableId }),
};

// ────────────────────────────────────────────────────────────────────────────
// MENU
// ────────────────────────────────────────────────────────────────────────────
export const menuApi = {
  // Categories
  getAllCategories: (branchId?: string) =>
    get<any>(`/menu/categories${branchId ? `?branchId=${branchId}` : ''}`),
  createCategory: (data: any) => post<any>('/menu/categories', data),
  updateCategory: (id: string, data: any) => put<any>(`/menu/categories/${id}`, data),
  deleteCategory: (id: string) => del<any>(`/menu/categories/${id}`),

  // Items
  getAllItems: (branchId?: string, categoryId?: string) => {
    const params = new URLSearchParams();
    if (branchId)   params.set('branchId', branchId);
    if (categoryId) params.set('categoryId', categoryId);
    const qs = params.toString();
    return get<any>(`/menu/items${qs ? `?${qs}` : ''}`);
  },
  getItemById: (id: string) => get<any>(`/menu/items/${id}`),
  createItem: (data: any) => post<any>('/menu/items', data),
  updateItem: (id: string, data: any) => put<any>(`/menu/items/${id}`, data),
  deleteItem: (id: string) => del<any>(`/menu/items/${id}`),
  toggleAvailability: (id: string) => patch<any>(`/menu/items/${id}/availability`),
};

// ────────────────────────────────────────────────────────────────────────────
// ORDERS
// ────────────────────────────────────────────────────────────────────────────
export const orderApi = {
  getAll: (branchId?: string, status?: string) =>
    get<any>(`/orders${branchId ? `?branchId=${branchId}` : ''}${status ? `&status=${status}` : ''}`),
  getById: (id: string) => get<any>(`/orders/${id}`),
  create: (data: any) => post<any>('/orders', data),
  addItems: (id: string, items: any[]) => post<any>(`/orders/${id}/add-items`, { items }),
  updateStatus: (id: string, status: string) => patch<any>(`/orders/${id}/status`, { status }),
  generateKOT: (id: string, withPrint: boolean = true) => post<any>(`/orders/${id}/kot`, { withPrint }),
  generateBill: (id: string, branchId: string) => post<any>(`/orders/${id}/bill`, { branchId }),
  processPayment: (billId: string, paymentMethods: { cash: number; card: number; upi: number }) =>
    post<any>('/orders/payment', { billId, paymentMethods }),
  syncLocal: (orderData: any) => post<any>('/orders/sync-local', orderData),
};

// ────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ────────────────────────────────────────────────────────────────────────────
export const notificationApi = {
  getAll: (branchId?: string) =>
    get<any>(`/notifications${branchId ? `?branchId=${branchId}` : ''}`),
  markRead: (id: string) => patch<any>(`/notifications/${id}/read`),
  delete: (id: string) => del<any>(`/notifications/${id}`),
};

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ────────────────────────────────────────────────────────────────────────────
export const dashboardApi = {
  getAdminStats: () => get<any>('/dashboard/admin'),
  getStats: (filterType: string = 'day', date?: string, branchId?: string, month?: string, year?: string) => {
    const params = new URLSearchParams();
    if (filterType) params.set('filterType', filterType);
    if (date)       params.set('date', date);
    if (month)      params.set('month', month);
    if (year)       params.set('year', year);
    if (branchId && branchId !== 'ALL') params.set('branchId', branchId);
    const qs = params.toString();
    return get<any>(`/dashboard/stats${qs ? `?${qs}` : ''}`);
  },
  getLeakageLogs: (type: string, filterType: string = 'day', date?: string, branchId?: string, month?: string, year?: string) => {
    const params = new URLSearchParams({ type });
    if (filterType) params.set('filterType', filterType);
    if (date)       params.set('date', date);
    if (month)      params.set('month', month);
    if (year)       params.set('year', year);
    if (branchId && branchId !== 'ALL') params.set('branchId', branchId);
    return get<any>(`/dashboard/leakage-logs?${params.toString()}`);
  },
  getDishSummary: (filterType: string, date?: string, month?: string, year?: string, category?: string, branchId?: string) => {
    const params = new URLSearchParams();
    if (filterType) params.set('filterType', filterType);
    if (date)       params.set('date', date);
    if (month)      params.set('month', month);
    if (year)       params.set('year', year);
    if (category && category !== 'ALL') params.set('category', category);
    if (branchId && branchId !== 'ALL') params.set('branchId', branchId);
    return get<any>(`/dashboard/dish-summary?${params.toString()}`);
  },
};

// ────────────────────────────────────────────────────────────────────────────
// SYNC
// ────────────────────────────────────────────────────────────────────────────
export const syncApi = {
  upload: (items: any[]) => post<any>('/sync/upload', { items }),
  getStatus: () => get<any>('/sync/status'),
  markSynced: (ids: string[]) => post<any>('/sync/mark-synced', { ids }),
};

// ────────────────────────────────────────────────────────────────────────────
// Token management (called on login/logout)
// ────────────────────────────────────────────────────────────────────────────
export const setToken = (token: string) => localStorage.setItem('erp_token', token);
export const clearToken = () => localStorage.removeItem('erp_token');

// ────────────────────────────────────────────────────────────────────────────
// PRINTERS (Wireless / Network Printers & Section-based KOT routing)
// ────────────────────────────────────────────────────────────────────────────
export const printerApi = {
  getAll: (branchId?: string) =>
    get<any>(`/printers${branchId ? `?branchId=${branchId}` : ''}`),
  scanLAN: (branchId?: string) =>
    get<any>(`/printers/scan${branchId ? `?branchId=${branchId}` : ''}`),
  pingLAN: (ip: string, port = 9100) => post<any>('/printers/ping', { ip, port }),
  create: (data: any) => post<any>('/printers', data),
  update: (id: string, data: any) => put<any>(`/printers/${id}`, data),
  delete: (id: string, branchId?: string) =>
    del<any>(`/printers/${id}${branchId ? `?branchId=${branchId}` : ''}`),
  printJob: (printerId: string, payload: any) =>
    post<any>('/printers/print', { printerId, payload }),
  dispatchKOT: (kotPayload: any) => post<any>('/printers/dispatch-kot', kotPayload),
};


