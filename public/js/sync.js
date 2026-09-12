/* ============================================================
   sync.js — Background sync engine for the offline-first layer.

   Triggers (all debounced so we never spam the network):
   • app start (once the user is signed in)
   • browser comes back online (`online` event)
   • user returns to the tab (visibilitychange)
   • a periodic 60 s timer while online AND signed in
   ============================================================ */
import offline from './offline.js';

const opMaxRetries = 5; // after this many failures, an op is marked 'failed' (stops looping)

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
    const navOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (navOnline && offline.getUser() != null) trigger('periodic');
  }, 60000);
}

/** Kick a sync run (no-op when offline or signed out). */
export async function trigger(reason) {
  // Check navigator.onLine (real connectivity), NOT the in-memory isOnline()
  // flag — that flag is updated by a SEPARATE 'online' listener that fires
  // AFTER this one, so it would always be stale here and sync would never start.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const uid = offline.getUser();
  if (uid == null) return;
  // Background triggers (periodic 60s timer, tab focus, reconnect) only have
  // work to do when the user queued offline changes. Without pending ops there
  // is nothing to push — skip the re-fetch + page re-render entirely. Only
  // app start / login still run a full seed so the offline cache is primed.
  if (reason !== 'boot' && reason !== 'login' && !(await offline.hasPending(uid))) return;
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

  let lastError = null;
  let failedThisRun = 0;
  for (const op of ops) {
    // Give up on ops that failed too many times — mark them 'failed' so they
    // stop blocking the queue and looping forever. The user sees the count.
    if ((op.retries || 0) >= opMaxRetries) {
      await offline.markOpFailed(op.id, op.last_error || 'Failed after retries');
      continue;
    }
    try {
      await offline.pushOp(op);
      await offline.removeOp(op.id);
    } catch (err) {
      // Deleting something that is already gone is success (idempotent deletes).
      if (op.method === 'DELETE' && err.status === 404) {
        await offline.removeOp(op.id);
        continue;
      }
      lastError = String(err.message || err).slice(0, 200);
      failedThisRun += 1;
      // Increment the retry count but KEEP the op pending — it will be retried
      // on the next sync trigger (timer / online event / tab focus).
      // CRITICAL: do NOT call markOffline() here. A single failed push must
      // never mark the whole system offline or break the loop — only the
      // browser's own online/offline events control connectivity. Otherwise a
      // flaky mobile link that times out once would kill all future syncs.
      await offline.markOpResult(op.id, {
        retries: (op.retries || 0) + 1,
        last_error: lastError,
      });
    }
  }

  offline.setStatus({ syncing: false, lastError: lastError || null });

  // After the queue drains, re-download the latest server state into the cache.
  const remaining = await offline.countPending(uid);
  if (remaining === 0) {
    offline.setStatus({ syncing: true });
    await offline.seedAll(uid);
    offline.setStatus({ syncing: false, lastError: null });
    offline.notifyDataChanged();
  } else if (failedThisRun) {
    // Some ops failed but haven't hit max retries yet — refresh the pill so the
    // pending count is accurate; they will retry on the next trigger.
    await offline.refreshPendingCount();
  }
}