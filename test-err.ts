import { createClient } from '@supabase/supabase-js';
const urls = [
  'https://xxx.supabase.co/',
  'https://xxx.supabase.co',
  'https://xxx.supabase.co/rest/v1',
  'https://xxx.supabase.co/rest/v1/',
  ' https://xxx.supabase.co',
  'https://xxx.supabase.co ',
  'https://xxx.supabase.co\n',
  'https://xxx.supabase.co/ ',
];
urls.forEach(url => {
  try {
    const supabase = createClient(url, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyA.xyz');
    supabase.from('plans').select('*').then(res => {
      console.log(`URL ${JSON.stringify(url)} res: ${res.error?.message}`);
    }).catch(e => {
      console.log(`URL ${JSON.stringify(url)} Promise Error: ${e.message}`);
    });
  } catch (e: any) {
    console.log(`URL ${JSON.stringify(url)} Constructor Error: ${e.message}`);
  }
});
