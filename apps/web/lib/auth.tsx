'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, post, refreshSession, setAccessToken } from './api';
import { connectSocket, disconnectSocket } from './socket';
import type { User } from './types';

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: {
    username: string;
    email: string;
    password: string;
    displayName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  // On boot there is no access token in memory, but the refresh cookie may
  // still be valid - so try once to restore the session.
  useEffect(() => {
    (async () => {
      if (await refreshSession()) {
        const data = await api<{ user: User }>('/api/auth/me').catch(() => null);
        if (data) setUser(data.user);
      }
      setLoading(false);
    })();
  }, []);

  // The socket is opened once there is a session to authenticate it with, and
  // closed on sign-out so the next user does not inherit the connection.
  useEffect(() => {
    if (!user) return;
    connectSocket();
    return () => disconnectSocket();
  }, [user?.id]);

  async function authenticate(path: string, body: unknown) {
    const data = await post<{ user: User; accessToken: string }>(path, body);
    setAccessToken(data.accessToken);
    setUser(data.user);
    await queryClient.invalidateQueries();
  }

  const value: AuthState = {
    user,
    loading,
    login: (identifier, password) => authenticate('/api/auth/login', { identifier, password }),
    register: (input) => authenticate('/api/auth/register', input),
    logout: async () => {
      await post('/api/auth/logout').catch(() => undefined);
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
