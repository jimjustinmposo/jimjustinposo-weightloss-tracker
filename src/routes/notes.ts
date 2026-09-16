import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppVars, Env } from '../types';

type NoteRow = Record<string, unknown>;

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

const MAX_FOLDER_NAME = 80;
const MAX_TITLE = 120;
const MAX_BODY = 20000;

function cleanFolderName(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_FOLDER_NAME);
}
function cleanTitle(v: unknown): string {
  return String(v ?? '').trim().slice(0, MAX_TITLE);
}
function cleanBody(v: unknown): string {
  return String(v ?? '').slice(0, MAX_BODY);
}
/** Offline idempotency key (same idea as food_logs.client_id in migration 0004). */
function cleanClientId(v: unknown): string | null {
  const s = String(v ?? '').trim().slice(0, 80);
  return s || null;
}
function cleanId(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : NaN;
}

async function noteCount(db: D1Database, userId: number, folderId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?1 AND folder_id = ?2')
    .bind(userId, folderId)
    .first<{ n: number }>();
  return Number(row?.n || 0);
}

async function folderWithCount(db: D1Database, userId: number, folder: NoteRow): Promise<NoteRow> {
  return { ...folder, note_count: await noteCount(db, userId, Number(folder.id)) };
}

async function findFolder(db: D1Database, userId: number, id: number): Promise<NoteRow | null> {
  return db
    .prepare('SELECT * FROM note_folders WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .first<NoteRow>();
}

/* ---------------- folders ---------------- */

// All folders with their note counts (one query — the counts shown on the folder cards).
app.get('/folders', async (c) => {
  const userId = c.get('userId');
  const folders = (
    await c.env.DB.prepare(
      `SELECT f.*, COUNT(n.id) AS note_count
         FROM note_folders f
         LEFT JOIN notes n ON n.folder_id = f.id AND n.user_id = f.user_id
        WHERE f.user_id = ?1
        GROUP BY f.id
        ORDER BY f.updated_at DESC, f.id DESC`
    )
      .bind(userId)
      .all<NoteRow>()
  ).results;
    return c.json({ folders });
});

/* ---------------- folder create/update/delete ---------------- */

// Create a folder. Repeat calls with the same client_id (offline retry) or the
// same name return the existing folder instead of failing.
app.post('/folders', async (c) => {
  const userId = c.get('userId');
  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanFolderName(payload.name);
  const clientId = cleanClientId(payload.client_id);
  if (!name) throw new HTTPException(400, { message: 'Folder name is required.' });

  if (clientId) {
    const byClient = await c.env.DB.prepare('SELECT * FROM note_folders WHERE user_id = ?1 AND client_id = ?2')
      .bind(userId, clientId)
      .first<NoteRow>();
    if (byClient) return c.json({ folder: await folderWithCount(c.env.DB, userId, byClient) });
  }

  const byName = await c.env.DB.prepare('SELECT * FROM note_folders WHERE user_id = ?1 AND name = ?2')
    .bind(userId, name)
    .first<NoteRow>();
  if (byName) return c.json({ folder: await folderWithCount(c.env.DB, userId, byName) });

  await c.env.DB.prepare('INSERT INTO note_folders (user_id, name, client_id) VALUES (?1, ?2, ?3)')
    .bind(userId, name, clientId)
    .run();

  const folder = await c.env.DB.prepare('SELECT * FROM note_folders WHERE user_id = ?1 AND name = ?2')
    .bind(userId, name)
    .first<NoteRow>();
  return c.json({ folder: { ...folder, note_count: 0 } }, 201);
});

// Rename a folder.
app.put('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const existing = await findFolder(c.env.DB, userId, id);
  if (!existing) throw new HTTPException(404, { message: 'Folder not found.' });

  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = cleanFolderName(payload.name ?? existing.name);
  if (!name) throw new HTTPException(400, { message: 'Folder name is required.' });

  try {
    await c.env.DB.prepare(
      "UPDATE note_folders SET name = ?3, updated_at = datetime('now') WHERE id = ?1 AND user_id = ?2"
    )
      .bind(id, userId, name)
      .run();
  } catch (err) {
    if (String((err as Error)?.message).toUpperCase().includes('UNIQUE')) {
      throw new HTTPException(409, { message: 'Another folder with that name already exists.' });
    }
    throw err;
  }

  const folder = await findFolder(c.env.DB, userId, id);
  return c.json({ folder: await folderWithCount(c.env.DB, userId, folder!) });
});

// Delete a folder. Its notes go with it (explicit delete + ON DELETE CASCADE).
app.delete('/folders/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const existing = await findFolder(c.env.DB, userId, id);
  if (!existing) throw new HTTPException(404, { message: 'Folder not found.' });
  await c.env.DB.prepare('DELETE FROM notes WHERE folder_id = ?1 AND user_id = ?2').bind(id, userId).run();
  await c.env.DB.prepare('DELETE FROM note_folders WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
    return c.json({ ok: true });
});

/* ---------------- notes ---------------- */

// Notes, newest first. ?folder_id=N → only that folder; no folder_id → every note.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const raw = c.req.query('folder_id');
  const limit = Math.min(Math.max(Math.round(Number(c.req.query('limit')) || 2000), 1), 2000);

  if (raw != null && raw !== '') {
    const folderId = cleanId(raw);
    if (!Number.isFinite(folderId)) throw new HTTPException(400, { message: 'Invalid folder id.' });
    const folder = await findFolder(c.env.DB, userId, folderId);
    if (!folder) throw new HTTPException(404, { message: 'Folder not found.' });
    const notes = (
      await c.env.DB.prepare(
        'SELECT * FROM notes WHERE user_id = ?1 AND folder_id = ?2 ORDER BY updated_at DESC, id DESC LIMIT ?3'
      )
        .bind(userId, folderId, limit)
        .all<NoteRow>()
    ).results;
    return c.json({ folder_id: folderId, folder: await folderWithCount(c.env.DB, userId, folder), notes });
  }

  const notes = (
    await c.env.DB.prepare(
      'SELECT * FROM notes WHERE user_id = ?1 ORDER BY updated_at DESC, id DESC LIMIT ?2'
    )
      .bind(userId, limit)
      .all<NoteRow>()
  ).results;
  return c.json({ notes });
});

// Create a note inside one of the user's folders.
app.post('/', async (c) => {
  const userId = c.get('userId');
  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = cleanClientId(payload.client_id);

  if (clientId) {
    const byClient = await c.env.DB.prepare('SELECT * FROM notes WHERE user_id = ?1 AND client_id = ?2')
      .bind(userId, clientId)
      .first<NoteRow>();
    if (byClient) return c.json({ note: byClient });
  }

  const folderId = cleanId(payload.folder_id);
  if (!Number.isFinite(folderId)) throw new HTTPException(400, { message: 'Choose a folder for this note.' });
  const folder = await findFolder(c.env.DB, userId, folderId);
  if (!folder) throw new HTTPException(404, { message: 'Folder not found.' });

  const title = cleanTitle(payload.title) || 'Untitled note';
  const text = cleanBody(payload.body);

  const inserted = await c.env.DB.prepare(
    'INSERT INTO notes (user_id, folder_id, title, body, client_id) VALUES (?1, ?2, ?3, ?4, ?5)'
  )
    .bind(userId, folderId, title, text, clientId)
    .run();

  // client_id is optional for online-created notes → fall back to the inserted row id.
  const note = clientId
    ? await c.env.DB.prepare('SELECT * FROM notes WHERE user_id = ?1 AND client_id = ?2')
        .bind(userId, clientId)
        .first<NoteRow>()
    : await c.env.DB.prepare('SELECT * FROM notes WHERE id = ?1 AND user_id = ?2')
        .bind(Number(inserted.meta.last_row_id), userId)
        .first<NoteRow>();
  return c.json({ note }, 201);
});

// Edit a note (title, text and optionally the folder it lives in).
app.put('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT * FROM notes WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .first<NoteRow>();
  if (!existing) throw new HTTPException(404, { message: 'Note not found.' });

  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const title = cleanTitle(payload.title ?? existing.title) || 'Untitled note';
  const text = payload.body != null ? cleanBody(payload.body) : String(existing.body ?? '');
  let folderId = Number(existing.folder_id);
  if (payload.folder_id != null) {
    const wanted = cleanId(payload.folder_id);
    if (!Number.isFinite(wanted)) throw new HTTPException(400, { message: 'Invalid folder id.' });
    const folder = await findFolder(c.env.DB, userId, wanted);
    if (!folder) throw new HTTPException(404, { message: 'Folder not found.' });
    folderId = wanted;
  }

  await c.env.DB.prepare(
    `UPDATE notes SET title = ?3, body = ?4, folder_id = ?5, updated_at = datetime('now')
      WHERE id = ?1 AND user_id = ?2`
  )
    .bind(id, userId, title, text, folderId)
    .run();

  const note = await c.env.DB.prepare('SELECT * FROM notes WHERE id = ?1').bind(id).first<NoteRow>();
  return c.json({ note });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  const res = await c.env.DB.prepare('DELETE FROM notes WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
  if (!res.meta.changes) throw new HTTPException(404, { message: 'Note not found.' });
  return c.json({ ok: true });
});

export default app;