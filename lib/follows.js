// Abonnements : etre prevenu quand des articles sont ajoutes a une liste ou pris par quelqu'un
// (la suppression d'un article previent toujours les abonnes). Reserve aux offrants et
// gestionnaires (jamais au destinataire ni aux co-proprietaires ; la liste surprise reste
// invisible pour son destinataire, listAccess).
//  - par liste : list_follows.events = both | add | taken (off = exclue alors que la personne est suivie) ;
//  - par personne : member_follows = toutes ses listes, y compris les futures ;
//  - recap : members.follow_digest = instant | daily | weekly (file follow_queue, envoyee au fil des requetes).
// Les ajouts rapproches sont regroupes (une notification par liste et par abonne toutes les 10 min).
// Aucune minuterie : tout part au fil des requetes (processus partage de la passerelle).
const { db, tx } = require('./db');
const A = require('./access');
const { httpError } = require('./util');
const { circleId } = require('./ctx');

const WINDOW = 10 * 60 * 1000;
const DIGEST_EVERY = { daily: 24 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 };
const EVENTS = ['both', 'add', 'taken'];
const wants = (events, kind) => events === 'both' || events === kind;

const listRow = (listId, memberId) => db.prepare('SELECT * FROM list_follows WHERE list_id = ? AND member_id = ?').get(listId, memberId);
const personRow = (followerId, targetId) => db.prepare('SELECT * FROM member_follows WHERE follower_id = ? AND target_id = ?').get(followerId, targetId);

// Reglage effectif d'un membre sur une liste : { events, scope: 'list' | 'person' } ou null.
function settingsFor(list, memberId) {
  const row = listRow(list.id, memberId);
  if (row) return row.events === 'off' ? null : { events: row.events, scope: row.auto ? 'person' : 'list' };
  const p = personRow(memberId, list.owner_id);
  return p ? { events: p.events, scope: 'person' } : null;
}
const isFollowing = (list, memberId) => !!settingsFor(list, memberId);

// Abonnes d'une liste : [{ id, events }] (hors exclus, seulement offrants/gestionnaires, jamais les invites).
function followersOf(list, excludeIds = []) {
  const byId = new Map();
  for (const r of db.prepare("SELECT member_id, events FROM list_follows WHERE list_id = ? AND events <> 'off'").all(list.id)) byId.set(r.member_id, r.events);
  const muted = new Set(db.prepare('SELECT member_id FROM list_follows WHERE list_id = ?').all(list.id).map((r) => r.member_id));
  for (const r of db.prepare('SELECT follower_id, events FROM member_follows WHERE target_id = ?').all(list.owner_id)) if (!muted.has(r.follower_id)) byId.set(r.follower_id, r.events);
  return [...byId].map(([id, events]) => ({ id, events }))
    .filter((f) => !excludeIds.includes(f.id) && ['viewer', 'manager'].includes(A.roleOn(list, f.id))
      && db.prepare('SELECT 1 FROM members WHERE id = ? AND guest_list_id IS NULL').get(f.id));
}

function requireFollower(user, listId) {
  const a = A.listAccess(listId, user.id);
  if (user.guestListId) throw httpError(403, 'Réservé aux membres du cercle.');
  if (!a.canSeeGifts) throw httpError(400, 'Tu ne peux pas suivre ta propre liste.');
  return a;
}

// Suivre une liste (events : both | add | taken) ou ne plus la suivre (off).
function set(user, listId, events) {
  const a = requireFollower(user, listId);
  const ev = events === 'off' || EVENTS.includes(events) ? events : 'both';
  if (ev === 'off') {
    if (personRow(user.id, a.list.owner_id)) db.prepare(`INSERT INTO list_follows (list_id, member_id, events, auto, created_at) VALUES (?, ?, 'off', 0, ?)
      ON CONFLICT(list_id, member_id) DO UPDATE SET events = 'off', auto = 0, pending = 0, titles = NULL`).run(a.list.id, user.id, Date.now());
    else db.prepare('DELETE FROM list_follows WHERE list_id = ? AND member_id = ?').run(a.list.id, user.id);
  } else {
    db.prepare(`INSERT INTO list_follows (list_id, member_id, events, auto, created_at) VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(list_id, member_id) DO UPDATE SET events = excluded.events, auto = 0`).run(a.list.id, user.id, ev, Date.now());
  }
  return state(a.list, user.id);
}

// Etat renvoye au navigateur pour une liste : suivi effectif + suivi de son proprietaire.
function state(list, memberId) {
  const p = personRow(memberId, list.owner_id);
  const follow = settingsFor(list, memberId);
  return { follow, ownerFollow: p ? p.events : null, following: !!follow };
}

// Suivre toutes les listes d'une personne (y compris les prochaines).
function setPerson(user, targetId, events) {
  if (user.guestListId) throw httpError(403, 'Réservé aux membres du cercle.');
  if (targetId === user.id) throw httpError(400, 'Tu ne peux pas te suivre toi-même.');
  if (!db.prepare('SELECT 1 FROM members WHERE id = ? AND guest_list_id IS NULL AND circle_id = ?').get(targetId, circleId())) throw httpError(404, 'Membre introuvable.');
  tx(() => {
    if (events === 'off') {
      db.prepare('DELETE FROM member_follows WHERE follower_id = ? AND target_id = ?').run(user.id, targetId);
      // Lignes nees de ce suivi (auto) ou exclusions (off) : sans objet maintenant.
      db.prepare(`DELETE FROM list_follows WHERE member_id = ? AND (auto = 1 OR events = 'off') AND list_id IN (SELECT id FROM lists WHERE owner_id = ?)`).run(user.id, targetId);
    } else {
      const ev = EVENTS.includes(events) ? events : 'both';
      db.prepare(`INSERT INTO member_follows (follower_id, target_id, events, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(follower_id, target_id) DO UPDATE SET events = excluded.events`).run(user.id, targetId, ev, Date.now());
      db.prepare(`UPDATE list_follows SET events = ? WHERE member_id = ? AND auto = 1 AND list_id IN (SELECT id FROM lists WHERE owner_id = ?)`).run(ev, user.id, targetId);
    }
  });
}

// « Mes abonnements » : listes suivies (directement ou via une personne) et personnes suivies.
function mine(user) {
  const me = user.id;
  const lists = db.prepare(`SELECT l.id, l.title, l.cover, l.owner_id, l.archived, o.name AS owner_name, f.events, f.auto FROM list_follows f
      JOIN lists l ON l.id = f.list_id JOIN members o ON o.id = l.owner_id WHERE f.member_id = ? AND f.events <> 'off' AND o.circle_id = ?
      ORDER BY o.name COLLATE NOCASE, l.title COLLATE NOCASE`).all(me, circleId())
    .filter((l) => !(l.owner_id === me) && ['viewer', 'manager'].includes(A.roleOn({ id: l.id, owner_id: l.owner_id }, me)));
  const people = db.prepare(`SELECT t.target_id AS id, t.events, m.name FROM member_follows t JOIN members m ON m.id = t.target_id
    WHERE t.follower_id = ? AND m.circle_id = ? ORDER BY m.name COLLATE NOCASE`).all(me, circleId());
  const digest = db.prepare('SELECT follow_digest FROM members WHERE id = ?').get(me).follow_digest;
  return {
    digest,
    lists: lists.map((l) => ({ id: l.id, title: l.title, cover: l.cover, archived: !!l.archived, ownerName: l.owner_name, events: l.events, viaPerson: !!l.auto })),
    people,
  };
}

function clearAll(user) {
  tx(() => {
    db.prepare('DELETE FROM list_follows WHERE member_id = ?').run(user.id);
    db.prepare('DELETE FROM member_follows WHERE follower_id = ?').run(user.id);
    db.prepare('DELETE FROM follow_queue WHERE member_id = ?').run(user.id);
  });
}

function setDigest(user, mode) {
  if (!['instant', 'daily', 'weekly'].includes(mode)) throw httpError(400, 'Choix invalide.');
  db.prepare('UPDATE members SET follow_digest = ?, follow_digest_at = ? WHERE id = ?').run(mode, Date.now(), user.id);
}
const digestOf = (memberId) => (db.prepare('SELECT follow_digest FROM members WHERE id = ?').get(memberId) || {}).follow_digest || 'instant';

// Met un evenement (add | taken) dans le recap du membre.
function queue(memberId, listId, kind, title, who) {
  db.prepare('INSERT INTO follow_queue (member_id, list_id, kind, title, who, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(memberId, listId, kind, String(title).slice(0, 200), who || null, Date.now());
}

// Article ajoute : lot en attente (envoi regroupe) ou file du recap, pour chaque abonne concerne.
function itemAdded(list, actorId, title) {
  for (const f of followersOf(list, [actorId])) {
    if (!wants(f.events, 'add')) continue;
    if (digestOf(f.id) !== 'instant') { queue(f.id, list.id, 'add', title); continue; }
    db.prepare("INSERT OR IGNORE INTO list_follows (list_id, member_id, events, auto, created_at) VALUES (?, ?, ?, 1, ?)").run(list.id, f.id, f.events, Date.now());
    const row = listRow(list.id, f.id);
    const titles = [...JSON.parse(row.titles || '[]'), title].slice(-20);
    db.prepare('UPDATE list_follows SET pending = pending + 1, titles = ? WHERE list_id = ? AND member_id = ?').run(JSON.stringify(titles), list.id, f.id);
  }
}

const dueBatch = () => db.prepare("SELECT 1 FROM list_follows WHERE pending > 0 AND last_sent <= ?").get(Date.now() - WINDOW);
const dueDigest = () => db.prepare(`SELECT 1 FROM follow_queue q JOIN members m ON m.id = q.member_id
  WHERE m.follow_digest = 'instant' OR (m.follow_digest = 'daily' AND m.follow_digest_at <= ?) OR (m.follow_digest = 'weekly' AND m.follow_digest_at <= ?) LIMIT 1`)
  .get(Date.now() - DIGEST_EVERY.daily, Date.now() - DIGEST_EVERY.weekly);

// Envoie ce qui est du : lots d'ajouts dont le delai est ecoule, recaps arrives a echeance.
// `notify` est injecte (evite un cycle d'import).
async function flush(base, notify) {
  let n = 0;
  if (dueBatch()) {
    const rows = db.prepare('SELECT * FROM list_follows WHERE pending > 0 AND last_sent <= ?').all(Date.now() - WINDOW);
    for (const r of rows) {
      // Revendique le lot avant l'envoi (deux requetes simultanees ne l'envoient pas deux fois).
      const claimed = db.prepare('UPDATE list_follows SET pending = 0, titles = NULL, last_sent = ? WHERE list_id = ? AND member_id = ? AND pending = ?').run(Date.now(), r.list_id, r.member_id, r.pending);
      if (!claimed.changes) continue;
      n++;
      await notify.listFollowed(r.list_id, r.member_id, r.pending, JSON.parse(r.titles || '[]'), base);
    }
  }
  if (dueDigest()) {
    const members = db.prepare(`SELECT DISTINCT m.id FROM follow_queue q JOIN members m ON m.id = q.member_id
      WHERE m.follow_digest = 'instant' OR (m.follow_digest = 'daily' AND m.follow_digest_at <= ?) OR (m.follow_digest = 'weekly' AND m.follow_digest_at <= ?)`)
      .all(Date.now() - DIGEST_EVERY.daily, Date.now() - DIGEST_EVERY.weekly).map((r) => r.id);
    for (const id of members) {
      const rows = tx(() => {
        const rs = db.prepare('SELECT * FROM follow_queue WHERE member_id = ? ORDER BY id').all(id);
        db.prepare('DELETE FROM follow_queue WHERE member_id = ?').run(id);
        db.prepare('UPDATE members SET follow_digest_at = ? WHERE id = ?').run(Date.now(), id);
        return rs;
      });
      if (rows.length) { n++; await notify.digest(id, rows, base); }
    }
  }
  return n;
}

module.exports = { settingsFor, isFollowing, state, followersOf, wants, set, setPerson, mine, clearAll, setDigest, digestOf, queue, itemAdded, flush };
