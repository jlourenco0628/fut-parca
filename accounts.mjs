import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { MODALITIES, EVENT_RULES, beginRound, closeRound, saveFantasy } from './domain.mjs';

const scrypt = promisify(scryptCallback);
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const ATTRIBUTE_KEYS = ['rit', 'fin', 'pas', 'con', 'def', 'fis', 'div', 'han', 'kic', 'ref', 'spd', 'pos'];
const PERSONAL_FIELDS = new Set(['name', 'nickname', 'contact', 'photo', 'avatar', 'sex', 'birthDate', 'preferences']);
const EVENT_TYPES = new Map(EVENT_RULES.map(rule => [rule.type, rule]));
const copy = value => structuredClone(value);
const hashToken = token => createHash('sha256').update(token).digest('hex');

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

function uniqueId(seen, value, label) {
  identifier(value, label);
  if (seen.has(value)) error(`${label} repetido.`);
  seen.add(value);
}

function newAthlete(name, email, profile = {}) {
  return {
    id: `athlete-${randomUUID()}`, name, nickname: String(profile.nickname || name.split(/\s+/u)[0]).slice(0, 18), contact: String(profile.contact || email), photo: String(profile.photo || ''),
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

function publicSession(user, group) {
  return {
    user: { id: user.id, name: user.name, email: user.email },
    group: { id: group.id, name: group.name, role: user.role, profileOnly: Boolean(group.state.profileOnly), logo: group.state.logo || '', weeklyDay: group.state.weeklyDay || '', weeklyTime: group.state.weeklyTime || '', ...(user.role === 'organizer' ? { inviteCode: group.inviteCode } : {}) },
    athleteId: user.athleteId, revision: group.revision, state: copy(group.state),
  };
}

async function openRepository(path) {
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
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS join_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), group_id TEXT NOT NULL REFERENCES groups(id), status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id, group_id));
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);`);
    const groupRow = row => row ? { id: row.id, name: row.name, inviteCode: row.invite_code, revision: row.revision, state: JSON.parse(row.state_json) } : undefined;
    const userRow = row => row ? { id: row.id, name: row.name, email: row.email, groupId: row.group_id, role: row.role, athleteId: row.athlete_id, salt: row.password_salt, hash: row.password_hash } : undefined;
    return {
      kind: 'sqlite', path,
      transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (err) { db.exec('ROLLBACK'); throw err; } },
      userByEmail: email => userRow(db.prepare('SELECT * FROM users WHERE email=?').get(email)),
      userById: id => userRow(db.prepare('SELECT * FROM users WHERE id=?').get(id)),
      usersForGroup: id => db.prepare('SELECT * FROM users WHERE group_id=?').all(id).map(userRow),
      groupById: id => groupRow(db.prepare('SELECT * FROM groups WHERE id=?').get(id)),
      groupByInvite: code => groupRow(db.prepare('SELECT * FROM groups WHERE invite_code=?').get(code)),
      allGroups: () => db.prepare('SELECT * FROM groups').all().map(groupRow),
      insertGroup(group) { db.prepare('INSERT INTO groups VALUES (?,?,?,?,?)').run(group.id, group.name, group.inviteCode, group.revision, JSON.stringify(group.state)); },
      updateGroup(group) { db.prepare('UPDATE groups SET name=?,revision=?,state_json=? WHERE id=?').run(group.name, group.revision, JSON.stringify(group.state), group.id); },
      deleteGroup(id) { db.prepare('DELETE FROM groups WHERE id=?').run(id); },
      insertUser(user) { db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(user.id, user.name, user.email, user.groupId, user.role, user.athleteId, user.salt, user.hash); },
      updateUserRole(id, role) { db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id); },
      updateUserMembership(id, groupId, role) { db.prepare('UPDATE users SET group_id=?,role=? WHERE id=?').run(groupId, role, id); },
      requestByUserGroup(userId, groupId) { return db.prepare('SELECT * FROM join_requests WHERE user_id=? AND group_id=?').get(userId, groupId); },
      requestsForGroup(groupId) { return db.prepare('SELECT * FROM join_requests WHERE group_id=? ORDER BY created_at').all(groupId); },
      requestById(id) { return db.prepare('SELECT * FROM join_requests WHERE id=?').get(id); },
      insertRequest(request) { db.prepare('INSERT INTO join_requests VALUES (?,?,?,?,?)').run(request.id, request.userId, request.groupId, request.status, request.createdAt); },
      updateRequest(id, status) { db.prepare('UPDATE join_requests SET status=? WHERE id=?').run(status, id); },
      deleteUser(id) { db.prepare('DELETE FROM users WHERE id=?').run(id); },
      sessionByHash: hash => { const row = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash); return row ? { userId: row.user_id, expiresAt: row.expires_at } : undefined; },
      insertSession(hash, userId, expiresAt) { db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash, userId, expiresAt); },
      deleteSession(hash) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); },
      deleteSessionsForUser(userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); },
      close() { db.close(); },
    };
  }
  const jsonPath = `${path}.json`;
  let data = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : { version: 2, users: [], groups: [], sessions: [], joinRequests: [] };
  data.joinRequests ||= [];
  let inTransaction = false;
  const persist = () => { const temporary = `${jsonPath}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, jsonPath); };
  const read = fn => { if (!inTransaction) data = JSON.parse(readFileSync(jsonPath, 'utf8')); return fn(); };
  if (!existsSync(jsonPath)) persist();
  return {
    kind: 'json', path: jsonPath,
    transaction(fn) {
      // Recarregar também evita revisões antigas em duas instâncias no mesmo processo.
      data = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const previous = copy(data);
      inTransaction = true;
      try { const result = fn(); persist(); return result; } catch (err) { data = previous; throw err; } finally { inTransaction = false; }
    },
    userByEmail: email => read(() => data.users.find(user => user.email === email)), userById: id => read(() => data.users.find(user => user.id === id)),
    usersForGroup: id => read(() => data.users.filter(user => user.groupId === id)), groupById: id => read(() => data.groups.find(group => group.id === id)),
    groupByInvite: code => read(() => data.groups.find(group => group.inviteCode === code)), insertGroup: group => data.groups.push(copy(group)),
    allGroups: () => read(() => data.groups.map(copy)),
    updateGroup(group) { data.groups[data.groups.findIndex(item => item.id === group.id)] = copy(group); },
    deleteGroup(id) { data.groups = data.groups.filter(group => group.id !== id); },
    insertUser: user => data.users.push(copy(user)),
    updateUserRole(id, role) { const user = data.users.find(item => item.id === id); if (user) user.role = role; },
    updateUserMembership(id, groupId, role) { const user = data.users.find(item => item.id === id); if (user) { user.groupId = groupId; user.role = role; } },
    requestByUserGroup: (userId, groupId) => read(() => data.joinRequests.find(item => item.userId === userId && item.groupId === groupId)),
    requestsForGroup: groupId => read(() => data.joinRequests.filter(item => item.groupId === groupId)),
    requestById: id => read(() => data.joinRequests.find(item => item.id === id)),
    insertRequest: request => data.joinRequests.push(copy(request)),
    updateRequest(id, status) { const item = data.joinRequests.find(request => request.id === id); if (item) item.status = status; },
    deleteUser(id) { data.users = data.users.filter(user => user.id !== id); },
    sessionByHash: hash => read(() => data.sessions.find(session => session.hash === hash)),
    insertSession(hash, userId, expiresAt) { data.sessions = data.sessions.filter(session => session.expiresAt > Date.now()); data.sessions.push({ hash, userId, expiresAt }); },
    deleteSession(hash) { data.sessions = data.sessions.filter(session => session.hash !== hash); },
    deleteSessionsForUser(userId) { data.sessions = data.sessions.filter(session => session.userId !== userId); }, close() {},
  };
}

function validateState(input, previous, users) {
  object(input, 'Estado');
  if (input.version !== 1) error('Versão de estado inválida.');
  list(input.athletes, 'Atletas', 300);
  list(input.rounds, 'Peladas', 100);
  const state = copy(input), athleteIds = new Set(), roundIds = new Set();
  const byAthlete = new Map();
  for (const athlete of state.athletes) {
    object(athlete, 'Atleta'); uniqueId(athleteIds, athlete.id, 'Identificador de atleta');
    text(athlete.name, 'Nome do atleta', 80); text(athlete.nickname, 'Apelido', 18); text(athlete.contact, 'Contato', 254);
    validatePhoto(athlete.photo);
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

export async function createAccountStore({ path } = {}) {
  if (typeof path !== 'string' || !path) error('Informe o arquivo do banco de contas.');
  const repository = await openRepository(path);
  let closed = false;
  const lookup = token => {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const hash = hashToken(token), entry = repository.sessionByHash(hash);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    const user = repository.userById(entry.userId);
    if (!user) return null;
    const group = repository.groupById(user.groupId);
    return group ? { user, group } : null;
  };
  const requireSession = token => lookup(token) || error('Entre na sua conta para continuar.', 401);
  const issueSession = user => { const token = randomBytes(32).toString('hex'); repository.insertSession(hashToken(token), user.id, Date.now() + SESSION_LIFETIME); return token; };
  return {
    backend: repository.kind,
    async register(input = {}) {
      const name = text(input.name, 'Nome', 80, 2), email = emailOf(input.email), password = passwordOf(input.password);
      const inviteCode = input.inviteCode ? text(input.inviteCode, 'Convite', 24).toUpperCase() : '';
      const groupName = !inviteCode && input.groupName ? text(input.groupName, 'Nome da turma', 80, 2) : '';
      const salt = randomBytes(16).toString('hex'), hash = (await scrypt(password, salt, 64)).toString('hex');
      return repository.transaction(() => {
        if (repository.userByEmail(email)) error('Já existe uma conta com este e-mail.', 409);
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
        const user = { id: `user-${randomUUID()}`, name, email, groupId: group.id, role: inviteCode || !groupName ? 'member' : 'organizer', athleteId: athlete.id, salt, hash };
        repository.insertUser(user);
        const token = issueSession(user);
        return { token, session: publicSession(user, group) };
      });
    },
    async login(input = {}) {
      const email = emailOf(input.email);
      if (typeof input.password !== 'string' || input.password.length > 128) error('E-mail ou senha incorretos.', 401);
      const user = repository.userByEmail(email);
      const candidate = await scrypt(input.password, user?.salt || 'fut-parca-invalid-account', 64);
      const expected = user ? Buffer.from(user.hash, 'hex') : Buffer.alloc(64);
      if (!user || candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) error('E-mail ou senha incorretos.', 401);
      return repository.transaction(() => ({ token: issueSession(user), session: publicSession(user, repository.groupById(user.groupId)) }));
    },
    async session(token) { const current = lookup(token); return current ? publicSession(current.user, current.group) : null; },
    async logout(token) { if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) repository.transaction(() => repository.deleteSession(hashToken(token))); return { ok: true }; },
    async deleteAccount(token, input = {}) {
      const current = requireSession(token);
      if (typeof input.password !== 'string' || input.password.length > 128) error('Senha incorreta.', 401);
      const candidate = await scrypt(input.password, current.user.salt, 64);
      const expected = Buffer.from(current.user.hash, 'hex');
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) error('Senha incorreta.', 401);
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (user.id !== current.user.id) error('Entre novamente para excluir sua conta.', 401);
        const members = repository.usersForGroup(group.id);
        repository.deleteSessionsForUser(user.id);
        repository.deleteUser(user.id);
        if (members.length === 1) {
          repository.deleteGroup(group.id);
          return { ok: true, groupDeleted: true };
        }
        if (user.role === 'organizer') repository.updateUserRole(members.find(member => member.id !== user.id).id, 'organizer');
        group.state = withoutAccountData(group.state, user);
        group.revision++;
        repository.updateGroup(group);
        return { ok: true, groupDeleted: false };
      });
    },
    async getState(token) { const { user, group } = requireSession(token); return publicSession(user, group); },
    async searchGroups(query = '') {
      const term = String(query || '').trim().toLocaleLowerCase('pt-BR').slice(0, 80);
      return repository.allGroups().filter(group => !group.state.profileOnly && (!term || group.name.toLocaleLowerCase('pt-BR').includes(term))).slice(0, 40).map(group => ({ id: group.id, name: group.name, logo: group.state.logo || '', weeklyDay: group.state.weeklyDay || '', weeklyTime: group.state.weeklyTime || '', members: group.state.athletes.length }));
    },
    async createGroup(token, input = {}) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (!group.state.profileOnly) error('Você já faz parte de uma pelada.', 409);
        group.name = text(input.name, 'Nome da pelada', 80, 2);
        validatePhoto(String(input.logo || ''));
        group.state = { ...group.state, profileOnly: false, logo: String(input.logo || ''), weeklyDay: text(input.weeklyDay, 'Dia da semana', 12), weeklyTime: text(input.weeklyTime, 'Horário', 5) };
        if (!/^\d{2}:\d{2}$/.test(group.state.weeklyTime)) error('Horário inválido.');
        group.revision++; repository.updateGroup(group); repository.updateUserRole(user.id, 'organizer'); user.role = 'organizer';
        return publicSession(user, group);
      });
    },
    async requestJoin(token, groupId) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (!group.state.profileOnly) error('Você já faz parte de uma pelada.', 409);
        const target = repository.groupById(identifier(groupId, 'Pelada'));
        if (!target || target.state.profileOnly) error('Pelada não encontrada.', 404);
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
      return repository.requestsForGroup(group.id).filter(item => item.status === 'pending').map(item => { const applicant = repository.userById(item.user_id || item.userId); const source = applicant && repository.groupById(applicant.groupId); const profile = source?.state.athletes.find(a => a.id === applicant.athleteId); return { id: item.id, name: applicant?.name || 'Atleta', nickname: profile?.nickname || '', sex: profile?.sex || '', photo: profile?.photo || '' }; });
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
        const applicant = repository.userById(requestUserId), source = applicant && repository.groupById(applicant.groupId);
        if (!applicant || !source?.state.profileOnly) error('Este atleta já entrou em outra pelada.', 409);
        const profile = source.state.athletes.find(a => a.id === applicant.athleteId);
        if (!profile || group.state.athletes.length >= 300) error('Não foi possível adicionar este atleta.');
        group.state.athletes.push(profile); group.revision++; repository.updateGroup(group);
        repository.updateUserMembership(applicant.id, group.id, 'member'); repository.updateRequest(request.id, 'approved'); repository.deleteGroup(source.id);
        return { ok: true };
      });
    },
    async saveState(token, input = {}) {
      return repository.transaction(() => {
        const { user, group } = requireSession(token);
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== group.revision) error('A turma foi atualizada em outro aparelho. Recarregue os dados e tente novamente.', 409);
        object(input.state, 'Estado');
        const next = validateState(input.state, group.state, repository.usersForGroup(group.id));
        if (user.role !== 'organizer') validateMemberChanges(group.state, next, user);
        group.state = next; group.revision++; repository.updateGroup(group);
        return publicSession(user, group);
      });
    },
    async close() { if (!closed) { repository.close(); closed = true; } },
  };
}
