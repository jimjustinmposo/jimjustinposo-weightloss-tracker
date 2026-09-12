import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';
import { isDateStr, num } from '../types';

type PushupRow = Record<string, unknown>;
type ProfileLite = { current_weight: number | null };

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

async function getProfileWeight(db: D1Database, userId: number): Promise<number | null> {
  return (
    (await db.prepare('SELECT current_weight FROM profiles WHERE user_id = ?1').bind(userId).first<ProfileLite>())?.current_weight ??
    null
  );
}

/**
 * Upsert one day's pushups; calories burned are estimated from body weight
 * (roughly 0.0008 kcal per pushup per kg body weight — a conservative estimate).
 * Shared by the web POST route and the Telegram bot's natural-language logging.
 */
export async function applyPushupLog(
  db: D1Database,
  userId: number,
  date: string,
  pushups: number
): Promise<PushupRow> {
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });
  const p = Math.round(num(pushups));
  if (!Number.isFinite(p) || p < 0 || p > 50000) {
    throw new HTTPException(400, { message: 'Pushups must be between 0 and 50,000.' });
  }

  const weight = await getProfileWeight(db, userId);
  
  // First, check if there's an existing entry for this date
  const existing = await db.prepare('SELECT pushups, calories_burned FROM pushup_logs WHERE user_id = ?1 AND log_date = ?2')
    .bind(userId, date)
    .first<{ pushups: number; calories_burned: number }>();
  
  // Calculate new totals (accumulate pushups)
  const newTotalPushups = (existing?.pushups || 0) + p;
  
  // Recalculate calories burned based on total pushups and body weight
  // Rough estimate: ~0.0008 kcal per pushup per kg of body weight.
  const burned =
    newTotalPushups === 0 || weight == null
      ? 0
      : Math.round(newTotalPushups * weight * 0.0008 * 10) / 10;

  await db.prepare(
    `INSERT INTO pushup_logs (user_id, log_date, pushups, calories_burned) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, log_date) DO UPDATE SET
       pushups=excluded.pushups, calories_burned=excluded.calories_burned, updated_at=datetime('now')`
  )
    .bind(userId, date, newTotalPushups, burned)
    .run();

  const log = await db.prepare('SELECT * FROM pushup_logs WHERE user_id = ?1 AND log_date = ?2')
    .bind(userId, date)
    .first<PushupRow>();
  return log!;
}

// Upsert today's pushups.
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const log = await applyPushupLog(c.env.DB, userId, body.date as string, num(body.pushups));
  return c.json({ log }, 201);
});

// Series for charts. Accepts explicit from/to or a `days` window ending today.
app.get('/', async (c) => {
  const userId = c.get('userId');
  let from = c.req.query('from');
  let to = c.req.query('to');
  if (!isDateStr(from) || !isDateStr(to)) {
    const days = Math.min(Math.max(Math.round(Number(c.req.query('days')) || 7), 1), 90);
    from = '';
    to = '';
    const rows = (
      await c.env.DB.prepare(
        `WITH RECURSIVE seq(d) AS (
           SELECT date('now', printf('-%d days', ?2 - 1))
           UNION ALL SELECT date(d, '+1 day') FROM seq WHERE d < date('now')
         )
         SELECT s.d AS log_date,
                COALESCE(pl.pushups, 0) AS pushups,
                COALESCE(pl.calories_burned, 0) AS calories_burned
         FROM seq s LEFT JOIN pushup_logs pl ON pl.user_id = ?1 AND pl.log_date = s.d
         ORDER BY s.d`
      )
        .bind(userId, days)
        .all<PushupRow>()
    ).results;
    return c.json({ series: rows });
  }

  const series = (
    await c.env.DB.prepare(
      'SELECT log_date, pushups, calories_burned FROM pushup_logs WHERE user_id = ?1 AND log_date BETWEEN ?2 AND ?3 ORDER BY log_date'
    )
      .bind(userId, from, to)
      .all<PushupRow>()
  ).results;
  return c.json({ series });
});

// Raw logged entries (only days that were saved), newest first — Pushups record page.
app.get('/entries', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(Math.max(Math.round(Number(c.req.query('limit')) || 90), 1), 365);
  const entries = (
    await c.env.DB.prepare(
      'SELECT log_date, pushups, calories_burned FROM pushup_logs WHERE user_id = ?1 ORDER BY log_date DESC LIMIT ?2'
    )
      .bind(userId, limit)
      .all<PushupRow>()
  ).results;
  return c.json({ entries });
});

// Delete one day's entry, keyed by date.
app.delete('/:date', async (c) => {
  const userId = c.get('userId');
  const date = c.req.param('date');
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });
  const res = await c.env.DB.prepare('DELETE FROM pushup_logs WHERE log_date = ?1 AND user_id = ?2').bind(date, userId).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Entry not found.' });
  return c.json({ ok: true });
});

export default app;
