const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('atualização do servidor preserva a conta que acabou de entrar', () => {
  const html = fs.readFileSync(path.join(__dirname, 'entreagente_mockup.html'), 'utf8');
  const start = html.indexOf('function applyShared(remote){');
  const end = html.indexOf('async function flushSync()', start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start, end);
  const run = new Function(
    'remote',
    'let data={users:[{name:"Ana",phone:"111"}],communities:[],currentPhone:"111"};' +
    'const serverBase={users:[],communities:[]};' +
    'const saveLocal=()=>{};const refresh=()=>{};' +
    'const shared=()=>({users:data.users,communities:data.communities});' +
    'const sharedCopy=value=>JSON.parse(JSON.stringify(value));' +
    'const queueMicrotask=()=>{};' +
    source +
    'applyShared(remote);return data;'
  );
  const result = run({ users: [], communities: [{ id: 'c1' }] });
  assert.equal(result.currentPhone, '111');
  assert.equal(result.users[0].name, 'Ana');
  assert.equal(result.communities[0].id, 'c1');
});

test('criar comunidade não altera a referência da última versão do servidor', () => {
  const html = fs.readFileSync(path.join(__dirname, 'entreagente_mockup.html'), 'utf8');
  const start = html.indexOf('function applyShared(remote){');
  const end = html.indexOf('async function flushSync()', start);
  const source = html.slice(start, end);
  const run = new Function(
    'let data={users:[],communities:[],currentPhone:null};' +
    'const serverBase={users:[],communities:[]};' +
    'const saveLocal=()=>{};const refresh=()=>{};' +
    'const shared=()=>({users:data.users,communities:data.communities});' +
    'const sharedCopy=value=>JSON.parse(JSON.stringify(value));' +
    'const queueMicrotask=()=>{};' +
    source +
    'applyShared(serverBase);data.communities.push({id:"nova",name:"Condomínio"});' +
    'return {local:data.communities,base:serverBase.communities,changed:JSON.stringify(shared())!==JSON.stringify(serverBase)};'
  );
  const result = run();
  assert.equal(result.local.length, 1);
  assert.equal(result.base.length, 0);
  assert.equal(result.changed, true);
});

test('perfil mostra exclusão apenas na experiência do próprio morador', () => {
  const html = fs.readFileSync(path.join(__dirname, 'entreagente_mockup.html'), 'utf8');
  const start = html.indexOf('function profileBody(group){');
  const end = html.indexOf('function openProfile(id)', start);
  assert.ok(start >= 0 && end > start);
  const render = new Function('phone', 'group',
    'const data={currentPhone:phone};const average=()=>5;const recommenders=()=>2;' +
    'const safe=String;const isSaved=()=>false;const initials=()=>"JW";' +
    'const selected=()=>({});const canDeleteProfessional=()=>false;' +
    html.slice(start, end) + 'return profileBody(group);'
  );
  const group = { id: 'pro1', name: 'José Wilson', category: 'Reparos', about: '', rows: [
    { id: 'r1', author: 'Ana', authorPhone: '111', service: 'Reparo', description: 'Tudo certo', rating: 5, recommend: true, imageId: '11111111-1111-1111-1111-111111111111.png' },
    { id: 'r2', author: 'Bia', authorPhone: '222', service: 'Reparo', description: 'Bom trabalho', rating: 5, recommend: true }
  ] };
  const ana = render('111', group);
  assert.match(ana, /data-delete-experience="r1"/);
  assert.doesNotMatch(ana, /data-delete-experience="r2"/);
  assert.match(ana, /src="\/api\/images\/11111111-1111-1111-1111-111111111111\.png"/);
  const bia = render('222', group);
  assert.match(bia, /data-delete-experience="r2"/);
  assert.doesNotMatch(bia, /data-delete-experience="r1"/);
});
