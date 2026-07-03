import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  
  // Give React 100ms to render the initial state (which should be LoadingScreen)
  await new Promise(r => setTimeout(r, 100));
  
  const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML);
  console.log('ROOT HTML D:\n', rootHtml);
  
  await browser.close();
})();
