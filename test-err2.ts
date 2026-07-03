import { createClient } from '@supabase/supabase-js';
try {
  const supabase = createClient('', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyA.xyz');
  supabase.from('plans').select('*').then(res => console.log(res)).catch(e => console.log(e.message));
} catch(e: any) {
  console.log("Empty:", e.message);
}
try {
  const supabase2 = createClient('http://localhost', '');
  supabase2.from('plans').select('*').then(res => console.log(res)).catch(e => console.log(e.message));
} catch(e: any) {
  console.log("EmptyKey:", e.message);
}
