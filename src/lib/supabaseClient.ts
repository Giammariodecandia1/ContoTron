import { createClient } from '@supabase/supabase-js';
// import type { Database } from '../types/supabase_generated';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Create a single supabase client for interacting with your database.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // La sessione dell'app dura circa un'ora. Il rinnovo automatico e
    // necessario anche per l'accesso al token Google Drive custodito lato server.
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
  },
});
