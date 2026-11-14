import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../card.css', import.meta.url), 'utf8');

test('atributos separam número da sigla e escudo da pelada recebe mais destaque', () => {
  assert.match(css, /\.athlete-card__stat[^\{]*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*2\.05ch minmax\(0,1fr\);[^}]*gap:\s*1\.7cqw;/su);
  assert.match(css, /\.athlete-card__stats[^\{]*\{[^}]*left:\s*20%;[^}]*right:\s*20%;/su);
  assert.match(css, /\.athlete-card__name span[^\{]*\{[^}]*padding:\s*0 \.4cqw 1\.1cqw;[^}]*line-height:\s*1\.05;/su);
  assert.match(css, /\.athlete-card__crest[^\{]*\{[^}]*width:\s*22cqw;[^}]*height:\s*22cqw;/su);
  assert.match(css, /\.athlete-card__crest--cutout \.athlete-card__crest-image[^\{]*\{[^}]*scale\(1\.22\)/su);
});
