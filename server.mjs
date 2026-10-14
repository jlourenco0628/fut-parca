import http from 'node:http';
import { readFile, mkdir, writeFile, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { createAccountStore } from './accounts.mjs';
import { MODALITIES, getMatchScore, getRoundStats, getFantasyRanking, getSeasonRanking } from './domain.mjs';
import { serverConfig } from './server_config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const config = serverConfig();
const { port, python, reportDir, origins } = config;
const store = await createAccountStore({ path: config.dataPath || resolve(root, '../../work/fut-parca.sqlite') });
const cookieName = 'FPsession';
const cookieAge = 7 * 24 * 60 * 60;
const attempts = new Map();
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json' };

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers });
  res.end(JSON.stringify(payload));
}
function error(res, status, message, code) { json(res, status, { error:message, ...(code ? { code } : {}) }); }
function fail(status, message, code) { const cause = new Error(message); cause.status = status; cause.code = code; throw cause; }
function sessionToken(req) {
  const pair = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  return pair ? pair.slice(cookieName.length + 1) : null;
}
function setCookie(res, token, age = cookieAge) {
  res.setHeader('Set-Cookie', `${cookieName}=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${config.secureCookie ? '; Secure' : ''}`);
}
function mutationOrigin(req) {
  if (!origins.has(req.headers.origin)) fail(403, 'Origem não autorizada.', 'origin_forbidden');
}
function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return config.trustProxy && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
}
function rateLimit(req, action, maximum) {
  const now = Date.now();
  for (const [key, value] of attempts) if (now - value.start >= 60000) attempts.delete(key);
  const key = `${clientAddress(req)}:${action}`;
  const entry = attempts.get(key) || { start:now, count:0 };
  entry.count++; attempts.set(key, entry);
  if (entry.count > maximum) fail(429, 'Muitas tentativas. Aguarde um minuto e tente novamente.', 'rate_limited');
}
async function bodyJSON(req, maximum = 64 * 1024) {
  if (String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim() !== 'application/json') fail(415, 'Envie dados em JSON.', 'json_required');
  const data = await new Promise((yes, no) => {
    let bytes = 0, exceeded = false;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maximum) { if (!exceeded) { exceeded = true; const cause = new Error('Os dados excedem o tamanho permitido.'); cause.status = 413; cause.code = 'payload_too_large'; no(cause); } return; }
      if (!exceeded) chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) yes(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', no);
  });
  let payload;
  try { payload = JSON.parse(data); } catch { fail(400, 'Dados JSON inválidos.', 'invalid_json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(400, 'Envie um objeto JSON.', 'invalid_json');
  return payload;
}

function officialReport(session, roundId) {
  if (typeof roundId !== 'string' || !roundId) fail(400, 'Informe a pelada para gerar o relatório.', 'round_required');
  const { state } = session;
  const round = state.rounds.find(value => value.id === roundId);
  if (!round) fail(404, 'Pelada não encontrada.', 'round_not_found');
  if (round.status !== 'closed') fail(409, 'Feche a pelada antes de gerar o relatório oficial.', 'round_open');
  return {
    title:round.title, date:round.date, modality:MODALITIES[round.modality].label,
    revision:round.revision || 1, closedAt:round.closedAt || '', organizer:session.group.name, isClosed:true,
    matches:round.matches.map(match => {
      const score = getMatchScore(round, match.id);
      return { home:round.teams.find(team => team.id === match.homeId)?.name || 'Equipe', away:round.teams.find(team => team.id === match.awayId)?.name || 'Equipe', homeScore:score.home, awayScore:score.away, status:match.status };
    }),
    athletes:getRoundStats(state, round.id), fantasy:getFantasyRanking(state, round.id), season:getSeasonRanking(state, round.modality),
  };
}

async function report(req, res) {
  const token = sessionToken(req);
  if (config.publicOrigin && !token) fail(401, 'Entre na sua conta para gerar o PDF.', 'unauthorized');
  rateLimit(req, 'report', 20);
  const supplied = await bodyJSON(req, 1500000);
  const payload = token === null ? supplied : officialReport(await store.getState(token), supplied.roundId);
  const id = randomUUID();
  const input = resolve(reportDir, `${id}.json`), output = resolve(reportDir, `${id}.pdf`);
  await mkdir(reportDir, { recursive:true });
  await writeFile(input, JSON.stringify(payload), 'utf8');
  try {
    await new Promise((yes, no) => {
      const proc = spawn(python, [resolve(root, 'pdf_report.py'), '--input', input, '--output', output], { windowsHide:true, stdio:['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', value => { stderr = (stderr + value.toString()).slice(-12000); });
      const timeout = setTimeout(() => { proc.kill(); no(new Error('A geração do PDF excedeu o tempo limite.')); }, 30000);
      proc.on('error', () => { clearTimeout(timeout); no(new Error('Python indisponível. Configure FUT_PARCA_PYTHON.')); });
      proc.on('close', code => { clearTimeout(timeout); code === 0 ? yes() : no(new Error(stderr.trim().split('\n').at(-1) || 'Não foi possível gerar o PDF.')); });
    });
    const file = await readFile(output);
    res.writeHead(200, { 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="fut-parca-resultados.pdf"', 'Content-Length':file.length, 'Cache-Control':'no-store' });
    res.end(file);
  } catch (cause) {
    error(res, 400, cause.message);
  } finally { await Promise.allSettled([unlink(input), unlink(output)]); }
}

async function api(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) mutationOrigin(req);
  if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok:true });
  if (pathname === '/api/config' && req.method === 'GET') return json(res, 200, { public:Boolean(config.publicOrigin) });
  if (pathname === '/api/session' && req.method === 'GET') {
    const session = await store.session(sessionToken(req));
    if (!session) return error(res, 401, 'Entre na sua conta para continuar.', 'unauthorized');
    return json(res, 200, session);
  }
  if (pathname === '/api/register' && req.method === 'POST') {
    rateLimit(req, 'register', 10);
    const result = await store.register(await bodyJSON(req));
    setCookie(res, result.token); return json(res, 201, result.session);
  }
  if (pathname === '/api/login' && req.method === 'POST') {
    rateLimit(req, 'login', 20);
    const result = await store.login(await bodyJSON(req));
    setCookie(res, result.token); return json(res, 200, result.session);
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    await store.logout(sessionToken(req)); setCookie(res, '', 0); return json(res, 200, { ok:true });
  }
  if (pathname === '/api/account' && req.method === 'DELETE') {
    rateLimit(req, 'delete-account', 5);
    const result = await store.deleteAccount(sessionToken(req), await bodyJSON(req));
    setCookie(res, '', 0); return json(res, 200, result);
  }
  if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, await store.getState(sessionToken(req)));
  if (pathname === '/api/state' && req.method === 'PUT') {
    const payload = await bodyJSON(req, 10 * 1024 * 1024);
    return json(res, 200, await store.saveState(sessionToken(req), payload));
  }
  if (pathname === '/api/report' && req.method === 'POST') return report(req, res);
  return error(res, 404, 'Recurso não encontrado.');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Método não permitido.');
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const path = resolve(root, rel);
    const extension = extname(path).toLowerCase();
    if (!path.startsWith(root + sep) || !types[extension] || /(?:^|[\\/])(?:\.[^\\/]*|node_modules|tests|accounts\.mjs|server(?:_config)?\.mjs)(?:[\\/]|$)/i.test(rel)) return error(res, 404, 'Arquivo não encontrado.');
    const canonical = await realpath(path);
    if (!canonical.startsWith(root + sep)) return error(res, 404, 'Arquivo não encontrado.');
    const content = await readFile(canonical);
    res.writeHead(200, { 'Content-Type':types[extension], 'Cache-Control':'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (cause) {
    if (!res.headersSent) {
      const status = Number(cause.status) || (typeof cause.code === 'number' ? cause.code : cause.code === 'ENOENT' ? 404 : 500);
      if (status === 429) res.setHeader('Retry-After', '60');
      const message = cause.code === 'ENOENT' ? 'Arquivo não encontrado.' : status < 500 ? cause.message : 'Não foi possível abrir este recurso.';
      error(res, status >= 400 && status <= 599 ? status : 500, message, typeof cause.code === 'string' && cause.status ? cause.code : undefined);
    } else res.end();
  }
});
server.on('error', cause => { console.error(`Não foi possível iniciar o Fut Parça: ${cause.message}`); process.exitCode = 1; });
server.listen(port, config.host, () => console.log(`Fut Parça disponível em ${config.publicOrigin || `http://127.0.0.1:${port}`}`));
