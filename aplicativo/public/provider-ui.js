'use strict';

function introduction(profile, owner = false) {
  const pic = profile.photo ? '<img class="profile-photo" src="/api/media/'+encodeURIComponent(profile.photo.id)+'" alt="Foto de '+escapeHtml(profile.name)+'">' :
    '<div class="profile-initials" aria-hidden="true">'+escapeHtml(initials(profile.name))+'</div>';
  return '<section class="pro-intro"><div class="profile-cover" aria-hidden="true"></div><div class="pro-intro-body">'+pic+
    '<div class="intro-heading"><div><h2>'+escapeHtml(profile.name)+'</h2>'+
    (profile.headline ? '<p class="pro-headline">'+escapeHtml(profile.headline)+'</p>' : '')+
    (profile.region ? '<p class="meta">'+escapeHtml(profile.region)+'</p>' : '')+'</div>'+
    (owner ? action('Editar perfil','pro-edit-identity') : '')+'</div></div></section>';
}
function credentials(profile) {
  const experience = profile.experience.map(x => '<li><strong>'+escapeHtml(x.role)+'</strong>'+
    (x.organization?'<p>'+escapeHtml(x.organization)+'</p>':'')+(x.period?'<small>'+escapeHtml(x.period)+'</small>':'')+
    (x.description?'<p class="wrap">'+escapeHtml(x.description)+'</p>':'')+'</li>').join('');
  return (profile.about?'<section class="pro-block"><h2>Sobre</h2><p class="wrap">'+escapeHtml(profile.about)+'</p></section>':'')+
    (experience?'<section class="pro-block"><h2>Experiência profissional</h2><ul class="career-list">'+experience+'</ul></section>':'')+
    (profile.skills.length?'<section class="pro-block"><h2>Competências</h2><div class="tags">'+profile.skills.map(tag).join('')+'</div></section>':'');
}
function workCard(post, owner = false) {
  const scope = post.visibility === 'community' ? model.provider?.linked.find(x => x.professionalId === post.professionalId)?.community :
    post.visibility === 'private' ? 'Somente você' : 'Portfólio do perfil';
  return '<article class="portfolio-card"><div class="row"><h3>'+escapeHtml(post.title)+'</h3><time>'+escapeHtml(stamp(post.createdAt))+'</time></div>'+
    (owner?'<small>'+escapeHtml(scope || 'Condomínio')+'</small>':'')+
    (post.description?'<p class="wrap">'+escapeHtml(post.description)+'</p>':'')+gallery(post.media,post.title)+
    (owner?'<div>'+action('Excluir trabalho','pro-confirm-delete',post.id,'link danger')+'</div>':'')+'</article>';
}
function renderPortal(data) {
  const p = data.profile;
  const pending = data.pending.map(l => '<div class="list-item"><strong>'+escapeHtml(l.community)+'</strong>'+
    '<p class="meta">Ficha · '+escapeHtml(l.name)+' · '+escapeHtml(l.category)+'</p><div class="actions">'+
    action('Aceitar vínculo','pro-accept',l.professionalId)+action('Recusar','pro-decline',l.professionalId)+'</div></div>').join('');
  const linked = data.linked.map(l => '<li><strong>'+escapeHtml(l.community)+'</strong><p class="meta">'+
    escapeHtml(l.name)+' · '+escapeHtml(l.category)+'</p></li>').join('');
  $('#provider-content').innerHTML = '<div class="pro-column">'+introduction(p,true)+credentials(p)+
    '<section class="pro-block"><div class="row"><h2>Portfólio</h2>'+action('Publicar trabalho','pro-compose','','primary')+'</div>'+
    (data.posts.length?data.posts.map(post => workCard(post,true)).join(''):'<p class="hint">Mostre seu primeiro trabalho com uma descrição, fotos ou vídeos.</p>')+
    '</section></div><aside class="pro-block connections"><h2>Condomínios</h2>'+
    (pending?'<h3>Convites de vínculo</h3>'+pending:'')+
    (linked?'<ul class="career-list">'+linked+'</ul>':'<p class="hint">Passe seu ID à moderação para receber um convite e publicar no feed do condomínio.</p>')+
    '<label>Seu ID de acesso<input readonly value="'+escapeHtml(model.me.user.loginId)+'"></label></aside>';
}
function experienceFields(x = {}) {
  return '<fieldset class="experience-entry"><legend>Experiência profissional</legend>'+
    input('Função','jobRole',{value:x.role,min:2,max:90})+input('Empresa ou projeto','organization',{value:x.organization,optional:true,max:100})+
    input('Período','period',{value:x.period,optional:true,max:60})+
    textarea('Principais atividades','jobDescription',420,x.description)+action('Remover experiência','pro-remove-experience','','link')+'</fieldset>';
}
function editIdentity() {
  const p = model.provider.profile;
  const fields = input('Título profissional','headline',{value:p.headline,optional:true,max:120})+
    input('Região de atendimento','region',{value:p.region,optional:true,max:120})+
    textarea('Apresentação','about',1200,p.about)+input('Competências (separadas por vírgula)','skills',{value:p.skills.join(', '),optional:true,max:622})+
    '<div id="experiences">'+p.experience.map(experienceFields).join('')+'</div>'+action('Adicionar experiência','pro-add-experience')+
    mediaField(true)+(p.photo?'<label class="check"><input name="removePhoto" type="checkbox">Remover foto atual</label>':'');
  openDialog('Editar perfil profissional',dialogForm('provider-profile',fields,'Salvar perfil'));
}
function composeWork() {
  const options = model.provider.linked.map(l => '<option value="'+escapeHtml(l.professionalId)+'">Feed de '+escapeHtml(l.community)+'</option>').join('');
  const fields = input('Título do trabalho','title',{min:2,max:100})+textarea('Descrição do trabalho','description',1400)+
    '<label>Onde publicar<select name="destination"><option value="">Portfólio do perfil</option>'+options+'</select></label>'+
    '<p class="hint">O portfólio do perfil aparece nas fichas vinculadas. Ao escolher um condomínio, o trabalho aparece apenas no feed e na ficha dele.</p>'+mediaField();
  openDialog('Publicar trabalho',dialogForm('provider-post',fields,'Publicar trabalho','data-key="'+requestId()+'"'));
}
function providerLinkDialog(p) {
  if (p.linked || p.pendingLink) {
    openDialog(p.linked?'Desvincular prestador':'Cancelar convite',dialogForm('provider-unlink',
      p.linked?'<p>O perfil e os trabalhos do prestador deixarão de aparecer neste condomínio. As avaliações dos moradores continuam na ficha.</p>':
      '<p>O prestador deixará de poder aceitar este convite.</p>',p.linked?'Confirmar desvínculo':'Cancelar convite','data-id="'+escapeHtml(p.id)+'"'));
  } else {
    openDialog('Vincular prestador',dialogForm('provider-link',input('ID de acesso do prestador','loginId')+
      '<p class="hint">Confira a identidade e envie o convite. O perfil aparece na ficha após o aceite do prestador.</p>','Enviar convite de vínculo',
      'data-id="'+escapeHtml(p.id)+'"'));
  }
}
async function providerAction(name,id,button) {
  if (name === 'pro-edit-identity') return editIdentity();
  if (name === 'pro-compose') return composeWork();
  if (name === 'pro-link') return providerLinkDialog(model.result);
  if (name === 'pro-add-experience') {
    const entries = $('#experiences');
    if (entries.children.length >= 8) throw Error('Você pode informar até oito experiências.');
    entries.insertAdjacentHTML('beforeend',experienceFields());
    entries.lastElementChild.querySelector('input').focus(); return;
  }
  if (name === 'pro-remove-experience') { button.closest('fieldset').remove(); return; }
  if (name === 'pro-accept' || name === 'pro-decline') {
    await api('/provider/links/'+encodeURIComponent(id),'POST',{accept:name==='pro-accept'});
    await load(true); message(name==='pro-accept'?'Ficha vinculada ao seu perfil.':'Convite recusado.'); return;
  }
  if (name === 'pro-confirm-delete') {
    openDialog('Excluir trabalho',dialogForm('provider-delete','<p>O trabalho e seus anexos serão removidos do portfólio e do feed em que foi publicado.</p>',
      'Excluir trabalho','data-id="'+escapeHtml(id)+'"'));
  }
}
async function providerSubmit(form,type) {
  const v = formValues(form);
  if (type === 'provider-profile') {
    const experience = [...form.querySelectorAll('.experience-entry')].map(entry => ({
      role:entry.querySelector('[name=jobRole]').value,organization:entry.querySelector('[name=organization]').value,
      period:entry.querySelector('[name=period]').value,description:entry.querySelector('[name=jobDescription]').value
    }));
    await api('/provider/profile','PATCH',withMedia({headline:v.headline,region:v.region,about:v.about,
      skills:v.skills.split(',').map(s => s.trim()).filter(Boolean),experience,removePhoto:v.removePhoto==='on'}));
  } else if (type === 'provider-post') {
    await api('/provider/posts','POST',withMedia({title:v.title,description:v.description,visibility:v.destination?'community':'profile',
      professionalId:v.destination || null,requestId:form.dataset.key}));
  } else if (type === 'provider-delete') await api('/provider/posts/'+encodeURIComponent(form.dataset.id),'DELETE',{});
  else if (type === 'provider-link') await api(pathFor(form.dataset.id)+'/provider','POST',{loginId:v.loginId});
  else if (type === 'provider-unlink') await api(pathFor(form.dataset.id)+'/provider','DELETE',{});
  closeDialog(); await load(true);
  message({'provider-profile':'Perfil atualizado.','provider-post':'Trabalho publicado.','provider-delete':'Trabalho excluído.',
    'provider-link':'Convite de vínculo enviado.','provider-unlink':'Vínculo ou convite removido.'}[type]);
}
