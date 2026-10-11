// Cartes reutilisees par plusieurs ecrans : liste, evenement.
import { esc, avatar, fmtDate, plural, sheet, on } from './ui.js';
import { get } from './api.js';

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

// Lien a transmettre, avec son QR code (a scanner avec l'appareil photo du telephone).
// shareText : propose aussi le partage du telephone (« Envoyer… ») quand il existe.
export const linkSheet = (title, url, text, shareText) => {
  const send = shareText && navigator.share ? `<button class="btn ghost" data-a="share-native" data-url="${esc(url)}" data-text="${esc(shareText)}">Envoyer…</button>` : '';
  sheet(`<h3>${esc(title)}</h3><p class="muted small">${text}</p>
  <div class="qr" id="qr" aria-label="QR code du lien"></div>
  <input readonly value="${esc(url)}" class="select-all"><div class="row end wrap"><button class="btn ghost" data-a="close-sheet">Fermer</button>${send}<button class="btn main" data-a="copy" data-text="${esc(url)}">Copier le lien</button></div>`);
  get(`qr?text=${encodeURIComponent(url)}`).then((r) => { const el = document.getElementById('qr'); if (el) el.innerHTML = r.svg; }, () => {});
};
on('click', 'share-native', (el) => navigator.share({ text: el.dataset.text, url: el.dataset.url }).catch(() => {}));
