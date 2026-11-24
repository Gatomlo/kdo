// Mes abonnements : listes et personnes suivies, rythme des notifications, tout désabonner.
import { esc, on, toast, confirmSheet } from './ui.js';
import { get, put, del, attempt } from './api.js';
import { reload } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

const CHOICES = [['both', 'Tout'], ['add', 'Nouveaux cadeaux'], ['taken', 'Cadeaux pris'], ['off', 'Ne plus suivre']];
const DIGEST = [['instant', 'Tout de suite'], ['daily', 'Un récap par jour'], ['weekly', 'Un récap par semaine']];
const select = (name, id, cur, choices) => `<select data-ch="${name}" data-id="${id}" aria-label="Notifications">${choices.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

define('abonnements', {
  load: () => get('follows'),
  view: (d) => ({
    title: 'Mes abonnements', sub: 'Être prévenu·e des nouveaux cadeaux et des cadeaux pris', back: '#/moi', tab: '',
    body: `<div class="stack-lg">
      <section class="card stack"><h2>⏰ Rythme</h2>
        <label>Quand être prévenu·e ?${select('fol-digest', 0, d.digest, DIGEST)}</label>
        <p class="small muted">Avec un récap, les nouveaux cadeaux et les cadeaux pris sont regroupés dans un seul message. Une suppression d’article est toujours envoyée tout de suite.</p></section>
      <section class="stack"><h2>👤 Personnes suivies</h2>
        ${d.people.length ? d.people.map((p) => `<div class="card between"><span><b>${esc(p.name)}</b><span class="meta">Toutes ses listes, y compris les prochaines</span></span>${select('fol-person', p.id, p.events, CHOICES)}</div>`).join('')
          : empty('Aucune personne suivie. Depuis une liste : 🔔 puis « Suivre toutes les listes de… ».')}</section>
      <section class="stack"><h2>📋 Listes suivies</h2>
        ${d.lists.length ? d.lists.map((l) => `<div class="card between"><span><a href="#/listes/${l.id}"><b>${esc(l.cover)} ${esc(l.title)}</b></a>
          <span class="meta">${esc(l.ownerName)}${l.viaPerson ? ' · via la personne' : ''}${l.archived ? ' · archivée' : ''}</span></span>${select('fol-list', l.id, l.events, CHOICES)}</div>`).join('')
          : empty('Aucune liste suivie.')}</section>
      ${d.lists.length || d.people.length ? '<button class="btn danger-t" data-a="fol-clear">Tout désabonner</button>' : ''}
    </div>`,
  }),
});
on('change', 'fol-digest', async (el) => { if (await attempt(() => put('follows/digest', { mode: el.value }))) { toast('Enregistré'); reload(); } });
on('change', 'fol-list', async (el) => { if (await attempt(() => put(`lists/${el.dataset.id}/follow`, { events: el.value }))) { toast('Enregistré'); reload(); } });
on('change', 'fol-person', async (el) => { if (await attempt(() => put(`members/${el.dataset.id}/follow`, { events: el.value }))) { toast('Enregistré'); reload(); } });
on('click', 'fol-clear', async () => {
  if (!(await confirmSheet({ title: 'Tout désabonner ?', text: 'Tu ne recevras plus aucune notification de listes suivies.', ok: 'Tout désabonner', danger: true }))) return;
  if (await attempt(() => del('follows'))) { toast('Abonnements supprimés'); reload(); }
});
