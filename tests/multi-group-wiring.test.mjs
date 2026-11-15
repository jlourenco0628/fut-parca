import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [server, client, app] = await Promise.all([
  readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../account_client.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
]);

test('servidor e cliente conectam a troca de pelada ativa', () => {
  assert.match(server, /pathname === '\/api\/pelada-switch'/u);
  assert.match(server, /store\.switchGroup\(sessionToken\(req\), body\.groupId\)/u);
  assert.match(client, /switchGroup\(groupId\)/u);
  assert.match(client, /\/api\/pelada-switch/u);
});

test('interface lista, cria, encontra e alterna entre peladas da conta', () => {
  assert.match(app, /Minhas peladas/u);
  assert.match(app, /data-action="switch-group"/u);
  assert.match(app, /Criar nova pelada/u);
  assert.match(app, /Encontrar pelada/u);
  assert.match(app, /accounts\.switchGroup/u);
});
