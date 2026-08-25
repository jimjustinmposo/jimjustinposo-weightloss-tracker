#!/usr/bin/env node
/**
 * Local Telegram dev-poller.
 * Long-polls Telegram getUpdates and forwards every update to the LOCAL
 * worker webhook (http://127.0.0.1:8787/api/telegram/webhook) with the shared
 * secret — so the full bot works in local development WITHOUT a public HTTPS
 * URL or deployment.
 *
 * Usage:  terminal A: npm run dev      terminal B: npm run tg:poll
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- tiny .dev.vars parser ---- */
const vars = {};
try {
  for (const line of readFileSync(join(root, '.dev.vars'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) vars[m[1]] = m[2].trim();
  }
} catch {
  console.error('❌ .dev.vars not found next to the project root.');
  process.exit(1);
}

const TOKEN = vars.TELEGRAM_BOT_TOKEN;
const SECRET = vars.TELEGRAM_WEBHOOK_SECRET || '';
if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN missing in .dev.vars');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
const WORKER = process.env.TG_WORKER_URL || 'http://127.0.0.1:8787/api/telegram/webhook';
let offset = 0;

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

console.log('🤖 Telegram dev-poller starting…');
const me = await tg('getMe');
if (!me?.ok) {
  console.error('❌ getMe failed — token looks invalid:', me?.description ?? me);
  process.exit(1);
}
console.log(`✅ Authenticated as @${me.result.username}`);

// Polling conflicts with a registered webhook — clear any stale one.
const dw = await tg('deleteWebhook', { drop_pending_updates: false });
console.log(dw.ok ? '🧹 Stale webhook cleared (polling mode).' : `⚠️ deleteWebhook: ${dw.description}`);
console.log(`➡️  Forwarding updates to ${WORKER}`);
console.log('💬 Open your bot in Telegram and send /start\n');

let backoff = 1000;
for (;;) {
  try {
    const res = await fetch(`${API}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }),
      signal: AbortSignal.timeout(35_000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description ?? 'getUpdates failed');
    backoff = 1000;
    for (const upd of data.result) {
      offset = upd.update_id + 1;
      try {
        const r = await fetch(WORKER, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET },
          body: JSON.stringify(upd),
        });
        console.log(`↗️  update ${upd.update_id} → worker ${r.status}`);
        if (!r.ok) console.log('   ', (await r.text()).slice(0, 200));
        const kind = upd.message ? `text: "${upd.message.text}"` : `callback: ${upd.callback_query?.data}`;
        console.log(`   ← from ${upd.message?.from?.id ?? upd.callback_query?.from?.id}: ${kind}`);
      } catch (e) {
        console.error(`⚠️ forward failed (${e.message}) — will retry this update on next poll.`);
        offset--; // don't advance so it's retried
        break;
      }
    }
  } catch (e) {
    console.error(`⏳ ${e.message} — retrying in ${backoff / 1000}s`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 15000);
  }
}
