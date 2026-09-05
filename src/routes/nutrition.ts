import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';
import { num } from '../types';
import { AiUnavailableError } from '../telegram/ai';
import { maxOfRange, round2 } from '../telegram/textparse';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

/**
 * POST /api/nutrition/estimate  { name, grams }
 * Estimates macros for a food + amount using the configured AI model
 * (OpenAI-compatible). When the model reports a value as a range, the MAXIMUM
 * is always used (e.g. protein 10–13 g → 13 g). Encrypted/secret keys never
 * leave the backend — the browser just receives the numeric estimate.
 */
app.post('/estimate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? '').trim().slice(0, 120);
  const grams = num(body.grams, NaN);
  if (!name) throw new HTTPException(400, { message: 'Food name is required.' });
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
    throw new HTTPException(400, { message: 'Amount must be between 0 and 5,000 grams.' });
  }

  const base = (c.env.AI_BASE_URL || '').replace(/\/+$/, '');
  if (!base || !c.env.AI_MODEL) {
    throw new HTTPException(503, {
      message: 'Online nutrition lookup is not configured — add AI_BASE_URL and AI_MODEL (see .dev.vars).',
    });
  }

  const SYSTEM_PROMPT = `You are a nutrition database. Given a food and an amount in grams, return ONLY a JSON object with this exact shape (no prose, no markdown fences):
{"name":"food name","calories":0,"protein":0,"carbs":0,"fat":0}
Rules:
- Estimate the nutrition for EXACTLY the given grams of that food.
- If the true value is commonly reported as a range (e.g. protein 10-13g per 100g), ALWAYS return the MAXIMUM value (13).
- Values must be numbers (no units, no ranges, no strings).
- Use typical values (e.g. from USDA). For "100g chicken barbeque", return the macros of 100g of that dish.`;

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(c.env.AI_API_KEY ? { Authorization: `Bearer ${c.env.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: c.env.AI_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${name} — ${grams} g` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new HTTPException(502, { message: `Online nutrition lookup failed: ${(e as Error).message}` });
  }
  if (!res.ok) throw new HTTPException(502, { message: `Online nutrition lookup returned HTTP ${res.status}` });

  let content = '';
  try {
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    content = String(data?.choices?.[0]?.message?.content ?? '');
  } catch {
    throw new HTTPException(502, { message: 'Online nutrition lookup returned an unreadable response.' });
  }

  let parsed: unknown;
  const stripped = content.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const m = /\{[\s\S]*\}/.exec(stripped);
    if (!m) throw new HTTPException(502, { message: 'Online nutrition lookup did not return JSON.' });
    try { parsed = JSON.parse(m[0]); } catch { throw new HTTPException(502, { message: 'Online nutrition lookup did not return JSON.' }); }
  }

  const o = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const pick = (key: string, fallback = 0) => {
    const n = maxOfRange(o[key]);
    return Number.isFinite(n) && n >= 0 ? round2(n) : fallback;
  };

  return c.json({
    estimate: {
      name: String(o.name ?? name).slice(0, 120),
      grams,
      calories: pick('calories'),
      protein: pick('protein'),
      carbs: pick('carbs'),
      fat: pick('fat'),
    },
  });
});

export default app;