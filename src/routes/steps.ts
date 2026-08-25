import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { stepCalories } from '../calc';
import type { AppVars, Env } from '../types';
import { isDateStr, num } from '../types';

type StepRow = Record<string, unknown>;
type ProfileLite = { height_cm: number | null; current_weight: number | null };

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

async function getProfile(db: D1Database, userId: number): Promise<ProfileLite> {
  return (
    (await db.prepare('SELECT height_cm, current_weight FROM profiles WHERE user_id = ?1').bind(userId).first<ProfileLite>()) ?? {
      height_cm: null,
      current_weight: null,
    }
  );
}

/**
 * Upsert one day's steps; calories burned are derived from stride length + weight.
 * Shared by the web POST route and the Telegram bot's natural-language logging.
 */
export async function applyStepLog(db: D1Database, userId: number, date: string, steps: number): Promise<StepRow> {
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });
  const s = Math.round(num(steps));
  if (!Number.isFinite(s) || s < 0 || s > 200000) {
    throw new HTTPException(400, { message: 'Steps must be between 0 and 200,000.' });
  }

  const profile = await getProfile(db, userId);
  const burned =
    s === 0
      ? 0
      : Math.round(stepCalories(s, profile.current_weight ?? 75, profile.height_cm ?? 170) * 10) / 10;

  await db.prepare(
    `INSERT INTO step_logs (user_id, log_date, steps, calories_burned) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, log_date) DO UPDATE SET
       steps=excluded.steps, calories_burned=excluded.calories_burned, updated_at=datetime('now')`
  )
    .bind(userId, date, s, burned)
    .run();

  const log = await db.prepare('SELECT * FROM step_logs WHERE user_id = ?1 AND log_date = ?2')
    .bind(userId, date)
    .first<StepRow>();
  return log!;
}

// Upsert today's steps; calories burned are derived from stride length + weight.
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const log = await applyStepLog(c.env.DB, userId, body.date as string, num(body.steps));
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
                COALESCE(sl.steps, 0) AS steps,
                COALESCE(sl.calories_burned, 0) AS calories_burned
         FROM seq s LEFT JOIN step_logs sl ON sl.user_id = ?1 AND sl.log_date = s.d
         ORDER BY s.d`
      )
        .bind(userId, days)
        .all<StepRow>()
    ).results;
    return c.json({ series: rows });
  }

  const series = (
    await c.env.DB.prepare(
      'SELECT log_date, steps, calories_burned FROM step_logs WHERE user_id = ?1 AND log_date BETWEEN ?2 AND ?3 ORDER BY log_date'
    )
      .bind(userId, from, to)
      .all<StepRow>()
  ).results;
  return c.json({ series });
});

// Raw logged entries (only days that were saved), newest first — Steps record page.
// NOTE: step_logs has a composite PRIMARY KEY (user_id, log_date) — there is no id
// column, so log_date is the row's unique key.
app.get('/entries', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(Math.max(Math.round(Number(c.req.query('limit')) || 90), 1), 365);
  const entries = (
    await c.env.DB.prepare(
      'SELECT log_date, steps, calories_burned FROM step_logs WHERE user_id = ?1 ORDER BY log_date DESC LIMIT ?2'
    )
      .bind(userId, limit)
      .all<StepRow>()
  ).results;
  return c.json({ entries });
});

// Delete one day's entry, keyed by date (step_logs has no id column).
app.delete('/:date', async (c) => {
  const userId = c.get('userId');
  const date = c.req.param('date');
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });
  const res = await c.env.DB.prepare('DELETE FROM step_logs WHERE log_date = ?1 AND user_id = ?2').bind(date, userId).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Entry not found.' });
  return c.json({ ok: true });
});

export default app;
