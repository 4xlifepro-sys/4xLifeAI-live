import { supabase } from './supabase.js';

async function discoverSignalsColumns() {
  console.log('=== DISCOVERING REAL SIGNALS TABLE COLUMNS ===\n');
  
  // Try to get schema via SQL query
  const { data: schemaData, error: schemaError } = await supabase
    .from('information_schema.columns')
    .select('column_name, data_type, is_nullable')
    .eq('table_name', 'signals')
    .order('ordinal_position');
  
  if (schemaError) {
    console.log('⚠ Cannot query information_schema:', schemaError.message);
    console.log('Will try inserting a test row to discover columns...\n');
  } else if (schemaData && schemaData.length > 0) {
    console.log('✅ Real columns in "signals" table:');
    schemaData.forEach((col: any) => {
      console.log(`   - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? '[nullable]' : '[required]'}`);
    });
    return;
  }

  // Try inserting a minimal row to see what's required
  console.log('Attempting to insert test row with minimal columns...');
  const { data: insert1, error: error1 } = await supabase
    .from('signals')
    .insert([{ pair: 'TEST', direction: 'LONG' }])
    .select('*')
    .single();

  if (error1) {
    console.log('Insert 1 failed:', error1.message);
    console.log('Trying with more columns...');
  } else {
    console.log('✅ Insert succeeded! Returned columns:', Object.keys(insert1 || {}));
    console.log('Row:', JSON.stringify(insert1, null, 2));
    return;
  }

  // Try with different column combinations
  const testPayloads = [
    { pair: 'TEST', direction: 'LONG', entry_price: 1.0, sl: 0.99, tp1: 1.01, created_at: new Date().toISOString(), status: 'ACTIVE', is_active: true },
    { pair: 'TEST', direction: 'LONG', entry: 1.0, sl: 0.99, tp1: 1.01, created_at: new Date().toISOString() },
    { pair: 'TEST', direction: 'LONG', entry_price: 1.0, sl: 0.99, tp1: 1.01, tp2: 1.02, tp3: 1.03, created_at: new Date().toISOString(), status: 'ACTIVE', is_active: true, confidence: 75, tier: 'A+' }
  ];

  for (let i = 0; i < testPayloads.length; i++) {
    console.log(`\nTrying payload ${i + 1}...`);
    const { data, error } = await supabase.from('signals').insert([testPayloads[i]]).select('*').single();
    if (error) {
      console.log('  Failed:', error.message);
      if (error.message.includes('null value in column')) {
        const match = error.message.match(/column "([^"]+)"/);
        if (match) console.log(`  → Missing required column: "${match[1]}"`);
      }
    } else {
      console.log('  ✅ Success! Columns accepted:', Object.keys(data || {}).join(', '));
      console.log('  Full row:', JSON.stringify(data, null, 2));
      
      // Clean up test row
      if (data?.id) {
        await supabase.from('signals').delete().eq('id', data.id);
        console.log('  Cleaned up test row');
      }
      return;
    }
  }

  console.log('\n❌ All insert attempts failed. Table might have strict RLS or constraints.');
  console.log('Check Supabase dashboard → Table Editor → signals table → column definitions.');
}

discoverSignalsColumns().catch(console.error);
