// Listes : index, creation, vue d'une liste (destinataire / offrant / gestionnaire),
// fiche article, reglages (infos, categories, roles, archivage).
// Le serveur n'envoie les donnees de cadeaux (item.gifts, offList) qu'aux offrants et
// gestionnaires : l'interface se contente d'afficher ce qu'elle recoit.
import { esc, on, toast, sheet, closeSheet, confirmSheet, eur, eurInput, fmtDate, stars, avatar, host } from './ui.js';
import { get, post, patch, put, del, attempt, uploadPhoto, linkPreview } from './api.js';
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
      fab: { href: '#/listes/nouvelle', label: 'Liste' },
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
  load: async () => ({ events: await allEvents(), me: await get('me'), circle: await get('circle') }),
  view: (d) => {
    const owners = [{ id: d.me.id, name: `${d.me.name} (moi)` }, ...d.me.profiles];
    return {
      title: 'Nouvelle liste', back: '#/listes', tab: 'listes',
      body: `<form class="stack-lg" data-f="list-new"><div class="card stack">
        <div id="owner-normal">${owners.length > 1 ? `<label>Liste de<select name="ownerId">${owners.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>` : ''}</div>
        <label class="check"><input type="checkbox" name="surprise" data-ch="surprise-toggle"> 🤫 Liste surprise : invisible pour la personne concernée</label>
        <div id="owner-surprise" class="stack" hidden><label>Liste surprise pour<select name="surpriseFor" data-ch="surprise-for">${d.circle.members.filter((m) => m.id !== d.me.id).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
          <p class="small muted">Elle ne la verra pas du tout ; tu en es gestionnaire et la famille peut réserver dessus.</p>
          ${d.circle.members.some((m) => m.hasAccount && m.id !== d.me.id) ? `<fieldset><legend>La préparer à plusieurs avec <span class="muted">(ils pourront ajouter des articles)</span></legend><div class="people">
            ${d.circle.members.filter((m) => m.hasAccount && m.id !== d.me.id).map((m) => `<label class="check" data-coorg="${m.id}"><input type="checkbox" name="managers" data-multi value="${m.id}"> ${esc(m.name)}</label>`).join('')}</div></fieldset>` : ''}</div>
        ${listFields({ eventId: params && params.eid ? Number(params.eid) : null }, d.events)}
        <label class="check"><input type="checkbox" name="defaultCategories" checked> Créer les catégories habituelles (Livres, Jeux, Vêtements, Maison, Expériences)</label>
        </div><button class="btn main wide">Créer la liste</button></form>`,
    };
  },
});
define('listes/nouvelle', newList());
define('listes/nouvelle/evenement/:eid', { load: newList().load, view: (d, p) => newList(p).view(d) });
// La personne fetee ne peut pas co-organiser sa propre surprise.
const syncCoorg = () => {
  const sel = document.querySelector('[name=surpriseFor]');
  document.querySelectorAll('[data-coorg]').forEach((l) => {
    const hide = l.dataset.coorg === sel.value;
    l.hidden = hide;
    if (hide) l.querySelector('input').checked = false;
  });
};
on('change', 'surprise-toggle', (el) => {
  document.getElementById('owner-normal').hidden = el.checked;
  document.getElementById('owner-surprise').hidden = !el.checked;
  syncCoorg();
});
on('change', 'surprise-for', syncCoorg);
on('submit', 'list-new', async (form, f) => {
  const ownerId = f.surprise ? Number(f.surpriseFor) : f.ownerId ? Number(f.ownerId) : undefined;
  const r = await attempt(() => post('lists', { ...f, surpriseFor: undefined, managers: f.surprise ? f.managers : undefined, ownerId, eventId: f.eventId || null }));
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
    // Une seule ligne d'information selon le role (vue epuree).
    const f = d.ownerFiche;
    const ficheRows = f ? [['👕 Haut', f.top], ['👖 Bas', f.bottom], ['👟 Pointure', f.shoes], ['💍 Bague', f.ring], ['🎨 Couleurs', f.colors], ['❤️ Aime', f.likes], ['🚫 N’aime pas / allergies', f.dislikes], ['📦 A déjà', f.has]].filter(([, v]) => v) : [];
    // Infos repliees derriere ℹ️ : message d'accueil, fiche, evenement, idees, role.
    const info = q.info ? `<div class="infos stack tight">
        ${list.welcome ? `<p class="welcome">${esc(list.welcome)}</p>` : ''}
        ${d.event ? `<p class="small">📅 ${d.guest ? esc(d.event.title) : `<a href="#/evenements/${d.event.id}">${esc(d.event.title)}</a>`}</p>` : ''}
        <p class="small muted">${list.surprise ? `🤫 <b>Liste surprise</b> : ${esc(owner.name)} ne la voit pas. ` : ''}${d.canSeeGifts ? `🤫 Vue offrant : ne montre pas cet écran à ${esc(owner.name)}.${d.role === 'manager' ? ' Tu es gestionnaire : tu modifies les articles et gères les réservations.' : ''}` : `🙈 ${d.role === 'owner' ? 'Ta liste' : 'Tu es co-propriétaire'} : les réservations te restent cachées.`}</p>
        ${ficheRows.length ? `<dl class="fiche-dl">${ficheRows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
        <p class="row wrap small">${!d.guest && (d.role === 'owner' || d.role === 'manager') ? `<a href="#/fiche/${owner.id}">📏 ${ficheRows.length ? 'Modifier la fiche' : 'Remplir la fiche tailles'}</a>` : ''}
          ${d.role === 'viewer' && !d.guest ? `<a href="#/idees/${owner.id}">💡 Idées secrètes</a>` : ''}</p></div>` : '';
    // Offrants : barre d'avancement (disponibles / reserves / achetes).
    const n = { free: 0, reserved: 0, bought: 0 };
    if (d.canSeeGifts) d.items.forEach((i) => { if (i.gifts && !i.received) n[i.gifts.status]++; });
    const progress = n.free + n.reserved + n.bought ? `<div class="split" role="img" aria-label="${n.reserved} réservés, ${n.bought} achetés, ${n.free} disponibles">
        ${[['bought', 's-buy'], ['reserved', 's-res'], ['free', 's-free']].filter(([k]) => n[k]).map(([k, c]) => `<i class="${c}" style="flex:${n[k]}"></i>`).join('')}</div>
      <p class="legend"><span><i class="s-buy"></i>${n.bought} acheté${n.bought > 1 ? 's' : ''}</span><span><i class="s-res"></i>${n.reserved} réservé${n.reserved > 1 ? 's' : ''}</span><span><i class="s-free"></i>${n.free} libre${n.free > 1 ? 's' : ''}</span></p>` : '';
    const hasInfo = list.welcome || d.event || ficheRows.length || d.role !== 'viewer' || !d.guest;
    const chips = d.items.length > 5 ? `<div class="chips" role="group" aria-label="Filtres">
        <button class="chip" data-a="f-cat" data-v="all" aria-pressed="${q.cat === 'all' && !q.free && !q.prio}">Tout</button>
        ${d.canSeeGifts ? `<button class="chip" data-a="f-free" aria-pressed="${q.free}">Disponibles</button>` : ''}
        <button class="chip" data-a="f-prio" aria-pressed="${q.prio === 3}">★★★</button>
        ${used.length > 1 ? used.map((c) => `<button class="chip" data-a="f-cat" data-v="${c.id}" aria-pressed="${q.cat === c.id}">${esc(c.name)}</button>`).join('') : ''}</div>` : '';
    return {
      title: list.title, back: d.guest ? null : '#/listes', tab: 'listes',
      settings: d.canEdit && !d.guest ? `#/listes/${list.id}/reglages` : null,
      fab: d.canEdit ? { href: `#/listes/${list.id}/article/nouveau`, label: 'Article' } : null,
      after: () => { if (S.q.open) openItem(S.q.open); },
      body: `<div class="stack-lg">
        <header class="listhead">
          <div class="row"><span class="cover" aria-hidden="true">${esc(list.cover)}</span>
            <p class="meta grow">${avatar(owner, 'sm')} ${esc(owner.name)}${d.roles.filter((r) => r.role === 'co_owner').map((r) => ` & ${esc(r.name)}`).join('')}${list.date ? ` · ${fmtDate(list.date, { day: 'numeric', month: 'short' })}` : ''}
              ${list.archived ? '<span class="pill p-buy">archivée</span>' : ''}${d.canSeeGifts ? `<span class="pill p-hide" title="Ne montre pas cet écran à ${esc(owner.name)}">🤫 caché à ${esc(owner.name)}</span>` : '<span class="pill p-mgr" title="Les réservations te restent cachées">🙈 sans spoiler</span>'}</p>
            ${hasInfo ? `<button class="ib" data-a="list-info" aria-expanded="${!!q.info}" aria-label="Informations" title="Informations">ℹ️</button>` : ''}</div>
          ${info}
          ${progress ? `<div class="progress">${progress}</div>` : ''}
        </header>
        ${chips}
        ${groups.length ? groups.map((g) => `<section class="stack">${g.name ? `<h3 class="tag">${esc(g.name)}</h3>` : ''}${g.items.map((i) => itemCard(i, d)).join('')}</section>`).join('')
          : empty(d.items.length ? 'Aucun article ne correspond aux filtres.' : d.canEdit ? 'Cette liste est encore vide : touche « + Article ».' : 'Cette liste est encore vide.')}
        ${d.offList ? offListSection(d) : ''}
      </div>`,
    };
  },
});
on('click', 'f-cat', (el) => {
  if (el.dataset.v === 'all') { S.q.cat = 'all'; S.q.free = false; S.q.prio = 0; } else S.q.cat = S.q.cat === Number(el.dataset.v) ? 'all' : Number(el.dataset.v);
  render();
});
on('click', 'list-info', () => { S.q.info = !S.q.info; render(); });
on('click', 'item-open', (el) => openItem(Number(el.dataset.id)));
on('click', 'f-prio', () => { S.q.prio = S.q.prio === 3 ? 0 : 3; render(); });
on('click', 'f-free', () => { S.q.free = !S.q.free; render(); });

// Article : une ligne compacte (vignette, titre, ★ prix, statut, action rapide en icone) ;
// touche = deplier (precisions, liens, reservations, discussion).
const DOT = { free: ['dot-free', 'Disponible'], reserved: ['dot-res', 'Réservé'], bought: ['dot-buy', 'Acheté'] };
const ib = (a, id, icon, label, extra = '', cls = '') => `<button class="ib${cls ? ` ${cls}` : ''}" data-a="${a}" data-id="${id}" ${extra} aria-label="${label}" title="${label}">${icon}<span class="lbl">${label}</span></button>`;

function itemCard(i, d) {
  const g = i.gifts;
  const mine = g ? g.reservations.filter((r) => r.mine) : [];
  let quick = '';
  if (g && !i.received && g.status !== 'bought') {
    if (i.groupGift) quick = ib('participate-sheet', i.id, '💶', mine.length ? 'Ma part' : 'Participer', '', 'primary');
    else if (g.available > 0) quick = ib('reserve', i.id, '🎁', 'Je réserve', '', 'primary');
  }
  if (d.canEdit) quick += ib('item-menu', i.id, '⋯', 'Actions');
  const status = i.received ? '<span class="dot dot-buy" title="Reçu">🎉</span>'
    : g ? `<span class="dot ${DOT[g.status][0]}" title="${DOT[g.status][1]}" aria-label="${DOT[g.status][1]}"></span>` : '';
  const meta = [
    `<span class="stars" title="Priorité ${i.priority}/3">${stars(i.priority)}</span>`,
    i.price != null ? `<span class="price">${eur(i.price)}</span>` : '',
    i.quantity > 1 ? `<span>${g ? `${g.taken}/${i.quantity}` : `×${i.quantity}`}</span>` : '',
    i.groupGift && g && i.price ? `<span>💶 ${Math.round((g.funded / i.price) * 100)} %</span>` : i.groupGift ? '<span>💶 commun</span>' : '',
    mine.length ? `<span class="pill p-res">${mine.some((r) => r.status === 'bought') ? '✓ acheté' : 'à moi'}</span>` : g && g.reservations.length && !i.groupGift ? `<span>${esc(g.reservations.map((r) => r.giverName).join(', '))}</span>` : '',
    g && g.comments.length ? `<span>💬 ${g.comments.length}</span>` : '',
  ].filter(Boolean).join('');
  return `<article class="item${g && g.status === 'bought' || i.received ? ' done' : ''}" data-item="${i.id}" ${d.canEdit ? 'draggable="true"' : ''}>
    <div class="thumb">${i.image ? `<button class="zoom" data-a="photo-zoom" data-src="${esc(i.image)}" data-title="${esc(i.title)}" aria-label="Agrandir la photo"><img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>` : '🎁'}</div>
    <button class="body linkish" data-a="item-open" data-id="${i.id}" aria-haspopup="dialog"><b class="title">${esc(i.title)}</b><span class="meta">${meta}</span></button>
    <div class="side">${status}${quick}</div>
  </article>`;
}

// Fiche d'un article : panneau du bas (photo, prix, liens, cagnotte, reservations, discussion).
// Rouverte apres chaque action tant que S.q.open est defini (voir after dans la vue).
function itemSheet(i, d) {
  const g = i.gifts;
  const mine = g ? g.reservations.filter((r) => r.mine) : [];
  const links = [i.url, i.url2].filter(Boolean).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Voir chez ${esc(host(u))} ↗</a>`).join('');
  const badges = [i.groupGift ? '<span class="pill p-mgr">Cadeau commun</span>' : '', `<span class="pill p-res">${stars(i.priority)}</span>`,
    i.received ? '<span class="pill p-free">🎉 reçu</span>' : g ? `<span class="pill ${STATUS[g.status][1]}">${STATUS[g.status][0]}</span>` : ''].join('');
  let html = `<div class="art-img">${i.image ? `<img src="${esc(i.image)}" alt="" referrerpolicy="no-referrer">` : '<span aria-hidden="true">🎁</span>'}<span class="badges">${badges}</span></div>
    <h3>${esc(i.title)}</h3>
    <p class="art-price">${i.price != null ? `<b>${eur(i.price)}</b>` : ''}${i.quantity > 1 ? `<span class="muted">× ${i.quantity}${g ? ` · ${g.taken} pris` : ''}</span>` : ''}${links}</p>
    ${i.description ? `<p class="art-note">${esc(i.description)}</p>` : ''}`;
  let foot = '';
  if (g) {
    const meName = d.actors[0] && d.actors[0].name;
    const who = (r) => (r.mine ? (r.giverName === meName ? 'Toi' : `Toi (pour ${esc(r.giverName)})`) : esc(r.giverName));
    if (i.groupGift && i.price) html += `<div class="stack tight"><div class="between"><h2>La cagnotte</h2><b class="small">${eur(g.funded)} / ${eur(i.price)}</b></div>
      <div class="gauge" role="meter" aria-valuemin="0" aria-valuemax="${i.price}" aria-valuenow="${g.funded}" aria-label="Financement"><i style="width:${Math.min(100, (g.funded / i.price) * 100)}%"></i></div></div>`;
    if (g.reservations.length) {
      html += `<div class="stack tight">${g.reservations.map((r) => {
        const can = r.mine || d.canManageGifts;
        const canBuy = r.amount == null || r.isCarrier || d.canManageGifts;
        const acts = can ? [
          r.amount != null && !r.isCarrier ? ib('res-carrier', r.id, '🛍️', 'Je porte l’achat') : '',
          canBuy ? (r.status === 'bought' ? ib('res-status', r.id, '↩️', 'Pas encore acheté', 'data-v="reserved"') : ib('res-status', r.id, '✅', 'Marquer acheté', 'data-v="bought"')) : '',
          d.canManageGifts && !r.mine ? ib('res-reassign-sheet', r.id, '👤', 'Réattribuer') : '',
          ib('res-cancel', r.id, '✕', r.amount != null ? 'Retirer ma part' : 'Annuler'),
        ].join('') : '';
        return `<div class="res"><span>${who(r)}${r.amount != null ? ` · ${eur(r.amount)}` : i.quantity > 1 ? ` × ${r.quantity}` : ''}${r.isCarrier ? ' · porteur' : ''} · ${r.status === 'bought' ? 'acheté' : 'réservé'}</span><span class="row">${acts}</span></div>`;
      }).join('')}</div>`;
    }
    html += `<div class="thread stack tight"><h2>Discussion <span class="small muted">· cachée à ${esc(d.owner.name)}</span></h2>${g.comments.map((c) => `<p class="msg"><b>${esc(c.author)}</b>${esc(c.body)}</p>`).join('')}
      <form class="row" data-f="comment" data-id="${i.id}"><input name="body" maxlength="1000" placeholder="Message aux autres offrants…" required class="grow"><button class="ib" aria-label="Envoyer" title="Envoyer">➤</button></form></div>`;
    if (!i.received && g.status !== 'bought') {
      if (i.groupGift) {
        const part = mine.find((r) => r.amount != null);
        const rest = i.price ? Math.max(0, i.price - g.funded) : 0;
        const amounts = [1000, 2000, 3000].filter((v) => !rest || v < rest).map((v) => [v, eur(v)]);
        if (rest) amounts.push([rest, `Le reste (${eur(rest)})`]);
        foot = `<form class="stack" data-f="participate" data-id="${i.id}">
          <div class="chips" role="group" aria-label="Montant">${amounts.map(([v, l]) => `<button type="button" class="chip" data-a="amt" data-v="${eurInput(v)}" aria-pressed="false">${l}</button>`).join('')}</div>
          <div class="row"><input name="amount" inputmode="decimal" required placeholder="Ma part (€)" aria-label="Ma participation en euros" value="${part ? esc(eurInput(part.amount)) : ''}" class="grow">
          <button class="btn main">${part ? 'Modifier ma part' : 'Participer'}</button></div>${asSelect()}</form>`;
      } else if (g.available > 0) foot = `<button class="btn main wide" data-a="reserve" data-id="${i.id}">🎁 ${mine.length ? 'J’en offre un de plus' : 'Je l’offre'}</button>`;
    }
  }
  if (d.canEdit) foot += `<div class="row"><a class="btn ghost grow" href="#/listes/${d.list.id}/article/${i.id}">✏️ Modifier</a><button class="btn ghost" data-a="item-menu" data-id="${i.id}" aria-label="Autres actions">⋯</button></div>`;
  return `${html}${foot ? `<div class="sheet-foot stack">${foot}</div>` : ''}`;
}
export function openItem(id) {
  const i = S.data && S.data.items && S.data.items.find((x) => x.id === id);
  if (!i) { S.q.open = null; return; }
  S.q.open = id;
  sheet(itemSheet(i, S.data), () => { S.q.open = null; }, 'article');
}
// Panneau ouvert depuis la fiche : le fermer ramene a la fiche.
const sub = (html) => sheet(html, () => { if (S.q.open) openItem(S.q.open); });
const backToItem = () => { if (S.q.open) openItem(S.q.open); };
on('click', 'amt', (el) => {
  const form = el.closest('form');
  form.amount.value = el.dataset.v;
  form.querySelectorAll('[data-a=amt]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
});

function offListSection(d) {
  const asSelect = d.actors.length > 1 ? `<select name="asId">${d.actors.map((a, k) => `<option value="${a.id}">${k ? `De ${esc(a.name)}` : 'De moi'}</option>`).join('')}</select>` : '';
  return `<details class="offlist fiche"><summary>🎀 Cadeaux hors liste${d.offList.length ? ` (${d.offList.length})` : ''}</summary><div class="stack tight">
    <p class="small muted">Ce que d’autres offrent en dehors de la liste, pour éviter les doublons (invisible pour ${esc(d.owner.name)}).</p>
    ${d.offList.map((o) => `<div class="res"><span><b>${esc(o.giverName)}</b> : ${esc(o.description)}</span>${o.mine || d.canManageGifts ? `<button class="ib" data-a="offlist-del" data-id="${o.id}" aria-label="Retirer" title="Retirer">✕</button>` : ''}</div>`).join('')}
    <form class="row wrap" data-f="offlist">${asSelect}<input name="description" maxlength="300" placeholder="J’offre autre chose : un pull vert…" required class="grow"><button class="ib" aria-label="Noter" title="Noter">➤</button></form></div></details>`;
}

const listId = () => S.data.list.id;
on('click', 'photo-zoom', (el) => sub(`<h3>${esc(el.dataset.title)}</h3><img class="photo-big" src="${esc(el.dataset.src)}" alt="Photo : ${esc(el.dataset.title)}" referrerpolicy="no-referrer"><div class="row end"><button class="btn ghost" data-a="close-sheet">Fermer</button></div>`));

const asSelect = () => (S.data.actors.length > 1 ? `<label>De la part de<select name="asId">${S.data.actors.map((a, k) => `<option value="${a.id}">${k ? esc(a.name) : 'moi'}</option>`).join('')}</select></label>` : '');
on('click', 'reserve', async (el) => {
  const i = S.data.items.find((x) => x.id === Number(el.dataset.id));
  if (i.gifts.available <= 1 && S.data.actors.length <= 1) {
    if (await attempt(() => post(`items/${i.id}/reserve`, { quantity: 1 }))) { toast(`« ${i.title} » réservé`); reload(); }
    return;
  }
  sub(`<h3>🎁 ${esc(i.title)}</h3><form class="stack" data-f="reserve" data-id="${i.id}">
    ${i.gifts.available > 1 ? `<label>Combien ?<select name="quantity">${Array.from({ length: i.gifts.available }, (_, k) => `<option>${k + 1}</option>`).join('')}</select></label>` : ''}${asSelect()}
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Je réserve</button></div></form>`);
});
on('submit', 'reserve', async (form, f) => {
  if (await attempt(() => post(`items/${form.dataset.id}/reserve`, { quantity: Number(f.quantity || 1), asId: f.asId ? Number(f.asId) : undefined }))) { closeSheet(); toast('Réservé !'); reload(); }
});
on('click', 'participate-sheet', (el) => {
  const i = S.data.items.find((x) => x.id === Number(el.dataset.id));
  const mine = i.gifts.reservations.find((r) => r.mine);
  sub(`<h3>💶 ${esc(i.title)}</h3><p class="small muted">Cadeau commun${i.price ? ` : ${eur(i.gifts.funded)} réunis sur ${eur(i.price)}` : ''}.</p>
    <form class="stack" data-f="participate" data-id="${i.id}"><label>Ma participation (€)<input name="amount" inputmode="decimal" required value="${mine ? esc(eurInput(mine.amount)) : ''}"></label>${asSelect()}
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">${mine ? 'Modifier ma part' : 'Participer'}</button></div></form>`);
});
on('submit', 'participate', async (form, f) => {
  if (await attempt(() => post(`items/${form.dataset.id}/participate`, { amount: f.amount, asId: f.asId ? Number(f.asId) : undefined }))) { closeSheet(); toast('Participation enregistrée'); reload(); }
});
on('click', 'res-reassign-sheet', (el) => {
  const r = S.data.items.flatMap((i) => (i.gifts ? i.gifts.reservations : [])).find((x) => x.id === Number(el.dataset.id));
  sub(`<h3>👤 Réattribuer la réservation</h3><form class="stack" data-f="reassign" data-id="${r.id}"><select name="giverId">${S.data.members.map((m) => `<option value="${m.id}" ${m.id === r.giverId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Réattribuer</button></div></form>`);
});
on('submit', 'reassign', async (form, f) => { if (await attempt(() => patch(`reservations/${form.dataset.id}`, { giverId: Number(f.giverId) }))) { closeSheet(); toast('Réservation réattribuée'); reload(); } });
on('click', 'res-status', async (el) => { if (await attempt(() => patch(`reservations/${el.dataset.id}`, { status: el.dataset.v }))) reload(); });
on('click', 'res-carrier', async (el) => { if (await attempt(() => patch(`reservations/${el.dataset.id}`, { carrier: true }))) reload(); });
on('click', 'res-cancel', async (el) => {
  if (!(await confirmSheet({ title: 'Annuler la réservation ?', text: 'Le cadeau redeviendra disponible pour les autres.', ok: 'Annuler la réservation', danger: true }))) { backToItem(); return; }
  if (await attempt(() => del(`reservations/${el.dataset.id}`))) reload();
});
on('submit', 'comment', async (form, f) => { if (await attempt(() => post(`items/${form.dataset.id}/comments`, { body: f.body }))) reload(); });
on('submit', 'offlist', async (form, f) => {
  if (await attempt(() => post(`lists/${listId()}/off-list`, { description: f.description, asId: f.asId ? Number(f.asId) : undefined }))) { toast('Noté : les autres offrants le verront'); reload(); }
});
on('click', 'offlist-del', async (el) => { if (await attempt(() => del(`off-list/${el.dataset.id}`))) reload(); });
on('click', 'item-menu', (el) => {
  const id = Number(el.dataset.id);
  const i = S.data.items.find((x) => x.id === id);
  const ids = S.data.items.map((x) => x.id);
  const k = ids.indexOf(id);
  sub(`<h3>${esc(i.title)}</h3><div class="stack">
    <a class="btn ghost" href="#/listes/${S.data.list.id}/article/${id}" data-a="close-then-go" data-to="#/listes/${S.data.list.id}/article/${id}">✏️ Modifier</a>
    <button class="btn ghost" data-a="item-received" data-id="${id}" data-v="${i.received ? '' : '1'}">${i.received ? '↩️ Pas encore reçu' : '🎉 Marquer comme reçu'}</button>
    <div class="row"><button class="btn ghost grow" data-a="item-move" data-id="${id}" data-dir="-1" ${k === 0 ? 'disabled' : ''}>↑ Monter</button><button class="btn ghost grow" data-a="item-move" data-id="${id}" data-dir="1" ${k === ids.length - 1 ? 'disabled' : ''}>↓ Descendre</button></div>
    <button class="btn danger-t" data-a="item-del" data-id="${id}" data-title="${esc(i.title)}">🗑️ Supprimer</button></div>`);
});
on('click', 'close-then-go', (el) => { closeSheet(); go(el.dataset.to); });
on('click', 'item-received', async (el) => {
  closeSheet(); if (await attempt(() => patch(`items/${el.dataset.id}/received`, { received: !!el.dataset.v }))) reload(); });
on('click', 'item-del', async (el) => {
  closeSheet();
  if (!(await confirmSheet({ title: 'Supprimer l’article ?', text: `« ${esc(el.dataset.title)} » sera retiré de la liste.`, ok: 'Supprimer', danger: true }))) { backToItem(); return; }
  if (await attempt(() => del(`items/${el.dataset.id}`))) { S.q.open = null; toast('Article supprimé'); reload(); }
});

// Ordre : fleches, ou glisser-deposer a la souris.
async function saveOrder(ids) { if (await attempt(() => put(`lists/${listId()}/items/order`, { ids }))) reload(); }
on('click', 'item-move', (el) => {
  closeSheet();
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

// ---------- Nouveau souhait en une etape (bouton + central, partage depuis le telephone) ----------
// Lien colle -> apercu automatique (titre, prix, photo) ; choix de la liste et de l'envie.
const WANTS = [[1, '★', 'Sympa'], [2, '★★', 'Envie'], [3, '★★★', 'Rêve']];
define('ajouter', {
  load: () => get('lists'),
  view: (lists) => {
    const mine = lists.filter((l) => l.role !== 'viewer' && !l.archived);
    const sh = S.q.shared;
    if (sh) S.q.shared = null;
    const first = mine.find((l) => l.role === 'owner') || mine[0];
    return {
      title: 'Nouveau souhait', back: '#/', tab: 'listes',
      fab: { href: '#/listes/nouvelle', label: 'Nouvelle liste' },
      after: () => { if (sh) quickPreview(); },
      body: mine.length ? `<form class="stack-lg" data-f="quick-add">
        <div class="stack"><label for="q-url">Lien du produit</label>
          <div class="paste"><input id="q-url" name="url" type="url" value="${esc(sh ? sh.url : '')}" placeholder="Colle un lien, on s’occupe du reste" data-ch="quick-url">
            <button type="button" class="btn plum sm" data-a="quick-paste">Coller</button></div>
          <p class="small muted" id="q-hint">Astuce : depuis un site, touche « Partager » puis Kdo.</p></div>
        <div class="card stack art-new">
          <div class="art-img" id="q-img"><span aria-hidden="true">🎁</span></div>
          <input type="hidden" name="image">
          <label>Nom<input name="title" required maxlength="200" value="${esc(sh ? sh.title : '')}" placeholder="Kit potager d’intérieur"></label>
          <label>Prix indicatif (€)<input name="price" inputmode="decimal" placeholder="35"></label>
        </div>
        <fieldset class="bare"><legend>Dans quelle liste ?</legend><div class="picks">${mine.map((l) => `<label class="pick"><input type="radio" name="listId" value="${l.id}" ${l === first ? 'checked' : ''}><span>${esc(l.cover)} ${esc(l.title)}${l.owner.id !== S.me.id ? ` · ${esc(l.owner.name)}` : ''}</span></label>`).join('')}</div></fieldset>
        <fieldset class="bare"><legend>Mon envie</legend><div class="wants">${WANTS.map(([v, st, l]) => `<label class="pick"><input type="radio" name="priority" value="${v}" ${v === 2 ? 'checked' : ''}><span><b>${st}</b>${l}</span></label>`).join('')}</div></fieldset>
        <label>Un détail pour la famille ?<input name="description" maxlength="2000" placeholder="Taille, couleur, « pas en rose »…"></label>
        <div class="stack"><button class="btn main wide">Ajouter à ma liste</button>
          <button type="button" class="linkbtn" data-a="quick-more">Plus d’options (catégorie, photo, cadeau commun…)</button></div>
      </form>` : empty('Pour ajouter un souhait, il te faut une liste. <a href="#/listes/nouvelle">Créer ma liste</a>'),
    };
  },
});
let previewed = '';
async function quickPreview() {
  const form = document.querySelector('form[data-f=quick-add]');
  if (!form) return;
  const url = form.url.value.trim();
  const hint = document.getElementById('q-hint');
  if (!/^https?:\/\//.test(url)) { if (url) hint.textContent = 'Le lien doit commencer par http(s)://'; return; }
  if (url === previewed) return;
  previewed = url;
  hint.textContent = 'Lecture de la page…';
  try {
    const r = await linkPreview(url);
    if (r.title && !form.title.value) form.title.value = r.title;
    if (r.price && !form.price.value) form.price.value = r.price;
    if (r.image) {
      form.image.value = r.image;
      document.getElementById('q-img').innerHTML = `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">`;
    }
    hint.textContent = r.title || r.image ? '✓ Trouvé automatiquement : vérifie avant d’ajouter.' : 'Rien trouvé sur cette page : remplis à la main.';
  } catch (e) { hint.textContent = `Impossible de lire cette page (${e.message})`; previewed = ''; }
}
on('change', 'quick-url', () => quickPreview());
on('click', 'quick-paste', async () => {
  const input = document.getElementById('q-url');
  try { input.value = (await navigator.clipboard.readText()).trim(); quickPreview(); } catch { input.focus(); toast('Colle le lien dans le champ (appui long → Coller)'); }
});
on('click', 'quick-more', () => {
  const form = document.querySelector('form[data-f=quick-add]');
  S.q.shared = { url: form.url.value.trim(), title: form.title.value };
  go(`#/listes/${form.querySelector('[name=listId]:checked').value}/article/nouveau`);
});
on('submit', 'quick-add', async (form, f) => {
  const r = await attempt(() => post(`lists/${f.listId}/items`, { title: f.title, url: f.url, price: f.price, image: f.image, description: f.description, priority: Number(f.priority), quantity: 1 }));
  if (r) { previewed = ''; toast(`« ${f.title} » ajouté`); go(`#/listes/${f.listId}`); }
});

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
    const sh = !d.item && S.q.shared;
    const it = d.item || (sh ? { url: sh.url, title: sh.title } : {});
    if (sh) {
      S.q.shared = null;
      setTimeout(() => { const b = document.querySelector('[data-a=prefill]'); if (b) b.click(); }, 50);
    }
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
    const r = await linkPreview(url);
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
          ${d.list.surprise ? `<p class="small muted">🤫 Liste surprise : ajoute des <b>co-organisateurs</b> (gestionnaires) pour la préparer à plusieurs.</p>
          <form class="row wrap" data-f="role-add"><select name="memberId" class="grow">${d.members.filter((m) => !taken.has(m.id) && m.hasAccount).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>
            <input type="hidden" name="role" value="manager"><button class="btn sm">Ajouter un co-organisateur</button></form></section>`
          : `<form class="row wrap" data-f="role-add"><select name="memberId" class="grow">${d.members.filter((m) => !taken.has(m.id)).map((m) => `<option value="${m.id}">${esc(m.name)}${m.hasAccount ? '' : ' (sans compte)'}</option>`).join('')}</select>
            <select name="role"><option value="co_owner">co-propriétaire</option><option value="manager">gestionnaire</option></select><button class="btn sm">Ajouter</button></form></section>`}
        ${d.role !== 'co_owner' ? `<section class="card stack"><h2>Destinataire</h2>
          <p class="small muted">Liste de <b>${esc(d.owner.name)}</b>. Créée pour quelqu’un avant qu’il ait son compte ? Donne-la-lui : il la verra comme sa liste (sans les réservations).</p>
          <form class="stack tight" data-f="list-transfer"><select name="memberId" aria-label="Nouveau destinataire">${d.members.filter((m) => m.id !== d.owner.id).map((m) => `<option value="${m.id}">${esc(m.name)}${m.hasAccount ? '' : ' (sans compte)'}</option>`).join('')}</select>
            <label class="check"><input type="checkbox" name="keepManager" checked> Je reste gestionnaire (je modifie et vois les réservations)</label>
            <button class="btn">Changer de destinataire</button></form>
          ${d.role !== 'owner' ? `<p class="small muted">${d.list.surprise ? `🤫 <b>Liste surprise</b> : ${esc(d.owner.name)} ne la voit pas.` : `${esc(d.owner.name)} voit cette liste (sans les réservations).`}</p>
          <button class="btn ghost" data-a="list-surprise">${d.list.surprise ? `Montrer la liste à ${esc(d.owner.name)}` : `En faire une liste surprise (cachée à ${esc(d.owner.name)})`}</button>` : ''}</section>` : ''}
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
on('click', 'list-surprise', async () => {
  const surprise = !S.data.list.surprise;
  if (!surprise && !(await confirmSheet({ title: `Montrer la liste à ${esc(S.data.owner.name)} ?`, text: 'La surprise sera dévoilée : la personne verra la liste et ses articles (jamais les réservations).', ok: 'Montrer' }))) return;
  if (await attempt(() => patch(`lists/${listId()}`, { surprise }))) { toast(surprise ? 'Liste surprise' : 'Liste visible'); reload(); }
});
on('submit', 'list-transfer', async (form, f) => {
  const m = S.data.members.find((x) => x.id === Number(f.memberId));
  if (!m || !(await confirmSheet({ title: `Donner la liste à ${esc(m.name)} ?`, text: `${esc(m.name)} en deviendra le destinataire : les réservations lui seront cachées.`, ok: 'Transférer' }))) return;
  if (await attempt(() => post(`lists/${listId()}/transfer`, { memberId: m.id, keepManager: !!f.keepManager }))) { toast('Liste transférée'); go(`#/listes/${listId()}`); }
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

