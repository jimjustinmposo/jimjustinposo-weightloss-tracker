import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';
import { isDateStr } from '../types';

type Any = Record<string, unknown>;

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

function shift(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/** Everything the dashboard needs in one round-trip. */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const date = c.req.query('date');
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });

  const rangeStart = shift(date, -6);

  const [profileRow, totalsRow, mealsRows, stepsTodayRow, weightsRows, stepsSeriesRows, calSeriesRows] =
    await Promise.all([
      c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(userId).first<Any>(),
      c.env.DB.prepare(
        `SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein,
                COALESCE(SUM(carbs),0) AS carbs, COALESCE(SUM(fat),0) AS fat
         FROM food_logs WHERE user_id = ?1 AND log_date = ?2`
      )
        .bind(userId, date)
        .first<Any>(),
      c.env.DB.prepare(
        'SELECT * FROM food_logs WHERE user_id = ?1 AND log_date = ?2 ORDER BY created_at ASC, id ASC'
      )
        .bind(userId, date)
        .all<Any>(),
      c.env.DB.prepare('SELECT steps, calories_burned FROM step_logs WHERE user_id = ?1 AND log_date = ?2')
        .bind(userId, date)
        .first<Any>(),
      c.env.DB.prepare('SELECT log_date, weight FROM weight_logs WHERE user_id = ?1 ORDER BY log_date DESC LIMIT 90')
        .bind(userId)
        .all<Any>(),
      c.env.DB.prepare(
        `WITH RECURSIVE seq(d) AS (
           SELECT ?2 UNION ALL SELECT date(d, '+1 day') FROM seq WHERE d < ?3
         )
         SELECT s.d AS log_date,
                COALESCE(sl.steps, 0) AS steps,
                COALESCE(sl.calories_burned, 0) AS calories_burned
         FROM seq s LEFT JOIN step_logs sl ON sl.user_id = ?1 AND sl.log_date = s.d
         ORDER BY s.d`
      )
        .bind(userId, rangeStart, date)
        .all<Any>(),
      c.env.DB.prepare(
        `WITH RECURSIVE seq(d) AS (
           SELECT ?2 UNION ALL SELECT date(d, '+1 day') FROM seq WHERE d < ?3
         )
         SELECT s.d AS log_date, COALESCE(ROUND(SUM(fl.calories)), 0) AS calories
         FROM seq s LEFT JOIN food_logs fl ON fl.user_id = ?1 AND fl.log_date = s.d
         GROUP BY s.d ORDER BY s.d`
      )
        .bind(userId, rangeStart, date)
        .all<Any>(),
    ]);

  const consumed = {
    calories: Math.round(Number(totalsRow?.calories ?? 0) * 100) / 100,
    protein: Math.round(Number(totalsRow?.protein ?? 0) * 100) / 100,
    carbs: Math.round(Number(totalsRow?.carbs ?? 0) * 100) / 100,
    fat: Math.round(Number(totalsRow?.fat ?? 0) * 100) / 100,
  };
  const steps = Number(stepsTodayRow?.steps ?? 0);
  const burnedSteps = Math.round(Number(stepsTodayRow?.calories_burned ?? 0) * 10) / 10;

  const targets = profileRow
    ? {
        bmr: profileRow.bmr,
        tdee: profileRow.tdee,
        bmi: profileRow.bmi,
        bmi_category: profileRow.bmi_category,
        calorie_target: profileRow.calorie_target,
        protein_target: profileRow.protein_target,
        carb_target: profileRow.carb_target,
        fat_target: profileRow.fat_target,
        step_goal: profileRow.step_goal,
        goal_type: profileRow.goal_type,
        weekly_goal_kg: profileRow.weekly_goal_kg,
        current_weight: profileRow.current_weight,
        start_weight: profileRow.start_weight,
      }
    : null;

  const calorieTarget = Number(targets?.calorie_target ?? 0);
  const netCalories = Math.round((consumed.calories - burnedSteps) * 10) / 10;
  const remaining = calorieTarget ? Math.round((calorieTarget - netCalories) * 10) / 10 : null;

  const meals: Record<string, Any[]> = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const e of mealsRows.results) {
    (meals[String(e.meal)] ??= []).push(e);
  }

  return c.json({
    date,
    profile: profileRow ?? null,
    targets,
    consumed,
    steps,
    burned_steps: burnedSteps,
    net_calories: netCalories,
    remaining_calories: remaining,
    meals,
    weight_series: weightsRows.results.slice().reverse(),
    steps_series: stepsSeriesRows.results,
    calories_series: calSeriesRows.results,
  });
});

export default app;
