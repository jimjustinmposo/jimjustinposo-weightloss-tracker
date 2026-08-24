import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';
import { MEALS, isDateStr, num, type MealType } from '../types';

type LogRow = Record<string, unknown>;
type FoodRow = {
  id: number;
  name: string;
  serving_grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const date = c.req.query('date');
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });

  const entries = (
    await c.env.DB.prepare(
      'SELECT * FROM food_logs WHERE user_id = ?1 AND log_date = ?2 ORDER BY created_at ASC, id ASC'
    )
      .bind(userId, date)
      .all<LogRow>()
  ).results;

  const totals = entries.reduce<{ calories: number; protein: number; carbs: number; fat: number }>(
    (acc, e) => ({
      calories: acc.calories + Number(e.calories ?? 0),
      protein: acc.protein + Number(e.protein ?? 0),
      carbs: acc.carbs + Number(e.carbs ?? 0),
      fat: acc.fat + Number(e.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round2(Number(totals[k]));

  return c.json({ date, entries, totals });
});

// Recent history (client groups by day).
app.get('/recent', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 500, 1), 1000);
  const entries = (
    await c.env.DB.prepare(
      'SELECT * FROM food_logs WHERE user_id = ?1 ORDER BY log_date DESC, id DESC LIMIT ?2'
    )
      .bind(userId, limit)
      .all<LogRow>()
  ).results;
  return c.json({ entries });
});

app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const date = body.date;
  if (!isDateStr(date)) throw new HTTPException(400, { message: 'A valid date (YYYY-MM-DD) is required.' });
  const meal = String(body.meal ?? 'snack') as MealType;
  if (!MEALS.includes(meal)) throw new HTTPException(400, { message: 'Invalid meal.' });
  const grams = num(body.grams);
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
    throw new HTTPException(400, { message: 'Amount must be between 0 and 5,000 grams.' });
  }

  let name: string;
  let calories: number;
  let protein: number;
  let carbs: number;
  let fat: number;
  let foodId: number | null = null;

  const foodIdRaw = body.food_id != null ? Number(body.food_id) : null;
  if (foodIdRaw != null && Number.isFinite(foodIdRaw)) {
    const food = await c.env.DB.prepare('SELECT * FROM foods WHERE id = ?1 AND user_id = ?2')
      .bind(foodIdRaw, userId)
      .first<FoodRow>();
    if (!food) throw new HTTPException(404, { message: 'Food not found in your catalog.' });
    const factor = grams / 100;
    foodId = food.id;
    name = food.name;
    calories = round2(food.calories_per_100g * factor);
    protein = round2(food.protein_per_100g * factor);
    carbs = round2(food.carbs_per_100g * factor);
    fat = round2(food.fat_per_100g * factor);
  } else {
    // Custom entry — nutrition values are for the entered amount.
    name = String(body.name ?? '').trim().slice(0, 120);
    if (!name) throw new HTTPException(400, { message: 'Food name is required.' });
    calories = num(body.calories, NaN);
    protein = num(body.protein, NaN);
    carbs = num(body.carbs, NaN);
    fat = num(body.fat, NaN);
    if (![calories, protein, carbs, fat].every((v) => Number.isFinite(v) && v >= 0)) {
      throw new HTTPException(400, { message: 'Calories, protein, carbs and fat must be non-negative numbers.' });
    }
    calories = round2(calories);
    protein = round2(protein);
    carbs = round2(carbs);
    fat = round2(fat);

    // Optionally save the custom food to the catalog for future searches.
    if (body.create_food) {
      await c.env.DB.prepare(
        `INSERT INTO foods (user_id, name, serving_grams, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, name) DO UPDATE SET
           serving_grams=excluded.serving_grams,
           calories_per_100g=excluded.calories_per_100g,
           protein_per_100g=excluded.protein_per_100g,
           carbs_per_100g=excluded.carbs_per_100g,
           fat_per_100g=excluded.fat_per_100g,
           updated_at=datetime('now')`
      )
        .bind(userId, name, grams, (calories * 100) / grams, (protein * 100) / grams, (carbs * 100) / grams, (fat * 100) / grams)
        .run();
      const saved = await c.env.DB.prepare('SELECT id FROM foods WHERE user_id = ?1 AND name = ?2')
        .bind(userId, name)
        .first<{ id: number }>();
      foodId = saved?.id ?? null;
    }
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO food_logs (user_id, food_id, name, meal, grams, calories, protein, carbs, fat, log_date)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(userId, foodId, name, meal, grams, calories, protein, carbs, fat, date)
    .run();

  const entry = await c.env.DB.prepare('SELECT * FROM food_logs WHERE id = ?1')
    .bind(res.meta.last_row_id as number)
    .first<LogRow>();
  return c.json({ entry }, 201);
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('DELETE FROM food_logs WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Entry not found.' });
  return c.json({ ok: true });
});

export default app;
