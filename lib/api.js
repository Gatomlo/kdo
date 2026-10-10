// API JSON (montee sur /api). Toute route hors connexion exige une session ; les droits
// fins (liste, article, evenement) sont verifies dans les modules metier.
const express = require('express');
const auth = require('./auth');
const mailer = require('./mailer');
const C = require('./circle');
const L = require('./lists');
const E = require('./events');
const N = require('./notify');
const { preview, fetchImage } = require('./preview');
const { exportFor } = require('./exporter');
const share = require('./share');
const photos = require('./photos');
const push = require('./push');
const ideas = require('./ideas');
const birthdays = require('./birthdays');
const { myGifts } = require('./gifts');
const fiches = require('./fiches');
const { search } = require('./search');
const qr = require('./qr');
const activity = require('./activity');
const { db, getSetting, setSetting } = require('./db');
const { httpError, str, intOrNull, asyncHandler: a } = require('./util');

function me(id) {
  const m = db.prepare('SELECT id, name, email, color, is_admin, guest_list_id, password_hash IS NOT NULL AS has_password FROM members WHERE id = ?').get(id);
  if (m.guest_list_id) return { id: m.id, name: m.name, color: m.color, guest: true, listId: m.guest_list_id, profiles: [] };
  const profiles = db.prepare(`SELECT m.id, m.name, m.color FROM profile_managers pm JOIN members m ON m.id = pm.profile_id
    WHERE pm.manager_id = ? AND m.email IS NULL ORDER BY m.name`).all(id);
  return { id: m.id, name: m.name, email: m.email, color: m.color, isAdmin: !!m.is_admin, hasPassword: !!m.has_password, profiles, mail: mailer.enabled() };
}

// Rappels J-7 verifies au fil des requetes, au plus une fois par heure (aucune
// minuterie globale : le processus est partage avec les autres outils de la passerelle).
let lastReminderCheck = 0;
function maybeReminders(req) {
  if (Date.now() - lastReminderCheck < 3600 * 1000) return;
  lastReminderCheck = Date.now();
  const base = auth.publicUrl(req);
  N.reminders(base).catch((e) => console.error('Rappels', e));
  birthdays.run(base).catch((e) => console.error('Anniversaires', e));
}

const num = (v) => {
  const n = intOrNull(v);
  if (!n) throw httpError(400, 'Identifiant invalide.');
  return n;
};
const ok = (res) => res.json({ ok: true });

function router() {
  const api = express.Router();
  const base = (req) => auth.publicUrl(req);

  // ---------- Connexion ----------
  api.get('/auth/options', (req, res) => {
    res.json({ mail: mailer.enabled(), setup: !db.prepare('SELECT 1 FROM members LIMIT 1').get() });
  });

  // Premier compte de l'installation : administrateur du cercle.
  api.post('/auth/setup', a(async (req, res) => {
    if (db.prepare('SELECT 1 FROM members LIMIT 1').get()) throw httpError(403, 'Le cercle existe déjà : connecte-toi ou demande une invitation.');
    const id = C.createAccount({ name: req.body.name, email: req.body.email, passwordHash: await auth.hashPassword(req.body.password), isAdmin: true });
    activity.log('setup', 'Cercle créé', id);
    auth.createSession(req, res, id);
    res.status(201).json(me(id));
  }));

  api.post('/auth/login', a(async (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (auth.tooManyFailures(email)) throw httpError(429, 'Trop d’essais : réessaie dans 15 minutes.');
    const row = db.prepare('SELECT id, password_hash FROM members WHERE email = ?').get(email);
    if (!(await auth.verifyPassword(req.body.password, row && row.password_hash))) {
      auth.recordFailure(email);
      await new Promise((r) => setTimeout(r, auth.failureDelay()));
      throw httpError(401, 'Adresse ou mot de passe incorrect.');
    }
    auth.createSession(req, res, row.id);
    res.json(me(row.id));
  }));

  // Creation de compte par un lien d'invitation.
  api.post('/auth/register', a(async (req, res) => {
    C.findInvitation(req.body.invite);
    const hash = await auth.hashPassword(req.body.password);
    const id = C.acceptInvitation(req.body.invite, { name: req.body.name, email: req.body.email, passwordHash: hash });
    activity.log('join', `${C.getMember(id).name} a rejoint le cercle`, id);
    auth.createSession(req, res, id);
    res.status(201).json(me(id));
  }));

  api.post('/auth/reset', a(async (req, res) => {
    const hash = await auth.hashPassword(req.body.password);
    const id = auth.consumeResetToken(req.body.token);
    db.prepare('UPDATE members SET password_hash = ? WHERE id = ?').run(hash, id);
    db.prepare('DELETE FROM sessions WHERE member_id = ?').run(id);
    auth.createSession(req, res, id);
    res.json(me(id));
  }));

  // Lien de connexion par e-mail : seulement si l'envoi est configure, et pour un compte existant.
  api.post('/auth/request', a(async (req, res) => {
    if (!mailer.enabled()) throw httpError(400, 'Connexion par e-mail indisponible : utilise ton mot de passe.');
    const email = str(req.body.email, 120).toLowerCase();
    if (!C.EMAIL.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    const token = auth.createLoginToken(email);
    if (db.prepare('SELECT 1 FROM members WHERE email = ?').get(email)) {
      await mailer.send({
        to: email, subject: 'Kdo — ton lien de connexion', url: `${base(req)}/?login=${token}`, button: 'Me connecter',
        intro: 'Bonjour, voici ton lien pour te connecter à Kdo. Il est valable 15 minutes et ne sert qu’une fois.',
        outro: 'Si tu n’as rien demandé, ignore ce message.',
      });
    }
    ok(res); // meme reponse que l'adresse soit connue ou non
  }));

  api.post('/auth/verify', (req, res) => {
    const email = auth.consumeLoginToken(req.body.token);
    const m = db.prepare('SELECT id FROM members WHERE email = ?').get(email);
    if (!m) throw httpError(400, 'Aucun compte pour cette adresse.');
    auth.createSession(req, res, m.id);
    res.json(me(m.id));
  });

  api.post('/auth/logout', (req, res) => {
    auth.destroySession(req, res);
    ok(res);
  });

  api.get('/invitations/:token', (req, res) => {
    const inv = C.findInvitation(req.params.token);
    res.json({ inviter: inv.inviter, email: inv.email, profileName: inv.profile_name, isAdmin: !!inv.is_admin });
  });

  // ---------- Partage hors cercle : entree d'un invite ----------
  api.get('/share/:token', (req, res) => res.json(share.publicInfo(req.params.token)));
  api.post('/share/:token/join', a(async (req, res) => {
    const r = await share.join(req, res, req.params.token, req.body);
    if (r.created) activity.log('guest', `${r.name} (invité hors cercle) est arrivé sur ${r.surprise ? 'une liste surprise' : `« ${r.listTitle} »`}`);
    res.json({ listId: r.listId });
  }));

  // ---------- Tout le reste : connecte ----------
  // Invite externe : seulement sa liste et les actions d'offrant (share.guestAllowed).
  api.use(auth.requireAuth, (req, res, next) => {
    if (req.user.guestListId && !share.guestAllowed(req)) return next(httpError(403, 'Accès réservé aux membres du cercle.'));
    maybeReminders(req);
    next();
  });

  api.get('/me', (req, res) => res.json(me(req.user.id)));
  api.patch('/me', a(async (req, res) => {
    const b = req.body;
    if (b.password != null) {
      const row = db.prepare('SELECT password_hash FROM members WHERE id = ?').get(req.user.id);
      if (row.password_hash && !(await auth.verifyPassword(b.currentPassword, row.password_hash))) throw httpError(401, 'Mot de passe actuel incorrect.');
      db.prepare('UPDATE members SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(b.password), req.user.id);
    }
    if (b.name != null) {
      const name = str(b.name, 60);
      if (!name) throw httpError(400, 'Nom requis.');
      db.prepare('UPDATE members SET name = ? WHERE id = ?').run(name, req.user.id);
    }
    if (b.color != null) {
      if (!C.PALETTE.includes(b.color)) throw httpError(400, 'Couleur inconnue.');
      db.prepare('UPDATE members SET color = ? WHERE id = ?').run(b.color, req.user.id);
    }
    res.json(me(req.user.id));
  }));

  api.get('/dashboard', (req, res) => {
    const lists = L.summaries(req.user);
    res.json({
      birthdays: birthdays.upcoming(new Date(), 45),
      envelopes: E.myEnvelopes(req.user),
      events: E.eventsList(req.user).upcoming.slice(0, 4),
      reservations: L.myReservations(req.user),
      lists,
      // Premiers pas d'un nouveau membre (cases cochees quand c'est fait).
      steps: {
        birthday: !!db.prepare('SELECT birth_date FROM members WHERE id = ?').get(req.user.id).birth_date,
        fiche: !!fiches.get(req.user.id),
        list: !!db.prepare('SELECT 1 FROM lists WHERE owner_id = ? AND surprise = 0').get(req.user.id),
        idea: !!db.prepare('SELECT 1 FROM ideas WHERE author_id = ?').get(req.user.id),
      },
    });
  });

  api.get('/export', (req, res) => {
    res.set('Content-Disposition', `attachment; filename="la-kdo-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportFor(req.user));
  });

  api.get('/qr', (req, res) => res.json({ svg: qr.svg(req.query.text) }));
  api.get('/preview', a(async (req, res) => res.json(await preview(String(req.query.url || '')))));
  api.post('/preview/image', a(async (req, res) => res.status(201).json({ url: photos.save(await fetchImage(String(req.body.url || ''))) })));

  // ---------- Photos des articles (corps binaire, reduit par le navigateur) ----------
  api.post('/photos', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }), (req, res) => {
    res.status(201).json({ url: photos.save(req.body) });
  });

  // ---------- Reglages de l'app (administrateur) : e-mails, adresse publique ----------
  const mailSettings = (req) => {
    const s = getSetting('smtp') || {};
    return {
      mode: mailer.mode(), forced: !!process.env.KDO_MAIL,
      host: s.host || '', port: s.port || 587, secure: !!s.secure, user: s.user || '', from: s.from || '', hasPass: !!s.pass,
      envFallback: !s.host && mailer.smtpConfig() ? true : false,
      publicUrl: getSetting('public_url') || '', publicUrlEnv: process.env.KDO_PUBLIC_URL || '', detectedUrl: auth.publicUrl(req),
    };
  };
  api.get('/settings', auth.admin, (req, res) => res.json(mailSettings(req)));
  api.put('/settings', auth.admin, (req, res) => {
    const b = req.body;
    activity.log('settings', b.smtp ? 'Réglages e-mail modifiés' : 'Adresse publique modifiée', req.user.id);
    if (b.publicUrl != null) {
      const u = str(b.publicUrl, 300).replace(/\/+$/, '');
      if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw httpError(400, 'Adresse publique invalide (https://…).');
      setSetting('public_url', u || null);
    }
    if (b.smtp != null) {
      const old = getSetting('smtp') || {};
      const host = str(b.smtp.host, 200);
      if (!host) setSetting('smtp', null);
      else {
        const port = parseInt(b.smtp.port, 10) || 587;
        if (port < 1 || port > 65535) throw httpError(400, 'Port invalide.');
        const from = str(b.smtp.from, 200);
        if (from && !C.EMAIL.test(from)) throw httpError(400, 'Adresse d’expédition invalide.');
        // Mot de passe : jamais renvoye a l'interface ; vide = garder l'ancien.
        const pass = b.smtp.pass ? String(b.smtp.pass).slice(0, 300) : old.pass || '';
        setSetting('smtp', { host, port, secure: !!b.smtp.secure, user: str(b.smtp.user, 200), pass, from });
      }
    }
    res.json(mailSettings(req));
  });
  // E-mail d'essai a l'administrateur : renvoie l'erreur du serveur SMTP si l'envoi echoue.
  api.post('/settings/test-mail', auth.admin, a(async (req, res) => {
    if (!mailer.enabled()) throw httpError(400, 'Aucun serveur d’envoi configuré.');
    try {
      await mailer.verify();
      await mailer.send({ to: req.user.email, subject: 'Kdo — e-mail d’essai', url: base(req), button: 'Ouvrir Kdo', intro: 'Bonjour, si tu lis ce message, l’envoi des e-mails de Kdo fonctionne.' });
    } catch (e) {
      throw httpError(502, `Échec de l’envoi : ${e.message}`);
    }
    res.json({ ok: true, to: req.user.email });
  }));

  // ---------- Notifications du telephone ----------
  api.get('/push', (req, res) => res.json({ publicKey: push.publicKey(), devices: push.count(req.user.id) }));
  api.post('/push/subscribe', (req, res) => { push.subscribe(req.user.id, req.body.subscription); res.json({ devices: push.count(req.user.id) }); });
  api.post('/push/unsubscribe', (req, res) => { push.unsubscribe(req.user.id, req.body.endpoint); res.json({ devices: push.count(req.user.id) }); });
  api.post('/push/test', a(async (req, res) => {
    await push.sendTo(req.user.id, { title: 'Kdo 🎁', body: 'Les notifications fonctionnent sur cet appareil.', url: '#/' });
    ok(res);
  }));

  // ---------- Idees secretes pour quelqu'un ----------
  api.get('/ideas', (req, res) => res.json(ideas.counts(req.user)));
  api.get('/ideas/:mid', (req, res) => res.json(ideas.forRecipient(req.user, num(req.params.mid))));
  api.post('/ideas/:mid', (req, res) => res.status(201).json({ id: ideas.add(req.user, num(req.params.mid), req.body) }));
  api.patch('/idea/:id', (req, res) => { ideas.update(req.user, num(req.params.id), req.body); ok(res); });
  api.delete('/idea/:id', (req, res) => { ideas.remove(req.user, num(req.params.id)); ok(res); });
  api.post('/idea/:id/take', (req, res) => { ideas.take(req.user, num(req.params.id), !!req.body.take); ok(res); });

  // ---------- Recherche, fiches tailles et preferences ----------
  api.get('/search', (req, res) => res.json(search(req.user, str(req.query.q, 100))));
  api.get('/fiches/:mid', (req, res) => res.json(fiches.view(req.user, num(req.params.mid))));
  api.put('/fiches/:mid', (req, res) => { fiches.set(req.user, num(req.params.mid), req.body); ok(res); });

  // ---------- Secret Santa : idees pour mon Secret Santa, duos devoiles ----------
  api.put('/events/:id/santa/hints/:mid', (req, res) => { E.setHints(req.user, num(req.params.id), num(req.params.mid), req.body.hints); ok(res); });
  api.post('/events/:id/santa/reveal', (req, res) => {
    E.reveal(req.user, num(req.params.id));
    activity.log('santa', `Duos du Secret Santa dévoilés : « ${E.getEvent(num(req.params.id)).title} »`, req.user.id);
    ok(res);
  });

  // ---------- Journal de l'administrateur ----------
  api.get('/admin/journal', auth.admin, (req, res) => {
    const invitations = db.prepare(`SELECT i.token_hash, i.email, i.is_admin, i.expires_at, u.name AS inviter, p.name AS profile_name FROM invitations i
      LEFT JOIN members u ON u.id = i.invited_by LEFT JOIN members p ON p.id = i.member_id
      WHERE i.used_at IS NULL AND i.expires_at > ? ORDER BY i.expires_at`).all(Date.now())
      .map((i) => ({ id: i.token_hash.slice(0, 16), email: i.email, isAdmin: !!i.is_admin, expiresAt: i.expires_at, inviter: i.inviter, profileName: i.profile_name }));
    const shares = db.prepare(`SELECT l.id, l.title, l.share_password_hash IS NOT NULL AS protected, m.name AS owner,
      (SELECT COUNT(*) FROM members g WHERE g.guest_list_id = l.id) AS guests FROM lists l JOIN members m ON m.id = l.owner_id WHERE l.share_token IS NOT NULL AND NOT (l.surprise = 1 AND l.owner_id = ?)`).all(req.user.id)
      .map((l) => ({ id: l.id, title: l.title, owner: l.owner, protected: !!l.protected, guests: l.guests }));
    res.json({
      invitations, shares, activity: activity.recent(150),
      counts: {
        members: db.prepare('SELECT COUNT(*) AS n FROM members WHERE email IS NOT NULL').get().n,
        profiles: db.prepare('SELECT COUNT(*) AS n FROM members WHERE email IS NULL AND guest_list_id IS NULL').get().n,
        guests: db.prepare('SELECT COUNT(*) AS n FROM members WHERE guest_list_id IS NOT NULL').get().n,
        devices: db.prepare('SELECT COUNT(*) AS n FROM push_subs').get().n,
      },
    });
  });
  api.delete('/admin/invitations/:id', auth.admin, (req, res) => {
    const id = str(req.params.id, 16);
    if (!/^[0-9a-f]{16}$/.test(id)) throw httpError(400, 'Invitation invalide.');
    db.prepare("DELETE FROM invitations WHERE substr(token_hash, 1, 16) = ? AND used_at IS NULL").run(id);
    activity.log('invite', 'Invitation annulée', req.user.id);
    ok(res);
  });

  // ---------- Mes cadeaux (historique, budget) ----------
  api.get('/my-gifts', (req, res) => res.json(myGifts(req.user)));

  // ---------- Cercle ----------
  api.get('/circle', (req, res) => res.json({ members: C.members(req.user), guests: req.user.isAdmin ? C.guests(req.user) : [], palette: C.PALETTE, ideas: ideas.counts(req.user) }));
  api.put('/circle/members/:id/birthday', a(async (req, res) => {
    birthdays.setBirthday(req.user, num(req.params.id), req.body);
    await birthdays.run(base(req)); // delai deja atteint : liste creee tout de suite
    ok(res);
  }));
  api.post('/circle/invitations', a(async (req, res) => {
    const token = C.createInvitation(req.user, { email: req.body.email, isAdmin: !!req.body.isAdmin, memberId: intOrNull(req.body.memberId), multi: !!req.body.multi });
    activity.log('invite', `${req.body.multi ? 'Lien familial (48 h) créé' : 'Invitation créée'}${req.body.email ? ` pour ${str(req.body.email, 120)}` : ''}${req.body.memberId ? ` (compte pour ${C.getMember(intOrNull(req.body.memberId)).name})` : ''}`, req.user.id);
    const url = `${base(req)}/?invite=${token}`;
    let sent = false;
    const email = str(req.body.email, 120);
    if (email && mailer.enabled()) {
      await mailer.send({
        to: email, subject: `${req.user.name} t’invite sur Kdo`, url, button: 'Rejoindre le cercle',
        intro: `Bonjour,\n\n${req.user.name} t’invite à rejoindre le cercle familial sur Kdo, l’outil de listes de cadeaux de la famille.`,
        outro: 'Lien valable 14 jours.',
      });
      sent = true;
    }
    res.status(201).json({ url, sent });
  }));
  api.patch('/circle/members/:id', auth.admin, (req, res) => { C.setAdmin(req.user, num(req.params.id), !!req.body.isAdmin); ok(res); });
  api.delete('/circle/members/:id', (req, res) => {
    const m = C.getMember(num(req.params.id));
    C.removeMember(req.user, m.id);
    activity.log('remove', `${m.name} a été retiré·e${m.guest_list_id ? ' (invité hors cercle)' : ''}`, req.user.id);
    ok(res);
  });
  api.post('/circle/members/:id/reset-link', auth.admin, (req, res) => {
    const m = C.getMember(num(req.params.id));
    if (!m.email) throw httpError(400, 'Ce profil n’a pas de compte.');
    res.json({ url: `${base(req)}/?reset=${auth.createResetToken(m.id)}` });
  });
  api.post('/circle/profiles', (req, res) => res.status(201).json({ id: C.createProfile(req.user, req.body.name) }));
  api.patch('/circle/profiles/:id', (req, res) => { C.renameProfile(req.user, num(req.params.id), req.body.name); ok(res); });
  api.post('/circle/profiles/:id/managers', (req, res) => { C.addManager(req.user, num(req.params.id), num(req.body.managerId)); ok(res); });
  api.delete('/circle/profiles/:id/managers/:mid', (req, res) => { C.removeManager(req.user, num(req.params.id), num(req.params.mid)); ok(res); });

  // ---------- Listes ----------
  api.get('/lists', (req, res) => res.json(L.summaries(req.user, { archived: req.query.archived === '1' })));
  api.post('/lists', a(async (req, res) => {
    const { id, managers, title } = L.createList(req.user, req.body);
    for (const m of managers) await N.invited(m, req.user, `co-organisateur de la liste surprise « ${title} »`, `/listes/${id}`, base(req));
    res.status(201).json({ id });
  }));
  api.get('/lists/:id', (req, res) => res.json(L.view(num(req.params.id), req.user)));
  api.patch('/lists/:id', (req, res) => { L.updateList(req.user, num(req.params.id), req.body); ok(res); });
  api.delete('/lists/:id', (req, res) => { L.deleteList(req.user, num(req.params.id)); ok(res); });
  api.post('/lists/:id/roles', a(async (req, res) => {
    const role = req.body.role === 'manager' ? 'manager' : 'co_owner';
    const { list, member } = L.addRole(req.user, num(req.params.id), num(req.body.memberId), role);
    await N.invited(member, req.user, `${role === 'manager' ? 'gestionnaire' : 'co-propriétaire'} de la liste « ${list.title} »`, `/listes/${list.id}`, base(req));
    ok(res);
  }));
  api.post('/lists/:id/transfer', (req, res) => { L.transferList(req.user, num(req.params.id), num(req.body.memberId), !!req.body.keepManager); ok(res); });
  api.delete('/lists/:id/roles/:mid', (req, res) => { L.removeRole(req.user, num(req.params.id), num(req.params.mid)); ok(res); });
  api.post('/lists/:id/categories', (req, res) => res.status(201).json({ id: L.addCategory(req.user, num(req.params.id), req.body.name) }));
  api.put('/lists/:id/categories/order', (req, res) => { L.reorder(req.user, num(req.params.id), 'categories', req.body.ids); ok(res); });
  api.put('/lists/:id/items/order', (req, res) => { L.reorder(req.user, num(req.params.id), 'items', req.body.ids); ok(res); });
  api.patch('/categories/:id', (req, res) => { L.renameCategory(req.user, num(req.params.id), req.body.name); ok(res); });
  api.delete('/categories/:id', (req, res) => { L.deleteCategory(req.user, num(req.params.id)); ok(res); });
  api.post('/lists/:id/items', (req, res) => res.status(201).json({ id: L.createItem(req.user, num(req.params.id), req.body) }));
  api.post('/lists/:id/off-list', (req, res) => { L.addOffList(req.user, num(req.params.id), req.body); res.status(201).json({ ok: true }); });
  api.get('/lists/:id/share', (req, res) => res.json(share.shareInfo(req.user, num(req.params.id), base(req))));
  api.post('/lists/:id/share', (req, res) => { share.enable(req.user, num(req.params.id), !!req.body.renew); const sl = L.view(num(req.params.id), req.user).list; activity.log('share', `Partage hors cercle ${req.body.renew ? 'renouvelé' : 'activé'} : ${sl.surprise ? 'une liste surprise' : `« ${sl.title} »`}`, req.user.id); res.json(share.shareInfo(req.user, num(req.params.id), base(req))); });
  api.delete('/lists/:id/share', (req, res) => { share.disable(req.user, num(req.params.id)); activity.log('share', 'Partage hors cercle désactivé', req.user.id); res.json(share.shareInfo(req.user, num(req.params.id), base(req))); });
  api.put('/lists/:id/share/password', a(async (req, res) => { await share.setPassword(req.user, num(req.params.id), req.body.password); res.json(share.shareInfo(req.user, num(req.params.id), base(req))); }));
  api.delete('/lists/:id/share/guests/:gid', (req, res) => { share.removeGuest(req.user, num(req.params.id), num(req.params.gid)); ok(res); });
  api.delete('/off-list/:id', (req, res) => { L.deleteOffList(req.user, num(req.params.id)); ok(res); });

  // ---------- Articles et reservations ----------
  api.patch('/items/:id', a(async (req, res) => { await L.updateItem(req.user, num(req.params.id), req.body, base(req)); ok(res); }));
  api.patch('/items/:id/received', (req, res) => { L.setReceived(req.user, num(req.params.id), !!req.body.received); ok(res); });
  api.post('/lists/:id/carry', (req, res) => res.json(L.carryOver(req.user, num(req.params.id), req.body)));
  api.post('/lists/:id/duplicate', (req, res) => res.status(201).json({ id: L.duplicate(req.user, num(req.params.id), req.body.title) }));
  api.delete('/items/:id', a(async (req, res) => { await L.deleteItem(req.user, num(req.params.id), base(req)); ok(res); }));
  api.post('/items/:id/reserve', (req, res) => { L.reserve(req.user, num(req.params.id), req.body); res.status(201).json({ ok: true }); });
  api.post('/items/:id/participate', (req, res) => { L.participate(req.user, num(req.params.id), req.body); res.status(201).json({ ok: true }); });
  api.post('/items/:id/comments', (req, res) => { L.addComment(req.user, num(req.params.id), req.body.body); res.status(201).json({ ok: true }); });
  api.patch('/reservations/:id', (req, res) => { L.updateReservation(req.user, num(req.params.id), req.body); ok(res); });
  api.delete('/reservations/:id', (req, res) => { L.cancelReservation(req.user, num(req.params.id)); ok(res); });

  // ---------- Evenements ----------
  api.get('/events', (req, res) => res.json(E.eventsList(req.user)));
  api.post('/events', a(async (req, res) => {
    const { id, added } = E.createEvent(req.user, req.body);
    await N.invitedToEvent(id, added, req.user, base(req));
    res.status(201).json({ id });
  }));
  api.get('/events/:id', (req, res) => res.json(E.eventView(req.user, num(req.params.id))));
  api.get('/events/:id/edit', (req, res) => {
    const ev = E.requireOrganizer(req.user, num(req.params.id));
    res.json({ event: { id: ev.id, title: ev.title, date: ev.date, place: ev.place, budget: ev.budget }, participants: E.participantIds(ev.id) });
  });
  api.patch('/events/:id', a(async (req, res) => {
    const added = E.updateEvent(req.user, num(req.params.id), req.body);
    await N.invitedToEvent(num(req.params.id), added, req.user, base(req));
    ok(res);
  }));
  api.delete('/events/:id', (req, res) => { E.deleteEvent(req.user, num(req.params.id)); ok(res); });

  // ---------- Secret Santa ----------
  api.post('/events/:id/santa', (req, res) => { E.enableSanta(req.user, num(req.params.id)); res.status(201).json({ ok: true }); });
  api.get('/events/:id/santa', (req, res) => res.json(E.santaAdmin(req.user, num(req.params.id))));
  api.patch('/events/:id/santa', (req, res) => { E.updateSanta(req.user, num(req.params.id), req.body); ok(res); });
  api.delete('/events/:id/santa', (req, res) => { E.disableSanta(req.user, num(req.params.id), !!req.body.force); ok(res); });
  api.post('/events/:id/santa/exclusions', (req, res) => { E.addExclusion(req.user, num(req.params.id), req.body.a, req.body.b); res.status(201).json({ ok: true }); });
  api.delete('/events/:id/santa/exclusions/:a/:b', (req, res) => { E.removeExclusion(req.user, num(req.params.id), req.params.a, req.params.b); ok(res); });
  api.post('/events/:id/nudge/:mid', a(async (req, res) => {
    const { ev, member } = E.nudge(req.user, num(req.params.id), num(req.params.mid));
    res.json({ reached: await N.listNudge(ev, member, req.user, base(req)) });
  }));
  api.post('/events/:id/santa/draw', a(async (req, res) => {
    const { redraw, ignoredPrevious } = E.runDraw(req.user, num(req.params.id), !!req.body.force, !!req.body.allowManagers);
    activity.log('santa', `Secret Santa ${redraw ? 'retiré au sort à nouveau' : 'tiré au sort'} : « ${E.getEvent(num(req.params.id)).title} »`, req.user.id);
    await N.envelopes(num(req.params.id), redraw, base(req));
    res.json({ ok: true, redraw, ignoredPrevious });
  }));
  api.get('/events/:id/envelope', (req, res) => res.json(E.envelopeView(req.user, num(req.params.id))));
  api.post('/santa-pairs/:id/open', (req, res) => { E.openEnvelope(req.user, num(req.params.id)); ok(res); });
  api.post('/santa-pairs/:id/messages', a(async (req, res) => {
    const direction = req.body.direction === 'reply' ? 'reply' : 'question';
    const { pair, text } = E.postMessage(req.user, num(req.params.id), direction, req.body.body);
    await N.santaMessage(pair, direction, text, base(req));
    res.status(201).json({ ok: true });
  }));

  return api;
}

module.exports = { router };
