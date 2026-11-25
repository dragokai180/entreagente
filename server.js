const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const root = __dirname;
const file = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(root, 'entreagente-data.json');
const page = path.join(root, 'entreagente_mockup.html');
const empty = () => ({ users: [], communities: [], invitations: [], recommendations: [], savedByPhone: {} });
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
  state.users = mergeList(state.users, base.users, next.users, 'phone');
  state.communities = mergeCommunities(state.communities, base.communities, next.communities);
  state.invitations = mergeList(state.invitations, base.invitations, next.invitations, 'id');
  state.recommendations = mergeList(state.recommendations, base.recommendations, next.recommendations, 'id');
  state.savedByPhone = mergeSaved(state.savedByPhone, base.savedByPhone, next.savedByPhone);
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, file);
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
  if (req.method === 'POST' && url.pathname === '/api/sync') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload.base || !payload.next || !Array.isArray(payload.next.communities)) throw new Error('Dados inválidos');
        sync(payload.base, payload.next);
        send(res, 200, state);
      } catch (error) { send(res, 400, { error: error.message }); }
    });
    return;
  }
  send(res, 404, { error: 'Não encontrado' });
}).listen(port, host, () => console.log('entreagente disponível em http://' + host + ':' + port));
