import { isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export function serverConfig(env = process.env, platform = process.platform) {
  const port = Number(env.PORT || env.FUT_PARCA_PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT/FUT_PARCA_PORT inválida.');

  const rawOrigin = String(env.FUT_PARCA_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || '').trim();
  let publicOrigin = '';
  if (rawOrigin) {
    let parsed;
    try { parsed = new URL(rawOrigin); } catch { throw new Error('FUT_PARCA_PUBLIC_ORIGIN inválida.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || rawOrigin.replace(/\/$/, '') !== parsed.origin) {
      throw new Error('FUT_PARCA_PUBLIC_ORIGIN deve ser a origem HTTPS exata, sem caminho.');
    }
    publicOrigin = parsed.origin;
  }

  const dataPath = env.FUT_PARCA_DATA_PATH || '';
  if (publicOrigin && (!dataPath || !isAbsolute(dataPath))) throw new Error('Configure FUT_PARCA_DATA_PATH com um caminho absoluto em armazenamento persistente.');

  return {
    port,
    host: env.FUT_PARCA_HOST || (publicOrigin ? '0.0.0.0' : '127.0.0.1'),
    publicOrigin,
    secureCookie: Boolean(publicOrigin),
    trustProxy: env.FUT_PARCA_TRUST_PROXY === '1',
    dataPath: dataPath || null,
    python: env.FUT_PARCA_PYTHON || (platform === 'win32' ? 'python' : 'python3'),
    reportDir: env.FUT_PARCA_REPORT_DIR || resolve(tmpdir(), 'fut-parca-reports'),
    origins: new Set(publicOrigin ? [publicOrigin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
  };
}
