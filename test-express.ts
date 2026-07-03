import http from 'http';

http.get('http://localhost:3000/rest/v1/plans?select=*', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});
