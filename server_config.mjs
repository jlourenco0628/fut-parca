import { isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export function serverConfig(env = process.env, platform = process.platform) {
  const port = Number(env.PORT || env.FUT_PARCA_PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT/FUT_PARCA_PORT inválida.');

  const vercelOrigin = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${String(env.VERCEL_PROJECT_PRODUCTION_URL).replace(/^https?:\/\//, '').replace(/\/$/, '')}` : '';
  const rawOrigin = String(env.FUT_PARCA_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || vercelOrigin).trim();
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
  const databaseUrl = String(env.DATABASE_URL || env.SUPABASE_DB_URL || '').trim();
  const supabase = {
    url: String(env.SUPABASE_URL || '').trim(),
    key: String(env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
    secret: String(env.FUT_PARCA_DB_SECRET || '').trim(),
  };
  const hasSupabase = Object.values(supabase).every(Boolean);
  if (Object.values(supabase).some(Boolean) && !hasSupabase) throw new Error('Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e FUT_PARCA_DB_SECRET juntas.');
  if (publicOrigin && !databaseUrl && !hasSupabase && (!dataPath || !isAbsolute(dataPath))) throw new Error('Configure Supabase, DATABASE_URL ou FUT_PARCA_DATA_PATH com armazenamento persistente.');

  return {
    port,
    host: env.FUT_PARCA_HOST || (publicOrigin ? '0.0.0.0' : '127.0.0.1'),
    publicOrigin,
    secureCookie: Boolean(publicOrigin),
    trustProxy: env.FUT_PARCA_TRUST_PROXY === '1',
    dataPath: dataPath || null,
    databaseUrl: databaseUrl || null,
    supabase: hasSupabase ? supabase : null,
    python: env.FUT_PARCA_PYTHON || (platform === 'win32' ? 'python' : 'python3'),
    reportDir: env.FUT_PARCA_REPORT_DIR || resolve(tmpdir(), 'fut-parca-reports'),
    origins: new Set(publicOrigin ? [publicOrigin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`]),
  };
}
