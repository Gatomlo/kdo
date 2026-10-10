// Journal de l'administrateur : arrivees dans le cercle, invitations, partages hors
// cercle, tirages, listes d'anniversaire creees… Jamais de contenu de cadeau (pas de
// spoiler, meme pour l'administrateur). Les 500 dernieres entrees sont gardees.
const { db } = require('./db');

function log(kind, text, actorId = null) {
  try {
    db.prepare('INSERT INTO activity (at, kind, text, actor_id) VALUES (?, ?, ?, ?)').run(Date.now(), kind, String(text).slice(0, 300), actorId);
    db.prepare('DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
  } catch (e) { console.error('Journal', e.message); }
}

function recent(limit = 100) {
  return db.prepare(`SELECT a.id, a.at, a.kind, a.text, m.name AS actor FROM activity a LEFT JOIN members m ON m.id = a.actor_id
    ORDER BY a.id DESC LIMIT ?`).all(limit);
}

module.exports = { log, recent };
