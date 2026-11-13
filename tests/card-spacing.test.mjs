import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../card.css', import.meta.url), 'utf8');

test('atributos separam número da sigla e escudo da pelada recebe mais destaque', () => {
  assert.match(css, /\.athlete-card__stat[^\{]*\{[^}]*display:\s*flex;[^}]*gap:\s*1\.9cqw;/su);
  assert.match(css, /\.athlete-card__crest[^\{]*\{[^}]*width:\s*18cqw;[^}]*height:\s*18cqw;/su);
});
