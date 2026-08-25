import type { MealType } from '../types';

export declare const MEAL_LABELS: Record<MealType, string>;
export declare function round2(v: number): number;
export declare function normalizeUnit(unit: unknown): string | null;
export declare const GRAMS_PER_OZ: number;
export declare const GRAMS_PER_LB: number;
export declare function convertToGrams(
  quantity: unknown,
  unit: string,
  servingGrams?: number | null
): { ok: true; grams: number } | { ok: false; reason: 'invalid_quantity' | 'unknown_unit' | 'no_serving_size' };
export declare function extractMealPrefix(text: unknown): {
  meal: MealType | null;
  rest: string;
  invalidPrefix: boolean;
};
export declare function detectPrep(text: unknown): 'raw' | 'cooked' | null;

export type AiRawItem = { food?: unknown; quantity?: unknown; unit?: unknown; meal?: unknown };
export declare function normalizeAiItems(raw: unknown): {
  items: Array<{ food: string; quantity: number | null; unit: string }>;
};

/** Rule-based extractor (no AI needed). Same item shape as normalizeAiItems. */
export declare function localExtract(text: unknown): {
  items: Array<{ food: string; quantity: number | null; unit: string }>;
};

export type FoodCandidate = {
  id: number;
  name: string;
  serving_grams: number;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
};

export type MatchDecision =
  | { status: 'ok'; food: FoodCandidate }
  | { status: 'ambiguous'; options: FoodCandidate[] }
  | { status: 'prep'; rawFood: FoodCandidate; cookedFood: FoodCandidate }
  | { status: 'none' };

export declare function decideFoodMatch(candidates: FoodCandidate[], prepHint: 'raw' | 'cooked' | null): MatchDecision;

export type Macros = { calories: number; protein: number; carbs: number; fat: number };
export declare function scaleMacros(per100: Omit<FoodCandidate, 'id' | 'name' | 'serving_grams'>, grams: number): Macros;
export declare function sumNutrition(entries: Array<Partial<Macros>>): Macros;

export type ResolvedItem = { name: string; amountLabel: string; macros: Macros };
export declare function formatMealAnalysis(resolvedItems: ResolvedItem[], mealLabel?: string): string;
export declare function formatToday(
  today: {
    consumed: Macros;
    net_calories: number;
    burned_steps?: number;
    steps?: number;
  },
  targets: Partial<{ calorie_target: number; protein_target: number; carb_target: number; fat_target: number }>
): string;
export declare function formatSaved(mealLabel: string | undefined, savedItems: ResolvedItem[], totals: Macros): string;