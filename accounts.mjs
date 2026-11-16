import { randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { MODALITIES, EVENT_RULES, beginRound, closeRound, saveFantasy } from './domain.mjs';

const scrypt = promisify(scryptCallback);
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_LIFETIME = 10 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_RESEND_DELAY = 60 * 1000;
const ATTRIBUTE_KEYS = ['rit', 'fin', 'pas', 'con', 'def', 'fis', 'div', 'han', 'kic', 'ref', 'spd', 'pos'];
const PERSONAL_FIELDS = new Set(['name', 'nickname', 'contact', 'photo', 'photoFit', 'avatar', 'sex', 'birthDate', 'preferences']);
const EVENT_TYPES = new Map(EVENT_RULES.map(rule => [rule.type, rule]));
const copy = value => structuredClone(value);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const normalizedGroupName = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pt-BR');
let postgresPool;

function error(message, status = 400) {
  const result = new Error(message);
  result.status = status;
  result.code = status;
  throw result;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) error(`${label} inválido.`);
}

function text(value, label, maximum = 80, minimum = 1) {
  if (typeof value !== 'string' || value.length > maximum || value.trim().length < minimum || /[\u0000-\u001f]/u.test(value)) error(`${label} inválido.`);
  return value.trim();
}

function identifier(value, label = 'Identificador') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) error(`${label} inválido.`);
  return value;
}

function list(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) error(`${label} inválido ou acima do limite.`);
}

function emailOf(value) {
  const email = text(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) error('Informe um e-mail válido.');
  return email;
}

function passwordOf(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) error('A senha precisa ter entre 8 e 128 caracteres.');
  return value;
}

function normalizedPhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/gu, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return '';
}

function uniqueId(seen, value, label) {
  identifier(value, label);
  if (seen.has(value)) error(`${label} repetido.`);
  seen.add(value);
}

function newAthlete(name, email, profile = {}) {
  return {
    id: `athlete-${randomUUID()}`, name, nickname: String(profile.nickname || name.split(/\s+/u)[0]).slice(0, 18), contact: String(profile.contact || email), photo: String(profile.photo || ''), photoFit: { x: 0, y: 0, zoom: 100 },
    avatar: ['avatar-1','avatar-2','avatar-3','avatar-4'].includes(profile.avatar) ? profile.avatar : 'avatar-1',
    sex: ['masculino','feminino','nao-binario','prefiro-nao-informar'].includes(profile.sex) ? profile.sex : 'prefiro-nao-informar',
    birthDate: typeof profile.birthDate === 'string' ? profile.birthDate : '',
    preferences: profile.preferences || { futebol: { primary: 'Meia', secondary: '' }, futsal: { primary: 'Ala', secondary: '' }, society: { primary: 'Meio-campista', secondary: '' } },
    baseSkills: Object.fromEntries(Object.keys(MODALITIES).map(modality => [modality, Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, 60]))])),
  };
}

function validatePhoto(photo) {
  if (typeof photo !== 'string' || Buffer.byteLength(photo, 'utf8') > 2 * 1024 * 1024) error('A foto deve ter no máximo 2 MB.');
  if (!photo) return;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match) error('Envie uma foto JPG, PNG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) error('Foto inválida.');
  const valid = match[1] === 'jpeg' ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) error('O conteúdo da foto não corresponde ao formato informado.');
}

function membershipsOf(user) {
  const source = Array.isArray(user?.memberships) ? user.memberships : [];
  const memberships = [];
  for (const item of source) {
    if (!item || typeof item.groupId !== 'string' || !['organizer', 'member'].includes(item.role) || memberships.some(value => value.groupId === item.groupId)) continue;
    memberships.push({ groupId:item.groupId, role:item.role });
  }
  if (user?.groupId && !memberships.some(item => item.groupId === user.groupId)) memberships.push({ groupId:user.groupId, role:user.role === 'organizer' ? 'organizer' : 'member' });
  return memberships;
}

function membershipRole(user, groupId) {
  return membershipsOf(user).find(item => item.groupId === groupId)?.role || null;
}

function setMemoryMembership(user, groupId, role, makeActive = true) {
  const memberships = membershipsOf(user), current = memberships.find(item => item.groupId === groupId);
  if (current) current.role = role; else memberships.push({ groupId, role });
  user.memberships = memberships;
  if (makeActive) { user.groupId = groupId; user.role = role; }
}

function setMemoryMembershipRole(user, groupId, role) {
  setMemoryMembership(user, groupId, role, user.groupId === groupId);
}

function setMemoryActiveGroup(user, groupId) {
  const membership = membershipsOf(user).find(item => item.groupId === groupId);
  if (!membership) error('Você não faz parte desta pelada.', 403);
  user.memberships = membershipsOf(user); user.groupId = groupId; user.role = membership.role;
}

function removeMemoryMembership(user, groupId) {
  user.memberships = membershipsOf(user).filter(item => item.groupId !== groupId);
  if (user.groupId === groupId) {
    const next = user.memberships[0];
    if (next) { user.groupId = next.groupId; user.role = next.role; }
  }
}

function personalProfileOf(athlete) {
  return Object.fromEntries([...PERSONAL_FIELDS].filter(field => Object.hasOwn(athlete || {}, field)).map(field => [field, copy(athlete[field])]));
}

function applyPersonalProfile(target, source) {
  for (const field of PERSONAL_FIELDS) {
    if (Object.hasOwn(source, field)) target[field] = copy(source[field]);
    else delete target[field];
  }
}

function publicSession(user, group, availableGroups = []) {
  const role = membershipRole(user, group.id) || (user.role === 'organizer' ? 'organizer' : 'member');
  return {
    user: { id: user.id, name: user.name, email: user.email },
    group: { id: group.id, name: group.name, role, profileOnly: Boolean(group.state.profileOnly), logo: group.state.logo || '', scheduleType: group.state.scheduleType || 'recurring', weeklyDay: group.state.weeklyDay || '', weeklyTime: group.state.weeklyTime || '', singleDate: group.state.singleDate || '', singleTime: group.state.singleTime || '', ...(role === 'organizer' ? { inviteCode: group.inviteCode } : {}) },
    groups: availableGroups.map(({ group:item, role:itemRole }) => ({ id:item.id, name:item.name, role:itemRole, profileOnly:Boolean(item.state.profileOnly), logo:item.state.logo || '', ...(itemRole === 'organizer' ? { inviteCode:item.inviteCode } : {}) })),
    athleteId: user.athleteId, revision: group.revision, state: copy(group.state),
  };
}

function normalizeRepositoryData(value) {
  const data = value && typeof value === 'object' ? value : {};
  const groups = Array.isArray(data.groups) ? data.groups : [], groupIds = new Set(groups.map(group => group.id));
  const users = (Array.isArray(data.users) ? data.users : []).map(source => {
    const user = { ...source }, memberships = membershipsOf(user).filter(item => groupIds.has(item.groupId));
    if (!memberships.length && user.groupId && groupIds.has(user.groupId)) memberships.push({ groupId:user.groupId, role:user.role === 'organizer' ? 'organizer' : 'member' });
    const active = memberships.find(item => item.groupId === user.groupId) || memberships[0];
    return { ...user, memberships, ...(active ? { groupId:active.groupId, role:active.role } : {}) };
  });
  return {
    version: 4,
    users,
    groups,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    joinRequests: Array.isArray(data.joinRequests) ? data.joinRequests : [],
    passwordResets: Array.isArray(data.passwordResets) ? data.passwordResets : [],
  };
}

async function supabaseRpc(url, key, name, input) {
  const response = await fetch(`${url.replace(/\/$/u, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const cause = new Error(response.status === 403 ? 'Conexão do banco não autorizada.' : 'Não foi possível acessar o banco compartilhado.');
    cause.status = 502;
    cause.code = detail.code || 'supabase_rpc_failed';
    throw cause;
  }
  return response.json();
}

async function openSupabaseRepository({ url, key, secret }) {
  const readSnapshot = async () => {
    const snapshot = await supabaseRpc(url, key, 'fut_parca_read', { p_secret: secret });
    return { data: normalizeRepositoryData(snapshot?.data), revision: Number(snapshot?.revision || 0) };
  };
  let snapshot = await readSnapshot(), data = snapshot.data;
  const read = fn => fn();
  const repository = {
    kind: 'supabase', path: 'private.fut_parca_store',
    async transaction(fn) {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) snapshot = await readSnapshot();
        data = normalizeRepositoryData(snapshot.data);
        const previous = copy(data);
        let result;
        try { result = fn(); } catch (cause) { data = previous; throw cause; }
        const committed = await supabaseRpc(url, key, 'fut_parca_compare_and_swap', {
          p_secret: secret,
          p_expected_revision: snapshot.revision,
          p_next: data,
        });
        if (committed === true) { snapshot = { data: copy(data), revision: snapshot.revision + 1 }; return result; }
      }
      error('Os dados foram atualizados ao mesmo tempo em outro aparelho. Tente novamente.', 409);
    },
    userByEmail: email => read(() => data.users.find(user => user.email === email)), userById: id => read(() => data.users.find(user => user.id === id)),
    usersForGroup: id => read(() => data.users.filter(user => membershipsOf(user).some(item => item.groupId === id))), groupById: id => read(() => data.groups.find(group => group.id === id)),
    groupByInvite: code => read(() => data.groups.find(group => group.inviteCode === code)), insertGroup: group => data.groups.push(copy(group)),
    allGroups: () => read(() => data.groups.map(copy)),
    updateGroup(group) { data.groups[data.groups.findIndex(item => item.id === group.id)] = copy(group); },
    deleteGroup(id) { data.groups = data.groups.filter(group => group.id !== id); },
    insertUser: user => data.users.push(copy(user)),
    updateUserRole(id, groupId, role) { const user = data.users.find(item => item.id === id); if (user) setMemoryMembershipRole(user, groupId, role); },
    updateUserMembership(id, groupId, role, makeActive = true) { const user = data.users.find(item => item.id === id); if (user) setMemoryMembership(user, groupId, role, makeActive); },
    setActiveGroup(id, groupId) { const user = data.users.find(item => item.id === id); if (user) setMemoryActiveGroup(user, groupId); },
    removeUserMembership(id, groupId) { const user = data.users.find(item => item.id === id); if (user) removeMemoryMembership(user, groupId); },
    updateUserName(id, name) { const user = data.users.find(item => item.id === id); if (user) user.name = name; },
    updateUserPassword(id, salt, hash) { const user = data.users.find(item => item.id === id); if (user) { user.salt = salt; user.hash = hash; } },
    requestByUserGroup: (userId, groupId) => read(() => data.joinRequests.find(item => item.userId === userId && item.groupId === groupId)),
    requestsForGroup: groupId => read(() => data.joinRequests.filter(item => item.groupId === groupId)),
    requestById: id => read(() => data.joinRequests.find(item => item.id === id)),
    insertRequest: request => data.joinRequests.push(copy(request)),
    updateRequest(id, status) { const item = data.joinRequests.find(request => request.id === id); if (item) item.status = status; },
    deleteRequestsForUser(userId) { data.joinRequests = data.joinRequests.filter(request => request.userId !== userId); },
    deleteRequestsForGroup(groupId) { data.joinRequests = data.joinRequests.filter(request => request.groupId !== groupId); },
    deleteUser(id) { data.users = data.users.filter(user => user.id !== id); },
    sessionByHash: hash => read(() => data.sessions.find(session => session.hash === hash)),
    insertSession(hash, userId, expiresAt) { data.sessions = data.sessions.filter(session => session.expiresAt > Date.now()); data.sessions.push({ hash, userId, expiresAt }); },
    deleteSession(hash) { data.sessions = data.sessions.filter(session => session.hash !== hash); },
    deleteSessionsForUser(userId) { data.sessions = data.sessions.filter(session => session.userId !== userId); },
    passwordResetById: id => read(() => data.passwordResets.find(reset => reset.id === id)),
    latestPasswordResetForUser: (userId, channel) => read(() => data.passwordResets.filter(reset => reset.userId === userId && reset.channel === channel).sort((a, b) => b.createdAt - a.createdAt)[0]),
    insertPasswordReset(reset) { data.passwordResets = data.passwordResets.filter(item => item.userId !== reset.userId || item.channel !== reset.channel); data.passwordResets.push(copy(reset)); },
    insertPasswordResetAlias(reset) { data.passwordResets = data.passwordResets.filter(item => item.id !== reset.id); data.passwordResets.push(copy(reset)); },
    incrementPasswordResetChallengeAttempts(userId, channel, codeHash) { for (const reset of data.passwordResets) if (reset.userId === userId && reset.channel === channel && reset.codeHash === codeHash) reset.attempts++; },
    deletePasswordReset(id) { data.passwordResets = data.passwordResets.filter(reset => reset.id !== id); },
    deletePasswordResetChallenge(userId, channel, codeHash) { data.passwordResets = data.passwordResets.filter(reset => reset.userId !== userId || reset.channel !== channel || reset.codeHash !== codeHash); },
    deletePasswordResetsForUser(userId) { data.passwordResets = data.passwordResets.filter(reset => reset.userId !== userId); },
    deleteExpiredPasswordResets(now) { data.passwordResets = data.passwordResets.filter(reset => reset.expiresAt > now && reset.attempts < PASSWORD_RESET_MAX_ATTEMPTS); },
    storageStatus() { return { backend: 'supabase', table: 'private.fut_parca_store', compareAndSwap: true }; },
    close() {},
  };
  return repository;
}

async function openPostgresRepository(databaseUrl) {
  const { Pool } = await import('pg');
  postgresPool ||= new Pool({ connectionString: databaseUrl, max: 4, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000 });
  const initial = await postgresPool.query("SELECT data FROM private.fut_parca_store WHERE id='main'");
  if (!initial.rowCount) throw new Error('Banco do Fut Parça ainda não foi inicializado.');
  let data = normalizeRepositoryData(initial.rows[0].data);
  const read = fn => fn();
  return {
    kind: 'postgres', path: 'private.fut_parca_store',
    async transaction(fn) {
      const client = await postgresPool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query("SELECT data FROM private.fut_parca_store WHERE id='main' FOR UPDATE");
        data = normalizeRepositoryData(locked.rows[0]?.data);
        const previous = copy(data);
        try {
          const result = fn();
          await client.query("UPDATE private.fut_parca_store SET data=$1::jsonb, updated_at=now() WHERE id='main'", [JSON.stringify(data)]);
          await client.query('COMMIT');
          return result;
        } catch (cause) {
          data = previous;
          throw cause;
        }
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => {});
        throw cause;
      } finally { client.release(); }
    },
    userByEmail: email => read(() => data.users.find(user => user.email === email)), userById: id => read(() => data.users.find(user => user.id === id)),
    usersForGroup: id => read(() => data.users.filter(user => membershipsOf(user).some(item => item.groupId === id))), groupById: id => read(() => data.groups.find(group => group.id === id)),
    groupByInvite: code => read(() => data.groups.find(group => group.inviteCode === code)), insertGroup: group => data.groups.push(copy(group)),
    allGroups: () => read(() => data.groups.map(copy)),
    updateGroup(group) { data.groups[data.groups.findIndex(item => item.id === group.id)] = copy(group); },
    deleteGroup(id) { data.groups = data.groups.filter(group => group.id !== id); },
    insertUser: user => data.users.push(copy(user)),
    updateUserRole(id, groupId, role) { const user = data.users.find(item => item.id === id); if (user) setMemoryMembershipRole(user, groupId, role); },
    updateUserMembership(id, groupId, role, makeActive = true) { const user = data.users.find(item => item.id === id); if (user) setMemoryMembership(user, groupId, role, makeActive); },
    setActiveGroup(id, groupId) { const user = data.users.find(item => item.id === id); if (user) setMemoryActiveGroup(user, groupId); },
    removeUserMembership(id, groupId) { const user = data.users.find(item => item.id === id); if (user) removeMemoryMembership(user, groupId); },
    updateUserName(id, name) { const user = data.users.find(item => item.id === id); if (user) user.name = name; },
    updateUserPassword(id, salt, hash) { const user = data.users.find(item => item.id === id); if (user) { user.salt = salt; user.hash = hash; } },
    requestByUserGroup: (userId, groupId) => read(() => data.joinRequests.find(item => item.userId === userId && item.groupId === groupId)),
    requestsForGroup: groupId => read(() => data.joinRequests.filter(item => item.groupId === groupId)),
    requestById: id => read(() => data.joinRequests.find(item => item.id === id)),
    insertRequest: request => data.joinRequests.push(copy(request)),
    updateRequest(id, status) { const item = data.joinRequests.find(request => request.id === id); if (item) item.status = status; },
    deleteRequestsForUser(userId) { data.joinRequests = data.joinRequests.filter(request => request.userId !== userId); },
    deleteRequestsForGroup(groupId) { data.joinRequests = data.joinRequests.filter(request => request.groupId !== groupId); },
    deleteUser(id) { data.users = data.users.filter(user => user.id !== id); },
    sessionByHash: hash => read(() => data.sessions.find(session => session.hash === hash)),
    insertSession(hash, userId, expiresAt) { data.sessions = data.sessions.filter(session => session.expiresAt > Date.now()); data.sessions.push({ hash, userId, expiresAt }); },
    deleteSession(hash) { data.sessions = data.sessions.filter(session => session.hash !== hash); },
    deleteSessionsForUser(userId) { data.sessions = data.sessions.filter(session => session.userId !== userId); },
    passwordResetById: id => read(() => data.passwordResets.find(reset => reset.id === id)),
    latestPasswordResetForUser: (userId, channel) => read(() => data.passwordResets.filter(reset => reset.userId === userId && reset.channel === channel).sort((a, b) => b.createdAt - a.createdAt)[0]),
    insertPasswordReset(reset) { data.passwordResets = data.passwordResets.filter(item => item.userId !== reset.userId || item.channel !== reset.channel); data.passwordResets.push(copy(reset)); },
    insertPasswordResetAlias(reset) { data.passwordResets = data.passwordResets.filter(item => item.id !== reset.id); data.passwordResets.push(copy(reset)); },
    incrementPasswordResetChallengeAttempts(userId, channel, codeHash) { for (const reset of data.passwordResets) if (reset.userId === userId && reset.channel === channel && reset.codeHash === codeHash) reset.attempts++; },
    deletePasswordReset(id) { data.passwordResets = data.passwordResets.filter(reset => reset.id !== id); },
    deletePasswordResetChallenge(userId, channel, codeHash) { data.passwordResets = data.passwordResets.filter(reset => reset.userId !== userId || reset.channel !== channel || reset.codeHash !== codeHash); },
    deletePasswordResetsForUser(userId) { data.passwordResets = data.passwordResets.filter(reset => reset.userId !== userId); },
    deleteExpiredPasswordResets(now) { data.passwordResets = data.passwordResets.filter(reset => reset.expiresAt > now && reset.attempts < PASSWORD_RESET_MAX_ATTEMPTS); },
    storageStatus() { return { backend: 'postgres', table: 'private.fut_parca_store', transactionLocking: true }; },
    close() {},
  };
}

async function openRepository(path, databaseUrl, supabase) {
  if (supabase?.url && supabase?.key && supabase?.secret) return openSupabaseRepository(supabase);
  if (databaseUrl) return openPostgresRepository(databaseUrl);
  mkdirSync(dirname(path), { recursive: true });
  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch (err) {
    if (!['ERR_UNKNOWN_BUILTIN_MODULE', 'ERR_MODULE_NOT_FOUND'].includes(err.code)) throw err;
  }
  if (sqlite?.DatabaseSync) {
    const db = new sqlite.DatabaseSync(path);
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL, state_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, group_id TEXT NOT NULL REFERENCES groups(id), role TEXT NOT NULL, athlete_id TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY(user_id, group_id));
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS join_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), group_id TEXT NOT NULL REFERENCES groups(id), status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id, group_id));
      CREATE TABLE IF NOT EXISTS password_resets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel TEXT NOT NULL, salt TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id,channel,created_at);
      INSERT OR IGNORE INTO memberships(user_id,group_id,role) SELECT id,group_id,role FROM users;`);
    const groupRow = row => row ? { id: row.id, name: row.name, inviteCode: row.invite_code, revision: row.revision, state: JSON.parse(row.state_json) } : undefined;
    const userRow = row => row ? { id: row.id, name: row.name, email: row.email, groupId: row.group_id, role: row.role, athleteId: row.athlete_id, salt: row.password_salt, hash: row.password_hash, memberships:db.prepare('SELECT group_id,role FROM memberships WHERE user_id=? ORDER BY rowid').all(row.id).map(item => ({ groupId:item.group_id, role:item.role })) } : undefined;
    return {
      kind: 'sqlite', path,
      transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (err) { db.exec('ROLLBACK'); throw err; } },
      userByEmail: email => userRow(db.prepare('SELECT * FROM users WHERE email=?').get(email)),
      userById: id => userRow(db.prepare('SELECT * FROM users WHERE id=?').get(id)),
      usersForGroup: id => db.prepare('SELECT users.* FROM users JOIN memberships ON memberships.user_id=users.id WHERE memberships.group_id=?').all(id).map(userRow),
      groupById: id => groupRow(db.prepare('SELECT * FROM groups WHERE id=?').get(id)),
      groupByInvite: code => groupRow(db.prepare('SELECT * FROM groups WHERE invite_code=?').get(code)),
      allGroups: () => db.prepare('SELECT * FROM groups').all().map(groupRow),
      insertGroup(group) { db.prepare('INSERT INTO groups VALUES (?,?,?,?,?)').run(group.id, group.name, group.inviteCode, group.revision, JSON.stringify(group.state)); },
      updateGroup(group) { db.prepare('UPDATE groups SET name=?,revision=?,state_json=? WHERE id=?').run(group.name, group.revision, JSON.stringify(group.state), group.id); },
      deleteGroup(id) { db.prepare('DELETE FROM groups WHERE id=?').run(id); },
      insertUser(user) {
        db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(user.id, user.name, user.email, user.groupId, user.role, user.athleteId, user.salt, user.hash);
        const insert = db.prepare('INSERT INTO memberships(user_id,group_id,role) VALUES (?,?,?)');
        for (const membership of membershipsOf(user)) insert.run(user.id, membership.groupId, membership.role);
      },
      updateUserRole(id, groupId, role) {
        db.prepare('UPDATE memberships SET role=? WHERE user_id=? AND group_id=?').run(role, id, groupId);
        db.prepare('UPDATE users SET role=? WHERE id=? AND group_id=?').run(role, id, groupId);
      },
      updateUserMembership(id, groupId, role, makeActive = true) {
        db.prepare('INSERT INTO memberships(user_id,group_id,role) VALUES (?,?,?) ON CONFLICT(user_id,group_id) DO UPDATE SET role=excluded.role').run(id, groupId, role);
        if (makeActive) db.prepare('UPDATE users SET group_id=?,role=? WHERE id=?').run(groupId, role, id);
      },
      setActiveGroup(id, groupId) {
        const membership = db.prepare('SELECT role FROM memberships WHERE user_id=? AND group_id=?').get(id, groupId);
        if (!membership) error('Você não faz parte desta pelada.', 403);
        db.prepare('UPDATE users SET group_id=?,role=? WHERE id=?').run(groupId, membership.role, id);
      },
      removeUserMembership(id, groupId) {
        const user = db.prepare('SELECT group_id FROM users WHERE id=?').get(id);
        db.prepare('DELETE FROM memberships WHERE user_id=? AND group_id=?').run(id, groupId);
        if (user?.group_id === groupId) {
          const next = db.prepare('SELECT group_id,role FROM memberships WHERE user_id=? ORDER BY rowid LIMIT 1').get(id);
          if (next) db.prepare('UPDATE users SET group_id=?,role=? WHERE id=?').run(next.group_id, next.role, id);
        }
      },
      updateUserName(id, name) { db.prepare('UPDATE users SET name=? WHERE id=?').run(name, id); },
      updateUserPassword(id, salt, hash) { db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(salt, hash, id); },
      requestByUserGroup(userId, groupId) { return db.prepare('SELECT * FROM join_requests WHERE user_id=? AND group_id=?').get(userId, groupId); },
      requestsForGroup(groupId) { return db.prepare('SELECT * FROM join_requests WHERE group_id=? ORDER BY created_at').all(groupId); },
      requestById(id) { return db.prepare('SELECT * FROM join_requests WHERE id=?').get(id); },
      insertRequest(request) { db.prepare('INSERT INTO join_requests VALUES (?,?,?,?,?)').run(request.id, request.userId, request.groupId, request.status, request.createdAt); },
      updateRequest(id, status) { db.prepare('UPDATE join_requests SET status=? WHERE id=?').run(status, id); },
      deleteRequestsForUser(userId) { db.prepare('DELETE FROM join_requests WHERE user_id=?').run(userId); },
      deleteRequestsForGroup(groupId) { db.prepare('DELETE FROM join_requests WHERE group_id=?').run(groupId); },
      deleteUser(id) { db.prepare('DELETE FROM users WHERE id=?').run(id); },
      sessionByHash: hash => { const row = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash); return row ? { userId: row.user_id, expiresAt: row.expires_at } : undefined; },
      insertSession(hash, userId, expiresAt) { db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash, userId, expiresAt); },
      deleteSession(hash) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); },
      deleteSessionsForUser(userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); },
      passwordResetById(id) { const row = db.prepare('SELECT * FROM password_resets WHERE id=?').get(id); return row ? { id:row.id, userId:row.user_id, channel:row.channel, salt:row.salt, codeHash:row.code_hash, expiresAt:row.expires_at, attempts:row.attempts, createdAt:row.created_at } : undefined; },
      latestPasswordResetForUser(userId, channel) { const row = db.prepare('SELECT * FROM password_resets WHERE user_id=? AND channel=? ORDER BY created_at DESC LIMIT 1').get(userId, channel); return row ? { id:row.id, userId:row.user_id, channel:row.channel, salt:row.salt, codeHash:row.code_hash, expiresAt:row.expires_at, attempts:row.attempts, createdAt:row.created_at } : undefined; },
      insertPasswordReset(reset) { db.prepare('DELETE FROM password_resets WHERE user_id=? AND channel=?').run(reset.userId, reset.channel); db.prepare('INSERT INTO password_resets VALUES (?,?,?,?,?,?,?,?)').run(reset.id, reset.userId, reset.channel, reset.salt, reset.codeHash, reset.expiresAt, reset.attempts, reset.createdAt); },
      insertPasswordResetAlias(reset) { db.prepare('INSERT INTO password_resets VALUES (?,?,?,?,?,?,?,?)').run(reset.id, reset.userId, reset.channel, reset.salt, reset.codeHash, reset.expiresAt, reset.attempts, reset.createdAt); },
      incrementPasswordResetChallengeAttempts(userId, channel, codeHash) { db.prepare('UPDATE password_resets SET attempts=attempts+1 WHERE user_id=? AND channel=? AND code_hash=?').run(userId, channel, codeHash); },
      deletePasswordReset(id) { db.prepare('DELETE FROM password_resets WHERE id=?').run(id); },
      deletePasswordResetChallenge(userId, channel, codeHash) { db.prepare('DELETE FROM password_resets WHERE user_id=? AND channel=? AND code_hash=?').run(userId, channel, codeHash); },
      deletePasswordResetsForUser(userId) { db.prepare('DELETE FROM password_resets WHERE user_id=?').run(userId); },
      deleteExpiredPasswordResets(now) { db.prepare('DELETE FROM password_resets WHERE expires_at<=? OR attempts>=?').run(now, PASSWORD_RESET_MAX_ATTEMPTS); },
      storageStatus() {
        return {
          backend: 'sqlite',
          journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
          foreignKeys: db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1,
          busyTimeout: db.prepare('PRAGMA busy_timeout').get().timeout,
        };
      },
      close() { db.close(); },
    };
  }
  const jsonPath = `${path}.json`;
  let data = normalizeRepositoryData(existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : { version: 4, users: [], groups: [], sessions: [], joinRequests: [], passwordResets: [] });
  let inTransaction = false;
  const persist = () => { const temporary = `${jsonPath}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, jsonPath); };
  const read = fn => { if (!inTransaction) data = normalizeRepositoryData(JSON.parse(readFileSync(jsonPath, 'utf8'))); return fn(); };
  if (!existsSync(jsonPath)) persist();
  return {
    kind: 'json', path: jsonPath,
    transaction(fn) {
      // Recarregar também evita revisões antigas em duas instâncias no mesmo processo.
      data = normalizeRepositoryData(JSON.parse(readFileSync(jsonPath, 'utf8')));
      const previous = copy(data);
      inTransaction = true;
      try { const result = fn(); persist(); return result; } catch (err) { data = previous; throw err; } finally { inTransaction = false; }
    },
    userByEmail: email => read(() => data.users.find(user => user.email === email)), userById: id => read(() => data.users.find(user => user.id === id)),
    usersForGroup: id => read(() => data.users.filter(user => membershipsOf(user).some(item => item.groupId === id))), groupById: id => read(() => data.groups.find(group => group.id === id)),
    groupByInvite: code => read(() => data.groups.find(group => group.inviteCode === code)), insertGroup: group => data.groups.push(copy(group)),
    allGroups: () => read(() => data.groups.map(copy)),
    updateGroup(group) { data.groups[data.groups.findIndex(item => item.id === group.id)] = copy(group); },
    deleteGroup(id) { data.groups = data.groups.filter(group => group.id !== id); },
    insertUser: user => data.users.push(copy(user)),
    updateUserRole(id, groupId, role) { const user = data.users.find(item => item.id === id); if (user) setMemoryMembershipRole(user, groupId, role); },
    updateUserMembership(id, groupId, role, makeActive = true) { const user = data.users.find(item => item.id === id); if (user) setMemoryMembership(user, groupId, role, makeActive); },
    setActiveGroup(id, groupId) { const user = data.users.find(item => item.id === id); if (user) setMemoryActiveGroup(user, groupId); },
    removeUserMembership(id, groupId) { const user = data.users.find(item => item.id === id); if (user) removeMemoryMembership(user, groupId); },
    updateUserName(id, name) { const user = data.users.find(item => item.id === id); if (user) user.name = name; },
    updateUserPassword(id, salt, hash) { const user = data.users.find(item => item.id === id); if (user) { user.salt = salt; user.hash = hash; } },
    requestByUserGroup: (userId, groupId) => read(() => data.joinRequests.find(item => item.userId === userId && item.groupId === groupId)),
    requestsForGroup: groupId => read(() => data.joinRequests.filter(item => item.groupId === groupId)),
    requestById: id => read(() => data.joinRequests.find(item => item.id === id)),
    insertRequest: request => data.joinRequests.push(copy(request)),
    updateRequest(id, status) { const item = data.joinRequests.find(request => request.id === id); if (item) item.status = status; },
    deleteRequestsForUser(userId) { data.joinRequests = data.joinRequests.filter(request => request.userId !== userId); },
    deleteRequestsForGroup(groupId) { data.joinRequests = data.joinRequests.filter(request => request.groupId !== groupId); },
    deleteUser(id) { data.users = data.users.filter(user => user.id !== id); },
    sessionByHash: hash => read(() => data.sessions.find(session => session.hash === hash)),
    insertSession(hash, userId, expiresAt) { data.sessions = data.sessions.filter(session => session.expiresAt > Date.now()); data.sessions.push({ hash, userId, expiresAt }); },
    deleteSession(hash) { data.sessions = data.sessions.filter(session => session.hash !== hash); },
    deleteSessionsForUser(userId) { data.sessions = data.sessions.filter(session => session.userId !== userId); },
    passwordResetById: id => read(() => data.passwordResets.find(reset => reset.id === id)),
    latestPasswordResetForUser: (userId, channel) => read(() => data.passwordResets.filter(reset => reset.userId === userId && reset.channel === channel).sort((a, b) => b.createdAt - a.createdAt)[0]),
    insertPasswordReset(reset) { data.passwordResets = data.passwordResets.filter(item => item.userId !== reset.userId || item.channel !== reset.channel); data.passwordResets.push(copy(reset)); },
    insertPasswordResetAlias(reset) { data.passwordResets = data.passwordResets.filter(item => item.id !== reset.id); data.passwordResets.push(copy(reset)); },
    incrementPasswordResetChallengeAttempts(userId, channel, codeHash) { for (const reset of data.passwordResets) if (reset.userId === userId && reset.channel === channel && reset.codeHash === codeHash) reset.attempts++; },
    deletePasswordReset(id) { data.passwordResets = data.passwordResets.filter(reset => reset.id !== id); },
    deletePasswordResetChallenge(userId, channel, codeHash) { data.passwordResets = data.passwordResets.filter(reset => reset.userId !== userId || reset.channel !== channel || reset.codeHash !== codeHash); },
    deletePasswordResetsForUser(userId) { data.passwordResets = data.passwordResets.filter(reset => reset.userId !== userId); },
    deleteExpiredPasswordResets(now) { data.passwordResets = data.passwordResets.filter(reset => reset.expiresAt > now && reset.attempts < PASSWORD_RESET_MAX_ATTEMPTS); },
    storageStatus() { return { backend: 'json', atomicWrites: true }; },
    close() {},
  };
}

function validateState(input, previous, users) {
  object(input, 'Estado');
  if (input.version !== 1) error('Versão de estado inválida.');
  list(input.athletes, 'Atletas', 300);
  list(input.rounds, 'Peladas', 100);
  if (input.scheduleType != null && !['recurring', 'single'].includes(input.scheduleType)) error('Tipo de pelada inválido.');
  if (input.scheduleType === 'single' && input.rounds.length > 1) error('Uma pelada avulsa só pode ter um evento.', 409);
  if (input.scheduleType === 'single' && input.rounds.some(round => round.date !== input.singleDate || round.time !== input.singleTime)) error('A data da pelada avulsa deve seguir a configuração da turma.', 409);
  const state = copy(input), athleteIds = new Set(), roundIds = new Set();
  const byAthlete = new Map();
  for (const athlete of state.athletes) {
    object(athlete, 'Atleta'); uniqueId(athleteIds, athlete.id, 'Identificador de atleta');
    text(athlete.name, 'Nome do atleta', 80); text(athlete.nickname, 'Apelido', 18); text(athlete.contact, 'Contato', 254);
    validatePhoto(athlete.photo);
    if (athlete.photoFit != null) {
      object(athlete.photoFit, 'Enquadramento da foto');
      const { x, y, zoom } = athlete.photoFit;
      if (![x, y, zoom].every(Number.isFinite) || x < -25 || x > 25 || y < -25 || y > 25 || zoom < 85 || zoom > 150) error('Enquadramento da foto inválido.');
    }
    if (athlete.sex != null && !['masculino','feminino','nao-binario','prefiro-nao-informar'].includes(athlete.sex)) error('Sexo do atleta inválido.');
    if (athlete.avatar != null && !['avatar-1','avatar-2','avatar-3','avatar-4'].includes(athlete.avatar)) error('Avatar inválido.');
    object(athlete.preferences, 'Preferências'); object(athlete.baseSkills, 'Skills');
    for (const [modality, settings] of Object.entries(MODALITIES)) {
      const preferences = athlete.preferences[modality]; object(preferences, 'Posições');
      if (!settings.positions.includes(preferences.primary) || (preferences.secondary !== '' && !settings.positions.includes(preferences.secondary))) error('Posição inválida para a modalidade.');
      object(athlete.baseSkills[modality], 'Skills da modalidade');
      for (const key of ATTRIBUTE_KEYS) {
        const rating = athlete.baseSkills[modality][key];
        if (!Number.isInteger(rating) || rating < 1 || rating > 99) error('As skills devem ser números inteiros entre 1 e 99.');
      }
    }
    byAthlete.set(athlete.id, athlete);
  }
  for (const user of users) if (!athleteIds.has(user.athleteId)) error('O perfil de um membro da turma não pode ser removido.', 403);
  const ownerIds = new Set(users.map(user => user.id));
  for (const round of state.rounds) {
    object(round, 'Pelada'); uniqueId(roundIds, round.id, 'Identificador de pelada');
    text(round.title, 'Nome da pelada', 80);
    if (round.time != null && (typeof round.time !== 'string' || !/^\d{2}:\d{2}$/.test(round.time))) error('Horário da pelada inválido.');
    if (round.confirmedAthleteIds != null) {
      list(round.confirmedAthleteIds, 'Presenças', 300);
      if (new Set(round.confirmedAthleteIds).size !== round.confirmedAthleteIds.length || round.confirmedAthleteIds.some(id => !athleteIds.has(id))) error('Lista de presença inválida.');
    }
    if (typeof round.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(round.date) || !Number.isFinite(Date.parse(round.date)) || new Date(round.date).toISOString().slice(0, 10) !== round.date) error('Data da pelada inválida.');
    if (!MODALITIES[round.modality] || !['draft', 'live', 'closed'].includes(round.status)) error('Modalidade ou situação da pelada inválida.');
    if (round.drawMode != null && !['random', 'balanced'].includes(round.drawMode)) error('Modo de sorteio inválido.');
    if (!Number.isInteger(round.revision) || round.revision < 0 || round.revision > 10000) error('Versão da pelada inválida.');
    list(round.teams, 'Equipes', 30); list(round.matches, 'Jogos', 1000); list(round.events, 'Lances', 10000); list(round.fantasy, 'Fantasy', 300);
    const teams = new Map(), rosters = new Map(), matches = new Map(), teamIds = new Set(), matchIds = new Set(), eventIds = new Set(), fantasyIds = new Set();
    for (const team of round.teams) {
      object(team, 'Equipe'); uniqueId(teamIds, team.id, 'Identificador de equipe'); text(team.name, 'Nome da equipe', 80);
      if (typeof team.color !== 'string' || !/^#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?$/.test(team.color)) error('Cor da equipe inválida.');
      list(team.athleteIds, 'Participantes', 300);
      if (team.captainId != null && (typeof team.captainId !== 'string' || !team.athleteIds.includes(team.captainId))) error('O capitão precisa participar da equipe.');
      for (const id of team.athleteIds) {
        if (!byAthlete.has(id)) error('A equipe contém um atleta não cadastrado.');
        if (rosters.has(id)) error('Um atleta só pode pertencer a uma equipe na pelada.');
        rosters.set(id, team.id);
      }
      teams.set(team.id, team);
    }
    for (const match of round.matches) {
      object(match, 'Jogo'); uniqueId(matchIds, match.id, 'Identificador de jogo');
      if (!teams.has(match.homeId) || !teams.has(match.awayId) || match.homeId === match.awayId) error('Equipes do jogo inválidas.');
      if (!['scheduled', 'live', 'finished', 'cancelled'].includes(match.status)) error('Situação do jogo inválida.');
      matches.set(match.id, match);
    }
    const oldRound = previous.rounds.find(item => item.id === round.id);
    if (oldRound?.status === 'closed') {
      if (round.status === 'closed' && !isDeepStrictEqual(round, oldRound)) error('Reabra a pelada antes de corrigir a súmula.', 403);
      if (round.status === 'live' && !isDeepStrictEqual({ ...round, status: 'closed' }, oldRound)) error('Reabra a pelada antes de corrigir a súmula.', 403);
    }
    if (oldRound) {
      const expectedRoundRevision = round.status === 'closed' && oldRound.status !== 'closed' ? oldRound.revision + 1 : oldRound.revision;
      if (round.revision !== expectedRoundRevision) error('A versão da pelada não corresponde ao fechamento.', 409);
      if (round.status !== 'closed' && round.closedAt !== oldRound.closedAt) error('A data de fechamento não pode ser alterada.', 403);
    } else if (round.revision !== (round.status === 'closed' ? 1 : 0)) error('A versão inicial da pelada é inválida.');
    const derivedPositions = Object.fromEntries([...rosters.keys()].map(id => [id, byAthlete.get(id).preferences[round.modality].primary]));
    if (oldRound && oldRound.status !== 'draft') {
      const frozen = oldRound.positions || Object.fromEntries(oldRound.teams.flatMap(team => team.athleteIds).map(id => [id, previous.athletes.find(a => a.id === id)?.preferences[oldRound.modality]?.primary]));
      if (round.modality !== oldRound.modality || !isDeepStrictEqual(round.positions || {}, frozen)) error('As posições de uma pelada iniciada não podem ser alteradas.', 403);
      if (round.status === 'draft') error('Uma pelada iniciada não pode voltar a abrir escalações.', 403);
      if (!isDeepStrictEqual(round.fantasy, oldRound.fantasy)) error('As escalações estão travadas desde o início da pelada.', 403);
    } else if (round.status !== 'draft') {
      if (round.positions && !isDeepStrictEqual(round.positions, derivedPositions)) error('As posições devem corresponder aos atletas no início da pelada.');
      round.positions = derivedPositions;
    } else if (round.positions && Object.keys(round.positions).length) error('As posições são congeladas somente ao iniciar a pelada.');
    if (round.positions) {
      object(round.positions, 'Posições da rodada');
      for (const [id, position] of Object.entries(round.positions)) if (!byAthlete.has(id) || !MODALITIES[round.modality].positions.includes(position)) error('Posição congelada inválida.');
      if (round.status !== 'draft' && [...rosters.keys()].some(id => !round.positions[id])) error('Falta a posição congelada de um participante.');
    }
    for (const event of round.events) {
      object(event, 'Lance'); uniqueId(eventIds, event.id, 'Identificador de lance');
      const match = matches.get(event.matchId), rule = EVENT_TYPES.get(event.type), teamId = rosters.get(event.athleteId);
      if (!match || !rule || !teamId || ![match.homeId, match.awayId].includes(teamId)) error('Lance incompatível com os participantes do jogo.');
      text(event.createdAt, 'Data do lance', 40);
      if (!Number.isFinite(Date.parse(event.createdAt))) error('Data do lance inválida.');
      if (match.status === 'scheduled' || round.status === 'draft') error('Não é possível registrar lances antes de iniciar o jogo.');
      const position = round.positions?.[event.athleteId] || byAthlete.get(event.athleteId).preferences[round.modality].primary;
      if (rule.goalkeeperOnly && position !== 'Goleiro') error('Este lance só pode ser registrado para um goleiro.');
    }
    const minimal = { version: 1, athletes: state.athletes.map(athlete => ({ id: athlete.id, preferences: athlete.preferences })), rounds: [round] };
    for (const lineup of round.fantasy) {
      object(lineup, 'Escalação'); uniqueId(fantasyIds, lineup.id, 'Identificador de fantasy');
      text(lineup.name, 'Nome do fantasy', 80); text(lineup.owner, 'Dono do fantasy', 80);
      if (lineup.ownerUserId !== undefined && !ownerIds.has(lineup.ownerUserId)) error('O fantasy deve pertencer a um membro desta turma.');
      try { saveFantasy({ ...minimal, rounds: [{ ...round, status: 'draft', fantasy: [] }] }, round.id, lineup); } catch (err) { error(err.message); }
    }
    if (round.status !== 'draft') {
      try {
        beginRound({ ...minimal, rounds: [{ ...round, status: 'draft' }] }, round.id);
        if (round.status === 'closed') {
          if (typeof round.closedAt !== 'string' || !Number.isFinite(Date.parse(round.closedAt)) || round.revision < 1) error('Fechamento da pelada inválido.');
          closeRound({ ...minimal, rounds: [{ ...round, status: 'live' }] }, round.id);
        }
      } catch (err) { error(err.message, err.status || 400); }
    }
  }
  for (const oldRound of previous.rounds) if (oldRound.status !== 'draft' && !roundIds.has(oldRound.id)) error('Uma pelada iniciada não pode ser removida.', 403);
  return state;
}

function validateMemberChanges(previous, next, user) {
  const fail = () => error('Você só pode editar seu perfil e seu fantasy antes da pelada.', 403);
  if (previous.version !== next.version || !isDeepStrictEqual(Object.keys(previous).sort(), Object.keys(next).sort()) || previous.athletes.length !== next.athletes.length || previous.rounds.length !== next.rounds.length) fail();
  for (let index = 0; index < previous.athletes.length; index++) {
    const before = previous.athletes[index], after = next.athletes[index];
    if (before.id !== after.id) fail();
    if (before.id !== user.athleteId) { if (!isDeepStrictEqual(before, after)) fail(); continue; }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) if (!PERSONAL_FIELDS.has(key) && !isDeepStrictEqual(before[key], after[key])) fail();
  }
  for (let index = 0; index < previous.rounds.length; index++) {
    const before = previous.rounds[index], after = next.rounds[index];
    if (before.id !== after.id) fail();
    if (!isDeepStrictEqual({ ...before, fantasy: [], confirmedAthleteIds: [] }, { ...after, fantasy: [], confirmedAthleteIds: [] })) fail();
    const beforePresence = new Set(before.confirmedAthleteIds || []), afterPresence = new Set(after.confirmedAthleteIds || []);
    for (const id of new Set([...beforePresence, ...afterPresence])) if (id !== user.athleteId && beforePresence.has(id) !== afterPresence.has(id)) fail();
    if (before.status !== 'draft' && beforePresence.has(user.athleteId) !== afterPresence.has(user.athleteId)) fail();
    if (before.status !== 'draft') { if (!isDeepStrictEqual(before.fantasy, after.fantasy)) fail(); continue; }
    const existing = new Map(before.fantasy.map(lineup => [lineup.id, lineup]));
    const supplied = new Map(after.fantasy.map(lineup => [lineup.id, lineup]));
    for (const old of before.fantasy) {
      const changed = supplied.get(old.id);
      if (!changed) fail();
      if (!isDeepStrictEqual(old, changed) && (old.ownerUserId !== user.id || changed.ownerUserId !== user.id)) fail();
    }
    for (const lineup of after.fantasy) if (!existing.has(lineup.id) && lineup.ownerUserId !== user.id) fail();
  }
}

function withoutAccountData(state, user) {
  const athleteId = user.athleteId;
  const rounds = state.rounds.map(round => {
    let fantasy = round.fantasy.filter(lineup => lineup.ownerUserId !== user.id);
    let teams = round.teams;
    if (round.status === 'draft') {
      teams = teams.map(team => ({
        ...team,
        athleteIds: team.athleteIds.filter(id => id !== athleteId),
        ...(team.captainId === athleteId ? { captainId: null } : {}),
      }));
      fantasy = fantasy.filter(lineup => !lineup.athleteIds.includes(athleteId));
    }
    return { ...round, teams, fantasy };
  });
  const referenced = rounds.some(round =>
    round.teams.some(team => team.athleteIds.includes(athleteId)) ||
    round.events.some(event => event.athleteId === athleteId) ||
    round.fantasy.some(lineup => lineup.athleteIds.includes(athleteId)) ||
    Object.hasOwn(round.positions || {}, athleteId)
  );
  const anonymous = {
    id: athleteId,
    name: 'Atleta removido',
    nickname: 'Removido',
    contact: 'Dados removidos',
    photo: '',
    preferences: { futebol: { primary: 'Meia', secondary: '' }, futsal: { primary: 'Ala', secondary: '' }, society: { primary: 'Meio-campista', secondary: '' } },
    baseSkills: Object.fromEntries(Object.keys(MODALITIES).map(modality => [modality, Object.fromEntries(ATTRIBUTE_KEYS.map(key => [key, 60]))])),
  };
  return {
    ...state,
    athletes: referenced ? state.athletes.map(athlete => athlete.id === athleteId ? anonymous : athlete) : state.athletes.filter(athlete => athlete.id !== athleteId),
    rounds,
  };
}

export async function createAccountStore({ path, databaseUrl, supabase, recoveryDelivery } = {}) {
  if (!databaseUrl && !supabase && (typeof path !== 'string' || !path)) error('Informe o banco de contas.');
  const repository = await openRepository(path, databaseUrl, supabase);
  const recoveryChannels = new Set(Array.isArray(recoveryDelivery?.channels) ? recoveryDelivery.channels.filter(channel => channel === 'email' || channel === 'sms') : []);
  let closed = false;
  const availableGroupsFor = user => membershipsOf(user).map(membership => ({ group:repository.groupById(membership.groupId), role:membership.role })).filter(item => item.group);
  const sessionFor = (user, group) => publicSession(user, group, availableGroupsFor(user));
  const profileForUser = user => {
    for (const membership of membershipsOf(user)) {
      const group = repository.groupById(membership.groupId), profile = group?.state?.athletes?.find(item => item.id === user.athleteId);
      if (profile) return { group, profile };
    }
    return null;
  };
  const lookup = token => {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = hashToken(token), entry = repository.sessionByHash(hash);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    const user = repository.userById(entry.userId);
    if (!user) return null;
    const active = membershipsOf(user).find(item => item.groupId === user.groupId) || membershipsOf(user)[0];
    const group = active ? repository.groupById(active.groupId) : null;
    return group ? { user, group } : null;
  };
  const requireSession = token => lookup(token) || error('Entre na sua conta para continuar.', 401);
  const issueSession = user => { const token = randomBytes(32).toString('hex'); repository.insertSession(hashToken(token), user.id, Date.now() + SESSION_LIFETIME); return token; };
  const phoneForUser = user => {
    const athlete = profileForUser(user)?.profile;
    return normalizedPhone(athlete?.contact);
  };
  const resetFailure = () => error('Código inválido ou expirado. Solicite um novo código.', 400);
  return {
    backend: repository.kind,
    passwordResetChannels: [...recoveryChannels],
    async storageStatus() { return repository.storageStatus(); },
    async register(input = {}) {
      const name = text(input.name, 'Nome', 80, 2), email = emailOf(input.email), password = passwordOf(input.password);
      const inviteCode = input.inviteCode ? text(input.inviteCode, 'Convite', 24).toUpperCase() : '';
      const groupName = !inviteCode && input.groupName ? text(input.groupName, 'Nome da turma', 80, 2) : '';
      const salt = randomBytes(16).toString('hex'), hash = (await scrypt(password, salt, 64)).toString('hex');
      return repository.transaction(() => {
        if (repository.userByEmail(email)) error('Já existe uma conta com este e-mail.', 409);
        if (groupName && repository.allGroups().some(group => !group.state.profileOnly && normalizedGroupName(group.name) === normalizedGroupName(groupName))) error('Já existe uma pelada com este nome. Escolha outro.', 409);
        const athlete = newAthlete(name, email, input.profile || input);
        let group;
        if (inviteCode) {
          group = repository.groupByInvite(inviteCode);
          if (!group) error('Código de convite inválido.');
          if (group.state.athletes.length >= 300) error('Esta turma atingiu o limite de atletas.');
          group.state.athletes.push(athlete); group.revision++; repository.updateGroup(group);
        } else {
          let code; do { code = randomBytes(6).toString('hex').toUpperCase(); } while (repository.groupByInvite(code));
          group = { id: `group-${randomUUID()}`, name: groupName || 'Meu perfil', inviteCode: code, revision: 1, state: { version: 1, athletes: [athlete], rounds: [], ...(!groupName ? { profileOnly: true } : {}) } };
          repository.insertGroup(group);
        }
        const role = inviteCode || !groupName ? 'member' : 'organizer';
        const user = { id: `user-${randomUUID()}`, name, email, groupId: group.id, role, memberships:[{ groupId:group.id, role }], athleteId: athlete.id, salt, hash };
        repository.insertUser(user);
        const token = issueSession(user);
        return { token, session: sessionFor(user, group) };
      });
    },
    async login(input = {}) {
      const email = emailOf(input.email);
      if (typeof input.password !== 'string' || input.password.length > 128) error('E-mail ou senha incorretos.', 401);
      const user = repository.userByEmail(email);
      const candidate = await scrypt(input.password, user?.salt || 'fut-parca-invalid-account', 64);
      const expected = user ? Buffer.from(user.hash, 'hex') : Buffer.alloc(64);
      if (!user || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) error('E-mail ou senha incorretos.', 401);
      return repository.transaction(() => { const current = repository.userById(user.id), group = repository.groupById(current.groupId); return { token: issueSession(current), session: sessionFor(current, group) }; });
    },
    async requestPasswordReset(input = {}) {
      const channel = input.channel === 'sms' ? 'sms' : input.channel === 'email' ? 'email' : error('Escolha recuperação por e-mail ou SMS.');
      if (!recoveryChannels.has(channel) || typeof recoveryDelivery?.send !== 'function') error(`A recuperação por ${channel === 'sms' ? 'SMS' : 'e-mail'} ainda não está disponível.`, 503);
      const minimumResponse = new Promise(resolve => setTimeout(resolve, Math.max(0, Number(recoveryDelivery.minimumResponseMs) || 0)));
      const identifierEmail = emailOf(input.identifier);
      const now = Date.now();
      await repository.transaction(() => repository.deleteExpiredPasswordResets(now));
      const user = repository.userByEmail(identifierEmail);
      const requestId = randomBytes(32).toString('hex');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const codeSalt = randomBytes(16).toString('hex');
      const codeHash = (await scrypt(code, codeSalt, 32)).toString('hex');
      const response = { ok:true, requestId, expiresInSeconds:PASSWORD_RESET_LIFETIME / 1000 };
      const destination = user ? (channel === 'email' ? user.email : phoneForUser(user)) : '';
      if (!user || !destination) { await minimumResponse; return response; }
      const reset = { id:requestId, userId:user.id, channel, salt:codeSalt, codeHash, expiresAt:now + PASSWORD_RESET_LIFETIME, attempts:0, createdAt:now };
      const shouldSend = await repository.transaction(() => {
        const currentUser = repository.userById(user.id);
        if (!currentUser) return false;
        const recent = repository.latestPasswordResetForUser(user.id, channel);
        if (recent && recent.expiresAt > now && recent.createdAt > now - PASSWORD_RESET_RESEND_DELAY) {
          repository.insertPasswordResetAlias({ ...recent, id:requestId });
          return false;
        }
        repository.insertPasswordReset(reset);
        return true;
      });
      if (!shouldSend) { await minimumResponse; return response; }
      try {
        await recoveryDelivery.send({ channel, destination, code, expiresMinutes:PASSWORD_RESET_LIFETIME / 60000, name:user.name });
      } catch (cause) {
        await repository.transaction(() => repository.deletePasswordReset(requestId));
        recoveryDelivery.reportError?.(cause);
      }
      await minimumResponse;
      return response;
    },
    async confirmPasswordReset(input = {}) {
      const requestId = typeof input.requestId === 'string' && /^[a-f0-9]{64}$/.test(input.requestId) ? input.requestId : '';
      const code = typeof input.code === 'string' && /^\d{6}$/.test(input.code) ? input.code : '000000';
      const password = passwordOf(input.password);
      const reset = requestId ? repository.passwordResetById(requestId) : null;
      const codeSalt = reset?.salt || randomBytes(16).toString('hex');
      const candidate = await scrypt(code, codeSalt, 32);
      const expected = reset && /^[a-f0-9]{64}$/.test(reset.codeHash) ? Buffer.from(reset.codeHash, 'hex') : Buffer.alloc(32);
      const now = Date.now();
      const valid = Boolean(reset && reset.expiresAt > now && reset.attempts < PASSWORD_RESET_MAX_ATTEMPTS && candidate.length === expected.length && timingSafeEqual(candidate, expected));
      if (!valid) {
        if (reset) await repository.transaction(() => {
          const current = repository.passwordResetById(requestId);
          if (!current) return;
          if (current.expiresAt <= now || current.attempts + 1 >= PASSWORD_RESET_MAX_ATTEMPTS) repository.deletePasswordResetChallenge(current.userId, current.channel, current.codeHash);
          else repository.incrementPasswordResetChallengeAttempts(current.userId, current.channel, current.codeHash);
        });
        resetFailure();
      }
      const passwordSalt = randomBytes(16).toString('hex');
      const passwordHash = (await scrypt(password, passwordSalt, 64)).toString('hex');
      return repository.transaction(() => {
        const current = repository.passwordResetById(requestId);
        if (!current || current.userId !== reset.userId || current.codeHash !== reset.codeHash || current.expiresAt <= Date.now() || current.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) resetFailure();
        const user = repository.userById(current.userId);
        if (!user) resetFailure();
        repository.updateUserPassword(user.id, passwordSalt, passwordHash);
        repository.deleteSessionsForUser(user.id);
        repository.deletePasswordResetsForUser(user.id);
        return { ok:true };
      });
    },
    async session(token) { const current = lookup(token); return current ? sessionFor(current.user, current.group) : null; },
    async logout(token) { if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) await repository.transaction(() => repository.deleteSession(hashToken(token))); return { ok: true }; },
    async deleteAccount(token, input = {}) {
      const current = requireSession(token);
      if (typeof input.password !== 'string' || input.password.length > 128) error('Senha incorreta.', 401);
      const candidate = await scrypt(input.password, current.user.salt, 64);
      const expected = Buffer.from(current.user.hash, 'hex');
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) error('Senha incorreta.', 401);
      return repository.transaction(() => {
        const { user } = requireSession(token);
        if (user.id !== current.user.id) error('Entre novamente para excluir sua conta.', 401);
        repository.deleteSessionsForUser(user.id);
        repository.deletePasswordResetsForUser(user.id);
        repository.deleteRequestsForUser(user.id);
        const groupsToDelete = [];
        for (const { group, role } of availableGroupsFor(user)) {
          const members = repository.usersForGroup(group.id), others = members.filter(member => member.id !== user.id);
          if (!others.length) { groupsToDelete.push(group.id); continue; }
          if (role === 'organizer') repository.updateUserRole(others[0].id, group.id, 'organizer');
          group.state = withoutAccountData(group.state, user);
          group.revision++;
          repository.updateGroup(group);
        }
        repository.deleteUser(user.id);
        for (const groupId of groupsToDelete) { repository.deleteRequestsForGroup(groupId); repository.deleteGroup(groupId); }
        return { ok:true, groupDeleted:groupsToDelete.length > 0 };
      });
    },
    async getState(token) { const { user, group } = requireSession(token); return sessionFor(user, group); },
    async searchGroups(query = '') {
      const raw = String(query || '').trim().slice(0, 100), term = normalizedGroupName(raw);
      return repository.allGroups().filter(group => !group.state.profileOnly && (!term || normalizedGroupName(group.name).includes(term) || group.id.toLocaleLowerCase('pt-BR').includes(raw.toLocaleLowerCase('pt-BR')) || group.inviteCode.toLocaleLowerCase('pt-BR').includes(raw.toLocaleLowerCase('pt-BR')))).slice(0, 40).map(group => ({ id: group.id, publicId: group.inviteCode, name: group.name, logo: group.state.logo || '', scheduleType: group.state.scheduleType || 'recurring', weeklyDay: group.state.weeklyDay || '', weeklyTime: group.state.weeklyTime || '', singleDate: group.state.singleDate || '', singleTime: group.state.singleTime || '', members: group.state.athletes.length }));
    },
    async createGroup(token, input = {}) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (membershipsOf(user).filter(item => !repository.groupById(item.groupId)?.state?.profileOnly).length >= 20) error('Sua conta atingiu o limite de 20 peladas.', 409);
        const name = text(input.name, 'Nome da pelada', 80, 2);
        if (repository.allGroups().some(item => !item.state.profileOnly && normalizedGroupName(item.name) === normalizedGroupName(name))) error('Já existe uma pelada com este nome. Escolha outro.', 409);
        validatePhoto(String(input.logo || ''));
        const scheduleType = input.scheduleType === 'single' ? 'single' : 'recurring';
        const weeklyDay = scheduleType === 'recurring' ? text(input.weeklyDay, 'Dia da semana', 12) : '';
        const weeklyTime = scheduleType === 'recurring' ? text(input.weeklyTime, 'Horário', 5) : '';
        const singleDate = scheduleType === 'single' ? text(input.singleDate, 'Data da pelada', 10) : '';
        const singleTime = scheduleType === 'single' ? text(input.singleTime, 'Horário', 5) : '';
        if (scheduleType === 'recurring' && (!['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'].includes(weeklyDay) || !/^\d{2}:\d{2}$/.test(weeklyTime))) error('Dia ou horário da pelada fixa inválido.');
        if (scheduleType === 'single' && (!/^\d{4}-\d{2}-\d{2}$/.test(singleDate) || !Number.isFinite(Date.parse(singleDate)) || !/^\d{2}:\d{2}$/.test(singleTime))) error('Data ou horário da pelada avulsa inválido.');
        let created;
        if (group.state.profileOnly && membershipsOf(user).length === 1) {
          created = group;
          created.name = name;
          created.state = { ...created.state, profileOnly:false, logo:String(input.logo || ''), scheduleType, weeklyDay, weeklyTime, singleDate, singleTime };
          created.revision++;
          repository.updateGroup(created);
          repository.updateUserRole(user.id, created.id, 'organizer');
        } else {
          const profile = profileForUser(user)?.profile;
          if (!profile) error('Seu perfil de atleta não foi encontrado.', 409);
          let code; do { code = randomBytes(6).toString('hex').toUpperCase(); } while (repository.groupByInvite(code));
          created = { id:`group-${randomUUID()}`, name, inviteCode:code, revision:1, state:{ version:1, athletes:[copy(profile)], rounds:[], profileOnly:false, logo:String(input.logo || ''), scheduleType, weeklyDay, weeklyTime, singleDate, singleTime } };
          repository.insertGroup(created);
          repository.updateUserMembership(user.id, created.id, 'organizer', true);
        }
        const current = repository.userById(user.id);
        return sessionFor(current, created);
      });
    },
    async joinByInvite(token, inviteCode) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        const code = text(inviteCode, 'Convite', 24).toUpperCase();
        const target = repository.groupByInvite(code);
        if (!target || target.state.profileOnly) error('Link de convite inválido ou expirado.', 404);
        if (membershipRole(user, target.id)) {
          repository.setActiveGroup(user.id, target.id);
          const current = repository.userById(user.id);
          return sessionFor(current, target);
        }
        if (membershipsOf(user).filter(item => !repository.groupById(item.groupId)?.state?.profileOnly).length >= 20) error('Sua conta atingiu o limite de 20 peladas.', 409);
        if (target.state.athletes.length >= 300) error('Esta pelada atingiu o limite de atletas.', 409);
        const source = profileForUser(user), profile = source?.profile;
        if (!profile) error('Seu perfil de atleta não foi encontrado.', 409);
        if (!target.state.athletes.some(athlete => athlete.id === user.athleteId)) target.state.athletes.push(copy(profile));
        target.revision++; repository.updateGroup(target);
        repository.updateUserMembership(user.id, target.id, 'member', true);
        if (source.group.state.profileOnly && membershipsOf(user).length === 1) {
          repository.removeUserMembership(user.id, source.group.id);
          repository.deleteGroup(source.group.id);
        }
        const current = repository.userById(user.id);
        return sessionFor(current, target);
      });
    },
    async requestJoin(token, groupId) {
      return repository.transaction(() => {
        const { user } = requireSession(token);
        const target = repository.groupById(identifier(groupId, 'Pelada'));
        if (!target || target.state.profileOnly) error('Pelada não encontrada.', 404);
        if (membershipRole(user, target.id)) error('Você já faz parte desta pelada.', 409);
        if (membershipsOf(user).filter(item => !repository.groupById(item.groupId)?.state?.profileOnly).length >= 20) error('Sua conta atingiu o limite de 20 peladas.', 409);
        const previous = repository.requestByUserGroup(user.id, target.id);
        if (previous?.status === 'pending') error('Seu pedido já está aguardando aprovação.', 409);
        const request = { id: `request-${randomUUID()}`, userId: user.id, groupId: target.id, status: 'pending', createdAt: new Date().toISOString() };
        if (previous) repository.updateRequest(previous.id, 'pending'); else repository.insertRequest(request);
        return { ok: true };
      });
    },
    async joinRequests(token) {
      const { user, group } = requireSession(token);
      if (user.role !== 'organizer') error('Só o organizador pode ver os pedidos.', 403);
      return repository.requestsForGroup(group.id).filter(item => item.status === 'pending').map(item => { const applicant = repository.userById(item.user_id || item.userId), profile = applicant ? profileForUser(applicant)?.profile : null; return { id:item.id, name:applicant?.name || 'Atleta', nickname:profile?.nickname || '', sex:profile?.sex || '', photo:profile?.photo || '' }; });
    },
    async decideJoin(token, requestId, decision) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (user.role !== 'organizer') error('Só o organizador pode aprovar atletas.', 403);
        const request = repository.requestById(identifier(requestId, 'Pedido'));
        const requestGroupId = request?.group_id || request?.groupId, requestUserId = request?.user_id || request?.userId;
        if (!request || requestGroupId !== group.id || request.status !== 'pending') error('Pedido não encontrado.', 404);
        if (decision !== 'approve' && decision !== 'reject') error('Decisão inválida.');
        if (decision === 'reject') { repository.updateRequest(request.id, 'rejected'); return { ok: true }; }
        const applicant = repository.userById(requestUserId), source = applicant && profileForUser(applicant);
        if (!applicant || membershipRole(applicant, group.id)) error('Este atleta já faz parte da pelada.', 409);
        const profile = source?.profile;
        if (!profile || group.state.athletes.length >= 300) error('Não foi possível adicionar este atleta.');
        if (!group.state.athletes.some(athlete => athlete.id === applicant.athleteId)) group.state.athletes.push(copy(profile));
        group.revision++; repository.updateGroup(group);
        const onlyProfile = Boolean(source.group.state.profileOnly && membershipsOf(applicant).length === 1);
        repository.updateUserMembership(applicant.id, group.id, 'member', onlyProfile);
        if (onlyProfile) { repository.removeUserMembership(applicant.id, source.group.id); repository.deleteGroup(source.group.id); }
        repository.updateRequest(request.id, 'approved');
        return { ok: true };
      });
    },
    async switchGroup(token, groupId) {
      return repository.transaction(() => {
        const { user } = requireSession(token), id = identifier(groupId, 'Pelada');
        if (!membershipRole(user, id)) error('Você não faz parte desta pelada.', 403);
        const group = repository.groupById(id);
        if (!group) error('Pelada não encontrada.', 404);
        repository.setActiveGroup(user.id, id);
        return sessionFor(repository.userById(user.id), group);
      });
    },
    async leaveGroup(token) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (group.state.profileOnly) error('Você ainda não faz parte de uma pelada.', 409);
        const profile = group.state.athletes.find(athlete => athlete.id === user.athleteId) || profileForUser(user)?.profile;
        if (!profile) error('Seu perfil de atleta não foi encontrado.', 409);
        const others = repository.usersForGroup(group.id).filter(member => member.id !== user.id);
        const remaining = membershipsOf(user).filter(membership => membership.groupId !== group.id && repository.groupById(membership.groupId));
        let fallback = remaining.length ? repository.groupById(remaining[0].groupId) : null;
        if (fallback) repository.setActiveGroup(user.id, fallback.id);
        else {
          let code; do { code = randomBytes(6).toString('hex').toUpperCase(); } while (repository.groupByInvite(code));
          fallback = { id:`group-${randomUUID()}`, name:'Meu perfil', inviteCode:code, revision:1, state:{ version:1, athletes:[copy(profile)], rounds:[], profileOnly:true } };
          repository.insertGroup(fallback);
          repository.updateUserMembership(user.id, fallback.id, 'member', true);
        }
        if (others.length) {
          if (membershipRole(user, group.id) === 'organizer') repository.updateUserRole(others[0].id, group.id, 'organizer');
          group.state = withoutAccountData(group.state, user);
          group.revision++;
          repository.updateGroup(group);
        }
        repository.removeUserMembership(user.id, group.id);
        if (!others.length) { repository.deleteRequestsForGroup(group.id); repository.deleteGroup(group.id); }
        const current = repository.userById(user.id), active = repository.groupById(current.groupId);
        return sessionFor(current, active);
      });
    },
    async saveState(token, input = {}) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== group.revision) error('A turma foi atualizada em outro aparelho. Recarregue os dados e tente novamente.', 409);
        object(input.state, 'Estado');
        const next = validateState(input.state, group.state, repository.usersForGroup(group.id));
        if (user.role !== 'organizer') validateMemberChanges(group.state, next, user);
        const previousProfile = group.state.athletes.find(athlete => athlete.id === user.athleteId);
        const nextProfile = next.athletes.find(athlete => athlete.id === user.athleteId);
        const personalChanged = Boolean(previousProfile && nextProfile && !isDeepStrictEqual(personalProfileOf(previousProfile), personalProfileOf(nextProfile)));
        group.state = next; group.revision++; repository.updateGroup(group);
        if (personalChanged) {
          repository.updateUserName(user.id, nextProfile.name);
          for (const membership of membershipsOf(user)) {
            if (membership.groupId === group.id) continue;
            const otherGroup = repository.groupById(membership.groupId), otherProfile = otherGroup?.state?.athletes?.find(athlete => athlete.id === user.athleteId);
            if (!otherGroup || !otherProfile) continue;
            applyPersonalProfile(otherProfile, nextProfile);
            otherGroup.revision++;
            repository.updateGroup(otherGroup);
          }
        }
        return sessionFor(repository.userById(user.id), group);
      });
    },
    async close() { if (!closed) { repository.close(); closed = true; } },
  };
}
