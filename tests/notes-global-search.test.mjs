import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../public/js/api.js';
import offline from '../public/js/offline.js';
import { renderNotes } from '../public/js/notes.js';
import { wireNoteEditor, renderNoteBody, autoGrowNote } from '../public/js/note-editor.js';
import { validateNoteBody, unpackNote, packNote, notePlainText } from '../public/js/note-content.js';

// Small DOM double for exercising the real view's event handlers, not a browser.
class Element {
  dataset = {}; style = {}; value = ''; hidden = false; handlers = {}; children = [];
  constructor(attrs = '') {
    this.attrs = attrs;
    this.id = /id="([^"]*)"/.exec(attrs)?.[1];
    this.classes = /class="([^"]*)"/.exec(attrs)?.[1]?.split(' ') || [];
    this.dataset.id = /data-id="([^"]*)"/.exec(attrs)?.[1];
    this.classList = { add() {}, remove() {} };
  }
  set innerHTML(html) {
    this.html = html;
    this.children = [...html.matchAll(/<(?:div|form|input|button|textarea|p|section)\b([^>]*)>/g)].map((m) => new Element(m[1]));
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((e) => [e, ...e.querySelectorAll(selector)]);
    return descendants.filter((e) => selector.startsWith('#') ? e.id === selector.slice(1) : e.classes.includes(selector.slice(1)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  async fire(event, props = {}) { await this.handlers[event]?.({ preventDefault() {}, ...props }); }
  focus() {} select() {}
  scrollHeight = 350;
  selectionStart = 0;
  selectionEnd = 0;
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  remove() { this.removed = true; }
  appendChild(child) { this.children.push(child); }
  insertAdjacentHTML(_, html) {
    this.children.push(...[...html.matchAll(/<button\b([^>]*)>/g)].map((m) => new Element(m[1])));
  }
}

test('global search submits separately, opens the matching note, and uses offline cache', async (t) => {
  const notes = [{ id: 21, folder_id: 2, title: 'Shopping', body: 'x'.repeat(200) + '\n<vegetables> & broccoli', updated_at: '2026-09-17T12:00:00Z' }];
  const folders = [{ id: 1, name: 'Meals', note_count: 0 }, { id: 2, name: 'Errands', note_count: 1 }];
  const modalRoot = new Element();
  const originalDocument = globalThis.document;
  const originalObserver = globalThis.MutationObserver;
  globalThis.document = { createElement: () => new Element(), getElementById: () => modalRoot, body: new Element() };
  globalThis.MutationObserver = class { observe() {} };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = originalObserver;
  });
  const cachedReads = [];
  const cached = async (path) => {
    cachedReads.push(path);
    if (path === '/api/notes/folders') return { folders };
    if (path === '/api/notes' || path === '/api/notes?folder_id=2') return { notes };
    throw new Error(`Unexpected request: ${path}`);
  };
  t.mock.method(offline, 'isOffline', () => true);
  t.mock.method(offline, 'cacheGet', cached);
  t.mock.method(offline, 'raw', () => { throw new Error('Must not access network offline'); });
  const root = new Element();
  await renderNotes(root);
  const cards = root.querySelector('.folder-grid').innerHTML;
  const form = root.querySelector('#notes-search-form');
  assert.ok(form, 'A submit-based global search form must exist');
  root.querySelector('#notes-search').value = 'broccoli';
  await form.fire('submit');
  const results = root.querySelector('#notes-search-results');
  assert.ok(results, 'Results are separate from the main list');
  assert.match(results.innerHTML, /Shopping/);
  assert.match(results.innerHTML, /Errands/);
  assert.equal(root.querySelector('.folder-grid').innerHTML, cards);
  assert.ok(cachedReads.includes('/api/notes'));
  await results.querySelector('.search-note-open').fire('click');
  const details = modalRoot.children.at(-1);
  assert.ok(details.querySelector('#note-details-body'));
  assert.ok(details.innerHTML.includes('x'.repeat(200) + '\n&lt;vegetables&gt; &amp; broccoli'));
  assert.match(details.innerHTML, /Shopping/);
  assert.match(details.innerHTML, /Errands/);
  assert.match(details.innerHTML, /Updated:/);
  assert.equal(details.querySelector('#ne-body'), null, 'Opening a note is read-only');
  await details.querySelector('#note-details-edit').fire('click');
  assert.equal(details.removed, true);
  const modal = modalRoot.children.at(-1);
  assert.equal(modal.querySelector('#ne-title').value, 'Shopping');
  assert.equal(modal.querySelector('#ne-body').value, notes[0].body);
  root.querySelector('#notes-search').value = 'missing';
  await form.fire('submit');
  assert.match(results.innerHTML, /No matching notes/);
  root.querySelector('#notes-search').value = '';
  await form.fire('submit');
  assert.equal(results.hidden, true);

  await root.querySelectorAll('.folder-open').find((btn) => btn.dataset.id === '2').fire('click');
  const entry = root.querySelector('.view-note');
  assert.ok(entry, 'Folder entries open full details');
  assert.match(entry.attrs, /role="button" tabindex="0"/);
  for (const [event, props] of [['click', {}], ['keydown', { key: 'Enter' }], ['keydown', { key: ' ' }]]) {
    await entry.fire(event, props);
    const folderDetails = modalRoot.children.at(-1);
    assert.ok(folderDetails.querySelector('#note-details-body'));
    assert.ok(folderDetails.innerHTML.includes('x'.repeat(200) + '\n&lt;vegetables&gt; &amp; broccoli'));
    await folderDetails.fire('keydown', { key: 'Escape' });
    assert.equal(folderDetails.removed, true);
  }
  await root.querySelector('.edit-note').fire('click');
  assert.ok(modalRoot.children.at(-1).querySelector('#ne-body'), 'Pencil still opens the editor');
  assert.ok(root.querySelector('.del-note'), 'Delete action is preserved');
});

test('note editor auto-grows, accepts pasted photo markers, and renders them safely', async (t) => {
  const overlay = new Element();
  const body = new Element('id="ne-body"');
  const preview = new Element('id="ne-preview"');
  const status = new Element('id="ne-status"');
  const add = new Element('id="ne-photo-add"');
  const picker = new Element('id="ne-photo-file"');
  overlay.children = [body, preview, status, add, picker];
  overlay.querySelector = (selector) => overlay.children.find((e) => selector.startsWith('#') ? e.id === selector.slice(1) : e.classes.includes(selector.slice(1))) || null;
  const originalDocument = globalThis.document;
  const originalURL = globalThis.URL;
  const originalImage = globalThis.Image;
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.URL = originalURL;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  });

  const editor = wireNoteEditor(overlay);
  autoGrowNote(body);
  assert.match(String(body.style.height), /px$/, 'Entry text grows from content height');

  const tinyFile = { type: 'image/png', size: 120 };
  globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
  globalThis.Image = class {
    naturalWidth = 1200;
    naturalHeight = 800;
    set src(value) { this.onload?.(); }
  };
  const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/' };
  globalThis.document = { createElement: (tag) => (tag === 'canvas' ? canvas : new Element()) };
  body.value = 'Before';
  body.selectionStart = body.selectionEnd = 6;
  await body.fire('paste', { clipboardData: { items: [{ kind: 'file', getAsFile: () => tinyFile }] } });
  assert.match(body.value, /!\[Photo\]\(note-photo:[^)]+\)/);
  assert.equal(status.textContent, 'Photo added. Remove its marker to delete it; save to keep your changes.');
  assert.equal(preview.hidden, false);
  assert.match(preview.innerHTML, /<img class="note-photo"/);

  editor.load(`${editor.getBody()}\n<script>alert(1)<\/script>`);
  assert.match(preview.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(preview.innerHTML, /<script>/);
  assert.match(preview.innerHTML, /<img class="note-photo"/);
  assert.match(notePlainText(editor.getBody()), /\[Photo: Photo\]/);
  assert.match(renderNoteBody(editor.getBody()), /<img class="note-photo"/);
  assert.equal(editor.getBody(), validateNoteBody(editor.getBody()));
});
