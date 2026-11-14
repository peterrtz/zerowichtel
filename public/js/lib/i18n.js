// ZeroWichtel – Sprache der Oberfläche (Deutsch, Englisch).
//
// Der deutsche Text ist zugleich der Schlüssel: t('Zur Startseite') liefert im Englischen den Eintrag aus en.js,
// sonst den deutschen Text. Platzhalter in geschweiften Klammern: t('Hallo {name}!', { name }).
// Die Wahl wird nur in diesem Browser gespeichert (zw.lang); ohne Wahl gilt die Browsersprache.
// Rechtstexte (Impressum, Datenschutz, Barrierefreiheit) bleiben deutsch – sie sind nur so verbindlich.

import { EN, EN_PATTERNS } from './en.js';

const KEY = 'zw.lang';
export const LANGS = ['de', 'en'];

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function detect() {
  // Außerhalb des Browsers (Tests, Node) gilt Deutsch – Node kennt zwar navigator.language, aber nicht die Nutzer:in.
  if (!globalThis.document) return 'de';
  const list = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'de'];
  for (const l of list) {
    const base = String(l).toLowerCase().slice(0, 2);
    if (base === 'de') return 'de';
    if (base === 'en') return 'en';
  }
  return 'de';
}

let current = stored() ?? detect();

export function lang() {
  return current;
}

/** Locale für Intl (Datum, Zahlen). */
export function locale() {
  return current === 'en' ? 'en-GB' : 'de-DE';
}

/** Sprache wählen (und merken). */
export function setLang(l) {
  if (!LANGS.includes(l)) return;
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* privater Modus */ }
  applyStatic();
}

export function t(text, params) {
  let out = text;
  if (current === 'en') {
    out = EN[text];
    if (out === undefined) {
      const p = EN_PATTERNS.find(([re]) => re.test(text));
      out = p ? text.replace(p[0], p[1]) : text;
    }
  }
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return out;
}

/** Ein- oder Mehrzahl: tn(n, '{n} Person', '{n} Personen'). */
export function tn(n, one, many, params = {}) {
  return t(n === 1 ? one : many, { n, ...params });
}

/**
 * Feste Texte in index.html: data-i18n (Textinhalt), data-i18n-label (aria-label), data-i18n-title (title).
 * Der deutsche Ausgangstext wird beim ersten Aufruf gemerkt.
 */
export function applyStatic(doc = globalThis.document) {
  if (!doc) return;
  doc.documentElement.lang = current;
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    el.dataset.i18nDe ??= el.textContent;
    el.textContent = t(el.dataset.i18nDe);
  }
  for (const [attr, data] of [['aria-label', 'i18nLabel'], ['title', 'i18nTitle']]) {
    for (const el of doc.querySelectorAll(`[data-${data === 'i18nLabel' ? 'i18n-label' : 'i18n-title'}]`)) {
      el.dataset[data + 'De'] ??= el.getAttribute(attr) ?? '';
      el.setAttribute(attr, t(el.dataset[data + 'De']));
    }
  }
  const toggle = doc.getElementById('lang-toggle');
  if (toggle) {
    toggle.textContent = current === 'en' ? 'Deutsch' : 'English';
    toggle.setAttribute('lang', current === 'en' ? 'de' : 'en');
  }
}
