import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('servidor expõe canais, limita tentativas e conecta as duas rotas de recuperação', () => {
  assert.match(server, /passwordResetChannels:recoveryDelivery\.channels/u);
  assert.match(server, /pathname === '\/api\/password-reset\/request'/u);
  assert.match(server, /rateLimit\(req, 'password-reset-request', 5\)/u);
  assert.match(server, /pathname === '\/api\/password-reset\/confirm'/u);
  assert.match(server, /rateLimit\(req, 'password-reset-confirm', 10\)/u);
  assert.match(server, /setCookie\(res, '', 0\)/u);
  assert.match(server, /password_reset_delivery\\\.mjs/u);
});

test('service worker força atualização dos arquivos de interface alterados', () => {
  assert.match(serviceWorker, /fut-parca-shell-v23/u);
  assert.match(serviceWorker, /card\.css\?v=23/u);
});
