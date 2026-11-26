'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {requireThat, HttpError} = require('./validation');

const MiB = 1024 * 1024;
const limits = {files:4, image:8*MiB, video:32*MiB, total:48*MiB};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const extensions = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};

function detect(bytes) {
  const text = (start,end) => bytes.toString('latin1',start,end);
  if (bytes.length >= 20 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      text(12,16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (text(0,4) === 'RIFF' && text(8,12) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(text(12,16))) return 'image/webp';
  if (bytes.length >= 16 && text(4,8) === 'ftyp') {
    const end = Math.min(bytes.readUInt32BE(0),bytes.length,512);
    const brands = [text(8,12)];
    for (let i=16; i+4<=end; i+=4) brands.push(text(i,i+4));
    if (!brands.some(b => /^(avif|avis|hei.|mif1|msf1)$/.test(b)) &&
        brands.some(b => /^(isom|iso[2-9]|mp4[12v]|avc1|M4V |dash)$/.test(b))) return 'video/mp4';
  }
  if (text(0,4) === '\x1a\x45\xdf\xa3' && bytes.subarray(0,4096).includes(Buffer.from([0x42,0x82,0x84,0x77,0x65,0x62,0x6d]))) return 'video/webm';
  return '';
}

async function readMultipart(req, photoOnly) {
  const bound = (photoOnly ? limits.image : limits.total) + 64*1024;
  requireThat(Number(req.headers['content-length'] || 0) <= bound,413,'O envio ultrapassa o limite de tamanho.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > bound) { req.resume(); throw new HttpError(413,'O envio ultrapassa o limite de tamanho.'); }
    chunks.push(chunk);
  }
  let data;
  try { data = await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData(); }
  catch { throw new HttpError(400,'Envio de arquivos incompleto. Selecione os arquivos e tente novamente.'); }
  requireThat([...data.keys()].every(key => key === 'payload' || key === 'media'),400,'Formulário de mídia inválido.');
  const payloads = data.getAll('payload');
  requireThat(payloads.length === 1 && typeof payloads[0] === 'string' && Buffer.byteLength(payloads[0]) <= 16384,400,'Conteúdo da publicação inválido.');
  let body;
  try { body = JSON.parse(payloads[0]); } catch { throw new HttpError(400,'Dados da publicação inválidos.'); }
  requireThat(body && typeof body === 'object' && !Array.isArray(body),400,'Dados da publicação inválidos.');
  const uploads = data.getAll('media');
  requireThat(uploads.length <= (photoOnly ? 1 : limits.files),400,'Quantidade de arquivos excedida.');
  const files = [];
  let total = 0;
  for (const file of uploads) {
    requireThat(typeof file !== 'string' && file.size > 0,400,'Um dos arquivos está vazio.');
    const ext = path.extname(file.name).slice(1).toLowerCase(), expected = extensions[ext];
    requireThat(typeof expected === 'string' && (!photoOnly || expected.startsWith('image/')),415,'Formato de arquivo não aceito.');
    const max = expected.startsWith('image/') ? limits.image : limits.video;
    total += file.size;
    requireThat(file.size <= max && total <= limits.total,413,'Limite de 8 MiB por foto, 32 MiB por vídeo e 48 MiB por publicação.');
    const bytes = Buffer.from(await file.arrayBuffer()), type = detect(bytes);
    requireThat(type === expected && (!file.type || file.type === 'application/octet-stream' || file.type === type),415,
      'O conteúdo do arquivo não corresponde ao formato selecionado.');
    files.push({bytes,type});
  }
  return {body,files};
}

function inventory(state) {
  const all = new Map();
  function add(files, access) {
    for (const file of files || []) all.set(file.id,{file,access});
  }
  for (const user of state.users) if (user.profile?.photo) add([user.profile.photo],{owner:user.id,scope:'profile'});
  for (const post of state.portfolio || []) add(post.media,{owner:post.ownerId,scope:post.visibility,professional:post.professionalId});
  for (const rows of [state.reviews, state.communityPosts || []]) {
    for (const row of rows) add(row.media,{scope:'community-only',community:row.communityId});
  }
  return all;
}
function allowed(state,user,access) {
  if (user.id === access.owner) return true;
  const memberships = state.communities.filter(c => c.memberIds.includes(user.id)).map(c => c.id);
  if (access.scope === 'community-only') return memberships.includes(access.community);
  if (access.scope === 'private') return false;
  return state.professionals.some(p => p.providerId === access.owner && memberships.includes(p.communityId) &&
    (access.scope === 'profile' || (access.scope === 'community' && access.professional === p.id)));
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]),size-1) : size-1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size ? {start,end} : null;
}

function makeMediaStore(file, store) {
  const directory = file + '.media';
  const filename = id => path.join(directory,id+'.bin');
  const live = inventory(store.state);
  // Uma interrupção entre gravar os bytes e confirmar o JSON só deixa um arquivo sem referência.
  if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
    const id = name.slice(0,-4);
    if (name.endsWith('.bin') && uuid.test(id) && !live.has(id)) fs.unlinkSync(filename(id));
  }
  async function remove(ids) {
    for (const id of ids) {
      try { await fs.promises.unlink(filename(id)); }
      catch (e) { if (e.code !== 'ENOENT') console.error('Limpeza de mídia pendente:',e.code); }
    }
  }
  async function change(files, update) {
    const added = [];
    let committed = false, obsolete = [];
    try {
      if (files.length) await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
      for (const entry of files) {
        const id = randomUUID(), handle = await fs.promises.open(filename(id),'wx',0o600);
        added.push({id,type:entry.type,size:entry.bytes.length});
        try { await handle.writeFile(entry.bytes); } finally { await handle.close(); }
      }
      const before = inventory(store.state);
      const result = store.change(s => update(s,added));
      committed = true;
      const after = inventory(store.state);
      obsolete = [...before.keys(),...added.map(a => a.id)].filter(id => !after.has(id));
      return result;
    } finally { await remove(committed ? obsolete : added.map(a => a.id)); }
  }
  async function serve(req,res,user,id) {
    requireThat(uuid.test(id),404,'Arquivo indisponível.');
    const record = inventory(store.state).get(id);
    requireThat(record && allowed(store.state,user,record.access),404,'Arquivo indisponível.');
    let handle;
    try { handle = await fs.promises.open(filename(id),'r'); }
    catch (e) { if (e.code === 'ENOENT') throw new HttpError(404,'Arquivo indisponível.'); throw e; }
    try {
      const {type,size} = record.file;
      res.setHeader('Accept-Ranges','bytes');
      res.setHeader('Content-Type',type);
      res.setHeader('Cross-Origin-Resource-Policy','same-origin');
      let range;
      if (req.headers.range) {
        range = byteRange(req.headers.range,size);
        if (!range) { res.writeHead(416,{'Content-Range':'bytes */'+size}); res.end(); return; }
        res.setHeader('Content-Range','bytes '+range.start+'-'+range.end+'/'+size);
      }
      res.setHeader('Content-Length',range ? range.end-range.start+1 : size);
      res.writeHead(range ? 206 : 200);
      if (req.method === 'HEAD') { res.end(); return; }
      await pipeline(handle.createReadStream(range || {}),res);
    } finally { await handle.close(); }
  }
  return {change,serve};
}

module.exports = {limits,readMultipart,makeMediaStore};
