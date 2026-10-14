import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { serverConfig } from '../server_config.mjs';

test('modo local usa a porta e as duas origens locais sem cookie Secure', () => {
  const config = serverConfig({ FUT_PARCA_PORT:'4173' }, 'win32');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4173);
  assert.equal(config.secureCookie, false);
  assert.deepEqual([...config.origins], ['http://127.0.0.1:4173', 'http://localhost:4173']);
});

test('modo público exige HTTPS e armazenamento absoluto, ativa cookie Secure e porta da hospedagem', () => {
  const dataPath = resolve('fut-parca-test.sqlite');
  const config = serverConfig({ PORT:'10000', FUT_PARCA_PUBLIC_ORIGIN:'https://futparca.onrender.com', FUT_PARCA_DATA_PATH:dataPath, FUT_PARCA_TRUST_PROXY:'1' });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 10000);
  assert.equal(config.dataPath, dataPath);
  assert.equal(config.secureCookie, true);
  assert.equal(config.trustProxy, true);
  assert.deepEqual([...config.origins], ['https://futparca.onrender.com']);
  assert.equal(serverConfig({ RENDER_EXTERNAL_URL:'https://futparca.onrender.com', FUT_PARCA_DATA_PATH:dataPath }).publicOrigin, 'https://futparca.onrender.com');
  assert.throws(() => serverConfig({ FUT_PARCA_PUBLIC_ORIGIN:'http://futparca.onrender.com', FUT_PARCA_DATA_PATH:dataPath }), /origem HTTPS/);
  assert.throws(() => serverConfig({ FUT_PARCA_PUBLIC_ORIGIN:'https://futparca.onrender.com' }), /armazenamento persistente/);
  assert.throws(() => serverConfig({ PORT:'0' }), /PORT/);
});
