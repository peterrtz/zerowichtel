// Schwebendes Sprungmenü rechts (2.13.1): Icons zu den Abschnitten der Seite, aktueller Abschnitt hervorgehoben.
// Breite Bildschirme: senkrechte Leiste am rechten Rand, Beschriftung bei Hover/Fokus.
// Schmale Bildschirme: runder Knopf unten rechts, klappt eine Liste mit Icons und Beschriftung auf.
// Abschnitte melden sich mit data-nav="schlüssel" an (navTarget); das Menü zeigt nur, was auf der Seite steht.
import { h, svg } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

// Eigene Linien-Icons (24 × 24, Kontur), keine Fremdgrafiken
const P = {
  start: 'M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5',
  zugang: 'M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM13.2 12.7 20 19.5M17 16.5l2-2M15 14.5l1.5-1.5',
  zusage: 'M4 12.5 9.5 18 20 6.5',
  wichtel: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3.5-5.5-1.5S9.5 7 12 7Zm0 0c1.5-3 5-3.5 5.5-1.5S14.5 7 12 7Z',
  fragen: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4M12 17.3v.2',
  album: 'M4 7h3.5L9 5h6l1.5 2H20v12H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  mixtape: 'M3 6h18v12H3zM7 18l1.5-3h7l1.5 3M8.5 11.5a1.5 1.5 0 1 0 0-.01M15.5 11.5a1.5 1.5 0 1 0 0-.01M10 11.5h4',
  infos: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5v.2',
  email: 'M3 6h18v12H3zM3 7l9 6.5L21 7',
  schrott: 'M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01',
  teilnehmende: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .7 3.3 2.4 3.5 5.2',
  gruppenlink: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  ziehung: 'M4 7h3c4 0 6 10 10 10h3M17 14l3 3-3 3M4 17h3c1.5 0 2.7-1.4 3.7-3.2M13.3 10.2C14.3 8.4 15.5 7 17 7h3M17 4l3 3-3 3',
  checkliste: 'M9 5h10M9 12h10M9 19h10M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2',
  bearbeiten: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  loeschen: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  oben: 'M12 19V5M5 12l7-7 7 7',
  menue: 'M4 6h16M4 12h16M4 18h16',
};

const LABELS = {
  start: 'Was jetzt?',
  zugang: 'Zugang sichern',
  zusage: 'Zusage',
  wichtel: 'Dein Wichtel und Wünsche',
  fragen: 'Rückfragen',
  album: 'Adventsalbum',
  mixtape: 'Wichtel-Mixtape',
  infos: 'Eckdaten',
  email: 'E-Mail',
  schrott: 'Schrottwichtel-Würfel',
  teilnehmende: 'Teilnehmende',
  gruppenlink: 'Gruppenlink',
  ziehung: 'Ziehung',
  checkliste: 'Checkliste',
  bearbeiten: 'Runde bearbeiten',
  loeschen: 'Runde löschen',
};

const icon = (key) => svg('svg', { viewBox: '0 0 24 24', width: 22, height: 22, class: 'nav-icon', 'aria-hidden': 'true', focusable: 'false' },
  svg('path', { d: P[key] ?? P.infos }));

/** Abschnitt fürs Sprungmenü anmelden. */
export function navTarget(el, key) {
  if (el && el.dataset) el.dataset.nav = key;
  return el;
}

let observer = null;
let outside = null;
let toastWatch = null;
let onResize = null;
// Zahlen am Menü (z. B. neue Fotos im Adventsalbum): Schlüssel → { n, text }
const badges = new Map();

/** Zahl an einem Menüpunkt setzen (0 = ausblenden); text = vollständige Beschreibung für Screenreader. */
export function setNavBadge(key, n, text = '') {
  if (n > 0) badges.set(key, { n, text });
  else badges.delete(key);
  applyBadges();
}

function applyBadges() {
  const nav = document.getElementById('section-nav');
  if (!nav) return;
  let total = 0;
  for (const btn of nav.querySelectorAll('.nav-item[data-key]')) {
    const b = badges.get(btn.dataset.key);
    const label = btn.dataset.label;
    btn.querySelector('.nav-badge').textContent = b ? String(Math.min(b.n, 99)) : '';
    btn.setAttribute('aria-label', b ? `${label}, ${b.text}` : label);
    total += b?.n ?? 0;
  }
  const toggle = nav.querySelector('.nav-toggle');
  toggle.querySelector('.nav-badge').textContent = total ? String(Math.min(total, 99)) : '';
  toggle.setAttribute('aria-label', total ? t('Abschnitte, {n} neu', { n: total }) : t('Abschnitte'));
}

export function removeSectionNav() {
  observer?.disconnect();
  observer = null;
  if (outside) document.removeEventListener('click', outside);
  outside = null;
  toastWatch?.disconnect();
  toastWatch = null;
  if (onResize) window.removeEventListener('resize', onResize);
  onResize = null;
  badges.clear();
  document.getElementById('section-nav')?.remove();
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Menü für die angemeldeten Abschnitte in root bauen (ab 4 Abschnitten). */
export function sectionNav(root) {
  removeSectionNav();
  const targets = [...root.querySelectorAll('[data-nav]')].filter((el) => LABELS[el.dataset.nav]);
  if (targets.length < 4) return null;

  const jump = (el) => {
    el.setAttribute('tabindex', '-1');
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };
  const items = targets.map((el) => {
    const key = el.dataset.nav;
    const label = t(LABELS[key]);
    // Knöpfe statt Links: das Fragment der Seite enthält Schlüssel und soll nicht in Linkzielen stehen
    const a = h('button', { type: 'button', class: 'nav-item', 'data-key': key, 'data-label': label, 'aria-label': label },
      // Beschriftung per CSS aus data-text: kein doppelter Seitentext (Suche, Vorlesen), Name kommt aus aria-label
      icon(key), h('span', { class: 'nav-label', 'data-text': label, 'aria-hidden': 'true' }), h('span', { class: 'nav-badge', 'aria-hidden': 'true' }));
    a.addEventListener('click', () => {
      close();
      jump(el);
    });
    return a;
  });
  const top = h('button', { type: 'button', class: 'nav-item nav-top', 'aria-label': t('Nach oben') }, icon('oben'), h('span', { class: 'nav-label', 'data-text': t('Nach oben'), 'aria-hidden': 'true' }));
  top.addEventListener('click', () => {
    close();
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    document.querySelector('main h1')?.focus?.({ preventScroll: true });
  });

  const list = h('div', { class: 'nav-list', id: 'section-nav-list' }, items, top);
  const toggle = h('button', { type: 'button', class: 'nav-toggle', 'aria-expanded': 'false', 'aria-controls': 'section-nav-list', 'aria-label': t('Abschnitte') }, icon('menue'), h('span', { class: 'nav-badge', 'aria-hidden': 'true' }));
  const nav = h('nav', { id: 'section-nav', class: 'section-nav', 'aria-label': t('Abschnitte dieser Seite') }, toggle, list);
  function close() {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) items[0]?.focus();
  });
  nav.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && nav.classList.contains('open')) {
      close();
      toggle.focus();
    }
  });
  outside = (ev) => { if (!nav.contains(ev.target)) close(); };
  document.addEventListener('click', outside);
  document.body.append(nav);
  applyBadges();
  // Meldungen unten (Toasts) dürfen den Knopf nicht verdecken: Höhe beobachten und darüber ausweichen
  const lift = () => {
    const box = document.querySelector('.toasts');
    const r = box?.getBoundingClientRect();
    const h = r && r.height > 0 ? Math.ceil(window.innerHeight - r.top) : 0;
    nav.style.setProperty('--toast-lift', `${h}px`);
  };
  if (typeof MutationObserver === 'function') {
    // Sofort nach jeder Änderung an den Meldungen (Mikrotask, vor dem nächsten Zeichnen) – nicht erst beim Neuzeichnen
    toastWatch = new MutationObserver(lift);
    toastWatch.observe(document.body, { childList: true, subtree: true });
  }
  onResize = lift;
  window.addEventListener('resize', onResize, { passive: true });
  lift();

  // Aktuellen Abschnitt markieren
  if (typeof IntersectionObserver === 'function') {
    const visible = new Map();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
      const best = targets.find((el) => (visible.get(el) ?? 0) > 0);
      for (const a of items) {
        const on = best && a.dataset.key === best.dataset.nav;
        if (on) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }, { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.01] });
    for (const el of targets) observer.observe(el);
  }
  return nav;
}
