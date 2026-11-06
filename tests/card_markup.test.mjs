import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAthleteCard } from '../card.mjs';

test('card mantém nome e atributos sem ornamento inferior desalinhado', () => {
  const html = renderAthleteCard({
    athlete: { id: 'athlete-1', name: 'Lourenço', nickname: 'Lourenço' },
    skills: { overall: 60, rit: 60, fin: 60, pas: 60, con: 60, def: 60, fis: 60 },
  });
  assert.match(html, /athlete-card__name/);
  assert.match(html, /athlete-card__stats/);
  assert.doesNotMatch(html, /athlete-card__footer/);
});
