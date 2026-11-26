const fs = require('node:fs');
const { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } = require('node:crypto');

const cookieName = 'entreagente_session';
const sessionAge = 30 * 24 * 60 * 60 * 1000;
const categories = ['Elétrica', 'Hidráulica', 'Limpeza', 'Pintura', 'Reparos', 'Climatização'];

function createAuth({ file, state, persistState, cleanupImages }) {
  let auth;
  try { auth = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    auth = { accounts: [], sessions: [] };
  }
  if (!Array.isArray(auth.accounts) || !Array.isArray(auth.sessions)) throw new Error('Arquivo de contas inválido');

  const save = () => {
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(auth, null, 2));
    fs.renameSync(temp, file);
  };
  const hashToken = token => createHash('sha256').update(token).digest('hex');
  const normalizedEmail = value => String(value || '').trim().toLowerCase();
  const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validPassword = password => typeof password === 'string' && password.length >= 8 && password.length <= 128;
  const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
  const checkPassword = (account, password) => {
    if (typeof password !== 'string') return false;
    const actual = Buffer.from(passwordHash(password, account.salt), 'hex');
    const expected = Buffer.from(account.passwordHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const cookie = (req, token, maxAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.socket.encrypted ? '; Secure' : ''}`;
  const view = account => {
    const professional = state.professionals.find(item => item.ownerId === account.id);
    return { id: account.id, name: account.name, email: account.email, role: account.role,
      ...(professional ? { category: professional.category, contact: professional.contact, about: professional.about } : {}) };
  };
  function current(req) {
    const token = /(?:^|;\s*)entreagente_session=([0-9a-f]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const session = auth.sessions.find(item => item.tokenHash === tokenHash && item.expires > Date.now());
    const account = session && auth.accounts.find(item => item.id === session.accountId);
    return account ? { account, tokenHash } : null;
  }
  const readJson = req => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size <= 32_000) chunks.push(chunk); });
    req.on('end', () => {
      if (size > 32_000) return reject(Object.assign(new Error('Dados muito grandes'), { status: 413 }));
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON inválido');
        resolve(body);
      } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
  const issueSession = (req, res, account, send) => {
    const token = randomBytes(32).toString('hex');
    auth.sessions = auth.sessions.filter(item => item.expires > Date.now());
    auth.sessions.push({ tokenHash: hashToken(token), accountId: account.id, expires: Date.now() + sessionAge });
    save();
    send(res, 200, view(account), { 'Set-Cookie': cookie(req, token, Math.floor(sessionAge / 1000)) });
  };

  async function handle(req, res, url, send) {
    const route = url.pathname;
    if (!['/api/register', '/api/login', '/api/logout', '/api/me'].includes(route)) return false;
    try {
      if (req.method === 'POST' && route === '/api/register') {
        const body = await readJson(req);
        const name = String(body.name || '').trim(), email = normalizedEmail(body.email), password = body.password;
        const role = body.professional ? 'professional' : 'resident';
        if (name.length < 2 || name.length > 80 || !validEmail(email) || !validPassword(password)) return send(res, 400, { error: 'Informe nome, email válido e senha de 8 a 128 caracteres.' }), true;
        if (auth.accounts.some(item => item.email === email)) return send(res, 409, { error: 'Este email já está cadastrado.' }), true;
        const category = String(body.category || ''), contact = String(body.contact || '').trim(), about = String(body.about || '').trim();
        if (role === 'professional' && (!categories.includes(category) || !contact || contact.length > 60 || about.length < 10 || about.length > 300)) return send(res, 400, { error: 'Preencha os dados do profissional.' }), true;
        const salt = randomBytes(16).toString('hex');
        const account = { id: randomUUID(), name, email, role, salt, passwordHash: passwordHash(password, salt) };
        auth.accounts.push(account);
        state.users.push({ id: account.id, name, role });
        if (role === 'professional') state.professionals.push({ id: randomUUID(), ownerId: account.id, name, category, contact, about });
        persistState();
        issueSession(req, res, account, send);
        return true;
      }
      if (req.method === 'POST' && route === '/api/login') {
        const body = await readJson(req), email = normalizedEmail(body.email);
        const account = auth.accounts.find(item => item.email === email);
        if (!account || !checkPassword(account, body.password)) return send(res, 401, { error: 'Email ou senha incorretos.' }), true;
        issueSession(req, res, account, send);
        return true;
      }
      const session = current(req);
      if (!session) return send(res, 401, { error: 'Entre na sua conta.' }), true;
      const { account, tokenHash } = session;
      if (req.method === 'GET' && route === '/api/me') return send(res, 200, view(account)), true;
      if (req.method === 'POST' && route === '/api/logout') {
        auth.sessions = auth.sessions.filter(item => item.tokenHash !== tokenHash);
        save();
        send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
        return true;
      }
      if (req.method === 'PATCH' && route === '/api/me') {
        const body = await readJson(req);
        if (!checkPassword(account, body.currentPassword)) return send(res, 403, { error: 'Senha atual incorreta.' }), true;
        const name = String(body.name || '').trim(), email = normalizedEmail(body.email);
        if (name.length < 2 || name.length > 80 || !validEmail(email)) return send(res, 400, { error: 'Informe nome e email válidos.' }), true;
        if (auth.accounts.some(item => item.id !== account.id && item.email === email)) return send(res, 409, { error: 'Este email já está cadastrado.' }), true;
        if (body.newPassword && !validPassword(body.newPassword)) return send(res, 400, { error: 'A nova senha deve ter de 8 a 128 caracteres.' }), true;
        const professional = state.professionals.find(item => item.ownerId === account.id);
        if (professional) {
          const category = String(body.category || ''), contact = String(body.contact || '').trim(), about = String(body.about || '').trim();
          if (!categories.includes(category) || !contact || contact.length > 60 || about.length < 10 || about.length > 300) return send(res, 400, { error: 'Preencha os dados do profissional.' }), true;
          Object.assign(professional, { name, category, contact, about });
          for (const row of state.recommendations.filter(item => item.professionalId === professional.id)) Object.assign(row, { name, category, contact });
        }
        const oldEmail = account.email;
        Object.assign(account, { name, email });
        if (body.newPassword) {
          account.salt = randomBytes(16).toString('hex');
          account.passwordHash = passwordHash(body.newPassword, account.salt);
          auth.sessions = auth.sessions.filter(item => item.accountId !== account.id || item.tokenHash === tokenHash);
        }
        const user = state.users.find(item => item.id === account.id);
        if (user) user.name = name;
        for (const invitation of state.invitations) {
          if (invitation.email === oldEmail) invitation.email = email;
          if (invitation.senderId === account.id) invitation.sender = name;
        }
        for (const row of state.recommendations.filter(item => item.authorId === account.id)) row.author = name;
        persistState(); save();
        send(res, 200, view(account));
        return true;
      }
      if (req.method === 'DELETE' && route === '/api/me') {
        const body = await readJson(req);
        if (!checkPassword(account, body.password)) return send(res, 403, { error: 'Senha incorreta.' }), true;
        const previous = state.recommendations.slice();
        const ownedCommunities = new Set(state.communities.filter(item => item.creatorId === account.id).map(item => item.id));
        const ownedProfessionals = new Set(state.professionals.filter(item => item.ownerId === account.id).map(item => item.id));
        state.users = state.users.filter(item => item.id !== account.id);
        state.professionals = state.professionals.filter(item => item.ownerId !== account.id);
        state.communities = state.communities.filter(item => !ownedCommunities.has(item.id));
        for (const community of state.communities) {
          community.members = community.members.filter(id => id !== account.id);
          community.moderators = (community.moderators || []).filter(id => id !== account.id);
        }
        state.invitations = state.invitations.filter(item => item.email !== account.email && item.senderId !== account.id && !ownedCommunities.has(item.communityId));
        state.recommendations = state.recommendations.filter(item => item.authorId !== account.id && !ownedCommunities.has(item.communityId) && !ownedProfessionals.has(item.professionalId));
        delete state.savedByUser[account.id];
        for (const [userId, keys] of Object.entries(state.savedByUser)) {
          state.savedByUser[userId] = keys.filter(key => ![...ownedCommunities].some(id => key.startsWith(id + ':')) && ![...ownedProfessionals].some(id => key.endsWith(':' + id)));
        }
        cleanupImages(previous);
        auth.accounts = auth.accounts.filter(item => item.id !== account.id);
        auth.sessions = auth.sessions.filter(item => item.accountId !== account.id);
        persistState(); save();
        send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
        return true;
      }
      send(res, 405, { error: 'Método não permitido' });
      return true;
    } catch (error) {
      send(res, error.status || 500, { error: error.message || 'Falha no servidor' });
      return true;
    }
  }
  return { current, handle, view };
}

module.exports = { createAuth };
