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

  const loadSessionUser = async (authUser: SupabaseUser | null, clearMissing = true) => {
    if (!authUser) {
      if (clearMissing) {
        setCurrentUser(null);
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
    let initialSessionHandled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      if (event === 'INITIAL_SESSION') {
        initialSessionHandled = true;
        loadSessionUser(session?.user || null);
        return;
      }

      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      if (session?.user) {
        loadSessionUser(session.user, false);
        return;
      }

      setLoading(false);
    });

    supabase.auth.getSession()
      .then(({ data }) => {
        if (isMounted && !initialSessionHandled) {
          initialSessionHandled = true;
          loadSessionUser(data.session?.user || null);
        }
      })
      .catch(error => {
        console.error('Errore caricamento sessione iniziale:', error);
        if (isMounted && !initialSessionHandled) {
          initialSessionHandled = true;
          loadSessionUser(null);
        }
      });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loginAs = (profile: AppUser) => {
    setCurrentUser(profile);
  };

  const logout = async () => {
    localStorage.removeItem('familyledger_profile');
    await supabase.auth.signOut();
    setCurrentUser(null);
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
