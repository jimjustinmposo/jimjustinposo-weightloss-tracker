import test from 'node:test';
import { localExtract } from '../src/telegram/textparse.js';

test('dbg sequence', () => {
  console.log('S1:', JSON.stringify(localExtract('300g chicken breast, 4 eggs and 20g salted butter')));
  console.log('S2:', JSON.stringify(localExtract('I ate some chicken')));
  console.log('S3:', JSON.stringify(localExtract('had 2 slices of bread')));
  console.log('S4:', JSON.stringify(localExtract('had 2 slices of bread')));
});
