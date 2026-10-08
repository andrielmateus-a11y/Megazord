import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '../types';
import { api, getToken, setToken, setUnauthorizedHandler } from '../services/api';
import { realtime } from '../services/realtime';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; companyName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (...roles: User['role'][]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
    realtime.stop();
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    try {
      const { user } = await api.get<{ user: User }>('/auth/me');
      setUser(user);
      realtime.start();
    } catch {
      clear();
    } finally {
      setLoading(false);
    }
  }, [clear]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    void refresh();
  }, [clear, refresh]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(res.token);
    setUser(res.user);
    realtime.start();
  };

  const register = async (data: { name: string; email: string; password: string; companyName?: string }) => {
    const res = await api.post<{ token: string; user: User }>('/auth/register', data);
    setToken(res.token);
    setUser(res.user);
    realtime.start();
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clear();
  };

  const can = (...roles: User['role'][]) => !!user && roles.includes(user.role);

  return <Ctx.Provider value={{ user, loading, login, register, logout, refresh, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
