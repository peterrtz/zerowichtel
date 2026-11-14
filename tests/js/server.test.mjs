// Bausteine des Node-Servers: TOTP, Base32, Kryptografie, E-Mail-Prüfung, Mailformat, Konfiguration, JSON-Lesen.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { base32Decode, base32Encode, totp } from '../../server/admin.mjs';
import { ServerCrypto, hashPassword, verifyPassword } from '../../server/crypto.mjs';
import { validEmail } from '../../server/email.mjs';
import { encodeHeader, quotedPrintable } from '../../server/mail/mailers.mjs';
import { date } from '../../server/mail/texts.mjs';
import { normalizeConfig } from '../../server/config.mjs';
import { FLOAT, parseBody } from '../../server/validate.mjs';
import { normalizeCode } from '../../server/codes.mjs';

test('TOTP: Testvektoren aus RFC 6238 (SHA1)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors = { 59: '94287082', 1111111109: '07081804', 1111111111: '14050471', 1234567890: '89005924', 2000000000: '69279037', 20000000000: '65353130' };
  for (const [t, exp] of Object.entries(vectors)) assert.equal(totp.code(secret, Math.floor(Number(t) / 30), 8), exp, `T=${t}`);
  assert.equal(totp.code(secret, 1), '287082');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(base32Decode('mfrg-gzdf my======').toString(), 'abcdef', 'Kleinschreibung, Bindestriche, Leerzeichen, Padding');
});

test('TOTP: Fenster ±30 s, kein zweites Verwenden desselben Codes', () => {
  const s = totp.newSecret();
  const t = 1_800_000_000;
  const step = totp.step(t);
  assert.equal(totp.verify(s, totp.code(s, step), t), step);
  assert.equal(totp.verify(s, ` ${totp.code(s, step - 1).replace(/(...)/, '$1 ')}`, t), step - 1, 'vorheriger Schritt, Leerzeichen egal');
  assert.equal(totp.verify(s, totp.code(s, step - 2), t), null, 'zu alt');
  assert.equal(totp.verify(s, totp.code(s, step), t, step), null, 'schon benutzt');
  assert.equal(totp.verify(s, 'abcdef', t), null);
  assert.equal(totp.verify(s, '١٢٣٤٥٦', t), null, 'nur ASCII-Ziffern');
  assert.match(totp.uri(s, 'zw.example'), /^otpauth:\/\/totp\/ZeroWichtel%3Azw\.example\?secret=[A-Z2-7]{32}&issuer=ZeroWichtel&algorithm=SHA1&digits=6&period=30$/);
});

test('ServerCrypto: XChaCha20-Poly1305 – Bindung an Zweck, Schlüssel und Inhalt', () => {
  const k = Buffer.alloc(32, 'k');
  const c = new ServerCrypto(k);
  const t = c.seal('anna@ä.de', 'email|P1');
  assert.match(t, /^x1\.[A-Za-z0-9_-]+$/);
  assert.equal(c.open(t, 'email|P1'), 'anna@ä.de');
  assert.equal(c.open(t, 'email|P2'), null);
  assert.equal(new ServerCrypto(k, 'admin').open(t, 'email|P1'), null, 'anderer Zweck');
  assert.equal(new ServerCrypto(Buffer.alloc(32, 'j')).open(t, 'email|P1'), null, 'anderer Schlüssel');
  assert.equal(c.open(`${t.slice(0, -2)}AA`, 'email|P1'), null, 'manipuliert');
  for (const bad of [null, undefined, 'quatsch', 'x1.', 'x1.AAAA', 'x1.!!!!']) assert.equal(c.open(bad, 'email|P1'), null);
});

test('ServerCrypto: festes Chiffrat aus der PHP-Version (libsodium) bleibt lesbar', () => {
  // erzeugt mit ZeroWichtel 1.2.1: (new ServerCrypto(str_repeat('k', 32)))->seal('anna@ä.de', 'email|P1')
  const php = 'x1.FDB7_C8n5VfftZKd_2t_IYu5H9GSyzXbhqi6CDUiAS2_-g_5dtXICjP6cL0EztcK3_o';
  assert.equal(new ServerCrypto(Buffer.alloc(32, 'k')).open(php, 'email|P1'), 'anna@ä.de');
});

test('Argon2id: eigener Hash und Hash aus PHP password_hash()', () => {
  const own = hashPassword('korrekt pferd');
  assert.match(own, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.equal(verifyPassword('korrekt pferd', own), true);
  assert.equal(verifyPassword('falsch', own), false);
  const php = '$argon2id$v=19$m=19456,t=2,p=1$Sy9wY0xVTGhJcTNkb3A3TQ$7wfuVncbDU7ge0sJs2Gpiz/61InXsi5z4RwWrVmFI68';
  assert.equal(verifyPassword('korrekt pferd', php), true);
  assert.equal(verifyPassword('korrekt pferd', '$2y$12$abc'), false, 'bcrypt wird nicht unterstützt');
});

test('E-Mail-Prüfung wie filter_var(FILTER_VALIDATE_EMAIL)', () => {
  const valid = ['a@b.de', 'a.b+c@sub.example.org', 'A@B.DE', 'a@xn--bcher-kva.ch', '  pad@x.de ', 'a@[127.0.0.1]', `${'x'.repeat(64)}@b.de`];
  const invalid = ['kein-at', 'a b@c.de', 'x@localhost', 'ä@b.de', 'a@b', 'a..b@c.de', '"q"@c.de', 'a@-b.de', 'a@b.123', `${'x'.repeat(65)}@b.de`,
    `a@${'b'.repeat(64)}.de`, '.a@b.de', 'a@b..de', 'a@b.de\r\nBcc: x@y.de', 'a<b@c.de', '', 42, null];
  for (const e of valid) assert.equal(validEmail(e), e.trim(), e);
  for (const e of invalid) assert.equal(validEmail(e), null, String(e));
  // Strenger als filter_var: keine IPv6-Literale, keine Quoted Strings
  for (const e of ['a@[IPv6:::1]', 'a@[256.1.1.1]', 'a@[01.1.1.1]', '"a b"@c.de', 'a@b@c.de']) assert.equal(validEmail(e), null, e);
});

test('E-Mail-Prüfung: lineare Laufzeit auch bei Angriffsmustern (SEC-001, ReDoS)', () => {
  const attacks = [
    `a@${'a.'.repeat(120)}!`, `a@${'a.'.repeat(5000)}!`, `${'a'.repeat(250)}@`, `a@${'a-'.repeat(125)}`,
    `a@${'a'.repeat(63)}${'-'.repeat(100)}!`, `a${'.a'.repeat(120)}@!`, `a@[${'1:'.repeat(80)}`, `a@${'xn--a'.repeat(49)}.`,
  ];
  for (const e of attacks) {
    const t = performance.now();
    assert.equal(validEmail(e), null);
    assert.ok(performance.now() - t < 20, `zu langsam: ${e.slice(0, 30)}… (${e.length} Zeichen)`);
  }
});

test('Mailformat: Q-Kodierung der Kopfzeilen und Quoted-Printable', () => {
  assert.equal(encodeHeader('ZeroWichtel'), 'ZeroWichtel');
  assert.equal(encodeHeader('Grüße'), '=?UTF-8?Q?Gr=C3=BC=C3=9Fe?=');
  const long = encodeHeader('Ä'.repeat(40));
  assert.ok(long.split('\r\n ').every((w) => w.length <= 75 && /^=\?UTF-8\?Q\?[^?]*\?=$/.test(w)), 'kodierte Wörter höchstens 75 Zeichen');
  assert.equal(quotedPrintable('a=b ä\r\nend '), 'a=3Db =C3=A4\r\nend=20');
  assert.ok(quotedPrintable('x'.repeat(200)).split('\r\n').every((l) => l.length <= 76), 'Zeilen höchstens 76 Zeichen');
  assert.equal(quotedPrintable('x'.repeat(200)).replace(/=\r\n/g, ''), 'x'.repeat(200));
});

test('Datum in Mails: deutsche Zeit, TT.MM.JJJJ', () => {
  assert.equal(date(Date.UTC(2026, 11, 31, 22, 30) / 1000), '31.12.2026');
  assert.equal(date(Date.UTC(2026, 11, 31, 23, 30) / 1000), '01.01.2027', 'nach Mitternacht in Berlin');
});

test('Organisator-Codes: Eingabe tolerant', () => {
  assert.equal(normalizeCode('zw-abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizeCode(' ZW ABCD EFGH '), 'ABCDEFGH');
  assert.equal(normalizeCode('ABCD-ZW12'), 'ABCDZW12');
});

test('Konfiguration: Standardwerte, Grenzen, Pflichtangaben', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const c = normalizeConfig({ db_path: 'data/x.sqlite', server_key: key, max_participants: 500, admin: { session_minutes: 1 }, mail: { transport: 'log' } }, '/srv/zw');
  assert.equal(c.db_path, '/srv/zw/data/x.sqlite', 'relativ zur Konfigurationsdatei');
  assert.equal(c.max_participants, 50);
  assert.equal(c.admin.session_minutes, 5);
  assert.equal(c.admin.enabled, false);
  assert.equal(c.mail.from_name, 'ZeroWichtel');
  assert.deepEqual(c.rate_limits.read, [1200, 3600]);
  assert.equal(c.server_key_raw.length, 32);
  assert.throws(() => normalizeConfig({ db_path: 'x', server_key: 'zu kurz' }), /server_key/);
  assert.throws(() => normalizeConfig({ server_key: key }), /db_path/);
});

test('Konfiguration: schwache Serverschlüssel nur im Entwicklungsmodus (SEC-004)', () => {
  const weak = Buffer.alloc(32, 1).toString('base64');
  const before = process.env.ZW_DEV;
  delete process.env.ZW_DEV;
  try {
    assert.throws(() => normalizeConfig({ db_path: 'x', server_key: weak }), /zu schwach/);
    assert.throws(() => normalizeConfig({ db_path: 'x', server_key: Buffer.from('ab'.repeat(16)).toString('base64') }), /zu schwach/);
    for (let i = 0; i < 200; i++) normalizeConfig({ db_path: 'x', server_key: crypto.randomBytes(32).toString('base64') });
    process.env.ZW_DEV = '1';
    assert.equal(normalizeConfig({ db_path: 'x', server_key: weak }).server_key_raw.length, 32);
  } finally {
    if (before === undefined) delete process.env.ZW_DEV; else process.env.ZW_DEV = before;
  }
});

test('JSON-Lesen wie PHP json_decode(…, true, 16)', () => {
  const p = (s) => parseBody(Buffer.from(s));
  assert.deepEqual(p('{"a":1,"b":[1,2]}'), { a: 1, b: [1, 2] });
  assert.deepEqual(p(''), {});
  assert.equal(p('{"a":1.0}').a, FLOAT);
  assert.equal(p('{"a":1e3}').a, FLOAT);
  assert.equal(p('{"a":99999999999999999999}').a, FLOAT);
  assert.equal(p('{"a":-9223372036854775808}').a, -9223372036854775808);
  assert.throws(() => p('"x"'), /JSON-Objekt erwartet/);
  assert.throws(() => p(`${'['.repeat(16)}${']'.repeat(16)}`), /Ungültiges JSON/);
  assert.doesNotThrow(() => p(`${'['.repeat(15)}${']'.repeat(15)}`));
  assert.throws(() => p('{"\\ud800":1}'), /Ungültiges JSON/);
  assert.throws(() => parseBody(Buffer.from([0x7b, 0x7d, 0xff])), /Ungültiges JSON/);
});
