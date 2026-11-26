'use strict';

const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { categories, roleOf, profileFor, catalogFor, feedFor } = require('./model');
const { field, requireThat, requestKey } = require('./validation');
const { publicUser, needsAccountType, chooseAccountType } = require('./auth');

const digest = value => createHash('sha256').update(value).digest('hex');
const ok = { ok: true };
const {isProvider, manageLink, detachProvider} = require('./providers');

function membership(s, id, userId) {
  const c = s.communities.find(c => c.id === id && c.memberIds.includes(userId));
  requireThat(c, 404, 'Comunidade indisponível.');
  return c;
}
function professional(s, communityId, id) {
  const prof = s.professionals.find(p => p.id === id && p.communityId === communityId);
  requireThat(prof, 404, 'Profissional indisponível.');
  return prof;
}
function me(s, u) {
  const communities = s.communities.filter(c => c.memberIds.includes(u.id))
    .map(c => ({ id: c.id, name: c.name, role: roleOf(c, u.id) }));
  const invites = s.invitations.filter(i => i.recipientId === u.id && i.status === 'pending').map(i => ({
    id:i.id, communityName:s.communities.find(c => c.id === i.communityId)?.name || 'Comunidade',
    senderName:i.senderName
  }));
  return { user:publicUser(u), needsAccountType:needsAccountType(s,u), communities, invites, categories };
}
function professionalFields(body) {
  const name = field(body.name, 'Nome do profissional', 2, 80);
  requireThat(categories.includes(body.category), 400, 'Escolha uma categoria.');
  const contact = field(body.contact, 'Contato', 0, 100);
  requireThat(!contact || body.consent === true, 400, 'Confirme a autorização para divulgar o contato.');
  return { name, category: body.category, contact, about: field(body.about, 'Sobre o profissional', 0, 500) };
}
function createProfessional(s, c, u, body) {
  const key = requestKey(body);
  let prof = s.professionals.find(p => p.communityId === c.id && p.createdBy === u.id && p.requestId === key);
  if (!prof) {
    prof = { ...professionalFields(body), id:randomUUID(), communityId:c.id, createdBy:u.id,
      createdAt:new Date().toISOString(), requestId:key };
    s.professionals.push(prof);
  }
  return { id:prof.id };
}
function addReview(s, c, prof, u, body, media) {
  const key = requestKey(body);
  let row = s.reviews.find(r => r.professionalId === prof.id && r.authorId === u.id && r.requestId === key);
  if (!row) {
    requireThat(Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5, 400, 'Escolha uma nota de 1 a 5.');
    requireThat(typeof body.recommend === 'boolean', 400, 'Informe se recomenda o profissional.');
    row = { id:randomUUID(), requestId:key, communityId:c.id, professionalId:prof.id, authorId:u.id,
      service:field(body.service,'Serviço',3,80), description:field(body.description,'Relato',10,600),
      rating:body.rating, recommend:body.recommend, createdAt:new Date().toISOString(), media };
    s.reviews.push(row);
  }
  return { id:row.id };
}
function inviteResident(s, c, u, body) {
  requireThat(c.creatorId === u.id, 403, 'Somente o criador pode convidar moradores.');
  const loginId = field(body.loginId, 'ID do morador', 0, 80).toLowerCase();
  const invite = { id:randomUUID(), communityId:c.id, senderName:u.name, status:'pending' };
  if (loginId) {
    const recipient = s.users.find(other => other.loginId === loginId);
    requireThat(recipient && !isProvider(recipient), 404, 'ID não encontrado. Você também pode gerar um código de convite.');
    requireThat(!c.memberIds.includes(recipient.id), 409, 'Esse morador já participa.');
    if (!s.invitations.some(i => i.communityId === c.id && i.recipientId === recipient.id && i.status === 'pending')) {
      s.invitations.push({ ...invite, recipientId:recipient.id });
    }
    return ok;
  }
  const code = randomBytes(16).toString('hex');
  s.invitations.push({ ...invite, codeHash:digest(code), expires:Date.now() + 86400000 });
  return { code };
}
function answerInvite(s, u, action, id, body) {
  let invite;
  if (action === 'redeem') {
    const key = digest(field(body.code, 'Código', 1, 100));
    invite = s.invitations.find(i => i.codeHash === key && i.status === 'pending' && i.expires > Date.now());
    requireThat(invite, 400, 'Convite inválido, utilizado ou vencido.');
    const c = s.communities.find(c => c.id === invite.communityId);
    requireThat(c && !c.memberIds.includes(u.id), 409, 'Você já participa ou a comunidade está indisponível.');
    invite.recipientId = u.id;
    c.memberIds.push(u.id);
    invite.status = 'accepted';
  } else {
    requireThat(typeof body.accept === 'boolean', 400, 'Escolha aceitar ou recusar.');
    invite = s.invitations.find(i => i.id === id && i.recipientId === u.id);
    requireThat(invite, 404, 'Convite indisponível.');
    const status = body.accept ? 'accepted' : 'declined';
    if (invite.status === status) return ok;
    requireThat(invite.status === 'pending', 409, 'Esse convite já foi respondido.');
    const c = s.communities.find(c => c.id === invite.communityId);
    requireThat(c, 404, 'Comunidade indisponível.');
    if (body.accept && !c.memberIds.includes(u.id)) c.memberIds.push(u.id);
    invite.status = status;
  }
  return { communityId:invite.communityId };
}
function changeResident(c, u, targetId, method, body) {
  const role = roleOf(c, u.id);
  requireThat(c.memberIds.includes(targetId), 404, 'Morador indisponível.');
  requireThat(c.creatorId !== targetId && u.id !== targetId, 403, 'Ação indisponível para esta conta.');
  if (method === 'PATCH') {
    requireThat(role === 'criador', 403, 'Somente o criador gerencia a moderação.');
    requireThat(typeof body.moderator === 'boolean', 400, 'Escolha uma função.');
    c.moderatorIds = c.moderatorIds.filter(id => id !== targetId);
    if (body.moderator) c.moderatorIds.push(targetId);
  } else {
    requireThat(role === 'criador' || (role === 'moderador' && !c.moderatorIds.includes(targetId)), 403,
      'Somente a moderação pode remover este morador.');
    c.memberIds = c.memberIds.filter(id => id !== targetId);
    c.moderatorIds = c.moderatorIds.filter(id => id !== targetId);
  }
  return ok;
}

// O roteador passa o usuário da sessão. O corpo contém somente os dados da ação.
function communityRoute(s, u, method, parts, body, media = []) {
  const [root, cid, resource, id, action] = parts;
  if (root === 'me' && cid === 'account-type' && parts.length === 2 && method === 'PUT') {
    return chooseAccountType(s,u,body.accountType);
  }
  if (root === 'me' && parts.length === 1) {
    if (method === 'GET') return me(s, u);
    if (method === 'PATCH') {
      const account = s.users.find(entry => entry.id === u.id);
      account.name = field(body.name, 'Nome', 2, 80);
      return { user:publicUser(account) };
    }
  }
  requireThat(!isProvider(u),403,'Use o painel do prestador para acessar suas fichas.');
  if (root === 'invitations' && method === 'POST') {
    if (cid === 'redeem' && parts.length === 2) return answerInvite(s, u, 'redeem', null, body);
    if (resource === 'answer' && parts.length === 3) return answerInvite(s, u, 'answer', cid, body);
  }
  requireThat(root === 'communities', 404, 'Rota inexistente.');
  if (!cid && method === 'POST') {
    const c = { id:randomUUID(), name:field(body.name,'Nome do condomínio',2,80), creatorId:u.id, memberIds:[u.id], moderatorIds:[] };
    s.communities.push(c);
    return { id:c.id };
  }
  const c = membership(s,cid,u.id);
  if (resource === 'feed' && method === 'GET' && parts.length === 3) return feedFor(s,c.id,u.id);
  if (resource === 'posts') {
    if (parts.length === 3 && method === 'POST') {
      const key = requestKey(body), posts = s.communityPosts ||= [];
      const prior = posts.find(p => p.communityId === c.id && p.authorId === u.id && p.requestId === key);
      if (prior) return {id:prior.id};
      requireThat(media.length,400,'Selecione pelo menos uma foto ou um vídeo.');
      const post = {id:randomUUID(),communityId:c.id,authorId:u.id,requestId:key,createdAt:new Date().toISOString(),
        description:field(body.description,'Legenda',0,1400),media};
      posts.push(post);
      return {id:post.id};
    }
    if (parts.length === 4 && method === 'DELETE') {
      const p = (s.communityPosts || []).find(p => p.id === id && p.communityId === c.id);
      requireThat(p,404,'Publicação indisponível.');
      requireThat(p.authorId === u.id || roleOf(c,u.id) !== 'morador',403,'Apenas o autor ou a moderação pode excluir.');
      s.communityPosts = s.communityPosts.filter(p => p.id !== id);
      return ok;
    }
  }
  if (resource === 'invitations' && method === 'POST' && parts.length === 3) return inviteResident(s,c,u,body);
  if (resource === 'residents') {
    if (method === 'GET' && parts.length === 3) {
      return s.users.filter(other => c.memberIds.includes(other.id)).map(other => ({...publicUser(other), role:roleOf(c,other.id)}));
    }
    if (parts.length === 4 && ['DELETE','PATCH'].includes(method)) return changeResident(c,u,id,method,body);
  }
  requireThat(resource === 'professionals', 404, 'Rota inexistente.');
  if (!id && method === 'GET') return catalogFor(s,c.id,u.id);
  if (!id && method === 'POST') return createProfessional(s,c,u,body);
  const prof = professional(s,c.id,id);
  if (parts.length === 5 && action === 'provider' && ['POST','DELETE'].includes(method)) {
    requireThat(roleOf(c,u.id) !== 'morador',403,'Somente a moderação pode vincular um prestador.');
    return manageLink(s,prof,method,body);
  }
  if (!action && method === 'GET') return profileFor(s,prof,u.id);
  if (parts.length === 5 && action === 'reviews' && method === 'POST') return addReview(s,c,prof,u,body,media);
  if (parts.length === 5 && action === 'saved' && method === 'PUT') {
    requireThat(typeof body.saved === 'boolean', 400, 'Escolha salvar ou remover dos salvos.');
    const ids = (s.savedByUser[u.id] || []).filter(pid => pid !== prof.id);
    if (body.saved) ids.push(prof.id);
    s.savedByUser[u.id] = ids;
    return ok;
  }
  requireThat(!action && ['PATCH','DELETE'].includes(method), 404, 'Rota inexistente.');
  requireThat(roleOf(c,u.id) !== 'morador', 403, 'Somente a moderação pode editar ou excluir uma ficha.');
  if (method === 'PATCH') Object.assign(prof, professionalFields(body), { needsReview:false });
  else {
    detachProvider(s,prof);
    s.professionals = s.professionals.filter(p => p.id !== prof.id);
    s.reviews = s.reviews.filter(r => r.professionalId !== prof.id);
    for (const [uid, ids] of Object.entries(s.savedByUser)) s.savedByUser[uid] = ids.filter(pid => pid !== prof.id);
    for (const save of s.unresolvedSaves) save.candidates = save.candidates.filter(pid => pid !== prof.id);
  }
  return ok;
}
module.exports = { communityRoute };
