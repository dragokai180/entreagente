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
