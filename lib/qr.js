// QR code (SVG) d'un lien de l'app : invitation familiale a scanner, lien de partage.
const qrcode = require('qrcode-generator');
const { httpError } = require('./util');

function svg(text) {
  const t = String(text || '');
  if (!/^https?:\/\//.test(t) || t.length > 500) throw httpError(400, 'Lien invalide.');
  const q = qrcode(0, 'M');
  q.addData(t);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

module.exports = { svg };
