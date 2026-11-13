import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('login oferece recuperação por código com formulários acessíveis', () => {
  assert.match(appSource, /Esqueci minha senha/);
  assert.match(appSource, /id="password-reset-request-form"/);
  assert.match(appSource, /role="radiogroup"/);
  assert.match(appSource, /type="email" class="input" id="recovery-identifier"/);
  assert.match(appSource, /channelCopy=\{email:/);
  assert.match(appSource, /,sms:/);
  assert.match(appSource, /autocomplete="one-time-code"/);
  assert.match(appSource, /pattern="\[0-9\]\{6\}"/);
  assert.match(appSource, /id="password-reset-confirm-form"/);
});

test('interface respeita canais configurados e mantém resposta sem enumeração', () => {
  assert.match(appSource, /config\.passwordResetChannels/);
  assert.match(appSource, /passwordResetChannels\.filter/);
  assert.match(appSource, /a resposta será a mesma mesmo quando a conta não for encontrada/);
  assert.match(appSource, /accounts\.requestPasswordReset\(\{identifier,channel:data\.channel\}\)/);
  assert.match(appSource, /accounts\.resetPassword\(\{requestId:data\.requestId,code:data\.code\.trim\(\),password:data\.password\}\)/);
});
