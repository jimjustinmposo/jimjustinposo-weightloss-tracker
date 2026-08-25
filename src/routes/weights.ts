import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';
import { isDateStr } from '../types';

type Any = Record<string, unknown>;
type ProfileRow = {
  name: string | null;
  age: number | null;
  gender: 'male' | 'female' | 'other' | null;
  height_cm: number | null;
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete' | null;
  start_weight: number | null;
  current_weight: number | null;
  goal_type: 'lose' | 'maintain' | 'gain';
  weekly_goal_kg: number;
};

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

app.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(Math.max(Math.round(Number(c.req.query('limit')) || 90), 1), 365);
  const entries = (
    await c.env.DB.prepare(
      'SELECT * FROM weight_logs WHERE user_id = ?1 ORDER BY log_date DESC LIMIT ?2'
    )
      .bind(userId, limit)
      .all<Any>()
  ).results;
  return c.json({ entries });
});

/**
 * Log weight for a date (upsert), sync profile weight + recompute all targets.
 * Shared by the web POST route and the Telegram bot's /weight command.
 */
export async function applyWeightLog(
  db: D1Database,
  userId: number,
  date: string,
  weight: number,
  note: string | null = null
): Promise<{ entry: Any; profile: Any | null }> {
  await db.prepare(
    `INSERT INTO weight_logs (user_id, log_date, weight, note) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, log_date) DO UPDATE SET weight=excluded.weight, note=excluded.note`
  )
    .bind(userId, date, weight, typeof note === 'string' ? note.slice(0, 200) : null)
    .run();

  const entry = await db.prepare('SELECT * FROM weight_logs WHERE user_id = ?1 AND log_date = ?2')
    .bind(userId, date)
    .first<Any>();

  // Sync current weight into the profile and refresh derived targets.
  const profile =
    (await db.prepare(
      'SELECT name, age, gender, height_cm, activity_level, start_weight, current_weight, goal_type, weekly_goal_kg FROM profiles WHERE user_id = ?1'
    ).bind(userId).first<ProfileRow>()) ?? null;

  if (profile && profile.age != null && profile.height_cm != null) {
    const { computeTargets } = await import('../calc');
    const t = computeTargets({
      weightKg: weight,
      heightCm: profile.height_cm,
      age: profile.age,
      gender: profile.gender ?? 'other',
      activityLevel: profile.activity_level ?? 'light',
      goalType: profile.goal_type,
      weeklyGoalKg: profile.weekly_goal_kg,
    });
    await db.prepare(
      `UPDATE profiles SET current_weight=?2, bmr=?3, tdee=?4, bmi=?5, bmi_category=?6,
         calorie_target=?7, protein_target=?8, carb_target=?9, fat_target=?10, updated_at=datetime('now')
       WHERE user_id=?1`
    )
      .bind(
        userId,
        weight,
        t.bmr,
        t.tdee,
        t.bmi,
        t.bmi_category,
        t.calorie_target,
        t.protein_target,
        t.carb_target,
        t.fat_target
      )
      .run();
  }

  const updatedProfile = await db.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(userId).first<Any>();
  return { entry: entry as Any, profile: updatedProfile };
}

app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const date = body.date;
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });

  const weight = Number(body.weight);
  if (!Number.isFinite(weight) || weight < 25 || weight > 450) {
    throw new HTTPException(400, { message: 'Weight must be between 25 and 450 kg.' });
  }

  const { entry, profile } = await applyWeightLog(
    c.env.DB,
    userId,
    date,
    weight,
    typeof body.note === 'string' ? body.note : null
  );
  return c.json({ entry, profile }, 201);
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('DELETE FROM weight_logs WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Entry not found.' });
  return c.json({ ok: true });
});

export default app;
