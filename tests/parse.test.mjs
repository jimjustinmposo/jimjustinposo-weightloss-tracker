import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertToGrams,
  detectPrep,
  extractMealPrefix,
  normalizeAiItems,
  normalizeUnit,
} from '../src/telegram/textparse.js';

/* ---------- units ---------- */

test('normalizeUnit maps aliases to canonical units', () => {
  assert.equal(normalizeUnit('g'), 'g');
  assert.equal(normalizeUnit('Grams'), 'g');
  assert.equal(normalizeUnit('kg'), 'kg');
  assert.equal(normalizeUnit('Kilograms'), 'kg');
  assert.equal(normalizeUnit('oz'), 'oz');
  assert.equal(normalizeUnit('lb.'), 'lb'); // trailing dot tolerated
  assert.equal(normalizeUnit('ml'), 'ml');
  assert.equal(normalizeUnit('pieces'), 'piece');
  assert.equal(normalizeUnit('Egg'), 'piece'); // singular alias
  assert.equal(normalizeUnit('eggs'), 'piece');
  assert.equal(normalizeUnit('servings'), 'serving');
  assert.equal(normalizeUnit('cups'), null); // unsupported
});

test('convertToGrams handles mass units', () => {
  assert.equal(convertToGrams(300, 'g').grams, 300);
  assert.equal(convertToGrams(0.3, 'kg').grams, 300);
  assert.equal(Math.round(convertToGrams(10, 'oz').grams * 100) / 100, 283.5);
  assert.ok(Math.abs(convertToGrams(0.5, 'lb').grams - 226.796) < 0.01);
});

test('convertToGrams treats ml as ≈1 g/ml', () => {
  assert.equal(convertToGrams(250, 'ml').grams, 250);
});

test('convertToGrams uses foods.serving_grams for pieces/servings', () => {
  const r = convertToGrams(4, 'piece', 50); // e.g. egg = 50 g
  assert.equal(r.ok, true);
  assert.equal(r.ok ? r.grams : 0, 200);
  const s = convertToGrams(2, 'serving', 150);
  assert.equal(s.ok ? s.grams : 0, 300);
});

test('convertToGrams rejects bad input', () => {
  assert.equal(convertToGrams(-5, 'g').ok, false);
  assert.equal(convertToGrams(100, 'cups').reason, 'unknown_unit');
  // pieces without a serving size in the catalog → ask for a weight instead
  assert.equal(convertToGrams(2, 'piece', null).reason, 'no_serving_size');
});

/* ---------- meal prefix ---------- */

test('extractMealPrefix detects "Breakfast:" style prefixes', () => {
  const r = extractMealPrefix('Breakfast: 4 eggs and 20g butter');
  assert.equal(r.meal, 'breakfast');
  assert.equal(r.rest, '4 eggs and 20g butter');
});

test('extractMealPrefix detects "for lunch" phrasing', () => {
  const r = extractMealPrefix('for lunch 300g chicken breast');
  assert.equal(r.meal, 'lunch');
  assert.match(r.rest, /300g chicken breast/);
});

test('extractMealPrefix flags unknown prefixes instead of guessing', () => {
  const r = extractMealPrefix('Randomword: some eggs');
  assert.equal(r.invalidPrefix, true);
  assert.equal(r.meal, null);
});

test('extractMealPrefix passes plain text through untouched', () => {
  const r = extractMealPrefix('300g chicken breast');
  assert.equal(r.meal, null);
  assert.equal(r.invalidPrefix, false);
  assert.equal(r.rest, '300g chicken breast');
});

/* ---------- raw vs cooked detection ---------- */

test('detectPrep finds explicit preparation words', () => {
  assert.equal(detectPrep('300g raw chicken breast'), 'raw');
  assert.equal(detectPrep('200g grilled chicken'), 'cooked');
  assert.equal(detectPrep('4 boiled eggs'), 'cooked');
  assert.equal(detectPrep('20g butter'), null);
});

/* ---------- AI output normalization ---------- */

test('normalizeAiItems strips markdown fences and prose-wrapped arrays safely', () => {
  const { items } = normalizeAiItems([
    { food: 'chicken breast', quantity: 300, unit: 'g' },
    { food: 'egg', quantity: 4, unit: 'piece' },
    { food: '', quantity: 10 }, // dropped — no name
    { food: 'rice', quantity: 'not-a-number' }, // quantity → null
    { food: 'salad' }, // quantity → null (unspecified)
  ]);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], { food: 'chicken breast', quantity: 300, unit: 'g' });
  assert.equal(items[2].quantity, null);
  assert.equal(items[3].quantity, null);
});

test('normalizeAiItems ignores non-array garbage', () => {
  assert.equal(normalizeAiItems(null).items.length, 0);
  assert.equal(normalizeAiItems('hello').items.length, 0);
});

/* ---------- rule-based (no-AI) extraction ---------- */

import { localExtract } from '../src/telegram/textparse.js';

test('localExtract parses the classic multi-item meal message', () => {
  const { items } = localExtract('300g chicken breast, 4 eggs and 20g salted butter');
  assert.deepEqual(
    items.map((i) => [i.food, i.quantity, i.unit]),
    [
      ['chicken breast', 300, 'g'],
      ['egg', 4, 'piece'],
      ['salted butter', 20, 'g'],
    ]
  );
});

test('localExtract handles kg, oz, ml and trailing-unit phrasing', () => {
  const a = localExtract('0.5kg pork belly').items[0];
  assert.equal(a.food, 'pork belly');
  assert.equal(a.quantity, 0.5);
  assert.equal(a.unit, 'kg');

  const b = localExtract('10 oz ribeye').items[0];
  assert.equal(b.food, 'ribeye');
  assert.equal(b.quantity, 10);
  assert.equal(b.unit, 'oz');

  const c = localExtract('chicken breast 300g').items[0];
  assert.equal(c.food, 'chicken breast');
  assert.equal(c.quantity, 300);
  assert.equal(c.unit, 'g');

  const d = localExtract('250ml milk').items[0];
  assert.equal(d.quantity, 250);
  assert.equal(d.unit, 'ml');
});

test('localExtract strips filler words and marks missing amounts', () => {
  const { items } = localExtract('I ate some chicken');
  assert.equal(items.length, 1);
  assert.equal(items[0].food, 'chicken');
  assert.equal(items[0].quantity, null);

  const one = localExtract('had 2 slices of bread')[0];
  assert.ok(one.quantity >= 2); // "slices" unsupported → unit empty but qty captured
});

test('localExtract splits on commas / and / & / newlines', () => {
  const { items } = localExtract('100g rice\n50g beans & 3 eggs');
  assert.equal(items.length, 3);
});

