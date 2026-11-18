// Dev helper: open a URL in headless Chromium and print console errors + DOM head.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] ?? 'http://localhost:4173/';
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('console', (m) => console.log('console', m.type(), m.text()));
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.route('https://mock.supabase.test/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p.goto(url, { timeout: 15000 });
  await p.waitForTimeout(2000);
  console.log(p.url());
  console.log((await p.locator('#root').innerHTML()).slice(0, 400));
  await b.close();
})();
