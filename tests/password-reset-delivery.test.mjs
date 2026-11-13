import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordResetDelivery } from '../password_reset_delivery.mjs';

const ok = () => ({ ok:true, status:202 });

test('ativa somente os canais que têm todas as credenciais necessárias', () => {
  assert.deepEqual(createPasswordResetDelivery({}, { fetchImpl:async () => ok() }).channels, []);
  assert.deepEqual(createPasswordResetDelivery({ RESEND_API_KEY:'re_test', FUT_PARCA_EMAIL_FROM:'Fut Parça <contato@example.com>' }, { fetchImpl:async () => ok() }).channels, ['email']);
  assert.deepEqual(createPasswordResetDelivery({
    TWILIO_ACCOUNT_SID:'AC123', TWILIO_API_KEY:'SK123', TWILIO_API_SECRET:'secret', TWILIO_MESSAGING_SERVICE_SID:'MG123',
  }, { fetchImpl:async () => ok() }).channels, ['sms']);
});

test('envia e-mail pelo Resend com código e conteúdo esperados', async () => {
  const calls = [];
  const delivery = createPasswordResetDelivery({
    RESEND_API_KEY:'re_secret_fixture', FUT_PARCA_EMAIL_FROM:'Fut Parça <contato@example.com>',
  }, { fetchImpl:async (url, options) => { calls.push({ url, options }); return ok(); } });

  await delivery.send({ channel:'email', destination:'atleta@example.com', code:'135790', expiresMinutes:10, name:'João <Teste>' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, 'Bearer re_secret_fixture');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.to, ['atleta@example.com']);
  assert.match(body.subject, /redefinir sua senha/u);
  assert.match(body.text, /135790/u);
  assert.match(body.html, /João/u);
  assert.doesNotMatch(body.html, /<Teste>/u);
});

test('envia SMS pelo Twilio com autenticação Basic e Messaging Service', async () => {
  const calls = [];
  const delivery = createPasswordResetDelivery({
    TWILIO_ACCOUNT_SID:'ACfixture', TWILIO_API_KEY:'SKfixture', TWILIO_API_SECRET:'fixture-secret', TWILIO_MESSAGING_SERVICE_SID:'MGfixture',
  }, { fetchImpl:async (url, options) => { calls.push({ url, options }); return ok(); } });

  await delivery.send({ channel:'sms', destination:'+5585999990000', code:'246802', expiresMinutes:10 });
  assert.equal(calls[0].url, 'https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json');
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from('SKfixture:fixture-secret').toString('base64')}`);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('To'), '+5585999990000');
  assert.equal(body.get('MessagingServiceSid'), 'MGfixture');
  assert.equal(body.get('From'), null);
  assert.match(body.get('Body'), /246802/u);
});

test('falha do provedor produz erro genérico sem vazar resposta ou credencial', async () => {
  const delivery = createPasswordResetDelivery({
    RESEND_API_KEY:'segredo-que-nao-pode-vazar', FUT_PARCA_EMAIL_FROM:'contato@example.com',
  }, { fetchImpl:async () => ({ ok:false, status:401, text:async () => 'provider-secret-detail' }) });
  await assert.rejects(
    delivery.send({ channel:'email', destination:'atleta@example.com', code:'123456' }),
    cause => cause.status === 502 && cause.code === 'password_reset_delivery_failed' && !cause.message.includes('segredo') && !cause.message.includes('provider-secret-detail'),
  );
});
