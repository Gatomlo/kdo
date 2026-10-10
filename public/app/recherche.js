// Recherche dans les listes, articles, idees secretes et fiches ; fiche « tailles et
// preferences » d'une personne.
import { esc, on, toast, eur, avatar } from './ui.js';
import { get, put, attempt } from './api.js';
import { S, go } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

// ---------- Recherche ----------
let timer = null;
let results = null;
const resultsHtml = (r) => {
  if (!r) return '<p class="small muted center">Cherche un article, une liste, une idée ou une personne.</p>';
  const n = r.items.length + r.lists.length + r.ideas.length + r.fiches.length;
  if (!n) return empty('Rien trouvé.');
  const sec = (title, rows) => (rows.length ? `<section class="stack"><h3 class="tag">${title}</h3>${rows.join('')}</section>` : '');
  return sec('Articles', r.items.map((i) => `<a class="card res-row" href="#/listes/${i.listId}"><span class="grow"><b>${esc(i.title)}</b><span class="meta">${esc(i.ownerName)} · ${esc(i.listTitle)}</span></span>${i.price != null ? `<span class="price">${eur(i.price)}</span>` : ''}</a>`))
    + sec('Listes', r.lists.map((l) => `<a class="card lc" href="#/listes/${l.id}"><span class="cover">${esc(l.cover)}</span><span class="grow"><b>${esc(l.title)}</b><span class="meta">${esc(l.ownerName)}</span></span></a>`))
    + sec('Idées secrètes', r.ideas.map((i) => `<a class="card res-row" href="#/idees/${i.recipientId}"><span class="grow"><b>${esc(i.title)}</b><span class="meta">pour ${esc(i.recipientName)}</span></span>💡</a>`))
    + sec('Fiches tailles et préférences', r.fiches.map((f) => `<a class="card res-row" href="#/fiche/${f.memberId}"><b class="grow">${esc(f.name)}</b>📏</a>`));
};

define('recherche', {
  view: () => ({
    title: 'Rechercher', back: '#/', tab: '',
    body: `<div class="stack-lg"><input type="search" class="search" data-in="search" placeholder="Livre de cuisine, pointure, Léa…" value="${esc(S.q.search || '')}" autofocus aria-label="Rechercher">
      <div id="search-results" class="stack-lg">${resultsHtml(results)}</div></div>`,
  }),
});
on('input', 'search', (el) => {
  S.q.search = el.value;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const q = el.value.trim();
    results = q.length >= 2 ? await get(`search?q=${encodeURIComponent(q)}`).catch(() => null) : null;
    const box = document.getElementById('search-results');
    if (box) box.innerHTML = resultsHtml(results);
  }, 250);
});

// ---------- Fiche tailles et preferences ----------
const FIELDS = [
  ['top', '👕 Haut (t-shirt, pull)', 'M'], ['bottom', '👖 Bas (pantalon, jupe)', '38'], ['shoes', '👟 Pointure', '39'], ['ring', '💍 Tour de doigt', '54'],
  ['colors', '🎨 Couleurs préférées', 'vert, bleu nuit'], ['likes', '❤️ Aime', 'jardinage, polars, thé'],
  ['dislikes', '🚫 N’aime pas / allergies', 'bibelots, noix'], ['has', '📦 A déjà (à ne pas offrir)', 'la trilogie, un robot de cuisine'],
];
define('fiche/:mid', {
  load: (p) => get(`fiches/${p.mid}`),
  view: (d) => {
    const f = d.fiche || {};
    const who = d.member.me ? 'Ma fiche' : `Fiche de ${d.member.name}`;
    const rows = FIELDS.filter(([k]) => f[k]);
    return {
      title: who, sub: 'Tailles et préférences', back: '#/cercle', tab: 'cercle',
      body: d.canEdit
        ? `<form class="card stack" data-f="fiche"><div class="row">${avatar(d.member, 'lg')}<p class="small muted grow">Visible de toute la famille et des invités de ${d.member.me ? 'tes' : 'ses'} listes partagées : de quoi éviter la mauvaise taille ou le cadeau en double.</p></div>
            ${FIELDS.map(([k, label, ph]) => `<label>${label}${['likes', 'dislikes', 'has'].includes(k) ? `<textarea name="${k}" maxlength="500" placeholder="${ph}">${esc(f[k] || '')}</textarea>` : `<input name="${k}" maxlength="${k === 'colors' ? 500 : 60}" value="${esc(f[k] || '')}" placeholder="${ph}">`}</label>`).join('')}
            <button class="btn main">Enregistrer</button></form>`
        : `<div class="card stack"><div class="row">${avatar(d.member, 'lg')}<b class="grow">${esc(d.member.name)}</b></div>
            ${rows.length ? `<dl class="fiche-dl">${rows.map(([k, label]) => `<dt>${label}</dt><dd>${esc(f[k])}</dd>`).join('')}</dl>` : '<p class="muted">Pas encore remplie.</p>'}</div>
          <a class="btn ghost" href="#/idees/${d.member.id}">💡 Idées secrètes pour ${esc(d.member.name)}</a>`,
    };
  },
});
on('submit', 'fiche', async (form, f) => {
  if (await attempt(() => put(`fiches/${S.data.member.id}`, f))) { toast('Fiche enregistrée'); go(S.data.member.me ? '#/moi' : '#/cercle'); }
});


