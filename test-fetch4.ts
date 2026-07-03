import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '', 
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

async function run() {
  // Login first?
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: '4xlifepro@gmail.com', // user email from metadata
    password: 'password123' // generic password, maybe it fails, we can just grab a user id
  });
  
  const userId = 'f6e13e6d-868b-43d1-aec0-729bfb7686f1'; // from test-fetch2.ts output
  
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
    
  console.log('Error 1:', error);
  
  const { count, error: countError } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
    
  console.log('Error 2:', countError);
}
run();
