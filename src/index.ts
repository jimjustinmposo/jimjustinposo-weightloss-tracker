import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from './auth';
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import foodsRoutes from './routes/foods';
import logsRoutes from './routes/logs';
import stepsRoutes from './routes/steps';
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

app.get('/api/health', (c) => c.json({ ok: true, service: 'weightloss-tracker' }));

// Session guard for everything under /api except the public endpoints below.
const PUBLIC_PATHS = new Set(['/api/health', '/api/auth/register', '/api/auth/login', '/api/telegram/webhook']);
app.use('/api/*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  return requireAuth(c, next);
});

app.route('/api/auth', authRoutes);
app.route('/api/profile', profileRoutes);
app.route('/api/foods', foodsRoutes);
app.route('/api/logs', logsRoutes);
app.route('/api/steps', stepsRoutes);
app.route('/api/weights', weightsRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/telegram', telegramRoutes);

// Unknown /api routes → JSON 404; anything else → SPA shell via static assets.
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
