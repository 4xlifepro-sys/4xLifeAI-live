// test-formatter.ts

const formatSignalAlert = (isTp: boolean, hitLevel: string, pair: string, direction: string, entry: number, hitPrice: number, hitPips: number) => {
    const dt = new Date().toUTCString();
    const headerEmoji = isTp ? '🎯' : '🛑';
    const resultEmoji = isTp ? '✅' : '❌';
    const sign = isTp ? '+' : '-';
    // ensure hitPips is absolute
    const pipStr = Math.abs(hitPips).toFixed(1);
    
    return `${headerEmoji} <b>4XLIFEAI — ${hitLevel} HIT</b>\n\n`
    + `Pair: ${pair}\n`
    + `Signal: ${direction === 'LONG' ? 'BUY' : 'SELL'}\n`
    + `Bias: ${direction === 'LONG' ? 'BUY' : 'SELL'}\n`
    + `Entry: ${entry}\n`
    + `${hitLevel}: ${hitPrice}\n`
    + `Result: ${sign}${pipStr} pips ${resultEmoji}\n\n`
    + `Timestamp: ${dt}`;
}

console.log("=== TP1 HIT ===");
console.log(formatSignalAlert(true, 'TP1', 'ADAUSD', 'SELL', 0.5000, 0.4859, 14.1));

console.log("\n=== SL HIT ===");
console.log(formatSignalAlert(false, 'SL', 'XRPUSD', 'SELL', 0.6000, 0.6192, -19.2));

