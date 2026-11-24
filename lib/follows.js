// Abonnement a une liste : etre prevenu quand de nouveaux articles y sont ajoutes.
// Reserve aux offrants et gestionnaires (jamais au destinataire ni aux co-proprietaires :
// cela ne leur apprendrait rien et la liste surprise reste invisible pour son destinataire).
// Les ajouts rapproches sont regroupes : au plus une notification par liste et par abonne
// toutes les 10 minutes (lot en attente envoye au fil des requetes, sans minuterie).
const { db } = require('./db');
const A = require('./access');
const { httpError } = require('./util');

const WINDOW = 10 * 60 * 1000;

const isFollowing = (listId, memberId) => !!db.prepare('SELECT 1 FROM list_follows WHERE list_id = ? AND member_id = ?').get(listId, memberId);

function set(user, listId, on) {
  const a = A.listAccess(listId, user.id);
  if (user.guestListId) throw httpError(403, 'Réservé aux membres du cercle.');
  if (!a.canSeeGifts) throw httpError(400, 'Tu ne peux pas t’abonner à ta propre liste.');
  if (on) db.prepare('INSERT OR IGNORE INTO list_follows (list_id, member_id, created_at) VALUES (?, ?, ?)').run(a.list.id, user.id, Date.now());
  else db.prepare('DELETE FROM list_follows WHERE list_id = ? AND member_id = ?').run(a.list.id, user.id);
  return { following: !!on };
}

// Article ajoute : met le titre dans le lot de chaque abonne (sauf l'auteur).
function itemAdded(list, actorId, title) {
  const rows = db.prepare('SELECT member_id, titles FROM list_follows WHERE list_id = ? AND member_id <> ?').all(list.id, actorId);
  for (const r of rows) {
    if (A.roleOn(list, r.member_id) !== 'viewer' && A.roleOn(list, r.member_id) !== 'manager') continue; // a change de role : plus d'alerte
    const titles = [...JSON.parse(r.titles || '[]'), title].slice(-20);
    db.prepare('UPDATE list_follows SET pending = pending + 1, titles = ? WHERE list_id = ? AND member_id = ?').run(JSON.stringify(titles), list.id, r.member_id);
  }
}

// Abonnes à prévenir d'une réservation (ni celui qui prend le cadeau, ni quelqu'un qui n'est plus offrant).
function followersExcept(list, excludeIds) {
  return db.prepare('SELECT member_id FROM list_follows WHERE list_id = ?').all(list.id).map((r) => r.member_id)
    .filter((id) => !excludeIds.includes(id) && ['viewer', 'manager'].includes(A.roleOn(list, id)));
}

const due = () => db.prepare('SELECT 1 FROM list_follows WHERE pending > 0 AND last_sent <= ?').get(Date.now() - WINDOW);

// Envoie les lots dont le delai est ecoule. `notify` injecte pour eviter un cycle.
async function flush(base, notify) {
  if (!due()) return 0;
  const rows = db.prepare('SELECT * FROM list_follows WHERE pending > 0 AND last_sent <= ?').all(Date.now() - WINDOW);
  for (const r of rows) {
    // Revendique le lot avant l'envoi (deux requetes simultanees ne l'envoient pas deux fois).
    const claimed = db.prepare('UPDATE list_follows SET pending = 0, titles = NULL, last_sent = ? WHERE list_id = ? AND member_id = ? AND pending = ?').run(Date.now(), r.list_id, r.member_id, r.pending);
    if (!claimed.changes) continue;
    await notify.listFollowed(r.list_id, r.member_id, r.pending, JSON.parse(r.titles || '[]'), base);
  }
  return rows.length;
}

module.exports = { isFollowing, set, itemAdded, followersExcept, flush };
