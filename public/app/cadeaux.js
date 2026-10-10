// Mes cadeaux : budget (par evenement, par personne) et historique de ce que j'ai offert.
import { esc, on, eur, fmtDate, avatar, plural } from './ui.js';
import { get } from './api.js';
import { S, render } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

const sum = (xs) => xs.reduce((s, x) => s + (x.cost || 0), 0);
const unknown = (xs) => xs.filter((x) => x.cost == null).length;
const total = (xs) => `${eur(sum(xs)) || '0 €'}${unknown(xs) ? ` <span class="muted small">+ ${plural(unknown(xs), 'prix inconnu', 'prix inconnus')}</span>` : ''}`;

define('mes-cadeaux', {
  load: () => get('my-gifts'),
  view: (gifts) => {
    const years = [...new Set(gifts.map((g) => g.year))].sort((a, b) => b - a);
    const year = S.q.giftYear && years.includes(S.q.giftYear) ? S.q.giftYear : years[0];
    const ofYear = gifts.filter((g) => g.year === year);
    const byEvent = [...Map.groupBy(ofYear, (g) => (g.event ? `e${g.event.id}` : `l${g.list.id}`)).values()];
    const byPerson = [...Map.groupBy(ofYear, (g) => g.recipient.id).values()].sort((a, b) => sum(b) - sum(a));
    return {
      title: 'Mes cadeaux', back: '#/', tab: '',
      body: !gifts.length ? empty('Tu n’as encore rien réservé.') : `<div class="stack-lg">
        <div class="chips" role="group" aria-label="Année">${years.map((y) => `<button class="chip" data-a="gift-year" data-v="${y}" aria-pressed="${y === year}">${y}</button>`).join('')}</div>
        <section class="card stack"><div class="between"><h2>Budget ${year}</h2><b class="big-total">${total(ofYear)}</b></div>
          <p class="small muted">Prix indicatifs des articles réservés (× quantité) et tes parts de cadeaux communs. Visible de toi seul.</p></section>
        <section class="stack"><h2>Par événement</h2>${byEvent.map((gs) => {
          const e = gs[0].event;
          const over = e && e.budget && sum(gs) > e.budget * new Set(gs.map((g) => g.recipient.id)).size;
          return `<div class="card between"><span><b>${esc(e ? e.title : gs[0].list.title)}</b><span class="meta">${e && e.date ? fmtDate(e.date) : ''}${e && e.budget ? ` · budget indicatif ${eur(e.budget)} par personne` : ''}</span></span><span class="${over ? 'over' : ''}">${total(gs)}</span></div>`;
        }).join('')}</section>
        <section class="stack"><h2>Par personne</h2>${byPerson.map((gs) => `<div class="card between"><span class="row">${avatar(gs[0].recipient, 'sm')}<b>${esc(gs[0].recipient.name)}</b></span><span>${total(gs)}</span></div>`).join('')}</section>
        <section class="stack"><h2>Historique ${year}</h2>${ofYear.map((g) => `<a class="card res-row" href="#/listes/${g.list.id}">
          <span class="grow"><b>${esc(g.title)}</b><span class="meta">pour ${esc(g.recipient.name)}${g.forName ? ` · de la part de ${esc(g.forName)}` : ''} · ${esc(g.event ? g.event.title : g.list.title)}${g.participation ? ' · part commune' : g.quantity > 1 ? ` · × ${g.quantity}` : ''}</span></span>
          <span class="stack tight end-col">${g.cost != null ? `<span class="price">${eur(g.cost)}</span>` : ''}<span class="pill ${g.received ? 'p-free' : g.status === 'bought' ? 'p-buy' : 'p-res'}">${g.received ? 'reçu 🎉' : g.status === 'bought' ? 'acheté' : 'à acheter'}</span></span></a>`).join('')}</section>
      </div>`,
    };
  },
});
on('click', 'gift-year', (el) => { S.q.giftYear = Number(el.dataset.v); render(); });
