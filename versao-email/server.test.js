const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

test('o servidor por e-mail preserva um arquivo de contas por ID', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'entreagente-base-id-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'dados.json');
  const contents = JSON.stringify({ version: 2, users: [], communities: [] });
  fs.writeFileSync(file, contents);
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: __dirname, env: { ...process.env, DATA_FILE: file, HOST: '127.0.0.1', PORT: '0' },
    encoding: 'utf8', timeout: 5000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /base usa login por ID/);
  assert.equal(fs.readFileSync(file, 'utf8'), contents);
  assert.deepEqual(fs.readdirSync(folder), ['dados.json']);
});

const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  socket.on('error', reject);
});

test('contas, profissionais, convites, imagens e exclusão sincronizam no servidor', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'entreagente-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_FILE: path.join(folder, 'data.json') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const url = 'http://127.0.0.1:' + port;
  const json = async (route, method, body, cookie = '') => fetch(url + route, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const state = async cookie => (await (await json('/api/state', 'GET', undefined, cookie)).json());
  const sync = async (cookie, base, next) => {
    const response = await json('/api/sync', 'POST', { base, next }, cookie);
    assert.equal(response.status, 200);
    return response.json();
  };
  const register = async body => {
    const response = await json('/api/register', 'POST', body);
    assert.equal(response.status, 200);
    return { user: await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
  };
  try {
    let ready = false, lastError = '';
    for (let i = 0; i < 40; i++) {
      try { const response = await fetch(url + '/'); if (response.ok) { ready = true; break; } lastError = String(response.status); }
      catch (error) { lastError = String(error.cause || error); }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'servidor iniciou: ' + output + ' / acesso: ' + lastError);
    assert.equal((await json('/api/state', 'GET')).status, 401);

    const ana = await register({ name: 'Ana', email: 'ana@example.com', password: 'senha-ana-123' });
    assert.equal((await json('/api/login', 'POST', { email: 'ana@example.com', password: 'errada' })).status, 401);
    assert.equal((await json('/api/register', 'POST', { name: 'Outra', email: 'ANA@example.com', password: 'outra-senha' })).status, 409);
    const bia = await register({ name: 'Bia', email: 'bia@example.com', password: 'senha-bia-123' });
    const jose = await register({ name: 'José Wilson', email: 'jose@example.com', password: 'senha-jose-123', professional: true,
      category: 'Reparos', contact: '000', about: 'Pequenos reparos em casa' });
    assert.equal(jose.user.role, 'professional');
    const catalog = await state(ana.cookie);
    assert.equal(catalog.professionals[0].name, 'José Wilson');
    assert.equal(catalog.users.length, 3);
    assert.doesNotMatch(JSON.stringify(catalog), /senha-ana-123|passwordHash|salt/);
    const professionalEdit = await json('/api/me', 'PATCH', { name: 'José Wilson', email: 'jose@example.com', currentPassword: 'senha-jose-123', category: 'Reparos', contact: '111', about: 'Reparos e manutenção residencial' }, jose.cookie);
    assert.equal(professionalEdit.status, 200);
    assert.equal((await state(ana.cookie)).professionals[0].contact, '111');
    const authFile = fs.readFileSync(path.join(folder, 'entreagente-auth.json'), 'utf8');
    assert.doesNotMatch(authFile, /senha-ana-123|senha-bia-123|senha-jose-123/);

    const base = await state(ana.cookie), next = structuredClone(base);
    next.users.push({ id: 'forged', name: 'Falso' });
    next.communities.push({ id: 'c1', name: 'Edifício', creatorId: ana.user.id, members: [ana.user.id], moderators: [] });
    next.invitations.push({ id: 'i1', communityId: 'c1', email: 'bia@example.com', sender: 'Ana', senderId: ana.user.id, status: 'pending' });
    await sync(ana.cookie, base, next);
    assert.equal((await state(bia.cookie)).users.some(item => item.id === 'forged'), false);
    assert.equal((await state(bia.cookie)).invitations[0].email, 'bia@example.com');
    assert.equal((await state(jose.cookie)).invitations.length, 0, 'convite privado ao destinatário e remetente');
    const acceptedBase = await state(bia.cookie), accepted = structuredClone(acceptedBase);
    accepted.invitations[0].status = 'accepted';
    accepted.communities[0].members.push(bia.user.id);
    await sync(bia.cookie, acceptedBase, accepted);
    assert.deepEqual((await state(ana.cookie)).communities[0].members, [ana.user.id, bia.user.id]);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9N9QAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetch(url + '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: bia.cookie }, body: png });
    assert.equal(upload.status, 201);
    const { id: imageId } = await upload.json();
    assert.equal((await fetch(url + '/api/images/' + imageId, { headers: { Cookie: bia.cookie } })).status, 200);
    const reviewBase = await state(bia.cookie), reviewed = structuredClone(reviewBase);
    reviewed.recommendations.push({ id: 'r1', professionalId: reviewBase.professionals[0].id, communityId: 'c1', name: 'José Wilson',
      category: 'Reparos', author: 'Bia', authorId: bia.user.id, service: 'Conserto', description: 'Fez um bom serviço', rating: 5, recommend: true, imageId });
    await sync(bia.cookie, reviewBase, reviewed);
    assert.equal((await state(ana.cookie)).recommendations.length, 1);

    assert.equal((await json('/api/me', 'PATCH', { name: 'Ana Maria', email: 'ana.nova@example.com', currentPassword: 'errada' }, ana.cookie)).status, 403);
    const changed = await json('/api/me', 'PATCH', { name: 'Ana Maria', email: 'ana.nova@example.com', currentPassword: 'senha-ana-123', newPassword: 'senha-nova-123' }, ana.cookie);
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).email, 'ana.nova@example.com');
    assert.equal((await json('/api/login', 'POST', { email: 'ana@example.com', password: 'senha-ana-123' })).status, 401);
    assert.equal((await json('/api/login', 'POST', { email: 'ana.nova@example.com', password: 'senha-nova-123' })).status, 200);
    assert.equal((await state(ana.cookie)).users.find(item => item.id === ana.user.id).name, 'Ana Maria');

    assert.equal((await json('/api/me', 'DELETE', { password: 'errada' }, bia.cookie)).status, 403);
    assert.equal((await json('/api/me', 'DELETE', { password: 'senha-bia-123' }, bia.cookie)).status, 200);
    assert.equal((await json('/api/me', 'GET', undefined, bia.cookie)).status, 401);
    assert.equal((await state(ana.cookie)).recommendations.length, 0);
    assert.equal((await fetch(url + '/api/images/' + imageId, { headers: { Cookie: ana.cookie } })).status, 404);
    assert.equal((await state(ana.cookie)).communities[0].members.length, 1);
    assert.equal((await json('/api/me', 'DELETE', { password: 'senha-nova-123' }, ana.cookie)).status, 200);
    assert.equal((await state(jose.cookie)).communities.length, 0);
  } finally {
    child.kill();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
