import { supabase } from './server/supabase.js';
import { fetchCandles } from './server/twelvedata-scanner.js';
async function run() {
    const pair = 'EURUSD';
    const entryTf = await fetchCandles(pair, '15min');
    if (!entryTf) { console.log('no candles'); return; }
    const currentPrice = entryTf[entryTf.length - 1];
    
    const { data: activeSignals } = await supabase.from('signals').select('*').eq('pair', pair).eq('is_active', true);
    for (const s of activeSignals!) {
        const isLong = s.direction === 'LONG' || s.direction === 'BUY';
        const sEntry = s.entry_price || s.entry;
        let isHit = false;
        let finalClose = false;
        let hitLevel = '';
        let hitPrice = 0;
        let newStatus = s.status;
        let tpRecordStr = '';
        let rawPips = 0;
        
        const calculatePips = (price1: number, price2: number) => {
            const isJpy = pair.includes('JPY');
            const multiplier = isJpy ? 100 : 10000;
            return (price1 - price2) * multiplier;
        }

        if (isLong) {
            if (currentPrice.low <= s.sl) {
            } else if (currentPrice.high >= s.tp3 && s.status !== 'TP3 HIT') {
                isHit = true; finalClose = true;
                hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'CLOSED';
                tpRecordStr = 'tp3_hit_at';
                rawPips = calculatePips(s.tp3, sEntry);
            }
        }
        
        if (isHit) {
            const dt = new Date();
            const closedAt = dt.toISOString();
            
            let finalResult = 'LOSS';
            if (finalClose) {
                if (hitLevel === 'TP3') finalResult = 'WIN';
            }
            
            let updatePayload: any = { status: newStatus };
            if (tpRecordStr) {
                updatePayload[tpRecordStr] = closedAt;
            }
            
            if (finalClose) {
                updatePayload.is_active = false;
                updatePayload.closed_at = closedAt;
                updatePayload.result = finalResult;
                if (finalResult === 'WIN') {
                    updatePayload.pips_won = rawPips;
                } else {
                    updatePayload.pips_lost = rawPips;
                }
            }
            console.log('Updating with payload:', updatePayload);
            const { data, error } = await supabase.from('signals').update(updatePayload).eq('id', s.id).select();
            console.log('Update result:', { data, error });
        }
    }
}
run();
