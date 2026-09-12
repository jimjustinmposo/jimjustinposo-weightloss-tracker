import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createSession, destroySession, hashPassword, requireAuth, setSessionCookie, verifyPassword } from '../auth';
import type { AppVars, Env } from '../types';

type UserRow = { id: number; email: string; name: string | null; is_admin?: number };
type ProfileRow = Record<string, unknown>;

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

const ADMIN_EMAIL = 'jimjustinmposo@gmail.com';
const CONTACT_ERROR =
  'Incorrect security password. Contact Jim Justin Poso on WhatsApp: 0501905318 or DM him on Facebook.';

async function mePayload(c: { env: Env; get: (k: 'userId') => number }) {
  const userId = c.get('userId');
  const user = await c.env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?1').bind(userId).first<UserRow>();
  const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(userId).first<ProfileRow>();
  return { user: user ? { ...user, is_admin: user.email.toLowerCase() === ADMIN_EMAIL ? 1 : 0 } : user, profile };
}

app.post('/register', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const securityPassword = String(body.security_password ?? body.securityPassword ?? '');
  const name = String(body.name ?? '').trim().slice(0, 60) || null;

  const adminRow = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE email = ?1')
    .bind(ADMIN_EMAIL)
    .first<{ id: number; password_hash: string }>();

  // Admin signup itself is not gated; every other signup must present the admin's current password.
  if (email !== ADMIN_EMAIL) {
    if (!securityPassword || !adminRow || !(await verifyPassword(securityPassword, adminRow.password_hash))) {
      throw new HTTPException(403, { message: CONTACT_ERROR });
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HTTPException(400, { message: 'Please enter a valid email address.' });
  }
  if (password.length < 6) {
    throw new HTTPException(400, { message: 'Password must be at least 6 characters.' });
  }

  const passwordHash = await hashPassword(password);
  let result: D1Result;
  try {
    result = await c.env.DB.prepare('INSERT INTO users (email, password_hash, name) VALUES (?1, ?2, ?3)')
      .bind(email, passwordHash, name)
      .run();
  } catch (err) {
    if (String((err as Error)?.message).toUpperCase().includes('UNIQUE')) {
      throw new HTTPException(409, { message: 'An account with this email already exists.' });
    }
    throw err;
  }

  const userId = result.meta.last_row_id as number;
  const token = await createSession(c.env.DB, userId);
  setSessionCookie(c, token);
  const user = await c.env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?1').bind(userId).first<UserRow>();
  return c.json({ user: user ? { ...user, is_admin: user.email.toLowerCase() === ADMIN_EMAIL ? 1 : 0 } : user, profile: null }, 201);
});

app.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const user = await c.env.DB.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?1')
    .bind(email)
    .first<UserRow & { password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HTTPException(401, { message: 'Invalid email or password.' });
  }

  const token = await createSession(c.env.DB, user.id);
  setSessionCookie(c, token);
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.email.toLowerCase() === ADMIN_EMAIL ? 1 : 0 },
    profile: await c.env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?1').bind(user.id).first<ProfileRow>(),
  });
});

app.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get('/me', requireAuth, async (c) => c.json(await mePayload(c)));

export default app;
