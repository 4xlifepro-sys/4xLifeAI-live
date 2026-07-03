import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  const mockNotif = {
    user_id: 'f6e13e6d-868b-43d1-aec0-729bfb7686f1', 
    title: 'New Custom Alert',
    message: 'Test message'
  };
  
  const { error: err1 } = await supabase.from('notifications').insert([mockNotif]);
  console.log('Notif Insert Error:', err1);
}
run();
