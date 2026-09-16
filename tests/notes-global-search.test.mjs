import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../public/js/api.js';
import offline from '../public/js/offline.js';
import { renderNotes } from '../public/js/notes.js';

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
  async fire(event) { await this.handlers[event]?.({ preventDefault() {} }); }
  focus() {} select() {} remove() {}
  appendChild(child) { this.children.push(child); }
  insertAdjacentHTML(_, html) {
    this.children.push(...[...html.matchAll(/<button\b([^>]*)>/g)].map((m) => new Element(m[1])));
  }
}

test('global search submits separately, opens the matching note, and uses offline cache', async (t) => {
  const notes = [{ id: 21, folder_id: 2, title: 'Shopping', body: 'x'.repeat(200) + ' broccoli' }];
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
    if (path === '/api/notes') return { notes };
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
  const modal = modalRoot.children.at(-1);
  assert.equal(modal.querySelector('#ne-title').value, 'Shopping');
  assert.equal(modal.querySelector('#ne-body').value, notes[0].body);
  root.querySelector('#notes-search').value = 'missing';
  await form.fire('submit');
  assert.match(results.innerHTML, /No matching notes/);
  root.querySelector('#notes-search').value = '';
  await form.fire('submit');
  assert.equal(results.hidden, true);
});
