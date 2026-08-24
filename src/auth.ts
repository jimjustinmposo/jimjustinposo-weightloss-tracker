import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { Ctx, Env, AppVars } from './types';

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** PBKDF2-SHA256 password hashing (WebCrypto native). */
export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: s as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2:100000:${toHex(s)}:${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iters, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'pbkdf2' || !saltHex || !hashHex) return false;
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(saltHex) as BufferSource, iterations: Number(iters) || 100000, hash: 'SHA-256' },
      key,
      256
    );
    const calc = toHex(bits);
    if (calc.length !== hashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hashHex.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(digest);
}

const SESSION_COOKIE = 'wls_session';
const SESSION_DAYS = 30;

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(tokenBytes);
  const tokenHash = await sha256Hex(token);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id = ?1 AND expires_at < datetime('now')").bind(userId),
    db
      .prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?1, ?2, datetime('now', '+30 days'))")
      .bind(userId, tokenHash),
  ]);
  return token;
}

export function setSessionCookie(c: Ctx, token: string): void {
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
    secure,
  });
}

export async function destroySession(c: Ctx): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

type SessionRow = { user_id: number; email: string };

/** Guard: resolves the session cookie (or Bearer token) into userId. */
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AppVars }>(async (c, next) => {
  const bearer = (c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '');
  const token = getCookie(c, SESSION_COOKIE) || bearer;
  if (!token) throw new HTTPException(401, { message: 'Authentication required' });

  const row = await c.env.DB.prepare(
    "SELECT u.id AS user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id " +
      "WHERE s.token_hash = ?1 AND s.expires_at > datetime('now')"
  )
    .bind(await sha256Hex(token))
    .first<SessionRow>();

  if (!row) throw new HTTPException(401, { message: 'Session invalid or expired' });
  c.set('userId', row.user_id);
  c.set('userEmail', row.email);
  await next();
});
