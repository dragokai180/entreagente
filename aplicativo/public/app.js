'use strict';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stamp = value => value ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : 'Histórico sem data';
const titles = {feed:'Feed',catalogo:'Encontrar profissionais',minhas:'Minhas indicações',salvos:'Profissionais salvos',p:'Perfil do profissional'};
const model = { me:null, community:null, view:'feed', result:[], provider:null };
let authMode = 'login', serial = 0, rendered = '', locationKey = '', busy = false, pickList = [];
const requestId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
const base = community => '/communities/' + encodeURIComponent(community.id);
const pathFor = id => base(model.community) + '/professionals/' + encodeURIComponent(id);
const href = (view, id, cid = model.community?.id) => '#/c/' + encodeURIComponent(cid) + '/' + view + (id ? '/' + encodeURIComponent(id) : '');
const navigate = (view, id, cid) => { const target = href(view,id,cid); if (location.hash === target) void load(true); else location.hash = target; };
const action = (label, name, id = '', css = '') => '<button type="button" class="'+css+'" data-action="'+name+'" data-id="'+escapeHtml(id)+'">'+escapeHtml(label)+'</button>';
const link = (label, view, id) => '<a class="button" href="'+escapeHtml(href(view,id))+'">'+escapeHtml(label)+'</a>';
const empty = (title, message, button = '') => '<div class="empty"><h2>'+escapeHtml(title)+'</h2><p>'+escapeHtml(message)+'</p>'+button+'</div>';
const tag = text => '<span class="tag">'+escapeHtml(text)+'</span>';
const initials = name => name.trim().split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();
const avatar = name => '<span aria-hidden="true" class="avatar">'+escapeHtml(initials(name))+'</span>';
const score = p => p.rating == null ? 'Sem avaliações' : '★ '+p.rating.toLocaleString('pt-BR',{maximumFractionDigits:1})+' de 5';
const countText = (n, one, many) => n+' '+(n === 1 ? one : many);
const canModerate = () => ['criador','moderador'].includes(model.community?.role);
const formValues = form => Object.fromEntries(new FormData(form));
function message(text) {
  $('#status').textContent = text;
  clearTimeout(message.timer);
  if (text) message.timer = setTimeout(() => { $('#status').textContent = ''; },6000);
}
function errorAt(selector,text) { const el = $(selector); el.textContent = text; el.hidden = !text; }
function openDialog(title,body) {
  clearMediaDraft();
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  errorAt('#modal-error','');
  if (!$('#modal').open) $('#modal').showModal();
  else ($('#modal-body').querySelector('input,select,textarea,button') || $('#modal .dialog-head button')).focus();
}
function closeDialog() { clearMediaDraft(); if ($('#modal').open) $('#modal').close(); }
function setAuth(mode) {
  authMode = mode;
  const f = $('#auth-form');
  for (const [name,visible] of [['loginId',mode === 'login'],['name',mode !== 'login'],['code',mode === 'activate']]) {
    f.elements[name].disabled = !visible;
    f.elements[name].required = visible;
    f.elements[name].closest('label').hidden = !visible;
  }
  $('#password').minLength = mode === 'login' ? 1 : 15;
  $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#password-hint').hidden = mode === 'login';
  $('#auth-submit').textContent = {login:'Entrar',register:'Criar conta',activate:'Ativar e entrar'}[mode];
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.mode === mode)));
  errorAt('#auth-error','');
}
function signedOut() {
  ++serial;
  closeDialog();
  model.me = null; model.community = null; model.result = []; model.provider = null;
  $('#profile-choice').hidden = true; $('#profile-choice-form').reset();
  $('#choice-login-id').value = ''; errorAt('#profile-choice-error','');
  $('#provider-area').hidden = true; $('#provider-content').replaceChildren();
  rendered = ''; locationKey = '';
  $('#content').replaceChildren();
  $('#app').hidden = true; $('#top-actions').hidden = true; $('#auth').hidden = false;
  $('#auth-form').reset(); setAuth('login');
}
async function api(path, method = 'GET', data) {
  const opts = {method,credentials:'same-origin',cache:'no-store'};
  if (data instanceof FormData) { opts.headers = {'X-EntreAgente-Upload':'1'}; opts.body = data; }
  else if (data !== undefined) { opts.headers = {'Content-Type':'application/json'}; opts.body = JSON.stringify(data); }
  let response;
  try { response = await fetch('/api'+path,opts); }
  catch { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || 'Falha na solicitação.');
    error.status = response.status;
    if (response.status === 401 && !path.startsWith('/auth/') && model.me) {
      signedOut(); message('Sua sessão terminou. Entre novamente.');
    }
    throw error;
  }
  return result;
}

function currentRoute(me) {
  const parts = location.hash.slice(1).split('/');
  let remembered;
  try { remembered = localStorage.getItem('ea-community-'+me.user.id); } catch {}
  const requested = parts[1] === 'c' ? parts[2] : '';
  const c = me.communities.find(c => c.id === requested) || me.communities.find(c => c.id === remembered) || me.communities[0];
  let view = c && requested === c.id && Object.hasOwn(titles,parts[3]) ? parts[3] : 'feed';
  const pid = view === 'p' ? parts[4] : '';
  if (view === 'p' && !pid) view = 'catalogo';
  return {c,view,pid};
}
async function load(force = false) {
  const generation = ++serial;
  const initialHash = location.hash;
  try {
    const me = await api('/me');
    if (generation !== serial || initialHash !== location.hash) return;
    if (me.needsAccountType) {
      const firstVisit = $('#profile-choice').hidden || model.me?.user.id !== me.user.id;
      model.me = me; model.community = null; model.provider = null; model.result = [];
      rendered = ''; locationKey = '';
      $('#auth').hidden = true; $('#app').hidden = true; $('#provider-area').hidden = true;
      $('#top-actions').hidden = true; $('#profile-choice').hidden = false;
      if (firstVisit) {
        closeDialog();
        $('#profile-choice-form').reset(); errorAt('#profile-choice-error','');
        $('#choice-login-id').value = me.user.loginId;
        $('#profile-choice-title').focus();
      }
      return;
    }
    $('#profile-choice').hidden = true;
    if (me.user.accountType === 'provider') {
      const result = await api('/provider');
      if (generation !== serial || initialHash !== location.hash) return;
      const snapshot = JSON.stringify([me.user,result]);
      if (!force && rendered === snapshot) return;
      model.me = me; model.community = null; model.provider = result; rendered = snapshot;
      $('#auth').hidden = true; $('#app').hidden = true; $('#provider-area').hidden = false;
      $('#top-actions').hidden = false; $('#account-button').textContent = me.user.name;
      document.querySelector('[data-action="invites"]').hidden = true;
      if (location.hash !== '#/prestador') history.replaceState(null,'','#/prestador');
      renderPortal(result);
      return;
    }
    $('#provider-area').hidden = true;
    document.querySelector('[data-action="invites"]').hidden = false;
    const {c,view,pid} = currentRoute(me);
    const routeKey = JSON.stringify([me.user.id,c?.id,view,pid]);
    let result = [];
    if (c) {
      const endpoint = view === 'p' ? '/professionals/'+encodeURIComponent(pid) : view === 'feed' ? '/feed' : '/professionals';
      try { result = await api(base(c)+endpoint); }
      catch (error) {
        if (generation === serial && error.status === 404 && view === 'p') {
          message('A ficha está indisponível neste condomínio.'); navigate('catalogo',null,c.id); return;
        }
        throw error;
      }
    }
    if (generation !== serial || initialHash !== location.hash) return;
    const snapshot = JSON.stringify([me,routeKey,result]);
    if (!force && rendered === snapshot) return;
    if (routeKey !== locationKey) {
      $('#search').value = ''; $('#category').value = ''; $('#sort').value = 'recommended';
      $('#content').scrollTop = 0;
    }
    model.me = me; model.community = c || null; model.view = view; model.result = result;
    rendered = snapshot; locationKey = routeKey;
    if (c) {
      try { localStorage.setItem('ea-community-'+me.user.id,c.id); } catch {}
      const target = href(view,pid,c.id);
      if (location.hash !== target) history.replaceState(null,'',target);
    }
    $('#auth').hidden = true; $('#app').hidden = false; $('#top-actions').hidden = false;
    $('#account-button').textContent = me.user.name;
    $('#invite-count').textContent = me.invites.length ? '('+me.invites.length+')' : '';
    $('#community').innerHTML = me.communities.length ? me.communities.map(entry =>
      '<option value="'+escapeHtml(entry.id)+'">'+escapeHtml(entry.name)+'</option>').join('') : '<option value="">Sem condomínio</option>';
    if (c) $('#community').value = c.id;
    $('#community').disabled = !c;
    $('#nav').hidden = !c; $('#residents-button').hidden = !c; $('#community-actions').hidden = !c;
    $('#publish-media').hidden = view !== 'feed';
    $('#community-label').textContent = c?.name || '';
    $('#view-title').textContent = c ? titles[view] : 'Suas comunidades';
    $('#filters').hidden = !c || ['feed','p'].includes(view);
    document.querySelectorAll('[data-view]').forEach(a => {
      a.href = c ? href(a.dataset.view,null,c.id) : '#';
      if (a.dataset.view === view) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
    const category = $('#category').value;
    $('#category').innerHTML = '<option value="">Todas</option>'+me.categories.map(n => '<option>'+escapeHtml(n)+'</option>').join('');
    $('#category').value = category;
    draw();
  } catch (err) {
    if (generation !== serial) return;
    if (err.status === 401) { if (!model.me) signedOut(); }
    else {
      if (!model.me) signedOut();
      message(err.message);
    }
  }
}
function draw() {
  const {community,view,result} = model;
  let html;
  if (!community) {
    html = empty('Entre em um condomínio','Crie um condomínio ou use o convite recebido de um vizinho.',
      action('Criar condomínio','create-community')+' '+action('Usar convite','invites'));
  } else if (view === 'p') html = profileHtml(result);
  else if (view === 'feed') html = feedHtml(result);
  else html = catalogHtml(result);
  $('#content').innerHTML = html;
}
function feedHtml(rows) {
  if (!rows.length) return empty('Ainda não há indicações no feed','Compartilhe um serviço que você recomenda aos vizinhos.',action('Indicar profissional','indicate'));
  return '<div class="stack">'+rows.map(r => {
    const work = r.kind === 'portfolio', direct = r.kind === 'community';
    const type = work ? 'Trabalho do prestador' : direct ? 'Publicação do morador' : 'Indicou '+r.professionalName;
    return '<article class="feed-post"><header class="row"><div class="person">'+avatar(r.author)+
      '<div><strong>'+escapeHtml(r.author)+'</strong><p class="meta">'+escapeHtml(type)+'</p></div></div>'+
      '<time datetime="'+escapeHtml(r.createdAt)+'">'+escapeHtml(stamp(r.createdAt))+'</time></header>'+
      (work || r.service?'<h2 class="post-title">'+escapeHtml(work?r.title:r.service)+'</h2>':'')+
      (r.description?'<p class="description">'+escapeHtml(r.description)+'</p>':'')+gallery(r.media,r.title || r.service || r.description)+
      '<div class="row"><div class="tags">'+(r.category?tag(r.category):'')+(r.rating?tag('★ '+r.rating+'/5'):'')+'</div>'+
      (r.professionalId?link('Ver perfil','p',r.professionalId):'')+(r.canDelete?action('Excluir publicação','delete-publication',r.id,'link danger'):'')+
      '</div></article>';
  }).join('')+'</div>';
}
function catalogHtml(rows) {
  const term = norm($('#search').value.trim()), category = $('#category').value, sort = $('#sort').value;
  const list = rows.filter(p => (model.view !== 'minhas' || p.mine) && (model.view !== 'salvos' || p.saved) &&
    (!category || category === p.category) && (!term || norm([p.name,p.category,p.about,...p.services,p.searchText].join(' ')).includes(term)));
  list.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name,'pt-BR') :
    (sort === 'rating' ? (b.rating || 0)-(a.rating || 0) : b.recommenderCount-a.recommenderCount) || a.name.localeCompare(b.name,'pt-BR'));
  if (!list.length) {
    if (term || category) return empty('Nenhum resultado','Tente outro nome, serviço ou categoria.');
    if (model.view === 'minhas') return empty('Você ainda não indicou profissionais','Sua indicação aparece aqui ao publicar um relato com a opção de recomendar.');
    if (model.view === 'salvos') return empty('Nenhum profissional salvo','Abra uma ficha e selecione Salvar.');
    return empty('Ainda não há profissionais','Cadastre a primeira ficha neste condomínio.',action('Cadastrar profissional','new-pro'));
  }
  const nameCounts = new Map();
  for (const p of rows) nameCounts.set(norm(p.name),(nameCounts.get(norm(p.name)) || 0)+1);
  return '<div class="grid">'+list.map(p => '<article class="card"><header><div class="person">'+avatar(p.name)+
    '<div><h2>'+escapeHtml(p.name)+'</h2><p class="meta">'+escapeHtml(p.category)+(nameCounts.get(norm(p.name))>1 ? ' · Ficha '+escapeHtml(p.id.slice(0,8)) : '')+
    '</p></div></div></header><p>'+escapeHtml(score(p))+' · '+countText(p.recommenderCount,'morador recomenda','moradores recomendam')+'</p>'+
    (p.about ? '<p>'+escapeHtml(p.about)+'</p>' : '')+'<div class="tags">'+p.services.slice(0,3).map(tag).join('')+'</div>'+
    '<div class="card-actions">'+link('Ver perfil','p',p.id)+action(p.saved?'Remover dos salvos':'Salvar',p.saved?'unsave':'save',p.id)+'</div></article>').join('')+'</div>';
}
function profileHtml(p) {
  const reviews = p.reviews.map(r => '<article class="review"><div class="row"><h3>'+escapeHtml(r.author)+'</h3><small>'+escapeHtml(stamp(r.createdAt))+'</small></div>'+
    '<p><strong>'+escapeHtml(r.service)+'</strong> · '+(r.rating ? '★ '+r.rating+'/5' : 'Sem nota')+'</p><p>'+escapeHtml(r.description)+'</p>'+
    gallery(r.media,r.service)+(r.recommend ? '<small>Recomenda este profissional</small>' : '')+'</article>').join('');
  const identity = p.identity ? introduction(p.identity)+credentials(p.identity) : '';
  const portfolio = p.portfolio?.length ? '<section class="pro-block"><h2>Portfólio</h2>'+p.portfolio.map(post => workCard(post)).join('')+'</section>' : '';
  return identity+'<div class="profile"><header><div class="person">'+avatar(p.name)+'<div><h2>'+escapeHtml(p.name)+'</h2><p class="meta">'+escapeHtml(p.category)+
    ' · Ficha '+escapeHtml(p.id.slice(0,8))+'</p></div></div>'+link('Voltar ao catálogo','catalogo')+'</header>'+
    (p.about ? '<p class="about">'+escapeHtml(p.about)+'</p>' : '')+'<p>'+escapeHtml(score(p))+' · '+countText(p.recommenderCount,'morador recomenda','moradores recomendam')+
    '</p><div class="tags">'+p.services.slice(0,6).map(tag).join('')+'</div><p><strong>Contato</strong> · '+escapeHtml(p.contact || 'Ainda não informado')+'</p>'+
    (canModerate() && p.needsReview ? '<p class="hint">Confira a identificação desta ficha importada com nome repetido.</p>' : '')+
    '<div class="card-actions">'+action('Registrar experiência','review',p.id,'primary')+action(p.saved?'Remover dos salvos':'Salvar',p.saved?'unsave':'save',p.id)+
    (canModerate() ? action('Editar ficha','edit-pro',p.id)+action('Excluir ficha','delete-pro',p.id,'danger')+action(p.linked?'Desvincular prestador':p.pendingLink?'Cancelar convite de vínculo':'Vincular prestador','pro-link',p.id) : '')+
    action('Reportar informação','report',p.id,'link')+'</div></div>'+portfolio+'<h2 class="section-title">Experiências ('+p.reviewCount+')</h2><div class="stack">'+
    (reviews || '<p class="hint">Ainda não há relatos sobre este profissional.</p>')+'</div>';
}

function dialogForm(id, fields, submit, extra = '') {
  return '<form data-form="'+id+'" '+extra+'>'+fields+'<button class="primary" type="submit">'+escapeHtml(submit)+'</button></form>';
}
function input(label,name,opts = {}) {
  const val = escapeHtml(opts.value || ''), max = opts.max || 80;
  return '<label>'+escapeHtml(label)+'<input name="'+name+'" maxlength="'+max+'" value="'+val+'"'+
    (opts.optional?'':' required')+(opts.min?' minlength="'+opts.min+'"':'')+(opts.readonly?' readonly':'')+'></label>';
}
function textarea(label,name,max,value = '',required = false) {
  return '<label>'+escapeHtml(label)+'<textarea name="'+name+'" maxlength="'+max+'"'+(required?' required minlength="10"':'')+'>'+escapeHtml(value)+'</textarea></label>';
}
function options(list,selected) {
  return list.map(n => '<option'+(selected === n?' selected':'')+'>'+escapeHtml(n)+'</option>').join('');
}
function showAccount(newAccount = false) {
  const {user} = model.me;
  openDialog(newAccount?'Guarde seu ID de acesso':'Minha conta',
    '<div class="stack"><p>Use este ID e sua senha para entrar em outro dispositivo.</p>'+
    '<label>ID de acesso<input readonly value="'+escapeHtml(user.loginId)+'"></label>'+
    '<p>Tipo de perfil · <strong>'+(user.accountType === 'provider'?'Prestador de serviços':'Morador')+'</strong></p>'+
    dialogForm('account',input('Nome exibido','name',{value:user.name,min:2}), 'Salvar nome')+
    action('Sair da conta','logout')+'</div>');
}
function showInvites() {
  const invites = model.me.invites;
  openDialog('Convites', '<div class="stack">'+(invites.length ? invites.map(i => '<div class="list-item"><strong>'+escapeHtml(i.communityName)+
    '</strong><p class="meta">Convite de '+escapeHtml(i.senderName)+'</p><div class="actions">'+action('Aceitar','accept',i.id)+action('Recusar','decline',i.id)+
    '</div></div>').join('') : '<p>Você está em dia com os convites.</p>')+action('Usar código de convite','redeem')+'</div>');
}
function showRedeem() {
  openDialog('Entrar por convite',dialogForm('redeem',input('Código recebido','code',{max:100}),'Entrar no condomínio'));
}
async function showResidents() {
  const c = model.community;
  const people = await api(base(c)+'/residents');
  const rows = people.map(p => {
    let buttons = '';
    if (p.id !== model.me.user.id && p.role !== 'criador') {
      if (c.role === 'criador') buttons += action(p.role === 'moderador'?'Remover moderação':'Tornar moderador',
        p.role === 'moderador'?'unmod':'mod',p.id);
      if (c.role === 'criador' || (c.role === 'moderador' && p.role === 'morador')) buttons += action('Remover morador','remove-member',p.id,'danger');
    }
    return '<div class="list-item"><strong>'+escapeHtml(p.name)+'</strong><p class="meta">'+escapeHtml(p.loginId)+' · '+escapeHtml(p.role)+'</p><div class="actions">'+buttons+'</div></div>';
  }).join('');
  openDialog('Moradores · '+c.name,'<div class="stack">'+(c.role === 'criador'?action('Convidar morador','invite'):'')+rows+'</div>');
}
function showInvite() {
  openDialog('Convidar morador','<div class="stack">'+dialogForm('invite',input('ID de acesso do morador','loginId'),'Enviar convite')+
    '<p class="hint">Para quem ainda vai criar a conta, gere um código de uso único.</p>'+action('Gerar código de convite','invite-code')+'</div>');
}
function showProfessional(p = null, resume = false) {
  const opts = '<option value="">Selecione</option>'+options(model.me.categories,p?.category);
  const fields = input('Nome do profissional','name',{min:2,value:p?.name})+
    '<label>Categoria<select name="category" required>'+opts+'</select></label>'+
    textarea('Sobre os serviços (opcional)','about',500,p?.about)+input('Contato profissional (opcional)','contact',{optional:true,max:100,value:p?.contact})+
    '<label class="check"><input type="checkbox" name="consent"'+(p?.contact?' checked':'')+'>Tenho autorização para compartilhar este contato com o condomínio.</label>';
  openDialog(p?'Editar ficha':'Cadastrar profissional',dialogForm('professional',fields,p?'Salvar alterações':'Cadastrar ficha',
    'data-id="'+escapeHtml(p?.id || '')+'" data-resume="'+(resume?'yes':'no')+'" data-key="'+requestId()+'"'));
}
function pickerOptions(term = '') {
  const matches = pickList.filter(p => norm(p.name+' '+p.category+' '+p.about).includes(norm(term)));
  $('#pick-professional').innerHTML = matches.map(p => '<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.name+' · '+p.category+' · '+p.id.slice(0,8))+'</option>').join('');
  $('#pick-submit').disabled = !matches.length;
  $('#pick-hint').textContent = matches.length ? '' : 'Nenhuma ficha encontrada. Você pode cadastrar e continuar.';
}
async function showPicker() {
  pickList = await api(base(model.community)+'/professionals');
  openDialog('Indicar profissional','<form data-form="pick"><label>Buscar ficha<input type="search" id="pick-search" placeholder="Nome ou categoria"></label>'+
    '<label>Profissional<select id="pick-professional" name="professional" required></select></label><p class="hint" id="pick-hint"></p>'+
    '<button id="pick-submit" type="submit" class="primary">Continuar para o relato</button>'+
    action('Cadastrar e voltar à indicação','new-and-review')+'</form>');
  pickerOptions();
}
function showReview(id,name) {
  const fields = '<p>Profissional · <strong>'+escapeHtml(name)+'</strong></p>'+input('Serviço realizado','service',{min:3})+
    '<label>Nota<select name="rating" required><option value="">Selecione</option>'+[1,2,3,4,5].map(n => '<option value="'+n+'">'+n+' de 5</option>').join('')+'</select></label>'+
    textarea('Conte sua experiência','description',600,'',true)+mediaField()+
    '<label class="check"><input name="recommend" type="checkbox" checked>Recomendo este profissional e quero publicar no feed do condomínio.</label>';
  openDialog('Registrar experiência',dialogForm('review',fields,'Publicar relato','data-id="'+escapeHtml(id)+'" data-key="'+requestId()+'"'));
}

async function handleAction(name,id,button) {
  if (name.startsWith('pro-')) return providerAction(name,id,button);
  const c = model.community;
  if (name === 'close') { closeDialog(); return; }
  if (name === 'account') return showAccount();
  if (name === 'logout') {
    await api('/auth/logout','POST',{});
    history.replaceState(null,'',location.pathname); signedOut(); message('Você saiu da conta.'); return;
  }
  if (name === 'create-community') return openDialog('Criar condomínio',dialogForm('community',input('Nome do condomínio','name',{min:2}),'Criar condomínio'));
  if (name === 'redeem') return showRedeem();
  if (name === 'invites') { await load(true); if (model.me) showInvites(); return; }
  if (name === 'accept' || name === 'decline') {
    const result = await api('/invitations/'+encodeURIComponent(id)+'/answer','POST',{accept:name === 'accept'});
    closeDialog(); if (name === 'accept') navigate('feed',null,result.communityId); else await load(true); return;
  }
  if (!c) return;
  if (name === 'community-compose') {
    openDialog('Publicar no feed',dialogForm('community-post',textarea('Legenda (opcional)','description',1400)+mediaField(),
      'Publicar no feed','data-key="'+requestId()+'"')); return;
  }
  if (name === 'delete-publication') {
    openDialog('Excluir publicação',dialogForm('community-delete','<p>A publicação e seus arquivos serão removidos deste condomínio.</p>',
      'Confirmar exclusão','data-id="'+escapeHtml(id)+'"')); return;
  }
  if (name === 'new-pro' || name === 'new-and-review') return showProfessional(null,name === 'new-and-review');
  if (name === 'indicate') return showPicker();
  if (name === 'review') return showReview(id,model.result.name);
  if (name === 'edit-pro') return showProfessional(model.result);
  if (name === 'residents') return showResidents();
  if (name === 'invite') return showInvite();
  if (name === 'invite-code') {
    const {code} = await api(base(c)+'/invitations','POST',{});
    openDialog('Código de convite','<div class="stack"><p>Entregue este código a um morador. Vale por 24 horas e permite uma entrada.</p>'+
      input('Código do condomínio','code',{value:code,readonly:true})+action('Concluir','close')+'</div>'); return;
  }
  if (name === 'mod' || name === 'unmod') {
    await api(base(c)+'/residents/'+encodeURIComponent(id),'PATCH',{moderator:name === 'mod'}); return showResidents();
  }
  if (name === 'remove-member' || name === 'delete-pro') {
    const removal = name === 'remove-member';
    const person = removal ? (await api(base(c)+'/residents')).find(r => r.id === id)?.name : model.result.name;
    openDialog(removal?'Remover morador':'Excluir ficha','<div class="stack"><p>'+escapeHtml(person || '')+
      (removal?' perderá acesso a este condomínio.':' e os relatos ligados a esta ficha serão removidos deste condomínio.')+'</p>'+
      dialogForm(removal?'remove-member':'delete-pro','',removal?'Confirmar remoção':'Confirmar exclusão','data-id="'+escapeHtml(id)+'"')+
      action('Cancelar','close')+'</div>'); return;
  }
  if (name === 'save' || name === 'unsave') {
    await api(pathFor(id)+'/saved','PUT',{saved:name === 'save'}); await load(true);
    message(name === 'save'?'Profissional salvo.':'Profissional removido dos salvos.'); return;
  }
  if (name === 'report') openDialog('Reportar informação','<p>Este protótipo simula a moderação. Para pedir uma correção, procure a moderação do condomínio.</p>');
}

async function handleDialog(form) {
  const vals = formValues(form), type = form.dataset.form, id = form.dataset.id, c = model.community;
  if (type.startsWith('provider-')) return providerSubmit(form,type);
  if (type === 'account') {
    await api('/me','PATCH',{name:vals.name}); closeDialog(); await load(true); message('Nome atualizado.'); return;
  }
  if (type === 'community' || type === 'redeem') {
    const r = await api(type === 'community'?'/communities':'/invitations/redeem','POST',vals);
    closeDialog(); navigate('feed',null,r.id || r.communityId); return;
  }
  if (!c) return;
  if (type === 'invite') {
    await api(base(c)+'/invitations','POST',vals); closeDialog(); message('Convite enviado.'); return;
  }
  if (type === 'community-post') {
    if (!mediaDraft.length) throw Error('Selecione pelo menos uma foto ou um vídeo.');
    await api(base(c)+'/posts','POST',withMedia({description:vals.description,requestId:form.dataset.key}));
    closeDialog(); await load(true); message('Publicação adicionada ao feed.'); return;
  }
  if (type === 'community-delete') {
    await api(base(c)+'/posts/'+encodeURIComponent(id),'DELETE',{}); closeDialog(); await load(true); message('Publicação excluída.'); return;
  }
  if (type === 'pick') {
    const p = pickList.find(p => p.id === vals.professional);
    if (p) showReview(p.id,p.name); return;
  }
  if (type === 'professional') {
    const payload = {...vals,consent:form.elements.consent.checked,requestId:form.dataset.key};
    const result = await api(id?pathFor(id):base(c)+'/professionals',id?'PATCH':'POST',payload);
    if (form.dataset.resume === 'yes') { showReview(result.id,vals.name); return; }
    closeDialog(); navigate('p',id || result.id); message(id?'Ficha atualizada.':'Ficha cadastrada.'); return;
  }
  if (type === 'review') {
    const recommend = form.elements.recommend.checked;
    await api(pathFor(id)+'/reviews','POST',withMedia({...vals,rating:Number(vals.rating),recommend,requestId:form.dataset.key}));
    closeDialog();
    if (recommend) navigate('feed'); else navigate('p',id);
    message(recommend?'Indicação publicada no feed.':'Experiência registrada no perfil.'); return;
  }
  if (type === 'delete-pro') {
    await api(pathFor(id),'DELETE',{}); closeDialog(); navigate('catalogo'); message('Ficha excluída.'); return;
  }
  if (type === 'remove-member') {
    await api(base(c)+'/residents/'+encodeURIComponent(id),'DELETE',{}); return showResidents();
  }
}

async function perform(target,work) {
  if (busy) return;
  busy = true; ++serial;
  if (target) target.disabled = true;
  const originalText = target?.textContent;
  if (target?.type === 'submit' && mediaDraft.length) target.textContent = 'Enviando arquivos…';
  errorAt('#modal-error','');
  try { await work(); }
  catch (err) {
    if ($('#modal').open) errorAt('#modal-error',err.message);
    else if (!$('#profile-choice').hidden) errorAt('#profile-choice-error',err.message);
    else if (!$('#auth').hidden) errorAt('#auth-error',err.message);
    else message(err.message);
  } finally {
    busy = false;
    if (target?.isConnected) { target.disabled = false; if (target.textContent === 'Enviando arquivos…') target.textContent = originalText; }
  }
}
document.addEventListener('click',event => {
  const mode = event.target.closest('[data-mode]');
  if (mode && !busy) { setAuth(mode.dataset.mode); return; }
  const button = event.target.closest('button[data-action]');
  if (button) void perform(button,() => handleAction(button.dataset.action,button.dataset.id,button));
});
$('#auth-form').addEventListener('submit',event => {
  event.preventDefault();
  const f = event.target, mode = authMode;
  void perform(event.submitter,async () => {
    errorAt('#auth-error','');
    const values = formValues(f);
    if (mode === 'register') values.accountType = 'pending';
    await api('/auth/'+mode,'POST',values);
    f.reset(); message('');
    await load(true);
    if (mode === 'activate' && model.me && !model.me.needsAccountType) showAccount(true);
  });
});
$('#profile-choice-form').addEventListener('submit',event => {
  event.preventDefault();
  const type = event.currentTarget.elements.accountType.value;
  void perform(event.submitter,async () => {
    errorAt('#profile-choice-error','');
    await api('/me/account-type','PUT',{accountType:type});
    await load(true);
    const area = type === 'provider' ? $('#provider-area h1') : $('#view-title');
    area.tabIndex = -1; area.focus();
  });
});
$('#modal-body').addEventListener('submit',event => {
  event.preventDefault();
  void perform(event.submitter,() => handleDialog(event.target));
});
$('#modal').addEventListener('close',() => { if (!$('#modal').open) clearMediaDraft(); });
$('#modal').addEventListener('cancel',event => { if (busy) event.preventDefault(); });
$('#modal-body').addEventListener('input',event => { if (event.target.id === 'pick-search') pickerOptions(event.target.value); });
$('#community').addEventListener('change',event => navigate('feed',null,event.target.value));
$('#filters').addEventListener('input',draw);
window.addEventListener('hashchange',() => { closeDialog(); if (model.me) void load(true); });
setAuth('login');
load(true).finally(() => { if ($('#status').textContent === 'Carregando…') message(''); });
setInterval(() => { if (model.me && !busy && !document.hidden && !$('#modal').open && ![...document.querySelectorAll('video')].some(v => !v.paused && !v.ended)) void load(); },3000);
