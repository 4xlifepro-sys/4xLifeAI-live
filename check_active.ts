import { supabase } from './server/supabase.js';

async function checkActiveOpps() {
  const { data, error } = await supabase.from('active_opportunities').select('*');
  console.log("Error:", error);
  console.log("Active opportunities count:", data?.length);
  if (data) {
      data.forEach(d => console.log(d.pair, d.status, d.updated_at));
  }
}
checkActiveOpps();
