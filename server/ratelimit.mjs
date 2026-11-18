// Feste Zeitfenster je Aktion und Client. Die IP-Adresse wird nie gespeichert:
// Bucket = Aktion + gekürzter HMAC(IP, Serverschlüssel + Tagesdatum) – täglich neu, nicht zurückrechenbar.
// Statt einer IP kann auch eine andere Kennung gezählt werden (z. B. „round|<id>“ für Grenzen je Runde).
import crypto from 'node:crypto';
import net from 'node:net';
import { one, run, tx } from './db.mjs';
import { HttpError } from './validate.mjs';

/**
 * Kennung für die Zählung: IPv4 unverändert, IPv6 auf das /64-Netz gekürzt – ein Anschluss erhält meist ein ganzes
 * /64 und könnte sonst mit jeder Adresse neu zählen. IPv4-gemappte Adressen (::ffff:1.2.3.4) zählen als IPv4.
 */
export function clientKey(ip) {
  if (!net.isIPv6(ip)) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail = null] = ip.toLowerCase().split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail === null ? [] : tail ? tail.split(':') : [];
  const full = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${full.slice(0, 4).map((x) => x.padStart(4, '0')).join(':')}::/64`;
}

export class RateLimiter {
  constructor(db, serverKeyRaw, limits) {
    Object.assign(this, { db, serverKeyRaw, limits });
  }

  hit(action, ip, now) {
    const [max, window] = this.limits[action] ?? [600, 3600];
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const key = Buffer.concat([this.serverKeyRaw, Buffer.from(`|rl|${day}`)]);
    // Aktion fließt in den HMAC ein: Buckets verschiedener Aktionen desselben Anschlusses sind nicht verknüpfbar
    // (wichtig für anonyme Rückfragen, 2.9). Beim Update zählen bestehende Zähler einmalig neu.
    const bucket = `${action}:${crypto.createHmac('sha256', key).update(`${action}|${clientKey(ip)}`).digest('hex').slice(0, 24)}`;
    const start = now - (now % window);

    const hits = tx(this.db, () => {
      const row = one(this.db, 'SELECT window_start, hits FROM rate_limits WHERE bucket = ?', bucket);
      if (!row || row.window_start !== start) {
        run(this.db, 'INSERT OR REPLACE INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)', bucket, start);
        return 1;
      }
      run(this.db, 'UPDATE rate_limits SET hits = ? WHERE bucket = ?', row.hits + 1, bucket);
      return row.hits + 1;
    });
    if (hits > max) throw new HttpError(429, 'rate_limited', 'Zu viele Anfragen. Bitte später erneut versuchen.');
  }
}
