import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, refreshSession, setAccessToken, type AuthUser } from './api';

type AuthState = {
  user: AuthUser | null;
  ready: boolean;
  setUser: (user: AuthUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    refreshSession()
      .then((session) => setUser(session?.user ?? null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(() => ({ user, ready, setUser }), [user, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}

export async function login(email: string, password: string) {
  const result = await api<{ accessToken: string; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    skipRefresh: true,
  });
  setAccessToken(result.data.accessToken);
  return result.data.user;
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } finally {
    setAccessToken(null);
  }
}
