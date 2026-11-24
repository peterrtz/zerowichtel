// ZeroWichtel – gemeinsame Bausteine der Ansichten.

import { removeSectionNav } from './section-nav.js';
import { h, svg, clear } from '../lib/dom.js';
import { toDom } from '../lib/markdown.js';
import { formatDate, formatShort, relative, euro, nowSec } from '../lib/dates.js';
import qrcode from '../vendor/qrcode.mjs';
import { buildIcs, downloadIcs, icsFilename } from '../lib/ics.js';
import { t } from '../lib/i18n.js';
import { setStaleLinkHandler } from '../lib/api.js';

export const MODE_LABEL = { wichteln: 'Wichteln', schrott: 'Schrottwichteln' };
export const modeLabel = (mode) => (MODE_LABEL[mode] ? t(MODE_LABEL[mode]) : mode);

export function page(...children) {
  return h('div', { class: 'page' }, ...children);
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h2', null, title) : null, ...children);
}

export function chip(text, kind = '') {
  return h('span', { class: ['chip', kind && `chip-${kind}`] }, text);
}

export function notice(text, kind = 'info') {
  return h('div', { class: ['notice', `notice-${kind}`] }, text);
}

/**
 * fn einmal aufrufen, sobald el mindestens 1,5 s sichtbar war (Seite im Vordergrund). Für „gelesen“-Markierungen,
 * die nur auf dem Gerät gemerkt werden. Ohne IntersectionObserver (alte Browser, Tests): sofort.
 */
export function whenSeen(el, fn, ms = 1500) {
  if (typeof IntersectionObserver !== 'function') { fn(); return; }
  let timer = null;
  const io = new IntersectionObserver(([e]) => {
    clearTimeout(timer);
    if (e.isIntersecting && document.visibilityState === 'visible') timer = setTimeout(() => { io.disconnect(); fn(); }, ms);
  }, { threshold: 0.3 });
  io.observe(el);
}

export function md(text) {
  const d = h('div', { class: 'md' });
  d.appendChild(toDom(text || ''));
  return d;
}

export function roundHeader(round, meta, extra) {
  return h('header', { class: 'round-head' },
    h('div', { class: 'round-kicker' }, chip(modeLabel(round.mode), round.mode), extra),
    h('h1', null, meta.title),
  );
}

export function factList(round, meta) {
  const rows = [
    [t('Wichteldatum'), formatDate(round.eventDate)],
    [t('Antwortfrist'), `${formatDate(round.rsvpDeadline)} · ${relative(round.rsvpDeadline)}`],
  ];
  if (round.mode === 'wichteln') {
    rows.push([t('Wunschfrist'), `${formatDate(round.wishDeadline)} · ${relative(round.wishDeadline)}`]);
  }
  rows.push([t('Betragslimit'), euro(meta.budget)]);
  rows.push([t('Endgültige Löschung'), t('spätestens {date}', { date: formatDate(round.deleteAfter) })]);
  return h('dl', { class: 'facts' }, rows.map(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

/**
 * Knopf „In den Kalender“: erzeugt eine .ics-Datei mit Antwortfrist, Wunschfrist und Wichteldatum im Browser.
 * url darf kein Geheimnis enthalten (Startseite bzw. #zu/<pid>).
 */
export function calendarButton({ round, meta, role, url }) {
  const btn = h('button', { type: 'button', class: 'btn btn-small' }, t('In den Kalender (.ics)'));
  btn.addEventListener('click', async () => {
    const text = await buildIcs({
      roundId: round.id, title: meta.title, mode: round.mode, role, url,
      rsvpDeadline: round.rsvpDeadline, wishDeadline: round.wishDeadline, eventDate: round.eventDate, budget: meta.budget,
    });
    downloadIcs(text, icsFilename(meta.title));
  });
  return h('div', { class: 'calendar-row' }, btn,
    h('p', { class: 'hint' }, t('Termine mit Erinnerung am Vortag. Titel und Termine landen in deinem Kalender – ggf. auch in dessen Cloud; Links mit Schlüssel sind nicht enthalten. Nach Terminänderungen einfach neu laden, der Kalender aktualisiert die Einträge.')));
}

/** QR-Code als SVG, gebaut aus einzelnen Modulen – ohne innerHTML. */
export function qrSvg(text, { size = 168, label = 'QR-Code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + q},${r + q}h1v1h-1z`;
    }
  }
  return svg('svg', { viewBox: `0 0 ${n + 2 * q} ${n + 2 * q}`, width: size, height: size, role: 'img', 'aria-label': label, class: 'qr', 'shape-rendering': 'crispEdges' },
    svg('rect', { width: n + 2 * q, height: n + 2 * q, fill: '#fff' }),
    svg('path', { d, fill: '#000' }),
  );
}

/** Druckt einen vorbereiteten Bogen (.print-sheet) und entfernt ihn danach wieder. */
export function printSheet(sheet) {
  document.body.appendChild(sheet);
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    sheet.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/** Druckt einen Bogen mit Wiederherstellungscode. */
export function printRecovery({ title, name, code, link }) {
  printSheet(h('div', { class: 'print-sheet' },
    h('h1', null, t('ZeroWichtel – Wiederherstellungscode')),
    h('p', null, h('strong', null, title), name ? ` · ${t('für {name}', { name })}` : ''),
    codeView(code, 'print-code'),
    qrSvg(link, { size: 200, label: t('QR-Code zur Wiederherstellung') }),
    h('p', null, t('Mit diesem Code stellst du deinen persönlichen Zugang wieder her, falls du deinen Link verlierst: QR-Code scannen oder auf der ZeroWichtel-Startseite „Wiederherstellen“ wählen.')),
    h('p', null, h('strong', null, t('Wie einen Schlüssel aufbewahren.')), ' ', t('Wer diesen Zettel findet, kann deine Wichtelrunde öffnen. Nach der Runde vernichten.')),
  ));
}

/**
 * Einladungskarten zum Ausdrucken (vier pro Seite): je Person ein QR-Code mit dem persönlichen Einladungslink,
 * optional eine Karte für den Gruppenlink. cards: [{ name|null, link }]
 */
export function printInviteCards({ round, meta, cards }) {
  const facts = [
    t('Wichteldatum: {date}', { date: formatDate(round.eventDate) }),
    t('Zusagen bis: {date}', { date: formatShort(round.rsvpDeadline) }),
    meta.budget !== null && meta.budget !== undefined ? t('Betragslimit: {budget}', { budget: euro(meta.budget) }) : null,
  ].filter(Boolean);
  printSheet(h('div', { class: 'print-sheet print-cards' },
    cards.map((c) => h('section', { class: 'print-card' },
      h('p', { class: 'print-card-kicker' }, t('Einladung zum {mode}', { mode: modeLabel(round.mode) })),
      h('h2', null, meta.title),
      h('p', { class: 'print-card-name' }, c.name ? t('für {name}', { name: c.name }) : t('für alle in der Gruppe')),
      qrSvg(c.link, { size: 150, label: t('QR-Code zur Einladung') }),
      h('p', { class: 'print-card-facts' }, facts.join(' · ')),
      h('p', { class: 'print-card-how' }, c.name
        ? t('QR-Code mit der Handykamera scannen und die Einladung annehmen. Gilt nur für dich – bitte nicht weitergeben.')
        : t('QR-Code mit der Handykamera scannen und dich selbst eintragen.')),
      h('p', { class: 'print-card-foot' }, t('ZeroWichtel · ohne Konto, Ende-zu-Ende-verschlüsselt'))))));
}

/**
 * Zeitleiste der Runde mit „Du bist hier“. Reine Anzeige aus Status und Terminen.
 */
export function timelineSteps(round, now = nowSec(), { gift, wishFrozen = false } = {}) {
  const open = round.status === 'offen';
  // Geschenk-Schritt: Teilnehmende haken ihn selbst ab (gift = true/false); in der Ansicht der Organisator:in
  // (gift undefiniert) gilt er mit dem Wichteltag als erledigt. Nach dem Wichteltag immer erledigt.
  const giftDone = (gift === true) || now >= round.eventDate;
  if (round.mode !== 'wichteln') {
    return [
      { label: t('Zusagen'), date: round.rsvpDeadline, done: !open || now >= round.rsvpDeadline },
      { label: t('Geschenk finden'), date: null, done: giftDone, gift: true },
      { label: t('Spieleabend'), date: round.eventDate, done: now >= round.eventDate },
      { label: t('Löschung'), date: round.deleteAfter, done: false },
    ];
  }
  const after = round.eventDate + 7 * 86400;
  // Vor der Antwortfrist ausgelost: Bei „Zusagen“ steht dann der Tag der Auslosung (damit endete das Zusagen),
  // nicht die spätere Frist – sonst stünde „Zusagen 13.11.“ vor „Auslosen 12.11.“.
  const earlyDraw = !open && round.drawnAt && round.drawnAt < round.rsvpDeadline;
  return [
    { label: t('Zusagen'), date: earlyDraw ? round.drawnAt : round.rsvpDeadline, done: !open || now >= round.rsvpDeadline },
    { label: t('Auslosen'), date: round.drawnAt ?? null, done: !open },
    { label: t('Wünsche'), date: round.wishDeadline, done: !open && (now >= round.wishDeadline || wishFrozen) },
    { label: t('Geschenk besorgen'), date: null, done: !open && giftDone, gift: true },
    { label: t('Bescherung'), date: round.eventDate, done: !open && now >= round.eventDate },
    { label: t('Raten und Danke sagen'), date: after, done: !open && now >= after },
    { label: t('Löschung'), date: round.deleteAfter, done: false },
  ];
}

export function timeline(round, opts = {}) {
  const steps = timelineSteps(round, nowSec(), opts);
  const current = steps.findIndex((s) => !s.done);
  return h('ol', { class: 'timeline', 'aria-label': t('Ablauf der Runde') }, steps.map((s, i) => h('li', {
    class: ['tl-step', s.done && 'tl-done', i === current && 'tl-current'],
    'aria-current': i === current ? 'step' : null,
  },
  h('span', { class: 'tl-dot', 'aria-hidden': 'true' }, s.done ? '✓' : ''),
  h('span', { class: 'tl-label' }, s.label),
  s.date ? h('span', { class: 'tl-date' }, formatShort(s.date)) : null,
  i === current ? h('span', { class: 'tl-here' }, t('Du bist hier')) : null)));
}

/** Wiederherstellungscode mit Umbruch nur zwischen den Vierergruppen. */
export function codeView(code, cls = 'recovery-code') {
  const groups = code.split('-');
  return h('p', { class: cls }, groups.map((g, i) => h('span', { class: 'code-group' }, g + (i < groups.length - 1 ? '-' : ''))));
}

export function loading(text = t('Wird geladen …')) {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function setTitle(title) {
  document.title = title ? `${title} · ZeroWichtel` : 'ZeroWichtel';
}

// Seitenwechsel (Navigation) vs. Neuzeichnen derselben Seite nach einer Aktion
let navigationPending = true;
let firstLoad = true;     // beim ersten Laden bleibt der Fokus oben (Sprunglink erreichbar, Screenreader beginnt oben)
let kept = null;          // Fokus/Scroll eines Neuzeichnens, das über eine Ladeanzeige läuft
export function markNavigation() {
  navigationPending = true;
  kept = null;
}

/** Wiedererkennbarer Schlüssel für das fokussierte Element, damit der Fokus nach dem Neuzeichnen bleibt. */
function focusKey(el) {
  if (!el || el === document.body) return null;
  const row = el.closest('li')?.querySelector('.person-name')?.textContent ?? '';
  return [el.tagName, el.type || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '',
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? '' : el.textContent.trim().slice(0, 60), row].join('|');
}

export function mount(root, node) {
  // Jede neue Ansicht meldet sich selbst neu an, wenn sie veraltete Zugangsdaten behandeln will (2.13.2)
  setStaleLinkHandler(null);
  // Sprungmenü der vorigen Seite entfernen; Seiten mit Abschnitten bauen es nach dem Einhängen neu (2.13.1)
  if (!node.classList?.contains('loading')) removeSectionNav();
  const nav = navigationPending;
  const isLoading = node.classList?.contains('loading');
  const prev = document.activeElement;
  const key = kept?.key ?? (!nav && prev && root.contains(prev) ? focusKey(prev) : null);
  const scrollY = kept?.scrollY ?? window.scrollY;
  if (!nav && isLoading && !kept) kept = { key, scrollY };
  clear(root).appendChild(node);
  if (nav) {
    // Nur echte Inhalte gelten als neue Seite (nicht die Ladeanzeige)
    if (isLoading) return;
    navigationPending = false;
    window.scrollTo(0, 0);
    if (firstLoad) { firstLoad = false; return; }
    const heading = root.querySelector('h1');
    const announcer = document.getElementById('announcer');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    } else {
      root.focus?.({ preventScroll: true });
    }
    if (announcer) announcer.textContent = document.title;
    return;
  }
  if (isLoading) return;
  kept = null;
  // Neuzeichnen: Position halten, Fokus möglichst auf dasselbe Element zurück
  window.scrollTo(0, scrollY);
  if (key) {
    const again = [...root.querySelectorAll('button, a, input, textarea, select, summary')].find((el) => focusKey(el) === key);
    if (again) { again.focus({ preventScroll: true }); return; }
  }
  if (prev && !document.contains(prev)) root.focus?.({ preventScroll: true });
}
