import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';
import { queryClient } from '../api/queryClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const res = await api.get('/auth/me');
          setUser(res.data.user);
        } catch {
          localStorage.removeItem('token');
          setUser(null);
        }
      }
      setLoading(false);
    };
    fetchUser();
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    queryClient.clear(); // never show a previous account's cached data
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user; // Returned for role-based redirection
  };

  const register = async (name, email, password, role) => {
    const res = await api.post('/auth/register', { name, email, password, role });
    queryClient.clear();
    localStorage.setItem('token', res.data.token);
    setUser(res.data.user);
    return res.data.user; // Returned for role-based redirection
  };

  const logout = () => {
    localStorage.removeItem('token');
    queryClient.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);