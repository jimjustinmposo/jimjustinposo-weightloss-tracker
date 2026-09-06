import offline from './offline.js';

/* ============================================================
   api.js — Data-access layer.
   Online:  proxies to the existing Hono API (unchanged behavior).
   Offline: serves the IndexedDB cache and queues local writes for sync.
   The views keep using api.get/post/put/del exactly as before.
   ============================================================ */

async function handle(path, method, body) {
  // ---- Endpoints that fundamentally need the network ----
  const authWrite = path.startsWith('/api/auth/') && path !== '/api/auth/me';
  const aiOnly = path.startsWith('/api/nutrition/');
  if (authWrite || aiOnly) {
    if (!offline.isOnline()) {
      const msg = aiOnly
        ? 'Online nutrition lookup needs an internet connection — enter the values manually.'
        : 'No internet connection.';
      const err = new Error(msg);
      err.status = 0;
      throw err;
    }
    return offline.raw(path, { method, body: body != null ? JSON.stringify(body) : undefined });
  }

  // ---- Reads ----
  if (method === 'GET' || method == null) {
    // No connection → everything comes from the local cache.
    if (offline.isOffline()) return offline.cacheGet(path);

    // While unsynced local changes exist, read from the cache so the user
    // always sees their own most recent edits (the queue flushes in background).
    const uid = offline.getUser();
    let pending = false;
    try {
      pending = uid != null && !path.startsWith('/api/auth/') && (await offline.hasPending(uid));
    } catch { /* storage unavailable → behave exactly like the old online app */ }
    if (pending) {
      return offline.cacheGet(path);
    }

    try {
      const data = await offline.raw(path);
      offline.markOnline();
      offline.cachePutFromGet(path, data).catch(() => {});
      return data;
    } catch (err) {
      if (offline.isNetworkError(err)) {
        offline.markOffline();
        return offline.cacheGet(path);
      }
      offline.markOnline();
      throw err;
    }
  }

  // ---- Writes ----
  if (offline.isOffline()) {
    return offline.applyLocalWrite(method, path, body || {});
  }

  try {
    const data = await offline.raw(path, { method, body: body != null ? JSON.stringify(body) : undefined });
    offline.markOnline();
    offline.applyServerWrite(method, path, body, data).catch(() => {});
    return data;
  } catch (err) {
    if (offline.isNetworkError(err)) {
      offline.markOffline();
      return offline.applyLocalWrite(method, path, body || {});
    }
    offline.markOnline();
    throw err;
  }
}

const api = {
  get: (p) => handle(p, 'GET'),
  post: (p, body) => handle(p, 'POST', body || {}),
  put: (p, body) => handle(p, 'PUT', body || {}),
  del: (p) => handle(p, 'DELETE'),
};

export default api;
