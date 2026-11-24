import { h, field, errorBox } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { saveLink } from '../lib/store.js';
import { encodeRecoveryCode, decodeRecoveryCode } from '../lib/crypto.js';
import { page, card, mount, setTitle, notice } from './common.js';
import { readRecoveryFromImage, ImageRejected } from '../lib/recovery-image.js';
import { t } from '../lib/i18n.js';

export function renderRecover(root, prefill = '') {
  setTitle(t('Zugang wiederherstellen'));
  const input = h('input', {
    type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', class: 'mono',
  });
  input.value = prefill;
  const err = h('div');
  // Bild mit QR-Code (eigenes PNG oder Bildschirmfoto) – wird nur im Browser gelesen
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', class: 'visually-hidden', id: 'recover-image', 'aria-describedby': 'recover-image-hint' });
  const fileStatus = h('p', { class: 'hint', 'aria-live': 'polite' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    fileStatus.textContent = t('Bild wird gelesen …');
    try {
      const code = await readRecoveryFromImage(f);
      if (!code) {
        fileStatus.textContent = t('Im Bild wurde kein Wiederherstellungscode gefunden. Versuch ein schärferes Bild oder tipp den Code ab.');
        return;
      }
      input.value = code.match(/.{1,4}/g).join('-');
      fileStatus.textContent = t('Code aus dem Bild übernommen. Jetzt „Wiederherstellen“ wählen.');
      submit.focus();
    } catch (e) {
      fileStatus.textContent = e instanceof ImageRejected ? e.message : t('Das Bild ließ sich nicht lesen.');
    } finally {
      file.value = '';
    }
  });
  const imageBox = h('div', { class: 'recover-image' },
    h('label', { class: 'btn', for: 'recover-image' }, t('Bild mit QR-Code wählen')),
    file,
    h('p', { class: 'hint', id: 'recover-image-hint' }, t('Das gespeicherte Bild oder ein Bildschirmfoto des Wiederherstellungs-QR-Codes. Das Bild verlässt dein Gerät nicht.')),
    fileStatus);
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, t('Wiederherstellen'));
  const form = h('form', { class: 'form' },
    card(null,
      h('p', null, t('Gib deinen Wiederherstellungscode ein (32 Zeichen, Groß-/Kleinschreibung egal). Danach ist dein bisheriger persönlicher Link ungültig, und du bekommst einen neuen.')),
      field(t('Wiederherstellungscode'), input),
      imageBox,
      err,
      submit,
    ),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.replaceChildren();
    submit.disabled = true;
    try {
      const pctx = await M.recoverFromCode(input.value);
      const code = encodeRecoveryCode(decodeRecoveryCode(input.value));
      saveLink({ kind: 'p', roundId: pctx.roundId, pid: pctx.pid, fragment: M.personFragment(pctx), title: t('Wichtelrunde'), recoveryCode: code, confirmed: true });
      // Wer den Code eingegeben hat, hat ihn gesichert – und er bleibt gültig (2.14: nicht erneut „Zugang sichern“ fragen)
      sessionStorage.setItem('zw.justRecovered', pctx.pid);
      history.replaceState(null, '', M.personFragment(pctx));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) {
      err.appendChild(errorBox(e));
      submit.disabled = false;
    }
  });
  mount(root, page(
    h('h1', null, t('Zugang wiederherstellen')),
    form,
    notice(t('Für die Verwaltung einer Runde gibt es keinen Wiederherstellungscode – dafür brauchst du den gesicherten Admin-Link.'), 'info'),
  ));
}
