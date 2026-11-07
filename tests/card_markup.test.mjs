import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAthleteCard } from '../card.mjs';

const linePlayer = {
  athlete: { id: 'athlete-1', name: 'João Lourenço', nickname: 'Lourenço' },
  skills: { overall: 76, rit: 81, fin: 72, pas: 78, con: 79, def: 66, fis: 74 },
};

test('card renderiza seis atributos profissionais sem ornamento inferior', () => {
  const html = renderAthleteCard(linePlayer);
  assert.match(html, /athlete-card__name/);
  assert.match(html, /athlete-card__stats/);
  assert.equal((html.match(/class="athlete-card__stat"/g) || []).length, 6);
  for (const label of ['RIT', 'FIN', 'PAS', 'CON', 'DEF', 'FIS']) assert.match(html, new RegExp(`>${label}<`));
  assert.doesNotMatch(html, /athlete-card__footer/);
});

test('goleiro recebe as seis notas específicas da posição', () => {
  const html = renderAthleteCard({
    athlete: { id: 'keeper', nickname: 'Muralha' },
    position: 'Goleiro',
    skills: { overall: 82, div: 84, han: 79, kic: 75, ref: 88, spd: 64, pos: 83 },
  });
  for (const label of ['DEF', 'SEG', 'REP', 'REF', 'VEL', 'POS']) assert.match(html, new RegExp(`>${label}<`));
});

test('escudo da pelada substitui a marca do app e pede recorte transparente', () => {
  const logo = 'data:image/png;base64,AA==';
  const html = renderAthleteCard({ ...linePlayer, club: { name: 'Pelada do Bastos', logo } });
  assert.match(html, /athlete-card__crest--group/);
  assert.match(html, /data-fp-logo-cutout/);
  assert.match(html, /Escudo de Pelada do Bastos/);
  assert.match(html, /src="data:image\/png;base64,AA=="/);
  assert.doesNotMatch(html, /athlete-card__crest--fallback/);
});

test('marca Fut Parça aparece somente sem escudo válido da pelada', () => {
  const fallback = renderAthleteCard(linePlayer);
  assert.match(fallback, /athlete-card__crest--fallback/);
  assert.doesNotMatch(fallback, /data-fp-logo-cutout/);

  const unsafe = renderAthleteCard({ ...linePlayer, club: { name: 'Teste', logo: 'javascript:alert(1)' } });
  assert.match(unsafe, /athlete-card__crest--fallback/);
  assert.doesNotMatch(unsafe, /javascript:/);
});

test('card possui camadas independentes para efeito 3D integral', () => {
  const html = renderAthleteCard(linePlayer);
  for (const layer of ['background', 'texture', 'sheen', 'upper', 'crest', 'photo', 'name', 'stats']) {
    assert.match(html, new RegExp(`athlete-card__${layer}`));
  }
});

test('cada instância gera ids SVG únicos', () => {
  const first = renderAthleteCard(linePlayer);
  const second = renderAthleteCard(linePlayer);
  const firstId = first.match(/<linearGradient id="([^"]+)"/)?.[1];
  const secondId = second.match(/<linearGradient id="([^"]+)"/)?.[1];
  assert.ok(firstId);
  assert.ok(secondId);
  assert.notEqual(firstId, secondId);
});

test('variante, nota e nome longo permanecem controlados', () => {
  const html = renderAthleteCard({
    athlete: { id: 'long', nickname: 'Nome Muito Comprido do Atleta' },
    skills: { overall: 140, rit: -20, fin: 71, pas: 72, con: 73, def: 74, fis: 75 },
    variant: 'special',
  });
  assert.match(html, /athlete-card--special/);
  assert.match(html, /athlete-card__name--long/);
  assert.match(html, /athlete-card__overall">99</);
  assert.match(html, /data-stat="rit"><strong>1</);
});
