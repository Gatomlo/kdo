// Notifications (§4.5) : chaque message part par e-mail (si l'envoi est configure) ET sur
// les telephones abonnes (Web Push, push.js). Sans l'un ni l'autre, il est ignore.
// Regle anti-spoiler : jamais de message au destinataire ni aux co-proprietaires sur
// ses propres cadeaux. `base` = adresse publique de l'app (auth.publicUrl).
const { db, inList } = require('./db');
const mailer = require('./mailer');
const { notify: sendMails } = mailer;
const push = require('./push');
const A = require('./access');
const follows = require('./follows');

const uniq = (ms) => [...new Map(ms.filter(Boolean).map((m) => [m.id, m])).values()];

// msg(m) -> { subject, text, path ('/listes/3'), button }.
async function deliver(recipients, msg, base) {
  const list = uniq(recipients);
  await sendMails(list.filter((m) => m.email).map((m) => {
    const x = msg(m);
    return { to: m.email, subject: x.subject, intro: `Bonjour ${m.name},\n\n${x.text}`, url: `${base}/#${x.path}`, button: x.button };
  }));
  await Promise.all(list.map((m) => {
    const x = msg(m);
    return push.sendTo(m.id, { title: x.subject, body: x.text, url: `#${x.path}` }).catch((e) => console.error('Push', e.message));
  }));
}

// Ce qu'il faut savoir d'un article pour prevenir ses offrants (a prendre avant suppression).
function itemSnapshot(itemId) {
  const row = db.prepare(`SELECT i.title, l.id AS list_id, l.title AS list_title, l.owner_id, m.name AS owner_name
    FROM items i JOIN lists l ON l.id = i.list_id JOIN members m ON m.id = l.owner_id WHERE i.id = ?`).get(itemId);
  if (!row) return null;
  return { ...row, giverIds: db.prepare('SELECT DISTINCT giver_id FROM reservations WHERE item_id = ?').all(itemId).map((r) => r.giver_id) };
}

// Article reserve modifie ou supprime : offrants concernes + gestionnaires de la liste.
async function itemChanged(itemId, kind, actor, snapshot, base) {
  const s = snapshot || itemSnapshot(itemId);
  if (!s || !s.giverIds.length) return;
  const excluded = new Set([s.owner_id, ...A.coOwnerIds(s.list_id), actor.id]);
  const to = [...s.giverIds.flatMap(A.mailboxesFor), ...A.listManagers({ id: s.list_id, owner_id: s.owner_id })].filter((m) => !excluded.has(m.id));
  await deliver(to, () => ({
    subject: `« ${s.title} » a été ${kind}`,
    text: `Un article que tu offres sur la liste « ${s.list_title} » de ${s.owner_name} a été ${kind}. ${kind === 'supprimé' ? 'Ta réservation a été supprimée avec lui.' : 'Vérifie que ta réservation est toujours d’actualité.'}`,
    path: `/listes/${s.list_id}`, button: 'Voir la liste',
  }), base);
}

// Article supprime : previent aussi les abonnes de la liste (ceux qui ont deja ete prevenus comme
// offrants, l'auteur, le destinataire et les co-proprietaires sont exclus), pour qu'on n'achete pas
// un cadeau qui n'est plus souhaite.
async function itemRemoved(s, actor, base) {
  if (!s) return;
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(s.list_id);
  if (!list) return;
  const already = [actor.id, ...s.giverIds.flatMap(A.mailboxesFor).map((m) => m.id), ...s.giverIds];
  // La suppression part toujours tout de suite, meme pour qui a choisi le recap : on ne doit pas
  // acheter un cadeau qui n'est plus souhaite.
  const ids = follows.followersOf(list, already).map((f) => f.id);
  await deliver(ids.flatMap(A.mailboxesFor), () => ({
    subject: `« ${s.title} » a été retiré de la liste de ${s.owner_name}`,
    text: `Sur « ${s.list_title} » : « ${s.title} » a été supprimé, il n’est donc plus souhaité. Pas la peine de l’acheter.`,
    path: `/listes/${s.list_id}`, button: 'Voir la liste',
  }), base);
}

// Invitation a une liste (role) ou a un evenement.
async function invited(member, by, what, path, base) {
  if (member.id === by.id) return;
  await deliver(A.mailboxesFor(member.id), () => ({ subject: `${by.name} t’invite : ${what}`, text: `${by.name} t’a ajouté·e : ${what}.`, path, button: 'Ouvrir Kdo' }), base);
}

async function invitedToEvent(eventId, memberIds, by, base) {
  const ev = db.prepare('SELECT id, title FROM events WHERE id = ?').get(eventId);
  const ms = uniq(memberIds.flatMap(A.mailboxesFor)).filter((m) => m.id !== by.id);
  await deliver(ms, () => ({ subject: `${by.name} t’invite : « ${ev.title} »`, text: `${by.name} t’a ajouté·e à l’événement « ${ev.title} ».`, path: `/evenements/${ev.id}`, button: 'Voir l’événement' }), base);
}

// Rappel « pas encore de liste » (pour un profil : a ses gestionnaires). Renvoie le nombre
// de personnes joignables (e-mail configure ou notifications activees).
async function listNudge(ev, member, by, base) {
  const path = `/listes/nouvelle/evenement/${ev.id}`;
  const to = A.mailboxesFor(member.id);
  const reached = to.filter((m) => (m.email && mailer.enabled()) || push.count(m.id)).length;
  await deliver(to, (m) => (m.id === member.id
    ? { subject: `Ta liste pour « ${ev.title} » ?`, text: `${by.name} aimerait savoir ce qui te ferait plaisir pour « ${ev.title} » : crée ta liste en quelques minutes.`, path, button: 'Créer ma liste' }
    : { subject: `La liste de ${member.name} pour « ${ev.title} » ?`, text: `${by.name} aimerait savoir ce qui ferait plaisir à ${member.name} pour « ${ev.title} » : tu peux créer sa liste.`, path, button: 'Créer sa liste' }), base);
  return reached;
}

// Tirage effectue (ou refait) : « ton enveloppe t'attend ».
async function envelopes(eventId, redraw, base) {
  const ev = db.prepare('SELECT id, title FROM events WHERE id = ?').get(eventId);
  const ids = db.prepare('SELECT member_id FROM event_participants WHERE event_id = ?').all(eventId).map((r) => r.member_id);
  await deliver(ids.flatMap(A.mailboxesFor), () => ({
    subject: redraw ? `Secret Santa « ${ev.title} » : nouveau tirage` : `Secret Santa « ${ev.title} » : ton enveloppe t’attend`,
    text: `${redraw ? 'L’organisateur a relancé le tirage au sort : les anciennes attributions ne comptent plus. ' : ''}Ton enveloppe Secret Santa pour « ${ev.title} » t’attend.`,
    path: `/evenements/${ev.id}/enveloppe`, button: 'Ouvrir mon enveloppe',
  }), base);
}

// Message anonyme du Secret Santa (question) ou reponse de la cible.
async function santaMessage(pair, direction, body, base) {
  const toId = direction === 'question' ? pair.receiver_id : pair.giver_id;
  const receiver = db.prepare('SELECT name FROM members WHERE id = ?').get(pair.receiver_id).name;
  const eventId = db.prepare('SELECT event_id FROM ss_draws WHERE id = ?').get(pair.draw_id).event_id;
  await deliver(A.mailboxesFor(toId), () => ({
    subject: direction === 'question' ? 'Ton Secret Santa te pose une question 🎅' : `${receiver} a répondu à ta question 🎅`,
    text: direction === 'question' ? `Ton Secret Santa (anonyme) te demande : « ${body} »` : `${receiver} a répondu : « ${body} »`,
    path: `/evenements/${eventId}/enveloppe`, button: direction === 'question' ? 'Répondre' : 'Voir',
  }), base);
}

// Anniversaire : la liste de la personne vient d'etre creee (birthdays.js).
async function birthdayCreated({ member, list, event, days }, base) {
  const when = days <= 1 ? (days === 1 ? 'demain' : 'aujourd’hui') : `dans ${days} jours`;
  await deliver(A.mailboxesFor(member.id), (m) => ({
    subject: `🎂 ${m.id === member.id ? 'Ta' : `La`} liste d’anniversaire ${m.id === member.id ? 'est prête' : `de ${member.name} est prête`}`,
    text: `${m.id === member.id ? 'Ton' : `L’`}anniversaire${m.id === member.id ? '' : ` de ${member.name}`} est ${when} : la liste « ${list.title} » a été créée, il reste à la remplir.`,
    path: `/listes/${list.id}`, button: 'Remplir la liste',
  }), base);
  const others = db.prepare(`SELECT id FROM members WHERE guest_list_id IS NULL AND id <> ? AND email IS NOT NULL AND circle_id = (SELECT circle_id FROM members WHERE id = ?)`).all(member.id, member.id).map((r) => r.id)
    .filter((id) => !A.managedProfileIds(id).includes(member.id));
  await deliver(others.flatMap(A.mailboxesFor), () => ({
    subject: `🎂 Anniversaire de ${member.name} ${when}`,
    text: `L’anniversaire de ${member.name} est ${when}. Sa liste se remplit : jette un œil !`,
    path: `/evenements/${event.id}`, button: 'Voir l’événement',
  }), base);
}

// Abonne a une liste : lot d'articles ajoutes depuis la derniere notification.
async function listFollowed(listId, memberId, count, titles, base) {
  const l = db.prepare('SELECT l.id, l.title, l.surprise, m.name AS owner FROM lists l JOIN members m ON m.id = l.owner_id WHERE l.id = ?').get(listId);
  if (!l) return;
  const shown = titles.slice(0, 3).map((t) => `« ${t} »`).join(', ') + (count > 3 ? `… (+${count - 3})` : '');
  await deliver(A.mailboxesFor(memberId), () => ({
    subject: count === 1 ? `Nouveau cadeau sur la liste de ${l.owner}` : `${count} nouveaux cadeaux sur la liste de ${l.owner}`,
    text: `Sur « ${l.title} » : ${shown}.`,
    path: `/listes/${l.id}`, button: 'Voir la liste',
  }), base);
}

// Un cadeau vient d'etre pris (reserve ou part de cadeau commun) : previent les abonnes de la liste.
// Jamais le destinataire ni les co-proprietaires (non abonnables, voir follows.set).
async function itemTaken(itemId, giverId, kind, base) {
  const row = db.prepare(`SELECT i.title AS item_title, l.* FROM items i JOIN lists l ON l.id = i.list_id WHERE i.id = ?`).get(itemId);
  if (!row) return;
  const all = follows.followersOf(row, [giverId, ...A.actorIds(giverId)]).filter((f) => follows.wants(f.events, 'taken'));
  if (!all.length) return;
  const giver = db.prepare('SELECT name FROM members WHERE id = ?').get(giverId);
  const owner = db.prepare('SELECT name FROM members WHERE id = ?').get(row.owner_id);
  const ids = [];
  for (const f of all) {
    if (follows.digestOf(f.id) === 'instant') ids.push(f.id);
    else follows.queue(f.id, row.id, kind === 'share' ? 'share' : 'taken', row.item_title, giver && giver.name);
  }
  await deliver(ids.flatMap(A.mailboxesFor), () => ({
    subject: `${giver ? giver.name : 'Quelqu’un'} ${kind === 'share' ? 'participe à' : 'a pris'} « ${row.item_title} »`,
    text: `Sur la liste « ${row.title} » de ${owner.name} : ${giver ? giver.name : 'quelqu’un'} ${kind === 'share' ? 'participe au cadeau commun' : 'a réservé'} « ${row.item_title} ».`,
    path: `/listes/${row.id}`, button: 'Voir la liste',
  }), base);
}

// Recapitulatif (choix « une fois par jour / par semaine ») : tout ce qui s'est passe sur les listes suivies.
async function digest(memberId, rows, base) {
  const byList = Map.groupBy(rows, (r) => r.list_id);
  const lines = [];
  for (const [listId, rs] of byList) {
    const l = db.prepare('SELECT l.title, m.name AS owner FROM lists l JOIN members m ON m.id = l.owner_id WHERE l.id = ?').get(listId);
    if (!l) continue;
    const added = rs.filter((r) => r.kind === 'add').map((r) => `« ${r.title} »`);
    const taken = rs.filter((r) => r.kind !== 'add').map((r) => `${r.who || 'Quelqu’un'} ${r.kind === 'share' ? 'participe à' : 'a pris'} « ${r.title} »`);
    const parts = [added.length ? `${added.length} ajouté${added.length > 1 ? 's' : ''} (${added.slice(0, 4).join(', ')}${added.length > 4 ? '…' : ''})` : '', ...taken.slice(0, 4), taken.length > 4 ? `… +${taken.length - 4}` : ''].filter(Boolean);
    lines.push(`• ${l.owner} — « ${l.title} » : ${parts.join(' ; ')}`);
  }
  if (!lines.length) return;
  await deliver(A.mailboxesFor(memberId), () => ({
    subject: `Récap de tes listes suivies (${rows.length} nouveauté${rows.length > 1 ? 's' : ''})`,
    text: lines.join('\n'),
    path: '/abonnements', button: 'Mes abonnements',
  }), base);
}

// Rappel J-7 aux offrants dont les reservations ne sont pas encore « achetees ».
// Appele au fil des requetes (au plus une fois par heure, voir api.js) : pas de minuterie
// globale dans le processus partage de la passerelle. Un evenement n'est rappele qu'une fois.
async function reminders(base, now = new Date()) {
  const target = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const evs = db.prepare('SELECT id, title FROM events WHERE reminder_sent = 0 AND date IS NOT NULL AND date <= ? AND date >= ?').all(target, today);
  let sent = 0;
  for (const ev of evs) {
    db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(ev.id);
    const listIds = db.prepare('SELECT id FROM lists WHERE event_id = ?').all(ev.id).map((l) => l.id);
    const rows = db.prepare(`SELECT r.giver_id, i.title FROM reservations r JOIN items i ON i.id = r.item_id
      WHERE i.list_id IN (${inList(listIds)}) AND r.status <> 'bought'`).all();
    for (const [giverId, rs] of Map.groupBy(rows, (r) => r.giver_id)) {
      const to = A.mailboxesFor(giverId);
      sent += to.length;
      await deliver(to, () => ({
        subject: `Bientôt « ${ev.title} » : cadeaux pas encore achetés`,
        text: `« ${ev.title} » approche. Pas encore marqué « acheté » : ${rs.map((r) => r.title).join(', ')}.`,
        path: `/evenements/${ev.id}`, button: 'Voir l’événement',
      }), base);
    }
  }
  return sent;
}

module.exports = { deliver, itemSnapshot, itemChanged, itemRemoved, invited, invitedToEvent, listNudge, envelopes, santaMessage, birthdayCreated, listFollowed, digest, itemTaken, reminders };
