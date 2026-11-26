'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('./store');
const { createAuth, needsAccountType } = require('./auth');
const {readMultipart,makeMediaStore} = require('./media');
const {providerRoute,isProvider} = require('./providers');
const { communityRoute } = require('./community');
const { HttpError, requireThat } = require('./validation');

const publicDir = path.join(__dirname, '..', 'public');
const assets = new Map([
  ['/', ['index.html','text/html']], ['/entreagente_mockup.html', ['index.html','text/html']],
  ['/uploads.js',['uploads.js','text/javascript']], ['/provider-ui.js',['provider-ui.js','text/javascript']],
  ['/app.js',['app.js','text/javascript']], ['/app.css',['app.css','text/css']]
]);

async function readBody(req) {
  requireThat(req.headers['content-type']?.split(';')[0].trim() === 'application/json', 415, 'Envie JSON.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= 16384, 413, 'Formulário muito grande.');
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400,'JSON inválido.'); }
  requireThat(result && typeof result === 'object' && !Array.isArray(result), 400, 'Formulário inválido.');
  return result;
}

function createApplication({ file, secureCookie = false }) {
  const store = openStore(file), auth = createAuth(store, secureCookie), media = makeMediaStore(file,store);
  let activeUploads = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    function send(status, body, type = 'application/json') {
      res.writeHead(status, { 'Content-Type': type + '; charset=utf-8' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    }
    try {
      const pathname = new URL(req.url,'http://localhost').pathname;
      const asset = assets.get(pathname);
      if (req.method === 'GET' && asset) return send(200,fs.readFileSync(path.join(publicDir,asset[0])),asset[1]);
      requireThat(pathname.startsWith('/api/'), 404, 'Rota inexistente.');
      const parts = pathname.slice(5).split('/');
      requireThat(parts.length <= 5 && parts.every(Boolean), 404, 'Rota inexistente.');
      const isWrite = !['GET','HEAD'].includes(req.method);
      if (isWrite && req.headers.origin) {
        let host;
        try { host = new URL(req.headers.origin).host; } catch {}
        requireThat(host === req.headers.host, 403, 'Origem desconhecida.');
      }
      if (parts[0] === 'auth' && parts.length === 2 && req.method === 'POST') {
        return send(parts[1] === 'register' ? 201 : 200, await auth.handle(parts[1],await readBody(req),req,res));
      }
      const user = auth.current(req);
      requireThat(user,401,'Entre com seu ID e sua senha.');
      if (parts[0] !== 'me') {
        requireThat(!needsAccountType(store.state,user),409,'Escolha seu tipo de perfil para continuar.');
      }
      if (parts[0] === 'media' && parts.length === 2 && !isWrite) return await media.serve(req,res,user,parts[1]);
      const route = parts[0] === 'provider' ? providerRoute : communityRoute;
      if (!isWrite) return send(200,route(store.state,user,req.method,parts,{}));
      const multipart = /^multipart\/form-data(?:;|$)/i.test(req.headers['content-type'] || '');
      async function commit(body,files) {
        return media.change(files,(state,items) => {
          const current = auth.current(req);
          requireThat(current && current.id === user.id,401,'Sua sessão terminou durante o envio.');
          return route(state,current,req.method,parts,body,items);
        });
      }
      if (!multipart) return send(200,await commit(await readBody(req),[]));
      requireThat(req.headers['x-entreagente-upload'] === '1',403,'Envie o arquivo pelo formulário do aplicativo.');
      const photo = parts.length === 2 && parts[0] === 'provider' && parts[1] === 'profile' && req.method === 'PATCH';
      const work = parts.length === 2 && parts[0] === 'provider' && parts[1] === 'posts' && req.method === 'POST';
      const review = parts.length === 5 && parts[0] === 'communities' && parts[2] === 'professionals' &&
        parts[4] === 'reviews' && req.method === 'POST';
      const communityPost = parts.length === 3 && parts[0] === 'communities' && parts[2] === 'posts' && req.method === 'POST';
      requireThat(photo || work || review || communityPost,415,'Este formulário não recebe mídias.');
      if (photo || work) requireThat(isProvider(user),403,'Use uma conta de prestador.');
      if (review || communityPost) requireThat(!isProvider(user) &&
        store.state.communities.some(c => c.id === parts[1] && c.memberIds.includes(user.id)),404,'Comunidade indisponível.');
      if (review) requireThat(store.state.professionals.some(p => p.id === parts[3] && p.communityId === parts[1]),404,'Ficha indisponível.');
      requireThat(activeUploads < 3,429,'O servidor está recebendo outros arquivos. Tente novamente em instantes.');
      activeUploads++;
      try {
        const {body,files} = await readMultipart(req,photo);
        return send(200,await commit(body,files));
      } finally { activeUploads--; }
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Falha ao processar solicitação:', error.message);
      if (!res.headersSent) send(error instanceof HttpError ? error.status : 500,
        {error:error instanceof HttpError ? error.message : 'Não foi possível concluir a operação.'});
    }
  });
}
module.exports = { createApplication };
