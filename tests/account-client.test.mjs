import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountClient } from '../account_client.mjs';

// Public fixtures only. No browser, real account, database, network or credential.
const roundState = marker => ({ version: 1, athletes: [], rounds: [], marker });
const session = (user = 'alice', revision = 1, marker = `${user}-initial`) => ({
  user: { id: `user-${user}`, name: user, email: `${user}@example.test` },
  group: { id: `group-${user}`, name: `Turma ${user}`, role: 'organizer', inviteCode: 'DEMO1234' },
  athleteId: `athlete-${user}`,
  revision,
  state: roundState(marker),
});
const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return structuredClone(payload); },
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function harness(t, handler) {
  const requests = [], publications = [], errors = [], lifecycle = [];
  t.mock.method(globalThis, 'fetch', async (path, options = {}) => {
    const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined };
    assert.equal(options.credentials, 'same-origin');
    requests.push(request);
    return handler(request);
  });
  const client = createAccountClient({
    onSession(value) { publications.push(structuredClone(value)); lifecycle.push('session'); },
    onSignedOut() { lifecycle.push('signed-out'); },
    onError(message) { errors.push(message); },
  });
  return { client, requests, publications, errors, lifecycle };
}

test('queued saves wait for one another and use each returned revision', async t => {
  const firstWrite = deferred(), secondWrite = deferred();
  let remote = session(), writeCount = 0;
  const { client, requests, publications, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(remote);
    assert.equal(request.path, '/api/state');
    assert.equal(request.method, 'PUT');
    const index = ++writeCount;
    await (index === 1 ? firstWrite.promise : secondWrite.promise);
    assert.equal(request.body.expectedRevision, remote.revision);
    remote = { ...remote, revision: remote.revision + 1, state: request.body.state };
    return response(remote);
  });
  await client.ready();
  const first = client.save(roundState('first-change'));
  const second = client.save(roundState('second-change'));
  assert.equal(client.saving, true);
  await nextTurn();
  assert.equal(writeCount, 1, 'the second write must not start while the first write is pending');
  firstWrite.resolve();
  assert.equal(await first, true);
  await nextTurn();
  assert.equal(writeCount, 2);
  assert.equal(client.saving, true);
  secondWrite.resolve();
  assert.equal(await second, true);
  assert.equal(await client.flush(), true);
  assert.deepEqual(requests.filter(x => x.method === 'PUT').map(x => x.body.expectedRevision), [1, 2]);
  assert.equal(client.current.revision, 3);
  assert.equal(client.current.state.marker, 'second-change');
  assert.equal(publications.at(-1).state.marker, 'second-change');
  assert.equal(client.saving, false);
  assert.deepEqual(errors, []);
});

test('a 409 reloads authoritative state and cancels previously queued changes', async t => {
  const conflictingWrite = deferred(), initial = session('alice', 7), authoritative = session('alice', 8, 'other-device');
  let writes = 0;
  const { client, requests, publications, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(initial);
    assert.equal(request.path, '/api/state');
    if (request.method === 'GET') return response(authoritative);
    writes++;
    await conflictingWrite.promise;
    return response({ error: 'Revision conflict' }, 409);
  });
  await client.ready();
  const first = client.save(roundState('rejected-change'));
  const stale = client.save(roundState('queued-before-conflict'));
  await nextTurn();
  conflictingWrite.resolve();
  assert.equal(await first, false);
  assert.equal(await stale, false);
  assert.equal(await client.flush(), false);
  assert.equal(writes, 1, 'an old queued change must not overwrite the reloaded state');
  assert.deepEqual(requests.map(x => `${x.method} ${x.path}`), ['GET /api/session', 'PUT /api/state', 'GET /api/state']);
  assert.deepEqual(client.current, authoritative);
  assert.deepEqual(publications.at(-1), authoritative);
  assert.equal(client.saving, false);
  assert.match(errors[0], /Outra pessoa atualizou a turma/);
});

test('a delayed sync from the previous account cannot replace a new login', async t => {
  const delayedSync = deferred(), alice = session('alice', 2), bob = session('bob', 11);
  const { client, publications, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(alice);
    if (request.path === '/api/state') return delayedSync.promise;
    if (request.path === '/api/login') return response(bob);
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  const syncing = client.sync();
  await client.login({ email: 'bob@example.test', password: 'fixture-only-password' });
  delayedSync.resolve(response(session('alice', 3, 'late-alice-update')));
  await syncing;
  assert.deepEqual(client.current, bob);
  assert.deepEqual(publications.map(x => x.user.id), ['user-alice', 'user-bob']);
  assert.deepEqual(errors, []);
});

test('uma sincronização atrasada não reabre a pelada anterior após a troca', async t => {
  const delayedSync = deferred(), first = session('alice', 2), second = { ...session('alice', 1, 'segunda-pelada'), group:{ ...session('alice').group, id:'group-second', name:'Segunda pelada' } };
  const { client, publications, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(first);
    if (request.path === '/api/state') return delayedSync.promise;
    if (request.path === '/api/pelada-switch') return response(second);
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  const syncing = client.sync();
  await client.switchGroup(second.group.id);
  delayedSync.resolve(response({ ...first, revision:3, state:roundState('atrasada') }));
  await syncing;
  assert.equal(client.current.group.id, second.group.id);
  assert.deepEqual(publications.map(value => value.group.id), [first.group.id, second.group.id]);
  assert.deepEqual(errors, []);
});

test('sair da pelada mantém a sessão e publica a turma restante', async t => {
  const first = session('alice', 2), remaining = { ...session('alice', 1, 'turma-restante'), group:{ ...session('alice').group, id:'group-remaining', name:'Turma restante' } };
  const { client, requests, publications, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(first);
    if (request.path === '/api/pelada-membership') return response(remaining);
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  await client.leaveGroup();
  assert.deepEqual(requests.at(-1), { path:'/api/pelada-membership', method:'DELETE', body:{} });
  assert.equal(client.current.group.id, remaining.group.id);
  assert.deepEqual(publications.map(value => value.group.id), [first.group.id, remaining.group.id]);
  assert.deepEqual(errors, []);
});

test('logout waits for pending saves before ending the server session', async t => {
  const write = deferred(), initial = session('alice', 3);
  const { client, requests, lifecycle, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(initial);
    if (request.path === '/api/state') {
      await write.promise;
      lifecycle.push('saved');
      return response({ ...initial, revision: 4, state: request.body.state });
    }
    if (request.path === '/api/logout') { lifecycle.push('server-logout'); return response({ ok: true }); }
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  const saving = client.save(roundState('last-change'));
  const leaving = client.logout();
  await nextTurn();
  assert.equal(requests.some(x => x.path === '/api/logout'), false);
  assert.equal(client.current.user.id, 'user-alice');
  write.resolve();
  assert.equal(await saving, true);
  await leaving;
  assert.equal(client.current, null);
  assert.equal(client.saving, false);
  assert.ok(lifecycle.indexOf('saved') < lifecycle.indexOf('server-logout'));
  assert.ok(lifecycle.indexOf('server-logout') < lifecycle.indexOf('signed-out'));
  assert.deepEqual(errors, []);
});

test('account deletion sends the password, clears the client and publishes signed-out', async t => {
  const initial = session('alice', 3);
  const { client, requests, lifecycle, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(initial);
    if (request.path === '/api/account') return response({ ok: true, groupDeleted: true });
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  await client.deleteAccount({ password: 'fixture-only-password' });
  assert.deepEqual(requests.at(-1), { path: '/api/account', method: 'DELETE', body: { password: 'fixture-only-password' } });
  assert.equal(client.current, null);
  assert.deepEqual(lifecycle, ['session', 'signed-out']);
  assert.deepEqual(errors, []);
});

test('an anonymous startup stays quiet, registration publishes the account, and an expired sync signs out', async t => {
  const registered = session('new-parca', 1);
  const { client, publications, errors, lifecycle, requests } = harness(t, async request => {
    if (request.path === '/api/session') return response({ error: 'Not authenticated' }, 401);
    if (request.path === '/api/register') return response(registered);
    if (request.path === '/api/state') return response({ error: 'Session expired' }, 401);
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  assert.equal(client.current, null);
  assert.deepEqual(errors, []);
  assert.deepEqual(publications, []);
  const input = { name: 'New Parça', email: 'new-parca@example.test', password: 'fixture-only-password', groupName: 'Fixture FC' };
  await client.register(input);
  assert.equal(requests[1].method, 'POST');
  assert.deepEqual(requests[1].body, input);
  assert.deepEqual(client.current, registered);
  assert.deepEqual(publications, [registered]);
  await client.sync();
  assert.equal(client.current, null);
  assert.equal(lifecycle.filter(x => x === 'signed-out').length, 1);
  assert.deepEqual(errors, ['Sua sessão terminou. Entre novamente.']);
});

test('a conflict reload finishing after another login cannot replace that account', async t => {
  const reloadStarted = deferred(), delayedReload = deferred();
  const alice = session('alice', 4), bob = session('bob', 9);
  const { client, publications, errors } = harness(t, async request => {
    if (request.path === '/api/session') return response(alice);
    if (request.path === '/api/login') return response(bob);
    if (request.path === '/api/state' && request.method === 'PUT') return response({ error: 'Revision conflict' }, 409);
    if (request.path === '/api/state' && request.method === 'GET') {
      reloadStarted.resolve();
      return delayedReload.promise;
    }
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });
  await client.ready();
  const saving = client.save(roundState('alice-rejected-change'));
  await reloadStarted.promise;
  await client.login({ email: 'bob@example.test', password: 'fixture-only-password' });
  delayedReload.resolve(response(session('alice', 5, 'late-conflict-reload')));
  assert.equal(await saving, false);
  assert.deepEqual(client.current, bob);
  assert.deepEqual(publications.map(x => x.user.id), ['user-alice', 'user-bob']);
  assert.deepEqual(errors, [], 'errors belonging to the previous account should also be discarded');
});

test('recuperação de senha envia somente os dados esperados sem criar sessão', async t => {
  const { client, requests, publications, lifecycle, errors } = harness(t, async request => {
    if (request.path === '/api/password-reset/request') {
      return response({ ok: true, requestId: 'reset-public-fixture', expiresInSeconds: 600 }, 202);
    }
    if (request.path === '/api/password-reset/confirm') return response({ ok: true });
    assert.fail(`Unexpected request ${request.method} ${request.path}`);
  });

  const requested = await client.requestPasswordReset({ identifier: 'atleta@example.test', channel: 'email' });
  assert.equal(requested.requestId, 'reset-public-fixture');
  await client.resetPassword({ requestId: requested.requestId, code: '123456', password: 'nova-senha-segura' });

  assert.deepEqual(requests, [
    { path: '/api/password-reset/request', method: 'POST', body: { identifier: 'atleta@example.test', channel: 'email' } },
    { path: '/api/password-reset/confirm', method: 'POST', body: { requestId: 'reset-public-fixture', code: '123456', password: 'nova-senha-segura' } },
  ]);
  assert.equal(client.current, null);
  assert.deepEqual(publications, []);
  assert.deepEqual(lifecycle, []);
  assert.deepEqual(errors, []);
});
