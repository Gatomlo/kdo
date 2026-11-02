// Plateforme (administrateur global) : les cercles familiaux indépendants de l'installation.
import { esc, on, toast, sheet, confirmSheet, plural } from './ui.js';
import { get, post, patch, del, attempt } from './api.js';
import { reload } from './state.js';
import { define } from './router.js';
import { empty, linkSheet } from './cards.js';

define('plateforme', {
  load: () => get('platform/circles'),
  view: (circles) => ({
    title: 'Plateforme', sub: 'Cercles familiaux indépendants', back: '#/reglages', tab: 'cercle',
    body: `<div class="stack-lg"><section class="stack">
      <p class="small muted">Chaque cercle est étanche : ses membres, listes, événements et tirages ne sont visibles que de lui. Tu crées le cercle, puis tu transmets le lien à son futur administrateur, qui invite ensuite sa famille. Tu ne vois que des comptages, jamais le contenu.</p>
      ${circles.length ? circles.map((c) => `<div class="card stack tight"><div class="between"><span><b>${esc(c.name)}</b>${c.mine ? ' <span class="pill p-mgr">mon cercle</span>' : ''}
        <span class="meta">${plural(c.members, 'membre')} · ${plural(c.profiles, 'profil')} sans compte${c.admins ? ` · admin : ${esc(c.admins)}` : ''}</span></span></div>
        ${c.pendingAdmin ? '<p class="small muted">⏳ Lien d’administrateur en attente d’utilisation.</p>' : ''}
        <div class="row wrap"><button class="btn sm" data-a="circle-admin-link" data-id="${c.id}">🔑 Lien administrateur</button>
          <button class="btn ghost sm" data-a="circle-rename" data-id="${c.id}" data-name="${esc(c.name)}">Renommer</button>
          ${c.mine ? '' : `<button class="btn danger-t sm" data-a="circle-delete" data-id="${c.id}" data-name="${esc(c.name)}">Supprimer</button>`}</div></div>`).join('') : empty('Aucun cercle.')}
      <button class="btn main" data-a="circle-new">＋ Nouveau cercle</button>
    </section></div>`,
  }),
});

on('click', 'circle-new', () => {
  sheet(`<h3>Nouveau cercle</h3><form class="stack" data-f="circle-new">
    <label>Nom du cercle<input name="name" required maxlength="60" placeholder="Famille Dupont"></label>
    <p class="small muted">Tu obtiendras un lien à transmettre à la personne qui sera administratrice du cercle.</p>
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Créer</button></div></form>`);
});
on('submit', 'circle-new', async (form, f) => {
  const r = await attempt(() => post('platform/circles', { name: f.name }));
  if (r) { reload(); linkSheet('Lien administrateur', r.url, 'À transmettre à la personne qui administrera ce cercle. Valable 14 jours, utilisable une seule fois.'); }
});
on('click', 'circle-admin-link', async (el) => {
  const r = await attempt(() => post(`platform/circles/${el.dataset.id}/admin-link`));
  if (r) { reload(); linkSheet('Lien administrateur', r.url, 'Crée un compte administrateur dans ce cercle. Valable 14 jours, utilisable une seule fois.'); }
});
on('click', 'circle-rename', (el) => {
  sheet(`<h3>Renommer le cercle</h3><form class="stack" data-f="circle-rename" data-id="${esc(el.dataset.id)}">
    <label>Nom<input name="name" required maxlength="60" value="${esc(el.dataset.name)}"></label>
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Enregistrer</button></div></form>`);
});
on('submit', 'circle-rename', async (form, f) => {
  if (await attempt(() => patch(`platform/circles/${form.dataset.id}`, { name: f.name }))) { document.querySelector('.sheet-bg')?.remove(); reload(); }
});
on('click', 'circle-delete', async (el) => {
  if (!(await confirmSheet({ title: `Supprimer « ${el.dataset.name} » ?`, text: 'Tous ses membres, listes, réservations et événements seront effacés définitivement.', ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(`platform/circles/${el.dataset.id}`))) { toast('Cercle supprimé'); reload(); }
});
