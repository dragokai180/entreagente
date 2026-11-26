'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { emptyState, newUser, normalize, phoneDigits, unique } = require('./model');

function migrateLegacy(old) {
  if (old && old.version === undefined && Object.hasOwn(old, 'savedByUser')) {
    throw new Error('Esta base usa login por e-mail. Abra-a com npm run start:email na raiz ou selecione a base por ID em DATA_FILE.');
  }
  if (old.version !== undefined || ![old.users, old.communities, old.recommendations, old.invitations].every(Array.isArray)) {
    throw new Error('Formato de dados desconhecido. O arquivo original foi preservado.');
  }
  const state = emptyState();
  const byPhone = new Map();
  function account(phone, name) {
    const key = phoneDigits(phone);
    if (!key) return null;
    if (!byPhone.has(key)) {
      const user = { ...newUser(state, name || 'Morador'), legacyPhone: key };
      state.users.push(user);
      byPhone.set(key, user);
    }
    return byPhone.get(key).id;
  }
  for (const user of old.users) account(user.phone, user.name);
  for (const community of old.communities) {
    const creatorId = account(community.creatorPhone);
    const memberIds = unique([creatorId, ...(community.members || []).map(p => account(p))]);
    state.communities.push({
      id: community.id, name: community.name, creatorId, memberIds,
      moderatorIds: unique((community.moderators || []).map(p => account(p))).filter(id => memberIds.includes(id))
    });
  }
  for (const invite of old.invitations) {
    state.invitations.push({
      id: invite.id, communityId: invite.communityId, recipientId: account(invite.phone),
      senderName: invite.sender || 'Comunidade', status: invite.status || 'pending'
    });
  }

  // O formato antigo usava condomínio + nome como chave, inclusive nos favoritos.
  const profilesByOldKey = new Map();
  const forRow = new Map();
  const oldKey = row => row.communityId + ':' + normalize(row.name);
  function addProfile(row, needsReview = false) {
    const prof = {
      id: randomUUID(), communityId: row.communityId, name: row.name, category: row.category || row.service || 'Outros',
      contact: row.contact || '', about: '', createdBy: row.indication === true ? account(row.authorPhone) : null,
      createdAt: null, needsReview
    };
    state.professionals.push(prof);
    const key = oldKey(row);
    if (!profilesByOldKey.has(key)) profilesByOldKey.set(key, []);
    profilesByOldKey.get(key).push(prof);
    return prof;
  }

  for (const row of old.recommendations.filter(r => r.indication === true)) {
    forRow.set(row, addProfile(row));
  }
  for (const row of old.recommendations) {
    let prof = forRow.get(row);
    if (!prof) {
      const candidates = profilesByOldKey.get(oldKey(row)) || [];
      const matches = candidates.filter(p =>
        (!row.category || normalize(row.category) === normalize(p.category)) &&
        (!row.contact || !p.contact || normalize(row.contact) === normalize(p.contact)));
      prof = matches.length === 1 ? matches[0] : addProfile(row, candidates.length > 0);
    }
    if (!prof.contact && row.contact) prof.contact = row.contact;
    state.reviews.push({
      id: row.id || randomUUID(), communityId: row.communityId, professionalId: prof.id,
      authorId: account(row.authorPhone), authorName: row.author || '', service: row.service || '',
      rating: Number(row.rating) || null, description: row.description || '',
      recommend: row.recommend !== false, createdAt: null
    });
  }
  for (const profiles of profilesByOldKey.values()) {
    if (profiles.length > 1) profiles.forEach(p => { p.needsReview = true; });
  }
  for (const [phone, keys] of Object.entries(old.savedByPhone || {})) {
    const userId = account(phone);
    if (!userId || !Array.isArray(keys)) continue;
    state.savedByUser[userId] = [];
    for (const key of new Set(keys)) {
      const matches = profilesByOldKey.get(key) || [];
      if (matches.length === 1) state.savedByUser[userId].push(matches[0].id);
      else state.unresolvedSaves.push({ userId, oldKey: key, candidates: matches.map(p => p.id) });
    }
  }
  return state;
}

function openStore(file) {
  function persist(next) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = emptyState();
  }
  if (state.version !== 2) {
    const upgraded = migrateLegacy(state);
    try { fs.copyFileSync(file, file + '.v1.bak', fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    persist(upgraded);
    state = upgraded;
  }
  return {
    get state() { return state; },
    // Um único processo Node faz a verificação e a gravação sem await entre elas.
    change(update) {
      const next = structuredClone(state);
      const result = update(next);
      persist(next);
      state = next;
      return result;
    }
  };
}

module.exports = { openStore, migrateLegacy };
