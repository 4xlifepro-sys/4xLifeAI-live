import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();
const supabaseAdmin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data: users, error: userError } = await supabaseAdmin.auth.admin.listUsers();
  if (userError) return console.log(userError);
  const user = users.users.find(u => u.email === 'tofamo1818@gmail.com' || u.email === '4xlifepro@gmail.com');
  console.log("Users found:", users.users.map(u => ({ email: u.email, id: u.id })));
  
  if (user) {
    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', user.id).single();
    console.log("Profile for", user.email, ":", profile);
  }
}
run();
