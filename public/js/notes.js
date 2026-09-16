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
        <div class="grow">
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
        <p><span class="meta">${count} entr${count === 1 ? 'y' : 'ies'}</span> · tap an entry to edit · offline & synced</p>
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

/* ---------- create / edit a note ---------- */
function editNote(root, id) {
  const { overlay } = openModal({
    title: id == null ? 'New entry' : 'Edit entry',
    body: `<div class="field"><label>Entry title</label><input id="ne-title" type="text" maxlength="120" placeholder="Entry title" autocomplete="off" /></div>
      <div class="field"><label>Entry text</label><textarea id="ne-body" rows="8" maxlength="${MAX_BODY}" placeholder="Write your note here…"></textarea></div>`,
  });
  const titleEl = qs('#ne-title', overlay);
  const bodyEl = qs('#ne-body', overlay);

  if (id != null) {
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
      await renderFolderNotes(root, currentFolderId);
    } catch (err) { toast(err.message, 'error'); }
  };
  qs('#ne-body', overlay).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(e); });
  overlay.querySelector('.modal-body').insertAdjacentHTML('beforeend',
    `<button class="btn accent block" style="margin-top:8px" id="ne-save">${id == null ? 'Save entry' : 'Save changes'}</button>`);
  qs('#ne-save', overlay).addEventListener('click', save);
}

