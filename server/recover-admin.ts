import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.argv[2];
const SUPABASE_SERVICE_ROLE_KEY = process.argv[3];
const email = 'tofamo1834@gmail.com';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Usage: npx tsx server/recover-admin.ts <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>');
  console.error('Find the service role key in: Supabase Dashboard > Settings > API > service_role key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function recover() {
  console.log('=== Account Recovery ===');

  // Check if user exists in auth
  const { data: authUsers, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) { console.error('Auth error:', listError.message); process.exit(1); }

  const authUserList = ((authUsers as any)?.users || []) as Array<{ id: string; email?: string | null }>;
  const existingUser = authUserList.find(u => u.email === email);
  
  if (existingUser) {
    console.log('✓ Auth user EXISTS');
    console.log('  ID:', existingUser.id);
  } else {
    console.log('⚠ Auth user MISSING - creating...');
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: 'Tofik123!',
      email_confirm: true,
      user_metadata: { full_name: 'Tofik Mohammed' }
    });
    if (createError) { console.error('Create error:', createError.message); process.exit(1); }
    console.log('✓ Auth user created, ID:', newUser.user.id);
  }

  // Check users table
  const { data: userRecord, error: userErr } = await supabase.from('users').select('*').eq('email', email).single();
  
  if (userRecord) {
    console.log('✓ users table row EXISTS, role:', userRecord.role);
  } else {
    console.log('⚠ users table row MISSING - creating...');
    const { data: fresh } = await supabase.auth.admin.listUsers();
    const freshUserList = ((fresh as any)?.users || []) as Array<{ id: string; email?: string | null }>;
    const authUser = freshUserList.find(u => u.email === email);
    if (authUser) {
      const { error: insErr } = await supabase.from('users').insert([{
        id: authUser.id, email, role: 'ADMIN', plan_status: 'PREMIUM', credits: 100
      }]);
      if (insErr) console.error('Insert error:', insErr.message);
      else console.log('✓ users row created with ADMIN role');
    }
  }

  console.log('\n=== Done ===');
  console.log('Login: ' + email);
  console.log('Password: Tofik123!');
}

recover();
