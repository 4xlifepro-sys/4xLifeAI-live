import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  
  // We need to inject user auth to make the protected route show loading
  // Or we create a test page that just shows the LoadingScreen
  await page.goto('http://localhost:3000/loading', { waitUntil: 'load' });
  
  await browser.close();
})();
