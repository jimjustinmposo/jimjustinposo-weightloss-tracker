import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';
import { num } from '../types';

type FoodRow = Record<string, unknown>;

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => '\\' + m);
}

/** Normalize per-serving values to per-100g values. */
function toPer100(value: number, grams: number): number {
  return Math.round(((value * 100) / grams) * 100) / 100;
}

// Search / list the user's food catalog.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  let rows: FoodRow[];
  if (q) {
    rows = (
      await c.env.DB.prepare(
        "SELECT * FROM foods WHERE user_id = ?1 AND name LIKE ?2 ESCAPE '\\' ORDER BY name LIMIT 50"
      )
        .bind(userId, `%${escapeLike(q)}%`)
        .all<FoodRow>()
    ).results;
  } else {
    rows = (
      await c.env.DB.prepare(
        'SELECT * FROM foods WHERE user_id = ?1 ORDER BY updated_at DESC, name LIMIT 200'
      )
        .bind(userId)
        .all<FoodRow>()
    ).results;
  }
  return c.json({ foods: rows });
});

// Create or update a catalog food. Body carries per-serving nutrition.
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const name = String(body.name ?? '').trim().slice(0, 120);
  const servingGrams = num(body.serving_grams);
  const calories = num(body.calories, 0);
  const protein = num(body.protein, 0);
  const carbs = num(body.carbs, 0);
  const fat = num(body.fat, 0);

  if (!name) throw new HTTPException(400, { message: 'Food name is required.' });
  if (!Number.isFinite(servingGrams) || servingGrams <= 0 || servingGrams > 5000) {
    throw new HTTPException(400, { message: 'Serving size must be between 0 and 5,000 grams.' });
  }
  for (const [label, v] of [['Calories', calories], ['Protein', protein], ['Carbs', carbs], ['Fat', fat]] as const) {
    if (v < 0 || v > 20000) throw new HTTPException(400, { message: `${label} value looks invalid.` });
  }

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
    .bind(
      userId,
      name,
      servingGrams,
      toPer100(calories, servingGrams),
      toPer100(protein, servingGrams),
      toPer100(carbs, servingGrams),
      toPer100(fat, servingGrams)
    )
    .run();

  const food = await c.env.DB.prepare('SELECT * FROM foods WHERE user_id = ?1 AND name = ?2')
    .bind(userId, name)
    .first<FoodRow>();
  return c.json({ food }, 201);
});

app.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT * FROM foods WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .first<FoodRow>();
  if (!existing) throw new HTTPException(404, { message: 'Food not found.' });

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? existing.name).trim().slice(0, 120);
  const servingGrams = num(body.serving_grams, existing.serving_grams as number);
  const calories = num(body.calories, NaN);
  const protein = num(body.protein, NaN);
  const carbs = num(body.carbs, NaN);
  const fat = num(body.fat, NaN);

  if (!Number.isFinite(servingGrams) || servingGrams <= 0) {
    throw new HTTPException(400, { message: 'Serving size must be positive.' });
  }
  // If raw macros not provided, convert stored per-100g back to the new serving.
  const perServing = (per100: number, g: number) => (per100 * g) / 100;
  const cal = Number.isFinite(calories) ? calories : perServing(existing.calories_per_100g as number, servingGrams);
  const pro = Number.isFinite(protein) ? protein : perServing(existing.protein_per_100g as number, servingGrams);
  const car = Number.isFinite(carbs) ? carbs : perServing(existing.carbs_per_100g as number, servingGrams);
  const fa = Number.isFinite(fat) ? fat : perServing(existing.fat_per_100g as number, servingGrams);

  try {
    await c.env.DB.prepare(
      `UPDATE foods SET name=?3, serving_grams=?4,
         calories_per_100g=?5, protein_per_100g=?6, carbs_per_100g=?7, fat_per_100g=?8,
         updated_at=datetime('now')
       WHERE id = ?1 AND user_id = ?2`
    )
      .bind(
        id,
        userId,
        name,
        servingGrams,
        toPer100(cal, servingGrams),
        toPer100(pro, servingGrams),
        toPer100(car, servingGrams),
        toPer100(fa, servingGrams)
      )
      .run();
  } catch (err) {
    if (String((err as Error)?.message).toUpperCase().includes('UNIQUE')) {
      throw new HTTPException(409, { message: 'Another food with that name already exists.' });
    }
    throw err;
  }

  const food = await c.env.DB.prepare('SELECT * FROM foods WHERE id = ?1').bind(id).first<FoodRow>();
  return c.json({ food });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('DELETE FROM foods WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Food not found.' });
  return c.json({ ok: true });
});

export default app;
