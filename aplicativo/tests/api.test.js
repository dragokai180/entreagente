const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createApplication } = require('../lib/app');
const { activationCode } = require('../lib/auth');

const password = 'uma frase longa de teste';
async function fixture(t, legacy) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'entreagente-api-')), file = path.join(folder,'dados.json');
  if (legacy) fs.writeFileSync(file,JSON.stringify(legacy));
  const server = createApplication({file});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
    fs.rmSync(folder,{recursive:true,force:true});
  });
  function client() {
    let cookie = '';
    async function raw(method,route,payload,extra = {}) {
      const headers = {...extra};
      if (cookie) headers.Cookie = cookie;
      const multipart = payload instanceof FormData;
      if (multipart) headers['X-EntreAgente-Upload'] = '1';
      else if (payload !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch('http://127.0.0.1:'+server.address().port+'/api'+route, {
        method, headers, body:payload === undefined || multipart ? payload : JSON.stringify(payload)
      });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    }
    async function request(method, route, payload, status = 200) {
      const response = await raw(method,route,payload), data = await response.json();
      assert.equal(response.status,status,method+' '+route+' '+JSON.stringify(data));
      return data;
    }
    return {raw, request, register:async (name,accountType) => (await request('POST','/auth/register',{name,password,accountType},201)).user };
  }
  return {client,file};
}

test('IDs próprios para homônimos, sessão, login e troca do nome exibido', async t => {
  const f = await fixture(t), a = f.client(), b = f.client();
  const ana = await a.register('Ana Lima'), outra = await b.register('Ana Lima');
  assert.notEqual(ana.loginId,outra.loginId);
  await a.request('PATCH','/me',{name:'Ana Souza'});
  await a.request('POST','/auth/logout',{});
  await a.request('GET','/me',undefined,401);
  await a.request('POST','/auth/login',{loginId:ana.loginId,password:'incorreta'},401);
  const response = await a.request('POST','/auth/login',{loginId:ana.loginId.toUpperCase(),password});
  assert.deepEqual(response.user,{...ana,name:'Ana Souza'});
  assert.ok(!JSON.stringify(await a.request('GET','/me')).includes('passwordHash'));
  assert.ok(!fs.readFileSync(f.file,'utf8').includes(password));
});

test('escolha após o cadastro conserva o ID e abre a área escolhida nos próximos acessos', async t => {
  const f = await fixture(t);
  for (const accountType of ['provider','resident']) {
    const client = f.client();
    const original = await client.register('José','pending');
    assert.equal((await client.request('GET','/me')).needsAccountType,true);
    await client.request('POST','/communities',{name:'Sol'},409);
    await client.request('POST','/auth/logout',{});
    await client.request('POST','/auth/login',{loginId:original.loginId,password});
    assert.equal((await client.request('GET','/me')).needsAccountType,true);
    await client.request('PUT','/me/account-type',{},400);
    const choice = await client.request('PUT','/me/account-type',{accountType});
    assert.equal(choice.user.id,original.id);
    assert.equal(choice.user.loginId,original.loginId);
    assert.deepEqual(await client.request('PUT','/me/account-type',{accountType}),choice);
    if (accountType === 'provider') {
      await client.request('PATCH','/provider/profile',{headline:'Eletricista',skills:[],experience:[]});
    } else {
      await client.request('POST','/communities',{name:'Sol'});
    }
    await client.request('POST','/auth/logout',{});
    await client.request('POST','/auth/login',{loginId:original.loginId,password});
    const me = await client.request('GET','/me');
    assert.equal(me.needsAccountType,false);
    assert.equal(me.user.accountType,accountType);
    if (accountType === 'provider') assert.equal((await client.request('GET','/provider')).profile.headline,'Eletricista');
    else assert.equal(me.communities[0].name,'Sol');
  }
});

test('um ID antigo sem condomínio pode escolher o perfil e contas em uso mantêm sua área', async t => {
  const old = await fixture(t);
  const jose = await old.client().register('José');
  const older = await old.client().register('Lia');
  const ana = old.client(), resident = await ana.register('Ana');
  await ana.request('POST','/communities',{name:'Palmeiras'});
  const provider = await old.client().register('Bia','provider');
  const state = JSON.parse(fs.readFileSync(old.file,'utf8'));
  for (const user of state.users) delete user.accountTypeConfirmed;
  delete state.users.find(user => user.id === older.id).accountType;
  const restored = await fixture(t,state);
  for (const original of [jose,older,resident,provider]) {
    const client = restored.client();
    await client.request('POST','/auth/login',{loginId:original.loginId,password});
    const me = await client.request('GET','/me');
    assert.equal(me.user.id,original.id);
    if (original === jose || original === older) {
      assert.equal(me.needsAccountType,true);
      const chosen = await client.request('PUT','/me/account-type',{accountType:'provider'});
      assert.equal(chosen.user.loginId,original.loginId);
      assert.equal((await client.request('GET','/provider')).profile.name,original.name);
    } else {
      assert.equal(me.needsAccountType,false);
      assert.equal(me.user.accountType,original.accountType);
      if (original === resident) assert.equal(me.communities[0].role,'criador');
    }
  }
});

test('do cadastro ao feed, perfil, favoritos e Minhas indicações', async t => {
  const f = await fixture(t), ana = f.client(), bruno = f.client();
  await ana.register('Ana Lima');
  const b = await bruno.register('Bruno Lima');
  const {id} = await ana.request('POST','/communities',{name:'Palmeiras'});
  const c = '/communities/'+id;
  await ana.request('POST',c+'/invitations',{loginId:b.loginId});
  const [invite] = (await bruno.request('GET','/me')).invites;
  await bruno.request('POST','/invitations/'+invite.id+'/answer',{accept:true});
  const fields = {name:'Carlos Silva',category:'Elétrica',about:'Instalação e reparos',contact:'',requestId:randomUUID()};
  const p = await ana.request('POST',c+'/professionals',fields);
  assert.deepEqual(await ana.request('POST',c+'/professionals',fields),p);
  const other = await ana.request('POST',c+'/professionals',{...fields,requestId:randomUUID()});
  assert.notEqual(p.id,other.id);
  const profile = c+'/professionals/'+p.id;
  assert.equal((await ana.request('GET',profile)).rating,null);
  assert.deepEqual(await bruno.request('GET',c+'/feed'),[]);
  const report = {requestId:randomUUID(),service:'Ventilador',rating:5,description:'Instalou o ventilador da sala.',recommend:true};
  const [r1,r2] = await Promise.all([bruno.request('POST',profile+'/reviews',report),bruno.request('POST',profile+'/reviews',report)]);
  assert.equal(r1.id,r2.id);
  await bruno.request('POST',profile+'/reviews',{...report,requestId:randomUUID(),rating:3,recommend:false});
  const detail = await bruno.request('GET',profile);
  assert.equal(detail.mine,true);
  assert.equal(detail.recommenderCount,1);
  assert.equal(detail.reviewCount,2);
  assert.equal(detail.rating,4);
  assert.equal((await ana.request('GET',profile)).mine,false);
  assert.equal((await bruno.request('GET',c+'/professionals')).filter(p => p.mine).length,1);
  const [post] = await bruno.request('GET',c+'/feed');
  assert.equal(post.id,r1.id);
  assert.equal(post.author,'Bruno Lima');
  assert.equal(post.professionalId,p.id);
  assert.ok(Date.parse(post.createdAt));
  await ana.request('POST',profile+'/reviews',{...report,requestId:randomUUID()});
  assert.equal((await ana.request('GET',c+'/feed'))[0].author,'Ana Lima');
  await bruno.request('PUT',profile+'/saved',{saved:true});
  await ana.request('PATCH',profile,{...fields,name:'Carlos da Silva'});
  assert.equal((await bruno.request('GET',profile)).saved,true);
  assert.equal((await ana.request('GET',c+'/feed'))[0].professionalName,'Carlos da Silva');
  const fresh = JSON.parse(fs.readFileSync(f.file,'utf8'));
  assert.equal(fresh.professionals.length,2);
  assert.equal(fresh.reviews.length,3);
});

test('convite por código, papéis e dados restritos ao condomínio', async t => {
  const f = await fixture(t), a = f.client(), b = f.client(), outra = f.client();
  await a.register('Ana Teste'); const bruno = await b.register('Bruno Teste'); await outra.register('Bia Teste');
  const c = '/communities/'+(await a.request('POST','/communities',{name:'Condomínio A'})).id;
  const d = '/communities/'+(await outra.request('POST','/communities',{name:'Condomínio B'})).id;
  const fields = {name:'José Luz',category:'Elétrica',contact:'Contato comercial',consent:true,requestId:randomUUID()};
  const p = (await a.request('POST',c+'/professionals',fields)).id;
  await outra.request('GET',c+'/feed',undefined,404);
  await outra.request('GET',d+'/professionals/'+p,undefined,404);
  await b.request('GET',c+'/professionals',undefined,404);
  const {code} = await a.request('POST',c+'/invitations',{});
  await b.request('POST','/invitations/redeem',{code});
  await outra.request('POST','/invitations/redeem',{code},400);
  await b.request('PATCH',c+'/professionals/'+p,fields,403);
  await a.request('PATCH',c+'/residents/'+bruno.id,{moderator:true});
  await b.request('PATCH',c+'/professionals/'+p,{...fields,about:'Atendimento com hora marcada.'});
  await a.request('DELETE',c+'/residents/'+bruno.id,{});
  await b.request('GET',c+'/professionals/'+p,undefined,404);
  await a.request('DELETE',c+'/professionals/'+p,{});
  assert.deepEqual(await a.request('GET',c+'/professionals'),[]);
});

test('ativação de cadastro antigo preserva a comunidade e usa o código uma vez', async t => {
  const old = {users:[{name:'Ana',phone:'11'}],communities:[{id:'c1',name:'Sol',creatorPhone:'11',members:['11']}],invitations:[],recommendations:[]};
  const f = await fixture(t,old), a = f.client(), b = f.client();
  const state = JSON.parse(fs.readFileSync(f.file,'utf8')), oldUser = state.users[0];
  const code = activationCode(state,oldUser);
  const fresh = await b.register('Ana');
  assert.notEqual(fresh.id,oldUser.id);
  assert.equal((await b.request('GET','/me')).communities.length,0);
  await a.request('POST','/auth/activate',{code,name:'Ana',password});
  assert.equal((await a.request('GET','/me')).communities[0].role,'criador');
  await b.request('POST','/auth/activate',{code,name:'Outra',password},400);
});

function publication(fields, media) {
  const data = new FormData();
  data.append('payload',JSON.stringify(fields));
  for (const [name,type,bytes] of media) data.append('media',new Blob([bytes],{type}),name);
  return data;
}
const samplePhoto = ['foto.png','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cq7sAAAAASUVORK5CYII=','base64')];
// Cabeçalho EBML WebM para testar transporte e intervalos sem depender de um codificador.
const sampleWebm = ['trabalho.webm','video/webm',Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810242858102','hex')];

test('post com foto e vídeo é privado do condomínio, aceita seek e limpa reenvio e exclusão', async t => {
  const f=await fixture(t), ana=f.client(), bia=f.client(), anon=f.client();
  await ana.register('Ana Lima'); await bia.register('Bia Maia');
  const c='/communities/'+(await ana.request('POST','/communities',{name:'Sol'})).id;
  const endpoint=c+'/posts', fields={requestId:randomUUID(),description:'Área comum reformada'};
  const submit=() => ana.request('POST',endpoint,publication(fields,[samplePhoto,sampleWebm]));
  const [one,two]=await Promise.all([submit(),submit()]);
  assert.equal(one.id,two.id);
  const [post]=await ana.request('GET',c+'/feed');
  assert.equal(post.kind,'community');
  assert.equal(post.media.length,2);
  assert.equal(fs.readdirSync(f.file+'.media').length,2);
  const url='/media/'+post.media[1].id;
  const partial=await ana.raw('GET',url,undefined,{Range:'bytes=2-9'});
  assert.equal(partial.status,206); assert.equal(partial.headers.get('content-type'),'video/webm');
  assert.equal(partial.headers.get('content-range'),'bytes 2-9/'+sampleWebm[2].length);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()),sampleWebm[2].subarray(2,10));
  assert.equal((await ana.raw('HEAD',url)).headers.get('accept-ranges'),'bytes');
  assert.equal((await ana.raw('GET',url,undefined,{Range:'bytes=999-'})).status,416);
  assert.equal((await anon.raw('GET',url)).status,401);
  assert.equal((await bia.raw('GET',url)).status,404);
  await ana.request('DELETE',endpoint+'/'+post.id,{});
  assert.equal((await ana.raw('GET',url)).status,404);
  assert.deepEqual(fs.readdirSync(f.file+'.media'),[]);
});

test('valida mídia e desfaz os arquivos se a publicação falhar', async t => {
  const f=await fixture(t), a=f.client(); await a.register('Ana Luz');
  const c='/communities/'+(await a.request('POST','/communities',{name:'Sol'})).id;
  const p=(await a.request('POST',c+'/professionals',{name:'Carlos',category:'Elétrica',requestId:randomUUID()})).id;
  const fields={requestId:randomUUID(),description:'Serviço no hall',rating:5,service:'Instalação',recommend:true};
  const send=(fields,files,status=200)=>a.request('POST',c+'/professionals/'+p+'/reviews',publication(fields,files),status);
  await send(fields,[['foto.png','image/png',Buffer.from('arquivo de texto')]],415);
  await send(fields,Array(5).fill(samplePhoto),400);
  await send(fields,[['foto.png','image/png',Buffer.alloc(8*1024*1024+1)]],413);
  await send({...fields,rating:0},[samplePhoto],400);
  assert.equal(fs.readdirSync(f.file+'.media').length,0);
  await send(fields,[samplePhoto]);
  const [feed]=await a.request('GET',c+'/feed'), detail=await a.request('GET',c+'/professionals/'+p);
  assert.deepEqual(detail.reviews[0].media,feed.media);
  assert.equal(feed.kind,'recommendation');
  await a.request('DELETE',c+'/professionals/'+p,{});
  assert.deepEqual(fs.readdirSync(f.file+'.media'),[]);
});

test('perfil, foto e portfólio respeitam os vínculos aceitos e o destino escolhido', async t => {
  const f=await fixture(t), ana=f.client(), bia=f.client(), carlos=f.client(), outro=f.client();
  await ana.register('Ana Luz'); await bia.register('Bia Luz');
  const owner=await carlos.register('Carlos Luz','provider');
  await outro.register('Carlos Luz','provider');
  await carlos.request('POST','/auth/logout',{});
  const login=await carlos.request('POST','/auth/login',{loginId:owner.loginId,password});
  assert.equal(login.user.accountType,'provider');
  await carlos.request('POST','/communities',{name:'Teste'},403);
  await ana.request('GET','/provider',undefined,403);
  const profile={headline:'Eletricista predial',region:'Zona Norte',about:'Manutenção residencial',skills:['Elétrica'],
    experience:[{role:'Eletricista',organization:'Autônomo',period:'2020–2026',description:'Instalação elétrica.'}]};
  await carlos.request('PATCH','/provider/profile',publication(profile,[samplePhoto]));
  const photo=(await carlos.request('GET','/provider')).profile.photo;
  assert.equal((await ana.raw('GET','/media/'+photo.id)).status,404);
  async function link(resident,name) {
    const c='/communities/'+(await resident.request('POST','/communities',{name})).id;
    const p=(await resident.request('POST',c+'/professionals',{name:'Carlos Luz',category:'Elétrica',requestId:randomUUID()})).id;
    const path=c+'/professionals/'+p;
    await resident.request('POST',path+'/provider',{loginId:owner.loginId});
    assert.equal((await resident.request('GET',path)).identity,null);
    await outro.request('POST','/provider/links/'+p,{accept:true},404);
    await carlos.request('POST','/provider/links/'+p,{accept:true});
    return {c,p,path};
  }
  const A=await link(ana,'Sol'), B=await link(bia,'Lua');
  assert.equal((await ana.request('GET',A.path)).identity.headline,profile.headline);
  assert.equal((await bia.raw('GET','/media/'+photo.id)).status,200);
  const general={title:'Amostra geral',description:'Painel elétrico',visibility:'profile',requestId:randomUUID()};
  await carlos.request('POST','/provider/posts',publication(general,[samplePhoto]));
  const scoped={...general,title:'Somente Sol',visibility:'community',professionalId:A.p,requestId:randomUUID()};
  const work=await carlos.request('POST','/provider/posts',publication(scoped,[sampleWebm]));
  assert.equal((await ana.request('GET',A.path)).portfolio.length,2);
  assert.equal((await bia.request('GET',B.path)).portfolio.length,1);
  const [post]=await ana.request('GET',A.c+'/feed');
  assert.equal(post.kind,'portfolio');
  assert.equal((await ana.request('GET',A.path)).reviewCount,0);
  assert.deepEqual(await bia.request('GET',B.c+'/feed'),[]);
  const url='/media/'+post.media[0].id;
  assert.equal((await bia.raw('GET',url)).status,404);
  await ana.request('DELETE',A.path+'/provider',{});
  assert.deepEqual(await ana.request('GET',A.c+'/feed'),[]);
  assert.equal((await ana.raw('GET',url)).status,404);
  assert.equal((await carlos.raw('GET',url)).status,200);
  await carlos.request('DELETE','/provider/posts/'+work.id,{});
  assert.equal((await carlos.raw('GET',url)).status,404);
  await carlos.request('PATCH','/provider/profile',{...profile,removePhoto:true});
  assert.equal((await carlos.raw('GET','/media/'+photo.id)).status,404);
});
