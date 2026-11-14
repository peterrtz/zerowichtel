// 2.5 (SEC-007): Zählkennung der Anfragebegrenzung – IPv6 je /64, IPv4-gemappt wie IPv4, sonstige Kennungen unverändert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientKey } from '../../server/ratelimit.mjs';

test('IPv6-Adressen eines /64 ergeben dieselbe Kennung', () => {
  const k = clientKey('2001:db8:1:2::1');
  for (const ip of ['2001:db8:1:2::ffff', '2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2:0:0:0:1']) assert.equal(clientKey(ip), k, ip);
  assert.notEqual(clientKey('2001:db8:1:3::1'), k, 'anderes /64');
  assert.equal(clientKey('::ffff:10.0.0.1'), '10.0.0.1');
  assert.equal(clientKey('fe80::1%eth0'), clientKey('fe80::2'));
  assert.equal(clientKey('192.0.2.7'), '192.0.2.7');
  assert.equal(clientKey('round|abc'), 'round|abc', 'Kennungen wie round|<id> unverändert');
});

// 2.5.2 (Härtung): Der Mail-Transport „log“ schreibt Links mit Schlüsseln in eine Datei – nur im Entwicklungsmodus.
test('Mail-Transport „log“ gibt es nur mit ZW_DEV=1', async () => {
  const { mailerFromConfig, LogMailer } = await import('../../server/mail/mailers.mjs');
  const cfg = { mail: { transport: 'log', from_email: 'a@b.example', log_path: null } };
  const before = process.env.ZW_DEV;
  try {
    delete process.env.ZW_DEV;
    assert.equal(mailerFromConfig(cfg), null, 'ohne ZW_DEV: kein Versand, nichts wird geschrieben');
    process.env.ZW_DEV = '1';
    assert.ok(mailerFromConfig(cfg) instanceof LogMailer);
  } finally {
    if (before === undefined) delete process.env.ZW_DEV; else process.env.ZW_DEV = before;
  }
});
