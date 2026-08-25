import { Hono } from 'hono';
import type { AppVars, Env } from '../types';
import type { MealType } from '../types';
import { getCatalogFood, insertFoodLog, scaleFood } from './logs';
import { applyWeightLog } from './weights';
import { getDaySummary } from './dashboard';
import { AiUnavailableError, extractFoods } from '../telegram/ai';
import {
  MEAL_LABELS,
  convertToGrams,
  decideFoodMatch,
  detectPrep,
  extractMealPrefix,
  formatMealAnalysis,
  formatSaved,
  formatToday,
  normalizeAiItems,
  scaleMacros,
  sumNutrition,
} from '../telegram/textparse';

type Any = Record<string, unknown>;

type PendingItem = {
  label: string;
  qty: number | null;
  unit: string;
  status: 'ok' | 'choose' | 'prep';
  foodId?: number;
  foodName?: string;
  grams?: number;
  amountLabel?: string;
  query?: string;
  options?: Array<{ id: number; name: string }>;
};

type PendingPayload = {
  chat_id: number;
  message_id?: number;
  meal: MealType;
  date: string;
  stage: 'resolving' | 'ready';
  items: PendingItem[];
};

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

/* ------------------------------------------------------------------ */
/* Telegram Bot API helpers (all failures are logged, never thrown)    */
/* ------------------------------------------------------------------ */

async function tgCall(env: Env, method: string, body: Record<string, unknown>): Promise<unknown | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log(`[telegram] TELEGRAM_BOT_TOKEN not set — skipped ${method}`);
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[telegram] ${method} HTTP ${res.status}:`, await res.text());
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`[telegram] ${method} network failure:`, e);
    return null;
  }
}

type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

function sendMessage(env: Env, chatId: number, text: string, keyboard?: InlineKeyboard) {
  return tgCall(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

function editMessage(env: Env, chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
  return tgCall(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

function answerCallback(env: Env, cbId: string, text?: string) {
  return tgCall(env, 'answerCallbackQuery', { callback_query_id: cbId, text });
}

/** "Today" for the bot user, honoring the configured UTC offset hours. */
function botToday(env: Env): string {
  const offH = Number(env.TELEGRAM_TZ_OFFSET_HOURS ?? 0);
  const d = new Date(Date.now() + (Number.isFinite(offH) ? offH : 0) * 3600_000);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* User mapping / authorization                                        */
/* ------------------------------------------------------------------ */

async function getAppUserId(db: D1Database, telegramUserId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT application_user_id FROM telegram_users WHERE telegram_user_id = ?1')
    .bind(String(telegramUserId))
    .first<{ application_user_id: number }>();
  return row?.application_user_id ?? null;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/**
 * Generate a short-lived linking code from the web app (session-authenticated).
 * The user then sends `/link CODE` to the bot to bind their Telegram account.
 */
app.post('/link-code', async (c) => {
  const userId = c.get('userId');
  const code = generateCode();
  await c.env.DB.prepare('DELETE FROM telegram_link_codes WHERE application_user_id = ?1 AND used_at IS NULL')
    .bind(userId)
    .run();
  await c.env.DB.prepare(
    `INSERT INTO telegram_link_codes (code, application_user_id, expires_at)
     VALUES (?1, ?2, datetime('now', '+15 minutes'))`
  )
    .bind(code, userId)
    .run();
  return c.json({ code, expires_in_minutes: 15 }, 201);
});

const LINK_HELP =
  "🔒 This Telegram account isn't linked to any tracker profile.\n\n" +
  '1. Open the web app → Profile → “Telegram” → Generate link code\n' +
  '2. Send me: /link YOURCODE';

const HELP_TEXT =
  '🤖 <b>Food logging bot</b>\n\n' +
  'Send what you ate in plain language:\n' +
  '<i>300g chicken breast, 4 eggs and 20g salted butter</i>\n' +
  '<i>Breakfast: 4 eggs and 20g butter</i>\n' +
  '<i>10 oz ribeye</i>\n\n' +
  'You confirm before anything is saved.\n\n' +
  '<b>Commands</b>\n' +
  '/today – today\'s totals\n' +
  '/meals – today\'s logged meals\n' +
  '/weight 84.6 – record your weight\n' +
  '/progress – weight & calorie progress\n' +
  '/undo – remove your last logged meal';

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

app.post('/webhook', async (c) => {
  const secret = c.env.TELEGRAM_WEBHOOK_SECRET;
  const header = c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!secret || header !== secret) {
    return c.json({ ok: false, error: 'Unauthorized webhook call.' }, 401);
  }

  type Update = { update_id?: number; message?: Any; callback_query?: Any };
  const update = (await c.req.json().catch(() => null)) as Update | null;
  if (!update || typeof update.update_id !== 'number') return c.json({ ok: true });

  // Idempotency: Telegram retries deliveries — process each update exactly once.
  const seen = await c.env.DB.prepare('INSERT OR IGNORE INTO telegram_processed_updates (update_id) VALUES (?1)')
    .bind(update.update_id)
    .run();
  if (!seen.meta.changes) return c.json({ ok: true }); // duplicate delivery

  try {
    await handleUpdate(c.env, update as Required<Pick<Update, 'update_id'>> & Update);
  } catch (e) {
    // Never crash on unexpected input — Telegram would just keep retrying.
    console.error('[telegram] handler error:', e);
  }
  return c.json({ ok: true });
});

async function handleUpdate(
  env: Env,
  update: { message?: Any; callback_query?: Any }
): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, update.callback_query as { id?: string; data?: string; from?: { id?: number }; message?: { chat?: { id?: number }; message_id?: number } });
    return;
  }
  const msg = update.message as { chat?: { id?: number }; from?: { id?: number }; text?: string } | undefined;
  const chatId = Number(msg?.chat?.id);
  const fromId = Number(msg?.from?.id);
  const text = String(msg?.text ?? '').trim();
  if (!Number.isFinite(chatId) || !Number.isFinite(fromId) || !text) return;
  await handleText(env, chatId, fromId, text);
}

/* ------------------------------------------------------------------ */
/* Text / command handling                                             */
/* ------------------------------------------------------------------ */

async function handleText(env: Env, chatId: number, telegramUserId: number, text: string): Promise<void> {
  const db = env.DB;
  const lower = text.toLowerCase();

  // /start & /help work for everyone.
  if (lower === '/start' || lower === '/help') {
    const mapped = await getAppUserId(db, telegramUserId);
    await sendMessage(env, chatId, mapped ? HELP_TEXT : LINK_HELP);
    return;
  }

  // /link CODE — binds this Telegram account to an app profile via a web-generated code.
  if (/^\/link\b/i.test(text)) {
    const code = text.split(/\s+/)[1]?.toUpperCase() ?? '';
    if (!code) {
      await sendMessage(env, chatId, 'Please include your code:\n/link YOURCODE');
      return;
    }
    const row = await db
      .prepare(
        `SELECT application_user_id FROM telegram_link_codes
         WHERE code = ?1 AND used_at IS NULL AND expires_at > datetime('now')`
      )
      .bind(code)
      .first<{ application_user_id: number }>();
    if (!row) {
      await sendMessage(env, chatId, '❌ That code is invalid or expired. Generate a new one in Profile → Telegram.');
      return;
    }
    await db.prepare(
      `INSERT INTO telegram_users (telegram_user_id, application_user_id) VALUES (?1, ?2)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         application_user_id=excluded.application_user_id, updated_at=datetime('now')`
    )
      .bind(String(telegramUserId), row.application_user_id)
      .run();
    await db.prepare("UPDATE telegram_link_codes SET used_at = datetime('now') WHERE code = ?1").bind(code).run();
    await sendMessage(env, chatId, '✅ Linked! Your Telegram account is now connected to your tracker.');
    return;
  }

  // Everything below requires a linked account.
  const userId = await getAppUserId(db, telegramUserId);
  if (!userId) {
    await sendMessage(env, chatId, LINK_HELP);
    return;
  }

  if (lower === '/today') return cmdToday(env, db, userId, chatId);
  if (lower === '/meals') return cmdMeals(env, db, userId, chatId);
  if (lower === '/progress') return cmdProgress(env, db, userId, chatId);
  if (lower === '/undo') return cmdUndo(env, db, userId, chatId);

  const wMatch = /^\/weight\s+@?([\d.]+)\s*(kg)?\s*$/i.exec(text);
  if (wMatch) {
    const kg = Number(wMatch[1]);
    if (!Number.isFinite(kg) || kg < 25 || kg > 450) {
      await sendMessage(env, chatId, '⚠️ Weight must be between 25 and 450 kg. Example: /weight 84.6');
      return;
    }
    try {
      await applyWeightLog(db, userId, botToday(env), kg);
      await sendMessage(env, chatId, `⚖️ Weight recorded\n\n${kg} kg`);
    } catch (e) {
      console.error('[telegram] /weight failed:', e);
      await sendMessage(env, chatId, '⚠️ Could not save your weight right now. Please try again.');
    }
    return;
  }

  // Anything else → natural-language meal logging.
  return handleMealText(env, chatId, telegramUserId, userId, text);
}

async function cmdToday(env: Env, db: D1Database, userId: number, chatId: number): Promise<void> {
  const today = botToday(env);
  const [summary, profile] = await Promise.all([
    getDaySummary(db, userId, today),
    db.prepare('SELECT calorie_target, protein_target, carb_target, fat_target FROM profiles WHERE user_id = ?1')
      .bind(userId)
      .first<Record<string, number>>(),
  ]);
  await sendMessage(env, chatId, formatToday(summary, profile ?? {}));
}

async function cmdMeals(env: Env, db: D1Database, userId: number, chatId: number): Promise<void> {
  const today = botToday(env);
  const rows = (
    await db.prepare(
      'SELECT meal, name, grams, calories FROM food_logs WHERE user_id = ?1 AND log_date = ?2 ORDER BY created_at ASC'
    )
      .bind(userId, today)
      .all<{ meal: string; name: string; grams: number; calories: number }>()
  ).results;
  if (!rows.length) {
    await sendMessage(env, chatId, `📭 Nothing logged yet for today (${today}).`);
    return;
  }
  const byMeal = new Map<string, Array<{ name: string; grams: number; calories: number }>>();
  let total = 0;
  for (const r of rows) {
    if (!byMeal.has(r.meal)) byMeal.set(r.meal, []);
    byMeal.get(r.meal)!.push(r);
    total += Number(r.calories || 0);
  }
  const lines = ["🍽️ Today's meals", `(${today})`, ''];
  for (const [meal, items] of byMeal) {
    lines.push(MEAL_LABELS[meal as MealType] ?? meal);
    for (const it of items) lines.push(`• ${it.name} — ${Math.round(Number(it.grams))} g · ${Math.round(Number(it.calories))} kcal`);
    lines.push('');
  }
  lines.push(`TOTAL: ${Math.round(total)} kcal`);
  await sendMessage(env, chatId, lines.join('\n'));
}

async function cmdProgress(env: Env, db: D1Database, userId: number, chatId: number): Promise<void> {
  const today = botToday(env);
  const [profile, summary] = await Promise.all([
    db.prepare(
      'SELECT start_weight, current_weight, goal_type, weekly_goal_kg, calorie_target FROM profiles WHERE user_id = ?1'
    )
      .bind(userId)
      .first<{
        start_weight: number | null;
        current_weight: number | null;
        goal_type: string | null;
        weekly_goal_kg: number | null;
        calorie_target: number | null;
      }>(),
    getDaySummary(db, userId, today),
  ]);

  const weekStart = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400_000).toISOString().slice(0, 10);
  const avgRow = await db
    .prepare(
      'SELECT AVG(day_total) AS avg_kcal FROM (SELECT SUM(calories) AS day_total FROM food_logs WHERE user_id = ?1 AND log_date BETWEEN ?2 AND ?3 GROUP BY log_date)'
    )
    .bind(userId, weekStart, today)
    .first<{ avg_kcal: number | null }>();

  const start = Number(profile?.start_weight ?? 0);
  const current = Number(profile?.current_weight ?? 0);
  const lost = Math.round((start - current) * 10) / 10;

  const lines = [
    '📈 PROGRESS',
    '',
    `Starting weight: ${start ? start.toFixed(1) : '—'} kg`,
    `Current weight: ${current ? current.toFixed(1) : '—'} kg`,
    `Weight change: ${lost > 0 ? `${lost} kg lost` : lost < 0 ? `${Math.abs(lost)} kg gained` : '—'}`,
  ];
  if (profile?.goal_type === 'lose' && profile.weekly_goal_kg) {
    lines.push(`Goal pace: ${Number(profile.weekly_goal_kg).toFixed(2)} kg/week loss`);
  } else if (profile?.goal_type === 'gain' && profile.weekly_goal_kg) {
    lines.push(`Goal pace: ${Number(profile.weekly_goal_kg).toFixed(2)} kg/week gain`);
  } else {
    lines.push('Goal: maintain');
  }
  lines.push('');
  lines.push(`Today's calories: ${Math.round(summary.consumed.calories)}${profile?.calorie_target ? ` / ${profile.calorie_target} kcal` : ''}`);
  if (avgRow?.avg_kcal != null && Number.isFinite(Number(avgRow.avg_kcal))) {
    lines.push(`7-day average: ${Math.round(Number(avgRow.avg_kcal))} kcal/day`);
  }
  await sendMessage(env, chatId, lines.join('\n'));
}

async function cmdUndo(env: Env, db: D1Database, userId: number, chatId: number): Promise<void> {
  const last = await db
    .prepare('SELECT id, name, log_date, calories FROM food_logs WHERE user_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1')
    .bind(userId)
    .first<{ id: number; name: string; log_date: string; calories: number }>();
  if (!last) {
    await sendMessage(env, chatId, '📭 You have no logged meals yet.');
    return;
  }
  await sendMessage(env, chatId, `Remove your most recent meal?\n\n• ${last.name} — ${Math.round(Number(last.calories))} kcal (${last.log_date})`, [
    [
      { text: '🗑️ Delete', callback_data: `td:${last.id}` },
      { text: '❌ Cancel', callback_data: 'tn:0' },
    ],
  ]);
}

/* ------------------------------------------------------------------ */
/* Natural-language meal logging                                       */
/* ------------------------------------------------------------------ */

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

type CatalogRow = {
  id: number;
  name: string;
  serving_grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

/** Prefer an exact name match; fall back to substring search. Always user-scoped. */
async function fetchCandidates(db: D1Database, userId: number, query: string) {
  const exact = (
    await db.prepare('SELECT * FROM foods WHERE user_id = ?1 AND LOWER(name) = LOWER(?2) LIMIT 8')
      .bind(userId, query)
      .all<CatalogRow>()
  ).results;
  if (exact.length) return exact;
  return (
    await db.prepare(
      `SELECT * FROM foods WHERE user_id = ?1 AND name LIKE '%' || ?2 || '%' ESCAPE '\\' ORDER BY LENGTH(name) ASC LIMIT 8`
    )
      .bind(userId, escapeLike(query))
      .all<CatalogRow>()
  ).results;
}

function amountLabel(qty: number, unit: string, grams: number): string {
  const canon = unit.toLowerCase();
  if (canon === 'piece' || canon === 'egg' || canon === 'eggs') return `${qty} pc · ${Math.round(grams)} g`;
  if (canon === 'serving' || canon === 'portion') return `${qty} serving(s) · ${Math.round(grams)} g`;
  if (canon === 'g' || canon === '') return `${Math.round(grams)} g`;
  if (canon === 'ml') return `${qty} ml`;
  if (canon === 'kg') return `${qty} kg (${Math.round(grams)} g)`;
  if (canon === 'oz') return `${qty} oz (${Math.round(grams)} g)`;
  if (canon === 'lb') return `${qty} lb (${Math.round(grams)} g)`;
  return `${qty} ${unit} (${Math.round(grams)} g)`;
}

async function handleMealText(
  env: Env,
  chatId: number,
  telegramUserId: number,
  userId: number,
  text: string
): Promise<void> {
  const db = env.DB;
  // Housekeeping: drop stale pending analyses (>24 h old).
  await db.prepare("DELETE FROM telegram_pending_meals WHERE created_at < datetime('now', '-1 day')").run();

  const prefix = extractMealPrefix(text);
  if (prefix.invalidPrefix) {
    await sendMessage(
      env,
      chatId,
      "⚠️ I didn't recognize that meal name.\nUse Breakfast:, Lunch:, Dinner: or Snacks: — or just tell me what you ate."
    );
    return;
  }

  let parsed: Awaited<ReturnType<typeof extractFoods>>;
  try {
    parsed = await extractFoods(env, prefix.rest);
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      await sendMessage(
        env,
        chatId,
        '🤖 The food-analysis AI is unavailable right now.\n' +
          `(${e.message})\n\n` +
          'Manual logging on the web dashboard still works fine.'
      );
      return;
    }
    throw e;
  }

  const { items: aiItemsRaw } = normalizeAiItems(parsed.items);
  if (!aiItemsRaw.length) {
    await sendMessage(env, chatId, "🤔 I couldn't find any food in that message. Try something like:\n300g chicken breast and 4 eggs");
    return;
  }
  const meal = ((prefix.meal ?? parsed.meal ?? 'snack') as MealType);

  /* Resolve every item against the EXISTING catalog — nutrition never comes from the AI. */
  const items: PendingItem[] = [];
  const problems: string[] = [];

  for (const it of aiItemsRaw) {
    const prepHint = detectPrep(it.food);
    const base: PendingItem = { label: it.food, qty: it.quantity, unit: it.unit, status: 'choose' as const, query: it.food };

    if (!it.quantity) {
      problems.push(`• "${it.food}" — how much did you eat?\n   Example: 300g ${it.food}`);
      continue;
    }

    const candidates = await fetchCandidates(db, userId, it.food);
    const dec = decideFoodMatch(candidates, prepHint);

    if (dec.status === 'none') {
      problems.push(`• "${it.food}" isn't in your food catalog.\n   Add it on the Foods page first, then send this again.`);
      continue;
    }
    if (dec.status === 'ambiguous') {
      items.push({ ...base, status: 'choose', options: dec.options.map((o) => ({ id: o.id, name: o.name })) });
      continue;
    }
    if (dec.status === 'prep') {
      items.push({
        ...base,
        status: 'prep',
        options: [
          { id: dec.rawFood.id, name: dec.rawFood.name },
          { id: dec.cookedFood.id, name: dec.cookedFood.name },
        ],
      });
      continue;
    }

    const conv = convertToGrams(it.quantity, it.unit || 'g', dec.food.serving_grams);
    if (!conv.ok) {
      if (conv.reason === 'no_serving_size') {
        problems.push(`• "${dec.food.name}" has no serving size set, so I can't count pieces.\n   Give a weight instead — e.g. 150g.`);
      } else if (conv.reason === 'unknown_unit') {
        problems.push(`• I don't understand the unit "${it.unit || '?'}".\n   Supported: g, kg, oz, lb, ml, pieces, servings.`);
      } else {
        problems.push('• That amount looks off. Try something like 200g or 2 pieces.');
      }
      continue;
    }
    items.push({
      ...base,
      status: 'ok',
      foodId: dec.food.id,
      foodName: dec.food.name,
      grams: conv.grams,
      amountLabel: amountLabel(it.quantity, it.unit, conv.grams),
    });
  }

  // Missing amounts / unknown foods need a new message anyway — no state kept.
  if (problems.length) {
    await sendMessage(env, chatId, '🤔 Before I can log this:\n\n' + problems.join('\n\n'));
    return;
  }

  const payload: PendingPayload = { chat_id: chatId, meal, date: botToday(env), stage: 'resolving', items };
  const ins = await db
    .prepare('INSERT INTO telegram_pending_meals (telegram_user_id, application_user_id, payload) VALUES (?1, ?2, ?3)')
    .bind(String(telegramUserId), userId, JSON.stringify(payload))
    .run();
  const pid = Number(ins.meta.last_row_id);
  await advancePending(env, db, pid);
}

/** Load a pending meal owned strictly by this Telegram/app pair. */
async function loadPending(db: D1Database, pid: number, telegramUserId: number, userId: number) {
  if (!Number.isFinite(pid)) return null;
  const row = await db
    .prepare('SELECT * FROM telegram_pending_meals WHERE id = ?1 AND telegram_user_id = ?2 AND application_user_id = ?3')
    .bind(pid, String(telegramUserId), userId)
    .first<{ id: number; payload: string }>();
  if (!row) return null;
  try {
    return { id: row.id, data: JSON.parse(row.payload) as PendingPayload };
  } catch {
    return null;
  }
}

async function savePending(db: D1Database, pid: number, data: PendingPayload): Promise<void> {
  await db.prepare('UPDATE telegram_pending_meals SET payload = ?2 WHERE id = ?1').bind(pid, JSON.stringify(data)).run();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function questionFor(it: PendingItem, done: number, total: number): string {
  const progress = done > 0 ? `\n(${done} of ${total} foods resolved)` : '';
  if (it.status === 'prep') {
    return `Is that <b>${escapeHtml(it.query ?? it.label)}</b> raw or cooked?${progress}\nI won't guess — the values differ.`;
  }
  return `Which one did you mean by "<b>${escapeHtml(it.query ?? it.label)}</b>"?${progress}`;
}

/**
 * Drive the conversation: ask about the first unresolved item, or — once every
 * item maps to a real catalog food — show the analysis with Confirm/Cancel.
 */
async function advancePending(env: Env, db: D1Database, pid: number): Promise<void> {
  const row = await db.prepare('SELECT * FROM telegram_pending_meals WHERE id = ?1').bind(pid).first<Any>();
  if (!row) return;
  const data = JSON.parse(String(row.payload)) as PendingPayload;

  const openIdx = data.items.findIndex((i) => i.status !== 'ok');

  if (openIdx >= 0) {
    const it = data.items[openIdx];
    const done = data.items.filter((i) => i.status === 'ok').length;
    const kb: InlineKeyboard = [];
    if (it.status === 'choose' && it.options) {
      it.options.forEach((o, oi) => kb.push([{ text: o.name, callback_data: `tp:${pid}:${openIdx}:${oi}` }]));
    } else if (it.status === 'prep' && it.options) {
      kb.push([
        { text: '🌿 Raw', callback_data: `tt:${pid}:${openIdx}:0` },
        { text: '🔥 Cooked', callback_data: `tt:${pid}:${openIdx}:1` },
      ]);
    }
    kb.push([{ text: '❌ Cancel', callback_data: `tx:${pid}` }]);
    await sendOrEdit(env, db, pid, data, questionFor(it, done, data.items.length), kb);
    return;
  }

  // Everything resolved → confirmation preview from FRESH catalog values.
  const resolved: Array<{ name: string; amountLabel: string; macros: ReturnType<typeof scaleMacros> }> = [];
  for (const it of data.items) {
    const food = await getCatalogFood(db, Number(row.application_user_id), it.foodId!);
    if (!food) {
      await sendOrEdit(env, db, pid, data, `⚠️ "${it.label}" is no longer in your catalog. Please send the meal again.`, [
        [{ text: '❌ Close', callback_data: `tx:${pid}` }],
      ]);
      return;
    }
    resolved.push({ name: food.name, amountLabel: it.amountLabel!, macros: scaleMacros(food, it.grams!) });
  }
  data.stage = 'ready';
  await sendOrEdit(env, db, pid, data, formatMealAnalysis(resolved, MEAL_LABELS[data.meal]), [
    [
      { text: '✅ Confirm', callback_data: `tc:${pid}` },
      { text: '❌ Cancel', callback_data: `tx:${pid}` },
    ],
  ]);
}

async function sendOrEdit(
  env: Env,
  db: D1Database,
  pid: number,
  data: PendingPayload,
  text: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  if (data.message_id) {
    await editMessage(env, data.chat_id, data.message_id, text, keyboard);
    return;
  }
  const sent = (await sendMessage(env, data.chat_id, text, keyboard)) as { result?: { message_id?: number } } | null;
  const mid = Number(sent?.result?.message_id);
  if (Number.isFinite(mid)) {
    data.message_id = mid;
    await savePending(db, pid, data);
  }
}

/* ------------------------------------------------------------------ */
/* Inline-button callbacks                                             */
/* ------------------------------------------------------------------ */

type CallbackQuery = {
  id?: string;
  data?: string;
  from?: { id?: number };
  message?: { chat?: { id?: number }; message_id?: number };
};

async function handleCallback(env: Env, cb: CallbackQuery): Promise<void> {
  const db = env.DB;
  const cbId = String(cb.id ?? '');
  const [action, a1, a2, a3] = String(cb.data ?? '').split(':');
  const chatId = Number(cb.message?.chat?.id);
  const telegramUserId = Number(cb.from?.id);
  if (!Number.isFinite(chatId) || !Number.isFinite(telegramUserId)) return;

  const finish = (text?: string) => answerCallback(env, cbId, text);

  // /undo cancel — no sensitive resource involved.
  if (action === 'tn') {
    await finish('Cancelled');
    return;
  }

  // Every other action requires a linked account.
  const userId = await getAppUserId(db, telegramUserId);
  if (!userId) {
    await finish('Not linked');
    return;
  }

  /* ---- /undo → delete confirmed ---- */
  if (action === 'td') {
    const logId = Number(a1);
    if (!Number.isInteger(logId)) {
      await finish();
      return;
    }
    const res = await db.prepare('DELETE FROM food_logs WHERE id = ?1 AND user_id = ?2').bind(logId, userId).run();
    await finish(res.meta.changes ? 'Deleted' : 'Already removed');
    const mid = Number(cb.message?.message_id);
    if (res.meta.changes && Number.isFinite(mid)) {
      await editMessage(env, chatId, mid, '🗑️ Meal removed.');
    }
    return;
  }

  /* ---- pending-meal actions ---- */
  const pid = Number(a1);
  const pend = await loadPending(db, pid, telegramUserId, userId);
  if (!pend) {
    await finish('Expired — please send the meal again');
    return;
  }
  const data = pend.data;

  if (action === 'tx') {
    await db.prepare('DELETE FROM telegram_pending_meals WHERE id = ?1').bind(pid).run();
    await finish('Cancelled');
    if (data.message_id) await editMessage(env, data.chat_id, data.message_id, '❌ Cancelled — nothing was saved.');
    return;
  }

  if (action === 'tc') {
    if (data.stage !== 'ready') {
      await finish('Still resolving foods…');
      return;
    }
    const saved: Array<{ name: string; amountLabel: string; macros: ReturnType<typeof scaleMacros> }> = [];
    for (const it of data.items) {
      // Re-read the catalog at confirm time — values always come from YOUR database.
      const food = await getCatalogFood(db, userId, it.foodId!);
      if (!food) continue;
      const macros = scaleMacros(food, it.grams!);
      await insertFoodLog(db, userId, {
        date: data.date,
        meal: data.meal,
        grams: it.grams!,
        foodId: food.id,
        name: food.name,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
      });
      saved.push({ name: food.name, amountLabel: it.amountLabel!, macros });
    }
    await db.prepare('DELETE FROM telegram_pending_meals WHERE id = ?1').bind(pid).run();
    const totals = sumNutrition(saved.map((s) => s.macros));
    await finish(`Saved ${saved.length} item${saved.length === 1 ? '' : 's'}!`);
    const summary = formatSaved(MEAL_LABELS[data.meal], saved, totals);
    if (data.message_id) await editMessage(env, data.chat_id, data.message_id, summary);
    else await sendMessage(env, data.chat_id, summary);
    return;
  }

  if (action === 'tp' || action === 'tt') {
    const idx = Number(a2);
    const optIdx = Number(a3);
    const it = data.items[idx];
    if (!it || !it.options || !it.options[optIdx]) {
      await finish('Invalid choice');
      return;
    }
    const chosen = it.options[optIdx];
    const food = await getCatalogFood(db, userId, chosen.id);
    if (!food) {
      await finish('That food no longer exists');
      return;
    }
    const conv = convertToGrams(it.qty ?? 0, it.unit || 'g', food.serving_grams);
    if (!conv.ok) {
      await finish(`Please resend with a weight — e.g. 150g ${food.name}`);
      return;
    }
    it.status = 'ok';
    it.foodId = food.id;
    it.foodName = food.name;
    it.grams = conv.grams;
    it.amountLabel = amountLabel(it.qty ?? 0, it.unit, conv.grams);
    await savePending(db, pid, data);
    await finish(`Using “${food.name}”`);
    await advancePending(env, db, pid);
    return;
  }

  await finish();
}

export default app;