// ZeroWichtel – „verschlüsselt“: Erklärung der Verschlüsselung als Dialog.
// Geöffnet über das Schloss oben rechts und den Link „Verschlüsselung“ im Fußbereich.
// Natives <dialog> mit showModal(): Fokus bleibt im Dialog, Esc schließt, danach Fokus zurück zum Auslöser.

import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

const li = (...c) => h('li', null, ...c);
const b = (text) => h('strong', null, text);

function content() {
  return [
    h('h2', { id: 'crypto-title' }, t('Wie ZeroWichtel verschlüsselt')),
    h('p', { class: 'lead' }, t('Alles Persönliche wird in deinem Browser verschlüsselt, bevor es den Server erreicht. Der Server speichert nur Datensalat – den Schlüssel bekommt er nie.')),

    h('h3', null, t('Der Schlüssel steckt im Link')),
    h('p', null, t('Jeder Link sieht ungefähr so aus: '), h('code', null, `${location.host}${t('/#p/…/schlüssel')}`),
      t('. Der Teil hinter dem '), h('code', null, '#'), t(' heißt Fragment. Browser schicken ihn '),
      b('nie'), t(' an einen Server – er bleibt auf deinem Gerät. Darin stecken die Schlüssel, mit denen dein Browser ver- und entschlüsselt.')),

    h('h3', null, t('Wer was sehen kann')),
    h('ul', { class: 'crypto-who' },
      li(b(t('Server und Betreiber: ')), t('nur verschlüsselte Inhalte. Keine Namen, keine Wünsche, keine Nachrichten, nicht, wer wen beschenkt.')),
      li(b(t('Organisator:in: ')), t('Namen und Zu-/Absagen der Runde – aber nicht, wer wen beschenkt.')),
      li(b(t('Du: ')), t('deine eigene Seite, wen du beschenkst, dessen Wunschliste und eure anonyme Wichtelpost.'))),

    h('h3', null, t('Die Ziehung')),
    h('p', null, t('Ausgelost wird im Browser der Organisator:in. Jede Zuordnung wird sofort mit dem öffentlichen Schlüssel der jeweiligen Person „versiegelt“: Nur diese Person kann sie öffnen. Die Organisator:in sieht das Ergebnis nicht, der Server auch nicht.')),
    h('p', null, t('Für Rückfragen bekommt jedes Paar ein eigenes Postfach mit eigenem Schlüssel. Wichtel und Beschenkte:r haben getrennte Zugänge – so weiß die beschenkte Person nicht, wer fragt.')),

    h('h3', null, t('Was der Server trotzdem weiß')),
    h('p', null, t('Ehrlich gesagt: ein bisschen, damit die App funktioniert.')),
    h('ul', null,
      li(t('Fristen und Wichteldatum (für Erinnerungen und die automatische Löschung),')),
      li(t('wie viele Personen eingeladen sind und wer zu- oder abgesagt hat – als Zufalls-ID, ohne Namen,')),
      li(t('wann etwas geändert wurde,')),
      li(t('im E-Mail-Modus die E-Mail-Adressen und einen optionalen Betreff-Titel – mit dem Serverschlüssel verschlüsselt, denn der Server muss die Mails verschicken können.'))),
    h('p', null, t('IP-Adressen speichert ZeroWichtel nicht. Alles wird spätestens 14 Tage nach dem Wichteldatum endgültig gelöscht.')),

    h('h3', null, t('Grenzen')),
    h('ul', null,
      li(t('Wer deinen Link oder Wiederherstellungscode hat, hat Zugang – behandle ihn wie einen Schlüssel.')),
      li(t('Eine Organisator:in mit Entwicklerwerkzeugen könnte die Ziehung im eigenen Browser mitschneiden. Bei einer Auslosung im Browser lässt sich das nicht ausschließen.')),
      li(t('Du vertraust darauf, dass der Server unveränderten Code ausliefert. Prüfen lässt sich das: Der Quellcode ist offen, zu jeder Version gibt es Prüfsummen.'))),

    h('details', { class: 'crypto-tech' },
      h('summary', null, t('Technische Details')),
      h('ul', null,
        li(b(t('Symmetrisch: ')), t('AES-256-GCM. Jeder Inhalt ist zusätzlich an seinen Zweck gebunden (Runde, Person, Feld), damit nichts vertauscht werden kann.')),
        li(b(t('Versiegeln: ')), t('X25519 (Schlüsseltausch) + HKDF-SHA-256 + AES-256-GCM. Das Schlüsselpaar jeder Person wird aus ihrem Geheimnis im Link abgeleitet.')),
        li(b(t('Zugangs-Tokens: ')), t('zufällig, 128 Bit; der Server speichert nur ihren SHA-256-Hash.')),
        li(b(t('Umsetzung: ')), t('nur die eingebaute WebCrypto-Schnittstelle des Browsers, keine Fremdbibliothek. Server: nur eingebaute Node.js-Module.')),
        li(b(t('E-Mail-Adressen: ')), t('XChaCha20-Poly1305 mit dem Serverschlüssel; schützt eine kopierte Datenbank, nicht vor dem Server selbst.')),
        li(b(t('Schutz der App: ')), t('strenge Content-Security-Policy, keine externen Inhalte, keine Cookies, kein Tracking.')))),

    h('p', { class: 'hint' }, t('Mehr in der '), h('a', { href: '#datenschutz', 'data-close': '' }, t('Datenschutzerklärung')), t(' und der '), h('a', { href: '#hilfe', 'data-close': '' }, t('Hilfe')), '.'),
  ];
}

let dialog = null;

function open() {
  if (!dialog) {
    const close = h('button', { type: 'button', class: 'btn btn-small dialog-close', 'aria-label': t('Erklärung schließen') }, t('Schließen'));
    dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'crypto-title' },
      h('div', { class: 'modal-body' }, ...content()),
      h('div', { class: 'modal-actions' }, close));
    close.addEventListener('click', () => dialog.close());
    // Klick auf den abgedunkelten Hintergrund schließt; Links im Dialog schließen ihn ebenfalls
    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog || ev.target.closest('[data-close]')) dialog.close();
    });
    document.body.append(dialog);
  }
  dialog.showModal();
  dialog.querySelector('.modal-body').scrollTop = 0;
}

export function initCryptoInfo() {
  for (const id of ['crypto-info']) document.getElementById(id)?.addEventListener('click', open);
}
