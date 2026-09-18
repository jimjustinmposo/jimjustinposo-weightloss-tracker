import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from './auth';
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import foodsRoutes from './routes/foods';
import nutritionRoutes from './routes/nutrition';
import logsRoutes from './routes/logs';
import stepsRoutes from './routes/steps';
import pushupsRoutes from './routes/pushups';
import notesRoutes from './routes/notes';
import weightsRoutes from './routes/weights';
import dashboardRoutes from './routes/dashboard';
import telegramRoutes from './routes/telegram';
import type { AppVars, Env } from './types';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

/* ------------------------------------------------------------------ */
/* Security headers — ONE definition, applied to:                       */
/*   • every Worker response (middleware below), and                     */
/*   • the SPA shell served through the ASSETS fallback (notFound),       */
/*     which is built outside the middleware chain.                      */
/* `public/_headers` mirrors these exact values because Cloudflare's      */
/* asset server can answer static files without running the Worker —      */
/* keep the two in sync when changing this map.                          */
/* CSP notes: no inline scripts anywhere, all modules are same-origin;    */
/* `img-src data: blob:` covers note/food photos.                        */
/* ------------------------------------------------------------------ */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: blob:; manifest-src 'self'; " +
    "media-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

/** Returns a copy of `res` carrying the security headers. */
function withSecurityHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

app.use('*', async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.header(name, value);
});

/* API payloads are per-user: never let a browser or proxy store them. */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

/* CSRF hardening for cookie-authenticated writes: browsers attach an Origin
   header to every non-GET request, so a mismatching origin is rejected.
   Header-less clients (curl, Telegram webhook, tests) are unaffected. */
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = c.req.header('Origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      host = '';
    }
    if (host !== new URL(c.req.url).host) {
      throw new HTTPException(403, { message: 'Cross-site request blocked.' });
    }
  }
  return next();
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'weightloss-tracker' }));

// Session guard for everything under /api except the public endpoints below.
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/register', '/api/auth/login', '/api/auth/verify-admin', '/api/telegram/webhook']);
app.use('/api/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  return requireAuth(c, next);
});

app.route('/api/auth', authRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/foods', foodsRoutes);
app.route('/api/nutrition', nutritionRoutes);
app.route('/api/logs', logsRoutes);
app.route('/api/steps', stepsRoutes);
app.route('/api/pushups', pushupsRoutes);
app.route('/api/notes', notesRoutes);
app.route('/api/weights', weightsRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/telegram', telegramRoutes);

// Unknown /api routes → JSON 404; anything else → SPA shell via static assets.
app.notFound(async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  // This response exists outside the middleware chain, so the security
  // headers are attached here explicitly.
  return withSecurityHeaders(await c.env.ASSETS.fetch(c.req.raw));
});

export default app;
