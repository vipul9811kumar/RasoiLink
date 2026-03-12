import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = 'http://localhost:3000';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('auth_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const auth = {
  login: (phone: string, password: string) =>
    api.post('/auth/login', { phone, password }),
  register: (data: object) =>
    api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

export const listings = {
  list: (params?: object) => api.get('/listings', { params }),
  get: (id: string) => api.get(`/listings/${id}`),
};

export const chat = {
  message: (message: string, session_id?: string, language_code = 'en') =>
    api.post('/chat/message', { message, session_id, language_code }),
  sessions: () => api.get('/chat/sessions'),
};

export const workers = {
  get: (id: string) => api.get(`/workers/${id}`),
  update: (id: string, data: object) => api.patch(`/workers/${id}`, data),
  matches: (id: string) => api.get(`/workers/${id}/matches`),
};

export default api;
