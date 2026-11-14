// Mailversand gegen lokale Attrappen: Brevo-API (HTTP), SMTP unverschlüsselt (nur 127.0.0.1), STARTTLS und implizites TLS.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrevoMailer, MailError, SmtpMailer } from '../../server/mail/mailers.mjs';

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

test('Brevo: Anfrage, nur Text, Fehler werden gemeldet', async () => {
  let cap = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      cap = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      const ok = req.headers['api-key'] === 'test-key';
      res.writeHead(ok ? 201 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { messageId: '<x@relay>' } : { code: 'unauthorized', message: 'anna@example.org' }));
    });
  });
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}/v3/smtp/email`;
  try {
    await new BrevoMailer({ apiKey: 'test-key', fromEmail: 'noreply@wichteln.example.org', endpoint }).send('anna@example.org', 'ZeroWichtel: Test – Ümläute', 'Hallo!\nZeile 2');
    assert.equal(cap.url, '/v3/smtp/email');
    assert.match(cap.headers['content-type'], /application\/json/);
    assert.deepEqual(cap.body, {
      sender: { name: 'ZeroWichtel', email: 'noreply@wichteln.example.org' }, to: [{ email: 'anna@example.org' }],
      subject: 'ZeroWichtel: Test – Ümläute', textContent: 'Hallo!\nZeile 2', tags: ['zerowichtel'],
    });
    await assert.rejects(new BrevoMailer({ apiKey: 'falsch', fromEmail: 'a@b.de', endpoint }).send('a@b.de', 's', 't'),
      (e) => e instanceof MailError && /HTTP 401, unauthorized/.test(e.message) && !e.message.includes('anna'));
    await assert.rejects(new BrevoMailer({ apiKey: 'k', fromEmail: 'a@b.de', endpoint: 'http://example.org/x' }).send('a@b.de', 's', 't'), /nur HTTPS/);
  } finally {
    server.close();
  }
});

/** Minimaler SMTP-Server; tlsOpts → STARTTLS anbieten (bzw. implicit = TLS von Beginn an). */
function fakeSmtp({ tlsOpts = null, implicit = false } = {}) {
  const log = [];
  const handle = (sock) => {
    let buf = '';
    let inData = false;
    let auth = 0;
    const say = (l) => sock.write(`${l}\r\n`);
    const onData = (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        log.push(line);
        if (inData) {
          if (line === '.') { inData = false; say('250 queued'); }
          continue;
        }
        const cmd = line.slice(0, 8).toUpperCase();
        if (cmd.startsWith('EHLO')) { say(`250-hello`); say(tlsOpts && !implicit && !sock.encrypted ? '250 STARTTLS' : '250 AUTH LOGIN'); }
        else if (cmd.startsWith('STARTTLS')) {
          say('220 go');
          sock.off('data', onData);
          const secure = new tls.TLSSocket(sock, { isServer: true, ...tlsOpts });
          secure.encrypted = true;
          handle(secure);
          return;
        }
        else if (cmd.startsWith('AUTH')) { auth = 1; say('334 VXNlcm5hbWU6'); }
        else if (auth === 1) { auth = 2; say('334 UGFzc3dvcmQ6'); }
        else if (auth === 2) { auth = 0; say('235 ok'); }
        else if (cmd.startsWith('MAIL') || cmd.startsWith('RCPT')) say('250 ok');
        else if (cmd.startsWith('DATA')) { inData = true; say('354 go'); }
        else if (cmd.startsWith('QUIT')) { say('221 bye'); sock.end(); }
        else say('500 ?');
      }
    };
    sock.on('data', onData);
    sock.on('error', () => {});
  };
  const server = implicit
    ? tls.createServer(tlsOpts, (s) => { s.encrypted = true; handle(s); s.write('220 fake\r\n'); })
    : net.createServer((s) => { handle(s); s.write('220 fake\r\n'); });
  return { server, log };
}

test('SMTP: Ablauf, Kodierung, Punkt-Transparenz, Schutz vor Kopfzeilen-Injektion', async () => {
  const { server, log } = fakeSmtp();
  const port = await listen(server);
  try {
    const smtp = new SmtpMailer({ host: '127.0.0.1', port, user: 'user', pass: 'pass', fromEmail: 'noreply@wichteln.example.org', secure: 'none' });
    await smtp.send('ben@example.org', 'Betreff mit Ümlaut', 'Text\n.Punktzeile\nÄnderung = gut');
    const all = log.join('\n');
    assert.ok(log.includes('MAIL FROM:<noreply@wichteln.example.org>'));
    assert.ok(log.includes('RCPT TO:<ben@example.org>'));
    assert.ok(log.includes(Buffer.from('user').toString('base64')) && log.includes(Buffer.from('pass').toString('base64')), 'AUTH LOGIN');
    assert.match(all, /^Subject: =\?UTF-8\?Q\?Betreff_mit_=C3=9Cmlaut\?=$/m);
    assert.match(all, /^From: ZeroWichtel <noreply@wichteln\.example\.org>$/m);
    assert.match(all, /^Message-ID: <[0-9a-f]{32}@wichteln\.example\.org>$/m);
    assert.ok(log.includes('Content-Type: text/plain; charset=UTF-8'));
    assert.ok(log.includes('Auto-Submitted: auto-generated'));
    assert.ok(log.includes('..Punktzeile'), 'Punkt am Zeilenanfang verdoppelt');
    assert.ok(log.includes('=C3=84nderung =3D gut'), 'Quoted-Printable');
    assert.equal(log.at(-1), 'QUIT');
    await assert.rejects(smtp.send('x@y.de\r\nBcc: z@z.de', 's', 't'), /Ungültige Kopfzeile/);
    await assert.rejects(new SmtpMailer({ host: 'example.org', port: 25, fromEmail: 'a@b.de', secure: 'none' }).send('a@b.de', 's', 't'), /nur für lokale Tests/);
    await assert.rejects(new SmtpMailer({ host: '127.0.0.1', port: 1, fromEmail: 'a@b.de', secure: 'none' }).send('a@b.de', 's', 't'), /SMTP nicht erreichbar/);
  } finally {
    server.close();
  }
});

test('SMTP: STARTTLS (587) und implizites TLS (465) mit Zertifikatsprüfung', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zw-tls-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
    const tlsOpts = { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) };
    const defaults = tls.getCACertificates('default');

    for (const [secure, implicit] of [['tls', false], ['ssl', true]]) {
      const { server, log } = fakeSmtp({ tlsOpts, implicit });
      const port = await listen(server);
      try {
        const smtp = new SmtpMailer({ host: '127.0.0.1', port, user: 'u', pass: 'p', fromEmail: 'noreply@wichteln.example.org', secure });
        // Unbekanntes Zertifikat: wird abgelehnt
        await assert.rejects(smtp.send('ben@example.org', 's', 't'), MailError, `${secure}: Zertifikat muss geprüft werden`);
        // Mit vertrauter Zertifizierungsstelle: klappt
        tls.setDefaultCACertificates([...defaults, tlsOpts.cert.toString()]);
        log.length = 0;
        await smtp.send('ben@example.org', 'Hallo', 'Text');
        assert.ok(log.includes('RCPT TO:<ben@example.org>'), secure);
        if (!implicit) assert.ok(log.includes('STARTTLS') && log.filter((l) => l.startsWith('EHLO')).length === 2, 'EHLO nach STARTTLS wiederholt');
      } finally {
        tls.setDefaultCACertificates(defaults);
        server.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
