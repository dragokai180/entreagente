const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const empty = () => ({ users: [], communities: [], invitations: [], recommendations: [], savedByPhone: {} });
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  socket.on('error', reject);
});
test('sincroniza convites, moradores e exclusões entre clientes', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'entreagente-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_FILE: path.join(folder, 'data.json') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk; });
  child.stderr.on('data', chunk => { serverOutput += chunk; });
  const url = 'http://127.0.0.1:' + port;
  try {
    let ready = false, lastError = '';
    for (let i = 0; i < 40; i++) {
      try { const response = await fetch(url + '/api/state'); if (response.ok) { ready = true; break; } lastError = String(response.status); }
      catch (error) { lastError = String(error.cause || error); }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'servidor iniciou: ' + serverOutput + ' / acesso: ' + lastError);
    const get = async () => (await fetch(url + '/api/state')).json();
    const sync = async (base, next) => {
      const response = await fetch(url + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, next }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const baseA = await get();
    const baseB = await get();
    const nextA = structuredClone(baseA);
    nextA.users.push({ name: 'Ana', phone: '111' });
    nextA.communities.push({ id: 'c1', name: 'Edifício', creatorPhone: '111', members: ['111'] });
    nextA.invitations.push({ id: 'i1', communityId: 'c1', phone: '222', sender: 'Ana', status: 'pending' });
    await sync(baseA, nextA);
    assert.equal((await get()).invitations[0].phone, '222');
    const nextB = structuredClone(baseB);
    nextB.users.push({ name: 'Bia', phone: '222' });
    await sync(baseB, nextB);
    assert.equal((await get()).invitations.length, 1, 'alteração concorrente preserva convite');
    const acceptedBase = await get();
    const accepted = structuredClone(acceptedBase);
    accepted.invitations[0].status = 'accepted';
    accepted.communities[0].members.push('222');
    accepted.communities[0].moderators = ['222'];
    accepted.recommendations.push({ id: 'p1', communityId: 'c1', name: 'José Wilson' });
    await sync(acceptedBase, accepted);
    const observed = await get();
    assert.deepEqual(observed.communities[0].members, ['111', '222']);
    assert.deepEqual(observed.communities[0].moderators, ['222']);
    assert.equal(observed.recommendations[0].name, 'José Wilson');
    const removed = structuredClone(observed);
    removed.recommendations = [];
    await sync(observed, removed);
    assert.equal((await get()).recommendations.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'data.json'))).invitations[0].status, 'accepted');
  } finally {
    child.kill();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
