import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../card.css', import.meta.url), 'utf8');

test('atributos separam número da sigla e escudo da pelada recebe mais destaque', () => {
  assert.match(css, /\.athlete-card__stat[^\{]*\{[^}]*display:\s*flex;[^}]*gap:\s*3\.1cqw;/su);
  assert.match(css, /\.athlete-card__stat strong[^\{]*\{[^}]*flex:\s*0 0 2\.05ch;[^}]*min-width:\s*2\.05ch;/su);
  assert.match(css, /\.athlete-card__crest[^\{]*\{[^}]*width:\s*22cqw;[^}]*height:\s*22cqw;/su);
  assert.match(css, /\.athlete-card__crest--cutout \.athlete-card__crest-image[^\{]*\{[^}]*scale\(1\.22\)/su);
});
