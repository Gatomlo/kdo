// Ecrans d'acces : connexion (mot de passe ; lien par e-mail si l'envoi est configure),
// creation du cercle (premier compte), compte cree par une invitation, nouveau mot de
// passe par un lien de reinitialisation.
import { esc, on, toast } from './ui.js';
import { get, post, attempt } from './api.js';
import { S, render, go } from './state.js';

const pending = { invite: null, invitation: null, reset: null, sent: null, mode: null, options: { mail: false, setup: false } };

export function setPending({ invite, reset }) { pending.invite = invite || null; pending.reset = reset || null; }
export const resetPending = () => !!pending.reset;
export async function loadOptions() {
  pending.options = await get('auth/options').catch(() => pending.options);
}
export async function loadInvitation() {
  if (!pending.invite) return;
  pending.invitation = await get(`invitations/${encodeURIComponent(pending.invite)}`).catch(() => null);
  if (!pending.invitation) { toast('Invitation expirée ou déjà utilisée.', true); pending.invite = null; }
}

const field = (name, label, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
const pwd = (name, label, auto) => field(name, label, 'password', `autocomplete="${auto}" minlength="8" required`);

export function loginView() {
  const inv = pending.invitation, o = pending.options;
  const mode = pending.reset ? 'reset' : o.setup ? 'setup' : pending.mode || (inv ? 'register' : 'login');
  let form;
  if (pending.sent) {
    form = `<h3>📧 Lien envoyé</h3><p class="muted">Si <b>${esc(pending.sent)}</b> fait partie du cercle, un lien de connexion vient d’y être envoyé (valable 15 minutes).</p>
      <button class="btn ghost" data-a="auth-mode" data-m="login">Retour</button>`;
  } else if (mode === 'reset') {
    form = `<h3>Choisir un nouveau mot de passe</h3>${pwd('password', 'Nouveau mot de passe (8 caractères minimum)', 'new-password')}${pwd('password2', 'Confirmer', 'new-password')}
      <button class="btn main wide">Enregistrer et me connecter</button>`;
  } else if (mode === 'setup') {
    form = `<h3>Créer le cercle familial</h3><p class="muted small">Aucun compte n’existe encore : le tien sera celui de l’administrateur du cercle. Tu inviteras ensuite la famille.</p>
      ${field('name', 'Ton prénom', 'text', 'autocomplete="given-name" required')}${field('email', 'Adresse e-mail (identifiant)', 'email', 'autocomplete="email" required')}
      ${pwd('password', 'Mot de passe (8 caractères minimum)', 'new-password')}${pwd('password2', 'Confirmer', 'new-password')}
      <button class="btn main wide">Créer le cercle</button>`;
  } else if (mode === 'register') {
    form = `<h3>${inv.profileName ? `Ton compte, ${esc(inv.profileName)}` : 'Créer mon compte'}</h3>
      ${field('name', 'Ton prénom', 'text', `autocomplete="given-name" required value="${esc(inv.profileName || '')}"`)}${field('email', 'Adresse e-mail (identifiant)', 'email', `autocomplete="email" required value="${esc(inv.email || '')}"`)}
      ${pwd('password', 'Mot de passe (8 caractères minimum)', 'new-password')}${pwd('password2', 'Confirmer', 'new-password')}
      <button class="btn main wide">Rejoindre le cercle</button>
      <p class="muted small">Déjà un compte ? <a href="#" data-a="auth-mode" data-m="login">Se connecter</a></p>`;
  } else if (mode === 'mail') {
    form = `<h3>Recevoir un lien de connexion</h3>${field('email', 'Adresse e-mail', 'email', 'autocomplete="email" required')}
      <button class="btn main wide">Recevoir le lien</button>
      <p class="muted small"><a href="#" data-a="auth-mode" data-m="login">Se connecter avec le mot de passe</a></p>`;
  } else {
    form = `<h3>Se connecter</h3>${field('email', 'Adresse e-mail', 'email', 'autocomplete="username" required')}
      ${field('password', 'Mot de passe', 'password', 'autocomplete="current-password" required')}
      <button class="btn main wide">Se connecter</button>
      ${inv ? '<p class="muted small">Pas encore de compte ? <a href="#" data-a="auth-mode" data-m="register">Créer mon compte</a></p>' : ''}
      ${o.mail ? '<p class="muted small"><a href="#" data-a="auth-mode" data-m="mail">Recevoir plutôt un lien par e-mail</a></p>' : ''}
      <p class="muted small">Mot de passe oublié : demande un lien de réinitialisation à l’administrateur du cercle.</p>`;
  }
  const invCard = inv && mode === 'register'
    ? `<p class="banner info">🎁 <span><b>${esc(inv.inviter || 'Quelqu’un')}</b> t’invite à rejoindre le cercle familial sur La Hotte${inv.profileName ? ` : ton profil « ${esc(inv.profileName)} » et ses listes deviennent les tiens` : ''}.</span></p>` : '';
  return {
    noNav: true, title: '',
    body: `<div class="hero"><div class="logo">🎁</div><h1>La <i>Hotte</i></h1><p class="muted">Les listes de cadeaux de la famille, sans spoiler.</p></div>
      ${invCard}<form class="card stack narrow" data-f="auth" data-m="${mode}">${form}</form>`,
  };
}

on('click', 'auth-mode', (el) => { pending.mode = el.dataset.m; pending.sent = null; render(); });
on('submit', 'auth', async (form, f) => {
  const m = form.dataset.m;
  if ((m === 'setup' || m === 'register' || m === 'reset') && f.password !== f.password2) { toast('Les deux mots de passe diffèrent.', true); return; }
  if (m === 'mail') {
    if (await attempt(() => post('auth/request', { email: f.email }))) { pending.sent = f.email; render(); }
    return;
  }
  const call = {
    login: () => post('auth/login', { email: f.email, password: f.password }),
    setup: () => post('auth/setup', { name: f.name, email: f.email, password: f.password }),
    register: () => post('auth/register', { invite: pending.invite, name: f.name, email: f.email, password: f.password }),
    reset: () => post('auth/reset', { token: pending.reset, password: f.password }),
  }[m];
  const me = await attempt(call);
  if (!me) return;
  S.me = me;
  if (m === 'register') toast('Bienvenue dans le cercle !');
  if (m === 'reset') toast('Mot de passe enregistré');
  if (m === 'setup') toast('Cercle créé : invite maintenant la famille');
  pending.reset = null; pending.mode = null; pending.invite = null; pending.invitation = null; pending.options.setup = false;
  go(m === 'setup' ? '#/cercle' : '#/');
});

on('click', 'logout', async () => {
  await attempt(() => post('auth/logout'));
  location.href = './';
});

