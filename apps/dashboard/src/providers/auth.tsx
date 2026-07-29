import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../lib/api';

type Session = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  onboarded: boolean;
};

interface AuthState {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  // True once any owned workspace has finished the onboarding wizard; public
  // pages label signed-in entry points "dashboard" vs "continue onboarding".
  onboarded: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (firstName: string, lastName: string) => Promise<void>;
  deleteAccount: (
    currentPassword: string,
    confirmation: string,
  ) => Promise<void>;
  markOnboarded: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Session>('/auth/me')
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (loginEmail: string, password: string) => {
    setSession(
      await api<Session>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password }),
      }),
    );
  }, []);

  const register = useCallback(
    async (registerEmail: string, password: string) => {
      setSession(
        await api<Session>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email: registerEmail, password }),
        }),
      );
    },
    [],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    setSession(null);
  }, []);

  const updateProfile = useCallback(
    async (firstName: string, lastName: string) => {
      const profile = await api<Pick<Session, 'firstName' | 'lastName'>>(
        '/auth/account',
        {
          method: 'PATCH',
          body: JSON.stringify({ firstName, lastName }),
        },
      );
      setSession((current) => (current ? { ...current, ...profile } : current));
    },
    [],
  );

  const deleteAccount = useCallback(
    async (currentPassword: string, confirmation: string) => {
      await api('/auth/account', {
        method: 'DELETE',
        body: JSON.stringify({ currentPassword, confirmation }),
      });
      setSession(null);
    },
    [],
  );

  // Completing the wizard flips the flag in-session, so a return to the
  // landing page shows dashboard entry points without a refetch.
  const markOnboarded = useCallback(() => {
    setSession((s) => (s ? { ...s, onboarded: true } : s));
  }, []);

  const value = useMemo(
    () => ({
      email: session?.email ?? null,
      firstName: session?.firstName ?? null,
      lastName: session?.lastName ?? null,
      onboarded: session?.onboarded ?? false,
      loading,
      login,
      register,
      logout,
      updateProfile,
      deleteAccount,
      markOnboarded,
    }),
    [
      session,
      loading,
      login,
      register,
      logout,
      updateProfile,
      deleteAccount,
      markOnboarded,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth outside AuthProvider');
  }
  return ctx;
};
