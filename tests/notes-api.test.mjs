import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import notes from '../src/routes/notes.ts';

test('Notes API: optional client ID, retries, counts, ownership and cascade', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2);');
    sqlite.exec(readFileSync(new URL('../migrations/0007_notes.sql', import.meta.url), 'utf8'));
    // Adapt SQLite statements to the D1 interface; execute the actual route SQL.
    const DB = { prepare(sql) {
      let values = [];
      const statement = () => sqlite.prepare(sql.replace(/\?\d+/g, (key) => `:p${key.slice(1)}`));
      const params = () => Object.fromEntries(values.map((v, i) => [`p${i + 1}`, v]));
      return {
        bind(...args) { values = args; return this; },
        async first() { return statement().get(params()) ?? null; },
        async all() { return { results: statement().all(params()) }; },
        async run() {
          const result = statement().run(params());
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      };
    } };
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('userId', Number(c.req.header('x-test-user') || 1)); await next(); });
    app.route('/api/notes', notes);
    const request = async (path, method = 'GET', body, user = 1) => {
      const res = await app.request(`/api/notes${path}`, {
        method, headers: { 'content-type': 'application/json', 'x-test-user': String(user) },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, { DB });
      return res;
    };
    const createdFolder = await request('/folders', 'POST', { name: 'Ideas', client_id: 'folder-1' });
    assert.equal(createdFolder.status, 201);
    const { folder } = await createdFolder.json();
    const created = await request('', 'POST', { folder_id: folder.id, title: 'No client ID', body: 'Text' });
    assert.equal(created.status, 201);
    const { note } = await created.json();
    assert.ok(note.id > 0);
    assert.equal(note.title, 'No client ID');
    const payload = { folder_id: folder.id, title: 'Retry', client_id: 'note-1' };
    const first = await (await request('', 'POST', payload)).json();
    const retry = await (await request('', 'POST', payload)).json();
    assert.equal(retry.note.id, first.note.id);
    const listing = await (await request('/folders')).json();
    assert.equal(listing.folders[0].note_count, 2);
    assert.equal((await request(`/${note.id}`, 'PUT', { title: 'Intrusion' }, 2)).status, 404);
    assert.equal((await request(`/${note.id}`, 'DELETE', undefined, 2)).status, 404);
    assert.equal((await request('', 'POST', { folder_id: folder.id, title: 'Intrusion' }, 2)).status, 404);
    const edited = await (await request(`/${note.id}`, 'PUT', { title: 'Edited' })).json();
    assert.equal(edited.note.title, 'Edited');
    assert.equal((await request(`/${note.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/folders/${folder.id}`, 'DELETE')).status, 200);
    assert.deepEqual((await (await request('')).json()).notes, []);
  } finally {
    sqlite.close();
  }
});
