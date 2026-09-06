/* Reproduces the Android phone flow against a local wrangler dev server:
   1st load (online) → SW install → reload (SW-controlled) → go offline → reload.
   Run:  node tests/sw.offline.test.mjs   (needs `npm run dev` on :8788 or BASE_URL) */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8788';
const EXE = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (/shell|error/i.test(m.text())) console.log('  [page]', m.text()); });

console.log('1) Register an account (online)…');
const email = `demo${Date.now()}@test.com`;
const regRes = await fetch(BASE + '/api/auth/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'password123', name: 'Offline Demo' }),
});
const reg = { status: regRes.status, body: await regRes.json().catch(() => ({})) };
console.log(`   register → ${reg.status}, user id=${reg.body.user?.id}`);
if (reg.status >= 400) throw new Error('registration failed: ' + JSON.stringify(reg.body));

console.log('2) Log in (online)…');
await page.goto(BASE + '/#/login', { waitUntil: 'networkidle2', timeout: 30000 });
await page.type('input[name=email]', email);
await page.type('input[name=password]', 'password123');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
  page.click('button[type=submit]'),
]);
await page.waitForSelector('#view', { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500)); // let session persist to IndexedDB
const afterLogin = await page.evaluate(() => document.body.innerText.slice(0, 60).replace(/\n/g, ' '));
console.log('   After login, page shows:', afterLogin);

console.log('2) Service worker lifecycle diagnostics…');
const swInfo = await page.evaluate(() => new Promise((resolve) => {
  const out = { supported: 'serviceWorker' in navigator, registered: false, err: null, states: [], controller: !!navigator.serviceWorker.controller, pageErrors: [] };
  if (!out.supported) return resolve(out);
  const finish = () => resolve(out);
  window.addEventListener('error', (e) => out.pageErrors.push(String(e.message)));
  navigator.serviceWorker.addEventListener('controllerchange', () => { out.states.push('controllerchange'); });
  navigator.serviceWorker.addEventListener('error', (e) => { out.err = 'SW error event: ' + String(e.message || e.reason); });
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    out.registered = true;
    out.scope = reg.scope;
    out.installing = reg.installing ? reg.installing.state : null;
    out.waiting = reg.waiting ? reg.waiting.state : null;
    out.active = reg.active ? reg.active.state : null;
    const tracking = reg.installing || reg.waiting || reg.active;
    if (tracking) {
      out.states.push('initial:' + tracking.state);
      tracking.addEventListener('statechange', (e) => {
        out.states.push(e.target.state);
        if (e.target.state === 'activated' || e.target.state === 'redundant') setTimeout(finish, 300);
      });
    }
    setTimeout(finish, 9000); // don't hang forever
  }).catch((e) => { out.err = 'register() rejected: ' + String(e && e.message || e); finish(); });
}));
console.log('   ', JSON.stringify(swInfo, null, 2).replace(/\n\s*/g, ' '));

console.log('3) Reload so the worker controls the page…');
await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));

const cacheInfo = await page.evaluate(async () => {
  const names = await caches.keys();
  let total = 0;
  const perCache = {};
  for (const n of names) {
    const c = await caches.open(n);
    const keys = await c.keys();
    perCache[n] = keys.map((k) => new URL(k.url).pathname);
    total += keys.length;
  }
  return { names, total, perCache };
});
console.log(`   Cached assets: ${cacheInfo.total}`);
for (const [n, list] of Object.entries(cacheInfo.perCache)) {
  console.log(`   [${n}]`, list.join(', '));
}

console.log('4) GO OFFLINE and reload (the phone test)…');
await page.setOfflineMode(true);
let offlineOk = false;
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1000));
  const title = await page.title();
  const shell = await page.evaluate(() => !!document.getElementById('view'));
  const bodyStart = (await page.evaluate(() => document.body.innerText.slice(0, 80).replace(/\n/g, ' '))) || '';
  const notLoginPage = !bodyStart.toLowerCase().includes('sign in to continue');
  offlineOk = title.includes('WeightLoss') && shell && notLoginPage;
  console.log(`   OFFLINE reload → title: "${title}" | shell: ${shell} | still logged-in: ${notLoginPage}`);
  console.log(`   body: "${bodyStart}"`);
  if (!notLoginPage) console.log('   !! Offline shows the LOGIN page — session not cached !!');
} catch (e) {
  console.log('   OFFLINE reload FAILED →', e.message.slice(0, 120));
}

console.log('5) Offline + full fresh navigation (like reopening the installed app)…');
try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  const title = await page.title();
  const shell = await page.evaluate(() => !!document.getElementById('view'));
  console.log(`   Fresh offline open → title: "${title}" | shell present: ${shell}`);
  offlineOk = offlineOk && title.includes('WeightLoss') && shell;
} catch (e) {
  console.log('   Fresh offline open FAILED →', e.message.slice(0, 120));
  offlineOk = false;
}

await page.setOfflineMode(false);
await browser.close();
console.log(offlineOk ? '\n✅ OFFLINE WORKS locally — phone issue is stale site data / SW state.'
                      : '\n❌ OFFLINE BROKEN locally — real code bug, see above.');
process.exit(offlineOk ? 0 : 1);