import type { Env } from './types';

/**
 * Workers AI model used via the native binding (set "ai": { "binding": "AI" } in
 * wrangler.jsonc). Llama 4 Scout is natively multimodal — it powers photo
 * identification AND text extraction. Runs inside Cloudflare — no external API
 * key, no geographic restrictions.
 */
export const WORKERS_AI_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

/** Minimal shape of the Workers AI binding we rely on. */
export type WorkersAiBinding = {
  run: (model: string, input: unknown) => Promise<unknown>;
};

/** Returns the Workers AI binding when configured, else null. */
export function workersAi(env: Env): WorkersAiBinding | null {
  return env.AI ? (env.AI as unknown as WorkersAiBinding) : null;
}

/**
 * Extracts the assistant's text from the various shapes a Workers AI run() can
 * return: { response: string }, { response: { content } }, the OpenAI-style
 * { choices: [{ message: { content } }] } envelope, or the raw string itself.
 */
export function extractTextFromAiResult(out: unknown): string {
  if (out == null) return '';
  if (typeof out === 'string') return out;
  const o = out as Record<string, unknown>;
  if (typeof o.response === 'string') return o.response;
  if (o.response && typeof o.response === 'object') {
    const r = o.response as Record<string, unknown>;
    if (typeof r.content === 'string') return r.content;
    if (r.choices != null) return fromChoices(r.choices);
    return JSON.stringify(r);
  }
  if (o.choices != null) return fromChoices(o.choices);
  return JSON.stringify(o);
}

function fromChoices(choices: unknown): string {
  const arr = choices as Array<{ message?: { content?: unknown } }>;
  const c = arr?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (c != null) return JSON.stringify(c);
  return '';
}