import { supabase } from './supabase.js';

async function diagnose() {
  if (!supabase) { console.error('❌ Supabase not connected'); return; }

  console.log('=== FULL SUPABASE DIAGNOSTIC ===\n');

  // 1. Try signals table - get real columns by querying known column
  console.log('--- SIGNALS TABLE ---');
  const { data: sig1, error: sigErr1 } = await supabase.from('signals').select('id, pair, direction').order('created_at', { ascending: false }).limit(5);
  if (sigErr1) {
    console.log('ERROR querying signals:', sigErr1.message);
  } else {
    console.log('Found', sig1?.length ?? 0, 'rows');
    if (sig1 && sig1.length > 0) {
      console.log('Sample columns:', Object.keys(sig1[0]));
      console.log('Sample rows:', JSON.stringify(sig1, null, 2));
    }
  }

  // 2. Try getting ALL columns from signals via select *
  console.log('\n--- SIGNALS * ---');
  const { data: sigAll, error: sigErrAll } = await supabase.from('signals').select('*').limit(1);
  if (sigErrAll) {
    console.log('ERROR:', sigErrAll.message);
  } else if (sigAll && sigAll.length > 0) {
    console.log('All columns:', Object.keys(sigAll[0]).join(', '));
    console.log('Full row:', JSON.stringify(sigAll[0], null, 2));
  } else {
    console.log('Table exists but is EMPTY');
  }

  // 3. Check is_active specifically
  console.log('\n--- TESTING is_active COLUMN ---');
  const { data: sigIA, error: sigIAErr } = await supabase.from('signals').select('id').eq('is_active', true).limit(1);
  if (sigIAErr) {
    console.log('is_active DOES NOT EXIST:', sigIAErr.message);
  } else {
    console.log('is_active EXISTS, found', sigIA?.length, 'rows');
  }

  // 4. Check status column
  console.log('\n--- TESTING status COLUMN ---');
  const { data: sigSt, error: sigStErr } = await supabase.from('signals').select('id').eq('status', 'ACTIVE').limit(1);
  if (sigStErr) {
    console.log('status DOES NOT EXIST:', sigStErr.message);
  } else {
    console.log('status EXISTS');
  }

  // 5. Check active_until column
  console.log('\n--- TESTING active_until COLUMN ---');
  const { data: sigAU, error: sigAUErr } = await supabase.from('signals').select('id, active_until').limit(1);
  if (sigAUErr) {
    console.log('active_until DOES NOT EXIST:', sigAUErr.message);
  } else {
    console.log('active_until EXISTS:', sigAU?.[0]);
  }

  // 6. Check signal_results
  console.log('\n--- SIGNAL_RESULTS TABLE ---');
  const { data: sr, error: srErr } = await supabase.from('signal_results').select('*').order('created_at', { ascending: false }).limit(5);
  if (srErr) {
    console.log('ERROR:', srErr.message);
  } else {
    console.log('Found', sr?.length ?? 0, 'rows');
    if (sr && sr.length > 0) {
      console.log('Columns:', Object.keys(sr[0]).join(', '));
      sr.forEach(r => console.log(`  - ${r.pair} | ${r.direction} | status=${r.status} | result=${r.result} | rr=${r.rr_achieved}`));
    } else {
      console.log('Table exists but EMPTY');
    }
  }

  // 7. Try to list all tables via raw SQL
  console.log('\n--- ALL TABLES ---');
  try {
    const { data: tables, error: tablesErr } = await (supabase as any)
      .from('pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');
    if (tablesErr) console.log('pg_tables error:', tablesErr.message);
    else console.log('Tables:', tables?.map((t: any) => t.tablename).join(', '));
  } catch (e: any) {
    console.log('pg_tables error:', e.message);
  }

  // 8. Count signals by various methods
  console.log('\n--- SIGNAL COUNTS ---');
  const { count: totalSigs } = await supabase.from('signals').select('*', { count: 'exact', head: true });
  console.log('Total signals:', totalSigs);

  const { count: recentSigs } = await supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString());
  console.log('Signals in last 24h:', recentSigs);

  // 9. Count signal_results
  const { count: totalResults } = await supabase.from('signal_results').select('*', { count: 'exact', head: true });
  console.log('Total signal_results:', totalResults);

  console.log('\n=== DONE ===');
}

diagnose().catch(console.error);
