// ZeroWichtel – Kalenderdatei (iCalendar, RFC 5545) mit Antwortfrist, Wunschfrist und Wichteldatum.
// Entsteht vollständig im Browser; der Server erfährt nichts davon.
// Bewusst NICHT enthalten: persönliche Links oder Admin-Links (enthalten Schlüssel und würden mit dem
// Kalender in die Cloud wandern), Namen anderer Personen, die Zuordnung.

import { t } from './i18n.js';

const CRLF = '\r\n';

/** Text nach RFC 5545 §3.3.11 maskieren. */
export function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Zeilen nach 75 Oktetts falten (RFC 5545 §3.1), ohne UTF-8-Zeichen zu zerteilen. */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curLen + n > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
      limit = 74; // Folgezeilen beginnen mit einem Leerzeichen
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join(CRLF + ' ');
}

/** Datum eines Zeitstempels in Ortszeit als YYYYMMDD. */
export function localDate(ts, offsetDays = 0) {
  const d = new Date(ts * 1000);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Stabile, nicht zurückverfolgbare UID je Runde und Termin (SHA-256 der Runden-ID). */
async function uidBase(roundId) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`zw-ics|${roundId}`)));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {object} o
 * @param {string} o.roundId
 * @param {string} o.title
 * @param {'wichteln'|'schrott'} o.mode
 * @param {number} o.rsvpDeadline  Zeitstempel (23:59 Ortszeit)
 * @param {number|null} o.wishDeadline
 * @param {number} o.eventDate     Zeitstempel (12:00 Ortszeit)
 * @param {number|null} o.budget
 * @param {'admin'|'person'} o.role
 * @param {string} o.url           Link ohne Geheimnis (Startseite oder #zu/<pid>)
 * @param {number} [o.now]         ms, für Tests
 * @returns {Promise<string>}
 */
export async function buildIcs(o) {
  const now = o.now ?? Date.now();
  const stamp = utcStamp(now);
  const seq = Math.floor(now / 60000) % 2147483647; // spätere Downloads aktualisieren den Termin
  const base = await uidBase(o.roundId);
  const host = (() => { try { return new URL(o.url).host; } catch { return 'zerowichtel'; } })();
  const title = o.title || t('Wichtelrunde');
  const kind = o.mode === 'schrott' ? t('Schrottwichteln') : t('Wichteln');
  const admin = o.role === 'admin';
  const budget = o.budget ? t('Betragslimit: {budget}', { budget: t('{n} €', { n: o.budget }) }) : null;

  const events = [
    {
      id: 'rsvp',
      ts: o.rsvpDeadline,
      summary: t('Antwortfrist: {title}', { title }),
      desc: admin
        ? t('Bis heute 23:59 Uhr können die Eingeladenen zu- oder absagen. Danach kannst du auslosen.')
        : t('Bis heute 23:59 Uhr „dabei“ oder „diesmal raus“ sagen.'),
      alarm: true,
    },
    o.mode === 'wichteln' && o.wishDeadline
      ? {
        id: 'wish',
        ts: o.wishDeadline,
        summary: t('Wunschfrist: {title}', { title }),
        desc: admin
          ? t('Bis heute 23:59 Uhr können alle ihre Wünsche ändern. Bis dahin ist auch eine Neuziehung möglich.')
          : t('Bis heute 23:59 Uhr kannst du deine Wünsche ändern.'),
        alarm: true,
      }
      : null,
    {
      id: 'event',
      ts: o.eventDate,
      summary: `${kind}: ${title}`,
      desc: [budget, admin ? null : t('Dein Geschenk nicht vergessen!')].filter(Boolean).join('\n'),
      alarm: true,
    },
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZeroWichtel//ZeroWichtel//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const e of events) {
    const desc = [e.desc, t('Öffnen: {url}', { url: o.url }), admin ? null : t('(Der Link führt auf dem Gerät, auf dem du die Einladung angenommen hast, direkt zu deiner Seite.)')]
      .filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${base}-${e.id}@${host}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${seq}`,
      `DTSTART;VALUE=DATE:${localDate(e.ts)}`,
      `DTEND;VALUE=DATE:${localDate(e.ts, 1)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(desc)}`,
      `URL:${o.url}`,
      'TRANSP:TRANSPARENT',
      'CLASS:PRIVATE',
    );
    if (e.alarm) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(e.summary)}`,
        'TRIGGER:-PT12H', // Vortag 12:00 Uhr
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

/** Dateiname ohne Sonderzeichen. */
export function icsFilename(title) {
  const slug = String(title || 'wichtelrunde').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);
  return `zerowichtel-${slug || 'wichtelrunde'}.ics`;
}

/** Startet den Download im Browser. */
export function downloadIcs(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
