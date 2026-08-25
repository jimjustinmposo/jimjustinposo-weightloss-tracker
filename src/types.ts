import type { Context } from 'hono';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /* ---- Optional integrations (set via .dev.vars locally / `wrangler secret put` in prod) ---- */
  /** Bot token from @BotFather — never hard-code. */
  TELEGRAM_BOT_TOKEN?: string;
  /** Secret token Telegram echoes back in the X-Telegram-Bot-Api-Secret-Token header. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** OpenAI-compatible endpoint for local AI (e.g. http://127.0.0.1:1234/v1 for LM Studio). */
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  /** Hours offset from UTC used to compute "today" for Telegram commands (default 0). */
  TELEGRAM_TZ_OFFSET_HOURS?: string;
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
