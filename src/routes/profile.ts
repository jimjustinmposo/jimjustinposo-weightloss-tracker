import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { computeTargets } from '../calc';
import { ACTIVITY_LEVELS, DIET_TYPES, GENDERS, GOAL_TYPES, isDateStr, num, type ActivityLevel, type DietType, type Gender, type GoalType } from '../types';
import type { AppVars, Env } from '../types';

type ProfileRow = Record<string, unknown>;

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

function profileComplete(p: ProfileRow | null): boolean {
  return !!(
    p &&
    p.age != null &&
    p.height_cm != null &&
    p.current_weight != null
  );
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(userId).first<ProfileRow>();
  return c.json({ profile, complete: profileComplete(profile) });
});

app.put('/', async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const age = Math.round(num(body.age));
  const heightCm = num(body.height_cm);
  const currentWeight = num(body.current_weight);
  const gender = String(body.gender ?? '') as Gender;
  const activityLevel = String(body.activity_level ?? '') as ActivityLevel;
  const goalType = String(body.goal_type ?? 'lose') as GoalType;
  const dietType = String(body.diet_type ?? 'normal') as DietType;
  let weeklyGoalKg = num(body.weekly_goal_kg, 0.5);
  const stepGoal = Math.round(num(body.step_goal, 10000));
  const name = String(body.name ?? '').trim().slice(0, 60) || null;

  if (!Number.isFinite(age) || age < 10 || age > 100) throw new HTTPException(400, { message: 'Age must be between 10 and 100.' });
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) throw new HTTPException(400, { message: 'Height must be between 100 and 250 cm.' });
  if (!Number.isFinite(currentWeight) || currentWeight < 25 || currentWeight > 450) throw new HTTPException(400, { message: 'Weight must be between 25 and 450 kg.' });
  if (!GENDERS.includes(gender)) throw new HTTPException(400, { message: 'Invalid gender.' });
  if (!ACTIVITY_LEVELS.includes(activityLevel)) throw new HTTPException(400, { message: 'Invalid activity level.' });
  if (!GOAL_TYPES.includes(goalType)) throw new HTTPException(400, { message: 'Invalid goal type.' });
  if (!DIET_TYPES.includes(dietType)) throw new HTTPException(400, { message: 'Invalid diet type.' });
  if (!Number.isFinite(weeklyGoalKg)) weeklyGoalKg = 0.5;
  weeklyGoalKg = goalType === 'maintain' ? 0 : Math.min(Math.max(weeklyGoalKg, 0.1), 1.5);
  if (!Number.isFinite(stepGoal) || stepGoal < 1000 || stepGoal > 100000) {
    throw new HTTPException(400, { message: 'Step goal must be between 1,000 and 100,000.' });
  }

  const existing = await c.env.DB
    .prepare('SELECT start_weight FROM profiles WHERE user_id = ?1')
    .bind(userId)
    .first<{ start_weight: number | null }>();
  const startWeight =
    num(body.start_weight, NaN) ||
    existing?.start_weight ||
    currentWeight;

  const targets = computeTargets({
    weightKg: currentWeight,
    heightCm,
    age,
    gender,
    activityLevel,
    goalType,
    weeklyGoalKg,
    dietType,
  });

  await c.env.DB.prepare(
    `INSERT INTO profiles (
       user_id, name, age, gender, height_cm, activity_level, start_weight, current_weight,
       goal_type, weekly_goal_kg, step_goal, diet_type, bmr, tdee, bmi, bmi_category,
       calorie_target, protein_target, carb_target, fat_target, updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       name=excluded.name, age=excluded.age, gender=excluded.gender, height_cm=excluded.height_cm,
       activity_level=excluded.activity_level, start_weight=excluded.start_weight,
       current_weight=excluded.current_weight, goal_type=excluded.goal_type,
       weekly_goal_kg=excluded.weekly_goal_kg, step_goal=excluded.step_goal,
       diet_type=excluded.diet_type,
       bmr=excluded.bmr, tdee=excluded.tdee, bmi=excluded.bmi, bmi_category=excluded.bmi_category,
       calorie_target=excluded.calorie_target, protein_target=excluded.protein_target,
       carb_target=excluded.carb_target, fat_target=excluded.fat_target,
       updated_at=datetime('now')`
  )
    .bind(
      userId, name, age, gender, heightCm, activityLevel, startWeight, currentWeight,
      goalType, weeklyGoalKg, stepGoal, dietType,
      targets.bmr, targets.tdee, targets.bmi, targets.bmi_category,
      targets.calorie_target, targets.protein_target, targets.carb_target, targets.fat_target
    )
    .run();

  // Keep today's weight log in sync with the profile weight.
  const today = isDateStr(body.today) ? body.today : null;
  if (today) {
    await c.env.DB.prepare(
      `INSERT INTO weight_logs (user_id, log_date, weight) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, log_date) DO UPDATE SET weight = excluded.weight`
    )
      .bind(userId, today, currentWeight)
      .run();
  }

  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(userId).first<ProfileRow>();
  return c.json({ profile, targets, complete: profileComplete(profile) });
});

export default app;
