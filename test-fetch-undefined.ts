import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '', 
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

async function run() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', undefined as any)
    .order('created_at', { ascending: false })
    .limit(20);
    
  console.log('Error 1:', error);
}
run();
