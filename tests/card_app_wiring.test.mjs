import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('todos os cards recebem o escudo da pelada conectada', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /currentClub=.*group\.logo/);
  assert.ok((app.match(/club:currentClub\(\)/g) || []).length >= 2);
  assert.match(app, /enableAutomaticLogoCutouts\(document\)/);
  assert.match(app, /resizeGroupLogo\(target\.files\[0\]\)/);
});
