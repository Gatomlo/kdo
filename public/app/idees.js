// Idees secretes pour quelqu'un : notees par la famille, invisibles de la personne.
import { esc, on, toast, sheet, closeSheet, confirmSheet, eur, eurInput, host } from './ui.js';
import { get, post, patch, del, attempt, uploadPhoto, linkPreview } from './api.js';
import { S, reload } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

define('idees/:mid', {
  load: (p) => get(`ideas/${p.mid}`),
  view: (d) => {
    const r = d.recipient;
    return {
      title: `Idées pour ${r.name}`, back: '#/cercle', tab: 'cercle',
      fab: { action: 'idea-new', label: 'Idée' },
      body: `<div class="stack-lg">
        <p class="banner hide">🤫 <span>Ces idées sont invisibles pour <b>${esc(r.name)}</b>. Note ce que tu entends (« elle rêve d’un cours de poterie ») ; « je m’en occupe » évite les doublons.</span></p>
        ${d.ideas.length ? d.ideas.map((i) => `<article class="card stack tight${i.takenBy ? ' taken' : ''}">
          <div class="row">${i.image ? `<span class="thumb"><img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : ''}<div class="between grow"><b>${esc(i.title)}</b>${i.takenBy ? `<span class="pill p-res">${i.takenByMe ? 'je m’en occupe' : `${esc(i.takenBy)} s’en occupe`}</span>` : '<span class="pill p-free">libre</span>'}</div></div>
          <div class="meta">${i.shop ? `<span>🏬 ${esc(i.shop)}</span>` : ''}${i.price != null ? `<span class="price">${eur(i.price)}</span>` : ''}${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(host(i.url))} ↗</a>` : ''}<span>proposée par ${i.mine ? 'toi' : esc(i.author)}</span></div>
          ${i.note ? `<p class="desc">${esc(i.note)}</p>` : ''}
          <div class="row wrap">${!i.takenBy ? `<button class="btn main sm" data-a="idea-take" data-id="${i.id}" data-v="1">Je m’en occupe</button>` : i.takenByMe || S.me.isAdmin ? `<button class="btn ghost sm" data-a="idea-take" data-id="${i.id}" data-v="">Je ne m’en occupe plus</button>` : ''}
            ${i.canEdit ? `<button class="btn ghost sm" data-a="idea-edit" data-id="${i.id}">Modifier</button><button class="btn danger-t sm" data-a="idea-del" data-id="${i.id}">Supprimer</button>` : ''}</div>
        </article>`).join('') : empty(`Aucune idée pour ${esc(r.name)} pour l’instant.`)}
      </div>`,
    };
  },
});

function ideaSheet(i = {}) {
  sheet(`<h3>${i.id ? 'Modifier l’idée' : `Idée pour ${esc(S.data.recipient.name)}`}</h3><form class="stack" data-f="idea" data-id="${i.id || ''}">
    <label>Lien (facultatif)<span class="row"><input name="url" type="url" value="${esc(i.url || '')}" placeholder="https://…" class="grow"><button type="button" class="btn sm" data-a="idea-prefill">Pré-remplir</button></span></label>
    <p class="small muted" id="idea-hint" hidden></p>
    <label>L’idée<input name="title" required maxlength="200" value="${esc(i.title || '')}" placeholder="Un cours de poterie"></label>
    <div class="grid2"><label>Prix (€)<input name="price" inputmode="decimal" value="${esc(eurInput(i.price))}"></label>
      <label>Où le trouver<input name="shop" maxlength="120" value="${esc(i.shop || '')}" placeholder="Magasin, site, marché…"></label></div>
    <div class="row wrap"><img id="idea-img" class="preview" alt="Photo de l’idée" referrerpolicy="no-referrer" ${i.image ? `src="${esc(i.image)}"` : 'hidden'}>
      <label class="btn ghost sm file">📷 Photo<input type="file" accept="image/*" data-ch="idea-photo" hidden></label>
      <button type="button" class="btn danger-t sm" data-a="idea-photo-clear" ${i.image ? '' : 'hidden'}>Retirer</button></div>
    <input type="hidden" name="image" value="${esc(i.image || '')}">
    <label>Note<textarea name="note" maxlength="1000" placeholder="Elle en a parlé à Pâques…">${esc(i.note || '')}</textarea></label>
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Enregistrer</button></div></form>`);
}
function ideaPhoto(src) {
  const form = document.querySelector('form[data-f=idea]');
  form.image.value = src || '';
  const img = document.getElementById('idea-img');
  img.hidden = !src;
  if (src) img.src = src; else img.removeAttribute('src');
  document.querySelector('[data-a=idea-photo-clear]').hidden = !src;
}
on('click', 'idea-photo-clear', () => ideaPhoto(''));
on('change', 'idea-photo', async (el) => {
  const file = el.files && el.files[0];
  if (file) { const u = await attempt(() => uploadPhoto(file)); if (u) ideaPhoto(u); }
  el.value = '';
});
on('click', 'idea-prefill', async () => {
  const form = document.querySelector('form[data-f=idea]');
  const url = form.url.value.trim();
  const hint = document.getElementById('idea-hint');
  hint.hidden = false;
  if (!/^https?:\/\//.test(url)) { hint.textContent = 'Colle d’abord un lien commençant par http(s)://'; return; }
  hint.textContent = 'Lecture de la page…';
  try {
    const r = await linkPreview(url);
    if (r.title && !form.title.value) form.title.value = r.title;
    if (r.price && !form.price.value) form.price.value = r.price;
    if (r.shop && !form.shop.value) form.shop.value = r.shop;
    if (r.image && !form.image.value) ideaPhoto(r.image);
    hint.textContent = r.title || r.image ? 'Infos récupérées : vérifie-les avant d’enregistrer.' : 'Rien trouvé sur cette page : remplis à la main.';
  } catch (e) { hint.textContent = `Impossible de lire cette page (${e.message})`; }
});
const ideaOf = (id) => S.data.ideas.find((i) => i.id === Number(id));
on('click', 'idea-new', () => ideaSheet());
on('click', 'idea-edit', (el) => ideaSheet(ideaOf(el.dataset.id)));
on('submit', 'idea', async (form, f) => {
  const id = form.dataset.id;
  if (await attempt(() => (id ? patch(`idea/${id}`, f) : post(`ideas/${S.data.recipient.id}`, f)))) { closeSheet(); toast('Idée enregistrée'); reload(); }
});
on('click', 'idea-take', async (el) => { if (await attempt(() => post(`idea/${el.dataset.id}/take`, { take: !!el.dataset.v }))) reload(); });
on('click', 'idea-del', async (el) => {
  if (!(await confirmSheet({ title: 'Supprimer l’idée ?', text: 'Elle disparaîtra pour tout le monde.', ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(`idea/${el.dataset.id}`))) reload();
});

