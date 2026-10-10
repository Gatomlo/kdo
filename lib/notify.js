// Notifications (§4.5) : chaque message part par e-mail (si l'envoi est configure) ET sur
// les telephones abonnes (Web Push, push.js). Sans l'un ni l'autre, il est ignore.
// Regle anti-spoiler : jamais de message au destinataire ni aux co-proprietaires sur
// ses propres cadeaux. `base` = adresse publique de l'app (auth.publicUrl).
const { db, inList } = require('./db');
const { notify: sendMails } = require('./mailer');
const push = require('./push');
const A = require('./access');

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

// Invitation a une liste (role) ou a un evenement.
async function invited(member, by, what, path, base) {
  if (member.id === by.id) return;
  await deliver(A.mailboxesFor(member.id), () => ({ subject: `${by.name} t’invite : ${what}`, text: `${by.name} t’a ajouté·e : ${what}.`, path, button: 'Ouvrir La Hotte' }), base);
}

async function invitedToEvent(eventId, memberIds, by, base) {
  const ev = db.prepare('SELECT id, title FROM events WHERE id = ?').get(eventId);
  const ms = uniq(memberIds.flatMap(A.mailboxesFor)).filter((m) => m.id !== by.id);
  await deliver(ms, () => ({ subject: `${by.name} t’invite : « ${ev.title} »`, text: `${by.name} t’a ajouté·e à l’événement « ${ev.title} ».`, path: `/evenements/${ev.id}`, button: 'Voir l’événement' }), base);
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
  const others = db.prepare(`SELECT id FROM members WHERE guest_list_id IS NULL AND id <> ? AND email IS NOT NULL`).all(member.id).map((r) => r.id)
    .filter((id) => !A.managedProfileIds(id).includes(member.id));
  await deliver(others.flatMap(A.mailboxesFor), () => ({
    subject: `🎂 Anniversaire de ${member.name} ${when}`,
    text: `L’anniversaire de ${member.name} est ${when}. Sa liste se remplit : jette un œil !`,
    path: `/evenements/${event.id}`, button: 'Voir l’événement',
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

module.exports = { deliver, itemSnapshot, itemChanged, invited, invitedToEvent, envelopes, santaMessage, birthdayCreated, reminders };
