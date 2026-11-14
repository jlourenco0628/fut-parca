import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../card.css', import.meta.url), 'utf8');

test('atributos separam número da sigla e escudo da pelada recebe mais destaque', () => {
  assert.match(css, /\.athlete-card__stat[^\{]*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*2\.25ch max-content;[^}]*column-gap:\s*2\.4cqw;/su);
  assert.match(css, /\.athlete-card__stats[^\{]*\{[^}]*top:\s*68\.2%;[^}]*left:\s*24%;[^}]*right:\s*24%;[^}]*height:\s*16\.2%;/su);
  assert.match(css, /\.athlete-card__stat[^\{]*\{[^}]*justify-content:\s*center;[^}]*overflow:\s*visible;/su);
  assert.match(css, /\.athlete-card__name span[^\{]*\{[^}]*padding:\s*0 \.4cqw 1\.1cqw;[^}]*line-height:\s*1\.05;/su);
  assert.match(css, /\.athlete-card__crest[^\{]*\{[^}]*width:\s*22cqw;[^}]*height:\s*22cqw;/su);
  assert.match(css, /\.athlete-card__crest--cutout \.athlete-card__crest-image[^\{]*\{[^}]*scale\(1\.22\)/su);
});
