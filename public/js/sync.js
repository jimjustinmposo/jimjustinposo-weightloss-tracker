/* ============================================================
   sync.js — Background sync engine for the offline-first layer.

   Triggers (all debounced so we never spam the network):
   • app start (once the user is signed in)
   • browser comes back online (`online` event)
   • user returns to the tab (visibilitychange)
   • a periodic 60 s timer while online AND signed in
   ============================================================ */
import offline from './offline.js';

let started = false;
let running = false;
let queued = false;

export function start() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => trigger('online'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger('focus');
  });
  setInterval(() => {
    if (offline.isOnline() && offline.getUser() != null) trigger('periodic');
  }, 60000);
}

/** Kick a sync run (no-op when offline or signed out). */
export function trigger(reason) {
  if (!offline.isOnline()) return;
  if (offline.getUser() == null) return;
  if (running) { queued = true; return; }
  running = true;
  doSync(reason)
    .catch((e) => console.error('sync failed:', e))
    .finally(() => {
      running = false;
      if (queued) { queued = false; trigger('queued'); }
    });
}

async function doSync(reason) {
  const uid = offline.getUser();
  const ops = await offline.listPendingOps(uid);

  if (ops.length) offline.setStatus({ syncing: true });

  let networkDied = false;
  for (const op of ops) {
    try {
      await offline.pushOp(op);
      await offline.removeOp(op.id);
    } catch (err) {
      // Deleting something that is already gone is success (idempotent deletes).
      if (op.method === 'DELETE' && err.status === 404) {
        await offline.removeOp(op.id);
        continue;
      }
      const network = offline.isNetworkError(err);
      const retriable = network || !err.status || err.status === 429 || err.status >= 500;
      await offline.markOpResult(op.id, {
        retries: (op.retries || 0) + 1,
        last_error: network ? 'Network unavailable' : String(err.message || err).slice(0, 300),
      });
      if (network) {
        networkDied = true;
        offline.markOffline();
        break;
      }
      if (err.status >= 500) break; // server hiccup — stop, retry on next trigger
    }
  }

  offline.setStatus({ syncing: false });

  // After the queue drains, re-download the latest server state into the cache.
  if (!networkDied) {
    const remaining = await offline.countPending(uid);
    if (remaining === 0) {
      offline.setStatus({ syncing: true });
      await offline.seedAll(uid);
      offline.setStatus({ syncing: false });
      offline.notifyDataChanged();
    } else {
      // A few failed (non-network) ops remain — keep the cache as-is.
      await offline.refreshPendingCount();
    }
  }
}