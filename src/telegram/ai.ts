import type { Env } from '../types';

/**
 * Minimal OpenAI-compatible chat-completions client (works with LM Studio,
 * Ollama's OpenAI shim, OpenAI, etc.). The AI is ONLY used to extract
 * structured {food, quantity, unit} items from natural language — nutrition
 * values always come from the user's existing food catalog.
 */

export type AiItem = {
  food: string;
  quantity: number | null;
  unit: string;
};

export class AiUnavailableError extends Error {}

const SYSTEM_PROMPT = `You extract food items from what a user ate and reply with ONLY a JSON array, no prose, no markdown fences.
Each element: {"food": string, "quantity": number|null, "unit": string}
- "food": short catalog-style name, e.g. "chicken breast", "egg", "salted butter".
- "quantity": number of the unit (grams count, piece count...). null only if the user gave no amount at all.
- "unit": one of "g", "kg", "oz", "lb", "ml", "piece", "serving" (default "g" when a mass amount has no unit; "piece" for whole items like eggs).
Also detect an optional leading meal name in the text ("breakfast:", "for lunch", ...). If found add it to EVERY element as "meal": one of "breakfast"|"lunch"|"dinner"|"snack", otherwise "meal": null.
Examples:
"Had 300g chicken breast and 4 eggs" →
[{"food":"chicken breast","quantity":300,"unit":"g","meal":null},{"food":"egg","quantity":4,"unit":"piece","meal":null}]
"ate some chicken" → [{"food":"chicken","quantity":null,"unit":"g","meal":null}]`;

function stripFences(s: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(s);
  return (m ? m[1] : s).trim();
}

/** Call the configured AI provider. Throws AiUnavailableError if not configured/unreachable/bad output. */
export async function extractFoods(env: Env, userText: string): Promise<{ items: AiItem[]; meal: string | null }> {
  const base = (env.AI_BASE_URL || '').replace(/\/+$/, '');
  if (!base || !env.AI_MODEL) throw new AiUnavailableError('AI is not configured.');

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.AI_API_KEY ? { Authorization: `Bearer ${env.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new AiUnavailableError(`AI request failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new AiUnavailableError(`AI returned HTTP ${res.status}`);

  let content = '';
  try {
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    content = String(data?.choices?.[0]?.message?.content ?? '');
  } catch {
    throw new AiUnavailableError('AI returned an unreadable response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    // Some models wrap the array in prose — try to find the first [...] block.
    const m = /\[[\s\S]*\]/.exec(content);
    if (!m) throw new AiUnavailableError('AI did not return JSON.');
    parsed = JSON.parse(m[0]);
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : ((parsed as Record<string, unknown>)?.items ?? null);
  if (!Array.isArray(arr)) throw new AiUnavailableError('AI did not return an item array.');

  const items: AiItem[] = [];
  let meal: string | null = null;
  const MEALS_OK = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
  for (const it of arr.slice(0, 10)) {
    if (!it || typeof it !== 'object') continue;
    const o = it as Record<string, unknown>;
    const food = typeof o.food === 'string' ? o.food.trim() : '';
    if (!food) continue;
    const qty = Number(o.quantity);
    items.push({
      food: food.slice(0, 120),
      quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
      unit: typeof o.unit === 'string' ? o.unit.toLowerCase() : '',
    });
    const m = typeof o.meal === 'string' ? o.meal.toLowerCase() : '';
    if (!meal && MEALS_OK.has(m)) meal = m;
  }
  if (!items.length) throw new AiUnavailableError('AI could not find any food items.');
  return { items, meal };
}