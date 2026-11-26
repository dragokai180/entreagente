const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

test('npm start usa a nova interface e persiste o catálogo compartilhado', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'entreagente-entry-'));
  const file = path.join(folder,'dados.json');
  const child = spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),
    env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_FILE:file,COOKIE_SECURE:'0'},stdio:['ignore','pipe','pipe']});
  const closed = once(child,'exit');
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; fs.rmSync(folder,{recursive:true,force:true}); });
  const origin = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(Error('Servidor não iniciou.')),5000);
    timer.unref();
    child.stdout.once('data',chunk => {
      clearTimeout(timer);
      const found = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) resolve(found[0]); else reject(Error('Endereço ausente.'));
    });
    child.once('error',reject);
  });
  const page = await (await fetch(origin)).text();
  assert.match(page,/name="loginId"/);
  assert.equal(await (await fetch(origin+'/entreagente_mockup.html')).text(),page);
  assert.equal((await fetch(origin+'/app.js')).status,200);
  assert.equal((await fetch(origin+'/app.css')).status,200);
  const register = await fetch(origin+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'Ana Lima',password:'uma senha longa de exemplo'})});
  const headers = {'Content-Type':'application/json',Cookie:register.headers.get('set-cookie').split(';')[0]};
  const created = await fetch(origin+'/api/communities',{method:'POST',headers,body:JSON.stringify({name:'Palmeiras'})});
  assert.ok((await created.json()).id);
  assert.equal((await (await fetch(origin+'/api/me',{headers})).json()).communities[0].name,'Palmeiras');
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).communities[0].name,'Palmeiras');
  assert.equal((await fetch(origin+'/api/state',{headers})).status,404);
});
