// Evenements (§4.3) et Secret Santa (§4.4).
// Secret : une paire (ss_pairs) n'est lue que par son donateur, ou les gestionnaires
// d'un donateur sans compte. L'organisateur voit seulement qui a ouvert son enveloppe.
// La cible ne voit jamais le donateur (messages anonymes).
const { db, tx, inList } = require('./db');
const { httpError, str, optStr, cents, isoDate, today } = require('./util');
const A = require('./access');
const L = require('./lists');
const { draw, key } = require('./santa');

const getEvent = (id) => {
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!ev) throw httpError(404, 'Événement introuvable.');
  return ev;
};
const participantIds = (eventId) => db.prepare('SELECT member_id FROM event_participants WHERE event_id = ?').all(eventId).map((r) => r.member_id);

// Organisateur (ou administrateur si l'organisateur a quitte le cercle).
function requireOrganizer(user, id) {
  const ev = getEvent(id);
  if (ev.organizer_id !== user.id && !(ev.organizer_id == null && user.isAdmin)) throw httpError(403, 'Réservé à l’organisateur de l’événement.');
  return ev;
}

function eventsList(user) {
  const mine = new Set(A.actorIds(user.id));
  const parts = db.prepare('SELECT event_id, member_id FROM event_participants').all();
  const santa = new Set(db.prepare('SELECT event_id FROM ss_draws').all().map((d) => d.event_id));
  const t = today();
  const evs = db.prepare('SELECT * FROM events ORDER BY date IS NULL, date').all().map((e) => {
    const ps = parts.filter((p) => p.event_id === e.id);
    return {
      id: e.id, title: e.title, date: e.date, place: e.place, participants: ps.length, santa: santa.has(e.id),
      involved: e.organizer_id === user.id || ps.some((p) => mine.has(p.member_id)),
    };
  });
  return { upcoming: evs.filter((e) => !e.date || e.date >= t), past: evs.filter((e) => e.date && e.date < t).reverse() };
}

function eventFields(b) {
  const title = str(b.title, 120);
  if (!title) throw httpError(400, 'Donne un titre à l’événement.');
  return { title, date: isoDate(b.date), place: optStr(b.place, 120), budget: cents(b.budget) };
}
const cleanIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))]
  .filter((id) => db.prepare('SELECT 1 FROM members WHERE id = ?').get(id));

function createEvent(user, b) {
  const f = eventFields(b);
  const ids = cleanIds(b.participants);
  return tx(() => {
    const id = Number(db.prepare('INSERT INTO events (title, date, place, budget, organizer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(f.title, f.date, f.place, f.budget, user.id, Date.now()).lastInsertRowid);
    ids.forEach((m) => db.prepare('INSERT INTO event_participants (event_id, member_id) VALUES (?, ?)').run(id, m));
    return { id, added: ids };
  });
}

function updateEvent(user, id, b) {
  const ev = requireOrganizer(user, id);
  const f = eventFields(b);
  const before = new Set(participantIds(id));
  const ids = cleanIds(b.participants);
  tx(() => {
    db.prepare('UPDATE events SET title = ?, date = ?, place = ?, budget = ?, reminder_sent = ? WHERE id = ?')
      .run(f.title, f.date, f.place, f.budget, f.date === ev.date ? ev.reminder_sent : 0, id);
    db.prepare('DELETE FROM event_participants WHERE event_id = ?').run(id);
    ids.forEach((m) => db.prepare('INSERT INTO event_participants (event_id, member_id) VALUES (?, ?)').run(id, m));
  });
  return ids.filter((m) => !before.has(m));
}

function deleteEvent(user, id) {
  requireOrganizer(user, id);
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

function eventView(user, id) {
  const ev = getEvent(id);
  const participants = db.prepare(`SELECT m.id, m.name, m.color, m.email FROM event_participants p JOIN members m ON m.id = p.member_id
    WHERE p.event_id = ? ORDER BY m.name COLLATE NOCASE`).all(id);
  const lists = L.summaries(user, { eventId: id });
  const hidden = A.hiddenListIds(user.id);
  const offList = db.prepare(`SELECT list_id FROM off_list_gifts WHERE list_id IN (${inList(lists.map((l) => l.id))})`).all();
  // « Qui a deja de quoi » : jamais pour soi ni pour une liste dont on est co-proprietaire.
  const coverage = participants.filter((p) => p.id !== user.id).map((p) => {
    const theirs = lists.filter((l) => l.owner.id === p.id && l.gifts && !hidden.has(l.id));
    return {
      id: p.id, name: p.name, color: p.color, lists: theirs.length,
      gifts: theirs.reduce((s, l) => s + l.gifts.taken, 0) + offList.filter((o) => theirs.some((l) => l.id === o.list_id)).length,
    };
  });
  const d = db.prepare('SELECT * FROM ss_draws WHERE event_id = ?').get(id);
  const mine = new Set(A.actorIds(user.id));
  const organizer = ev.organizer_id ? db.prepare('SELECT name FROM members WHERE id = ?').get(ev.organizer_id) : null;
  return {
    event: { id: ev.id, title: ev.title, date: ev.date, place: ev.place, budget: ev.budget },
    organizer: organizer ? organizer.name : null,
    isOrganizer: ev.organizer_id === user.id || (ev.organizer_id == null && user.isAdmin),
    participants: participants.map((p) => ({ id: p.id, name: p.name, color: p.color, hasAccount: !!p.email })),
    isParticipant: participants.some((p) => mine.has(p.id)),
    lists,
    coverage,
    santa: d && { status: d.status, budget: d.budget, deadline: d.deadline, envelopes: myPairs(user, id).length },
  };
}

// ---------- Secret Santa : organisation ----------
function drawOf(eventId) {
  const d = db.prepare('SELECT * FROM ss_draws WHERE event_id = ?').get(eventId);
  if (!d) throw httpError(404, 'Le Secret Santa n’est pas activé pour cet événement.');
  return d;
}
const anyOpened = (drawId) => !!db.prepare('SELECT 1 FROM ss_pairs WHERE draw_id = ? AND opened_at IS NOT NULL').get(drawId);

function enableSanta(user, eventId) {
  const ev = requireOrganizer(user, eventId);
  db.prepare('INSERT OR IGNORE INTO ss_draws (event_id, budget, created_at) VALUES (?, ?, ?)').run(ev.id, ev.budget, Date.now());
}

// Vue de l'organisateur : jamais la colonne receiver_id.
function santaAdmin(user, eventId) {
  const ev = requireOrganizer(user, eventId);
  const d = drawOf(ev.id);
  const ids = participantIds(ev.id);
  const names = A.memberNames(ids);
  const nm = (id) => (names.get(id) || {}).name || '(retiré)';
  const opened = db.prepare('SELECT giver_id, opened_at FROM ss_pairs WHERE draw_id = ?').all(d.id);
  const givers = new Set(opened.map((o) => o.giver_id));
  return {
    event: { id: ev.id, title: ev.title },
    draw: { status: d.status, budget: d.budget, deadline: d.deadline, avoidPrevious: !!d.avoid_previous, drawnAt: d.drawn_at },
    members: ids.map((id) => ({ id, name: nm(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    exclusions: db.prepare('SELECT member_a, member_b FROM ss_exclusions WHERE draw_id = ?').all(d.id).map((x) => ({ a: x.member_a, b: x.member_b, label: `${nm(x.member_a)} ↔ ${nm(x.member_b)}` })),
    opened: opened.map((o) => ({ name: nm(o.giver_id), opened: !!o.opened_at })).sort((a, b) => a.name.localeCompare(b.name)),
    outdated: d.status === 'drawn' && (givers.size !== ids.length || ids.some((id) => !givers.has(id))),
  };
}

function updateSanta(user, eventId, b) {
  const d = drawOf(requireOrganizer(user, eventId).id);
  db.prepare('UPDATE ss_draws SET budget = ?, deadline = ?, avoid_previous = ? WHERE id = ?')
    .run(cents(b.budget), isoDate(b.deadline), b.avoidPrevious ? 1 : 0, d.id);
}

function addExclusion(user, eventId, a, b) {
  const ev = requireOrganizer(user, eventId);
  const d = drawOf(ev.id);
  const [x, y] = [Number(a), Number(b)].sort((p, q) => p - q);
  const ps = participantIds(ev.id);
  if (x === y || !ps.includes(x) || !ps.includes(y)) throw httpError(400, 'Choisis deux participants différents.');
  db.prepare('INSERT OR IGNORE INTO ss_exclusions (draw_id, member_a, member_b) VALUES (?, ?, ?)').run(d.id, x, y);
}

function removeExclusion(user, eventId, a, b) {
  const d = drawOf(requireOrganizer(user, eventId).id);
  db.prepare('DELETE FROM ss_exclusions WHERE draw_id = ? AND member_a = ? AND member_b = ?').run(d.id, Number(a), Number(b));
}

// Paires interdites : exclusions saisies (dans les deux sens), profil -> ses gestionnaires
// (ils verraient qui leur offre), et si demande les paires du tirage precedent.
function forbiddenPairs(d, ps, withPrevious) {
  const f = new Set();
  for (const x of db.prepare('SELECT member_a, member_b FROM ss_exclusions WHERE draw_id = ?').all(d.id)) {
    f.add(key(x.member_a, x.member_b));
    f.add(key(x.member_b, x.member_a));
  }
  for (const x of db.prepare(`SELECT profile_id, manager_id FROM profile_managers WHERE profile_id IN (${inList(ps)})`).all()) f.add(key(x.profile_id, x.manager_id));
  if (withPrevious) {
    const prev = db.prepare('SELECT id FROM ss_draws WHERE id <> ? AND drawn_at IS NOT NULL ORDER BY drawn_at DESC LIMIT 1').get(d.id);
    if (prev) for (const p of db.prepare('SELECT giver_id, receiver_id FROM ss_pairs WHERE draw_id = ?').all(prev.id)) f.add(key(p.giver_id, p.receiver_id));
  }
  return f;
}

// Tirage (ou nouveau tirage). Apres ouverture d'une enveloppe : seulement avec force.
// Renvoie { redraw } pour prevenir les participants.
function runDraw(user, eventId, force) {
  const ev = requireOrganizer(user, eventId);
  const d = drawOf(ev.id);
  const redraw = d.status === 'drawn';
  if (redraw && anyOpened(d.id) && !force)
    throw httpError(409, 'Des enveloppes ont déjà été ouvertes : confirme le nouveau tirage (tous les participants seront prévenus).');
  const ps = participantIds(ev.id);
  if (ps.length < 3) throw httpError(400, 'Il faut au moins 3 participants pour un Secret Santa.');
  const result = draw(ps, forbiddenPairs(d, ps, !!d.avoid_previous));
  if (!result) {
    if (d.avoid_previous && draw(ps, forbiddenPairs(d, ps, false)))
      throw httpError(409, 'Tirage impossible avec la règle « pas la même personne que la dernière fois » : désactive-la ou retire des exclusions.');
    throw httpError(409, 'Tirage impossible : les exclusions sont trop nombreuses pour que chacun ait quelqu’un. Retires-en quelques-unes.');
  }
  tx(() => {
    db.prepare('DELETE FROM ss_pairs WHERE draw_id = ?').run(d.id);
    for (const [g, r] of result) db.prepare('INSERT INTO ss_pairs (draw_id, giver_id, receiver_id) VALUES (?, ?, ?)').run(d.id, g, r);
    db.prepare("UPDATE ss_draws SET status = 'drawn', drawn_at = ? WHERE id = ?").run(Date.now(), d.id);
  });
  return { redraw };
}

function disableSanta(user, eventId, force) {
  const d = drawOf(requireOrganizer(user, eventId).id);
  if (anyOpened(d.id) && !force) throw httpError(409, 'Des enveloppes ont déjà été ouvertes : confirme la désactivation.');
  db.prepare('DELETE FROM ss_draws WHERE id = ?').run(d.id);
}

// ---------- Secret Santa : enveloppes ----------
// Paires dont l'utilisateur peut ouvrir l'enveloppe : la sienne + celles des profils geres.
function myPairs(user, eventId) {
  return db.prepare(`SELECT p.* FROM ss_pairs p JOIN ss_draws d ON d.id = p.draw_id
    WHERE d.event_id = ? AND p.giver_id IN (${inList(A.actorIds(user.id))}) ORDER BY p.giver_id <> ?, p.id`).all(eventId, user.id);
}

const messagesOf = (pairId) => db.prepare('SELECT id, direction, body, created_at AS at FROM ss_messages WHERE pair_id = ? ORDER BY created_at, id').all(pairId);

function envelopeView(user, eventId) {
  const ev = getEvent(eventId);
  const d = db.prepare('SELECT status, budget, deadline FROM ss_draws WHERE event_id = ?').get(ev.id);
  const mine = A.actorIds(user.id);
  const nm = (id) => db.prepare('SELECT name, color FROM members WHERE id = ?').get(id);
  const envelopes = myPairs(user, ev.id).map((p) => {
    const base = { pairId: p.id, forName: p.giver_id === user.id ? null : nm(p.giver_id).name, opened: !!p.opened_at };
    // Enveloppe fermee : la cible ne quitte pas le serveur.
    if (!p.opened_at) return { ...base, receiver: null, lists: [], messages: [] };
    let lists = db.prepare('SELECT id, title, cover FROM lists WHERE owner_id = ? AND event_id = ?').all(p.receiver_id, ev.id);
    if (!lists.length) lists = db.prepare('SELECT id, title, cover FROM lists WHERE owner_id = ? AND archived = 0').all(p.receiver_id);
    return { ...base, receiver: nm(p.receiver_id), lists, messages: messagesOf(p.id) };
  });
  // Cote destinataire : les messages seuls, sans rien sur le donateur.
  const received = db.prepare(`SELECT p.id, p.receiver_id FROM ss_pairs p JOIN ss_draws d ON d.id = p.draw_id
    WHERE d.event_id = ? AND p.receiver_id IN (${inList(mine)})`).all(ev.id)
    .map((p) => ({ pairId: p.id, forName: p.receiver_id === user.id ? null : nm(p.receiver_id).name, messages: messagesOf(p.id) }));
  return { event: { id: ev.id, title: ev.title }, draw: d || null, envelopes, received };
}

function pairById(id) {
  const p = db.prepare('SELECT * FROM ss_pairs WHERE id = ?').get(id);
  if (!p) throw httpError(404, 'Enveloppe introuvable.');
  return p;
}

function openEnvelope(user, pairId) {
  const p = pairById(pairId);
  if (!A.actorIds(user.id).includes(p.giver_id)) throw httpError(403, 'Ce n’est pas ton enveloppe.');
  if (!p.opened_at) db.prepare('UPDATE ss_pairs SET opened_at = ? WHERE id = ?').run(Date.now(), p.id);
  return p;
}

// direction : 'question' (donateur, anonyme) ou 'reply' (cible).
function postMessage(user, pairId, direction, body) {
  const p = pairById(pairId);
  const side = direction === 'question' ? p.giver_id : p.receiver_id;
  if (!A.actorIds(user.id).includes(side)) throw httpError(403, 'Accès refusé.');
  if (direction === 'question' && !p.opened_at) throw httpError(400, 'Ouvre d’abord ton enveloppe.');
  const text = str(body, 1000);
  if (!text) throw httpError(400, 'Message vide.');
  db.prepare('INSERT INTO ss_messages (pair_id, direction, body, created_at) VALUES (?, ?, ?, ?)').run(p.id, direction, text, Date.now());
  return { pair: p, text };
}

// Enveloppes du tableau de bord (tous evenements).
function myEnvelopes(user) {
  return db.prepare(`SELECT p.id, p.opened_at, p.giver_id, m.name AS giver_name, e.id AS event_id, e.title, e.date FROM ss_pairs p
    JOIN ss_draws d ON d.id = p.draw_id JOIN events e ON e.id = d.event_id JOIN members m ON m.id = p.giver_id
    WHERE p.giver_id IN (${inList(A.actorIds(user.id))}) AND (e.date IS NULL OR e.date >= ?) ORDER BY e.date, p.giver_id <> ?`).all(today(), user.id)
    .map((r) => ({ eventId: r.event_id, title: r.title, date: r.date, opened: !!r.opened_at, forName: r.giver_id === user.id ? null : r.giver_name }));
}

module.exports = {
  getEvent, participantIds, requireOrganizer, eventsList, createEvent, updateEvent, deleteEvent, eventView,
  enableSanta, santaAdmin, updateSanta, addExclusion, removeExclusion, runDraw, disableSanta,
  envelopeView, openEnvelope, postMessage, myEnvelopes,
};
