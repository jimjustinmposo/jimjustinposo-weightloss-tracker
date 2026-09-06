/* ============================================================
   offline.js — Offline-first data layer for the WeightLoss Tracker.

   Responsibilities:
   • IndexedDB storage (per-user scoped rows + sync queue + meta).
   • Read endpoints from cache when offline / while changes are pending.
   • Apply local writes offline and enqueue them in the persistent sync queue.
   • Idempotent create/update/delete primitives used by the sync engine.
   • Connectivity tracking + the tiny status pill renderer.

   The UI keeps calling api.get/post/put/del — api.js routes through here.
   ============================================================ */
import * as math from './offline-math.js';

const DB_NAME = 'weightloss-tracker-od';
const DB_VERSION = 1;
const STORES = ['kv', 'users', 'profiles', 'foods', 'logs', 'weights', 'steps', 'ops'];

/* ---------------- in-memory state ---------------- */
let dbPromise = null;
let online = (typeof navigator !== 'undefined') ? navigator.onLine !== false : true;
let currentUserId = null;
let connectionListeners = [];
let dataChangedListeners = [];
const status = { online: true, syncing: false, pending: 0, lastSyncAt: 0 };

export function isOnline() { return online; }
export function isOffline() { return !online; }
export function getUser() { return currentUserId; }
export function getStatus() { return { ...status, online }; }

/* ---------------- raw network helper (shared with api.js / sync.js) ---------------- */
export async function raw(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** A network-style failure: no HTTP status attached (offline / DNS / timeout). */
export function isNetworkError(err) {
  return !err || typeof err.status !== 'number';
}
/* ---------------- IndexedDB plumbing ---------------- */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available in this browser.'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: 'k' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function storeGet(store, key) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).get(String(key)));
}
async function storeGetAll(store) {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).getAll());
}
async function storePut(store, rec) {
  const db = await openDb();
  const req = db.transaction(store, 'readwrite').objectStore(store).put(rec);
  await promisify(req);
  return req.result;
}
async function storeBulkPut(store, recs) {
  if (!recs.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function storeDelete(store, key) {
  const db = await openDb();
  await promisify(db.transaction(store, 'readwrite').objectStore(store).delete(String(key)));
}
async function deleteWhere(store, pred) {
  const all = await storeGetAll(store);
  const keys = all.filter(pred).map((r) => r.k);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    if (!keys.length) return resolve();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(String(k));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ---------------- kv (meta) helpers ---------------- */
async function kvGet(key) {
  const r = await storeGet('kv', key);
  return r ? r.v : undefined;
}
async function kvSet(key, value) {
  await storePut('kv', { k: key, v: value });
}
async function kvDel(key) {
  await storeDelete('kv', key);
}

/* ---------------- per-user row keys ---------------- */
const foodKey = (uid, id) => `f${uid}:${id}`;
const logKey = (uid, id) => `l${uid}:${id}`;
const weightKey = (uid, id) => `w${uid}:${id}`;
const stepKey = (uid, date) => `s${uid}|${date}`;

const isoNow = () => {
  const d = new Date();
  return d.toISOString().slice(0, 19).replace('T', ' '); // UTC — same format as SQLite datetime('now')
};

/* ---------------- local id generator (negative, globally unique) ---------------- */
async function nextLocalId() {
  const seq = Number((await kvGet('seq')) ?? 1000);
  await kvSet('seq', seq + 1);
  return -seq;
}

function newClientId() {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `cl-${rnd}`;
}
/* ---------------- session management ---------------- */
export async function setSession(uid) {
  currentUserId = Number(uid);
  await kvSet('currentUserId', currentUserId);
  await refreshPendingCount();
}
export async function clearSession() {
  currentUserId = null;
  status.pending = 0;
  try { await kvDel('currentUserId'); } catch { /* storage unavailable */ }
  renderStatus();
}
async function restoreSession() {
  currentUserId = Number((await kvGet('currentUserId')) ?? 0) || null;
  return currentUserId;
}
async function requireUser() {
  if (currentUserId == null) await restoreSession();
  if (currentUserId == null) throw new Error('Sign in once while online — no local session is available.');
  return currentUserId;
}

/** Store the freshly authenticated user (login/register) + remember the session. */
export async function onAuthenticated(user, profile) {
  if (!user?.id) return;
  try {
    await storePut('users', { k: user.id, id: user.id, email: user.email, name: user.name });
    if (profile) await storePut('profiles', profile);
    await setSession(user.id);
  } catch (e) {
    console.error('offline cache unavailable:', e); // app still works online-only
  }
}

/* ---------------- connectivity ---------------- */
export function markOnline() {
  if (online) return;
  online = true;
  renderStatus();
  connectionListeners.forEach((fn) => { try { fn(true); } catch (e) { console.error(e); } });
}
export function markOffline() {
  if (!online) return;
  online = false;
  renderStatus();
  connectionListeners.forEach((fn) => { try { fn(false); } catch (e) { console.error(e); } });
}
export function addConnectionListener(fn) { connectionListeners.push(fn); }
export function addDataChangedListener(fn) { dataChangedListeners.push(fn); }
export function notifyDataChanged() {
  dataChangedListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}

export async function init() {
  try {
    await openDb();
    online = (typeof navigator !== 'undefined') ? navigator.onLine !== false : true;
    await restoreSession();
    await refreshPendingCount();
  } catch (e) {
    // IndexedDB unavailable (e.g. some private modes) → the app keeps working
    // exactly as before (online-only); only the offline layer is disabled.
    console.error('offline layer unavailable:', e);
  }
  renderStatus();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => markOnline());
    window.addEventListener('offline', () => markOffline());
  }
}

/* ---------------- sync queue (ops) ---------------- */
function opId() {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
async function enqueueOp(uid, op) {
  const rec = {
    id: opId(),
    k: opId(),
    user_id: uid,
    seq: Date.now(),
    retries: 0,
    status: 'pending',
    last_error: null,
    ...op,
  };
  await storePut('ops', rec);
  await refreshPendingCount();
  return rec;
}
export async function listPendingOps(uid) {
  const all = await storeGetAll('ops');
  return all
    .filter((o) => o.user_id === uid && o.status === 'pending')
    .sort((a, b) => (a.seq - b.seq) || (a.id < b.id ? -1 : 1));
}
export async function countPending(uid) {
  if (uid == null) return 0;
  return (await listPendingOps(uid)).length;
}
export async function hasPending(uid) {
  return (await countPending(uid)) > 0;
}
async function updateOp(id, patch) {
  const all = await storeGetAll('ops');
  const rec = all.find((o) => o.id === id);
  if (!rec) return;
  Object.assign(rec, patch);
  await storePut('ops', rec);
}
export async function removeOp(id) {
  await storeDelete('ops', id);
  await refreshPendingCount();
}
export async function markOpResult(id, patch) {
  await updateOp(id, patch);
  await refreshPendingCount();
}
async function findPendingOpFor(uid, pred) {
  return (await listPendingOps(uid)).find(pred) || null;
}

export async function refreshPendingCount() {
  const uid = currentUserId ?? (await requireUserSafe());
  status.pending = uid ? await countPending(uid) : 0;
  renderStatus();
  return status.pending;
}
async function requireUserSafe() {
  try { return await requireUser(); } catch { return null; }
}
/* ---------------- row queries & normalization ---------------- */
function stripRow(r) {
  if (!r || typeof r !== 'object') return r;
  const { k, offline_local, ...rest } = r;
  return rest;
}
const foodsForUser = async (uid) => (await storeGetAll('foods')).filter((r) => r.user_id === uid);
const logsForUser = async (uid) => (await storeGetAll('logs')).filter((r) => r.user_id === uid);
const weightsForUser = async (uid) => (await storeGetAll('weights')).filter((r) => r.user_id === uid);
const stepsForUser = async (uid) => (await storeGetAll('steps')).filter((r) => r.user_id === uid);

const findFoodById = async (uid, id) => {
  const rec = await storeGet('foods', foodKey(uid, id));
  return rec && rec.user_id === uid ? rec : null;
};
const findLogById = async (uid, id) => {
  const rec = await storeGet('logs', logKey(uid, id));
  return rec && rec.user_id === uid ? rec : null;
};
const findWeightById = async (uid, id) => {
  const rec = await storeGet('weights', weightKey(uid, id));
  return rec && rec.user_id === uid ? rec : null;
};
const findWeightByDate = async (uid, date) =>
  (await weightsForUser(uid)).find((w) => String(w.log_date) === String(date)) || null;
const findFoodByName = async (uid, name) => {
  const n = String(name || '').toLowerCase();
  return (await foodsForUser(uid)).find((f) => String(f.name).toLowerCase() === n) || null;
};
const findLogByClientId = async (uid, clientId) =>
  (await logsForUser(uid)).find((l) => l.client_id === clientId) || null;

function normFood(r, uid) {
  const rec = { ...r, user_id: r.user_id ?? uid };
  rec.k = foodKey(uid, Number(rec.id));
  return rec;
}
function normLog(r, uid) {
  const rec = { ...r, user_id: r.user_id ?? uid };
  rec.k = logKey(uid, Number(rec.id));
  return rec;
}
function normWeight(r, uid) {
  const rec = { ...r, user_id: r.user_id ?? uid };
  rec.k = weightKey(uid, Number(rec.id));
  return rec;
}
function normStep(r, uid) {
  const rec = { ...r, user_id: r.user_id ?? uid };
  rec.k = stepKey(uid, String(rec.log_date));
  return rec;
}

async function replaceUserRows(store, uid, rows) {
  if (store === 'users' || store === 'profiles') {
    const key = rows[0]?.[store === 'users' ? 'id' : 'user_id'];
    if (key != null) await storeDelete(store, key);
  } else {
    await deleteWhere(store, (r) => String(r.k).startsWith(uidPrefixFor(store, uid)));
  }
  await storeBulkPut(store, rows);
}

async function replaceLogsForDate(uid, date, rows) {
  const existing = (await logsForUser(uid)).filter((l) => String(l.log_date) === String(date));
  const keys = existing.map((l) => l.k);
  const db = await openDb();
  await new Promise((resolve, reject) => {
    if (!keys.length) return resolve();
    const tx = db.transaction('logs', 'readwrite');
    const os = tx.objectStore('logs');
    for (const k of keys) os.delete(String(k));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await storeBulkPut('logs', rows);
}

async function upsertSteps(uid, rows) {
  const recs = [];
  for (const r of rows || []) {
    const rec = normStep(r, uid);
    rec.user_id = uid;
    rec.k = stepKey(uid, String(rec.log_date));
    recs.push(rec);
  }
  await storeBulkPut('steps', recs);
}
/* ---------------- cache reads (offline serving) ---------------- */
function parseUrl(path) {
  const [p, qs = ''] = path.split('?');
  return { path: p, params: new URLSearchParams(qs) };
}

export async function cacheGet(path) {
  const { path: p, params } = parseUrl(path);
  const uid = await requireUser();

  switch (p) {
    case '/api/auth/me': {
      const user = await storeGet('users', uid);
      const profile = await storeGet('profiles', uid);
      if (!user) throw new Error('No offline session — sign in once while online.');
      return { user: stripRow(user), profile: profile ? stripRow(profile) : null };
    }
    case '/api/profile': {
      const profile = await storeGet('profiles', uid);
      return {
        profile: profile ? stripRow(profile) : null,
        complete: !!(profile && profile.age != null && profile.height_cm != null && profile.current_weight != null),
      };
    }
    case '/api/dashboard': {
      const date = params.get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid dashboard date.');
      const profile = await storeGet('profiles', uid);
      const logs = await logsForUser(uid);
      const dayLogs = logs.filter((l) => String(l.log_date) === date);
      const rangeStart = math.shiftDate(date, -6);
      const windowLogs = logs.filter((l) => l.log_date >= rangeStart && l.log_date <= date);
      const steps = await stepsForUser(uid);
      const allWeights = math.sortDescByDate(await weightsForUser(uid));
      const weights = allWeights.slice(0, 90); // server dashboard uses the last 90 entries
      return math.computeDashboard({
        date,
        profile: profile ? stripRow(profile) : null,
        logs: dayLogs.map(stripRow),
        windowLogs: windowLogs.map(stripRow),
        steps: steps.map(stripRow),
        weights: weights.map(stripRow),
      });
    }
    case '/api/weights': {
      const limit = Math.min(Math.max(Math.round(Number(params.get('limit')) || 90), 1), 365);
      const rows = math.sortDescByDate(await weightsForUser(uid)).slice(0, limit).map(stripRow);
      return { entries: rows };
    }
    case '/api/logs/recent': {
      const limit = Math.min(Math.max(Number(params.get('limit')) || 500, 1), 1000);
      const rows = math.sortDescByDate(await logsForUser(uid), 'id').slice(0, limit).map(stripRow);
      return { entries: rows };
    }
    case '/api/logs': {
      const date = params.get('date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
      const entries = (await logsForUser(uid))
        .filter((l) => String(l.log_date) === date)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || Number(a.id) - Number(b.id))
        .map(stripRow);
      return { date, entries, totals: math.dayTotals(entries) };
    }
    case '/api/foods': {
      const q = (params.get('q') || '').trim();
      let rows = (await foodsForUser(uid)).filter((f) => math.nameMatch(f, q));
      if (q) {
        rows = rows.sort((a, b) => String(a.name).localeCompare(String(b.name))).slice(0, 50);
      } else {
        rows = rows
          .sort((a, b) => String(b.updated_at || b.id || '').localeCompare(String(a.updated_at || a.id || '')) || String(a.name).localeCompare(String(b.name)))
          .slice(0, 200);
      }
      return { foods: rows.map(stripRow) };
    }
    case '/api/steps/entries': {
      const limit = Math.min(Math.max(Math.round(Number(params.get('limit')) || 90), 1), 365);
      const rows = math.sortDescByDate(await stepsForUser(uid)).slice(0, limit).map(stripRow);
      return { entries: rows };
    }
    case '/api/steps': {
      const from = params.get('from');
      const to = params.get('to');
      let fromDate, toDate;
      if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
        fromDate = from; toDate = to;
      } else {
        const days = Math.min(Math.max(Math.round(Number(params.get('days')) || 7), 1), 90);
        toDate = math.toDateStr(new Date());
        fromDate = math.shiftDate(toDate, -(days - 1));
      }
      const byDate = new Map((await stepsForUser(uid)).map((s) => [String(s.log_date), s]));
      const series = [];
      for (let d = fromDate; d <= toDate; d = math.shiftDate(d, 1)) {
        const r = byDate.get(d);
        series.push({ log_date: d, steps: r ? Number(r.steps || 0) : 0, calories_burned: r ? Number(r.calories_burned || 0) : 0 });
      }
      return { series };
    }
    default:
      if (p.startsWith('/api/')) {
        throw new Error(`This view is not available offline (${p}).`);
      }
      throw new Error('Not available offline.');
  }
}
/* ---------------- cache write-through (online traffic feeds the local cache) ---------------- */
export async function cachePutFromGet(path, data) {
  if (!data) return;
  const { path: p, params } = parseUrl(path);
  const uid = currentUserId ?? (await restoreSessionSafe());
  if (uid == null) return;

  switch (p) {
    case '/api/auth/me': {
      if (!data.user) break;
      if (Number(data.user.id) !== Number(uid)) break; // never mix another account's session
      await storePut('users', { k: data.user.id, id: data.user.id, email: data.user.email, name: data.user.name });
      if (data.profile) await storePut('profiles', { ...data.profile, k: data.user.id, user_id: data.user.id });
      await setSession(data.user.id);
      break;
    }
    case '/api/profile':
      if (data.profile) await storePut('profiles', { ...data.profile, k: data.profile.user_id ?? uid, user_id: data.profile.user_id ?? uid });
      break;
    case '/api/weights':
      await replaceUserRows('weights', uid, (data.entries || []).map((r) => normWeight(r, uid)));
      break;
    case '/api/logs/recent':
      await replaceUserRows('logs', uid, (data.entries || []).map((r) => normLog(r, uid)));
      break;
    case '/api/logs':
      await replaceLogsForDate(uid, params.get('date'), (data.entries || []).map((r) => normLog(r, uid)));
      break;
    case '/api/foods':
      await replaceUserRows('foods', uid, (data.foods || []).map((r) => normFood(r, uid)));
      break;
    case '/api/steps/entries':
      await replaceUserRows('steps', uid, (data.entries || []).map((r) => normStep(r, uid)));
      break;
    case '/api/steps':
      await upsertSteps(uid, (data.series || []).filter((s) => Number(s.steps) > 0 || Number(s.calories_burned) > 0));
      break;
    case '/api/dashboard': {
      if (data.profile) await storePut('profiles', { ...data.profile, k: data.profile.user_id ?? uid, user_id: data.profile.user_id ?? uid });
      const date = data.date;
      if (date && data.meals) {
        const dayRows = [];
        for (const meal of Object.keys(data.meals)) {
          for (const e of data.meals[meal] || []) dayRows.push(normLog(e, uid));
        }
        await replaceLogsForDate(uid, date, dayRows);
      }
      await upsertSteps(uid, (data.steps_series || []).filter((s) => Number(s.steps) > 0 || Number(s.calories_burned) > 0));
      if (data.weight_series) await storeBulkPut('weights', data.weight_series.filter((w) => w.log_date != null).map((r) => normWeight(r, uid)));
      break;
    }
  }
}

/** Mirror a confirmed ONLINE write into the local cache (no sync op enqueued). */
export async function applyServerWrite(method, path, body, data) {
  const uid = currentUserId ?? (await restoreSessionSafe());
  if (uid == null || !data) return;

  try {
    if (method === 'POST') {
      if (path === '/api/weights' && data.entry) {
        // Drop any local mirror for the same date that isn't this server row.
        await deleteWhere('weights', (r) => r.user_id === uid
          && String(r.log_date) === String(data.entry.log_date)
          && Number(r.id) !== Number(data.entry.id));
        await storeBulkPut('weights', [normWeight(data.entry, uid)]);
        if (data.profile) await storePut('profiles', { ...data.profile, k: data.profile.user_id ?? uid });
      } else if (path === '/api/steps' && data.log) {
        await upsertSteps(uid, [data.log]);
      } else if (path === '/api/foods' && data.food) {
        await deleteWhere('foods', (r) => r.user_id === uid
          && String(r.name).toLowerCase() === String(data.food.name).toLowerCase()
          && Number(r.id) !== Number(data.food.id));
        await storeBulkPut('foods', [normFood(data.food, uid)]);
      } else if (path === '/api/logs' && data.entry) {
        await storeBulkPut('logs', [normLog(data.entry, uid)]);
      }
    } else if (method === 'PUT') {
      if (/^\/api\/logs\/\d+/.test(path) && data.entry) {
        await storeBulkPut('logs', [normLog(data.entry, uid)]);
      } else if (/^\/api\/foods\/\d+/.test(path) && data.food) {
        await storeBulkPut('foods', [normFood(data.food, uid)]);
      } else if (/^\/api\/profile/.test(path) && data.profile) {
        await storePut('profiles', { ...data.profile, k: data.profile.user_id ?? uid });
      }
    } else if (method === 'DELETE') {
      if (/^\/api\/weights\/\d+/.test(path)) {
        const id = Number(path.split('/').pop());
        const rec = await findWeightById(uid, id);
        if (rec) await storeDelete('weights', rec.k);
      } else if (/^\/api\/logs\/\d+/.test(path)) {
        const id = Number(path.split('/').pop());
        const rec = await findLogById(uid, id);
        if (rec) await storeDelete('logs', rec.k);
      } else if (/^\/api\/foods\/\d+/.test(path)) {
        const id = Number(path.split('/').pop());
        const rec = await findFoodById(uid, id);
        if (rec) await storeDelete('foods', rec.k);
      } else if (/^\/api\/steps\/\d{4}-\d{2}-\d{2}/.test(path)) {
        const date = decodeURIComponent(path.split('/').pop());
        await storeDelete('steps', stepKey(uid, date));
      }
    }
  } catch (e) {
    console.error('offline cache mirror failed:', e);
  }
}

async function restoreSessionSafe() {
  try { return await requireUser(); } catch { return null; }
}
/* ---------------- target recomputation (reuses the profile page's mirror of calc.ts) ---------------- */
async function recomputeProfileTargets(profile, weightKg) {
  const { preview } = await import('./profile.js');
  const t = preview({
    age: Number(profile.age),
    height: Number(profile.height_cm),
    weight: Number(weightKg),
    gender: profile.gender || 'other',
    activity: profile.activity_level || 'light',
    goal: profile.goal_type || 'maintain',
    weekly: Number(profile.weekly_goal_kg || 0),
    diet: profile.diet_type || 'normal',
  });
  return {
    ...profile,
    current_weight: Number(weightKg),
    bmr: t.bmr,
    tdee: t.tdee,
    bmi: t.bmi,
    bmi_category: math.bmiCategory(t.bmi),
    calorie_target: t.calTarget,
    protein_target: t.protein,
    carb_target: t.carbs,
    fat_target: t.fat,
    updated_at: isoNow(),
  };
}

/* ---------------- local writes → cache + sync queue ---------------- */

async function localWeightUpsert(uid, body) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date (YYYY-MM-DD) is required.');
  const weight = Number(body.weight);
  if (!Number.isFinite(weight) || weight < 25 || weight > 450) {
    throw new Error('Weight must be between 25 and 450 kg.');
  }
  let existing = await findWeightByDate(uid, date);
  let id;
  if (existing) {
    id = existing.id;
    existing.weight = weight;
    existing.log_date = date;
    existing.note = typeof body.note === 'string' ? body.note.slice(0, 200) : existing.note ?? null;
    existing.updated_at = isoNow();
    await storePut('weights', existing);
    const op = await findPendingOpFor(uid, (o) => o.entity === 'weight' && String(o.payload?.date) === String(date));
    if (op) await updateOp(op.id, { payload: { date, weight }, retries: 0, status: 'pending', last_error: null });
    else await enqueueOp(uid, { entity: 'weight', method: 'POST', url: '/api/weights', payload: { date, weight }, localId: id, serverId: id > 0 ? id : null, refDate: date });
  } else {
    id = await nextLocalId();
    existing = { k: weightKey(uid, id), id, user_id: uid, log_date: date, weight, note: typeof body.note === 'string' ? body.note.slice(0, 200) : null, created_at: isoNow() };
    await storePut('weights', existing);
    await enqueueOp(uid, { entity: 'weight', method: 'POST', url: '/api/weights', payload: { date, weight }, localId: id, serverId: null, refDate: date });
  }
  const profile = await storeGet('profiles', uid);
  if (profile && profile.age != null && profile.height_cm != null) {
    await storePut('profiles', await recomputeProfileTargets(profile, weight));
  }
  await refreshPendingCount();
  return { entry: stripRow(existing), profile: profile ? stripRow(await storeGet('profiles', uid)) : null };
}

async function localStepUpsert(uid, body) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date (YYYY-MM-DD) is required.');
  const steps = Math.round(Number(body.steps));
  if (!Number.isFinite(steps) || steps < 0 || steps > 200000) {
    throw new Error('Steps must be between 0 and 200,000.');
  }
  const profile = await storeGet('profiles', uid);
  const burned = math.burnedFromSteps(steps, profile?.current_weight, profile?.height_cm);
  const existing = await storeGet('steps', stepKey(uid, date));
  let rec;
  if (existing) {
    rec = { ...existing, steps, calories_burned: burned, updated_at: isoNow() };
    await storePut('steps', rec);
    const op = await findPendingOpFor(uid, (o) => o.entity === 'step' && String(o.payload?.date) === String(date));
    if (op) await updateOp(op.id, { payload: { date, steps }, retries: 0, status: 'pending', last_error: null });
    else await enqueueOp(uid, { entity: 'step', method: 'POST', url: '/api/steps', payload: { date, steps }, refDate: date });
  } else {
    rec = { k: stepKey(uid, date), user_id: uid, log_date: date, steps, calories_burned: burned, updated_at: isoNow() };
    await storePut('steps', rec);
    await enqueueOp(uid, { entity: 'step', method: 'POST', url: '/api/steps', payload: { date, steps }, refDate: date });
  }
  await refreshPendingCount();
  return { log: stripRow(rec) };
}

async function localFoodUpsert(uid, body) {
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Food name is required.');
  const serving = Number(body.serving_grams);
  if (!Number.isFinite(serving) || serving <= 0 || serving > 5000) {
    throw new Error('Serving size must be between 0 and 5,000 grams.');
  }
  const payload = {
    name,
    serving_grams: serving,
    calories: Number(body.calories ?? 0),
    protein: Number(body.protein ?? 0),
    carbs: Number(body.carbs ?? 0),
    fat: Number(body.fat ?? 0),
  };
  let rec, id, existing;
  existing = await findFoodByName(uid, name);
  if (existing) {
    id = existing.id;
    rec = {
      ...existing,
      name,
      serving_grams: serving,
      calories_per_100g: math.toPer100(payload.calories, serving),
      protein_per_100g: math.toPer100(payload.protein, serving),
      carbs_per_100g: math.toPer100(payload.carbs, serving),
      fat_per_100g: math.toPer100(payload.fat, serving),
      updated_at: isoNow(),
    };
    await storePut('foods', rec);
    const op = await findPendingOpFor(uid, (o) => o.entity === 'food' && (o.localId === id || (o.payload && String(o.payload.name).toLowerCase() === name.toLowerCase())));
    if (op) await updateOp(op.id, { payload, retries: 0, status: 'pending', last_error: null });
    else await enqueueOp(uid, { entity: 'food', method: 'POST', url: '/api/foods', payload, localId: id, serverId: id > 0 ? id : null, refName: name });
  } else {
    id = await nextLocalId();
    rec = {
      k: foodKey(uid, id),
      id,
      user_id: uid,
      name,
      serving_grams: serving,
      calories_per_100g: math.toPer100(payload.calories, serving),
      protein_per_100g: math.toPer100(payload.protein, serving),
      carbs_per_100g: math.toPer100(payload.carbs, serving),
      fat_per_100g: math.toPer100(payload.fat, serving),
      created_at: isoNow(),
      updated_at: isoNow(),
    };
    await storePut('foods', rec);
    await enqueueOp(uid, { entity: 'food', method: 'POST', url: '/api/foods', payload, localId: id, serverId: null, refName: name });
  }
  await refreshPendingCount();
  return { food: stripRow(rec) };
}
async function localFoodUpdate(uid, id, body) {
  const existing = await findFoodById(uid, id);
  if (!existing) throw new Error('Food not found offline.');
  const name = String(body.name ?? existing.name).trim().slice(0, 120);
  const serving = Number(body.serving_grams ?? existing.serving_grams);
  const payload = {
    name,
    serving_grams: serving,
    calories: body.calories != null ? Number(body.calories) : (existing.calories_per_100g * serving) / 100,
    protein: body.protein != null ? Number(body.protein) : (existing.protein_per_100g * serving) / 100,
    carbs: body.carbs != null ? Number(body.carbs) : (existing.carbs_per_100g * serving) / 100,
    fat: body.fat != null ? Number(body.fat) : (existing.fat_per_100g * serving) / 100,
  };
  const rec = {
    ...existing,
    name,
    serving_grams: serving,
    calories_per_100g: math.toPer100(payload.calories, serving),
    protein_per_100g: math.toPer100(payload.protein, serving),
    carbs_per_100g: math.toPer100(payload.carbs, serving),
    fat_per_100g: math.toPer100(payload.fat, serving),
    updated_at: isoNow(),
  };
  await storePut('foods', rec);
  if (id > 0) {
    await enqueueOp(uid, { entity: 'food', method: 'PUT', url: `/api/foods/${id}`, payload, serverId: id, refName: name });
  } else {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'food' && o.localId === id);
    if (op) await updateOp(op.id, { payload, retries: 0, status: 'pending', last_error: null });
    else await enqueueOp(uid, { entity: 'food', method: 'POST', url: '/api/foods', payload, localId: id, serverId: null, refName: name });
  }
  await refreshPendingCount();
  return { food: stripRow(rec) };
}

async function localLogCreate(uid, body) {
  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid date (YYYY-MM-DD) is required.');
  const meal = ['breakfast', 'lunch', 'dinner', 'snack'].includes(body.meal) ? body.meal : 'snack';
  const grams = Number(body.grams);
  if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
    throw new Error('Amount must be between 0 and 5,000 grams.');
  }
  let name, calories, protein, carbs, fat;
  if (body.food_id != null && Number.isFinite(Number(body.food_id))) {
    const food = await findFoodById(uid, Number(body.food_id));
    if (!food) throw new Error('That food is not available offline.');
    const scaled = math.scaleFood(food, grams);
    name = food.name;
    calories = scaled.calories; protein = scaled.protein; carbs = scaled.carbs; fat = scaled.fat;
  } else {
    name = String(body.name || '').trim().slice(0, 120);
    if (!name) throw new Error('Food name is required.');
    calories = Number(body.calories ?? 0);
    protein = Number(body.protein ?? 0);
    carbs = Number(body.carbs ?? 0);
    fat = Number(body.fat ?? 0);
  }
  const id = await nextLocalId();
  const clientId = newClientId();
  const rec = {
    k: logKey(uid, id), id, user_id: uid,
    log_date: date, meal, grams,
    name, calories, protein, carbs, fat,
    client_id: clientId, created_at: isoNow(),
  };
  await storePut('logs', rec);
  await enqueueOp(uid, {
    entity: 'log',
    method: 'POST',
    url: '/api/logs',
    payload: { date, meal, grams, name, calories, protein, carbs, fat, client_id: clientId, create_food: !!body.create_food },
    localId: id,
    serverId: null,
  });
  if (body.create_food) {
    await localFoodUpsert(uid, { name, serving_grams: grams, calories, protein, carbs, fat }).catch(() => {});
  }
  await refreshPendingCount();
  return { entry: stripRow(rec) };
}
async function localLogUpdate(uid, id, body) {
  const existing = await findLogById(uid, id);
  if (!existing) throw new Error('Entry not found offline.');
  const rec = {
    ...existing,
    name: String(body.name ?? existing.name).trim().slice(0, 120),
    meal: body.meal ?? existing.meal,
    grams: Number(body.grams ?? existing.grams),
    calories: Number(body.calories ?? existing.calories),
    protein: Number(body.protein ?? existing.protein),
    carbs: Number(body.carbs ?? existing.carbs),
    fat: Number(body.fat ?? existing.fat),
  };
  await storePut('logs', rec);
  const payload = { name: rec.name, meal: rec.meal, grams: rec.grams, calories: rec.calories, protein: rec.protein, carbs: rec.carbs, fat: rec.fat };
  if (id > 0) {
    await enqueueOp(uid, { entity: 'log', method: 'PUT', url: `/api/logs/${id}`, payload, serverId: id });
  } else {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'log' && o.localId === id);
    if (op) await updateOp(op.id, { payload: { ...op.payload, ...payload }, retries: 0, status: 'pending', last_error: null });
    else await enqueueOp(uid, { entity: 'log', method: 'POST', url: '/api/logs', payload: { ...payload, date: rec.log_date, client_id: rec.client_id || newClientId() }, localId: id, serverId: null });
  }
  await refreshPendingCount();
  return { entry: stripRow(rec) };
}

async function localProfileSave(uid, body) {
  const existing = (await storeGet('profiles', uid)) || {};
  const now = isoNow();
  const rec = {
    ...existing, k: uid, user_id: uid,
    name: String(body.name ?? '').trim().slice(0, 60) || null,
    age: Number(body.age),
    gender: body.gender,
    height_cm: Number(body.height_cm),
    activity_level: body.activity_level,
    current_weight: Number(body.current_weight),
    goal_type: body.goal_type || 'lose',
    weekly_goal_kg: Number(body.weekly_goal_kg ?? 0),
    step_goal: Number(body.step_goal ?? 10000),
    diet_type: body.diet_type || 'normal',
    start_weight: existing.start_weight ?? Number(body.current_weight),
    updated_at: now,
  };
  const t = await recomputeProfileTargets(rec, rec.current_weight);
  Object.assign(rec, {
    bmr: t.bmr, tdee: t.tdee, bmi: t.bmi, bmi_category: t.bmi_category,
    calorie_target: t.calorie_target, protein_target: t.protein_target,
    carb_target: t.carb_target, fat_target: t.fat_target,
  });
  await storePut('profiles', rec);
  if (body.today) {
    try { await localWeightUpsert(uid, { date: body.today, weight: rec.current_weight }); } catch { /* non-fatal */ }
  }
  const payload = {
    name: rec.name ?? '', age: rec.age, gender: rec.gender, height_cm: rec.height_cm,
    activity_level: rec.activity_level, current_weight: rec.current_weight,
    goal_type: rec.goal_type, weekly_goal_kg: rec.weekly_goal_kg,
    step_goal: rec.step_goal, diet_type: rec.diet_type,
    today: /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : null,
  };
  const op = await findPendingOpFor(uid, (o) => o.entity === 'profile');
  if (op) await updateOp(op.id, { payload, retries: 0, status: 'pending', last_error: null });
  else await enqueueOp(uid, { entity: 'profile', method: 'PUT', url: '/api/profile', payload, serverId: uid });
  await refreshPendingCount();
  const clean = stripRow(rec);
  return { profile: clean, targets: clean, complete: !!(rec.age != null && rec.height_cm != null && rec.current_weight != null) };
}
async function localWeightDelete(uid, id) {
  const rec = await findWeightById(uid, id);
  if (!rec) return { ok: true };
  if (id < 0) {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'weight' && o.localId === id);
    if (op) await removeOp(op.id);
  } else {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'weight' && String(o.payload?.date) === String(rec.log_date));
    if (op) await removeOp(op.id);
    await enqueueOp(uid, { entity: 'weight', method: 'DELETE', url: `/api/weights/${id}`, serverId: id, refDate: rec.log_date });
  }
  await storeDelete('weights', rec.k);
  await refreshPendingCount();
  return { ok: true };
}

async function localLogDelete(uid, id) {
  const rec = await findLogById(uid, id);
  if (!rec) return { ok: true };
  if (id < 0) {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'log' && o.localId === id);
    if (op) await removeOp(op.id);
  } else {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'log' && (o.localId === id || o.serverId === id));
    if (op) await removeOp(op.id);
    await enqueueOp(uid, { entity: 'log', method: 'DELETE', url: `/api/logs/${id}`, serverId: id });
  }
  await storeDelete('logs', rec.k);
  await refreshPendingCount();
  return { ok: true };
}

async function localFoodDelete(uid, id) {
  const rec = await findFoodById(uid, id);
  if (!rec) return { ok: true };
  if (id < 0) {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'food' && o.localId === id);
    if (op) await removeOp(op.id);
  } else {
    const op = await findPendingOpFor(uid, (o) => o.entity === 'food' && (o.localId === id || (o.payload && String(o.payload.name).toLowerCase() === String(rec.name).toLowerCase())));
    if (op) await removeOp(op.id);
    await enqueueOp(uid, { entity: 'food', method: 'DELETE', url: `/api/foods/${id}`, serverId: id, refName: rec.name });
  }
  await storeDelete('foods', rec.k);
  await refreshPendingCount();
  return { ok: true };
}

async function localStepDelete(uid, date) {
  const key = stepKey(uid, String(date));
  const rec = await storeGet('steps', key);
  if (!rec) return { ok: true };
  const op = await findPendingOpFor(uid, (o) => o.entity === 'step' && String(o.payload?.date) === String(date));
  if (op) await removeOp(op.id);
  await enqueueOp(uid, { entity: 'step', method: 'DELETE', url: '', refDate: String(date) });
  await storeDelete('steps', rec.k);
  await refreshPendingCount();
  return { ok: true };
}

/** Apply a write locally (cache + sync queue) and return a server-shaped response. */
export async function applyLocalWrite(method, path, body = {}) {
  const uid = await requireUser();
  if (method === 'POST') {
    if (path === '/api/weights') return localWeightUpsert(uid, body);
    if (path === '/api/steps') return localStepUpsert(uid, body);
    if (path === '/api/foods') return localFoodUpsert(uid, body);
    if (path === '/api/logs') return localLogCreate(uid, body);
  } else if (method === 'PUT') {
    const m = /^\/api\/logs\/(\d+)/.exec(path);
    if (m) return localLogUpdate(uid, Number(m[1]), body);
    const fm = /^\/api\/foods\/(\d+)/.exec(path);
    if (fm) return localFoodUpdate(uid, Number(fm[1]), body);
    if (/^\/api\/profile/.test(path)) return localProfileSave(uid, body);
  } else if (method === 'DELETE') {
    const wm = /^\/api\/weights\/(\d+)/.exec(path);
    if (wm) return localWeightDelete(uid, Number(wm[1]));
    const lm = /^\/api\/logs\/(\d+)/.exec(path);
    if (lm) return localLogDelete(uid, Number(lm[1]));
    const fm = /^\/api\/foods\/(\d+)/.exec(path);
    if (fm) return localFoodDelete(uid, Number(fm[1]));
    const sm = /^\/api\/steps\/(\d{4}-\d{2}-\d{2})/.exec(path);
    if (sm) return localStepDelete(uid, sm[1]);
  }
  throw new Error(`Not supported offline: ${method} ${path}`);
}
/* ---------------- sync engine support ---------------- */

/* Map a synced create back to the local row: swap the local (negative) id for the server id. */
export async function ackCreate(op, data) {
  const uid = op.user_id;
  const entity = op.entity;
  try {
    if (entity === 'weight') {
      const row = data?.entry;
      if (row) {
        const local = await findWeightByDate(uid, row.log_date);
        if (local) {
          if (Number(local.id) !== Number(row.id)) {
            await storeDelete('weights', local.k);
            await storePut('weights', { ...stripData(local), ...row, k: weightKey(uid, Number(row.id)), user_id: uid });
          } else {
            await storePut('weights', { ...local, ...row, k: local.k });
          }
        } else {
          await storeBulkPut('weights', [normWeight(row, uid)]);
        }
      }
      if (data?.profile) await storePut('profiles', { ...data.profile, k: data.profile.user_id ?? uid });
    } else if (entity === 'log') {
      const row = data?.entry;
      if (row) {
        const clientId = op.payload?.client_id;
        const local = clientId ? await findLogByClientId(uid, clientId) : null;
        if (local) {
          if (Number(local.id) !== Number(row.id)) {
            await storeDelete('logs', local.k);
            await storePut('logs', { ...stripData(local), ...row, k: logKey(uid, Number(row.id)), user_id: uid });
          } else {
            await storePut('logs', { ...local, ...row, k: local.k });
          }
        } else {
          await storeBulkPut('logs', [normLog(row, uid)]);
        }
      }
    } else if (entity === 'food') {
      const row = data?.food;
      if (row) {
        const local = op.localId != null ? await findFoodById(uid, Number(op.localId)) : null;
        if (local) {
          if (Number(local.id) !== Number(row.id)) {
            await storeDelete('foods', local.k);
            await storePut('foods', { ...stripData(local), ...row, k: foodKey(uid, Number(row.id)), user_id: uid });
          } else {
            await storePut('foods', { ...local, ...row, k: local.k });
          }
        } else {
          await storeBulkPut('foods', [normFood(row, uid)]);
        }
      }
    } else if (entity === 'step') {
      if (data?.log) await upsertSteps(uid, [data.log]);
    } else if (entity === 'profile') {
      if (data?.profile) await storePut('profiles', { ...data.profile, k: data.profile.user_id ?? uid });
    }
  } catch (e) {
    console.error('offline ackCreate failed:', e);
  }
}

/** Send one queued operation to the real API (idempotent where required). */
export async function pushOp(op) {
  let url = op.url;
  let method = op.method;
  let body = op.payload ? { ...op.payload } : null;

  if (method === 'DELETE') {
    if (op.entity === 'weight' && !op.serverId) {
      const { entries } = await raw('/api/weights?limit=365');
      const row = (entries || []).find((w) => String(w.log_date) === String(op.refDate));
      if (!row) return { skipped: true };
      url = `/api/weights/${row.id}`;
    } else if (op.entity === 'food' && !op.serverId) {
      const { foods } = await raw('/api/foods?limit=200');
      const row = (foods || []).find((f) => String(f.name).toLowerCase() === String(op.refName || '').toLowerCase());
      if (!row) return { skipped: true };
      url = `/api/foods/${row.id}`;
    } else if (op.entity === 'step') {
      url = `/api/steps/${encodeURIComponent(op.refDate)}`;
    } else if (op.entity === 'log' && !op.serverId && body?.client_id) {
      const created = await raw('/api/logs', { method: 'POST', body: JSON.stringify(body) });
      url = `/api/logs/${created?.entry?.id}`;
    }
  }

  const data = await raw(url, { method, body: body != null ? JSON.stringify(body) : undefined });
  if (data?.skipped) return data;
  if (method === 'POST' || method === 'PUT') {
    await ackCreate(op, data);
  }
  return data;
}
/** Pull the latest server data into the local cache (after the queue drains). */
export async function seedAll(uid, { skipAuth = false } = {}) {
  if (uid == null) return;
  const endpoints = [
    '/api/profile',
    '/api/foods',
    '/api/weights?limit=365',
    '/api/logs/recent?limit=1000',
    '/api/steps/entries?limit=365',
  ];
  for (const path of endpoints) {
    try {
      const data = await raw(path);
      await cachePutFromGet(path, data);
    } catch { /* keep existing cache on any failure */ }
  }
  if (!skipAuth) {
    try {
      const me = await raw('/api/auth/me');
      await cachePutFromGet('/api/auth/me', me);
    } catch { /* keep cached session */ }
  }
  await kvSet(`lastSync.${uid}`, Date.now());
  status.lastSyncAt = Date.now();
  await refreshPendingCount();
  renderStatus();
}

/* ---------------- status pill ---------------- */
export function setStatus(patch) {
  Object.assign(status, patch);
  renderStatus();
}

export function renderStatus() {
  status.online = online;
  const el = typeof document !== 'undefined' ? document.getElementById('conn-status') : null;
  if (!el) return;
  el.classList.remove('st-online', 'st-offline', 'st-syncing', 'st-pending');
  if (status.syncing) {
    el.textContent = 'Syncing…';
    el.classList.add('st-syncing');
  } else if (!online) {
    el.textContent = status.pending > 0 ? `Offline · ${status.pending} pending` : 'Offline';
    el.classList.add('st-offline');
  } else if (status.pending > 0) {
    el.textContent = `${status.pending} change${status.pending === 1 ? '' : 's'} to sync`;
    el.classList.add('st-pending');
  } else {
    el.textContent = 'Online';
    el.classList.add('st-online');
  }
}

const api = {
  init,
  isOnline,
  isOffline,
  getUser,
  getStatus,
  setStatus,
  renderStatus,
  raw,
  isNetworkError,
  markOnline,
  markOffline,
  addConnectionListener,
  addDataChangedListener,
  notifyDataChanged,
  setSession,
  clearSession,
  onAuthenticated,
  cacheGet,
  cachePutFromGet,
  applyServerWrite,
  applyLocalWrite,
  listPendingOps,
  countPending,
  hasPending,
  markOpResult,
  removeOp,
  refreshPendingCount,
  pushOp,
  ackCreate,
  seedAll,
};
export default api;

function stripData(r) {
  const { k, offline_local, ...rest } = r || {};
  return rest;
}