// Installation de l'app (PWA) : invite du navigateur quand il en propose une (Android,
// Chrome / Edge sur PC), sinon la marche a suivre (iPhone : Safari > Partager).
import { esc, on, sheet, toast } from './ui.js';
import { render } from './state.js';

let deferred = null; // invite d'installation retenue par le navigateur
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; render(); });
window.addEventListener('appinstalled', () => { deferred = null; toast('App installée sur l’écran d’accueil'); render(); });

export const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

// Carte « Installer l'app », rien si l'app tourne deja installee.
const dismissed = () => { try { return localStorage.getItem('kdo-install-hidden') === '1'; } catch { return false; } };
export const installCard = () => (isInstalled() || dismissed() ? '' : `<div class="card row install"><img src="icon-192.png" alt="" width="36" height="36">
  <button class="grow linkish" data-a="install"><b>Installer l’app</b><span class="meta">Icône sur l’écran d’accueil, notifications, partage de liens</span></button>
  <button class="icon" data-a="install-hide" aria-label="Masquer">✕</button></div>`);
on('click', 'install-hide', () => { try { localStorage.setItem('kdo-install-hidden', '1'); } catch { /* rien */ } render(); });

const step = (n, html) => `<div class="row top"><span class="pill p-buy">${n}</span><span class="grow">${html}</span></div>`;

on('click', 'install', async () => {
  if (deferred) {
    const d = deferred;
    deferred = null;
    d.prompt();
    const r = await d.userChoice.catch(() => null);
    if (!r || r.outcome !== 'accepted') toast('Installation annulée : tu pourras la relancer d’ici');
    render();
    return;
  }
  const safari = isIos() && !/crios|fxios|edgios/i.test(navigator.userAgent);
  const steps = isIos()
    ? (safari ? '' : step(0, 'Ouvre cette page dans <b>Safari</b> (sur iPhone, seul Safari sait installer une app web).'))
      + step(1, 'Touche le bouton <b>Partager</b> <span class="muted">(carré avec une flèche vers le haut)</span>.')
      + step(2, 'Choisis <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>.')
    : isAndroid()
      ? step(1, 'Ouvre le menu <b>⋮</b> du navigateur.') + step(2, 'Choisis <b>Installer l’application</b> ou <b>Ajouter à l’écran d’accueil</b>.')
      : step(1, 'Dans Chrome ou Edge : icône d’installation <b>⊕</b> à droite de la barre d’adresse.')
        + step(2, 'Sur téléphone, ouvre plutôt cette adresse :<br><code>' + esc(location.href.split('#')[0]) + '</code>');
  sheet(`<h3>📲 Installer l’app</h3><div class="stack">${steps}</div>`);
});
