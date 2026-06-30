import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import type { Profile } from '../types/database';

type AppUser = Profile & {
  auth_user?: SupabaseUser;
};

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  loginAs: (profile: AppUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginAs: () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

const getDisplayName = (authUser: SupabaseUser) => {
  const metadataName = authUser.user_metadata?.display_name || authUser.user_metadata?.name;
  if (metadataName) return String(metadataName);
  if (authUser.email) return authUser.email.split('@')[0];
  return 'Utente';
};

const readHashParams = () => new URLSearchParams(window.location.hash.replace(/^#/, ''));

const hasAuthCallbackInUrl = () => {
  const url = new URL(window.location.href);
  const hashParams = readHashParams();
  return Boolean(
    url.searchParams.get('code')
    || url.searchParams.get('error')
    || hashParams.get('access_token')
    || hashParams.get('error')
  );
};

const cleanAuthCallbackUrl = () => {
  const url = new URL(window.location.href);
  [
    'code',
    'state',
    'error',
    'error_code',
    'error_description',
    'type',
  ].forEach(param => url.searchParams.delete(param));

  url.hash = '';
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}`);
};

const ensureProfile = async (authUser: SupabaseUser): Promise<AppUser> => {
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  const displayName = existingProfile?.display_name || getDisplayName(authUser);
  const email = existingProfile?.email || authUser.email || null;

  if (!existingProfile || existingProfile.display_name !== displayName || existingProfile.email !== email) {
    const { data: savedProfile, error } = await supabase
      .from('profiles')
      .upsert({
        id: authUser.id,
        display_name: displayName,
        email,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;
    return { ...(savedProfile as Profile), auth_user: authUser };
  }

  return { ...(existingProfile as Profile), auth_user: authUser };
};

export const AuthProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const userRef = useRef<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const setCurrentUser = (nextUser: AppUser | null) => {
    userRef.current = nextUser;
    setUser(nextUser);
  };

  const clearCurrentUser = () => {
    setCurrentUser(null);
    setLoading(false);
  };

  const loadSessionUser = async (authUser: SupabaseUser | null, clearMissing = true) => {
    if (!authUser) {
      if (clearMissing) {
        clearCurrentUser();
      }
      setLoading(false);
      return;
    }

    try {
      const profile = await ensureProfile(authUser);
      const currentUser = userRef.current;

      if (
        currentUser
        && currentUser.id === profile.id
        && currentUser.display_name === profile.display_name
        && currentUser.email === profile.email
      ) {
        userRef.current = { ...currentUser, auth_user: authUser };
        setLoading(false);
        return;
      }

      setCurrentUser(profile);
    } catch (error) {
      console.error('Errore caricamento profilo autenticato:', error);
      if (!userRef.current) {
        setCurrentUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    if (!userRef.current) {
      setLoading(true);
    }
    const { data } = await supabase.auth.getUser();
    await loadSessionUser(data.user);
  };

  useEffect(() => {
    localStorage.removeItem('familyledger_profile');

    let isMounted = true;

    const loadInitialSession = async () => {
      const url = new URL(window.location.href);
      const hashParams = readHashParams();
      const code = url.searchParams.get('code');
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const callbackInUrl = hasAuthCallbackInUrl();

      try {
        const callbackError = url.searchParams.get('error_description')
          || url.searchParams.get('error')
          || hashParams.get('error_description')
          || hashParams.get('error');

        if (callbackError) {
          throw new Error(callbackError);
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        }

        const { data } = await supabase.auth.getSession();
        if (isMounted) {
          loadSessionUser(data.session?.user || null);
        }
      } catch (error) {
        console.error('Errore caricamento sessione iniziale:', error);
        if (isMounted) {
          loadSessionUser(null);
        }
      } finally {
        if (callbackInUrl) {
          cleanAuthCallbackUrl();
        }
      }
    };

    void loadInitialSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const loginAs = (profile: AppUser) => {
    setCurrentUser(profile);
  };

  const logout = async () => {
    localStorage.removeItem('familyledger_profile');
    await supabase.auth.signOut();
    clearCurrentUser();
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginAs, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
