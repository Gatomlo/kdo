// Cercle familial (membres, profils sans compte, invitations) et Mon compte.
import { esc, on, toast, sheet, closeSheet, confirmSheet, avatar } from './ui.js';
import { get, post, patch, put, del, attempt } from './api.js';
import { S, reload } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

const linkSheet = (title, url, text) => sheet(`<h3>${esc(title)}</h3><p class="muted small">${text}</p>
  <input readonly value="${esc(url)}" class="select-all"><div class="row end"><button class="btn ghost" data-a="close-sheet">Fermer</button><button class="btn main" data-a="copy" data-text="${esc(url)}">Copier le lien</button></div>`);
document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('select-all')) e.target.select(); });

define('cercle', {
  load: () => get('circle'),
  view: (d) => {
    const byId = new Map(d.members.map((m) => [m.id, m]));
    const accounts = d.members.filter((m) => m.hasAccount);
    const profiles = d.members.filter((m) => !m.hasAccount);
    const admin = S.me.isAdmin;
    return {
      title: 'Le cercle familial',
      body: `<div class="stack-lg">
        <section class="stack"><div class="between"><h2>Membres (${accounts.length})</h2>${admin ? '<button class="btn main sm" data-a="invite">+ Inviter</button>' : ''}</div>
          ${accounts.map((m) => `<div class="card row">${avatar(m)}<span class="grow"><b>${esc(m.name)}</b>${m.me ? ' <span class="muted small">(moi)</span>' : ''}${m.isAdmin ? ' <span class="pill p-mgr">admin</span>' : ''}
            ${m.email ? `<span class="meta">${esc(m.email)}</span>` : ''}</span>
            ${admin && !m.me ? `<button class="btn ghost sm" data-a="member-menu" data-id="${m.id}">Gérer</button>` : ''}</div>`).join('')}</section>
        <section class="stack"><div class="between"><h2>Profils sans compte (${profiles.length})</h2><button class="btn plum sm" data-a="profile-new">+ Profil</button></div>
          <p class="small muted">Enfants, aînés sans e-mail… Leurs listes sont pilotées par leurs gestionnaires, qui voient et gèrent les réservations.</p>
          ${profiles.length ? profiles.map((p) => `<div class="card row">${avatar(p)}<span class="grow"><b>${esc(p.name)}</b>${p.iManage ? ' <span class="pill p-mgr">je gère</span>' : ''}
            <span class="meta">Gestion : ${p.managers.map((id) => esc((byId.get(id) || {}).name || '?')).join(', ')}</span></span>
            ${p.iManage || admin ? `<button class="btn ghost sm" data-a="profile-menu" data-id="${p.id}">Gérer</button>` : ''}</div>`).join('') : empty('Aucun profil sans compte.')}</section>
        ${admin && d.guests.length ? `<section class="stack"><h2>Invités hors cercle (${d.guests.length})</h2>
          <p class="small muted">Venus par le lien de partage d’une liste ; ils ne voient que cette liste.</p>
          ${d.guests.map((g) => `<div class="card row">${avatar(g, 'sm')}<span class="grow"><b>${esc(g.name)}</b><span class="meta">${esc(g.listTitle)}${g.email ? ` · ${esc(g.email)}` : ''}</span></span><button class="btn danger-t sm" data-a="member-del" data-id="${g.id}" data-guest="1" data-name="${esc(g.name)}">Retirer</button></div>`).join('')}</section>` : ''}
        ${admin ? '<a class="card row" href="#/reglages"><span class="cover">⚙️</span><span class="grow"><b>Réglages de l’app</b><span class="meta">E-mails (SMTP), adresse publique des liens</span></span>→</a>' : ''}
      </div>`,
    };
  },
});

const member = (id) => S.data.members.find((m) => m.id === Number(id));

on('click', 'invite', () => {
  sheet(`<h3>Inviter un membre</h3><form class="stack" data-f="invite">
    <label>E-mail (facultatif)<input name="email" type="email" placeholder="lea@exemple.be"></label>
    <p class="small muted">${S.me.mail ? 'Avec une adresse, l’invitation est envoyée par e-mail.' : 'Les e-mails ne sont pas configurés : tu transmettras le lien toi-même (SMS, WhatsApp…).'}</p>
    <label class="check"><input type="checkbox" name="isAdmin"> Administrateur du cercle</label>
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Créer l’invitation</button></div></form>`);
});
on('submit', 'invite', async (form, f) => {
  const r = await attempt(() => post('circle/invitations', { email: f.email || undefined, isAdmin: f.isAdmin }));
  if (r) linkSheet('Lien d’invitation', r.url, `${r.sent ? 'Invitation envoyée par e-mail. ' : ''}Lien personnel valable 14 jours, utilisable une seule fois.`);
});

on('click', 'member-menu', (el) => {
  const m = member(el.dataset.id);
  sheet(`<h3>${esc(m.name)}</h3><div class="stack">
    <button class="btn ghost" data-a="reset-link" data-id="${m.id}">🔑 Lien de nouveau mot de passe</button>
    <button class="btn ghost" data-a="toggle-admin" data-id="${m.id}">${m.isAdmin ? 'Retirer les droits d’administration' : 'Rendre administrateur'}</button>
    <button class="btn danger-t" data-a="member-del" data-id="${m.id}">Retirer du cercle</button></div>`);
});
on('click', 'reset-link', async (el) => {
  const r = await attempt(() => post(`circle/members/${el.dataset.id}/reset-link`));
  if (r) linkSheet('Lien de nouveau mot de passe', r.url, 'À transmettre à la personne : valable 48 heures, une seule fois.');
});
on('click', 'toggle-admin', async (el) => {
  const m = member(el.dataset.id);
  if (await attempt(() => patch(`circle/members/${m.id}`, { isAdmin: !m.isAdmin }))) { closeSheet(); reload(); }
});
on('click', 'member-del', async (el) => {
  const m = el.dataset.guest ? { id: el.dataset.id, name: el.dataset.name } : member(el.dataset.id);
  if (!(await confirmSheet({ title: `Retirer ${esc(m.name)} ?`, text: 'Ses listes, ses réservations et ses messages seront supprimés.', ok: 'Retirer', danger: true }))) return;
  if (await attempt(() => del(`circle/members/${m.id}`))) { toast(`${m.name} a été retiré·e`); reload(); }
});

on('click', 'profile-new', () => {
  sheet(`<h3>Nouveau profil sans compte</h3><form class="stack" data-f="profile-new"><label>Prénom<input name="name" required maxlength="60" placeholder="Léon"></label>
    <p class="small muted">Tu en seras le gestionnaire : tu crées et modifies ses listes, et tu vois ses réservations.</p>
    <div class="row end"><button type="button" class="btn ghost" data-a="close-sheet">Annuler</button><button class="btn main">Créer</button></div></form>`);
});
on('submit', 'profile-new', async (form, f) => {
  if (await attempt(() => post('circle/profiles', { name: f.name }))) { closeSheet(); toast(`Profil de ${f.name} créé`); S.me = await get('me'); reload(); }
});

on('click', 'profile-menu', (el) => {
  const p = member(el.dataset.id);
  const others = S.data.members.filter((m) => m.hasAccount && !p.managers.includes(m.id));
  sheet(`<h3>${esc(p.name)}</h3><div class="stack">
    <form class="row" data-f="profile-rename" data-id="${p.id}"><input name="name" value="${esc(p.name)}" maxlength="60" class="grow" aria-label="Prénom"><button class="btn sm">Renommer</button></form>
    <p class="tag">Gestionnaires</p>
    ${p.managers.map((id) => { const m = member(id); return `<div class="between"><span>${esc(m ? m.name : '?')}</span>${p.managers.length > 1 ? `<button class="linkbtn" data-a="manager-del" data-p="${p.id}" data-m="${id}">retirer</button>` : ''}</div>`; }).join('')}
    ${others.length ? `<form class="row" data-f="manager-add" data-id="${p.id}"><select name="managerId" class="grow">${others.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button class="btn sm">Ajouter</button></form>` : ''}
    <button class="btn ghost" data-a="profile-account" data-id="${p.id}">🎓 Lui créer son propre compte</button>
    <button class="btn danger-t" data-a="member-del" data-id="${p.id}">Supprimer le profil</button></div>`);
});
on('submit', 'profile-rename', async (form, f) => { if (await attempt(() => patch(`circle/profiles/${form.dataset.id}`, { name: f.name }))) { closeSheet(); reload(); } });
on('submit', 'manager-add', async (form, f) => { if (await attempt(() => post(`circle/profiles/${form.dataset.id}/managers`, { managerId: Number(f.managerId) }))) { closeSheet(); reload(); } });
on('click', 'manager-del', async (el) => { if (await attempt(() => del(`circle/profiles/${el.dataset.p}/managers/${el.dataset.m}`))) { closeSheet(); reload(); } });
on('click', 'profile-account', async (el) => {
  const r = await attempt(() => post('circle/invitations', { memberId: Number(el.dataset.id) }));
  if (r) linkSheet('Lien de création de compte', r.url, 'Avec ce lien, la personne choisit son e-mail et son mot de passe ; elle garde ses listes. Ses gestionnaires redeviennent de simples offrants.');
});

// ---------- Reglages de l'app (administrateur) ----------
define('reglages', {
  load: () => get('settings'),
  view: (s) => ({
    title: 'Réglages de l’app', back: '#/cercle', tab: 'cercle',
    body: `<div class="stack-lg">
      <form class="card stack" data-f="settings-mail"><h2>E-mails</h2>
        <p class="small muted">Facultatif. Sans serveur d’envoi, tout fonctionne avec des liens à copier. Avec : lien de connexion par e-mail, invitations envoyées, notifications (article réservé modifié, enveloppe Secret Santa, rappel une semaine avant l’événement…).</p>
        <p class="banner ${s.mode === 'off' ? 'info' : 'hide'}">${s.mode === 'off' ? '📭 <span>Envoi désactivé.</span>' : s.forced ? `🔧 <span>Mode imposé par le serveur : <b>${esc(s.mode)}</b>.</span>` : s.envFallback ? '✉️ <span>Envoi actif (configuré sur le serveur).</span>' : '✉️ <span>Envoi actif.</span>'}</p>
        <label>Serveur SMTP<input name="host" value="${esc(s.host)}" placeholder="mail.infomaniak.com"></label>
        <div class="grid2"><label>Port<input name="port" type="number" min="1" max="65535" value="${esc(s.port)}"></label>
          <label class="check" style="align-self:end"><input type="checkbox" name="secure" ${s.secure ? 'checked' : ''}> SSL/TLS direct (port 465)</label></div>
        <label>Identifiant (adresse de la boîte)<input name="user" value="${esc(s.user)}" autocomplete="off" placeholder="hotte@ton-domaine.be"></label>
        <label>Mot de passe de la boîte<input name="pass" type="password" autocomplete="new-password" placeholder="${s.hasPass ? '•••••••• (inchangé si vide)' : ''}"></label>
        <label>Adresse d’expédition <span class="muted">(par défaut : l’identifiant)</span><input name="from" type="email" value="${esc(s.from)}"></label>
        <details><summary>Exemples de réglages</summary><div class="small stack tight">
          <p><b>Infomaniak</b> : serveur <code>mail.infomaniak.com</code>, port 465 + SSL coché (ou 587 sans), identifiant = adresse complète de la boîte, son mot de passe.</p>
          <p><b>Gmail</b> : <code>smtp.gmail.com</code>, port 465 + SSL, mot de passe d’application (compte Google avec validation en deux étapes).</p>
          <p>Conseil : crée une boîte dédiée (ex. <code>hotte@…</code>) plutôt que ta boîte personnelle.</p></div></details>
        <div class="row wrap"><button class="btn main">Enregistrer</button><button type="button" class="btn ghost" data-a="test-mail" ${s.mode === 'off' ? 'disabled' : ''}>Envoyer un e-mail d’essai</button>
          ${s.host ? '<button type="button" class="btn danger-t" data-a="mail-off">Désactiver l’envoi</button>' : ''}</div></form>
      <form class="card stack" data-f="settings-url"><h2>Adresse publique</h2>
        <p class="small muted">Adresse utilisée dans les liens d’invitation, de partage et les e-mails. À renseigner une fois en ligne (ex. <code>https://ton-domaine.be/hotte</code>).${s.publicUrlEnv ? ' Actuellement imposée par le serveur.' : ''}</p>
        <label>Adresse<input name="publicUrl" type="url" value="${esc(s.publicUrl)}" placeholder="${esc(s.detectedUrl)}" ${s.publicUrlEnv ? 'disabled' : ''}></label>
        <p class="small muted">Adresse utilisée actuellement : <code>${esc(s.detectedUrl)}</code></p>
        <button class="btn" ${s.publicUrlEnv ? 'disabled' : ''}>Enregistrer</button></form>
    </div>`,
  }),
});
on('submit', 'settings-mail', async (form, f) => {
  if (await attempt(() => put('settings', { smtp: { host: f.host, port: Number(f.port), secure: f.secure, user: f.user, pass: f.pass, from: f.from } }))) { toast('Réglages e-mail enregistrés'); reload(); }
});
on('click', 'mail-off', async () => {
  if (!(await confirmSheet({ title: 'Désactiver l’envoi d’e-mails ?', text: 'Les réglages SMTP seront effacés.', ok: 'Désactiver', danger: true }))) return;
  if (await attempt(() => put('settings', { smtp: { host: '' } }))) reload();
});
on('click', 'test-mail', async (el) => {
  el.disabled = true;
  el.textContent = 'Envoi…';
  const r = await attempt(() => post('settings/test-mail'));
  el.disabled = false;
  el.textContent = 'Envoyer un e-mail d’essai';
  if (r) toast(`E-mail envoyé à ${r.to} : vérifie ta boîte (et les indésirables)`);
});
on('submit', 'settings-url', async (form, f) => { if (await attempt(() => put('settings', { publicUrl: f.publicUrl }))) { toast('Adresse enregistrée'); reload(); } });

// ---------- Mon compte ----------
define('moi', {
  load: async () => ({ me: await get('me'), palette: (await get('circle')).palette }),
  view: (d) => ({
    title: 'Mon compte', back: '#/', tab: '',
    body: `<div class="stack-lg">
      <form class="card stack" data-f="me"><div class="row">${avatar(d.me, 'lg')}<span class="grow"><b>${esc(d.me.name)}</b><span class="meta">${esc(d.me.email)}${d.me.isAdmin ? ' · administrateur' : ''}</span></span></div>
        <label>Prénom<input name="name" value="${esc(d.me.name)}" maxlength="60" required></label>
        <fieldset><legend>Couleur</legend><div class="row wrap">${d.palette.map((c) => `<label class="swatch"><input type="radio" name="color" value="${c}" ${c === d.me.color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></fieldset>
        <button class="btn main">Enregistrer</button></form>
      <form class="card stack" data-f="me-password"><h2>${d.me.hasPassword ? 'Changer mon mot de passe' : 'Choisir un mot de passe'}</h2>
        ${d.me.hasPassword ? '<label>Mot de passe actuel<input type="password" name="currentPassword" autocomplete="current-password" required></label>' : ''}
        <label>Nouveau mot de passe (8 caractères minimum)<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <label>Confirmer<input type="password" name="password2" autocomplete="new-password" minlength="8" required></label>
        <button class="btn">Enregistrer</button></form>
      ${d.me.profiles.length ? `<section class="card stack"><h2>Profils que je gère</h2>${d.me.profiles.map((p) => `<div class="row">${avatar(p, 'sm')}<span class="grow">${esc(p.name)}</span><a class="link" href="#/listes/nouvelle">+ liste</a></div>`).join('')}</section>` : ''}
      <section class="stack"><a class="btn ghost" href="api/export" download>⬇️ Exporter les données (JSON)</a>
        <p class="small muted">Sans les cadeaux de tes propres listes : pas de spoiler, même dans l’export.</p>
        <button class="btn ghost" data-a="theme">◐ Mode clair / sombre</button>
        <button class="btn danger-t" data-a="logout">Se déconnecter</button></section>
    </div>`,
  }),
});
on('submit', 'me', async (form, f) => {
  const me = await attempt(() => patch('me', { name: f.name, color: f.color }));
  if (me) { S.me = me; toast('Enregistré'); reload(); }
});
on('submit', 'me-password', async (form, f) => {
  if (f.password !== f.password2) { toast('Les deux mots de passe diffèrent.', true); return; }
  if (await attempt(() => patch('me', { password: f.password, currentPassword: f.currentPassword }))) { toast('Mot de passe enregistré'); form.reset(); }
});

