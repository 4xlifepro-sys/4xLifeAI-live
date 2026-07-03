import http from 'http';

http.get('http://127.0.0.1:3000/api/health', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('HEALTH:', data));
}).on('error', err => console.log('Error:', err.message));

http.get('http://127.0.0.1:3000/api/state', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('STATE:', data.substring(0, 500) + '...'));
}).on('error', err => console.log('Error:', err.message));
