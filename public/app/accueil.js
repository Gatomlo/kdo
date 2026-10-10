// Tableau de bord : mon Secret Santa, evenements a venir, mes reservations, la famille.
import { esc, eur, avatar, fmtDate, on } from './ui.js';
import { get } from './api.js';
import { S, render } from './state.js';
import { define } from './router.js';
import { listCard, eventRow, empty } from './cards.js';
import { installCard } from './install.js';

// Premiers pas : disparaissent quand tout est fait ou si on les masque (par appareil).
const stepsHidden = () => { try { return localStorage.getItem('kdo-steps-hidden') === '1'; } catch { return false; } };
function firstSteps(s) {
  const steps = [
    [s.birthday, '🎂 Ajoute ton anniversaire', '#/moi'],
    [s.fiche, '📏 Remplis ta fiche tailles', `#/fiche/${S.me.id}`],
    [s.list, '🎁 Crée ta première liste', '#/listes/nouvelle'],
    [s.idea, '💡 Note une idée secrète pour quelqu’un', '#/cercle'],
  ];
  const done = steps.filter(([d]) => d).length;
  if (done === steps.length || stepsHidden()) return '';
  return `<section class="card stack tight"><div class="between"><h2>Premiers pas</h2><span class="pill p-mgr">${done}/${steps.length}</span></div>
    ${steps.map(([d, label, href]) => (d ? `<p class="small muted">✅ <s>${label.slice(label.indexOf(' ') + 1)}</s></p>` : `<a class="link" href="${href}">${label} ›</a>`)).join('')}
    <button class="linkbtn small" data-a="steps-hide">Masquer</button></section>`;
}
on('click', 'steps-hide', () => { try { localStorage.setItem('kdo-steps-hidden', '1'); } catch { /* rien */ } render(); });

define('', {
  load: () => get('dashboard'),
  view: (d) => {
    const envelopes = d.envelopes.map((e) => `<a class="envelope" href="#/evenements/${e.eventId}/enveloppe">
      <span class="seal">${e.opened ? '✉️' : 'SS'}</span>
      <span><b>${e.forName ? `Enveloppe de ${esc(e.forName)}` : e.opened ? 'Mon Secret Santa' : 'Une enveloppe t’attend !'}</b><span>${esc(e.title)}${e.forName ? ` · ${e.opened ? 'ouverte' : 'à ouvrir'} (profil que tu gères)` : ''}</span></span></a>`).join('');
    const todo = d.reservations.filter((r) => r.status !== 'bought');
    const reservations = d.reservations.length
      ? `${d.reservations.map((r) => `<a class="card res-row" href="#/listes/${r.listId}">
          <span class="grow"><b>${esc(r.title)}</b><span class="meta">pour ${esc(r.ownerName)} · ${esc(r.listTitle)}${r.amount != null ? ` · ma part ${eur(r.amount)}${r.isCarrier ? ' (porteur)' : ''}` : r.quantity > 1 ? ` · × ${r.quantity}` : ''}</span></span>
          <span class="pill ${r.status === 'bought' ? 'p-buy' : 'p-res'}">${r.status === 'bought' ? 'acheté' : 'à acheter'}</span></a>`).join('')}`
      : empty('Tu n’as encore rien réservé. Va voir les listes de la famille !');
    // Un anniversaire dont l'evenement existe deja n'est pas affiche deux fois.
    const bdays = d.birthdays.filter((b) => !d.events.some((e) => e.title === `Anniversaire de ${b.name}` && e.date === b.date)).map((b) => `<div class="card row">${avatar(b, 'sm')}<span class="grow"><b>${b.id === S.me.id ? 'Ton anniversaire' : esc(b.name)}</b><span class="meta">${fmtDate(b.date, { weekday: 'long', day: 'numeric', month: 'long' })}${b.age ? ` · ${b.age} ans` : ''}</span></span>
      <span class="pill ${b.days <= 7 ? 'p-hide' : 'p-mgr'}">${b.days === 0 ? 'aujourd’hui 🎉' : b.days === 1 ? 'demain' : `dans ${b.days} j`}</span>${b.id !== S.me.id ? `<a class="btn ghost sm" href="#/idees/${b.id}" aria-label="Idées pour ${esc(b.name)}">💡</a>` : ''}</div>`).join('');
    const family = d.lists.filter((l) => l.role === 'viewer');
    const mine = d.lists.filter((l) => l.role !== 'viewer');
    return {
      title: '', tab: '',
      body: `<div class="stack-lg">
        <p class="hello">Bonjour ${esc(S.me.name)} 👋</p>
        ${firstSteps(d.steps)}
        ${envelopes ? `<section class="stack">${envelopes}</section>` : ''}
        <section class="stack"><div class="between"><h2>Événements à venir</h2><a class="link" href="#/evenements">Tout voir</a></div>
          ${d.events.length ? d.events.map(eventRow).join('') : empty('Aucun événement prévu. <a href="#/evenements/nouveau">En créer un</a>')}</section>
        ${bdays ? `<section class="stack"><h2>🎂 Anniversaires à venir</h2>${bdays}</section>` : ''}
        <section class="stack"><div class="between"><h2>Mes réservations</h2><a class="link" href="#/mes-cadeaux">${todo.length ? `${todo.length} à acheter · ` : ''}Budget ›</a></div>${reservations}</section>
        <section class="stack"><div class="between"><h2>La famille</h2><a class="link" href="#/listes">Toutes les listes</a></div>
          ${family.length ? family.map(listCard).join('') : empty('Personne n’a encore publié de liste.')}</section>
        <section class="stack"><div class="between"><h2>Mes listes</h2><a class="link" href="#/listes/nouvelle">+ Nouvelle</a></div>
          ${mine.length ? mine.map(listCard).join('') : empty('Crée ta première liste de souhaits.')}</section>
        ${installCard()}
      </div>`,
    };
  },
});
