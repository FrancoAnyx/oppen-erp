'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from './api';

interface Ctx {
  token: string | null;
  user: { email: string; fullName: string; role: string } | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<Ctx['user']>(null);

  useEffect(() => {
    const t = localStorage.getItem('token');
    if (t) { setToken(t); api.get<any>('/auth/me').then(me => setUser(me)).catch(logout); }
  }, []);

  async function login(email: string, password: string) {
    const res: any = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', res.accessToken);
    setToken(res.accessToken);
    setUser({ email: res.user.email, fullName: res.user.fullName, role: res.user.role });
  }
  function logout() { localStorage.removeItem('token'); setToken(null); setUser(null); }

  return <AuthContext.Provider value={{ token, user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
