// ZeroWichtel – Eingabefeld für Markdown-light mit Format-Buttons und Vorschau.

import { h, clear } from './dom.js';
import { toDom } from './markdown.js';
import { t } from './i18n.js';

function wrapSelection(ta, before, after = before) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e) || t('Text');
  ta.value = value.slice(0, s) + before + sel + after + value.slice(e);
  ta.focus();
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  ta.dispatchEvent(new Event('input'));
}

function toggleList(ta) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const lineEnd = value.indexOf('\n', e) === -1 ? value.length : value.indexOf('\n', e);
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const allList = lines.every((l) => /^- /.test(l));
  const next = lines.map((l) => (allList ? l.replace(/^- /, '') : /^- /.test(l) ? l : `- ${l}`)).join('\n');
  ta.value = value.slice(0, lineStart) + next + value.slice(lineEnd);
  ta.focus();
  ta.setSelectionRange(lineStart, lineStart + next.length);
  ta.dispatchEvent(new Event('input'));
}

/** @returns {{el: HTMLElement, textarea: HTMLTextAreaElement}} */
export function markdownEditor({ value = '', maxLength = 2000, rows = 5, placeholder = '', label = t('Text') } = {}) {
  const ta = h('textarea', { rows, maxlength: maxLength, placeholder, 'aria-label': label });
  ta.value = value;
  const preview = h('div', { class: 'md md-preview', 'aria-live': 'polite' });
  const counter = h('span', { class: 'counter' });
  const update = () => {
    clear(preview).appendChild(toDom(ta.value));
    if (!ta.value.trim()) preview.appendChild(h('p', { class: 'muted' }, t('Vorschau erscheint hier.')));
    counter.textContent = `${ta.value.length} / ${maxLength}`;
  };
  ta.addEventListener('input', update);
  const tool = (lbl, title, fn, cls) => h('button', { type: 'button', class: ['tool', cls], title, 'aria-label': title, on: { click: fn } }, lbl);
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': t('Formatierung') },
    tool('B', t('Fett'), () => wrapSelection(ta, '**'), 'tool-b'),
    tool('I', t('Kursiv'), () => wrapSelection(ta, '*'), 'tool-i'),
    tool('U', t('Unterstrichen'), () => wrapSelection(ta, '++'), 'tool-u'),
    tool(t('• Liste'), t('Aufzählung'), () => toggleList(ta)),
    counter,
  );
  const details = h('details', { class: 'preview-toggle' }, h('summary', null, t('Vorschau')), preview);
  update();
  return { el: h('div', { class: 'editor' }, toolbar, ta, details), textarea: ta };
}
