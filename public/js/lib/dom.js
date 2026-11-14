// ZeroWichtel – DOM-Hilfen. Es gibt bewusst kein innerHTML im ganzen Projekt:
// Text gelangt ausschließlich über textContent bzw. Textknoten ins Dokument.

import { t } from './i18n.js';

const PROP_KEYS = new Set(['value', 'checked', 'selected', 'indeterminate']);
// Erlaubt: https, mailto, sms, Fragment und relative Pfade – aber keine protokollrelativen URLs (//fremd.example).
const SAFE_URL = /^(https:|mailto:|sms:|#|\/(?!\/))/i;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (PROP_KEYS.has(k)) el[k] = v;
    else if (/^on/i.test(k)) throw new Error('Inline-Handler sind nicht erlaubt');
    else if ((k === 'href' || k === 'src' || k === 'action') && !SAFE_URL.test(String(v))) throw new Error(`Unsichere URL in ${k}`);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Wie Element.append, ignoriert aber null/undefined/false (natives append schreibt sonst „null“). */
export function add(el, ...children) {
  return append(el, children);
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.appendChild(c);
  return el;
}

// ---------- Meldungen ----------

// Erfolgs- und Hinweismeldungen: höflich angesagt, 7 s sichtbar, pausieren bei Maus oder Fokus.
// Fehlermeldungen: sofort angesagt (role=alert) und bleiben stehen, bis man sie schließt (WCAG 2.2.1, 4.1.3).
let toastRoot = null;
let alertRoot = null;
const TOAST_MS = 7000;

function regions() {
  if (!toastRoot) {
    const wrap = h('div', { class: 'toasts' });
    toastRoot = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    alertRoot = h('div', { class: 'toast-stack', role: 'alert', 'aria-live': 'assertive' });
    wrap.append(alertRoot, toastRoot);
    document.body.appendChild(wrap);
  }
}

export function toast(message, kind = 'info') {
  regions();
  const isError = kind === 'error';
  const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': t('Meldung schließen') }, '✕');
  const el = h('div', { class: ['toast', `toast-${kind}`] }, h('span', { class: 'toast-text' }, message), close);
  const target = isError ? alertRoot : toastRoot;
  while (target.children.length >= 2) target.firstChild.remove();
  target.appendChild(el);
  const remove = () => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); };
  close.addEventListener('click', remove);
  if (isError) return;
  let timer = setTimeout(remove, TOAST_MS);
  const pause = () => clearTimeout(timer);
  const resume = () => { clearTimeout(timer); timer = setTimeout(remove, TOAST_MS); };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);
}

/** Schließt offene Fehlermeldungen (z. B. beim Seitenwechsel). */
export function clearAlerts() {
  if (alertRoot) alertRoot.replaceChildren();
}

export function errorBox(err) {
  return h('div', { class: 'notice notice-error', role: 'alert' }, err?.message || String(err));
}

/** Button, der während einer asynchronen Aktion gesperrt ist und Fehler anzeigt. */
export function actionButton(label, fn, { cls = 'btn', title } = {}) {
  const b = h('button', { type: 'button', class: cls, title }, label);
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    try {
      await fn(b);
    } catch (e) {
      toast(e?.message || String(e), 'error');
    } finally {
      b.disabled = false;
      b.removeAttribute('aria-busy');
    }
  });
  return b;
}

export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const hintEl = hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null;
  if (hintEl) input.setAttribute('aria-describedby', `${id}-hint`);
  return h('div', { class: 'field' },
    // Pflichtfeld: Sternchen sichtbar; Screenreader erfahren es über das required-Attribut
    h('label', { for: id }, label, input.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    input,
    hintEl,
  );
}

/**
 * Markiert Felder als fehlerhaft, verknüpft die Meldung (aria-describedby) und setzt den Fokus aufs erste Feld.
 * @param {HTMLElement[]} inputs
 * @param {HTMLElement} messageEl Element mit id
 */
export function markInvalid(inputs, messageEl) {
  inputs.forEach((el, i) => {
    el.setAttribute('aria-invalid', 'true');
    const ids = new Set((el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
    ids.add(messageEl.id);
    el.setAttribute('aria-describedby', [...ids].join(' '));
    const clearMark = () => {
      el.removeAttribute('aria-invalid');
      el.setAttribute('aria-describedby', [...ids].filter((x) => x !== messageEl.id).join(' '));
      el.removeEventListener('input', clearMark);
    };
    el.addEventListener('input', clearMark);
    if (i === 0) el.focus();
  });
}
