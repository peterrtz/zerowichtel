// Versand reiner Text-Mails – kein HTML: keine Tracking-Pixel, keine Schriftarten, keine Bilder.
// Drei Wege: SMTP (z. B. mailbox.org), Brevo-API oder Log (nur Entwicklung und Tests).
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import { appendFileSync } from 'node:fs';

export class MailError extends Error {}

// ------------------------------------------------------------------ SMTP

/** Kopfzeile nach RFC 2047 (Q-Kodierung), nur wenn nötig; lange Texte als mehrere kodierte Wörter. */
export function encodeHeader(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = [];
  let cur = '';
  for (const ch of s) {
    const enc = [...Buffer.from(ch)].map((b) => (/[A-Za-z0-9!*+\-/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b)
      : b === 0x20 ? '_' : `=${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
    if (cur.length + enc.length > 63) { words.push(cur); cur = ''; }
    cur += enc;
  }
  words.push(cur);
  return words.map((w) => `=?UTF-8?Q?${w}?=`).join('\r\n ');
}

/** Quoted-Printable (RFC 2045) für Text mit CRLF-Zeilenenden; Zeilen höchstens 76 Zeichen. */
export function quotedPrintable(text) {
  return text.split('\r\n').map((line) => {
    const bytes = Buffer.from(line);
    let out = '';
    let cur = '';
    bytes.forEach((b, i) => {
      const last = i === bytes.length - 1;
      const plain = (b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last);
      const enc = plain ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`;
      if (cur.length + enc.length > 75) { out += `${cur}=\r\n`; cur = ''; }
      cur += enc;
    });
    return out + cur;
  }).join('\r\n');
}

/** Liest SMTP-Antworten (auch mehrzeilige wie „250-…“ … „250 …“) aus einem Socket. */
function replies(sock) {
  let buf = '';
  let waiting = null;
  let error = null;
  const pump = () => {
    if (!waiting) return;
    if (error) { const w = waiting; waiting = null; w.reject(error); return; }
    const lines = buf.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].length < 4 || lines[i][3] !== '-') {
        buf = lines.slice(i + 1).join('\n');
        const w = waiting;
        waiting = null;
        w.resolve(parseInt(lines[i].slice(0, 3), 10));
        return;
      }
    }
  };
  const onData = (d) => { buf += d.toString('latin1'); pump(); };
  sock.on('data', onData);
  sock.on('error', (e) => { error = e; pump(); });
  sock.on('close', () => { error ??= new MailError('SMTP-Verbindung geschlossen.'); pump(); });
  return {
    next: () => new Promise((resolve, reject) => { waiting = { resolve, reject }; pump(); }),
    stop: () => sock.off('data', onData),
  };
}

/**
 * Schlanker SMTP-Versand: STARTTLS auf Port 587 ('tls') oder implizites TLS auf 465 ('ssl'), AUTH LOGIN.
 * Zertifikate werden immer geprüft. 'none' (unverschlüsselt) nur für 127.0.0.1 in Tests.
 */
export class SmtpMailer {
  constructor({ host, port = 587, user = '', pass = '', fromEmail, fromName = 'ZeroWichtel', secure = 'tls', timeout = 10 }) {
    Object.assign(this, { host, port, user, pass, fromEmail, fromName, secure, timeout });
  }

  async send(to, subject, text) {
    if (/[\r\n]/.test(to + subject + this.fromEmail + this.fromName)) throw new MailError('Ungültige Kopfzeile.');
    if (this.secure === 'none' && this.host !== '127.0.0.1') throw new MailError('Unverschlüsselter SMTP-Versand ist nur für lokale Tests erlaubt.');

    let sock = await this.#connect();
    try {
      let r = replies(sock);
      const cmd = async (line, ok) => {
        if (line !== null) sock.write(`${line}\r\n`);
        const code = await r.next();
        if (!(Array.isArray(ok) ? ok : [ok]).includes(code)) throw new MailError(`SMTP-Fehler ${code}.`);
      };
      const ehlo = `EHLO ${os.hostname() || 'localhost'}`;
      await cmd(null, 220);
      await cmd(ehlo, 250);
      if (this.secure === 'tls') {
        await cmd('STARTTLS', 220);
        r.stop();
        sock = await this.#upgrade(sock);
        r = replies(sock);
        await cmd(ehlo, 250);
      }
      if (this.user !== '') {
        await cmd('AUTH LOGIN', 334);
        await cmd(Buffer.from(this.user).toString('base64'), 334);
        await cmd(Buffer.from(this.pass).toString('base64'), 235);
      }
      await cmd(`MAIL FROM:<${this.fromEmail}>`, 250);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd('DATA', 354);
      await cmd(`${this.#message(to, subject, text)}\r\n.`, 250);
      await cmd('QUIT', 221);
    } finally {
      sock.destroy();
    }
  }

  #connect() {
    return new Promise((resolve, reject) => {
      const opts = { host: this.host, port: this.port, ...this.#sni() };
      const sock = this.secure === 'ssl' ? tls.connect(opts) : net.connect(opts);
      sock.setTimeout(this.timeout * 1000, () => sock.destroy(new MailError('SMTP-Zeitüberschreitung.')));
      sock.once(this.secure === 'ssl' ? 'secureConnect' : 'connect', () => resolve(sock));
      sock.once('error', (e) => reject(new MailError(`SMTP nicht erreichbar: ${e.message}`)));
    });
  }

  /** SNI nur für Namen, nicht für IP-Adressen (RFC 6066); geprüft wird das Zertifikat in beiden Fällen. */
  #sni() {
    return net.isIP(this.host) ? {} : { servername: this.host };
  }

  #upgrade(plain) {
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ socket: plain, host: this.host, minVersion: 'TLSv1.2', ...this.#sni() }, () => resolve(sock));
      sock.setTimeout(this.timeout * 1000, () => sock.destroy(new MailError('SMTP-Zeitüberschreitung.')));
      sock.once('error', () => reject(new MailError('STARTTLS fehlgeschlagen.')));
    });
  }

  #message(to, subject, text) {
    const domain = this.fromEmail.includes('@') ? this.fromEmail.slice(this.fromEmail.lastIndexOf('@') + 1) : 'localhost';
    const headers = [
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
      `From: ${encodeHeader(this.fromName)} <${this.fromEmail}>`,
      `To: <${to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domain}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      'Auto-Submitted: auto-generated',
    ];
    const body = quotedPrintable(text.replace(/\r\n|\r|\n/g, '\r\n')).replace(/^\./gm, '..'); // Punkt am Zeilenanfang verdoppeln
    return `${headers.join('\r\n')}\r\n\r\n${body}`;
  }
}

// ------------------------------------------------------------------ Brevo

/**
 * Brevo Transactional Email API. Nur textContent: ohne HTML kein Öffnungs-Tracking.
 * Klick-Tracking und das Speichern von Vorschauen müssen im Brevo-Konto abgeschaltet sein (siehe README).
 */
export class BrevoMailer {
  static ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

  constructor({ apiKey, fromEmail, fromName = 'ZeroWichtel', endpoint = BrevoMailer.ENDPOINT, timeout = 10 }) {
    Object.assign(this, { apiKey, fromEmail, fromName, endpoint, timeout });
  }

  async send(to, subject, text) {
    if (!this.endpoint.startsWith('https://') && !this.endpoint.startsWith('http://127.0.0.1')) throw new MailError('Brevo: nur HTTPS erlaubt.');
    let res;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: this.fromName, email: this.fromEmail },
          to: [{ email: to }],
          subject,
          textContent: text,
          tags: ['zerowichtel'],
        }),
        signal: AbortSignal.timeout(this.timeout * 1000),
        redirect: 'error',
      });
    } catch (e) {
      throw new MailError(`Brevo nicht erreichbar: ${e.message}`);
    }
    if (!res.ok) {
      // Die Antwort kann die Adresse enthalten – nur den Fehlercode weitergeben, nichts protokollieren.
      const code = await res.json().then((j) => j?.code ?? 'unbekannt', () => 'unbekannt');
      throw new MailError(`Brevo hat den Versand abgelehnt (HTTP ${res.status}, ${code}).`);
    }
  }
}

// ------------------------------------------------------------------ Log (Entwicklung und Tests)

export class LogMailer {
  constructor(path = null) {
    this.path = path;
    this.sent = [];
  }

  async send(to, subject, text) {
    const m = { to, subject, text };
    this.sent.push(m);
    if (this.path) appendFileSync(this.path, `${JSON.stringify(m)}\n`);
  }
}

/** Liefert null, wenn kein Versand konfiguriert ist – dann gibt es keinen E-Mail-Modus. */
export function mailerFromConfig(config) {
  const m = config.mail ?? {};
  const from = String(m.from_email ?? '');
  const name = String(m.from_name ?? 'ZeroWichtel');
  switch (m.transport) {
    case 'brevo':
      return m.brevo_api_key && from ? new BrevoMailer({ apiKey: String(m.brevo_api_key), fromEmail: from, fromName: name, endpoint: m.brevo_endpoint || undefined }) : null;
    case 'smtp': {
      const s = m.smtp ?? {};
      return from && s.host ? new SmtpMailer({
        host: String(s.host), port: Number(s.port ?? 587), user: String(s.user ?? ''), pass: String(s.pass ?? ''),
        fromEmail: from, fromName: name, secure: String(s.secure ?? 'tls'),
      }) : null;
    }
    case 'log':
      // Schreibt Mails samt Links (mit Schlüsseln) im Klartext in eine Datei – nur Entwicklung und Tests (ZW_DEV=1).
      // In Produktion zählt „log“ wie kein Versand: Der E-Mail-Modus ist dann aus, nichts wird geschrieben.
      return process.env.ZW_DEV === '1' ? new LogMailer(m.log_path ?? null) : null;
    default:
      return null;
  }
}
