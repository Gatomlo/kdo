// Envoi des e-mails (invitations, notifications, lien de connexion) via nodemailer.
// Configuration, par ordre de priorite :
//  1. HOTTE_MAIL (variable d'environnement) : log | smtp | sendmail | off — force le mode
//     ("log" : rien n'est envoye, message ecrit dans la console et garde en memoire, tests) ;
//  2. reglages saisis par l'administrateur dans l'app (Cercle > Reglages e-mail, table
//     meta, cle "smtp") : rien a configurer sur le serveur ;
//  3. variables HOTTE_SMTP_HOST / SMTP_HOST (+ _PORT, _SECURE=1, _USER, _PASS), MAIL_FROM.
// Sans configuration : "off", l'app fonctionne avec des liens a copier.
const { getSetting } = require('./db');

const SENDMAIL_PATHS = ['sendmail', '/usr/sbin/sendmail', '/usr/lib/sendmail', '/usr/bin/sendmail'];
const outbox = [];

const env = (k) => process.env['HOTTE_' + k] || process.env[k] || '';
function smtpConfig() {
  const s = getSetting('smtp');
  if (s && s.host) return s;
  if (env('SMTP_HOST')) {
    return { host: env('SMTP_HOST'), port: parseInt(env('SMTP_PORT'), 10) || 587, secure: env('SMTP_SECURE') === '1', user: env('SMTP_USER'), pass: env('SMTP_PASS'), from: env('MAIL_FROM') };
  }
  return null;
}

function mode() {
  if (process.env.HOTTE_MAIL) return process.env.HOTTE_MAIL;
  return smtpConfig() ? 'smtp' : 'off';
}
const enabled = () => mode() !== 'off';

// Transport recree si les reglages changent.
let smtp = null, smtpKey = '';
function smtpTransport() {
  const c = smtpConfig();
  if (!c) throw new Error('Serveur SMTP non configuré.');
  const key = JSON.stringify(c);
  if (!smtp || key !== smtpKey) {
    smtp = require('nodemailer').createTransport({
      host: c.host, port: c.port || 587, secure: !!c.secure,
      auth: c.user ? { user: c.user, pass: c.pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000,
    });
    smtpKey = key;
  }
  return smtp;
}

function fromAddress() {
  const c = smtpConfig() || {};
  return c.from || process.env.MAIL_FROM || c.user || 'hotte@localhost';
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
    from: `La Hotte <${fromAddress()}>`,
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

// Verifie la connexion au serveur SMTP (reglages e-mail) : leve une erreur lisible.
async function verify() {
  if (mode() !== 'smtp') return;
  await smtpTransport().verify();
}

module.exports = { send, notify, verify, outbox, mode, enabled, smtpConfig };
