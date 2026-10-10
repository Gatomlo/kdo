// Notifications par e-mail (§4.5). Toutes sont facultatives : sans envoi configure
// (HOTTE_MAIL=off, cas de la prod actuelle), elles sont simplement ignorees.
// Regle anti-spoiler : jamais de message au destinataire ni aux co-proprietaires sur
// ses propres cadeaux. `base` = adresse publique de l'app (auth.publicUrl).
const { db, inList } = require('./db');
const { notify } = require('./mailer');
const A = require('./access');

const withEmail = (ms) => [...new Map(ms.filter((m) => m && m.email).map((m) => [m.id, m])).values()];

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
  const to = withEmail([...s.giverIds.flatMap(A.mailboxesFor), ...A.listManagers({ id: s.list_id, owner_id: s.owner_id })])
    .filter((m) => !excluded.has(m.id));
  await notify(to.map((m) => ({
    to: m.email,
    subject: `« ${s.title} » a été ${kind}`,
    intro: `Bonjour ${m.name},\n\nUn article que tu offres sur la liste « ${s.list_title} » de ${s.owner_name} a été ${kind} : « ${s.title} ».\n${kind === 'supprimé' ? 'Ta réservation a été supprimée avec lui.' : 'Vérifie que ta réservation est toujours d’actualité.'}`,
    url: `${base}/#/listes/${s.list_id}`,
    button: 'Voir la liste',
  })));
}

// Invitation a une liste (role) ou a un evenement.
async function invited(member, by, what, path, base) {
  if (!member.email || member.id === by.id) return;
  await notify([{
    to: member.email,
    subject: `${by.name} t’invite : ${what}`,
    intro: `Bonjour ${member.name},\n\n${by.name} t’a ajouté·e : ${what}.`,
    url: `${base}/#${path}`,
    button: 'Ouvrir La Hotte',
  }]);
}

async function invitedToEvent(eventId, memberIds, by, base) {
  const ev = db.prepare('SELECT id, title FROM events WHERE id = ?').get(eventId);
  const ms = withEmail(memberIds.flatMap(A.mailboxesFor));
  await Promise.all(ms.map((m) => invited(m, by, `l’événement « ${ev.title} »`, `/evenements/${ev.id}`, base)));
}

// Tirage effectue (ou refait) : « ton enveloppe t'attend ».
async function envelopes(eventId, redraw, base) {
  const ev = db.prepare('SELECT id, title FROM events WHERE id = ?').get(eventId);
  const ids = db.prepare('SELECT member_id FROM event_participants WHERE event_id = ?').all(eventId).map((r) => r.member_id);
  await notify(withEmail(ids.flatMap(A.mailboxesFor)).map((m) => ({
    to: m.email,
    subject: redraw ? `Secret Santa « ${ev.title} » : nouveau tirage` : `Secret Santa « ${ev.title} » : ton enveloppe t’attend`,
    intro: `Bonjour ${m.name},\n\n${redraw ? 'L’organisateur a relancé le tirage au sort : les anciennes attributions ne comptent plus.\n' : ''}Ton enveloppe Secret Santa pour « ${ev.title} » t’attend.`,
    url: `${base}/#/evenements/${ev.id}/enveloppe`,
    button: 'Ouvrir mon enveloppe',
  })));
}

// Message anonyme du Secret Santa (question) ou reponse de la cible.
async function santaMessage(pair, direction, body, base) {
  const toId = direction === 'question' ? pair.receiver_id : pair.giver_id;
  const receiver = db.prepare('SELECT name FROM members WHERE id = ?').get(pair.receiver_id).name;
  const eventId = db.prepare('SELECT event_id FROM ss_draws WHERE id = ?').get(pair.draw_id).event_id;
  await notify(withEmail(A.mailboxesFor(toId)).map((m) => ({
    to: m.email,
    subject: direction === 'question' ? 'Ton Secret Santa te pose une question 🎅' : `${receiver} a répondu à ta question 🎅`,
    intro: direction === 'question' ? `Bonjour ${m.name},\n\nTon Secret Santa (anonyme) te demande :\n« ${body} »` : `Bonjour ${m.name},\n\n${receiver} a répondu :\n« ${body} »`,
    url: `${base}/#/evenements/${eventId}/enveloppe`,
    button: direction === 'question' ? 'Répondre' : 'Voir',
  })));
}

// Rappel J-7 aux offrants dont les reservations ne sont pas encore « achetees ».
// Appele au fil des requetes (au plus une fois par heure, voir api.js) : pas de minuterie
// globale dans le processus partage de la passerelle. Un evenement n'est rappele qu'une fois.
async function reminders(base, now = new Date()) {
  const target = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const evs = db.prepare('SELECT id, title FROM events WHERE reminder_sent = 0 AND date IS NOT NULL AND date <= ? AND date >= ?').all(target, today);
  const mails = [];
  for (const ev of evs) {
    db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(ev.id);
    const listIds = db.prepare('SELECT id FROM lists WHERE event_id = ?').all(ev.id).map((l) => l.id);
    const rows = db.prepare(`SELECT r.giver_id, i.title FROM reservations r JOIN items i ON i.id = r.item_id
      WHERE i.list_id IN (${inList(listIds)}) AND r.status <> 'bought'`).all();
    const byGiver = Map.groupBy(rows, (r) => r.giver_id);
    for (const [giverId, rs] of byGiver) {
      for (const m of withEmail(A.mailboxesFor(giverId))) {
        mails.push({
          to: m.email,
          subject: `Bientôt « ${ev.title} » : cadeaux pas encore achetés`,
          intro: `Bonjour ${m.name},\n\n« ${ev.title} » approche. Ces réservations ne sont pas encore marquées « acheté » :\n${rs.map((r) => `• ${r.title}`).join('\n')}`,
          url: `${base}/#/evenements/${ev.id}`,
          button: 'Voir l’événement',
        });
      }
    }
  }
  await notify(mails);
  return mails.length;
}

module.exports = { itemSnapshot, itemChanged, invited, invitedToEvent, envelopes, santaMessage, reminders };
