// Cartes reutilisees par plusieurs ecrans : liste, evenement.
import { esc, avatar, fmtDate, plural } from './ui.js';

const ROLE = { owner: 'ma liste', co_owner: 'co-propriétaire', manager: 'je gère' };

export function listCard(l) {
  const g = l.gifts;
  const pill = g && g.total ? `<span class="pill ${g.taken >= g.total ? 'p-buy' : g.taken ? 'p-res' : 'p-free'}">${g.taken}/${g.total} pris</span>` : '';
  return `<a class="card lc" href="#/listes/${l.id}">
    <span class="cover" aria-hidden="true">${esc(l.cover)}</span>
    <span class="grow"><b class="nm">${l.surprise ? '<span title="Liste surprise : invisible pour la personne">🤫</span> ' : ''}${esc(l.title)}</b>
      <span class="meta">${avatar(l.owner, 'sm')} ${esc(l.owner.name)}${l.date ? ` · ${fmtDate(l.date, { day: 'numeric', month: 'short' })}` : ''} · ${plural(l.itemCount, 'article')}</span></span>
    ${ROLE[l.role] ? `<span class="pill p-mgr">${ROLE[l.role]}</span>` : ''}${pill}</a>`;
}

export function eventRow(e) {
  const d = e.date ? new Date(e.date + 'T12:00') : null;
  const other = d && d.getFullYear() !== new Date().getFullYear() ? ` · ${d.getFullYear()}` : '';
  return `<a class="card ev" href="#/evenements/${e.id}">
    <span class="date">${d ? `<b>${d.getDate()}</b><small>${esc(d.toLocaleDateString('fr-BE', { month: 'short' }).replace('.', ''))}</small>` : '<b>?</b>'}</span>
    <span class="grow"><b class="nm">${esc(e.title)}</b>
      <span class="meta">${e.place ? `${esc(e.place)} · ` : ''}${e.participants != null ? plural(e.participants, 'participant') : ''}${other}</span></span>
    ${e.santa ? '<span class="pill p-hide">🎅 Secret Santa</span>' : ''}</a>`;
}

export const empty = (text) => `<p class="empty">${text}</p>`;
