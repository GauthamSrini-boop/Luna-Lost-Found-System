import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, unread: 0, loading: true });

  const refresh = useCallback(async () => {
    try {
      const d = await api.get('/api/auth/me');
      setState({ user: d.user, unread: d.unread || 0, loading: false });
    } catch {
      setState({ user: null, unread: 0, loading: false });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({
    ...state,
    refresh,
    async login(credentials) { const d = await api.post('/api/auth/login', credentials); setState({ user: d.user, unread: 0, loading: false }); await refresh(); return d.user; },
    async register(values) { const d = await api.post('/api/auth/register', values); setState({ user: d.user, unread: 0, loading: false }); return d.user; },
    async logout() { try { await api.post('/api/auth/logout'); } finally { setState({ user: null, unread: 0, loading: false }); } },
    setUser(user) { setState((s) => ({ ...s, user })); },
  }), [state, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const isStaff = (u) => u?.role === 'staff' || u?.role === 'admin';
export const isAdmin = (u) => u?.role === 'admin';
