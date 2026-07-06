import { supabase } from './supabase.js';

async function inspectSchema() {
  if (!supabase) {
    console.error('❌ Supabase not connected');
    return;
  }

  console.log('🔍 INSPECTING ACTUAL SUPABASE SCHEMA\n');

  // Get signals table schema
  const { data: signalsColumns, error: signalsError } = await supabase
    .from('signals')
    .select('*')
    .limit(1);

  if (signalsError) {
    console.error('❌ Failed to query signals table:', signalsError.message);
  } else if (signalsColumns && signalsColumns.length > 0) {
    console.log('✅ signals table columns:');
    const columns = Object.keys(signalsColumns[0]);
    columns.forEach(col => console.log(`   - ${col}`));
    console.log(`\n   Total: ${columns.length} columns\n`);
  } else {
    console.log('⚠ signals table exists but is empty (cannot infer schema from empty table)\n');
  }

  // Get signal_results table schema
  const { data: resultsColumns, error: resultsError } = await supabase
    .from('signal_results')
    .select('*')
    .limit(1);

  if (resultsError) {
    console.error('❌ Failed to query signal_results table:', resultsError.message);
  } else if (resultsColumns && resultsColumns.length > 0) {
    console.log('✅ signal_results table columns:');
    const columns = Object.keys(resultsColumns[0]);
    columns.forEach(col => console.log(`   - ${col}`));
    console.log(`\n   Total: ${columns.length} columns\n`);
  } else {
    console.log('⚠ signal_results table exists but is empty\n');
  }

  // Try to get all tables
  console.log('📋 Attempting to list all tables...');
  const { data: tables, error: tablesError } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public');

  if (tablesError) {
    console.log('⚠ Cannot query information_schema directly (expected - Supabase restricts this)');
    console.log('   But we got the column names from the actual table queries above.\n');
  } else {
    console.log('✅ All tables in public schema:');
    tables.forEach((t: any) => console.log(`   - ${t.table_name}`));
  }
}

inspectSchema().catch(console.error);
