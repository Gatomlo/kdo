// Point d'entree : connexion (mot de passe, invitation, lien e-mail), navigation par #,
// cadre de l'ecran (en-tete, navigation en bas).
import { esc, on, toast, avatar } from './ui.js';
import { get, post, ApiError } from './api.js';
import { S, setReloader, setRenderer, go } from './state.js';
import { match } from './router.js';
import { loginView, setPending, loadOptions, loadInvitation, resetPending, loadShare, sharePending, guestJoinView } from './connexion.js';
import './install.js'; // tot : retient l'invite d'installation du navigateur
import './accueil.js';
import './listes.js';
import './evenements.js';
import './cercle.js';
import './idees.js';
import './cadeaux.js';
import './recherche.js';
import './journal.js';

const app = document.getElementById('app');

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
};

// Affichage memorise sur l'appareil : texte agrandi, vue simplifiee (aines, invites).
function applyDisplay() {
  const root = document.documentElement;
  try {
    root.classList.toggle('big', localStorage.getItem('kdo-big') === '1');
    root.classList.toggle('simple', localStorage.getItem('kdo-simple') === '1');
  } catch { /* stockage indisponible */ }
}
applyDisplay();
export function toggleDisplay(key) {
  try { localStorage.setItem(key, localStorage.getItem(key) === '1' ? '0' : '1'); } catch { /* idem */ }
  applyDisplay();
}
on('click', 'big-text', () => toggleDisplay('kdo-big'));
on('change', 'display', (el) => toggleDisplay(el.dataset.k));

const NAV = [
  ['', 'Accueil', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
  ['listes', 'Listes', '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'],
  ['evenements', 'Événements', '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
  ['cercle', 'Cercle', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c1.9.7 3 2.4 3.5 5.2"/>'],
];

function shell(v) {
  const tab = v.tab ?? S.route[0] ?? '';
  const nav = v.noNav || (S.me && S.me.guest) ? '' : `<nav class="tabs" aria-label="Navigation principale">${NAV.map(([k, t, svg]) => `<a href="#/${k}" ${tab === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg><span>${t}</span></a>`).join('')}</nav>`;
  const me = !S.me || v.noNav ? '' : S.me.guest
    ? `<button class="icon" data-a="big-text" aria-label="Agrandir le texte" title="Agrandir le texte">Aa</button><span class="row small">${avatar(S.me, 'sm')}${esc(S.me.name)}</span><button class="btn ghost sm" data-a="logout">Ce n’est pas moi</button>`
    : `<a href="#/recherche" class="icon" aria-label="Rechercher" title="Rechercher">${ICONS.search}</a><a href="#/moi" class="me" aria-label="Mon compte">${avatar(S.me)}</a>`;
  // Reglages de l'ecran (liste, evenement, cercle) : icone dans l'en-tete.
  const gear = v.settings ? `<a href="${esc(v.settings)}" class="icon" aria-label="Réglages" title="Réglages">${ICONS.gear}</a>` : '';
  // Bouton d'ajout flottant (au-dessus de la navigation sur telephone).
  const fab = v.fab ? (v.fab.href
    ? `<a class="fab" href="${esc(v.fab.href)}">${ICONS.plus}<span>${esc(v.fab.label)}</span></a>`
    : `<button class="fab" data-a="${esc(v.fab.action)}">${ICONS.plus}<span>${esc(v.fab.label)}</span></button>`) : '';
  app.className = 'shell' + (v.noNav || (S.me && S.me.guest) ? ' nonav' : '');
  const header = v.noNav && !v.title ? '' : `<header class="top">${v.back ? `<a class="back" href="${esc(v.back)}" aria-label="Retour">‹</a>` : ''}
      ${v.title ? `<h2>${esc(v.title)}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</h2>` : '<a class="brand" href="#/">K<i>do</i></a>'}
      ${v.right || ''}${gear}${me}</header>`;
  app.innerHTML = `${header}<main id="view" tabindex="-1">${v.body}</main>${fab}${nav}`;
  document.title = v.title ? `${v.title} · Kdo` : 'Kdo';
}

let current = null; // { route, params }

async function load() {
  const path = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  const sp = sharePending();
  if (sp && sp.go) { go(sp.go); return; }
  if (sp) { S.route = ['partage']; shell(guestJoinView()); return; }
  if (!S.me || resetPending()) { S.route = ['login']; shell(loginView()); return; }
  // Invite externe : sa liste seulement.
  if (S.me.guest && path !== `listes/${S.me.listId}`) { go(`#/listes/${S.me.listId}`); return; }
  current = match(path);
  if (!current) { go('#/'); return; }
  S.route = path.split('/');
  try {
    S.data = current.route.load ? await current.route.load(current.params) : null;
    shell(current.route.view(S.data, current.params));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { location.href = './'; return; }
    shell({ title: 'Oups', back: '#/', body: `<div class="card error">${esc(e.message)}</div>` });
  }
}

// Apres une action : on recharge les donnees et on garde le defilement.
setReloader(async () => {
  const y = window.scrollY;
  await load();
  window.scrollTo(0, y);
});
setRenderer(() => {
  const y = window.scrollY;
  if (S.route[0] === 'partage') shell(guestJoinView());
  else if (!S.me || resetPending()) shell(loginView());
  else if (current) shell(current.route.view(S.data, current.params));
  window.scrollTo(0, y);
});

window.addEventListener('hashchange', () => { load().then(() => window.scrollTo(0, 0)); });
on('click', 'go', (el) => go(el.dataset.to));

// Mode clair / sombre (memorise sur l'appareil).
on('click', 'theme', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('kdo-theme', root.dataset.theme); } catch { /* stockage indisponible */ }
});
try { const th = localStorage.getItem('kdo-theme'); if (th) document.documentElement.dataset.theme = th; } catch { /* idem */ }

// Application installable (voir sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Demarrage ----------
async function boot() {
  const params = new URLSearchParams(location.search);
  const login = params.get('login');
  setPending({ invite: params.get('invite'), reset: params.get('reset'), share: params.get('partage') });
  // Page partagee depuis le telephone vers l'app installee (manifest share_target) :
  // le lien est parfois seul dans « texte ».
  const sharedText = `${params.get('texte') || ''} ${params.get('partage-url') || ''}`;
  const sharedUrl = params.get('partage-url') || (sharedText.match(/https?:\/\/\S+/) || [])[0];
  if (sharedUrl) { S.q.shared = { url: sharedUrl, title: params.get('titre') || '' }; location.hash = '#/ajouter'; }
  if (login || params.get('invite') || params.get('reset') || params.get('partage') || sharedUrl) history.replaceState(null, '', location.pathname + location.hash);
  await loadOptions();
  let loginError = null;
  if (login) {
    try { S.me = await post('auth/verify', { token: login }); } catch (e) { loginError = e.message; }
  }
  if (!S.me) S.me = await get('me').catch(() => null);
  await Promise.all([loadInvitation(), loadShare()]);
  await load();
  if (loginError && !S.me) toast(loginError, true);
}
boot();

export { load };
