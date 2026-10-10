// Listes : index, creation, vue d'une liste (destinataire / offrant / gestionnaire),
// fiche article, reglages (infos, categories, roles, archivage).
// Le serveur n'envoie les donnees de cadeaux (item.gifts, offList) qu'aux offrants et
// gestionnaires : l'interface se contente d'afficher ce qu'elle recoit.
import { esc, on, toast, sheet, confirmSheet, eur, eurInput, fmtDate, stars, avatar, host } from './ui.js';
import { get, post, patch, put, del, attempt, uploadPhoto } from './api.js';
import { S, reload, render, go } from './state.js';
import { define } from './router.js';
import { listCard, empty } from './cards.js';

const COVERS = ['🎁', '🎄', '🎂', '👶', '💍', '🎓', '🏡', '🌟', '🧸', '📚'];
const PRIORITIES = [[3, '★★★ Très envie'], [2, '★★ Envie'], [1, '★ Si l’occasion se présente']];
const STATUS = { free: ['Disponible', 'p-free'], reserved: ['Réservé', 'p-res'], bought: ['Acheté', 'p-buy'] };

// ---------- Index ----------
define('listes', {
  load: () => get(`lists${S.q.archived ? '?archived=1' : ''}`),
  view: (lists) => {
    const mine = lists.filter((l) => l.role !== 'viewer');
    const others = lists.filter((l) => l.role === 'viewer');
    return {
      title: S.q.archived ? 'Listes archivées' : 'Les listes',
      right: '<a class="btn main sm" href="#/listes/nouvelle">+ Nouvelle</a>',
      body: `<div class="stack-lg">
        <section class="stack"><h2>Mes listes <span class="muted small">(et celles que je gère)</span></h2>${mine.length ? mine.map(listCard).join('') : empty('Aucune liste.')}</section>
        <section class="stack"><h2>La famille</h2>${others.length ? others.map(listCard).join('') : empty('Personne n’a encore publié de liste.')}</section>
        <button class="linkbtn" data-a="toggle-archived">${S.q.archived ? '← Listes actives' : 'Voir les listes archivées'}</button></div>`,
    };
  },
});
on('click', 'toggle-archived', () => { S.q.archived = !S.q.archived; reload(); });

// ---------- Champs d'une liste (creation, reglages) ----------
function listFields(v, events) {
  const cover = v.cover || '🎁';
  return `<label>Titre<input name="title" required maxlength="120" value="${esc(v.title || '')}" placeholder="Noël 2026"></label>
    <div class="grid2"><label>Occasion<input name="occasion" maxlength="80" value="${esc(v.occasion || '')}" placeholder="Noël, anniversaire…"></label>
    <label>Date<input name="date" type="date" value="${esc(v.date || '')}"></label></div>
    <fieldset><legend>Couverture</legend><div class="covers">${COVERS.map((c) => `<label class="cov"><input type="radio" name="cover" value="${c}" ${c === cover ? 'checked' : ''}><span>${c}</span></label>`).join('')}</div></fieldset>
    <label>Message d’accueil<textarea name="welcome" maxlength="2000" placeholder="Merci d’avance ! Je chausse du 38.">${esc(v.welcome || '')}</textarea></label>
    <label>Événement<select name="eventId"><option value="">— aucun —</option>${events.map((e) => `<option value="${e.id}" ${v.eventId === e.id ? 'selected' : ''}>${esc(e.title)}${e.date ? ` (${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })})` : ''}</option>`).join('')}</select></label>`;
}
const allEvents = async () => { const e = await get('events'); return [...e.upcoming, ...e.past]; };

// ---------- Creation ----------
const newList = (params) => ({
  load: async () => ({ events: await allEvents(), me: await get('me') }),
  view: (d) => {
    const owners = [{ id: d.me.id, name: `${d.me.name} (moi)` }, ...d.me.profiles];
    return {
      title: 'Nouvelle liste', back: '#/listes', tab: 'listes',
      body: `<form class="stack-lg" data-f="list-new"><div class="card stack">
        ${owners.length > 1 ? `<label>Liste de<select name="ownerId">${owners.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>` : ''}
        ${listFields({ eventId: params && params.eid ? Number(params.eid) : null }, d.events)}
        <label class="check"><input type="checkbox" name="defaultCategories" checked> Créer les catégories habituelles (Livres, Jeux, Vêtements, Maison, Expériences)</label>
        </div><button class="btn main wide">Créer la liste</button></form>`,
    };
  },
});
define('listes/nouvelle', newList());
define('listes/nouvelle/evenement/:eid', { load: newList().load, view: (d, p) => newList(p).view(d) });
on('submit', 'list-new', async (form, f) => {
  const r = await attempt(() => post('lists', { ...f, ownerId: f.ownerId ? Number(f.ownerId) : undefined, eventId: f.eventId || null }));
  if (r) go(`#/listes/${r.id}`);
});

// ---------- Vue d'une liste ----------
define('listes/:id', {
  load: (p) => {
    if (S.q.listId !== p.id) S.q = { ...S.q, listId: p.id, cat: 'all', prio: 0, free: false };
    return get(`lists/${p.id}`);
  },
  view: (d) => {
    const { list, owner } = d;
    const q = S.q;
    const visible = d.items.filter((i) => (q.cat === 'all' || (q.cat === 'none' ? i.categoryId == null : i.categoryId === q.cat))
      && i.priority >= q.prio && (!q.free || (i.gifts && i.gifts.status === 'free')));
    const known = new Set(d.categories.map((c) => c.id));
    const groups = [...d.categories.map((c) => ({ name: c.name, items: visible.filter((i) => i.categoryId === c.id) })),
      { name: d.categories.length ? 'Autres' : '', items: visible.filter((i) => i.categoryId == null || !known.has(i.categoryId)) }].filter((g) => g.items.length);
    const used = d.categories.filter((c) => d.items.some((i) => i.categoryId === c.id));
    const order = d.items.map((i) => i.id);
    const banners = [
      d.canSeeGifts ? `<p class="banner hide">🤫 <span>Vue offrant : ne montre pas cet écran à <b>${esc(owner.name)}</b>.</span></p>` : '',
      d.role === 'owner' ? '<p class="banner info">🙈 <span>C’est ta liste : les réservations te restent cachées, quel que soit le chemin pour arriver ici.</span></p>' : '',
      d.role === 'co_owner' ? '<p class="banner info">🙈 <span>Tu es co-propriétaire de cette liste : les réservations te restent cachées.</span></p>' : '',
      d.role === 'manager' ? '<p class="banner info">🛡️ <span>Tu es <b>gestionnaire</b> : tu modifies les articles et tu gères les réservations.</span></p>' : '',
    ].join('');
    const filters = d.items.length ? `<div class="stack">
        ${used.length ? `<div class="chips" role="group" aria-label="Catégories"><button class="chip" data-a="f-cat" data-v="all" aria-pressed="${q.cat === 'all'}">Tout</button>${used.map((c) => `<button class="chip" data-a="f-cat" data-v="${c.id}" aria-pressed="${q.cat === c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
        <div class="row wrap small"><label class="check">Priorité <select data-ch="f-prio">${[[0, 'toutes'], [2, '★★ et +'], [3, '★★★']].map(([v, l]) => `<option value="${v}" ${q.prio === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${d.canSeeGifts ? `<label class="check"><input type="checkbox" data-ch="f-free" ${q.free ? 'checked' : ''}> Disponibles seulement</label>` : ''}</div></div>` : '';
    return {
      title: list.title, back: d.guest ? null : '#/listes', tab: 'listes',
      body: `<div class="stack-lg">
        <header class="stack">
          <div class="row"><span class="cover big" aria-hidden="true">${esc(list.cover)}</span>
            <div class="grow"><p class="meta">${avatar(owner, 'sm')} ${esc(owner.name)}${d.roles.filter((r) => r.role === 'co_owner').map((r) => ` & ${esc(r.name)}`).join('')}${list.date ? ` · ${fmtDate(list.date)}` : ''}${list.archived ? ' · <span class="pill p-buy">archivée</span>' : ''}</p>
            ${d.event ? `<p class="small">Événement : ${d.guest ? esc(d.event.title) : `<a href="#/evenements/${d.event.id}">${esc(d.event.title)}</a>`}</p>` : ''}</div></div>
          ${list.welcome ? `<p class="card welcome">${esc(list.welcome)}</p>` : ''}
          ${banners}
          ${d.role === 'viewer' && !d.guest ? `<a class="link" href="#/idees/${owner.id}">💡 Idées secrètes pour ${esc(owner.name)}</a>` : ''}
          ${d.canEdit ? `<div class="row wrap"><a class="btn main" href="#/listes/${list.id}/article/nouveau">+ Ajouter un article</a><a class="btn ghost" href="#/listes/${list.id}/reglages">Réglages</a></div>` : ''}
        </header>
        ${filters}
        ${groups.length ? groups.map((g) => `<section class="stack">${g.name ? `<h3 class="tag">${esc(g.name)}</h3>` : ''}${g.items.map((i) => itemCard(i, d, order)).join('')}</section>`).join('')
          : empty(d.items.length ? 'Aucun article ne correspond aux filtres.' : d.canEdit ? 'Cette liste est encore vide : ajoute ton premier souhait.' : 'Cette liste est encore vide.')}
        ${d.offList ? offListSection(d) : ''}
      </div>`,
    };
  },
});
on('click', 'f-cat', (el) => { S.q.cat = el.dataset.v === 'all' || el.dataset.v === 'none' ? el.dataset.v : Number(el.dataset.v); render(); });
on('change', 'f-prio', (el) => { S.q.prio = Number(el.value); render(); });
on('change', 'f-free', (el) => { S.q.free = el.checked; render(); });

function itemCard(i, d, order) {
  const g = i.gifts;
  const links = [i.url, i.url2].filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(host(u))} ↗</a>`).join('');
  const pos = order.indexOf(i.id);
  return `<article class="item${g && g.status === 'bought' ? ' done' : ''}" data-item="${i.id}" ${d.canEdit ? 'draggable="true"' : ''}>
    <div class="thumb">${i.image ? `<button class="zoom" data-a="photo-zoom" data-src="${esc(i.image)}" data-title="${esc(i.title)}" aria-label="Agrandir la photo"><img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>` : '🎁'}</div>
    <div class="body">
      <div class="between"><b class="title">${esc(i.title)}</b>${i.received ? '<span class="pill p-free">reçu 🎉</span>' : g ? `<span class="pill ${STATUS[g.status][1]}">${STATUS[g.status][0]}</span>` : ''}</div>
      <div class="meta"><span class="stars" title="Priorité ${i.priority}/3">${stars(i.priority)}</span>
        ${i.price != null ? `<span class="price">${eur(i.price)}</span>` : ''}
        ${i.quantity > 1 ? `<span>${g ? `${g.taken} sur ${i.quantity} pris` : `× ${i.quantity}`}</span>` : ''}
        ${i.groupGift ? '<span class="pill p-mgr">cadeau commun</span>' : ''}${links}</div>
      ${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
      ${g ? giftBlock(i, d) : ''}
      ${d.canEdit ? `<div class="row wrap edit">
        <a class="btn ghost sm" href="#/listes/${d.list.id}/article/${i.id}">Modifier</a>
        <button class="btn ghost sm" data-a="item-move" data-id="${i.id}" data-dir="-1" ${pos === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
        <button class="btn ghost sm" data-a="item-move" data-id="${i.id}" data-dir="1" ${pos === order.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
        <button class="btn danger-t sm" data-a="item-del" data-id="${i.id}" data-title="${esc(i.title)}">Supprimer</button>
        <button class="btn ghost sm" data-a="item-received" data-id="${i.id}" data-v="${i.received ? '' : '1'}">${i.received ? 'Pas reçu' : 'Reçu ✓'}</button></div>` : ''}
    </div></article>`;
}

function giftBlock(i, d) {
  const g = i.gifts;
  const meName = d.actors[0] && d.actors[0].name;
  const who = (r) => (r.mine ? (r.giverName === meName ? 'Toi' : `Toi (pour ${esc(r.giverName)})`) : esc(r.giverName));
  const asSelect = d.actors.length > 1 ? `<select name="asId" aria-label="Offert par">${d.actors.map((a, k) => `<option value="${a.id}">${k ? `De ${esc(a.name)}` : 'De moi'}</option>`).join('')}</select>` : '';
  const reassign = (r) => (d.canManageGifts && !r.mine ? `<select data-ch="res-reassign" data-id="${r.id}" aria-label="Réattribuer">${d.members.map((m) => `<option value="${m.id}" ${m.id === r.giverId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '');
  const actions = (r, carrierRule) => (r.mine || d.canManageGifts ? `<span class="row">
      ${carrierRule ? '' : r.status === 'bought' ? `<button class="linkbtn" data-a="res-status" data-id="${r.id}" data-v="reserved">pas encore acheté</button>` : `<button class="linkbtn" data-a="res-status" data-id="${r.id}" data-v="bought">marquer acheté</button>`}
      <button class="linkbtn" data-a="res-cancel" data-id="${r.id}">${r.amount != null ? 'retirer' : 'annuler'}</button></span>` : '');
  let html = '';
  if (i.groupGift) {
    const parts = g.reservations;
    const mine = parts.find((r) => r.mine);
    html += `<div class="stack tight">${i.price ? `<div class="gauge" role="meter" aria-valuemin="0" aria-valuemax="${i.price}" aria-valuenow="${g.funded}" aria-label="Financement"><i style="width:${Math.min(100, (g.funded / i.price) * 100)}%"></i></div>
      <span class="small muted">${eur(g.funded)} réunis sur ${eur(i.price)}</span>` : ''}
      ${parts.map((r) => `<div class="res"><span>${who(r)} · ${eur(r.amount)} ${r.isCarrier ? '<span class="pill p-mgr">porteur</span>' : ''}</span>
        ${r.mine || d.canManageGifts ? `<span class="row">${r.isCarrier ? '' : `<button class="linkbtn" data-a="res-carrier" data-id="${r.id}">porter l’achat</button>`}
          ${r.isCarrier || d.canManageGifts ? (g.status === 'bought' ? `<button class="linkbtn" data-a="res-status" data-id="${r.id}" data-v="reserved">pas encore acheté</button>` : `<button class="linkbtn" data-a="res-status" data-id="${r.id}" data-v="bought">marquer acheté</button>`) : ''}
          <button class="linkbtn" data-a="res-cancel" data-id="${r.id}">retirer</button></span>` : ''}${reassign(r)}</div>`).join('')}
      ${g.status !== 'bought' ? `<div class="row wrap act">${asSelect}<input name="amount" inputmode="decimal" placeholder="Montant €" class="amount" value="${mine ? esc(eurInput(mine.amount)) : ''}"><button class="btn main sm" data-a="participate" data-id="${i.id}">${mine ? 'Modifier ma part' : 'Participer'}</button></div>` : ''}</div>`;
  } else {
    html += g.reservations.map((r) => `<div class="res"><span>${who(r)}${i.quantity > 1 ? ` × ${r.quantity}` : ''} · ${r.status === 'bought' ? 'acheté ✓' : 'réservé'}</span>${actions(r, false)}${reassign(r)}</div>`).join('');
    if (g.available > 0) {
      html += `<div class="row wrap act">${asSelect}${g.available > 1 ? `<select name="quantity" aria-label="Quantité">${Array.from({ length: g.available }, (_, k) => `<option>${k + 1}</option>`).join('')}</select>` : ''}
        <button class="btn main sm" data-a="reserve" data-id="${i.id}">Je réserve</button></div>`;
    }
  }
  html += `<details class="thread" ${String(S.q.openThread) === String(i.id) ? 'open' : ''}><summary>💬 Discussion entre offrants${g.comments.length ? ` (${g.comments.length})` : ''}</summary>
    <div class="stack tight">${g.comments.map((c) => `<p class="small"><b>${esc(c.author)}</b> — ${esc(c.body)}</p>`).join('')}
    <form class="row" data-f="comment" data-id="${i.id}"><input name="body" maxlength="1000" placeholder="Je l’ai vu moins cher chez…" required class="grow"><button class="btn sm">Envoyer</button></form></div></details>`;
  return html;
}

function offListSection(d) {
  const asSelect = d.actors.length > 1 ? `<select name="asId">${d.actors.map((a, k) => `<option value="${a.id}">${k ? `De ${esc(a.name)}` : 'De moi'}</option>`).join('')}</select>` : '';
  return `<section class="stack"><h2>Cadeaux hors liste</h2>
    <p class="small muted">Pour éviter les doublons : ce que d’autres offrent en dehors de la liste (invisible pour ${esc(d.owner.name)}).</p>
    ${d.offList.map((o) => `<div class="card between small"><span><b>${esc(o.giverName)}</b> offre : ${esc(o.description)}</span>${o.mine || d.canManageGifts ? `<button class="linkbtn" data-a="offlist-del" data-id="${o.id}">retirer</button>` : ''}</div>`).join('')}
    <form class="row wrap" data-f="offlist">${asSelect}<input name="description" maxlength="300" placeholder="J’offre autre chose : un pull vert…" required class="grow"><button class="btn">Noter</button></form></section>`;
}

const listId = () => S.data.list.id;
on('click', 'photo-zoom', (el) => sheet(`<h3>${esc(el.dataset.title)}</h3><img class="photo-big" src="${esc(el.dataset.src)}" alt="Photo : ${esc(el.dataset.title)}" referrerpolicy="no-referrer"><div class="row end"><button class="btn ghost" data-a="close-sheet">Fermer</button></div>`));
const cardOf = (el) => el.closest('[data-item]');

on('click', 'reserve', async (el) => {
  const c = cardOf(el);
  const qty = c.querySelector('[name=quantity]');
  const as = c.querySelector('[name=asId]');
  if (await attempt(() => post(`items/${el.dataset.id}/reserve`, { quantity: qty ? Number(qty.value) : 1, asId: as ? Number(as.value) : undefined }))) { toast('Réservé !'); reload(); }
});
on('click', 'participate', async (el) => {
  const c = cardOf(el);
  const as = c.querySelector('[name=asId]');
  const amount = c.querySelector('[name=amount]').value;
  if (await attempt(() => post(`items/${el.dataset.id}/participate`, { amount, asId: as ? Number(as.value) : undefined }))) { toast('Participation enregistrée'); reload(); }
});
on('click', 'res-status', async (el) => { if (await attempt(() => patch(`reservations/${el.dataset.id}`, { status: el.dataset.v }))) reload(); });
on('click', 'res-carrier', async (el) => { if (await attempt(() => patch(`reservations/${el.dataset.id}`, { carrier: true }))) reload(); });
on('click', 'res-cancel', async (el) => {
  if (!(await confirmSheet({ title: 'Annuler la réservation ?', text: 'Le cadeau redeviendra disponible pour les autres.', ok: 'Annuler la réservation', danger: true }))) return;
  if (await attempt(() => del(`reservations/${el.dataset.id}`))) reload();
});
on('change', 'res-reassign', async (el) => { if (await attempt(() => patch(`reservations/${el.dataset.id}`, { giverId: Number(el.value) }))) { toast('Réservation réattribuée'); reload(); } });
on('submit', 'comment', async (form, f) => { if (await attempt(() => post(`items/${form.dataset.id}/comments`, { body: f.body }))) { S.q.openThread = form.dataset.id; reload(); } });
on('submit', 'offlist', async (form, f) => {
  if (await attempt(() => post(`lists/${listId()}/off-list`, { description: f.description, asId: f.asId ? Number(f.asId) : undefined }))) { toast('Noté : les autres offrants le verront'); reload(); }
});
on('click', 'offlist-del', async (el) => { if (await attempt(() => del(`off-list/${el.dataset.id}`))) reload(); });
on('click', 'item-received', async (el) => { if (await attempt(() => patch(`items/${el.dataset.id}/received`, { received: !!el.dataset.v }))) reload(); });
on('click', 'item-del', async (el) => {
  if (!(await confirmSheet({ title: 'Supprimer l’article ?', text: `« ${esc(el.dataset.title)} » sera retiré de la liste.`, ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(`items/${el.dataset.id}`))) { toast('Article supprimé'); reload(); }
});

// Ordre : fleches, ou glisser-deposer a la souris.
async function saveOrder(ids) { if (await attempt(() => put(`lists/${listId()}/items/order`, { ids }))) reload(); }
on('click', 'item-move', (el) => {
  const ids = S.data.items.map((i) => i.id);
  const k = ids.indexOf(Number(el.dataset.id));
  const j = k + Number(el.dataset.dir);
  if (j < 0 || j >= ids.length) return;
  [ids[k], ids[j]] = [ids[j], ids[k]];
  saveOrder(ids);
});
let dragged = null;
document.addEventListener('dragstart', (e) => { const c = e.target.closest && e.target.closest('.item[draggable]'); if (c) { dragged = Number(c.dataset.item); e.dataTransfer.effectAllowed = 'move'; } });
document.addEventListener('dragover', (e) => { const c = dragged && e.target.closest('.item[draggable]'); if (c) { e.preventDefault(); document.querySelectorAll('.item.over').forEach((x) => x.classList.remove('over')); c.classList.add('over'); } });
document.addEventListener('drop', (e) => {
  const c = dragged && e.target.closest('.item[draggable]');
  if (!c) return;
  e.preventDefault();
  const target = Number(c.dataset.item);
  const ids = S.data.items.map((i) => i.id).filter((id) => id !== dragged);
  if (target !== dragged) { ids.splice(ids.indexOf(target), 0, dragged); saveOrder(ids); }
  dragged = null;
});
document.addEventListener('dragend', () => { dragged = null; document.querySelectorAll('.item.over').forEach((x) => x.classList.remove('over')); });

// ---------- Fiche article ----------
define('listes/:id/article/:itemId', {
  load: async (p) => {
    const v = await get(`lists/${p.id}`);
    if (!v.canEdit) throw new Error('Tu ne peux pas modifier cette liste.');
    const item = p.itemId === 'nouveau' ? null : v.items.find((i) => i.id === Number(p.itemId));
    if (p.itemId !== 'nouveau' && !item) throw new Error('Article introuvable.');
    return { list: v.list, categories: v.categories, item };
  },
  view: (d) => {
    const it = d.item || {};
    return {
      title: d.item ? 'Modifier l’article' : 'Nouvel article', back: `#/listes/${d.list.id}`, tab: 'listes',
      body: `<form class="stack-lg" data-f="item" data-id="${d.item ? d.item.id : ''}"><div class="card stack">
        <label>Lien marchand<span class="row"><input name="url" type="url" value="${esc(it.url || '')}" placeholder="https://…" class="grow"><button type="button" class="btn sm" data-a="prefill">Pré-remplir</button></span></label>
        <p class="small muted" id="prefill-hint" hidden></p>
        <label>Nom<input name="title" required maxlength="200" value="${esc(it.title || '')}"></label>
        <div class="grid2"><label>Catégorie<select name="categoryId"><option value="">— aucune —</option>${d.categories.map((c) => `<option value="${c.id}" ${it.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>…ou nouvelle catégorie<input name="newCategory" maxlength="60" placeholder="ex. Lego"></label></div>
        <div class="grid2"><label>Prix indicatif (€)<input name="price" inputmode="decimal" value="${esc(eurInput(it.price))}"></label>
          <label>Priorité<select name="priority">${PRIORITIES.map(([v, l]) => `<option value="${v}" ${(it.priority || 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label class="check"><input type="checkbox" name="groupGift" data-ch="group-toggle" ${it.groupGift ? 'checked' : ''}> Cadeau commun (plusieurs participants se partagent le prix)</label>
        <label id="qty-field" ${it.groupGift ? 'hidden' : ''}>Quantité souhaitée<input name="quantity" type="number" min="1" max="99" value="${it.quantity || 1}"></label>
        <label>Taille, couleur, précisions<textarea name="description" maxlength="2000">${esc(it.description || '')}</textarea></label>
        <fieldset><legend>Photo</legend>
          <div class="row wrap"><img id="img-preview" class="preview" alt="Aperçu de la photo" referrerpolicy="no-referrer" ${it.image ? `src="${esc(it.image)}"` : 'hidden'}>
            <label class="btn ghost sm file">📷 ${it.image ? 'Changer la photo' : 'Ajouter une photo'}<input type="file" accept="image/*" data-ch="photo-file" hidden></label>
            <button type="button" class="btn danger-t sm" data-a="photo-clear" ${it.image ? '' : 'hidden'}>Retirer</button></div>
          <p class="small muted" id="photo-hint" hidden></p>
          <input type="hidden" name="image" value="${esc(it.image || '')}">
          <details><summary>…ou le lien d’une image sur internet</summary><input type="url" data-in="photo-url" placeholder="https://…/image.jpg" value="${esc(it.image && !it.image.startsWith('photos/') ? it.image : '')}"></details>
        </fieldset>
        <label>Autre lien marchand<input name="url2" type="url" value="${esc(it.url2 || '')}"></label>
      </div>
      <div class="row wrap"><button class="btn main grow">Enregistrer</button>${d.item ? '' : '<button type="button" class="btn ghost" data-a="item-save-again">Enregistrer et ajouter un autre</button>'}</div></form>`,
    };
  },
});
// Photo de l'article : deposee (reduite puis envoyee) ou lien d'image.
function setPhoto(src) {
  const form = document.querySelector('form[data-f=item]');
  form.image.value = src || '';
  const img = document.getElementById('img-preview');
  img.hidden = !src;
  if (src) img.src = src; else img.removeAttribute('src');
  document.querySelector('[data-a=photo-clear]').hidden = !src;
}
on('change', 'photo-file', async (el) => {
  const file = el.files && el.files[0];
  if (!file) return;
  const hint = document.getElementById('photo-hint');
  hint.hidden = false;
  hint.textContent = 'Envoi de la photo…';
  try {
    setPhoto(await uploadPhoto(file));
    hint.textContent = 'Photo prête : pense à enregistrer.';
  } catch (e) { hint.textContent = e.message; }
  el.value = '';
});
on('click', 'photo-clear', () => setPhoto(''));
on('input', 'photo-url', (el) => { const v = el.value.trim(); if (!v || /^https?:\/\//.test(v)) setPhoto(v); });
on('change', 'group-toggle', (el) => { document.getElementById('qty-field').hidden = el.checked; });
on('click', 'prefill', async () => {
  const form = document.querySelector('form[data-f=item]');
  const url = form.url.value.trim();
  const hint = document.getElementById('prefill-hint');
  hint.hidden = false;
  if (!/^https?:\/\//.test(url)) { hint.textContent = 'Colle d’abord un lien commençant par http(s)://'; return; }
  hint.textContent = 'Lecture de la page…';
  try {
    const r = await get(`preview?url=${encodeURIComponent(url)}`);
    if (r.title && !form.title.value) form.title.value = r.title;
    if (r.image && !form.image.value) setPhoto(r.image);
    if (r.price && !form.price.value) form.price.value = r.price;
    hint.textContent = r.title || r.image ? 'Infos récupérées : vérifie-les avant d’enregistrer.' : 'Rien trouvé sur cette page : remplis à la main.';
  } catch (e) { hint.textContent = `Impossible de lire cette page (${e.message})`; }
});
async function saveItem(form, f, again) {
  const lid = S.data.list.id;
  let categoryId = f.categoryId ? Number(f.categoryId) : null;
  if (f.newCategory.trim()) {
    const c = await attempt(() => post(`lists/${lid}/categories`, { name: f.newCategory }));
    if (!c) return;
    categoryId = c.id;
  }
  const body = { ...f, categoryId, priority: Number(f.priority), quantity: Number(f.quantity || 1) };
  const id = form.dataset.id;
  const ok = await attempt(() => (id ? patch(`items/${id}`, body) : post(`lists/${lid}/items`, body)));
  if (!ok) return;
  if (again) { toast('Article ajouté. Au suivant !'); reload(); window.scrollTo(0, 0); } else go(`#/listes/${lid}`);
}
on('submit', 'item', (form, f) => saveItem(form, f, false));
on('click', 'item-save-again', () => {
  const form = document.querySelector('form[data-f=item]');
  if (!form.reportValidity()) return;
  const f = {};
  new FormData(form).forEach((v, k) => { f[k] = v; });
  f.groupGift = form.groupGift.checked;
  saveItem(form, f, true);
});

// ---------- Reglages ----------
define('listes/:id/reglages', {
  load: async (p) => {
    const [v, circle, events, share, lists] = await Promise.all([get(`lists/${p.id}`), get('circle'), allEvents(), get(`lists/${p.id}/share`), get('lists')]);
    if (!v.canEdit) throw new Error('Tu ne peux pas modifier cette liste.');
    const siblings = lists.filter((l) => l.owner.id === v.owner.id && l.id !== v.list.id && l.role !== 'viewer');
    return { ...v, members: circle.members, events, share, siblings };
  },
  view: (d) => {
    const taken = new Set([d.owner.id, S.me.id, ...d.roles.map((r) => r.id)]);
    const label = { co_owner: 'co-propriétaire', manager: 'gestionnaire' };
    const cats = d.categories;
    return {
      title: 'Réglages de la liste', sub: d.list.title, back: `#/listes/${d.list.id}`, tab: 'listes',
      body: `<div class="stack-lg">
        <form class="card stack" data-f="list-save">${listFields(d.list, d.events)}<button class="btn main">Enregistrer</button></form>
        <section class="card stack"><h2>Catégories</h2>
          ${cats.map((c, k) => `<form class="row" data-f="cat-rename" data-id="${c.id}"><input name="name" value="${esc(c.name)}" maxlength="60" class="grow" aria-label="Nom de la catégorie"><button class="btn ghost sm">OK</button>
            <button type="button" class="btn ghost sm" data-a="cat-move" data-id="${c.id}" data-dir="-1" ${k === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
            <button type="button" class="btn ghost sm" data-a="cat-move" data-id="${c.id}" data-dir="1" ${k === cats.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
            <button type="button" class="btn danger-t sm" data-a="cat-del" data-id="${c.id}" data-name="${esc(c.name)}" aria-label="Supprimer">✕</button></form>`).join('')}
          <form class="row" data-f="cat-add"><input name="name" maxlength="60" placeholder="Nouvelle catégorie" required class="grow"><button class="btn sm">Ajouter</button></form></section>
        <section class="card stack"><h2>Rôles</h2>
          <p class="small muted"><b>Co-propriétaire</b> (liste de couple, de naissance…) : modifie les articles, ne voit jamais les réservations. <b>Gestionnaire</b> : personne de confiance qui modifie les articles et gère les réservations.</p>
          ${d.roles.map((r) => `<div class="between"><span>${esc(r.name)} <span class="pill p-mgr">${label[r.role]}</span></span>${r.id !== S.me.id ? `<button class="linkbtn" data-a="role-del" data-id="${r.id}">retirer</button>` : ''}</div>`).join('')}
          <form class="row wrap" data-f="role-add"><select name="memberId" class="grow">${d.members.filter((m) => !taken.has(m.id)).map((m) => `<option value="${m.id}">${esc(m.name)}${m.hasAccount ? '' : ' (sans compte)'}</option>`).join('')}</select>
            <select name="role"><option value="co_owner">co-propriétaire</option><option value="manager">gestionnaire</option></select><button class="btn sm">Ajouter</button></form></section>
        ${shareSection(d)}
        <section class="card stack"><h2>Après la fête</h2>
          <p class="small muted">Marque les cadeaux reçus (bouton « Reçu ✓ » sur chaque article), puis reporte les autres dans une liste suivante : cette liste sera archivée, l’historique des cadeaux est gardé.</p>
          <form class="stack tight" data-f="list-carry"><label>Reporter les articles non reçus vers
            <select name="targetId" data-ch="carry-target"><option value="">une nouvelle liste…</option>${d.siblings.map((l) => `<option value="${l.id}">${esc(l.title)}</option>`).join('')}</select></label>
            <input name="title" id="carry-title" maxlength="120" placeholder="Titre de la nouvelle liste" value="${esc(`Mes envies ${new Date().getFullYear() + 1}`)}">
            <button class="btn">Reporter et archiver</button></form>
          <button class="btn ghost" data-a="list-dup">📄 Dupliquer cette liste</button></section>
        <section class="row wrap"><button class="btn ghost" data-a="list-archive">${d.list.archived ? 'Réactiver la liste' : 'Archiver la liste'}</button>
          ${d.role !== 'co_owner' ? '<button class="btn danger" data-a="list-del">Supprimer la liste</button>' : ''}</section>
      </div>`,
    };
  },
});
// ---------- Partage hors du cercle ----------
function shareSection(d) {
  const s = d.share;
  const intro = '<p class="small muted">Pour le parrain, un oncle, une grand-mère… qui n’ont pas de compte : avec ce lien, ils voient <b>cette liste seulement</b> en vue offrant et peuvent réserver. Les réservations restent cachées au destinataire.</p>';
  if (!s.enabled) return `<section class="card stack"><h2>Partager hors du cercle</h2>${intro}<button class="btn plum" data-a="share-on">🔗 Créer un lien de partage</button></section>`;
  return `<section class="card stack"><h2>Partager hors du cercle</h2>${intro}
    <input readonly value="${esc(s.url)}" class="select-all" aria-label="Lien de partage">
    <div class="row wrap"><button class="btn main sm" data-a="copy" data-text="${esc(s.url)}">Copier le lien</button>
      ${navigator.share ? `<button class="btn ghost sm" data-a="share-native" data-url="${esc(s.url)}">Envoyer…</button>` : ''}
      <a class="btn ghost sm" href="https://wa.me/?text=${encodeURIComponent(`Ma liste de cadeaux « ${d.list.title} » : ${s.url}`)}" target="_blank" rel="noopener noreferrer">WhatsApp</a></div>
    <form class="stack tight" data-f="share-pass"><label>Mot de passe ${s.hasPassword ? '<span class="pill p-free">actif</span>' : '<span class="muted">(facultatif)</span>'}
      <input name="password" type="text" autocomplete="off" minlength="4" maxlength="100" placeholder="${s.hasPassword ? 'Nouveau mot de passe' : 'ex. sapin2026'}"></label>
      <p class="small muted">${s.hasPassword ? 'Le lien seul ne suffit pas : l’invité doit aussi saisir le mot de passe (à lui donner à part). Le changer déconnecte les invités déjà entrés.' : 'Sans mot de passe, toute personne qui a le lien peut voir la liste.'}</p>
      <div class="row wrap"><button class="btn sm">${s.hasPassword ? 'Changer le mot de passe' : 'Protéger par mot de passe'}</button>${s.hasPassword ? '<button type="button" class="btn ghost sm" data-a="share-pass-off">Retirer le mot de passe</button>' : ''}</div></form>
    ${s.guests.length ? `<p class="tag">Invités (${s.guests.length})</p>${s.guests.map((g) => `<div class="between"><span class="row small">${avatar(g, 'sm')}${esc(g.name)}${g.email ? ` <span class="muted">· ${esc(g.email)}</span>` : ''}</span><button class="linkbtn" data-a="guest-del" data-id="${g.id}" data-name="${esc(g.name)}">retirer</button></div>`).join('')}` : '<p class="small muted">Personne n’est encore venu par ce lien.</p>'}
    <div class="row wrap"><button class="btn ghost sm" data-a="share-renew">Nouveau lien</button><button class="btn danger-t sm" data-a="share-off">Désactiver le partage</button></div></section>`;
}
const shareCall = async (fn, msg) => { if (await attempt(fn)) { if (msg) toast(msg); reload(); } };
on('click', 'share-on', () => shareCall(() => post(`lists/${listId()}/share`), 'Lien de partage créé'));
on('click', 'share-native', (el) => navigator.share({ title: S.data.list.title, text: `Ma liste de cadeaux « ${S.data.list.title} »`, url: el.dataset.url }).catch(() => {}));
on('submit', 'share-pass', (form, f) => { if (f.password.trim()) shareCall(() => put(`lists/${listId()}/share/password`, { password: f.password.trim() }), 'Mot de passe enregistré'); });
on('click', 'share-pass-off', () => shareCall(() => put(`lists/${listId()}/share/password`, { password: null }), 'Mot de passe retiré'));
on('click', 'share-renew', async () => {
  if (!(await confirmSheet({ title: 'Créer un nouveau lien ?', text: 'L’ancien lien ne permettra plus d’entrer. Les invités déjà venus gardent leur accès.', ok: 'Nouveau lien' }))) return;
  shareCall(() => post(`lists/${listId()}/share`, { renew: true }), 'Nouveau lien créé');
});
on('click', 'share-off', async () => {
  if (!(await confirmSheet({ title: 'Désactiver le partage ?', text: 'Le lien ne fonctionnera plus et les invités perdent l’accès (leurs réservations restent visibles de la famille).', ok: 'Désactiver', danger: true }))) return;
  shareCall(() => del(`lists/${listId()}/share`), 'Partage désactivé');
});
on('click', 'guest-del', async (el) => {
  if (!(await confirmSheet({ title: `Retirer ${esc(el.dataset.name)} ?`, text: 'Ses réservations et messages sur cette liste seront supprimés.', ok: 'Retirer', danger: true }))) return;
  shareCall(() => del(`lists/${listId()}/share/guests/${el.dataset.id}`), 'Invité retiré');
});
document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('select-all')) e.target.select(); });

on('change', 'carry-target', (el) => { document.getElementById('carry-title').hidden = !!el.value; });
on('submit', 'list-carry', async (form, f) => {
  const n = S.data.items.filter((i) => !i.received).length;
  if (!(await confirmSheet({ title: 'Reporter et archiver ?', text: `${n} article${n > 1 ? 's' : ''} non reçu${n > 1 ? 's' : ''} ser${n > 1 ? 'ont copiés' : 'a copié'} ; cette liste sera archivée.`, ok: 'Reporter' }))) return;
  const r = await attempt(() => post(`lists/${listId()}/carry`, f.targetId ? { targetId: Number(f.targetId) } : { title: f.title }));
  if (r) { toast(`${r.moved} article${r.moved > 1 ? 's' : ''} reporté${r.moved > 1 ? 's' : ''}`); go(`#/listes/${r.id}`); }
});
on('click', 'list-dup', async () => {
  const r = await attempt(() => post(`lists/${listId()}/duplicate`, {}));
  if (r) { toast('Liste dupliquée'); go(`#/listes/${r.id}/reglages`); }
});

on('submit', 'list-save', async (form, f) => { if (await attempt(() => patch(`lists/${listId()}`, { ...f, eventId: f.eventId || null }))) toast('Liste enregistrée'); });
on('submit', 'cat-add', async (form, f) => { if (await attempt(() => post(`lists/${listId()}/categories`, { name: f.name }))) reload(); });
on('submit', 'cat-rename', async (form, f) => { if (await attempt(() => patch(`categories/${form.dataset.id}`, { name: f.name }))) toast('Catégorie renommée'); });
on('click', 'cat-move', async (el) => {
  const ids = S.data.categories.map((c) => c.id);
  const k = ids.indexOf(Number(el.dataset.id));
  const j = k + Number(el.dataset.dir);
  [ids[k], ids[j]] = [ids[j], ids[k]];
  if (await attempt(() => put(`lists/${listId()}/categories/order`, { ids }))) reload();
});
on('click', 'cat-del', async (el) => {
  if (!(await confirmSheet({ title: 'Supprimer la catégorie ?', text: `Les articles de « ${esc(el.dataset.name)} » resteront dans « Autres ».`, ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(`categories/${el.dataset.id}`))) reload();
});
on('submit', 'role-add', async (form, f) => {
  if (!f.memberId) return;
  if (await attempt(() => post(`lists/${listId()}/roles`, { memberId: Number(f.memberId), role: f.role }))) { toast('Rôle ajouté'); reload(); }
});
on('click', 'role-del', async (el) => { if (await attempt(() => del(`lists/${listId()}/roles/${el.dataset.id}`))) reload(); });
on('click', 'list-archive', async () => {
  const archived = !S.data.list.archived;
  if (await attempt(() => patch(`lists/${listId()}`, { archived }))) { toast(archived ? 'Liste archivée' : 'Liste réactivée'); reload(); }
});
on('click', 'list-del', async () => {
  if (!(await confirmSheet({ title: 'Supprimer la liste ?', text: 'La liste, ses articles et toutes les réservations seront supprimés définitivement.', ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(`lists/${listId()}`))) { toast('Liste supprimée'); go('#/listes'); }
});

