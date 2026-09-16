import test from 'node:test';
import assert from 'node:assert/strict';
import { searchNotes } from '../public/js/notes.js';

const folders = [{ id: 1, name: 'Meals' }, { id: -2, name: 'Errands' }];
const notes = [
  { id: 1, folder_id: 1, title: 'Meal Prep', body: 'Cook chicken' },
  { id: -2, folder_id: -2, title: 'Shopping [weekly]', body: 'x'.repeat(200) + ' BROCCOLI' },
  { id: 3, folder_id: 1, title: null, body: null },
];

test('global search matches entry title or full text across main titles', () => {
  assert.deepEqual(searchNotes(notes, folders, '  meal PREP  ').map((n) => n.id), [1]);
  const hits = searchNotes(notes, folders, 'broccoli');
  assert.deepEqual(hits.map((n) => n.id), [-2]);
  assert.equal(hits[0].folder_name, 'Errands');
  assert.equal(hits[0].body, notes[1].body);
  assert.equal(notes[1].folder_name, undefined);
});

test('search treats special characters literally and handles no matches', () => {
  assert.deepEqual(searchNotes(notes, folders, '[WEEKLY]').map((n) => n.id), [-2]);
  assert.deepEqual(searchNotes(notes, folders, 'missing'), []);
});

test('blank searches and empty collections return no results', () => {
  assert.deepEqual(searchNotes(notes, folders, '   '), []);
  assert.deepEqual(searchNotes([], folders, 'anything'), []);
  assert.deepEqual(searchNotes(null, null, 'anything'), []);
});

