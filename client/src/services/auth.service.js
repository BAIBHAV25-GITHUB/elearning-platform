import api from '../api/axios';

export const registerApi = async (userData) => {
  const response = await api.post('/v1/auth/register', userData);
  return response.data;
};

export const loginApi = async (credentials) => {
  const response = await api.post('/v1/auth/login', credentials);
  return response.data;
};