import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  page.on('response', resp => {
     if (resp.status() >= 400) {
        console.log('HTTP ERROR', resp.status(), resp.url());
     }
  });

  await page.goto('http://localhost:3000/login', { waitUntil: 'load' });
  
  await browser.close();
})();
