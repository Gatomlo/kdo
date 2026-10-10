// « Mes cadeaux » : historique de ce que j'ai offert (ou reserve) a qui, et budget
// personnel par evenement et par personne. Ne concerne que mes reservations (et celles
// des profils que je gere) : rien sur mes propres listes.
const { db, inList } = require('./db');
const A = require('./access');

function myGifts(user) {
  const ids = A.actorIds(user.id);
  const rows = db.prepare(`SELECT r.id, r.quantity, r.status, r.amount, r.giver_id, r.created_at,
      i.title, i.price, i.received_at, l.id AS list_id, l.title AS list_title, l.date AS list_date,
      o.id AS owner_id, o.name AS owner_name, o.color AS owner_color, g.name AS giver_name,
      e.id AS event_id, e.title AS event_title, e.date AS event_date, e.budget AS event_budget
    FROM reservations r JOIN items i ON i.id = r.item_id JOIN lists l ON l.id = i.list_id
    JOIN members o ON o.id = l.owner_id JOIN members g ON g.id = r.giver_id LEFT JOIN events e ON e.id = l.event_id
    WHERE r.giver_id IN (${inList(ids)}) ORDER BY COALESCE(e.date, l.date) DESC, r.created_at DESC`).all();
  return rows.map((r) => {
    const date = r.event_date || r.list_date || new Date(r.created_at).toISOString().slice(0, 10);
    return {
      id: r.id, title: r.title, status: r.status, quantity: r.quantity, participation: r.amount != null,
      // Cout : ma part d'un cadeau commun, sinon prix indicatif x quantite (inconnu si pas de prix).
      cost: r.amount != null ? r.amount : r.price != null ? r.price * r.quantity : null,
      received: !!r.received_at,
      recipient: { id: r.owner_id, name: r.owner_name, color: r.owner_color },
      list: { id: r.list_id, title: r.list_title },
      event: r.event_id ? { id: r.event_id, title: r.event_title, date: r.event_date, budget: r.event_budget } : null,
      date, year: Number(date.slice(0, 4)),
      forName: r.giver_id === user.id ? null : r.giver_name,
    };
  });
}

module.exports = { myGifts };
