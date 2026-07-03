import puppeteer from 'puppeteer';
import express from 'express';

const app = express();
app.use(express.static('public'));
app.get('*', (req, res) => res.send('<!doctype html><html><body><h1>Fake Index</h1></body></html>'));

const server = app.listen(3001, async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  
  await page.goto('http://localhost:3001/test-url.html');
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  server.close();
});
