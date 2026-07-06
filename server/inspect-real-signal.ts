import { supabase } from './supabase.js';

async function inspectRealSignalTable() {
  console.log('=== INSPECTING REAL "signal" TABLE ===\n');

  // Check if signal table exists and get columns
  const { data: sample, error } = await supabase
    .from('signal')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error querying signal table:', error.message);
    console.log('\nThis table might not exist either. Checking alternative names...');
    
    // Try signals (plural)
    const { data: alt, error: altErr } = await supabase.from('signals').select('*').limit(1);
    if (altErr) {
      console.log('❌ "signals" (plural) also fails:', altErr.message);
    } else {
      console.log('✅ "signals" (plural) exists! Columns:', alt && alt.length > 0 ? Object.keys(alt[0]) : 'empty table');
    }
    
    return;
  }

  if (!sample || sample.length === 0) {
    console.log('⚠️  signal table exists but is empty - cannot infer schema');
    console.log('\nTrying to insert a test row to see what columns are required...');
    
    // Try to get table metadata via information_schema
    const { data: columns, error: colErr } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'signal');
    
    if (colErr) {
      console.log('❌ Cannot query information_schema:', colErr.message);
    } else {
      console.log('✅ Real columns in "signal" table:');
      columns?.forEach((c: any) => console.log(`  - ${c.column_name} (${c.data_type})`));
    }
    
    return;
  }

  console.log('✅ "signal" table exists with columns:');
  const columns = Object.keys(sample[0]);
  columns.forEach(col => console.log(`  - ${col}`));
  
  console.log('\n📝 Sample row:');
  console.log(JSON.stringify(sample[0], null, 2));

  // Check if there's a status column
  const hasStatus = columns.includes('status');
  const hasActive = columns.includes('is_active');
  const hasResult = columns.includes('result');
  
  console.log('\n🔍 Column checks:');
  console.log(`  - has "status"? ${hasStatus ? '✅ YES' : '❌ NO'}`);
  console.log(`  - has "is_active"? ${hasActive ? '✅ YES' : '❌ NO'}`);
  console.log(`  - has "result"? ${hasResult ? '✅ YES' : '❌ NO'}`);

  // Check if signal_results exists
  console.log('\n=== CHECKING "signal_results" TABLE ===');
  const { data: results, error: resultsErr } = await supabase.from('signal_results').select('*').limit(1);
  if (resultsErr) {
    console.log('❌ signal_results does not exist:', resultsErr.message);
  } else {
    console.log('✅ signal_results exists');
    if (results && results.length > 0) {
      console.log('Columns:', Object.keys(results[0]));
    }
  }
}

inspectRealSignalTable().catch(console.error);
