/**
 * Pure text-parsing / matching / formatting helpers for the Telegram food bot.
 * Plain JS (JSDoc-typed) so the Node built-in test runner can exercise it
 * without a TS build step. No DOM/DB/network access in this file.
 *
 * Nutrition scaling mirrors src/routes/logs.ts exactly: round2(per100 × grams/100).
 */

/** @typedef {'breakfast'|'lunch'|'dinner'|'snack'} MealType */

const MEAL_WORDS = {
  breakfast: 'breakfast', breakfasts: 'breakfast',
  lunch: 'lunch', lunches: 'lunch',
  dinner: 'dinner', dinners: 'dinner', supper: 'dinner',
  snack: 'snack', snacks: 'snack',
};

export const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };

export function round2(v) {
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

const UNIT_ALIASES = {
  g: 'g', gr: 'g', gram: 'g', grams: 'g', gm: 'g', gms: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  egg: 'piece', eggs: 'piece',
  serving: 'serving', servings: 'serving', portion: 'serving', portions: 'serving',
};

/** Normalize any supported unit spelling to a canonical unit. Returns null if unknown. */
export function normalizeUnit(unit) {
  if (unit == null) return null;
  const u = String(unit).trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[u] ?? null;
}

export const GRAMS_PER_OZ = 28.3495;
export const GRAMS_PER_LB = 453.592;

/**
 * Convert a quantity + canonical unit into grams.
 * `servingGrams` (from foods.serving_grams) is required for piece/serving units.
 * Returns { ok:true, grams } or { ok:false, reason }.
 */
export function convertToGrams(quantity, unit, servingGrams) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0 || q > 100000) return { ok: false, reason: 'invalid_quantity' };
  const canon = normalizeUnit(unit);
  if (!canon) return { ok: false, reason: 'unknown_unit' };
  let grams;
  switch (canon) {
    case 'g': grams = q; break;
    case 'ml': grams = q; break; // 1 ml ≈ 1 g for food logging purposes
    case 'kg': grams = q * 1000; break;
    case 'oz': grams = q * GRAMS_PER_OZ; break;
    case 'lb': grams = q * GRAMS_PER_LB; break;
    case 'piece':
    case 'serving': {
      const sg = Number(servingGrams);
      if (!Number.isFinite(sg) || sg <= 0) return { ok: false, reason: 'no_serving_size' };
      grams = q * sg;
      break;
    }
    default: return { ok: false, reason: 'unknown_unit' };
  }
  return { ok: true, grams: round2(grams) };
}

/* ------------------------------------------------------------------ */
/* Message parsing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pull a leading meal name off the message:
 *   "Breakfast: 4 eggs"      → {meal:'breakfast', rest:'4 eggs'}
 *   "for lunch 300g chicken" → {meal:'lunch',     rest:'300g chicken'}
 * Unknown prefix ("Random: eggs") → {invalidPrefix:true}
 */
export function extractMealPrefix(text) {
  const t = String(text ?? '').trim();
  let m = /^([A-Za-z]+)\s*:\s*(.+)$/s.exec(t);
  if (m) {
    const word = m[1].toLowerCase();
    if (MEAL_WORDS[word]) return { meal: MEAL_WORDS[word], rest: m[2].trim(), invalidPrefix: false };
    return { meal: null, rest: t, invalidPrefix: true };
  }
  m = /\b(?:for|at)\s+(breakfast|lunch|dinner|snacks?)\b[,:!]?\s*/i.exec(t);
  if (m) {
    return { meal: MEAL_WORDS[m[1].toLowerCase()], rest: t.slice(m.index + m[0].length).trim() || t, invalidPrefix: false };
  }
  return { meal: null, rest: t, invalidPrefix: false };
}

/** Detect an explicit raw/cooked hint anywhere in the text ('raw' | 'cooked' | null). */
export function detectPrep(text) {
  const t = String(text ?? '').toLowerCase();
  if (/\braw\b/.test(t)) return 'raw';
  if (/\b(cooked|grilled|boiled|fried|baked|roasted|steamed)\b/.test(t)) return 'cooked';
  return null;
}

function prepTag(name) {
  const n = String(name).toLowerCase();
  if (/\braw\b/.test(n)) return 'raw';
  if (/\b(cooked|grilled|boiled|fried|baked|roasted|steamed)\b/.test(n)) return 'cooked';
  return null;
}

function baseName(name) {
  return String(name)
    .replace(/\b(raw|cooked|grilled|boiled|fried|baked|roasted|steamed)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normalize + validate the AI's extracted item array.
 * Returns { items:[{food, quantity:number|null, unit:string}] } — quantity null means "unspecified".
 */
export function normalizeAiItems(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const items = [];
  for (const it of list.slice(0, 10)) {
    if (!it || typeof it !== 'object') continue;
    const food = String(it.food ?? '').trim().slice(0, 120);
    if (!food) continue;
    let qty = Number(it.quantity);
    if (!Number.isFinite(qty) || qty <= 0) qty = null;
    else if (qty > 10000) qty = null;
    items.push({ food, quantity: qty, unit: String(it.unit ?? '').trim().toLowerCase() });
  }
  return { items };
}

/**
 * Decide how to resolve ONE food item against catalog candidates fetched from D1.
 * candidates: [{id, name, serving_grams, calories_per_100g, ...}]
 * prepHint: 'raw' | 'cooked' | null (user explicitly said raw/cooked).
 *
 * Returns one of:
 *   { status:'ok', food }
 *   { status:'ambiguous', options:candidates }
 *   { status:'prep', rawFood, cookedFood }
 *   { status:'none' }
 */
export function decideFoodMatch(candidates, prepHint) {
  const pool = Array.isArray(candidates) ? candidates : [];
  if (!pool.length) return { status: 'none' };

  const raws = pool.filter((c) => prepTag(c.name) === 'raw');
  const cooks = pool.filter((c) => prepTag(c.name) === 'cooked');

  // User explicitly said raw/cooked → restrict to that variant when available.
  if (prepHint === 'raw' && raws.length) {
    if (raws.length === 1) return { status: 'ok', food: raws[0] };
    return { status: 'ambiguous', options: raws.slice(0, 8) };
  }
  if (prepHint === 'cooked' && cooks.length) {
    if (cooks.length === 1) return { status: 'ok', food: cooks[0] };
    return { status: 'ambiguous', options: cooks.slice(0, 8) };
  }

  // Both variants of the same base food exist and user didn't specify → ask.
  if (raws.length === 1 && cooks.length === 1 && baseName(raws[0].name) === baseName(cooks[0].name)) {
    return { status: 'prep', rawFood: raws[0], cookedFood: cooks[0] };
  }

  if (pool.length === 1) return { status: 'ok', food: pool[0] };
  if (pool.length > 1) return { status: 'ambiguous', options: pool.slice(0, 8) };
  return { status: 'none' };
}

/* ------------------------------------------------------------------ */
/* Rule-based extraction fallback (works without any AI provider)      */
/* ------------------------------------------------------------------ */

const CHUNK_SPLIT = /\s*(?:,|\band\b|&|\+)\s*/i;
const UNIT_ALT = 'kg|kgs|kilo|kilos|kilograms?|gr|gm|g|grams?|ml|oz|ounces?|lb|lbs|pounds?|piece|pieces|pc|pcs|eggs?|serving|servings|portions?';
const LEAD_RE = new RegExp(`^([0-9]+(?:[.,][0-9]+)?)\\s*(${UNIT_ALT})?\\b\\.?\\s*(.*)$`, 'i');
const TRAIL_RE = new RegExp(`^(.+?)\\s+([0-9]+(?:[.,][0-9]+)?)\\s*(${UNIT_ALT})\\.?$`, 'i');
const FILLER_RE = /^(?:i|we|had|have|ate|eat|eaten|drank|took|just|some|a|an|the|my|about|around|roughly)\b[\s-]*/i;

function cleanName(s) {
  let n = String(s).replace(/\s+/g, ' ').trim();
  while (FILLER_RE.test(n)) n = n.replace(FILLER_RE, '');
  return n.trim().replace(/^of\s+/i, '').trim();
}

function singularForUnit(rawUnit) {
  const u = String(rawUnit ?? '').toLowerCase().trim();
  if (/^eggs?$/.test(u)) return 'egg';
  const c = normalizeUnit(u);
  if (c === 'piece') return 'piece';
  if (c === 'serving') return 'serving';
  return '';
}

/**
 * Deterministic fallback extractor used when no AI provider is configured
 * (or the AI call fails). Understands the common patterns:
 *   "300g chicken breast, 4 eggs and 20g salted butter"
 *   "0.5kg pork belly" · "10 oz ribeye" · "chicken breast 300g"
 * Items without any amount come back with quantity:null so the bot can ask.
 */
export function localExtract(text) {
  // Newlines act as item separators — normalize them to commas up front so
  // the per-chunk regexes (whose `.` can't cross newlines) behave predictably.
  const norm = String(text ?? '').replace(/\r?\n/g, ', ');
  const chunks = norm
    .split(CHUNK_SPLIT)
    .map((s) => {
      // strip conversational fillers BEFORE pattern matching
      let c = s.trim();
      while (FILLER_RE.test(c)) c = c.replace(FILLER_RE, '');
      return c.trim();
    })
    .filter(Boolean)
    .slice(0, 12);
  console.log('[LE] entry:', JSON.stringify(text), '-> norm:', JSON.stringify(norm), '-> chunks:', JSON.stringify(chunks));
  console.log('[LE] LEAD.src:', LEAD_RE.source);

  const items = [];
  for (const chunk of chunks) {
    let m = LEAD_RE.exec(chunk);
    if (m && m[3] !== undefined) {
      const name = cleanName(m[3]);
      const qty = Number(m[1].replace(',', '.'));
      if (name) {
        items.push({
          food: name || singularForUnit(m[2]),
          quantity: Number.isFinite(qty) ? qty : null,
          unit: normalizeUnit(m[2]) ?? '',
        });
        continue;
      }
      // "4 eggs" — unit word doubles as the food name
      if (!name && m[2]) {
        items.push({ food: singularForUnit(m[2]) || m[2].toLowerCase(), quantity: qty, unit: normalizeUnit(m[2]) ?? '' });
        continue;
      }
    }

    m = TRAIL_RE.exec(chunk);
    if (m) {
      const name = cleanName(m[1]);
      const qty = Number(m[2].replace(',', '.'));
      if (name) {
        items.push({ food: name, quantity: Number.isFinite(qty) ? qty : null, unit: normalizeUnit(m[3]) ?? '' });
        continue;
      }
    }

    const bare = cleanName(chunk);
    if (bare) items.push({ food: bare, quantity: null, unit: '' });
  }
  return { items };
}

/* ------------------------------------------------------------------ */
/* Nutrition math (mirrors logs.ts exactly)                            */
/* ------------------------------------------------------------------ */

/**
 * Scale per-100g nutrition values to a given amount.
 * per100: { calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g }
 * Returns { calories, protein, carbs, fat } rounded to 2dp — identical to web logging.
 */
export function scaleMacros(per100, grams) {
  const f = grams / 100;
  return {
    calories: round2(Number(per100.calories_per_100g) * f),
    protein: round2(Number(per100.protein_per_100g) * f),
    carbs: round2(Number(per100.carbs_per_100g) * f),
    fat: round2(Number(per100.fat_per_100g) * f),
  };
}

/** Sum an array of {calories,protein,carbs,fat} objects (2dp totals). */
export function sumNutrition(entries) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries || []) {
    t.calories += Number(e.calories ?? 0);
    t.protein += Number(e.protein ?? 0);
    t.carbs += Number(e.carbs ?? 0);
    t.fat += Number(e.fat ?? 0);
  }
  for (const k of Object.keys(t)) t[k] = round2(t[k]);
  return t;
}

/* ------------------------------------------------------------------ */
/* Message formatting                                                  */
/* ------------------------------------------------------------------ */

const n1 = (v) => (Math.round(Number(v) * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });

/** resolvedItems: [{name, amountLabel, macros:{calories,protein,carbs,fat}}] */
export function formatMealAnalysis(resolvedItems, mealLabel) {
  const lines = [];
  lines.push('🍽️ Meal Analysis');
  if (mealLabel) lines.push(`(${mealLabel})`);
  lines.push('');
  for (const it of resolvedItems) {
    lines.push(it.name);
    lines.push(it.amountLabel);
    lines.push(`${n1(it.macros.calories)} kcal`);
    lines.push(`${n1(it.macros.protein)} g protein`);
    lines.push(`${n1(it.macros.fat)} g fat`);
    lines.push(`${n1(it.macros.carbs)} g carbs`);
    lines.push('');
  }
  const tot = sumNutrition(resolvedItems.map((i) => i.macros));
  lines.push('TOTAL');
  lines.push(`${n1(tot.calories)} kcal · P ${n1(tot.protein)} g · F ${n1(tot.fat)} g · C ${n1(tot.carbs)} g`);
  lines.push('');
  lines.push('Add this meal?');
  return lines.join('\n');
}

/** today: getDaySummary()-style result; targets: profile target fields */
export function formatToday(today, targets) {
  const c = today.consumed;
  const ct = targets?.calorie_target ?? 0;
  const pt = targets?.protein_target ?? 0;
  const ft = targets?.fat_target ?? 0;
  const cbt = targets?.carb_target ?? 0;
  const remaining = ct ? Math.round((ct - today.net_calories) * 10) / 10 : null;
  const lines = [
    '📊 TODAY',
    '',
    'Calories',
    `${n1(c.calories)} / ${n1(ct)} kcal`,
    '',
    'Protein',
    `${n1(c.protein)} / ${n1(pt)} g`,
    '',
    'Fat',
    `${n1(c.fat)} / ${n1(ft)} g`,
    '',
    'Carbs',
    `${n1(c.carbs)} / ${n1(cbt)} g`,
  ];
  if (remaining != null) {
    lines.push('', 'Remaining', `${n1(remaining)} kcal`);
  }
  return lines.join('\n');
}

/** Format a confirmation summary after items were saved. */
export function formatSaved(mealLabel, savedItems, totals) {
  const lines = ['✅ Meal logged', mealLabel ? `(${mealLabel})` : '', ''];
  for (const s of savedItems) lines.push(`• ${s.name} — ${s.amountLabel} (${n1(s.macros.calories)} kcal)`);
  lines.push('');
  lines.push(`TOTAL: ${n1(totals.calories)} kcal · P ${n1(totals.protein)} g · F ${n1(totals.fat)} g · C ${n1(totals.carbs)} g`);
  lines.push('');
  lines.push('Your dashboard totals are updated.');
  return lines.filter((l) => l !== '').join('\n');
}
