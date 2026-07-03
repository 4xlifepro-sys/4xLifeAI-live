import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://xxx.supabase.co/rest/v1', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyA.xyz');
supabase.from('plans').select('*').then(res => console.log(res.error?.message)).catch(e => console.log(e.message));
