import { supabase } from './server/supabase.js';

async function checkStats() {
  const { data, error } = await supabase.from('scanner_stats').select('*');
  console.log("Stats error:", error);
  console.log("Scanner Stats:", data);
}
checkStats();
