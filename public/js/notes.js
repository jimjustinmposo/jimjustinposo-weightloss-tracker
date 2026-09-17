import api from './api.js';
import { icons, esc, toast, openModal, prettyDate, qs, qsa } from './util.js';

const MAX_BODY = 20000;
/* The Notes section keeps its own nav state: null = folder picker, a number = notes in a folder */
let currentFolderId = null;

export async function renderNotes(root) {
  root.dataset.notesView = currentFolderId == null ? 'folders' : 'notes';
  root.innerHTML = `<div class="boot-loader"><div class="spinner"></div></div>`;
  try {
    if (currentFolderId == null) await renderFolderList(root);
    else await renderFolderNotes(root, currentFolderId);
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="empty">${icons.alert}<p>${esc(err.message)}</p></div></div>`;
  }
}

/* ---------- helpers ---------- */
function newClientId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? `cl-${crypto.randomUUID()}`
    : `cl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function noteDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return '—';
  return prettyDate(String(s).slice(0, 10));
}
function fmtBody(s) { return String(s ?? ''); }

/* ---------- global search (all main titles, separate results list) ---------- */
export function searchNotes(notes, folders, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const nameById = new Map((folders || []).map((f) => [Number(f.id), f.name]));
  return (notes || [])
    .filter((n) => String(n.title ?? '').toLowerCase().includes(q) || String(n.body ?? '').toLowerCase().includes(q))
    .map((n) => ({ ...n, folder_name: nameById.get(Number(n.folder_id)) || '' }));
}

/* ---------- folder list ---------- */
async function renderFolderList(root) {
  const { folders } = await api.get('/api/notes/folders');
  const list = folders || [];
  const totalNotes = list.reduce((s, f) => s + Number(f.note_count || 0), 0);

  const cards = list.length
    ? list.map((f) => {
        const count = Number(f.note_count || 0);
        return `
      <div class="notefolder" data-id="${Number(f.id)}">
        <button class="folder-open" data-id="${Number(f.id)}" title="Open “${esc(f.name)}”">
          <span class="ic folder-ic">${icons.folder}</span>
          <span class="folder-meta">
            <b>${esc(f.name)}</b>
            <small>${count} entr${count === 1 ? 'y' : 'ies'}</small>
          </span>
        </button>
        <div class="folder-actions">
          <button class="icon-btn rename-folder" data-id="${Number(f.id)}" title="Rename note title">${icons.pencil}</button>
          <button class="icon-btn del-folder" data-id="${Number(f.id)}" title="Delete note title">${icons.trash}</button>
        </div>
      </div>`;
      }).join('')
    : `<div class="empty">${icons.folder}<p>No note titles yet.</p><p class="muted">Tap “Add Note Title” to create one.</p></div>`;

  root.innerHTML = `
    <div class="page-title">
      <div><h2>${icons.note} Notes</h2>
        <p>Create a note title, then add entries inside it. Works offline — changes sync when you’re back online.</p>
      </div>
      <button class="btn accent" id="add-folder-btn">${icons.plus} Add Note Title</button>
    </div>
    <section class="card">
      <h3>${icons.folder} My note titles</h3>
      <form id="notes-search-form" class="searchbox" role="search" style="display:flex;gap:8px">
        <span aria-hidden="true" style="position:absolute;left:12px;top:12px">${icons.search}</span>
        <input type="search" id="notes-search" aria-label="Search all notes" placeholder="Search all note titles and text…" autocomplete="off" style="flex:1" />
        <button class="btn accent" type="submit">Search</button>
      </form>
      <section id="notes-search-results" hidden></section>
      <div class="folder-grid">${cards}</div>
    </section>
    <section class="card" style="margin-top:14px">
      <h3 style="font-size:14px;color:var(--muted)">Summary</h3>
      <div class="balance-strip">
        <div class="cell"><b>${list.length}</b><span>titles</span></div>
        <div class="cell"><b>${totalNotes}</b><span>total entries</span></div>
      </div>
    </section>`;

  root.dataset.notesView = 'folders';
  currentFolderId = null;

  // Global search: submit → separate results list (all note titles + full text),
  // click a result → opens that entry. Uses /api/notes so it works offline too.
  const resultsEl = qs('#notes-search-results', root);
  const searchInput = qs('#notes-search', root);
  let searchVersion = 0;
  const runSearch = async () => {
    const version = ++searchVersion;
    const q = searchInput.value.trim();
    if (!q) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
    resultsEl.hidden = false;
    resultsEl.innerHTML = '<p role="status">Searching…</p>';
    try {
      const [{ notes: allNotes }, { folders: allFolders }] = await Promise.all([
        api.get('/api/notes'),
        api.get('/api/notes/folders'),
      ]);
      if (version !== searchVersion) return;
      const hits = searchNotes(allNotes, allFolders, q);
      resultsEl.innerHTML = hits.length
        ? `<h3 style="font-size:14px">${icons.search} Results (${hits.length})</h3>
           <div class="rowlist">${hits.map((n) => {
             const b = fmtBody(n.body);
             const preview = b.length > 120 ? b.slice(0, 117) + '…' : (b || '—');
             return `
          <div class="lrow search-note-open" data-id="${Number(n.id)}" role="button" tabindex="0">
            <div class="grow">
              <div class="title" style="font-weight:700;font-size:14px">${esc(n.title)}</div>
              <div class="meta" style="font-size:12px;color:var(--muted)">${esc(preview)}</div>
              ${n.folder_name ? `<span class="meta">${icons.folder} ${esc(n.folder_name)}</span>` : ''}
            </div>
          </div>`;
           }).join('')}</div>`
        : `<div class="empty">${icons.search}<p>No matching notes for “${esc(q)}”.</p></div>`;
      resultsEl.hidden = false;
      qsa('.search-note-open', resultsEl).forEach((row) => {
        const open = () => {
          const n = hits.find((x) => Number(x.id) === Number(row.dataset.id));
          if (n) viewNote(root, n, runSearch);
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    } catch (err) {
      if (version !== searchVersion) return;
      resultsEl.innerHTML = `<p role="alert">${esc(err.message)}</p>`;
    }
  };
  qs('#notes-search-form', root).addEventListener('submit', (e) => { e.preventDefault(); return runSearch(); });
  searchInput.addEventListener('input', () => {
    ++searchVersion;
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
  });

  qs('#add-folder-btn', root).addEventListener('click', async () => {
    const { overlay } = openModal({
      title: 'New note title',
      body: `<div class="field"><label>Note title</label><input id="nf-name" type="text" maxlength="80" placeholder="e.g. Meal prep ideas" autocomplete="off" /></div>`,
    });
    const input = qs('#nf-name', overlay);
    input.focus();
    const submit = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        const data = await api.post('/api/notes/folders', { name, client_id: newClientId() });
        toast(`“${data.folder.name}” created`);
        overlay.remove();
        renderFolderList(root);
      } catch (err) { toast(err.message, 'error'); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    overlay.querySelector('.modal-body').insertAdjacentHTML('beforeend',
      `<button class="btn accent block" style="margin-top:8px" id="nf-save">Create note title</button>`);
    qs('#nf-save', overlay).addEventListener('click', submit);
  });

    qsa('.folder-open', root).forEach((btn) => btn.addEventListener('click', () => openFolder(root, Number(btn.dataset.id))));
  qsa('.rename-folder', root).forEach((btn) => btn.addEventListener('click', async () => renameFolder(root, Number(btn.dataset.id))));
  qsa('.del-folder', root).forEach((btn) => btn.addEventListener('click', async () => deleteFolder(root, Number(btn.dataset.id))));
}

function backToFolders(root) { currentFolderId = null; renderFolderList(root); }
async function openFolder(root, id) { currentFolderId = id; await renderFolderNotes(root, id); return; }

async function renameFolder(root, id) {
  const { folders } = await api.get('/api/notes/folders');
  const folder = folders.find((f) => Number(f.id) === id);
  const { overlay } = openModal({ title: 'Rename note title', body: `<div class="field"><label>Note title</label><input id="rf-name" type="text" maxlength="80" value="${esc(folder?.name || '')}" /></div>` });
  const input = qs('#rf-name', overlay);
  input.focus();
  input.select();
  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    try {
      await api.put(`/api/notes/folders/${id}`, { name });
      toast('Note title renamed');
      overlay.remove();
      await renderFolderList(root);
    } catch (err) { toast(err.message, 'error'); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  overlay.querySelector('.modal-body').insertAdjacentHTML('beforeend',
    `<button class="btn accent block" style="margin-top:8px" id="rf-save">Save note title</button>`);
  qs('#rf-save', overlay).addEventListener('click', submit);
}

async function deleteFolder(root, id) {
  const { folders } = await api.get('/api/notes/folders');
  const folder = folders.find((f) => Number(f.id) === id);
  const count = Number(folder?.note_count || 0);
    const msg = count > 0
    ? `Delete “${folder?.name}”? This will delete ${count} entr${count === 1 ? 'y' : 'ies'} in it.`
    : `Delete “${folder?.name}”?`;
  if (!confirm(msg)) return;
  try {
    await api.del(`/api/notes/folders/${id}`);
    toast('Note title deleted');
    await renderFolderList(root);
  } catch (err) { toast(err.message, 'error'); }
}

/* ---------- notes inside a folder ---------- */
async function renderFolderNotes(root, id, folder, folders) {
  const [{ folders: allFolders, }, noteRes] = await Promise.all([
    api.get('/api/notes/folders'),
    api.get(`/api/notes?folder_id=${id}`),
  ]);
  folders = folders || allFolders;
  const f = noteRes.folder || folders.find((x) => Number(x.id) === id) || { name: '' };
  const list = noteRes.notes || [];
  const count = Number(f.note_count || list.length);

  let content = '';
  if (list.length) {
    content = `<div class="rowlist" style="max-height:calc(100vh - 320px);overflow-y:auto">
      ${list.map((n) => {
        const b = fmtBody(n.body);
        const preview = b.length > 160 ? b.slice(0, 157) + '…' : (b || '—');
        return `
      <div class="lrow notefolder-note" data-id="${Number(n.id)}">
        <div class="grow view-note" data-id="${Number(n.id)}" role="button" tabindex="0" aria-label="View entry: ${esc(n.title || 'Untitled entry')}" style="cursor:pointer">
          <div class="title" style="font-weight:700;font-size:14px">${esc(n.title)}</div>
          <div class="meta" style="font-size:12px;color:var(--muted);white-space:pre-wrap;max-height:4.5em;overflow:hidden">${esc(preview)}</div>
          <span class="meta">${noteDate(n.updated_at)}</span>
        </div>
        <button class="icon-btn edit-note" data-id="${Number(n.id)}" title="Edit entry">${icons.pencil}</button>
        <button class="icon-btn del-note" data-id="${Number(n.id)}" title="Delete entry">${icons.trash}</button>
      </div>`;
      }).join('')}
    </div>`;
  } else {
    content = `<div class="empty">${icons.note}<p>No entries yet.<br/>Tap “Add Entry” to create one.</p></div>`;
  }

  root.innerHTML = `
    <div class="page-title" style="margin-bottom:8px">
      <div><h2 style="display:flex;align-items:center;gap:6px">${icons.folder} ${esc(f.name)}</h2>
        <p><span class="meta">${count} entr${count === 1 ? 'y' : 'ies'}</span> · tap an entry to view details · offline & synced</p>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn ghost" id="back-folders" title="Back to note titles">${icons.chevD}</button>
        <button class="btn accent" id="add-note-btn" title="Add entry under this title">${icons.plus} Add Entry</button>
      </div>
    </div>
    <section class="card">
      <h3 style="font-size:14px">${icons.note} Entries</h3>
      ${content}
    </section>`;

  root.dataset.notesView = 'notes';
  currentFolderId = id;

  qs('#back-folders', root).addEventListener('click', () => backToFolders(root));
  qs('#add-note-btn', root).addEventListener('click', () => editNote(root, null));
  qsa('.view-note', root).forEach((btn) => {
    const open = () => {
      const note = list.find((n) => Number(n.id) === Number(btn.dataset.id));
      if (note) viewNote(root, { ...note, folder_name: f.name });
    };
    btn.addEventListener('click', open);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
  qsa('.edit-note', root).forEach((btn) => btn.addEventListener('click', () => editNote(root, Number(btn.dataset.id))));
  qsa('.del-note', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      try {
        await api.del(`/api/notes/${Number(btn.dataset.id)}`);
        toast('Entry deleted');
        await renderFolderNotes(root, currentFolderId);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

/* ---------- read a full note ---------- */
function viewNote(root, note, onSaved = null) {
  const { overlay, close } = openModal({
    title: note.title || 'Untitled entry',
    body: `${note.folder_name ? `<p class="meta">${icons.folder} ${esc(note.folder_name)}</p>` : ''}
      <p class="meta">Updated: ${esc(noteDate(note.updated_at))}</p>
      <div id="note-details-body" style="white-space:pre-wrap;overflow-wrap:anywhere;margin:16px 0">${esc(fmtBody(note.body)) || 'No text in this entry.'}</div>
      <button class="btn accent block" id="note-details-edit">${icons.pencil} Edit entry</button>`,
  });
  overlay.querySelector('.modal').style.overflowWrap = 'anywhere';
  qs('.modal-close', overlay).focus();
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  qs('#note-details-edit', overlay).addEventListener('click', () => {
    close();
    editNote(root, Number(note.id), note, onSaved);
  });
}

/* ---------- create / edit a note ---------- */
function editNote(root, id, selectedNote = null, onSaved = null) {
  const { overlay } = openModal({
    title: id == null ? 'New entry' : 'Edit entry',
    body: `<div class="field"><label>Entry title</label><input id="ne-title" type="text" maxlength="120" placeholder="Entry title" autocomplete="off" /></div>
      <div class="field"><label>Entry text</label><textarea id="ne-body" rows="8" maxlength="${MAX_BODY}" placeholder="Write your note here…"></textarea></div>`,
  });
  const titleEl = qs('#ne-title', overlay);
  const bodyEl = qs('#ne-body', overlay);

  if (selectedNote) {
    titleEl.value = selectedNote.title ?? '';
    bodyEl.value = selectedNote.body ?? '';
  } else if (id != null) {
    api.get(`/api/notes?folder_id=${currentFolderId}`).then((d) => {
      const n = (d.notes || []).find((x) => Number(x.id) === id);
      if (n) { titleEl.value = n.title; bodyEl.value = n.body ?? ''; }
    });
  }
  titleEl.focus();

  const save = async (e) => {
    if (e) e.preventDefault();
    const title = titleEl.value.trim();
    const body = bodyEl.value;
    if (!title && !body) { toast('Nothing to save.'); return; }
    try {
      if (id == null) {
        await api.post('/api/notes', { folder_id: currentFolderId, title, body, client_id: newClientId() });
        toast('Entry added');
      } else {
        await api.put(`/api/notes/${id}`, { title, body });
        toast('Entry saved');
      }
      overlay.remove();
      if (onSaved) await onSaved();
      else await renderFolderNotes(root, currentFolderId);
    } catch (err) { toast(err.message, 'error'); }
  };
  qs('#ne-body', overlay).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(e); });
  overlay.querySelector('.modal-body').insertAdjacentHTML('beforeend',
    `<button class="btn accent block" style="margin-top:8px" id="ne-save">${id == null ? 'Save entry' : 'Save changes'}</button>`);
  qs('#ne-save', overlay).addEventListener('click', save);
}

