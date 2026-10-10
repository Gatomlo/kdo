// Journal de l'administrateur : chiffres du cercle, invitations en attente (annulables),
// listes partagees hors cercle, activite recente (sans aucun contenu de cadeau).
import { esc, on, toast, confirmSheet } from './ui.js';
import { get, del, attempt } from './api.js';
import { reload } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

const when = (t) => new Date(t).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ICON = { setup: '🏠', join: '👋', guest: '🔗', invite: '✉️', remove: '🚪', share: '🔗', santa: '🎅', settings: '⚙️', birthday: '🎂' };

define('journal', {
  load: () => get('admin/journal'),
  view: (j) => ({
    title: 'Journal', sub: 'Administration du cercle', back: '#/reglages', tab: 'cercle',
    body: `<div class="stack-lg">
      <div class="stats">${[['Membres', j.counts.members], ['Profils sans compte', j.counts.profiles], ['Invités hors cercle', j.counts.guests], ['Appareils notifiés', j.counts.devices]]
        .map(([l, n]) => `<div class="card"><b>${n}</b><span class="meta">${l}</span></div>`).join('')}</div>
      <section class="stack"><h2>Invitations en attente</h2>
        ${j.invitations.length ? j.invitations.map((i) => `<div class="card between"><span><b>${esc(i.email || (i.profileName ? `Compte pour ${i.profileName}` : 'Lien sans adresse'))}</b>
          <span class="meta">par ${esc(i.inviter || '?')} · expire le ${when(i.expiresAt)}${i.isAdmin ? ' · admin' : ''}</span></span>
          <button class="btn danger-t sm" data-a="inv-cancel" data-id="${esc(i.id)}">Annuler</button></div>`).join('') : empty('Aucune invitation en attente.')}</section>
      <section class="stack"><h2>Listes partagées hors cercle</h2>
        ${j.shares.length ? j.shares.map((l) => `<a class="card between" href="#/listes/${l.id}"><span><b>${esc(l.title)}</b><span class="meta">${esc(l.owner)} · ${l.guests} invité${l.guests > 1 ? 's' : ''}</span></span>${l.protected ? '<span class="pill p-free">🔒 mot de passe</span>' : '<span class="pill p-res">sans mot de passe</span>'}</a>`).join('') : empty('Aucune liste partagée.')}</section>
      <section class="stack"><h2>Activité</h2>
        ${j.activity.length ? `<ul class="journal">${j.activity.map((a) => `<li><span>${ICON[a.kind] || '•'}</span><span class="grow">${esc(a.text)}${a.actor ? ` <span class="muted">— ${esc(a.actor)}</span>` : ''}</span><time class="muted">${when(a.at)}</time></li>`).join('')}</ul>` : empty('Rien pour l’instant.')}</section>
    </div>`,
  }),
});
on('click', 'inv-cancel', async (el) => {
  if (!(await confirmSheet({ title: 'Annuler l’invitation ?', text: 'Le lien ne permettra plus de créer de compte.', ok: 'Annuler l’invitation', danger: true }))) return;
  if (await attempt(() => del(`admin/invitations/${el.dataset.id}`))) { toast('Invitation annulée'); reload(); }
});
