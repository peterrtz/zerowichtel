// ZeroWichtel – Datumsangaben. Fristen gelten bis 23:59:59 Ortszeit, das Wichteldatum ab 12:00 Ortszeit.

import { locale, t, tn } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');

export function toDateInput(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

/** Fristende: 23:59:59 Ortszeit des gewählten Tages. */
export function deadlineFromInput(v) {
  const p = parseDateInput(v);
  return p ? Math.floor(new Date(p[0], p[1], p[2], 23, 59, 59).getTime() / 1000) : null;
}

/** Wichteldatum: 12:00 Ortszeit des gewählten Tages. */
export function eventFromInput(v) {
  const p = parseDateInput(v);
  return p ? Math.floor(new Date(p[0], p[1], p[2], 12, 0, 0).getTime() / 1000) : null;
}

const fmts = new Map();
function fmt(kind) {
  const key = `${locale()}|${kind}`;
  if (!fmts.has(key)) {
    const opts = kind === 'long' ? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' };
    fmts.set(key, new Intl.DateTimeFormat(locale(), opts));
  }
  return fmts.get(key);
}

export function formatDate(ts) {
  return ts ? fmt('long').format(new Date(ts * 1000)) : '–';
}

export function formatShort(ts) {
  return ts ? fmt('short').format(new Date(ts * 1000)) : '–';
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function daysLeft(ts) {
  return Math.ceil((ts - nowSec()) / 86400);
}

export function relative(ts) {
  const d = daysLeft(ts);
  if (ts < nowSec()) return t('abgelaufen');
  if (d <= 0) return t('heute');
  return tn(d, 'noch {n} Tag', 'noch {n} Tage');
}

export function euro(n) {
  return n === null || n === undefined ? t('kein Limit') : t('{n} €', { n });
}

/** Ganze Kalendertage bis zum Zeitpunkt (Ortszeit), 0 = heute. */
export function calendarDaysUntil(ts, from = Date.now()) {
  const a = new Date(from);
  const b = new Date(ts * 1000);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}
