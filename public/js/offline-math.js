/* ============================================================
   offline-math.js — PURE offline aggregation math (no browser deps).
   These functions mirror the server-side SQL in src/routes/dashboard.ts,
   src/routes/logs.ts, src/routes/steps.ts and src/calc.ts so the offline
   views produce EXACTLY the same numbers as the online views.
   Kept dependency-free so it can run under `node --test`.
   ============================================================ */

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

export function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/* ---------- dates ---------- */
const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Shift a YYYY-MM-DD string by delta days (mirrors dashboard.ts `shift`). */
export function shiftDate(str, delta) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive [from..to] list of YYYY-MM-DD strings (mirrors the SQL recursive CTE). */
export function dateRange(from, to) {
  const out = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = shiftDate(cur, 1);
  }
  return out;
}

/* ---------- steps burn (mirrors calc.ts stepCalories + steps.ts rounding) ---------- */
export function burnedFromSteps(steps, weightKg = 75, heightCm = 170) {
  const s = Number(steps) || 0;
  if (!(s > 0)) return 0;
  const strideMeters = ((Number(heightCm) || 170) * 0.414) / 100;
  const km = (s * strideMeters) / 1000;
  return Math.round(km * (Number(weightKg) || 75) * 1.036 * 10) / 10;
}

/* ---------- day totals (mirrors SQL_DAY_TOTALS in dashboard.ts) ---------- */
export function dayTotals(logs) {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  for (const e of logs || []) {
    calories += Number(e.calories || 0);
    protein += Number(e.protein || 0);
    carbs += Number(e.carbs || 0);
    fat += Number(e.fat || 0);
  }
  return {
    calories: round2(calories),
    protein: round2(protein),
    carbs: round2(carbs),
    fat: round2(fat),
  };
}

/** Zero-filled per-day series (mirrors the recursive-CTE LEFT JOIN queries),
 *  e.g. the steps chart. rows: [{log_date, steps, calories_burned}, ...]. */
export function fillSeries(rows, from, to, valueKey) {
  const byDate = new Map();
  for (const r of rows || []) byDate.set(String(r.log_date), r);
  return dateRange(from, to).map((d) => {
    const r = byDate.get(d);
    const out = { log_date: d };
    out[valueKey] = r ? Number(r[valueKey] || 0) : 0;
    return out;
  });
}
/** Calories per day for a window — mirrors `COALESCE(ROUND(SUM(calories)),0)`. */
export function caloriesSeries(dayLogs, from, to) {
  const byDate = new Map();
  for (const e of dayLogs || []) {
    const k = String(e.log_date);
    byDate.set(k, (byDate.get(k) || 0) + Number(e.calories || 0));
  }
  return dateRange(from, to).map((d) => ({
    log_date: d,
    calories: Math.round(byDate.get(d) || 0),
  }));
}

/* ---------- dashboard assembly (mirrors GET /api/dashboard) ----------
 *  logs      = the REQUESTED day's food logs (totals + meals)
 *  windowLogs= food logs across the whole 7-day chart window (calories series)
 */
export function computeDashboard({ date, profile, logs, windowLogs, steps, weights }) {
  const logsList = logs || [];
  const rangeStart = shiftDate(date, -6);

  const consumed = dayTotals(logsList);
  const stepsRow = (steps || []).find((s) => String(s.log_date) === date);
  const stepsVal = Number(stepsRow?.steps ?? 0);
  const burnedSteps = round2(Number(stepsRow?.calories_burned ?? 0));
  const netCalories = round2(consumed.calories - burnedSteps);

  const calorieTarget = Number(profile?.calorie_target ?? 0);
  const remainingCalories = calorieTarget ? round2(calorieTarget - netCalories) : null;

  const targets = profile
    ? {
        bmr: profile.bmr,
        tdee: profile.tdee,
        bmi: profile.bmi,
        bmi_category: profile.bmi_category,
        calorie_target: profile.calorie_target,
        protein_target: profile.protein_target,
        carb_target: profile.carb_target,
        fat_target: profile.fat_target,
        step_goal: profile.step_goal,
        goal_type: profile.goal_type,
        weekly_goal_kg: profile.weekly_goal_kg,
        current_weight: profile.current_weight,
        start_weight: profile.start_weight,
      }
    : null;

  const meals = { breakfast: [], lunch: [], dinner: [], snack: [] };
  for (const e of logsList) {
    (meals[String(e.meal)] ??= []).push(e);
  }

  const weightSeries = (weights || [])
    .filter((w) => w?.log_date != null)
    .sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));

  const stepsByDate = new Map((steps || []).map((s) => [String(s.log_date), s]));
  const stepsSeries = dateRange(rangeStart, date).map((d) => {
    const r = stepsByDate.get(d);
    return {
      log_date: d,
      steps: r ? Number(r.steps || 0) : 0,
      calories_burned: r ? Number(r.calories_burned || 0) : 0,
    };
  });

  const calSeries = caloriesSeries(windowLogs || logsList, rangeStart, date);

  return {
    date,
    profile: profile ?? null,
    targets,
    consumed,
    steps: stepsVal,
    burned_steps: burnedSteps,
    net_calories: netCalories,
    remaining_calories: remainingCalories,
    meals,
    weight_series: weightSeries,
    steps_series: stepsSeries,
    calories_series: calSeries,
  };
}

/* ---------- food scaling (mirrors logs.ts scaleFood / foods.ts toPer100) ---------- */
export function scaleFood(food, grams) {
  const factor = (Number(grams) || 0) / 100;
  const s = (v) => round2(Number(v) * factor);
  return {
    calories: s(food?.calories_per_100g || 0),
    protein: s(food?.protein_per_100g || 0),
    carbs: s(food?.carbs_per_100g || 0),
    fat: s(food?.fat_per_100g || 0),
  };
}

export function toPer100(value, grams) {
  const g = Number(grams);
  return g > 0 ? Math.round(((Number(value) || 0) * 100 / g) * 100) / 100 : 0;
}

/* ---------- BMI category (mirrors calc.ts bmiCategory) ---------- */
export function bmiCategory(bmiValue) {
  const v = Number(bmiValue);
  if (v < 18.5) return 'Underweight';
  if (v < 25) return 'Normal weight';
  if (v < 30) return 'Overweight';
  return 'Obese';
}

/* ---------- ordering helpers (mirror server ORDER BY clauses) ---------- */
export function sortDescByDate(rows, secondary = 'id') {
  return [...rows].sort((a, b) => {
    if (a.log_date !== b.log_date) return a.log_date < b.log_date ? 1 : -1;
    return Number(b[secondary] || 0) - Number(a[secondary] || 0);
  });
}

export function sortAscByDate(rows, secondary = 'id') {
  return [...rows].sort((a, b) => {
    if (a.log_date !== b.log_date) return a.log_date < b.log_date ? -1 : 1;
    return Number(a[secondary] || 0) - Number(b[secondary] || 0);
  });
}

export function nameMatch(food, q) {
  const needle = String(q || '').toLowerCase();
  return needle ? String(food?.name || '').toLowerCase().includes(needle) : true;
}