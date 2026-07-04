import fs from 'fs';
const pairs = ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','ADAUSD','LTCUSD','BNBUSD','DOGEUSD'];
for (const pair of pairs) {
  for (const interval of ['5min','4h']) {
    const csv = fs.readFileSync('.cache/'+pair+'_'+interval+'_6m.csv','utf-8');
    const lines = csv.trim().split('\n').slice(1);
    const data = lines.map(line => {
      const [datetime, open, high, low, close] = line.split(';');
      return { timestamp: datetime.replace(' ','T')+'Z', open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close) };
    });
    fs.writeFileSync('.cache/'+pair+'_'+interval+'_6m.json', JSON.stringify(data));
    console.log('OK '+pair+' '+interval+' ('+data.length+' rows)');
  }
}
