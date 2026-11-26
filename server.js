const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const file = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(root, 'entreagente-data.json');
const imageDir = path.join(path.dirname(file), 'entreagente-images');
const page = path.join(root, 'entreagente_mockup.html');
const empty = () => ({ users: [], communities: [], invitations: [], professionals: [], recommendations: [], savedByPhone: {} });
let state;
try { state = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = empty();
}

const copy = value => JSON.parse(JSON.stringify(value));
const byId = (items, key) => new Map((Array.isArray(items) ? items : []).map(item => [item[key], item]));
function mergeList(current, base, next, key) {
  const output = byId(current, key), old = byId(base, key), incoming = byId(next, key);
  for (const [id, item] of incoming) {
    if (!old.has(id) || JSON.stringify(old.get(id)) !== JSON.stringify(item)) output.set(id, item);
  }
  for (const id of old.keys()) if (!incoming.has(id)) output.delete(id);
  return [...output.values()];
}
function mergeMembers(current, base, next) {
  const result = new Set(current || []);
  for (const item of next || []) if (!(base || []).includes(item)) result.add(item);
  for (const item of base || []) if (!(next || []).includes(item)) result.delete(item);
  return [...result];
}
function mergeCommunities(current, base, next) {
  const output = byId(current, 'id'), old = byId(base, 'id');
  for (const item of next || []) {
    const previous = old.get(item.id), live = output.get(item.id);
    if (!previous) { output.set(item.id, item); continue; }
    if (!live) continue;
    output.set(item.id, {
      ...live,
      name: item.name !== previous.name ? item.name : live.name,
      members: mergeMembers(live.members, previous.members, item.members),
      moderators: mergeMembers(live.moderators, previous.moderators, item.moderators)
    });
  }
  return [...output.values()];
}
function mergeSaved(current, base, next) {
  const output = copy(current || {});
  for (const phone of new Set([...Object.keys(base || {}), ...Object.keys(next || {})])) {
    output[phone] = mergeMembers(output[phone], base?.[phone], next?.[phone]);
  }
  return output;
}
function sync(base, next) {
  const previousImages = new Set(state.recommendations.map(item => item.imageId).filter(Boolean));
  state.users = mergeList(state.users, base.users, next.users, 'phone');
  state.communities = mergeCommunities(state.communities, base.communities, next.communities);
  state.invitations = mergeList(state.invitations, base.invitations, next.invitations, 'id');
  state.professionals = mergeList(state.professionals, base.professionals, next.professionals, 'id');
  state.recommendations = mergeList(state.recommendations, base.recommendations, next.recommendations, 'id');
  state.savedByPhone = mergeSaved(state.savedByPhone, base.savedByPhone, next.savedByPhone);
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, file);
  const currentImages = new Set(state.recommendations.map(item => item.imageId).filter(Boolean));
  for (const id of previousImages) {
    if (!currentImages.has(id) && imageName(id)) fs.rmSync(path.join(imageDir, id), { force: true });
  }
}
const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const imageName = name => /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/.test(name);
function validImage(buffer, type) {
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (type === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (type === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}
function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/entreagente_mockup.html')) {
    return send(res, 200, fs.readFileSync(page), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state);
  if (req.method === 'GET' && url.pathname.startsWith('/api/images/')) {
    const id = url.pathname.slice('/api/images/'.length);
    if (!imageName(id)) return send(res, 404, { error: 'Imagem não encontrada' });
    try {
      const ext = id.slice(id.lastIndexOf('.') + 1);
      return send(res, 200, fs.readFileSync(path.join(imageDir, id)), { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext]);
    } catch (error) {
      if (error.code === 'ENOENT') return send(res, 404, { error: 'Imagem não encontrada' });
      return send(res, 500, { error: 'Falha ao ler imagem' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/images') {
    const type = req.headers['content-type']?.split(';')[0];
    if (!imageTypes[type]) return send(res, 415, { error: 'Use uma imagem JPG, PNG ou WebP' });
    const chunks = [];
    let size = 0, tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 2_000_000) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return send(res, 413, { error: 'Imagem maior que 2 MB' });
      const image = Buffer.concat(chunks);
      if (!validImage(image, type)) return send(res, 400, { error: 'Arquivo de imagem inválido' });
      try {
        const id = randomUUID() + '.' + imageTypes[type];
        fs.mkdirSync(imageDir, { recursive: true });
        fs.writeFileSync(path.join(imageDir, id), image, { flag: 'wx' });
        send(res, 201, { id, url: '/api/images/' + id });
      } catch { send(res, 500, { error: 'Falha ao guardar imagem' }); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/sync') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.base || !payload.next || !Array.isArray(payload.next.communities) || !Array.isArray(payload.next.professionals)) throw new Error('Cliente desatualizado ou dados inválidos');
        sync(payload.base, payload.next);
        send(res, 200, state);
      } catch (error) { send(res, 400, { error: error.message }); }
    });
    return;
  }
  send(res, 404, { error: 'Não encontrado' });
}).listen(port, host, () => console.log('entreagente disponível em http://' + host + ':' + port));
