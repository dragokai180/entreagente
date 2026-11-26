'use strict';

const mediaDraft = [];
const unit = 1024*1024;
const uploadTypes = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};
function clearMediaDraft() {
  for (const item of mediaDraft) URL.revokeObjectURL(item.url);
  mediaDraft.length = 0;
}
function mediaField(photoOnly = false) {
  return '<div class="media-field"><label>'+(photoOnly?'Foto de perfil':'Fotos e vídeos')+
    '<input type="file" data-media-picker="'+(photoOnly?'photo':'post')+'" accept="'+
    (photoOnly?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,video/mp4,video/webm')+'"'+
    (photoOnly?'':' multiple')+'></label><p class="hint">'+
    (photoOnly?'JPG, PNG ou WebP. Até 8 MiB.':'Até 4 arquivos. Fotos JPG, PNG ou WebP de até 8 MiB. Vídeos MP4 ou WebM de até 32 MiB. Total de 48 MiB.')+
    '</p><div data-preview class="draft-grid" aria-live="polite"></div></div>';
}
function displayDraft() {
  const preview = document.querySelector('[data-preview]');
  if (!preview) return;
  preview.innerHTML = mediaDraft.map((item,i) => '<div class="draft-item">'+
    (item.type.startsWith('video/') ? '<video controls playsinline preload="metadata" src="'+escapeHtml(item.url)+'" aria-label="Prévia do vídeo"></video>'
      : '<img src="'+escapeHtml(item.url)+'" alt="Prévia da foto">')+
    '<div><small>'+escapeHtml(item.file.name)+'</small><button type="button" data-remove-file="'+i+'" aria-label="Remover '+
    escapeHtml(item.file.name)+'">Remover</button></div></div>').join('');
}
document.addEventListener('change',event => {
  const el = event.target;
  if (!el.matches('[data-media-picker]') || busy) return;
  const files = Array.from(el.files), photo = el.dataset.mediaPicker === 'photo';
  el.value = '';
  if (!files.length) return;
  try {
    const existing = photo ? [] : mediaDraft;
    if (existing.length+files.length > (photo?1:4)) throw Error('Escolha até '+(photo?'uma foto.':'quatro arquivos.'));
    let total = existing.reduce((sum,d) => sum+d.file.size,0);
    const incoming = files.map(file => {
      const type = uploadTypes[file.name.split('.').pop().toLowerCase()];
      if (!type || (photo && !type.startsWith('image/'))) throw Error('Escolha um dos formatos aceitos.');
      const max = (type.startsWith('image/')?8:32)*unit;
      if (!file.size || file.size > max) throw Error('Confira o tamanho de '+file.name+'.');
      total += file.size;
      return {file,type};
    });
    if (total>48*unit) throw Error('O total por publicação é de até 48 MiB.');
    if (photo) clearMediaDraft();
    for (const item of incoming) mediaDraft.push({...item,url:URL.createObjectURL(item.file)});
    errorAt('#modal-error','');
    displayDraft();
  } catch (err) { errorAt('#modal-error',err.message); }
});
document.addEventListener('click',event => {
  const button = event.target.closest('button[data-remove-file]');
  if (!button || busy) return;
  const [item] = mediaDraft.splice(Number(button.dataset.removeFile),1);
  if (item) URL.revokeObjectURL(item.url);
  displayDraft();
});
function withMedia(fields) {
  if (!mediaDraft.length) return fields;
  const data = new FormData();
  data.append('payload',JSON.stringify(fields));
  for (const item of mediaDraft) data.append('media',item.file);
  return data;
}
function gallery(files, caption = '') {
  if (!files?.length) return '';
  const tiles = files.map((file,i) => {
    const url = '/api/media/'+encodeURIComponent(file.id), index = files.length > 1?' ('+(i+1)+' de '+files.length+')':'';
    const alt = escapeHtml((caption || 'Publicação da comunidade').slice(0,150)+index);
    return file.type.startsWith('video/') ?
      '<video controls playsinline preload="metadata" aria-label="Vídeo · '+alt+'" src="'+url+'"></video>' :
      '<a href="'+url+'" target="_blank" rel="noopener"><img loading="lazy" src="'+url+'" alt="Foto · '+alt+'"></a>';
  });
  return '<div class="media-grid '+(tiles.length === 1?'single':'')+'">'+tiles.join('')+'</div>';
}
