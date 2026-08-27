import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

 export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const checkAdmin = async (currentUser: User | null, accessToken?: string) => {
      if (!currentUser) {
        setIsAdmin(false);
        return;
      }

      setIsAdmin(false);

      const metadataRole = currentUser.app_metadata?.role || currentUser.user_metadata?.role;
      if (String(metadataRole || '').toUpperCase() === 'ADMIN') {
        setIsAdmin(true);
        return;
      }

      try {
        const response = await fetch('/api/auth/admin-status', {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });

        if (response.ok) {
          const result = await response.json();
          setIsAdmin(result?.isAdmin === true);
          return;
        }
      } catch (err) {
        console.error('Admin status endpoint failed:', err);
      }

      try {
        const userEmail = currentUser.email;
        if (!userEmail) {
          setIsAdmin(false);
          return;
        }

        const { data, error } = await supabase
          .from('users')
          .select('role')
          .ilike('email', userEmail.trim())
          .eq('role', 'ADMIN')
          .limit(1)
          ;

        if (error) {
          console.error('Admin access check failed:', error.message);
          setIsAdmin(false);
          return;
        }

        setIsAdmin((data || []).some(record => String(record.role || '').toUpperCase() === 'ADMIN'));
      } catch (err) {
        setIsAdmin(false);
      }
    };

    // Get active session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        checkAdmin(session.user, session.access_token).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }).catch(() => setLoading(false));

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        setTimeout(() => {
          checkAdmin(session.user, session.access_token).finally(() => setLoading(false));
        }, 0);
      } else {
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isAdmin, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
