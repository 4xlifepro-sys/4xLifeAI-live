const fs = require('fs');
let code = fs.readFileSync('server/scanner.ts', 'utf8');
code = code.replace(
/              const mult \= pair\.includes\('JPY'\) \? 100 : 10000;[\s\S]*?\/\/ 1\. Update signals table/,
`              const pipMult = getPipMultiplier(pair);
              const calculatePips = (price1: number, price2: number) => {
                 return Math.abs(price1 - price2) / pipMult;
              };
          
              const sEntry = s.entry_price || s.entry || 0;
              let isHit = false;
              let finalClose = false;
              let hitLevel = '';
              let hitPrice = 0;
              let rawPips = 0;
              let newStatus = s.status || 'ACTIVE';
              let tpRecordStr = '';
          
              const isLong = s.direction === 'LONG' || s.signal === 'BUY';

              if (isLong) {
                 if (currentPrice.low <= s.sl) {
                    isHit = true; finalClose = true;
                    hitLevel = 'SL'; hitPrice = s.sl; newStatus = 'CLOSED';
                    rawPips = calculatePips(sEntry, s.sl);
                 } else if (currentPrice.high >= s.tp3 && s.status !== 'TP3 HIT') {
                    isHit = true; finalClose = true;
                    hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'CLOSED'; tpRecordStr = 'tp3_hit_at';
                    rawPips = calculatePips(s.tp3, sEntry);
                 } else if (currentPrice.high >= s.tp2 && !['TP2 HIT', 'TP3 HIT'].includes(s.status)) {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP2'; hitPrice = s.tp2; newStatus = 'TP2 HIT'; tpRecordStr = 'tp2_hit_at';
                    rawPips = calculatePips(s.tp2, sEntry);
                 } else if (currentPrice.high >= s.tp1 && s.status === 'ACTIVE') {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP1'; hitPrice = s.tp1; newStatus = 'TP1 HIT'; tpRecordStr = 'tp1_hit_at';
                    rawPips = calculatePips(s.tp1, sEntry);
                 }
              } else { 
                 if (currentPrice.high >= s.sl) {
                    isHit = true; finalClose = true;
                    hitLevel = 'SL'; hitPrice = s.sl; newStatus = 'CLOSED';
                    rawPips = calculatePips(sEntry, s.sl);
                 } else if (currentPrice.low <= s.tp3 && s.status !== 'TP3 HIT') {
                    isHit = true; finalClose = true;
                    hitLevel = 'TP3'; hitPrice = s.tp3; newStatus = 'CLOSED'; tpRecordStr = 'tp3_hit_at';
                    rawPips = calculatePips(sEntry, s.tp3);
                 } else if (currentPrice.low <= s.tp2 && !['TP2 HIT', 'TP3 HIT'].includes(s.status)) {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP2'; hitPrice = s.tp2; newStatus = 'TP2 HIT'; tpRecordStr = 'tp2_hit_at';
                    rawPips = calculatePips(sEntry, s.tp2);
                 } else if (currentPrice.low <= s.tp1 && s.status === 'ACTIVE') {
                    isHit = true; finalClose = false;
                    hitLevel = 'TP1'; hitPrice = s.tp1; newStatus = 'TP1 HIT'; tpRecordStr = 'tp1_hit_at';
                    rawPips = calculatePips(sEntry, s.tp1);
                 }
              }
          
              if (isHit) {
                 const dt = new Date();
                 const closedAt = dt.toISOString();
                 const headerEmoji = hitLevel === 'SL' ? '🛑' : '🎯';
                 const resultEmoji = hitLevel === 'SL' ? '❌' : '✅';
                 const sign = hitLevel === 'SL' ? '-' : '+';
                 const pipStr = Math.abs(rawPips).toFixed(1);
                 
                 const directionStr = isLong ? 'BUY' : 'SELL';
                 const hitMsg = \`\${headerEmoji} <b>4XLIFEAI — \${hitLevel} HIT</b>\\n\\n\`
                 + \`Pair: \${pair}\\n\`
                 + \`Signal: \${directionStr}\\n\`
                 + \`Entry: \${sEntry}\\n\`
                 + \`\${hitLevel}: \${hitPrice}\\n\`
                 + \`Result: \${sign}\${pipStr} pips \${resultEmoji}\\n\\n\`
                 + \`Timestamp: \${dt.toUTCString()}\`;
                 
                 console.log(\`[OUTCOME TRACKER] \${pair} \${hitLevel} HIT @ \${closedAt}\`);
                 sendTelegramMessage(hitMsg);
                 
                 const finalResult = (hitLevel === 'SL') ? 'LOSS' : 'WIN';
                 
                 // Payload construction for Supabase update
                 const updatePayload: any = { status: newStatus };
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
                 
                 // 1. Update signals table`
);

code = code.replace(
/                 const { error: sigUpdateErr } = await supabase[\s\S]*?                 const { error: auditUpdateErr } = await supabase[\s\S]*?                   \.eq\('status', 'ACTIVE'\);/m,
`                 const { error: sigUpdateErr } = await supabase
                   .from('signals')
                   .update(updatePayload)
                   .eq('id', s.id);
                   
                 if (sigUpdateErr) {
                   if (sigUpdateErr.message.includes('Could not find') || sigUpdateErr.message.includes('schema cache')) {
                       const safePayload = { ...updatePayload };
                       if (tpRecordStr) delete safePayload[tpRecordStr];
                       delete safePayload.closed_at;
                       await supabase.from('signals').update(safePayload).eq('id', s.id);
                   } else {
                       console.error("Failed to update signals table:", sigUpdateErr.message);
                   }
                 }
                 
                 // 2. Update signal_audit_log via linked query to prevent duplicates
                 const { data: auditMatches } = await supabase
                   .from('signal_audit_log')
                   .select('id')
                   .eq('pair', pair)
                   .eq('entry', sEntry)
                   .neq('status', 'CLOSED')
                   .limit(1);
                   
                 if (auditMatches && auditMatches.length > 0) {
                   const { error: auditUpdateErr } = await supabase
                     .from('signal_audit_log')
                     .update(updatePayload)
                     .eq('id', auditMatches[0].id);

                   if (auditUpdateErr) {
                     if (auditUpdateErr.message.includes('Could not find') || auditUpdateErr.message.includes('schema cache')) {
                         const safePayload = { ...updatePayload };
                         if (tpRecordStr) delete safePayload[tpRecordStr];
                         delete safePayload.closed_at;
                         await supabase.from('signal_audit_log').update(safePayload).eq('id', auditMatches[0].id);
                     } else {
                         console.error("Failed to update signal_audit_log:", auditUpdateErr.message);
                     }
                   }
                 }`
);

fs.writeFileSync('server/scanner.ts', code);
