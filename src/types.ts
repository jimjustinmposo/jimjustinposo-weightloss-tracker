import type { Context } from 'hono';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
};

export type AppVars = {
  userId: number;
  userEmail: string;
};

export type Ctx = Context<{ Bindings: Env; Variables: AppVars }>;

export type Gender = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'athlete';
export type GoalType = 'lose' | 'maintain' | 'gain';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const GENDERS: Gender[] = ['male', 'female', 'other'];
export const ACTIVITY_LEVELS: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'athlete'];
export const GOAL_TYPES: GoalType[] = ['lose', 'maintain', 'gain'];
export const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function num(v: unknown, fallback = NaN): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

export function isDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
