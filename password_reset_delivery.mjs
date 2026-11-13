const DELIVERY_TIMEOUT_MS = 8000;

function deliveryError() {
  const cause = new Error('Não foi possível enviar o código de recuperação.');
  cause.status = 502;
  cause.code = 'password_reset_delivery_failed';
  return cause;
}

function html(value) {
  return String(value || '').replace(/[&<>"']/gu, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[character]);
}

async function sendRequest(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal:AbortSignal.timeout(DELIVERY_TIMEOUT_MS) });
  } catch {
    throw deliveryError();
  }
  if (!response?.ok) throw deliveryError();
}

export function createPasswordResetDelivery(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const resendKey = String(env.RESEND_API_KEY || '').trim();
  const emailFrom = String(env.FUT_PARCA_EMAIL_FROM || '').trim();
  const twilioAccountSid = String(env.TWILIO_ACCOUNT_SID || '').trim();
  const twilioApiKey = String(env.TWILIO_API_KEY || '').trim();
  const twilioApiSecret = String(env.TWILIO_API_SECRET || '').trim();
  const twilioMessagingServiceSid = String(env.TWILIO_MESSAGING_SERVICE_SID || '').trim();
  const twilioFromNumber = String(env.TWILIO_FROM_NUMBER || '').trim();
  const channels = [];
  if (resendKey && emailFrom) channels.push('email');
  if (twilioAccountSid && twilioApiKey && twilioApiSecret && (twilioMessagingServiceSid || twilioFromNumber)) channels.push('sms');

  return {
    channels,
    minimumResponseMs:600,
    reportError() { console.error('Falha ao enviar um código de recuperação de senha.'); },
    async send({ channel, destination, code, expiresMinutes = 10, name = '' } = {}) {
      if (!channels.includes(channel) || typeof destination !== 'string' || !/^\d{6}$/u.test(String(code || ''))) throw deliveryError();
      const firstName = String(name || '').trim().split(/\s+/u)[0] || 'parça';
      const message = `Seu código Fut Parça é ${code}. Ele expira em ${expiresMinutes} minutos. Se você não pediu a troca de senha, ignore esta mensagem.`;

      if (channel === 'email') {
        await sendRequest(fetchImpl, 'https://api.resend.com/emails', {
          method:'POST',
          headers:{ authorization:`Bearer ${resendKey}`, 'content-type':'application/json' },
          body:JSON.stringify({
            from:emailFrom,
            to:[destination],
            subject:'Código para redefinir sua senha — Fut Parça',
            text:`Olá, ${firstName}!\n\n${message}`,
            html:`<p>Olá, ${html(firstName)}!</p><p>Use o código abaixo para redefinir sua senha no Fut Parça:</p><p style="font-size:28px;font-weight:800;letter-spacing:6px">${html(code)}</p><p>Ele expira em ${Number(expiresMinutes)} minutos.</p><p>Se você não pediu a troca de senha, ignore este e-mail.</p>`,
          }),
        });
        return;
      }

      const body = new URLSearchParams({ To:destination, Body:message });
      if (twilioMessagingServiceSid) body.set('MessagingServiceSid', twilioMessagingServiceSid);
      else body.set('From', twilioFromNumber);
      await sendRequest(fetchImpl, `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}/Messages.json`, {
        method:'POST',
        headers:{
          authorization:`Basic ${Buffer.from(`${twilioApiKey}:${twilioApiSecret}`).toString('base64')}`,
          'content-type':'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body:body.toString(),
      });
    },
  };
}
