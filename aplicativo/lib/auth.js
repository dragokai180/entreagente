'use strict';

const { createHmac, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { requireThat, field } = require('./validation');
const { newUser } = require('./model');

const derive = promisify(scrypt);
const cost = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const ttl = 8 * 60 * 60 * 1000;
const publicUser = u => ({ id: u.id, loginId: u.loginId, name: u.name, accountType: u.accountType || 'resident' });
function needsAccountType(state, user) {
  if (user.accountType === 'pending') return true;
  if (user.accountType === 'provider' || user.accountTypeConfirmed) return false;
  // Versões anteriores atribuíam morador por padrão, mesmo sem uma escolha.
  return !state.communities.some(community => community.memberIds.includes(user.id));
}

function chooseAccountType(state, user, type) {
  requireThat(['resident','provider'].includes(type),400,'Escolha Morador ou Prestador de serviços.');
  const account = state.users.find(entry => entry.id === user.id);
  requireThat(needsAccountType(state, account) || (account.accountType || 'resident') === type,
    409,'O tipo de perfil já foi confirmado. Atualize a página para abrir sua área.');
  account.accountType = type;
  account.accountTypeConfirmed = true;
  return {user:publicUser(account)};
}

const same = (a, b) => a.length === b.length && timingSafeEqual(a, b);
const dummy = '0'.repeat(32) + ':' + '0'.repeat(64);

async function encodePassword(value) {
  requireThat(typeof value === 'string' && value.length >= 15 && value.length <= 128, 400,
    'Escolha uma senha com 15 a 128 caracteres. Uma frase também funciona.');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(value, salt, 32, cost);
  return salt + ':' + key.toString('hex');
}
async function verifyPassword(user, value) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const [salt, digest] = (user?.passwordHash || dummy).split(':');
  const key = await derive(value, salt, 32, cost);
  return same(key, Buffer.from(digest, 'hex')) && Boolean(user?.passwordHash);
}

function activationCode(state, user, expires = Date.now() + 86400000) {
  const payload = user.id + '.' + expires;
  const tag = createHmac('sha256', state.activationKey).update(payload).digest('hex');
  return payload + '.' + tag;
}
function activationUser(state, code) {
  const [id, expires] = String(code || '').split('.');
  const user = state.users.find(u => u.id === id && u.legacyPhone && !u.passwordHash);
  const valid = user && /^\d{13}$/.test(expires) && Number(expires) > Date.now() &&
    same(Buffer.from(code), Buffer.from(activationCode(state, user, Number(expires))));
  requireThat(valid, 400, 'Código de ativação inválido, utilizado ou vencido.');
  return user;
}

function createAuth(store, secureCookie) {
  const sessions = new Map(), attempts = new Map();
  const cookie = (value, seconds) => 'ea_session=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
    seconds + (secureCookie ? '; Secure' : '');
  const tokenOf = req => /(?:^|;\s*)ea_session=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  function current(req) {
    const token = tokenOf(req), session = sessions.get(token);
    if (!session || session.expires <= Date.now()) { sessions.delete(token); return null; }
    return store.state.users.find(u => u.id === session.id) || null;
  }
  function start(req, res, user) {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
    sessions.delete(tokenOf(req));
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { id: user.id, expires: now + ttl });
    res.setHeader('Set-Cookie', cookie(token, ttl / 1000));
    return { user: publicUser(user) };
  }
  async function handle(action, body, req, res) {
    if (action === 'logout') {
      sessions.delete(tokenOf(req));
      res.setHeader('Set-Cookie', cookie('', 0));
      return { ok: true };
    }
    requireThat(['login','register','activate'].includes(action), 404, 'Rota inexistente.');
    const now = Date.now(), address = req.socket.remoteAddress || 'local';
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const window = attempts.get(address) || { count: 0, until: now + 600000 };
    requireThat(window.count < 30, 429, 'Muitas tentativas. Tente novamente em alguns minutos.');
    window.count++;
    attempts.set(address, window);
    let user;
    if (action === 'login') {
      const loginId = field(body.loginId, 'ID de acesso', 1, 80).toLowerCase();
      user = store.state.users.find(u => u.loginId === loginId);
      requireThat(await verifyPassword(user, body.password), 401, 'Confira o ID e a senha.');
    } else if (action === 'register') {
      const name = field(body.name, 'Nome', 2, 80);
      const accountType = body.accountType ?? 'resident';
      requireThat(['resident','provider','pending'].includes(accountType), 400, 'Escolha morador ou prestador de serviços.');
      const hash = await encodePassword(body.password);
      user = store.change(state => {
        const entry = { ...newUser(state, name), passwordHash: hash, accountType, accountTypeConfirmed:accountType !== 'pending' };
        state.users.push(entry);
        return entry;
      });
    } else {
      const code = field(body.code, 'Código de ativação', 1, 200);
      activationUser(store.state, code);
      const name = field(body.name, 'Nome', 2, 80);
      const hash = await encodePassword(body.password);
      user = store.change(state => {
        const entry = activationUser(state, code);
        entry.passwordHash = hash;
        entry.name = name;
        return entry;
      });
    }
    window.count = Math.max(0, window.count - 1);
    return start(req, res, user);
  }
  return { current, handle };
}
module.exports = { createAuth, publicUser, activationCode, needsAccountType, chooseAccountType };
