import fs from 'fs';
function csvToJson(csvFile, jsonFile) {
  const csv = fs.readFileSync(csvFile, 'utf-8');
  const lines = csv.trim().split('\n').slice(1);
  const data = lines.map(line => {
    const [datetime, open, high, low, close] = line.split(';');
    return { timestamp: datetime.replace(' ', 'T') + 'Z', open: parseFloat(open), high: parseFloat(high), low: parseFloat(low), close: parseFloat(close) };
  });
  fs.writeFileSync(jsonFile, JSON.stringify(data));
  console.log(`Converted ${csvFile} -> ${jsonFile} (${data.length} rows)`);
}
csvToJson('.cache/USDJPY_5min_6m.csv', '.cache/USDJPY_5min_6m.json');
csvToJson('.cache/USDJPY_4h_6m.csv', '.cache/USDJPY_4h_6m.json');
csvToJson('.cache/AUDNZD_5min_6m.csv', '.cache/AUDNZD_5min_6m.json');
csvToJson('.cache/AUDNZD_4h_6m.csv', '.cache/AUDNZD_4h_6m.json');
