import test from 'node:test';
import assert from 'node:assert/strict';
import {
  round2,
  shiftDate,
  dateRange,
  burnedFromSteps,
  dayTotals,
  caloriesSeries,
  computeDashboard,
  scaleFood,
  toPer100,
  bmiCategory,
  sortDescByDate,
  sortAscByDate,
  nameMatch,
} from '../public/js/offline-math.js';

test('round2 rounds half to 2 decimals', () => {
  assert.equal(round2(12.345), 12.35);
  assert.equal(round2(3.14159), 3.14);
  assert.equal(round2(0), 0);
});

test('shiftDate moves across month boundaries (UTC)', () => {
  assert.equal(shiftDate('2026-08-01', -1), '2026-07-31');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});

test('dateRange is inclusive', () => {
  assert.deepEqual(dateRange('2026-08-24', '2026-08-26'), ['2026-08-24', '2026-08-25', '2026-08-26']);
});

test('burnedFromSteps matches calc.ts stepCalories + steps.ts rounding', () => {
  // steps.ts: Math.round(stepCalories(steps, weightKg, heightCm) * 10) / 10
  // stepCalories(10000, 80, 175): stride = 1.75*0.414=0.7245m → 7.245 km → 7.245*80*1.036
  const expected = Math.round(7.245 * 80 * 1.036 * 10) / 10;
  assert.equal(burnedFromSteps(10000, 80, 175), expected);
  assert.equal(burnedFromSteps(0, 80, 175), 0);
});

test('dayTotals sums and rounds like SQL SUM + app rounding', () => {
  const logs = [
    { calories: 100.11, protein: 10.1, carbs: 20.2, fat: 5.5 },
    { calories: 50.22, protein: 5.2, carbs: 10.1, fat: 2.2 },
  ];
  assert.deepEqual(dayTotals(logs), {
    calories: round2(150.33),
    protein: round2(15.3),
    carbs: round2(30.3),
    fat: round2(7.7),
  });
  assert.deepEqual(dayTotals([]), { calories: 0, protein: 0, carbs: 0, fat: 0 });
});

test('caloriesSeries rounds each day sum to an integer like ROUND(SUM())', () => {
  const logs = [
    { log_date: '2026-08-24', calories: 100.4 },
    { log_date: '2026-08-24', calories: 199.6 },
    { log_date: '2026-08-25', calories: 250 },
  ];
  const series = caloriesSeries(logs, '2026-08-23', '2026-08-25');
  assert.deepEqual(series, [
    { log_date: '2026-08-23', calories: 0 },
    { log_date: '2026-08-24', calories: 300 }, // ROUND(300.0)
    { log_date: '2026-08-25', calories: 250 },
  ]);
});

test('computeDashboard mirrors GET /api/dashboard', () => {
  const profile = {
    user_id: 1, bmr: 1700, tdee: 2300, bmi: 27.5, bmi_category: 'Overweight',
    calorie_target: 2000, protein_target: 130, carb_target: 200, fat_target: 70,
    step_goal: 10000, goal_type: 'lose', weekly_goal_kg: 0.5,
    current_weight: 84, start_weight: 90,
  };
  const dayLogs = [
    { id: 1, log_date: '2026-08-24', meal: 'breakfast', name: 'Eggs', grams: 100, calories: 155, protein: 13, carbs: 1.1, fat: 11, created_at: 't1' },
    { id: 2, log_date: '2026-08-24', meal: 'lunch', name: 'Rice', grams: 200, calories: 260, protein: 5, carbs: 60, fat: 0.5, created_at: 't2' },
  ];
  const allLogs = [
    ...dayLogs,
    { id: 3, log_date: '2026-08-23', meal: 'dinner', name: 'Chicken', grams: 150, calories: 247.5, protein: 46.5, carbs: 0, fat: 5.4, created_at: 't0' },
  ];
  const steps = [
    { log_date: '2026-08-24', steps: 12000, calories_burned: 420.5 },
    { log_date: '2026-08-23', steps: 5000, calories_burned: 175.2 },
  ];
  const weights = [
    { id: 9, log_date: '2026-08-20', weight: 84.8 },
    { id: 10, log_date: '2026-08-24', weight: 84.0 },
  ];

  const d = computeDashboard({ date: '2026-08-24', profile, logs: dayLogs, windowLogs: allLogs, steps, weights });

  assert.equal(d.steps, 12000);
  assert.equal(d.burned_steps, 420.5);
  assert.equal(d.consumed.calories, 415); // 155 + 260
  assert.equal(d.net_calories, round2(415 - 420.5));
  assert.equal(d.remaining_calories, round2(2000 - d.net_calories));
  assert.equal(d.targets.calorie_target, 2000);
  assert.equal(d.profile.user_id, 1);

  // meals grouped into the 4 fixed buckets, ordered by created_at/id
  assert.equal(d.meals.breakfast.length, 1);
  assert.equal(d.meals.lunch.length, 1);
  assert.equal(d.meals.dinner.length, 0);
  assert.equal(d.meals.snack.length, 0);

  // weight series ascending by date
  assert.deepEqual(d.weight_series.map((w) => w.weight), [84.8, 84.0]);

  // 7-day zero-filled steps + calories series ending at the requested date
  assert.equal(d.steps_series.length, 7);
  assert.equal(d.steps_series[6].log_date, '2026-08-24');
  assert.equal(d.steps_series[6].steps, 12000);
  assert.equal(d.calories_series.length, 7);
  assert.equal(d.calories_series[6].calories, 415);
  assert.equal(d.calories_series[5].calories, 248); // ROUND(247.5) for Aug 23
  assert.equal(d.calories_series[0].calories, 0);
});

test('scaleFood scales per-100g like logs.ts scaleFood', () => {
  const food = { calories_per_100g: 165, protein_per_100g: 31, carbs_per_100g: 0, fat_per_100g: 3.6 };
  assert.deepEqual(scaleFood(food, 200), { calories: 330, protein: 62, carbs: 0, fat: 7.2 });
  assert.deepEqual(scaleFood(food, 50), { calories: 82.5, protein: 15.5, carbs: 0, fat: 1.8 });
});

test('toPer100 normalizes per-serving back to per-100g', () => {
  assert.equal(toPer100(330, 200), 165);
  assert.equal(toPer100(82.5, 50), 165);
});

test('bmiCategory matches calc.ts thresholds', () => {
  assert.equal(bmiCategory(17), 'Underweight');
  assert.equal(bmiCategory(22), 'Normal weight');
  assert.equal(bmiCategory(27), 'Overweight');
  assert.equal(bmiCategory(31), 'Obese');
});

test('ordering helpers mirror server ORDER BY', () => {
  const rows = [
    { id: 2, log_date: '2026-08-24' },
    { id: 1, log_date: '2026-08-24' },
    { id: 3, log_date: '2026-08-25' },
  ];
  assert.deepEqual(sortDescByDate(rows).map((r) => r.id), [3, 2, 1]);
  assert.deepEqual(sortAscByDate(rows).map((r) => r.id), [1, 2, 3]);
});

test('nameMatch is case-insensitive substring', () => {
  assert.equal(nameMatch({ name: 'Chicken Breast Raw' }, 'chicken'), true);
  assert.equal(nameMatch({ name: 'Chicken Breast Raw' }, ''), true);
  assert.equal(nameMatch({ name: 'Rice' }, 'egg'), false);
});