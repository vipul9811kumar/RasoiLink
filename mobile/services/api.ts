import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = 'https://rasoilink-production.up.railway.app';

const api = axios.create({ baseURL: API_URL });

// ── Request interceptor — attach JWT ─────────────────────────────────────────
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response interceptor — surface 402 plan gate errors ──────────────────────
// When any request hits a plan gate, axios throws with response.status === 402.
// Callers catch this and check error.response?.data?.upgrade_required === true
// to show the UpgradeModal. No changes needed in individual screens.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Let 402 pass through as-is so callers can inspect upgrade_required
    return Promise.reject(error);
  },
);

// ── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  login:    (phone: string, password: string) =>
    api.post('/auth/login', { phone, password }),
  register: (data: object) =>
    api.post('/auth/register', data),
  me:       () => api.get('/auth/me'),
};

// ── Listings ──────────────────────────────────────────────────────────────────
export const listings = {
  list:   (params?: object) => api.get('/listings', { params }),
  get:    (id: string)      => api.get(`/listings/${id}`),
  create: (data: object)    => api.post('/listings', data),
  update: (id: string, data: object) => api.patch(`/listings/${id}`, data),
  status: (id: string, status: string) =>
    api.patch(`/listings/${id}/status`, { status }),
  score:  (id: string)      => api.get(`/listings/${id}/score`),
};

// ── Workers ───────────────────────────────────────────────────────────────────
export const workers = {
  get:     (id: string)           => api.get(`/workers/${id}`),
  update:  (id: string, data: object) => api.patch(`/workers/${id}`, data),
  matches: (id: string)           => api.get(`/workers/${id}/matches`),
  search:  (params?: object)      => api.get('/workers/search', { params }),
};

// ── Chat ──────────────────────────────────────────────────────────────────────
export const chat = {
  message:  (message: string, session_id?: string, language_code = 'en') =>
    api.post('/chat/message', { message, session_id, language_code }),
  sessions: () => api.get('/chat/sessions'),
};

// ── Billing ───────────────────────────────────────────────────────────────────
export const billing = {
  /** Get current user's plan + feature flags */
  subscription: () => api.get('/billing/subscription'),

  /**
   * Create a Stripe Checkout session.
   * Returns { url, session_id } — open url in browser/WebView.
   *
   * tx_type: 'subscription' | 'hire_fee' | 'job_boost' | 'course' | 'background_check'
   */
  checkout: (
    price_id: string,
    tx_type: string,
    success_url: string,
    cancel_url: string,
    metadata?: object,
  ) => api.post('/billing/checkout', {
    price_id,
    tx_type,
    success_url,
    cancel_url,
    metadata,
  }),

  /** Get Stripe Customer Portal URL — for managing subscription */
  portal: (return_url: string) =>
    api.post('/billing/portal', { return_url }),
};

// ── Plan price IDs (match your Stripe Dashboard) ──────────────────────────────
export const PRICE_IDS: Record<string, string> = {
  owner_starter:    'price_STARTER_ID_HERE',   // $39/mo — replace with your actual price_xxx
  owner_growth:     'price_GROWTH_ID_HERE',    // $99/mo
  worker_boost:     'price_BOOST_ID_HERE',     // $7/mo
  hire_fee:         'price_HIRE_FEE_ID_HERE',  // $149 one-time
  job_boost:        'price_JOB_BOOST_ID_HERE', // $29 one-time
  course:           'price_COURSE_ID_HERE',    // $19 one-time
  background_check: 'price_BG_CHECK_ID_HERE',  // $15 one-time
} as const;

// ── Helper: is this error a plan gate (402)? ──────────────────────────────────
export function isPlanGateError(error: any): boolean {
  return error?.response?.status === 402 &&
         error?.response?.data?.upgrade_required === true;
}

export function getPlanGateMessage(error: any): string {
  return error?.response?.data?.error ?? 'Upgrade your plan to access this feature.';
}

export default api;
