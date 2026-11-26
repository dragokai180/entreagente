const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore, migrateLegacy } = require('../lib/store');
const { catalogFor, feedFor, profileFor } = require('../lib/model');

function legacy() {
  const base = {communityId:'c1',name:'José Luz',category:'Elétrica',service:'Tomada',rating:5,recommend:true};
  return {
    users:[{name:'Ana',phone:'11'},{name:'Bia',phone:'22'}],
    communities:[{id:'c1',name:'Palmeiras',creatorPhone:'11',members:['11','22'],moderators:['22']}],
    invitations:[{id:'i1',communityId:'c1',phone:'33',sender:'Ana',status:'pending'}],
    recommendations:[{...base,id:'r2',authorPhone:'22',indication:false},{...base,id:'r1',authorPhone:'11',indication:true}],
    savedByPhone:{'22':['c1:jose luz']}
  };
}

test('preserva a base por e-mail quando DATA_FILE aponta para ela', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'entreagente-base-email-'));
  t.after(() => fs.rmSync(folder,{recursive:true,force:true}));
  const file = path.join(folder,'dados.json');
  const contents = JSON.stringify({
    users:[{id:'conta-antiga',name:'Ana',role:'resident'}],
    communities:[], invitations:[], professionals:[], recommendations:[], savedByUser:{}
  });
  fs.writeFileSync(file,contents);
  assert.throws(() => openStore(file),/login por e-mail/);
  assert.equal(fs.readFileSync(file,'utf8'),contents);
  assert.deepEqual(fs.readdirSync(folder),['dados.json']);
});

test('migra usuários, convites, moderação e favoritos sem inventar datas', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'entreagente-migracao-'));
  t.after(() => fs.rmSync(folder,{recursive:true,force:true}));
  const file = path.join(folder,'data.json'), before = JSON.stringify(legacy());
  fs.writeFileSync(file,before);
  const state = openStore(file).state;
  const bia = state.users.find(u => u.name === 'Bia');
  assert.equal(state.communities[0].moderatorIds[0],bia.id);
  assert.equal(state.users.find(u => u.legacyPhone === '33').id,state.invitations[0].recipientId);
  const list = catalogFor(state,'c1',bia.id);
  assert.equal(list.length,1);
  assert.equal(list[0].recommenderCount,2);
  assert.equal(list[0].mine,true);
  assert.equal(list[0].saved,true);
  assert.equal(state.reviews.every(r => r.createdAt === null),true);
  assert.deepEqual(feedFor(state,'c1'),[]);
  assert.equal(profileFor(state,state.professionals[0],bia.id).reviews.length,2);
  assert.deepEqual(openStore(file).state,state);
  assert.equal(fs.readFileSync(file+'.v1.bak','utf8'),before);
});

test('preserva fichas antigas ambíguas e mantém o favorito para revisão', () => {
  const old = legacy();
  old.recommendations[0].indication = true;
  const state = migrateLegacy(old);
  assert.equal(state.professionals.length,2);
  assert.equal(state.professionals.every(p => p.needsReview),true);
  assert.equal(state.unresolvedSaves[0].candidates.length,2);
});
