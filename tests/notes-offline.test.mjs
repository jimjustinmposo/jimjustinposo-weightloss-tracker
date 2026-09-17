import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal asynchronous IndexedDB double; structuredClone deliberately rejects
// Promise-valued records, just as the browser does.
const stores = new Map();
const db = {
  objectStoreNames: { contains: (s) => stores.has(s) },
  createObjectStore: (s) => stores.set(s, new Map()),
  transaction() {
    const tx = {};
    let timer;
    const request = (fn) => {
      const req = {};
      queueMicrotask(() => {
        try { req.result = fn(); req.onsuccess?.(); }
        catch (e) { req.error = e; req.onerror?.(); }
      });
      clearTimeout(timer);
      timer = setTimeout(() => tx.oncomplete?.(), 0);
      return req;
    };
    tx.objectStore = (s) => ({
      get: (k) => request(() => structuredClone(stores.get(s).get(k))),
      getAll: () => request(() => structuredClone([...stores.get(s).values()])),
      put: (r) => {
        const copy = structuredClone(r);
        return request(() => { stores.get(s).set(copy.k, copy); return copy.k; });
      },
      delete: (k) => request(() => stores.get(s).delete(k)),
    });
    return tx;
  },
};
globalThis.indexedDB = { open() {
  const req = { result: db };
  queueMicrotask(() => { req.onupgradeneeded?.({ target: req }); req.onsuccess?.(); });
  return req;
} };
const offline = await import('../public/js/offline.js');

test('offline folder/note lifecycle, counts, queued payloads and retry', async (t) => {
  // Force every queued write into the same millisecond to expose ordering bugs.
  t.mock.method(Date, 'now', () => 1800000000000);
  await offline.persistSession({ id: 77, email: 'notes@example.test' }, null);
  const { folder } = await offline.applyLocalWrite('POST', '/api/notes/folders', { name: 'Ideas', client_id: 'folder-test' });
  assert.ok(Number.isInteger(folder.id) && folder.id < 0, 'local id is a negative integer');
  const photoBody = 't'.repeat(20000) + '![Photo](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8S8AAAAASUVORK5CYII=)';
  const { note } = await offline.applyLocalWrite('POST', '/api/notes', { folder_id: folder.id, title: 'First', body: photoBody, client_id: 'note-test' });
  assert.equal(note.body, photoBody);
  await assert.rejects(offline.applyLocalWrite('PUT', `/api/notes/${note.id}`, { body: 'x'.repeat(20001) }), /20,000/);
  assert.equal(note.client_id, 'note-test');
  assert.equal((await offline.cacheGet('/api/notes/folders')).folders[0].note_count, 1);
  await offline.applyLocalWrite('PUT', `/api/notes/${note.id}`, { title: 'Edited' });
  await offline.applyLocalWrite('PUT', `/api/notes/folders/${folder.id}`, { name: 'Renamed' });
  const ops = await offline.listPendingOps(77);
  assert.equal(ops.length, 4);
  assert.deepEqual(ops.map((o) => [o.entity, o.method]), [['noteFolder', 'POST'], ['note', 'POST'], ['note', 'PUT'], ['noteFolder', 'PUT']]);
  const remote = { folders: [], notes: [] };
  const requests = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    requests.push({ url, method, body });
    const isFolder = url.includes('/folders');
    const rows = isFolder ? remote.folders : remote.notes;
    const key = isFolder ? 'folder' : 'note';
    let response;
    if (method === 'GET') response = { [isFolder ? 'folders' : 'notes']: rows };
    else if (method === 'POST') {
      if (!isFolder) assert.equal(body.folder_id, 101);
      let row = rows.find((r) => r.client_id === body.client_id);
      if (!row) { row = { ...body, id: isFolder ? 101 : 201, user_id: 77 }; rows.push(row); }
      response = { [key]: row };
    } else if (method === 'PUT') {
      const row = rows.find((r) => r.id === Number(url.split('/').pop()));
      assert.ok(row, 'PUT targets a resolved server ID');
      Object.assign(row, body);
      response = { [key]: row };
    } else {
      rows.splice(rows.findIndex((r) => r.id === Number(url.split('/').pop())), 1);
      response = { ok: true };
    }
    return Response.json(response);
  };
  for (const op of ops) { await offline.pushOp(op); await offline.removeOp(op.id); }
  await offline.pushOp(ops[1]); // lost-response retry must not duplicate
  assert.equal(remote.notes.length, 1);
  assert.equal(remote.notes[0].title, 'Edited');
  assert.equal(remote.notes[0].body, photoBody, 'Photos survive queued create/update and sync retries');
  assert.equal((await offline.cacheGet('/api/notes')).notes[0].body, photoBody);
  assert.equal(remote.folders[0].name, 'Renamed');
  assert.equal((await offline.cacheGet('/api/notes/folders')).folders[0].note_count, 1);
  assert.equal(await offline.countPending(77), 0);
  await offline.applyLocalWrite('DELETE', '/api/notes/201');
  assert.equal((await offline.cacheGet('/api/notes/folders')).folders[0].note_count, 0);
  for (const op of await offline.listPendingOps(77)) { await offline.pushOp(op); await offline.removeOp(op.id); }
  assert.equal(remote.notes.length, 0);
  assert.ok(requests.some((r) => r.method === 'POST' && r.body?.folder_id === 101));
});
