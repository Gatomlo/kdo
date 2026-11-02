// Journal de l'administrateur : arrivees dans le cercle, invitations, partages hors
// cercle, tirages, listes d'anniversaire creees… Jamais de contenu de cadeau (pas de
// spoiler, meme pour l'administrateur). Les 500 dernieres entrees sont gardees.
const { db } = require('./db');
const { circleId } = require('./ctx');

// Cercle : celui de la requete, sinon celui de l'acteur, sinon `circle` (taches de fond).
function log(kind, text, actorId = null, circle = null) {
  try {
    const cid = circle || circleId() || (actorId && (db.prepare('SELECT circle_id FROM members WHERE id = ?').get(actorId) || {}).circle_id) || null;
    db.prepare('INSERT INTO activity (at, kind, text, actor_id, circle_id) VALUES (?, ?, ?, ?, ?)').run(Date.now(), kind, String(text).slice(0, 300), actorId, cid);
    db.prepare('DELETE FROM activity WHERE circle_id IS ? AND id <= (SELECT id FROM activity WHERE circle_id IS ? ORDER BY id DESC LIMIT 1 OFFSET 500)').run(cid, cid);
  } catch (e) { console.error('Journal', e.message); }
}

function recent(limit = 100) {
  return db.prepare(`SELECT a.id, a.at, a.kind, a.text, m.name AS actor FROM activity a LEFT JOIN members m ON m.id = a.actor_id
    WHERE a.circle_id = ? ORDER BY a.id DESC LIMIT ?`).all(circleId(), limit);
}

module.exports = { log, recent };
