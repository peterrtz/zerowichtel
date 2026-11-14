// ZeroWichtel – Teilen über das System-Teilen-Menü (Signal, Threema, Nachrichten/iMessage/RCS, Mail …).
// Kein Messenger-API, keine Telefonnummern auf dem Server.

import { h, toast } from './dom.js';
import { t } from './i18n.js';

export function canShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('In die Zwischenablage kopiert.', 'ok');
    return true;
  } catch {
    // Fallback ohne Clipboard-API
    const ta = h('textarea', { class: 'visually-hidden', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    toast(ok ? t('In die Zwischenablage kopiert.') : t('Kopieren nicht möglich – bitte manuell markieren.'), ok ? 'ok' : 'error');
    return ok;
  }
}

/** Öffnet das Teilen-Menü. Der Link steht im Text, damit ihn alle Apps mitnehmen. */
export async function shareText(title, text) {
  if (canShare()) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'aborted';
    }
  }
  await copyText(text);
  return 'copied';
}

/** Leiste mit Teilen, Kopieren, SMS und E-Mail. */
export function shareBar({ title, text, subject, compact = false }) {
  const enc = encodeURIComponent;
  return h('div', { class: ['share-bar', compact && 'share-bar-compact'] },
    h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => shareText(title, text) } },
      canShare() ? t('Teilen …') : t('Kopieren')),
    canShare() ? h('button', { type: 'button', class: 'btn', on: { click: () => copyText(text) } }, t('Kopieren')) : null,
    h('a', { class: 'btn', href: `sms:?&body=${enc(text)}` }, 'SMS'),
    h('a', { class: 'btn', href: `mailto:?subject=${enc(subject || title)}&body=${enc(text)}` }, 'E-Mail'),
  );
}
