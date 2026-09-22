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

/* Shared SQL so the web dashboard and the Telegram bot compute identical totals. */
const SQL_DAY_TOTALS = `SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein),0) AS protein,
        COALESCE(SUM(carbs),0) AS carbs, COALESCE(SUM(fat),0) AS fat
 FROM food_logs WHERE user_id = ?1 AND log_date = ?2`;
const SQL_STEPS_TODAY = 'SELECT steps, calories_burned FROM step_logs WHERE user_id = ?1 AND log_date = ?2';

/**
 * One day's consumed/burned/net totals — reused by the Telegram /today and
 * /progress commands so both surfaces show the same numbers as the web app.
 */
export async function getDaySummary(db: D1Database, userId: number, date: string) {
  const [totalsRow, stepsRow] = await Promise.all([
    db.prepare(SQL_DAY_TOTALS).bind(userId, date).first<Any>(),
    db.prepare(SQL_STEPS_TODAY).bind(userId, date).first<Any>(),
  ]);
  const consumed = {
    calories: Math.round(Number(totalsRow?.calories ?? 0) * 100) / 100,
    protein: Math.round(Number(totalsRow?.protein ?? 0) * 100) / 100,
    carbs: Math.round(Number(totalsRow?.carbs ?? 0) * 100) / 100,
    fat: Math.round(Number(totalsRow?.fat ?? 0) * 100) / 100,
  };
  const steps = Number(stepsRow?.steps ?? 0);
  const burnedSteps = Math.round(Number(stepsRow?.calories_burned ?? 0) * 10) / 10;
  return {
    consumed,
    steps,
    burned_steps: burnedSteps,
    net_calories: Math.round((consumed.calories - burnedSteps) * 10) / 10,
  };
}

/** Everything the dashboard needs in one round-trip.
 *  D1-minimal version: every table is read exactly ONCE per request.
 *  - today's meal rows double as the day-totals source (no extra SUM scan),
 *  - plain 7-day range selects replace the three recursive-CTE joins; the
 *    zero-fill that COALESCE did in SQL happens here (identical output),
 *  - today's steps/pushups come from the same range rows (no point reads). */
app.get('/', async (c) => {
  const userId = c.get('userId');
  const date = c.req.query('date');
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });

  const rangeStart = shift(date, -6);

  const [profileRow, mealsRows, weightsRows, foodRangeRows, stepsRangeRows, pushupsRangeRows] =
    await Promise.all([
      c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(userId).first<Any>(),
      c.env.DB.prepare(
        'SELECT * FROM food_logs WHERE user_id = ?1 AND log_date = ?2 ORDER BY created_at ASC, id ASC'
      )
        .bind(userId, date)
        .all<Any>(),
      c.env.DB.prepare('SELECT log_date, weight FROM weight_logs WHERE user_id = ?1 ORDER BY log_date DESC LIMIT 90')
        .bind(userId)
        .all<Any>(),
      c.env.DB.prepare(
        'SELECT log_date, calories FROM food_logs WHERE user_id = ?1 AND log_date BETWEEN ?2 AND ?3'
      )
        .bind(userId, rangeStart, date)
        .all<Any>(),
      c.env.DB.prepare(
        'SELECT log_date, steps, calories_burned FROM step_logs WHERE user_id = ?1 AND log_date BETWEEN ?2 AND ?3'
      )
        .bind(userId, rangeStart, date)
        .all<Any>(),
      c.env.DB.prepare(
        'SELECT log_date, pushups, calories_burned FROM pushup_logs WHERE user_id = ?1 AND log_date BETWEEN ?2 AND ?3'
      )
        .bind(userId, rangeStart, date)
        .all<Any>(),
    ]);

  /* Day totals computed from today's rows — same values and same 2-decimal
     rounding the SQL SUM() produced. */
  let sumCalories = 0;
  let sumProtein = 0;
  let sumCarbs = 0;
  let sumFat = 0;
  for (const e of mealsRows.results) {
    sumCalories += Number(e.calories ?? 0);
    sumProtein += Number(e.protein ?? 0);
    sumCarbs += Number(e.carbs ?? 0);
    sumFat += Number(e.fat ?? 0);
  }
  const consumed = {
    calories: Math.round(sumCalories * 100) / 100,
    protein: Math.round(sumProtein * 100) / 100,
    carbs: Math.round(sumCarbs * 100) / 100,
    fat: Math.round(sumFat * 100) / 100,
  };

  const stepsByDate = new Map<string, Any>();
  for (const r of stepsRangeRows.results) stepsByDate.set(String(r.log_date), r);
  const pushupsByDate = new Map<string, Any>();
  for (const r of pushupsRangeRows.results) pushupsByDate.set(String(r.log_date), r);
  const caloriesByDate = new Map<string, number>();
  for (const r of foodRangeRows.results) {
    const d = String(r.log_date);
    caloriesByDate.set(d, (caloriesByDate.get(d) ?? 0) + Number(r.calories ?? 0));
  }

  /* Zero-filled 7-day series (rangeStart … date), built in JS — exactly what
     `WITH RECURSIVE seq … LEFT JOIN … COALESCE(…, 0)` returned, minus the
     per-day join lookups D1 billed as row reads. */
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) days.push(shift(date, -i));
  const stepsSeries = days.map((d) => {
    const r = stepsByDate.get(d);
    return { log_date: d, steps: Number(r?.steps ?? 0), calories_burned: Number(r?.calories_burned ?? 0) };
  });
  const pushupsSeries = days.map((d) => {
    const r = pushupsByDate.get(d);
    return { log_date: d, pushups: Number(r?.pushups ?? 0), calories_burned: Number(r?.calories_burned ?? 0) };
  });
  // ROUND(SUM(calories)) per day, 0 when empty — identical to the old SQL.
  const caloriesSeries = days.map((d) => ({ log_date: d, calories: Math.round(caloriesByDate.get(d) ?? 0) }));

  const stepsTodayRow = stepsByDate.get(date);
  const pushupsTodayRow = pushupsByDate.get(date);
  const steps = Number(stepsTodayRow?.steps ?? 0);
  const burnedSteps = Math.round(Number(stepsTodayRow?.calories_burned ?? 0) * 10) / 10;
  const pushups = Number(pushupsTodayRow?.pushups ?? 0);
  const burnedPushups = Math.round(Number(pushupsTodayRow?.calories_burned ?? 0) * 10) / 10;

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
        pushup_goal: profileRow.pushup_goal,
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
    pushups,
    burned_steps: burnedSteps,
    burned_pushups: burnedPushups,
    net_calories: netCalories,
    remaining_calories: remaining,
    meals,
    weight_series: weightsRows.results.slice().reverse(),
    steps_series: stepsSeries,
    pushups_series: pushupsSeries,
    calories_series: caloriesSeries,
  });
});

export default app;
