const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log(msg.text()));
  await page.evaluate(async () => {
    try {
      await fetch('https://invalid path.com');
    } catch(e) {
      console.log('1:', e.message);
    }
    try {
      await fetch('http://localhost:3000/ plans');
    } catch(e) {
      console.log('2:', e.message);
    }
    try {
      await fetch('/ plans');
    } catch(e) {
      console.log('3:', e.message);
    }
  });
  await browser.close();
})();
