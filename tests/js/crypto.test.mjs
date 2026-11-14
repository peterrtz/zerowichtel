import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../public/js/lib/crypto.js';

test('Base64url: Roundtrip und Validierung', () => {
  for (let n = 0; n < 70; n++) {
    const b = C.randomBytes(n);
    assert.deepEqual(C.b64uDecode(C.b64uEncode(b)), b);
  }
  assert.throws(() => C.b64uDecode('abc+/='));
  assert.equal(C.newId().length, 22);
  assert.equal(C.newKey().length, 43);
  assert.ok(C.isId(C.newId()));
  assert.ok(C.isKey(C.newKey()));
  assert.ok(!C.isId(C.newKey()));
});

test('sha256Hex entspricht dem Token-Hash des Servers (SHA-256, hex)', async () => {
  assert.equal(await C.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('HKDF: RFC-5869-kompatibel deterministisch, Info trennt Kontexte', async () => {
  const ikm = C.randomBytes(32);
  const a = await C.hkdf(ikm, 'x');
  const b = await C.hkdf(ikm, 'x');
  const c = await C.hkdf(ikm, 'y');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('AES-GCM: Roundtrip, AAD-Bindung, Manipulation', async () => {
  const k = C.newKey();
  const v = { title: 'Weihnachten 🎄', n: 3, umlaut: 'äöüß' };
  const ct = await C.encryptJson(k, v, ['meta', 'R1']);
  assert.match(ct, /^v1\./);
  assert.deepEqual(await C.decryptJson(k, ct, ['meta', 'R1']), v);
  await assert.rejects(C.decryptJson(k, ct, ['meta', 'R2']));
  await assert.rejects(C.decryptJson(k, ct, ['name', 'R1']));
  await assert.rejects(C.decryptJson(C.newKey(), ct, ['meta', 'R1']));
  const raw = C.b64uDecode(ct.slice(3));
  raw[raw.length - 1] ^= 1;
  await assert.rejects(C.decryptJson(k, 'v1.' + C.b64uEncode(raw), ['meta', 'R1']));
  // gleiche Eingabe, unterschiedlicher IV
  assert.notEqual(await C.encryptJson(k, v, ['meta', 'R1']), ct);
});

test('AAD-Bestandteile mit Trennzeichen werden abgelehnt', async () => {
  await assert.rejects(C.encryptJson(C.newKey(), 1, ['a|b']));
  await assert.rejects(C.encryptJson(C.newKey(), 1, []));
});

test('X25519: deterministisches Schlüsselpaar aus Geheimnis', async () => {
  assert.ok(await C.x25519Supported());
  const s = C.newKey();
  const a = await C.keypairFromSecret(s);
  const b = await C.keypairFromSecret(s);
  const c = await C.keypairFromSecret(C.newKey());
  assert.equal(a.publicRaw.length, 32);
  assert.equal(a.publicB64, b.publicB64);
  assert.notEqual(a.publicB64, c.publicB64);
});

test('sealTo / openSealed: nur Empfänger kann öffnen, AAD gebunden', async () => {
  const alice = await C.keypairFromSecret(C.newKey());
  const eve = await C.keypairFromSecret(C.newKey());
  const v = { receiver: 'P2', m: C.newKey() };
  const ct = await C.sealTo(alice.publicB64, v, ['assign', 'R', 'P1']);
  assert.match(ct, /^s1\./);
  assert.deepEqual(await C.openSealed(alice, ct, ['assign', 'R', 'P1']), v);
  await assert.rejects(C.openSealed(eve, ct, ['assign', 'R', 'P1']));
  await assert.rejects(C.openSealed(alice, ct, ['assign', 'R', 'P9']));
  // Nachträglich wiederhergestelltes Schlüsselpaar öffnet ebenfalls
  const ct2 = await C.sealTo(alice.publicRaw, 'x', ['t']);
  assert.equal(await C.openSealed(alice, ct2, ['t']), 'x');
});

test('Low-Order-Punkt wird abgewiesen', async () => {
  const alice = await C.keypairFromSecret(C.newKey());
  await assert.rejects(C.sealTo(new Uint8Array(32), 'x', ['t']));
  const bogus = 's1.' + C.b64uEncode(new Uint8Array(32 + 12 + 20));
  await assert.rejects(C.openSealed(alice, bogus, ['t']));
});

test('Wiederherstellungscode: 32 Zeichen in 8 Gruppen, Roundtrip, Fehlerfälle', async () => {
  for (let i = 0; i < 200; i++) {
    const rk = C.randomBytes(C.RECOVERY_BYTES);
    const code = C.encodeRecoveryCode(rk);
    assert.match(code, /^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
    assert.deepEqual(C.decodeRecoveryCode(code), rk);
    assert.deepEqual(C.decodeRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), rk);
  }
  assert.throws(() => C.decodeRecoveryCode('ABC'), /32 Zeichen/);
  assert.throws(() => C.decodeRecoveryCode('O'.repeat(32)), /genau abschreiben/);
  const m1 = await C.recoveryMaterial(C.randomBytes(20));
  assert.equal(m1.authHash, await C.tokenHash(m1.authToken));
  assert.equal(m1.encKey.length, 32);
});
