const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'entreagente_mockup.html'), 'utf8');

test('sincronização mantém a sessão local sem alterar a versão recebida', () => {
  const start = html.indexOf('function applyShared(remote){');
  const end = html.indexOf('function endSession()', start);
  assert.ok(start >= 0 && end > start);
  const run = new Function('remote',
    'let data={currentUserId:"u1",selectedByUser:{u1:"c1"},users:[],communities:[]};' +
    'const sharedCopy=value=>JSON.parse(JSON.stringify(value));' +
    'const saveLocal=()=>{};const refresh=()=>{};' +
    html.slice(start, end) +
    'applyShared(remote);data.communities.push({id:"local"});return data;'
  );
  const remote = { users: [{ id: 'u1', name: 'Ana' }], communities: [{ id: 'c1' }] };
  const result = run(remote);
  assert.equal(result.currentUserId, 'u1');
  assert.equal(result.selectedByUser.u1, 'c1');
  assert.equal(result.users[0].name, 'Ana');
  assert.equal(remote.communities.length, 1, 'o estado remoto não foi alterado');
});

test('perfil mostra exclusão apenas na experiência do próprio morador', () => {
  const start = html.indexOf('function profileBody(group){');
  const end = html.indexOf('function openProfile(id)', start);
  assert.ok(start >= 0 && end > start);
  const render = new Function('id', 'group',
    'const data={currentUserId:id};const average=()=>5;const recommenders=()=>2;' +
    'const safe=String;const isSaved=()=>false;const initials=()=>"JW";' +
    'const selected=()=>({});const canDeleteProfessional=()=>false;' +
    html.slice(start, end) + 'return profileBody(group);'
  );
  const group = { id: 'pro1', name: 'José Wilson', category: 'Reparos', about: '', rows: [
    { id: 'r1', author: 'Ana', authorId: 'u1', service: 'Reparo', description: 'Tudo certo', rating: 5, recommend: true },
    { id: 'r2', author: 'Bia', authorId: 'u2', service: 'Reparo', description: 'Bom trabalho', rating: 5, recommend: true }
  ] };
  const ana = render('u1', group);
  assert.match(ana, /data-delete-experience="r1"/);
  assert.doesNotMatch(ana, /data-delete-experience="r2"/);
  const bia = render('u2', group);
  assert.match(bia, /data-delete-experience="r2"/);
  assert.doesNotMatch(bia, /data-delete-experience="r1"/);
});
