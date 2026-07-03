import { supabase } from './server/supabase.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
async function run() {
    const pair = 'EURUSD';
    const entryTf = await fetchCandles(pair, '15min');
    if (!entryTf) { console.log('no candles'); return; }
    const currentPrice = entryTf[entryTf.length - 1];
    console.log('Current price:', currentPrice);
    const { data: activeSignals } = await supabase.from('signals').select('*').eq('pair', pair).eq('is_active', true);
    console.log('Active signals:', activeSignals);
    for (const s of activeSignals!) {
        console.log('sEntry:', s.entry_price || s.entry);
        console.log('sl:', s.sl);
        console.log('tp3:', s.tp3);
        console.log('currentPrice.high:', currentPrice.high);
        console.log('>= tp3?', currentPrice.high >= s.tp3);
    }
}
run();
