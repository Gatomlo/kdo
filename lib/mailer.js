// Envoi des e-mails (invitations, notifications, lien de connexion) via nodemailer.
// Mode choisi par HOTTE_MAIL (log | smtp | sendmail | off) ou automatiquement :
//  - "log"      : rien n'est envoye, le message est ecrit dans la console et garde en
//                 memoire (developpement, tests : voir outbox) ;
//  - "smtp"     : si SMTP_HOST est defini (SMTP_PORT, SMTP_SECURE=1, SMTP_USER, SMTP_PASS) ;
//  - "sendmail" : programme sendmail de l'hebergement (HOTTE_MAIL=sendmail) ;
//  - "off"      : par defaut sans SMTP_HOST : aucun e-mail, l'app fonctionne avec des
//                 mots de passe et des liens a copier ; les notifications sont ignorees.
// MAIL_FROM fixe l'adresse d'expedition. Aucun identifiant dans le code.
const SENDMAIL_PATHS = ['sendmail', '/usr/sbin/sendmail', '/usr/lib/sendmail', '/usr/bin/sendmail'];
const outbox = [];

function mode() {
  if (process.env.HOTTE_MAIL) return process.env.HOTTE_MAIL;
  return process.env.SMTP_HOST ? 'smtp' : 'off';
}
const enabled = () => mode() !== 'off';

let smtp = null;
function smtpTransport() {
  if (!smtp) {
    smtp = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === '1',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return smtp;
}

async function viaSendmail(payload) {
  const nodemailer = require('nodemailer');
  const candidates = process.env.SENDMAIL_PATH ? [process.env.SENDMAIL_PATH] : SENDMAIL_PATHS;
  let last;
  for (const p of candidates) {
    try {
      await nodemailer.createTransport({ sendmail: true, newline: 'unix', path: p }).sendMail(payload);
      return;
    } catch (e) { last = e; }
  }
  throw new Error(`sendmail introuvable (${candidates.join(', ')}) : ${last && last.message}`);
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Message avec un bouton vers `url`. Leve une erreur si l'envoi est desactive.
async function send({ to, subject, intro, url, button, outro }) {
  const payload = {
    from: `La Hotte <${process.env.MAIL_FROM || process.env.SMTP_USER || 'hotte@localhost'}>`,
    to,
    subject,
    text: `${intro}\n\n${url}\n\n${outro || ''}`,
    html: `<p>${escHtml(intro).replace(/\n/g, '<br>')}</p><p><a href="${escHtml(url)}" style="display:inline-block;background:#d9405a;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:700">${escHtml(button)}</a></p><p style="color:#888;font-size:13px">${escHtml(outro || '')}</p>`,
  };
  const m = mode();
  if (m === 'off') throw new Error('Envoi d\'e-mails non configuré.');
  if (m === 'log') {
    outbox.push(payload);
    if (outbox.length > 100) outbox.shift();
    if (!process.env.HOTTE_QUIET) console.log(`[mail] ${to} : ${subject}\n       ${url}`);
    return;
  }
  if (m === 'smtp') await smtpTransport().sendMail(payload);
  else await viaSendmail(payload);
}

// Notification : ignoree si les e-mails sont desactives, jamais d'erreur remontee
// (une notification ratee ne doit pas faire echouer l'action qui l'a declenchee).
async function notify(mails) {
  if (!enabled()) return;
  await Promise.all(mails.map((m) => send(m).catch((e) => console.error('E-mail non envoyé', m.to, e.message))));
}

module.exports = { send, notify, outbox, mode, enabled };
