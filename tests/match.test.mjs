import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideFoodMatch,
  formatMealAnalysis,
  formatSaved,
  formatToday,
  scaleMacros,
  sumNutrition,
} from '../src/telegram/textparse.js';

const mk = (id, name, kcal = 100, p = 20, f = 2, c = 0, serving = 100) => ({
  id, name, serving_grams: serving,
  calories_per_100g: kcal, protein_per_100g: p, carbs_per_100g: c, fat_per_100g: f,
});

/* ---------- food matching decisions ---------- */

test('unique exact candidate resolves directly', () => {
  const d = decideFoodMatch([mk(1, 'Chicken breast')], null);
  assert.equal(d.status, 'ok');
  assert.equal(d.food.id, 1);
});

test('multiple candidates → ask which one (never guess)', () => {
  const d = decideFoodMatch(
    [mk(1, 'Chicken breast'), mk(2, 'Chicken thigh'), mk(3, 'Chicken leg')],
    null
  );
  assert.equal(d.status, 'ambiguous');
  assert.equal(d.options.length, 3);
});

test('no candidates → none', () => {
  assert.equal(decideFoodMatch([], null).status, 'none');
});

test('raw + cooked variants without a hint → ask raw or cooked', () => {
  const d = decideFoodMatch([mk(1, 'Raw chicken breast'), mk(2, 'Cooked chicken breast')], null);
  assert.equal(d.status, 'prep');
  assert.equal(d.rawFood.name, 'Raw chicken breast');
  assert.equal(d.cookedFood.name, 'Cooked chicken breast');
});

test('explicit hint picks the matching variant silently', () => {
  const raw = decideFoodMatch([mk(1, 'Raw chicken breast'), mk(2, 'Cooked chicken breast')], 'raw');
  assert.equal(raw.status, 'ok');
  assert.equal(raw.food.name, 'Raw chicken breast');

  const cooked = decideFoodMatch([mk(1, 'Raw chicken breast'), mk(2, 'Cooked chicken breast')], 'cooked');
  assert.equal(cooked.status, 'ok');
  assert.equal(cooked.food.name, 'Cooked chicken breast');
});

/* ---------- nutrition scaling — MUST match the web app math ---------- */

test('scaleMacros reproduces the spec example (chicken breast ×3)', () => {
  // catalog: per 100 g → 120 kcal, 22.5 P, 2.6 F, 0 C
  const m = scaleMacros({ calories_per_100g: 120, protein_per_100g: 22.5, carbs_per_100g: 0, fat_per_100g: 2.6 }, 300);
  assert.deepEqual(m, { calories: 360, protein: 67.5, carbs: 0, fat: 7.8 });
});

test('scaleMacros handles non-round factors with 2dp rounding', () => {
  const m = scaleMacros({ calories_per_100g: 143, protein_per_100g: 0.9, carbs_per_100g: 0.1, fat_per_100g: 81 }, 20);
  assert.deepEqual(m, { calories: 28.6, protein: 0.18, carbs: 0.02, fat: 16.2 });
});

test('sumNutrition totals a multi-item meal', () => {
  const t = sumNutrition([
    { calories: 360, protein: 67.5, fat: 7.8, carbs: 0 },
    { calories: 286, protein: 25.2, fat: 19.2, carbs: 1.4 },
    { calories: 143, protein: 0.2, fat: 16.2, carbs: 0 },
  ]);
  assert.deepEqual(t, { calories: 789, protein: 92.9, fat: 43.2, carbs: 1.4 });
});

/* ---------- message formatting ---------- */

test('formatMealAnalysis renders the confirmation layout', () => {
  const text = formatMealAnalysis(
    [{ name: 'Chicken breast', amountLabel: '300 g', macros: { calories: 360, protein: 67.5, fat: 7.8, carbs: 0 } }],
    'Lunch'
  );
  assert.match(text, /🍽️ Meal Analysis/);
  assert.match(text, /\(Lunch\)/);
  assert.match(text, /360 kcal/);
  assert.match(text, /67\.5 g protein/);
  assert.match(text, /^TOTAL$/m);
  assert.match(text, /Add this meal\?/);
});

test('formatToday shows consumed vs target and remaining', () => {
  const text = formatToday(
    { consumed: { calories: 1245, protein: 128, carbs: 4, fat: 72 }, net_calories: 1245 },
    { calorie_target: 1900, protein_target: 160, carb_target: 30, fat_target: 100 }
  );
  assert.match(text, /📊 TODAY/);
  assert.match(text, /1,245 \/ 1,900 kcal/);
  assert.match(text, /Remaining\n655 kcal/);
});

test('formatSaved lists items and totals after saving', () => {
  const saved = [
    { name: 'Whole egg', amountLabel: '4 pc · 200 g', macros: { calories: 286, protein: 25.2, fat: 19.2, carbs: 1.4 } },
  ];
  const text = formatSaved('Breakfast', saved, { calories: 286, protein: 25.2, fat: 19.2, carbs: 1.4 });
  assert.match(text, /✅ Meal logged/);
  assert.match(text, /• Whole egg/);
  assert.match(text, /dashboard totals are updated/);
});
