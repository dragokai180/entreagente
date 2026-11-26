'use strict';

const {randomUUID} = require('node:crypto');
const {field, requireThat, requestKey} = require('./validation');

const isProvider = user => user?.accountType === 'provider';
const recentFirst = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id.localeCompare(a.id);

function professionalIdentity(user) {
  const p = user.profile || {};
  return {name:user.name, headline:p.headline || '', about:p.about || '', region:p.region || '',
    skills:p.skills || [], experience:p.experience || [], photo:p.photo || null};
}

function ownPortal(state, user) {
  const linked = [], pending = [];
  const communities = new Map(state.communities.map(c => [c.id,c.name]));
  for (const p of state.professionals) {
    const item = {professionalId:p.id, name:p.name, community:communities.get(p.communityId), category:p.category};
    if (p.providerId === user.id) linked.push(item);
    else if (p.pendingProviderId === user.id) pending.push(item);
  }
  const posts = (state.portfolio || []).filter(post => post.ownerId === user.id).sort(recentFirst);
  return {profile:professionalIdentity(user), linked, pending, posts:posts.map(publicPost)};
}

function publicPost(p) {
  return {id:p.id,kind:'portfolio',title:p.title,description:p.description,media:p.media || [],
    createdAt:p.createdAt,visibility:p.visibility,professionalId:p.professionalId || null};
}

function shownOn(post, prof) {
  return Boolean(prof.providerId) && post.ownerId === prof.providerId &&
    (post.visibility === 'profile' || (post.visibility === 'community' && post.professionalId === prof.id));
}

function profileContent(state, prof) {
  const owner = state.users.find(u => u.id === prof.providerId && isProvider(u));
  if (!owner) return {identity:null,portfolio:[]};
  const posts = (state.portfolio || []).filter(post => shownOn(post,prof)).sort(recentFirst);
  return {identity:professionalIdentity(owner), portfolio:posts.map(publicPost)};
}

function detachProvider(state, prof) {
  for (const post of state.portfolio || []) {
    if (post.professionalId === prof.id) {
      post.visibility = 'private';
      post.professionalId = null;
    }
  }
  delete prof.providerId;
  delete prof.pendingProviderId;
}

function manageLink(state, prof, method, body) {
  if (method === 'DELETE') { detachProvider(state,prof); return {ok:true}; }
  const login = field(body.loginId,'ID do prestador',1,80).toLowerCase();
  const target = state.users.find(u => isProvider(u) && u.loginId === login);
  requireThat(target,404,'Conta de prestador não encontrada.');
  requireThat(!prof.providerId,409,'Esta ficha já possui uma conta vinculada.');
  requireThat(!prof.pendingProviderId || prof.pendingProviderId === target.id,409,'Cancele o convite atual antes de enviar outro.');
  const other = state.professionals.some(p => p.communityId === prof.communityId && p.id !== prof.id &&
    (p.providerId === target.id || p.pendingProviderId === target.id));
  requireThat(!other,409,'Esta conta já tem uma ficha ou convite neste condomínio.');
  prof.pendingProviderId = target.id;
  return {ok:true};
}

function updateProfile(user, body, files) {
  requireThat(files.length <= 1 && files.every(f => f.type.startsWith('image/')),400,'Escolha uma foto para o perfil.');
  requireThat(Array.isArray(body.skills) && body.skills.length <= 12,400,'Inclua até 12 competências.');
  requireThat(Array.isArray(body.experience) && body.experience.length <= 8,400,'Inclua até 8 experiências.');
  const experience = body.experience.map(item => ({
    role:field(item?.role,'Função',2,90), organization:field(item?.organization,'Empresa ou projeto',0,100),
    period:field(item?.period,'Período',0,60), description:field(item?.description,'Atividades',0,420)
  }));
  const photo = files[0] || (body.removePhoto === true ? null : user.profile?.photo || null);
  user.profile = {headline:field(body.headline,'Título profissional',0,120), about:field(body.about,'Apresentação',0,1200),
    region:field(body.region,'Região de atendimento',0,120), experience,
    skills:[...new Set(body.skills.map(s => field(s,'Competência',1,50)))], photo};
  return {ok:true};
}

function publishWork(s, u, body, media) {
  const key = requestKey(body);
  const posts = s.portfolio ||= [];
  const prior = posts.find(p => p.ownerId === u.id && p.requestId === key);
  if (prior) return {id:prior.id};
  const visibility = body.visibility;
  requireThat(['profile','community'].includes(visibility),400,'Escolha onde publicar.');
  let professionalId = null;
  if (visibility === 'community') {
    const p = s.professionals.find(p => p.id === body.professionalId && p.providerId === u.id);
    requireThat(p,403,'Você precisa de um vínculo ativo com este condomínio.');
    professionalId = p.id;
  }
  const post = {id:randomUUID(),ownerId:u.id,professionalId,visibility,requestId:key,createdAt:new Date().toISOString(),
    title:field(body.title,'Título do trabalho',2,100),description:field(body.description,'Descrição',0,1400),media};
  requireThat(post.description || media.length,400,'Descreva o trabalho ou adicione uma foto ou um vídeo.');
  posts.push(post);
  return {id:post.id};
}

function providerRoute(s, u, method, parts, body, media) {
  requireThat(isProvider(u),403,'Esta área é exclusiva do prestador.');
  const [, resource, id] = parts;
  if (parts.length === 1 && method === 'GET') return ownPortal(s,u);
  if (parts.length === 2 && resource === 'profile' && method === 'PATCH') {
    return updateProfile(s.users.find(x => x.id === u.id),body,media);
  }
  if (parts.length === 3 && resource === 'links' && method === 'POST') {
    const p = s.professionals.find(p => p.id === id && (p.pendingProviderId === u.id || p.providerId === u.id));
    requireThat(p,404,'Convite indisponível.');
    requireThat(typeof body.accept === 'boolean',400,'Escolha aceitar ou recusar o convite.');
    if (p.providerId === u.id && body.accept) return {ok:true};
    requireThat(p.pendingProviderId === u.id && !p.providerId,409,'O vínculo já foi respondido.');
    if (body.accept) p.providerId = u.id;
    delete p.pendingProviderId;
    return {ok:true};
  }
  if (resource === 'posts' && parts.length === 2 && method === 'POST') return publishWork(s,u,body,media);
  if (resource === 'posts' && parts.length === 3 && method === 'DELETE') {
    const post = (s.portfolio || []).find(p => p.id === id && p.ownerId === u.id);
    requireThat(post,404,'Trabalho indisponível.');
    s.portfolio = s.portfolio.filter(p => p.id !== id);
    return {ok:true};
  }
  requireThat(false,404,'Rota inexistente.');
}

module.exports = {isProvider, recentFirst, professionalIdentity, profileContent, manageLink, detachProvider, providerRoute, publicPost, shownOn};
