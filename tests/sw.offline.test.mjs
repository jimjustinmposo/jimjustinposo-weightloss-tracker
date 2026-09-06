/* Full offline-first flow against a local wrangler dev server:
   register -> login -> complete profile (lands on dashboard) -> go offline
   -> log a weight (queued) -> go online -> auto-sync -> pill = Online.
   Run: node tests/sw.offline.test.mjs   (needs `npm run dev` on :8788 or BASE_URL) */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8788';
const EXE = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
page.on('console', (m) => { if (/shell|error/i.test(m.text())) console.log('  [page]', m.text()); });
const pill = () => page.evaluate(() => document.getElementById('conn-status')?.textContent || '(none)');

console.log('1) Register + log in (online)…');
const email = `demo${Date.now()}@test.com`;
const reg = await (await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', name: 'Offline Demo' }) })).json();
console.log('   user id=', reg.user?.id);

await page.goto(BASE + '/#/login', { waitUntil: 'networkidle2', timeout: 30000 });
await page.type('input[name=email]', email);
await page.type('input[name=password]', 'password123');
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}), page.click('button[type=submit]')]);
await sleep(2000);

// Complete the profile so the user lands on the dashboard (has the Log Weight button).
console.log('2) Complete profile…');
const onOnboarding = await page.evaluate(() => /profile|onboarding/i.test(location.hash) || !!document.querySelector('#pf-form'));
if (onOnboarding) {
  await page.type('input[name=age]', '30').catch(() => {});
  await page.type('input[name=height_cm]', '175').catch(() => {});
  await page.type('input[name=current_weight]', '90').catch(() => {});
  await page.click('button[type=submit]').catch(() => {});
  await sleep(1500);
}
const hasDash = await page.evaluate(() => !!document.querySelector('#qa-weight') || /Log Weight/i.test(document.body.innerText));
console.log('   dashboard ready (Log Weight visible):', hasDash);

console.log('3) Wait for service worker + cache warm…');
await sleep(3000);
const cacheCount = await page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) { n += (await caches.open(k)).keys().length; } return n; });
console.log('   cached assets:', cacheCount, '| pill:', await pill());

console.log('4) GO OFFLINE + log a weight…');
await page.setOfflineMode(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await sleep(500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Log Weight/i.test(b.textContent || ''));
  if (btn) btn.click();
});
await sleep(700);
await page.type('input[name=weight]', '83.3').catch(() => {});
await page.click('button[type=submit]').catch(() => {});
await sleep(700);
console.log('   pill while offline:', await pill());

console.log('5) GO ONLINE (dispatch event) — expect auto-sync to clear the queue…');
await page.setOfflineMode(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
let synced = false;
for (let i = 0; i < 30; i++) {
  await sleep(500);
  const t = await pill();
  if (/\bOnline\b/.test(t) && !/pending|syncing/i.test(t)) { synced = true; break; }
}
console.log('   pill after online:', await pill(), synced ? '✓ SYNCED' : '✗ STILL PENDING');

console.log('6) Verify weight reached the server…');
const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) })).json();
const w = await fetch(BASE + '/api/weights?limit=5').catch(() => null);
const entries = w ? await w.json().catch(() => ({ entries: [] })) : { entries: [] };
const found = entries.entries?.some((e) => Math.abs(Number(e.weight) - 83.3) < 0.01);
console.log('   ', found ? '✓ weight 83.3 on server' : '✗ weight NOT on server');

await browser.close();
const pass = hasDash && cacheCount >= 17 && synced && found;
console.log(pass ? '\n✅ AUTO-SYNC WORKS.' : '\n❌ AUTO-SYNC BROKEN.');
process.exit(pass ? 0 : 1);