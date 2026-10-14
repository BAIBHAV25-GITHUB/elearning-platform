import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api/v1',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired/invalid token comes back as 401: clear it and send the user to /login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const isCredentialCall = url.includes('/auth/login') || url.includes('/auth/register');
    if (err.response?.status === 401 && !isCredentialCall && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(err);
  }
);

export default api;
