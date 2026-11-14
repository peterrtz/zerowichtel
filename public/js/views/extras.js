// Kleine Extras rund ums Wichteln: Countdown mit Adventstürchen und Schnee, Enthüllungsmoment, Ideen-Würfel.
// Alles läuft nur im Browser; nichts davon erreicht den Server.

import { h, add, clear } from '../lib/dom.js';
import { t, tn } from '../lib/i18n.js';
import { calendarDaysUntil, formatDate, euro } from '../lib/dates.js';
import { rollIdea, adventTip } from '../lib/ideas.js';
import { reducedMotion, snowWanted, setSnowWanted, startSnow, stopSnow, snowRunning } from '../lib/snow.js';

// ---------- Countdown

/** Countdown bis zum Wichteldatum; im Advent zusätzlich ein Türchen mit Tipp. Nach dem Termin: null. */
export function countdownCard(round, now = new Date()) {
  const days = calendarDaysUntil(round.eventDate, now.getTime());
  if (days < 0) {
    stopSnow();
    return null;
  }
  const big = days === 0 ? t('Heute!') : String(days);
  const wichteln = round.mode === 'wichteln';
  const text = days === 0
    ? (wichteln ? t('Heute ist Bescherung.') : t('Heute ist Spieleabend.'))
    : wichteln
      ? tn(days, 'Noch {n} Tag bis zur Bescherung.', 'Noch {n} Tage bis zur Bescherung.')
      : tn(days, 'Noch {n} Tag bis zum Spieleabend.', 'Noch {n} Tage bis zum Spieleabend.');

  const advent = now.getMonth() === 11 && now.getDate() <= 24 ? now.getDate() : null;
  const door = advent
    ? h('div', { class: 'advent' },
      h('span', { class: 'advent-door', 'aria-hidden': 'true' }, String(advent)),
      h('p', null, h('strong', null, t('Türchen {n}:', { n: advent })), ' ', adventTip(advent)))
    : null;

  let snow = null;
  if (reducedMotion()) {
    stopSnow();
  } else {
    if (snowWanted()) startSnow();
    else stopSnow();
    snow = h('button', { type: 'button', class: 'btn btn-small btn-ghost snow-toggle', 'aria-pressed': String(snowRunning()) }, t('Schneefall'));
    snow.addEventListener('click', () => {
      const on = !snowRunning();
      setSnowWanted(on);
      if (on) startSnow(); else stopSnow();
      snow.setAttribute('aria-pressed', String(on));
    });
  }

  return h('section', { class: 'card countdown' },
    h('div', { class: 'countdown-row' },
      h('span', { class: ['countdown-num', days === 0 && 'countdown-today'], 'aria-hidden': 'true' }, big),
      h('div', null,
        h('p', { class: 'countdown-text' }, text),
        h('p', { class: 'hint' }, formatDate(round.eventDate)))),
    door,
    snow ? h('div', { class: 'countdown-actions' }, snow) : null);
}

// ---------- Enthüllungsmoment

const REVEALED = 'zw.revealed';

function revealedSet() {
  try {
    const v = JSON.parse(localStorage.getItem(REVEALED) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

function markRevealed(key) {
  const s = revealedSet();
  s.add(key);
  try { localStorage.setItem(REVEALED, JSON.stringify([...s].slice(-50))); } catch { /* privater Modus */ }
}

/**
 * Beim ersten Ansehen nach der Ziehung liegt die Zuordnung in einem Päckchen, das man auspackt.
 * key: z. B. Personen-ID plus Zeitpunkt der Ziehung (nach einer Neuziehung gibt es wieder ein Päckchen).
 * content: Elemente, die danach sichtbar sind.
 */
export function revealBox(key, content) {
  const wrap = h('div', { class: 'reveal-wrap' });
  if (revealedSet().has(key)) {
    add(wrap, content);
    return wrap;
  }
  const box = h('button', { type: 'button', class: 'gift', 'aria-describedby': 'gift-hint' },
    h('span', { class: 'gift-lid', 'aria-hidden': 'true' }),
    h('span', { class: 'gift-box', 'aria-hidden': 'true' }),
    h('span', { class: 'gift-label' }, t('Päckchen auspacken')));
  const hint = h('p', { class: 'hint', id: 'gift-hint' }, t('Es wurde ausgelost! Im Päckchen steht, wen du beschenkst.'));
  box.addEventListener('click', () => {
    markRevealed(key);
    const show = () => {
      clear(wrap);
      add(wrap, h('div', { class: 'reveal-in' }, content));
      const name = wrap.querySelector('.reveal-name');
      if (name) {
        name.setAttribute('tabindex', '-1');
        name.focus();
      }
    };
    if (reducedMotion()) return show();
    box.classList.add('gift-open');
    box.disabled = true;
    setTimeout(show, 700);
  });
  add(wrap, h('div', { class: 'gift-stage' }, box), hint);
  return wrap;
}

// ---------- Ideen-Würfel

export function ideaDice(budget) {
  let last = null;
  const out = h('p', { class: 'idea-out', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'btn btn-small' }, t('Idee würfeln'));
  btn.addEventListener('click', () => {
    last = rollIdea(budget, last);
    out.textContent = last;
    btn.textContent = t('Noch eine Idee');
  });
  return h('div', { class: 'idea-dice' },
    h('p', { class: 'hint' }, t('Keine Idee? Der Würfel schlägt etwas vor, das zum Betragslimit ({budget}) passt – aus einer festen Liste, ohne Shop und ohne Tracking.', { budget: euro(budget) })),
    btn, out);
}
