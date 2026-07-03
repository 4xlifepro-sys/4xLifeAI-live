import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'load' });
  
  await new Promise(r => setTimeout(r, 2000));
  const html = await page.content();
  console.log('HTML SNIPPET:', html.substring(0, 500));
  
  await browser.close();
})();
