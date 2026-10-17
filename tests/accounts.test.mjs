import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createAccountStore } from '../accounts.mjs';
import { createSeed, saveFantasy, setMatchStatus, closeRound, reopenRound, recordEvent } from '../domain.mjs';

const scratch = resolve(dirname(fileURLToPath(import.meta.url)), '../../../work');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FfAAAAAASUVORK5CYII=';
const copy = value => structuredClone(value);
const status = code => err => err.status === code && err.code === code;

async function fixture(t, withMember = true) {
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'accounts-test-'));
  const path = join(directory, 'accounts.sqlite');
  const store = await createAccountStore({ path });
  t.after(() => store.close());
  const admin = await store.register({ name: 'Rafael Teste', email: 'organizador@example.com', password: 'senha-ficticia-123', groupName: 'Turma dos Testes' });
  const member = withMember ? await store.register({ name: 'João Teste', email: 'membro@example.com', password: 'outra-senha-123', inviteCode: admin.session.group.inviteCode }) : null;
  return { store, path, admin, member };
}

async function configure(store, admin) {
  const current = await store.getState(admin.token), seed = createSeed();
  const state = { ...current.state, athletes: [...current.state.athletes, ...seed.athletes], rounds: seed.rounds };
  return store.saveState(admin.token, { state, expectedRevision: current.revision });
}

test('cadastro cria conta, turma vazia e perfil60; e-mail e convite são normalizados', async t => {
  const { store, admin, member } = await fixture(t);
  assert.equal(admin.token.length, 64);
  assert.equal(admin.session.group.role, 'organizer');
  assert.equal(admin.session.state.athletes.length, 1);
  assert.deepEqual(admin.session.state.rounds, []);
  assert.equal(admin.session.revision, 1);
  assert.equal(member.session.group.role, 'member');
  assert.equal(member.session.group.id, admin.session.group.id);
  assert.ok(!Object.hasOwn(member.session.group, 'inviteCode'));
  assert.equal(member.session.revision, 2);
  const athlete = member.session.state.athletes.find(a => a.id === member.session.athleteId);
  assert.equal(athlete.contact, 'membro@example.com');
  for (const attributes of Object.values(athlete.baseSkills)) assert.ok(Object.values(attributes).every(value => value === 60));
  const login = await store.login({ email: '  ORGANIZADOR@EXAMPLE.COM  ', password: 'senha-ficticia-123' });
  assert.equal(login.session.user.id, admin.session.user.id);
  assert.equal(login.session.state.athletes.length, 2);
});

test('senha e tokens são armazenados como hashes e não aparecem na sessão pública', async t => {
  const { store, path, admin } = await fixture(t, false);
  const serialized = JSON.stringify(await store.getState(admin.token));
  assert.ok(!serialized.includes('password') && !serialized.includes('salt') && !serialized.includes('senha-ficticia-123') && !serialized.includes(admin.token));
  if (store.backend === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path); t.after(() => db.close());
    const user = db.prepare('SELECT password_salt,password_hash FROM users').get();
    assert.equal(user.password_salt.length, 32); assert.equal(user.password_hash.length, 128);
    assert.notEqual(user.password_hash, 'senha-ficticia-123');
    const session = db.prepare('SELECT token_hash FROM sessions').get();
    assert.notEqual(session.token_hash, admin.token);
    assert.equal(session.token_hash, createHash('sha256').update(admin.token).digest('hex'));
  } else {
    const disk = await readFile(`${path}.json`, 'utf8');
    assert.ok(!disk.includes(admin.token) && !disk.includes('senha-ficticia-123'));
  }
});

test('salt é individual mesmo quando duas contas usam a mesma senha', async t => {
  const { store, path, admin } = await fixture(t, false);
  await store.register({ name: 'Outro Teste', email: 'outro@example.com', password: 'senha-ficticia-123', inviteCode: admin.session.group.inviteCode.toLowerCase() });
  if (store.backend === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path); t.after(() => db.close());
    const rows = db.prepare('SELECT password_salt,password_hash FROM users').all();
    assert.notEqual(rows[0].password_salt, rows[1].password_salt); assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  }
});

test('contas, dados e sessões sobrevivem ao fechamento e reabertura do banco', async t => {
  const { store, path, admin } = await fixture(t, false);
  let session = await store.getState(admin.token);
  session.state.athletes[0].nickname = 'Persistente';
  await store.saveState(admin.token, { state: session.state, expectedRevision: session.revision });
  await store.close();
  const reopened = await createAccountStore({ path }); t.after(() => reopened.close());
  const existing = await reopened.session(admin.token);
  assert.equal(existing.state.athletes[0].nickname, 'Persistente'); assert.equal(existing.revision, 2);
  assert.equal((await reopened.login({ email: 'organizador@example.com', password: 'senha-ficticia-123' })).session.user.id, admin.session.user.id);
});

test('valida senha mínima, e-mail único, convite e credenciais incorretas', async t => {
  const { store } = await fixture(t, false);
  await assert.rejects(store.register({ name: 'Novo Teste', email: 'novo@example.com', password: 'curta', groupName: 'Turma Nova' }), status(400));
  await assert.rejects(store.register({ name: 'Novo Teste', email: 'ORGANIZADOR@example.com', password: 'senha-nova-123', groupName: 'Turma Nova' }), status(409));
  await assert.rejects(store.register({ name: 'Novo Teste', email: 'novo@example.com', password: 'senha-nova-123', inviteCode: 'INEXISTENTE' }), status(400));
  await assert.rejects(store.login({ email: 'organizador@example.com', password: 'senha-errada' }), status(401));
  await assert.rejects(store.login({ email: 'inexistente@example.com', password: 'senha-errada' }), status(401));
  assert.equal(await store.session('token-invalido'), null);
  await assert.rejects(store.getState('token-invalido'), status(401));
});

test('peladas têm nome único, busca por nome ou ID e entrada direta pelo link', async t => {
  const { store, admin } = await fixture(t, false);
  const profile = await store.register({ name: 'Convidado Teste', email: 'convidado@example.com', password: 'senha-convidado-123' });
  await assert.rejects(store.createGroup(profile.token, { name: '  Túrma   dos testes ', weeklyDay: 'Quarta', weeklyTime: '20:00' }), status(409));
  await assert.rejects(store.register({ name: 'Outro Organizador', email: 'outro-organizador@example.com', password: 'senha-organizador-123', groupName: 'TURMA DOS TESTES' }), status(409));
  const byName = await store.searchGroups('turma dos');
  const byId = await store.searchGroups(admin.session.group.inviteCode.toLowerCase());
  assert.equal(byName[0].id, admin.session.group.id);
  assert.equal(byId[0].publicId, admin.session.group.inviteCode);
  const joined = await store.joinByInvite(profile.token, admin.session.group.inviteCode.toLowerCase());
  assert.equal(joined.group.id, admin.session.group.id);
  assert.equal(joined.group.role, 'member');
  assert.equal(joined.state.athletes.length, 2);
  await assert.rejects(store.joinByInvite(profile.token, admin.session.group.inviteCode), status(409));
});

test('pelada fixa guarda recorrência e pelada avulsa aceita somente um evento na data configurada', async t => {
  const { store } = await fixture(t, false);
  const recurringProfile = await store.register({ name: 'Fixo Teste', email: 'fixo@example.com', password: 'senha-fixa-123' });
  const recurring = await store.createGroup(recurringProfile.token, { name: 'Futebol de Quarta', scheduleType: 'recurring', weeklyDay: 'Quarta', weeklyTime: '20:30' });
  assert.equal(recurring.group.scheduleType, 'recurring');
  assert.equal(recurring.group.weeklyDay, 'Quarta');
  const singleProfile = await store.register({ name: 'Avulso Teste', email: 'avulso@example.com', password: 'senha-avulsa-123' });
  const single = await store.createGroup(singleProfile.token, { name: 'Jogo Beneficente', scheduleType: 'single', singleDate: '2026-12-12', singleTime: '18:00' });
  assert.equal(single.group.scheduleType, 'single');
  assert.equal(single.group.singleDate, '2026-12-12');
  const seed = createSeed(), event = { ...seed.rounds[1], id: 'evento-unico', title: 'Jogo Beneficente', date: '2026-12-12', time: '18:00', teams: [], matches: [], events: [], fantasy: [], confirmedAthleteIds: [single.athleteId] };
  let current = await store.getState(singleProfile.token);
  current.state.rounds = [event];
  const saved = await store.saveState(singleProfile.token, { state: current.state, expectedRevision: current.revision });
  assert.equal(saved.state.rounds.length, 1);
  current = await store.getState(singleProfile.token); current.state.rounds.push({ ...event, id: 'evento-extra' });
  await assert.rejects(store.saveState(singleProfile.token, { state: current.state, expectedRevision: current.revision }), status(409));
});

test('logout invalida somente o token utilizado e sessões expiram em sete dias', async t => {
  const { store, path, admin } = await fixture(t, false);
  const other = await store.login({ email: 'organizador@example.com', password: 'senha-ficticia-123' });
  await store.logout(admin.token); assert.equal(await store.session(admin.token), null); assert.ok(await store.session(other.token));
  if (store.backend === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path); t.after(() => db.close());
    const entry = db.prepare('SELECT expires_at FROM sessions').get();
    assert.ok(entry.expires_at > Date.now() + 6.99 * 24 * 60 * 60 * 1000);
    db.prepare('UPDATE sessions SET expires_at=?').run(Date.now() - 1);
    assert.equal(await store.session(other.token), null);
    await assert.rejects(store.saveState(other.token, { state: other.session.state, expectedRevision: other.session.revision }), status(401));
  }
});

test('exclusão exige a senha e apaga a turma quando o organizador é o único membro', async t => {
  const { store, admin } = await fixture(t, false);
  await assert.rejects(store.deleteAccount(admin.token, { password: 'senha-incorreta' }), status(401));
  assert.equal((await store.session(admin.token)).user.id, admin.session.user.id);
  const result = await store.deleteAccount(admin.token, { password: 'senha-ficticia-123' });
  assert.deepEqual(result, { ok: true, groupDeleted: true });
  assert.equal(await store.session(admin.token), null);
  await assert.rejects(store.login({ email: 'organizador@example.com', password: 'senha-ficticia-123' }), status(401));
});

test('exclusão do organizador promove outro membro e remove seus dados pessoais', async t => {
  const { store, admin, member } = await fixture(t);
  const current = await store.getState(admin.token), seed = createSeed();
  seed.rounds[0].teams[0].athleteIds.push(admin.session.athleteId);
  await store.saveState(admin.token, { state: { ...current.state, athletes: [...current.state.athletes, ...seed.athletes], rounds: seed.rounds }, expectedRevision: current.revision });
  const extraSession = await store.login({ email: 'organizador@example.com', password: 'senha-ficticia-123' });
  const result = await store.deleteAccount(admin.token, { password: 'senha-ficticia-123' });
  assert.deepEqual(result, { ok: true, groupDeleted: false });
  assert.equal(await store.session(admin.token), null);
  assert.equal(await store.session(extraSession.token), null);
  const successor = await store.getState(member.token);
  assert.equal(successor.group.role, 'organizer');
  const historicalProfile = successor.state.athletes.find(athlete => athlete.id === admin.session.athleteId);
  assert.equal(historicalProfile.name, 'Atleta removido');
  assert.equal(historicalProfile.photo, '');
  assert.equal(successor.state.athletes.some(athlete => athlete.contact === 'organizador@example.com'), false);
});

test('revisão evita sobrescrita e novo membro invalida snapshots antigos', async t => {
  const { store, admin } = await fixture(t);
  await assert.rejects(store.saveState(admin.token, { state: admin.session.state, expectedRevision: admin.session.revision }), status(409));
  const current = await store.getState(admin.token), first = copy(current.state), second = copy(current.state);
  first.athletes[0].nickname = 'Primeiro'; second.athletes[0].nickname = 'Segundo';
  await store.saveState(admin.token, { state: first, expectedRevision: current.revision });
  await assert.rejects(store.saveState(admin.token, { state: second, expectedRevision: current.revision }), status(409));
  assert.equal((await store.getState(admin.token)).state.athletes[0].nickname, 'Primeiro');
});

test('membro pode editar apenas os campos pessoais de seu perfil, preservando propriedades adicionais', async t => {
  const { store, admin, member } = await fixture(t);
  let current = await store.getState(admin.token);
  current.state.athletes.find(a => a.id === member.session.athleteId).registrationNote = 'campo preservado';
  await store.saveState(admin.token, { state: current.state, expectedRevision: current.revision });
  current = await store.getState(member.token);
  const own = current.state.athletes.find(a => a.id === member.session.athleteId);
  own.name = 'João Atualizado'; own.nickname = 'Jotinha'; own.contact = '+55 85 99999-0000'; own.photo = png; own.preferences.futsal.primary = 'Goleiro';
  const next = await store.saveState(member.token, { state: current.state, expectedRevision: current.revision });
  assert.equal(next.state.athletes.find(a => a.id === own.id).registrationNote, 'campo preservado');
  assert.equal(next.state.athletes.find(a => a.id === own.id).nickname, 'Jotinha');
  current = await store.getState(member.token);
  current.state.athletes.find(a => a.id === own.id).registrationNote = 'tentativa';
  await assert.rejects(store.saveState(member.token, { state: current.state, expectedRevision: current.revision }), status(403));
});

test('membro não pode alterar skills, outros atletas, cadastros ou peladas', async t => {
  const { store, member } = await fixture(t);
  for (const change of [
    state => { state.athletes.find(a => a.id === member.session.athleteId).baseSkills.futsal.fin = 99; },
    state => { state.athletes[0].nickname = 'Adulterado'; },
    state => { state.athletes.push({ ...copy(state.athletes[0]), id: 'novo-atleta' }); },
    state => { state.rounds = createSeed().rounds; state.athletes.push(...createSeed().athletes); },
  ]) {
    const current = await store.getState(member.token); change(current.state);
    await assert.rejects(store.saveState(member.token, { state: current.state, expectedRevision: current.revision }), status(403));
  }
});

test('organizador também não pode remover o perfil de um membro real', async t => {
  const { store, admin, member } = await fixture(t);
  const current = await store.getState(admin.token);
  current.state.athletes = current.state.athletes.filter(a => a.id !== member.session.athleteId);
  await assert.rejects(store.saveState(admin.token, { state: current.state, expectedRevision: current.revision }), status(403));
});

test('membro cria e edita apenas seu fantasy em rascunho; dono é validado pelo userId', async t => {
  const { store, admin, member } = await fixture(t); await configure(store, admin);
  let current = await store.getState(member.token);
  const payload = { id: 'fantasy-membro', name: 'Meu Fantasy', owner: 'João', athleteIds: ['atleta-01', 'atleta-03', 'atleta-05', 'atleta-08', 'atleta-14'] };
  let changed = saveFantasy(current.state, 'pelada-02', payload);
  changed.rounds[1].fantasy[0].ownerUserId = member.session.user.id;
  await store.saveState(member.token, { state: changed, expectedRevision: current.revision });
  current = await store.getState(member.token); current.state.rounds[1].fantasy[0].name = 'Meu Fantasy FC';
  await store.saveState(member.token, { state: current.state, expectedRevision: current.revision });
  current = await store.getState(member.token); current.state.rounds[1].fantasy[0].ownerUserId = admin.session.user.id;
  await assert.rejects(store.saveState(member.token, { state: current.state, expectedRevision: current.revision }), status(403));
  current = await store.getState(member.token); changed = saveFantasy(current.state, 'pelada-02', { ...payload, id: 'fantasy-forjado' });
  changed.rounds[1].fantasy.at(-1).ownerUserId = admin.session.user.id;
  await assert.rejects(store.saveState(member.token, { state: changed, expectedRevision: current.revision }), status(403));
});

test('fantasy alheio e escalações após início não podem ser modificados nem por organizador', async t => {
  const { store, admin, member } = await fixture(t); await configure(store, admin);
  let current = await store.getState(member.token); current.state.rounds[0].fantasy[0].name = 'Time Adulterado';
  await assert.rejects(store.saveState(member.token, { state: current.state, expectedRevision: current.revision }), status(403));
  current = await store.getState(admin.token); current.state.rounds[0].fantasy[0].athleteIds[0] = 'atleta-06';
  await assert.rejects(store.saveState(admin.token, { state: current.state, expectedRevision: current.revision }), status(403));
});

test('validação autoritativa rejeita fantasy incompleto, lance fora de equipe e defesa de jogador de linha', async t => {
  const { store, admin } = await fixture(t); await configure(store, admin);
  for (const change of [
    state => { state.rounds[1].fantasy.push({ id: 'incompleto', name: 'Incompleto', owner: 'Rafa', ownerUserId: admin.session.user.id, athleteIds: ['atleta-01'] }); },
    state => { state.rounds[0].events.push({ id: 'fora', matchId: 'jogo-3', athleteId: 'atleta-06', type: 'goal', createdAt: new Date().toISOString() }); },
    state => { state.rounds[0].events.push({ id: 'nao-goleiro', matchId: 'jogo-3', athleteId: 'atleta-02', type: 'save', createdAt: new Date().toISOString() }); },
  ]) {
    const current = await store.getState(admin.token); change(current.state);
    await assert.rejects(store.saveState(admin.token, { state: current.state, expectedRevision: current.revision }), status(400));
  }
});

test('snapshot de posições permanece estável após preferência do atleta mudar', async t => {
  const { store, admin } = await fixture(t); await configure(store, admin);
  let current = await store.getState(admin.token);
  assert.equal(current.state.rounds[0].positions['atleta-01'], 'Goleiro');
  current.state.athletes.find(a => a.id === 'atleta-01').preferences.futsal.primary = 'Fixo';
  const saved = await store.saveState(admin.token, { state: current.state, expectedRevision: current.revision });
  assert.equal(saved.state.rounds[0].positions['atleta-01'], 'Goleiro');
  current = await store.getState(admin.token); current.state.rounds[0].positions['atleta-01'] = 'Fixo';
  await assert.rejects(store.saveState(admin.token, { state: current.state, expectedRevision: current.revision }), status(403));
});

test('fechamento oficial exige jogos encerrados e correção exige reabertura persistida', async t => {
  const { store, admin } = await fixture(t); await configure(store, admin);
  let current = await store.getState(admin.token), changed = copy(current.state);
  changed.rounds[0].status = 'closed'; changed.rounds[0].revision = 1; changed.rounds[0].closedAt = new Date().toISOString();
  await assert.rejects(store.saveState(admin.token, { state: changed, expectedRevision: current.revision }), status(400));
  changed = closeRound(setMatchStatus(current.state, 'pelada-01', 'jogo-3', 'finished'), 'pelada-01');
  await store.saveState(admin.token, { state: changed, expectedRevision: current.revision });
  current = await store.getState(admin.token); changed = copy(current.state); changed.rounds[0].events.pop();
  await assert.rejects(store.saveState(admin.token, { state: changed, expectedRevision: current.revision }), status(403));
  changed = recordEvent(reopenRound(current.state, 'pelada-01'), 'pelada-01', { id: 'correcao', athleteId: 'atleta-05', matchId: 'jogo-3', type: 'goal' });
  await assert.rejects(store.saveState(admin.token, { state: changed, expectedRevision: current.revision }), status(403));
  await store.saveState(admin.token, { state: reopenRound(current.state, 'pelada-01'), expectedRevision: current.revision });
  current = await store.getState(admin.token);
  changed = recordEvent(current.state, 'pelada-01', { id: 'correcao', athleteId: 'atleta-05', matchId: 'jogo-3', type: 'goal' });
  changed = closeRound(changed, 'pelada-01');
  const saved = await store.saveState(admin.token, { state: changed, expectedRevision: current.revision });
  assert.equal(saved.state.rounds[0].revision, 2);
  current = await store.getState(admin.token); current.state.rounds[0].revision = 1;
  await assert.rejects(store.saveState(admin.token, { state: current.state, expectedRevision: current.revision }), status(403));
});

test('schema e limites rejeitam duplicatas, fotos perigosas e limites de atletas/peladas/lances', async t => {
  const { store, admin } = await fixture(t, false);
  for (const change of [
    state => { state.athletes.push(copy(state.athletes[0])); },
    state => { state.athletes[0].photo = 'data:image/svg+xml,<svg onload="alert(1)"></svg>'; },
    state => { state.athletes[0].photo = 'https://example.com/foto.jpg'; },
    state => { state.athletes[0].photo = `data:image/png;base64,${Buffer.from('nao e PNG').toString('base64')}`; },
    state => { state.athletes[0].photo = 'a'.repeat(2 * 1024 * 1024 + 1); },
    state => { state.athletes = Array.from({ length: 301 }, (_, index) => ({ ...copy(state.athletes[0]), id: index ? `athlete-${index}` : state.athletes[0].id })); },
    state => { state.rounds = Array(101).fill({}); },
    state => { state.rounds = createSeed().rounds; state.athletes.push(...createSeed().athletes); state.rounds[0].events = Array(10001).fill({}); },
  ]) {
    const current = await store.getState(admin.token); change(current.state);
    await assert.rejects(store.saveState(admin.token, { state: current.state, expectedRevision: current.revision }), status(400));
  }
});

test('salvar em uma turma não altera outra turma nem autoriza acesso com sessão inválida', async t => {
  const { store, admin } = await fixture(t, false);
  const second = await store.register({ name: 'Outra Turma', email: 'outra@example.com', password: 'senha-outra-123', groupName: 'Turma Separada' });
  const current = await store.getState(admin.token); current.state.athletes[0].nickname = 'Turma A';
  await store.saveState(admin.token, { state: current.state, expectedRevision: current.revision });
  assert.equal((await store.getState(second.token)).state.athletes.length, 1);
  assert.notEqual(second.session.group.id, admin.session.group.id);
  await assert.rejects(store.saveState('invalido', { state: current.state, expectedRevision: 1 }), status(401));
});
