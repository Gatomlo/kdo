// Evenements : liste, creation / modification, page d'un evenement (« qui a deja de
// quoi », listes rattachees), organisation du Secret Santa, enveloppe et messages anonymes.
import { esc, on, toast, confirmSheet, eur, eurInput, fmtDate, daysUntil, avatar, plural } from './ui.js';
import { get, post, patch, del, attempt } from './api.js';
import { S, reload, go } from './state.js';
import { define } from './router.js';
import { listCard, eventRow, empty } from './cards.js';

// ---------- Liste ----------
define('evenements', {
  load: () => get('events'),
  view: (d) => ({
    title: 'Événements',
    right: '<a class="btn main sm" href="#/evenements/nouveau">+ Nouveau</a>',
    body: `<div class="stack-lg"><section class="stack"><h2>À venir</h2>${d.upcoming.length ? d.upcoming.map(eventRow).join('') : empty('Aucun événement prévu. Noël approche…')}</section>
      ${d.past.length ? `<section class="stack"><h2>Passés</h2>${d.past.map(eventRow).join('')}</section>` : ''}</div>`,
  }),
});

// ---------- Creation / modification ----------
function eventForm(name, v, members, selected, submit) {
  return `<form class="stack-lg" data-f="${name}"><div class="card stack">
    <label>Titre<input name="title" required maxlength="120" value="${esc(v.title || '')}" placeholder="Noël 2026 chez Mamy"></label>
    <div class="grid2"><label>Date<input name="date" type="date" value="${esc(v.date || '')}"></label>
      <label>Budget indicatif (€)<input name="budget" inputmode="decimal" value="${esc(eurInput(v.budget))}"></label></div>
    <label>Lieu<input name="place" maxlength="120" value="${esc(v.place || '')}"></label>
    <fieldset><legend>Participants</legend><div class="people">
      ${members.map((m) => `<label class="check"><input type="checkbox" name="participants" data-multi value="${m.id}" ${selected.includes(m.id) ? 'checked' : ''}> ${esc(m.name)}${m.hasAccount ? '' : ' 🧸'}</label>`).join('')}</div>
      <p class="small muted">🧸 = profil sans compte, représenté par ses gestionnaires.</p></fieldset>
    </div><button class="btn main wide">${submit}</button></form>`;
}
const eventBody = (f) => ({ ...f, participants: (f.participants || []).map(Number) });

define('evenements/nouveau', {
  load: () => get('circle'),
  view: (c) => ({
    title: 'Nouvel événement', back: '#/evenements', tab: 'evenements',
    body: `${eventForm('event-new', {}, c.members, [S.me.id], 'Créer l’événement')}<p class="small muted">Tu pourras activer le Secret Santa depuis la page de l’événement.</p>`,
  }),
});
on('submit', 'event-new', async (form, f) => {
  const r = await attempt(() => post('events', eventBody(f)));
  if (r) go(`#/evenements/${r.id}`);
});

define('evenements/:id/modifier', {
  load: async (p) => ({ ...(await get(`events/${p.id}/edit`)), members: (await get('circle')).members }),
  view: (d) => ({
    title: 'Modifier l’événement', back: `#/evenements/${d.event.id}`, tab: 'evenements',
    body: eventForm('event-edit', d.event, d.members, d.participants, 'Enregistrer'),
  }),
});
on('submit', 'event-edit', async (form, f) => {
  const id = S.data.event.id;
  if (await attempt(() => patch(`events/${id}`, eventBody(f)))) { toast('Événement enregistré'); go(`#/evenements/${id}`); }
});

// ---------- Page d'un evenement ----------
define('evenements/:id', {
  load: (p) => get(`events/${p.id}`),
  view: (d) => {
    const ev = d.event;
    const days = daysUntil(ev.date);
    const s = d.santa;
    let santa = '';
    if (s) {
      const card = s.status === 'drawn'
        ? s.envelopes
          ? `<a class="envelope" href="#/evenements/${ev.id}/enveloppe"><span class="seal">SS</span><span><b>Ton enveloppe Secret Santa</b><span>${s.envelopes > 1 ? `${s.envelopes} enveloppes (dont celles des profils que tu gères)` : 'Ouvre-la pour découvrir à qui tu offres'}</span></span></a>`
          : `<a class="card" href="#/evenements/${ev.id}/enveloppe">🎅 Tirage effectué. Voir les messages de ton Secret Santa →</a>`
        : '<p class="banner info">🎅 <span>Secret Santa en préparation : le tirage n’a pas encore eu lieu.</span></p>';
      santa = `<section class="stack">${card}<p class="small muted">${s.budget ? `Budget ${eur(s.budget)}` : ''}${s.deadline ? ` · avant le ${fmtDate(s.deadline)}` : ''}</p>
        ${d.isOrganizer ? `<a class="btn ghost" href="#/evenements/${ev.id}/secret-santa">Organiser le Secret Santa</a>` : ''}</section>`;
    } else if (d.isOrganizer) santa = '<button class="btn plum" data-a="santa-enable">🎅 Activer le Secret Santa</button>';
    return {
      title: ev.title, back: '#/evenements', tab: 'evenements',
      body: `<div class="stack-lg">
        <header class="stack"><p class="muted">${ev.date ? `${fmtDate(ev.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${days != null && days >= 0 ? ` · ${days === 0 ? 'aujourd’hui !' : `dans ${plural(days, 'jour')}`}` : ''}` : 'Date à fixer'}
          ${ev.place ? `<br>📍 ${esc(ev.place)}` : ''}${ev.budget ? `<br>💶 Budget indicatif : ${eur(ev.budget)}` : ''}</p>
          ${d.organizer ? `<p class="small muted">Organisé par ${esc(d.organizer)}</p>` : ''}
          ${d.isOrganizer ? `<div class="row wrap"><a class="btn ghost sm" href="#/evenements/${ev.id}/modifier">Modifier</a><button class="btn danger-t sm" data-a="event-del">Supprimer</button></div>` : ''}</header>
        ${santa}
        <section class="stack"><h2>Qui a déjà de quoi ?</h2><p class="small muted">Cadeaux réservés par destinataire (tes propres cadeaux ne sont jamais comptés).</p>
          <div class="people">${d.coverage.length ? d.coverage.map((c) => `<div class="card row">${avatar(c, 'sm')}<span class="grow"><b>${esc(c.name)}</b><span class="meta">${c.lists ? plural(c.gifts, 'cadeau', 'cadeaux') : 'pas de liste'}</span></span></div>`).join('') : empty('Aucun autre participant.')}</div></section>
        <section class="stack"><div class="between"><h2>Listes de l’événement</h2>${d.isParticipant ? `<a class="link" href="#/listes/nouvelle/evenement/${ev.id}">+ Ma liste</a>` : ''}</div>
          ${d.lists.length ? d.lists.map(listCard).join('') : empty('Aucune liste rattachée. Chacun peut y rattacher la sienne (création ou réglages de la liste).')}</section>
        <section class="stack"><h2>Participants (${d.participants.length})</h2><div class="row wrap">${d.participants.map((p) => `<span class="row small">${avatar(p, 'sm')}${esc(p.name)}</span>`).join('')}</div></section>
      </div>`,
    };
  },
});
on('click', 'santa-enable', async () => { const id = S.data.event.id; if (await attempt(() => post(`events/${id}/santa`))) go(`#/evenements/${id}/secret-santa`); });
on('click', 'event-del', async () => {
  if (!(await confirmSheet({ title: 'Supprimer l’événement ?', text: 'Les listes rattachées sont conservées ; le Secret Santa est supprimé.', ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(`events/${S.data.event.id}`))) go('#/evenements');
});

// ---------- Organisation du Secret Santa (organisateur) ----------
define('evenements/:id/secret-santa', {
  load: (p) => get(`events/${p.id}/santa`),
  view: (d) => {
    const s = d.draw;
    const openedCount = d.opened.filter((o) => o.opened).length;
    const sel = (name, k) => `<select name="${name}" class="grow">${d.members.map((m, i) => `<option value="${m.id}" ${i === k ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`;
    return {
      title: 'Secret Santa', sub: d.event.title, back: `#/evenements/${d.event.id}`, tab: 'evenements',
      body: `<div class="stack-lg">
        <p class="banner info">🔒 <span>En tant qu’organisateur, tu ne vois <b>jamais</b> qui offre à qui : seulement qui a ouvert son enveloppe.</span></p>
        <form class="card stack" data-f="santa-settings"><h2>Réglages</h2>
          <div class="grid2"><label>Budget (€)<input name="budget" inputmode="decimal" value="${esc(eurInput(s.budget))}"></label>
            <label>Date limite<input name="deadline" type="date" value="${esc(s.deadline || '')}"></label></div>
          <label class="check"><input type="checkbox" name="avoidPrevious" ${s.avoidPrevious ? 'checked' : ''}> Pas la même personne que lors du tirage précédent</label>
          <button class="btn">Enregistrer</button></form>
        <section class="card stack"><h2>Exclusions</h2>
          <p class="small muted">Couples, frères et sœurs… ces paires ne se tireront pas mutuellement. Un enfant sans compte ne tire jamais l’un de ses gestionnaires.</p>
          ${d.exclusions.map((x) => `<div class="between"><span>${esc(x.label)}</span><button class="linkbtn" data-a="excl-del" data-x="${x.a}" data-y="${x.b}">retirer</button></div>`).join('')}
          ${d.members.length >= 2 ? `<form class="row" data-f="excl-add">${sel('a', 0)}<span>↔</span>${sel('b', 1)}<button class="btn sm">Ajouter</button></form>` : ''}</section>
        <section class="card stack"><h2>Tirage</h2>
          ${s.status === 'drawn' ? `<p>Tirage effectué. Enveloppes ouvertes : <b>${openedCount} / ${d.opened.length}</b></p>
            ${d.outdated ? '<p class="banner err">Les participants ont changé depuis le tirage : relance-le.</p>' : ''}
            <ul class="small">${d.opened.map((o) => `<li>${esc(o.name)} — ${o.opened ? '✉️ ouverte' : 'pas encore ouverte'}</li>`).join('')}</ul>`
            : `<p class="muted">${plural(d.members.length, 'participant')}. Chacun recevra une autre personne, jamais lui-même, en respectant les exclusions.</p>`}
          <button class="btn plum wide" data-a="santa-draw">${s.status === 'drawn' ? 'Relancer le tirage' : 'Lancer le tirage au sort'}</button></section>
        <button class="btn danger-t" data-a="santa-disable">Désactiver le Secret Santa</button>
      </div>`,
    };
  },
});
const evId = () => S.data.event.id;
on('submit', 'santa-settings', async (form, f) => { if (await attempt(() => patch(`events/${evId()}/santa`, f))) toast('Réglages enregistrés'); });
on('submit', 'excl-add', async (form, f) => { if (await attempt(() => post(`events/${evId()}/santa/exclusions`, { a: Number(f.a), b: Number(f.b) }))) reload(); });
on('click', 'excl-del', async (el) => { if (await attempt(() => del(`events/${evId()}/santa/exclusions/${el.dataset.x}/${el.dataset.y}`))) reload(); });
on('click', 'santa-draw', async () => {
  const opened = S.data.opened.some((o) => o.opened);
  if (opened && !(await confirmSheet({ title: 'Refaire le tirage ?', text: 'Des enveloppes ont déjà été ouvertes. Toutes les attributions changeront et tous les participants seront prévenus.', ok: 'Refaire le tirage', danger: true }))) return;
  const r = await attempt(() => post(`events/${evId()}/santa/draw`, { force: opened }));
  if (r) { toast(r.redraw ? 'Nouveau tirage effectué' : 'Tirage effectué : les enveloppes sont prêtes !'); reload(); }
});
on('click', 'santa-disable', async () => {
  if (!(await confirmSheet({ title: 'Désactiver le Secret Santa ?', text: 'Les attributions et les messages seront perdus.', ok: 'Désactiver', danger: true }))) return;
  if (await attempt(() => del(`events/${evId()}/santa`, { force: true }))) go(`#/evenements/${evId()}`);
});

// ---------- Enveloppe (donateur) et messages recus (cible) ----------
const thread = (msgs, mine) => msgs.map((m) => `<p class="msg ${m.direction === mine ? 'me' : ''}"><b>${m.direction === 'question' ? (mine === 'question' ? 'Toi' : 'Ton Secret Santa') : (mine === 'reply' ? 'Toi' : 'Réponse')}</b> ${esc(m.body)}</p>`).join('');

define('evenements/:id/enveloppe', {
  load: (p) => get(`events/${p.id}/envelope`),
  view: (d) => {
    const env = d.envelopes.map((e) => {
      const head = e.forName ? `<p class="tag">Enveloppe de ${esc(e.forName)}</p>` : '';
      if (!e.opened) {
        return `<section class="stack">${head}<button class="env-big" data-a="env-open" data-id="${e.pairId}"><span class="flap"></span><span class="seal">SS</span><span class="cta">Ouvrir l’enveloppe</span></button>
          <p class="small muted center">Personne d’autre ne la verra, pas même l’organisateur.</p></section>`;
      }
      return `<section class="card stack reveal">${head}<p class="muted">${e.forName ? `${esc(e.forName)} offre` : 'Tu offres'} un cadeau à</p>
        <div class="row">${avatar(e.receiver, 'lg')}<b class="target">${esc(e.receiver.name)}</b></div>
        ${d.draw && (d.draw.budget || d.draw.deadline) ? `<p class="small">${d.draw.budget ? `Budget ${eur(d.draw.budget)}` : ''}${d.draw.deadline ? ` · avant le ${fmtDate(d.draw.deadline)}` : ''}</p>` : ''}
        ${e.lists.length ? `<div class="stack tight">${e.lists.map((l) => `<a class="card row" href="#/listes/${l.id}"><span class="cover">${esc(l.cover)}</span><b class="grow">${esc(l.title)}</b>→</a>`).join('')}</div>` : `<p class="small muted">${esc(e.receiver.name)} n’a pas encore de liste.</p>`}
        <details ${e.messages.length ? 'open' : ''}><summary>✉️ Poser une question anonyme</summary><div class="stack tight">
          ${thread(e.messages, 'question')}
          <form class="row" data-f="santa-msg" data-id="${e.pairId}" data-dir="question"><input name="body" maxlength="1000" placeholder="Ta pointure ? Ta couleur préférée ?" required class="grow"><button class="btn sm">Envoyer</button></form></div></details></section>`;
    }).join('');
    const received = d.received.filter((r) => r.messages.length).map((r) => `<section class="card stack"><h2>Questions de ${r.forName ? `Secret Santa de ${esc(r.forName)}` : 'ton Secret Santa'}</h2>
      ${thread(r.messages, 'reply')}
      <form class="row" data-f="santa-msg" data-id="${r.pairId}" data-dir="reply"><input name="body" maxlength="1000" placeholder="Ta réponse" required class="grow"><button class="btn sm">Répondre</button></form></section>`).join('');
    return {
      title: 'Secret Santa', sub: d.event.title, back: `#/evenements/${d.event.id}`, tab: 'evenements',
      body: `<div class="stack-lg">${d.draw && d.draw.status === 'drawn' ? '' : '<p class="banner info">🎅 <span>Le tirage n’a pas encore eu lieu.</span></p>'}
        ${env || (d.draw && d.draw.status === 'drawn' ? empty('Tu ne participes pas à ce tirage.') : '')}${received}</div>`,
    };
  },
});
on('click', 'env-open', async (el) => {
  el.classList.add('opening');
  await new Promise((r) => setTimeout(r, 600));
  if (await attempt(() => post(`santa-pairs/${el.dataset.id}/open`))) reload();
});
on('submit', 'santa-msg', async (form, f) => {
  if (await attempt(() => post(`santa-pairs/${form.dataset.id}/messages`, { direction: form.dataset.dir, body: f.body }))) { toast('Message envoyé'); reload(); }
});
