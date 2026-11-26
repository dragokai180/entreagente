'use strict';

const { randomBytes, randomUUID } = require('node:crypto');

const {recentFirst, profileContent, publicPost} = require('./providers');

const categories = ['Elétrica', 'Hidráulica', 'Limpeza', 'Pintura', 'Reparos', 'Climatização', 'Outros'];
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const phoneDigits = value => String(value ?? '').replace(/\D/g, '');
const unique = values => [...new Set(values.filter(Boolean))];

function emptyState() {
  return {
    version: 2, activationKey: randomBytes(32).toString('hex'),
    users: [], communities: [], invitations: [], professionals: [], reviews: [],
    savedByUser: {}, unresolvedSaves: []
  };
}

function newUser(state, name) {
  const words = normalize(name).replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const stem = (words.length > 1 ? words[0] + '.' + words.at(-1) : words[0] || 'morador').slice(0, 42);
  let loginId;
  do { loginId = stem + '.' + randomBytes(3).toString('hex'); }
  while (state.users.some(user => user.loginId === loginId));
  return { id: randomUUID(), loginId, name, passwordHash: null };
}

function roleOf(community, userId) {
  if (community.creatorId === userId) return 'criador';
  if (community.moderatorIds.includes(userId)) return 'moderador';
  return 'morador';
}

function publicReview(row, usernames) {
  return {
    id: row.id, author: usernames.get(row.authorId) || row.authorName || 'Morador',
    service: row.service, rating: row.rating, description: row.description,
    recommend: row.recommend, createdAt: row.createdAt, media: row.media || []
  };
}

function professionalView(state, prof, rows, userId) {
  const scored = rows.filter(row => row.rating >= 1 && row.rating <= 5);
  const positive = rows.filter(row => row.recommend);
  return {
    id: prof.id, name: prof.name, category: prof.category, about: prof.about || '',
    services: unique(rows.map(row => row.service)),
    searchText: rows.map(row => row.description).join(' '),
    rating: scored.length ? scored.reduce((n, r) => n + r.rating, 0) / scored.length : null,
    reviewCount: rows.length, recommenderCount: unique(positive.map(r => r.authorId)).length,
    mine: positive.some(r => r.authorId === userId),
    saved: (state.savedByUser[userId] || []).includes(prof.id),
    needsReview: Boolean(prof.needsReview)
  };
}

function catalogFor(state, communityId, userId) {
  const byProfessional = new Map();
  for (const review of state.reviews) {
    if (review.communityId !== communityId) continue;
    if (!byProfessional.has(review.professionalId)) byProfessional.set(review.professionalId, []);
    byProfessional.get(review.professionalId).push(review);
  }
  return state.professionals.filter(p => p.communityId === communityId)
    .map(p => professionalView(state, p, byProfessional.get(p.id) || [], userId));
}

function profileFor(state, prof, userId) {
  const rows = state.reviews.filter(r => r.communityId === prof.communityId && r.professionalId === prof.id);
  const usernames = new Map(state.users.map(u => [u.id, u.name]));
  return {
    ...professionalView(state, prof, rows, userId), contact: prof.contact,
    ...profileContent(state,prof),
    linked: Boolean(prof.providerId), pendingLink: Boolean(prof.pendingProviderId),
    reviews: rows.sort(recentFirst).map(r => publicReview(r, usernames))
  };
}

function feedFor(state, communityId, viewerId) {
  const pros = new Map(state.professionals.filter(p => p.communityId === communityId).map(p => [p.id, p]));
  const usernames = new Map(state.users.map(u => [u.id, u.name]));
  const reviews = state.reviews.filter(row => row.communityId === communityId && row.recommend && row.createdAt && pros.has(row.professionalId))
    .map(row => ({
      ...publicReview(row, usernames), kind:'recommendation', professionalId: row.professionalId,
      professionalName: pros.get(row.professionalId).name, category: pros.get(row.professionalId).category
    }));
  const works = (state.portfolio || []).filter(post => post.visibility === 'community' &&
    pros.has(post.professionalId) && pros.get(post.professionalId).providerId === post.ownerId)
    .map(post => ({...publicPost(post), author:usernames.get(post.ownerId), professionalName:pros.get(post.professionalId).name,
      category:pros.get(post.professionalId).category}));
  const c = state.communities.find(c => c.id === communityId);
  const canModerate = c && viewerId && roleOf(c,viewerId) !== 'morador';
  const communityPosts = (state.communityPosts || []).filter(post => post.communityId === communityId)
    .map(post => ({id:post.id,kind:'community',author:usernames.get(post.authorId) || 'Morador',
      description:post.description,createdAt:post.createdAt,media:post.media,
      canDelete:Boolean(canModerate || viewerId === post.authorId)}));
  return [...reviews, ...works, ...communityPosts].sort(recentFirst);
}

module.exports = { categories, normalize, phoneDigits, unique, emptyState, newUser, roleOf, catalogFor, profileFor, feedFor };
