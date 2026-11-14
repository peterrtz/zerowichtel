// Direktlink ohne Geheimnis aus E-Mails und Erinnerungen: #zu/<personId>.
// Führt zur eigenen Seite, wenn der Zugang in diesem Browser gespeichert ist.
// Der vollständige persönliche Link steht nie in automatischen Mails – den kennt der Server nicht.

import { h } from '../lib/dom.js';
import { listLinks } from '../lib/store.js';
import { page, card, mount, setTitle } from './common.js';
import { t } from '../lib/i18n.js';

export function renderJump(root, pid) {
  const entry = /^[A-Za-z0-9_-]{22}$/.test(pid || '') ? listLinks().find((e) => e.kind === 'p' && e.pid === pid) : null;
  if (entry) {
    history.replaceState(null, '', entry.fragment);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  setTitle(t('Zu deiner Runde'));
  mount(root, page(
    h('h1', null, t('Zu deiner Runde')),
    card(t('Dein Zugang ist auf diesem Gerät nicht gespeichert'),
      h('p', null, t('Aus Datenschutzgründen steht in E-Mails nicht dein vollständiger persönlicher Link – den kennt nicht einmal der Server. Der Link aus der Mail führt nur auf dem Gerät direkt zu deiner Seite, auf dem du die Einladung angenommen hast.')),
      h('p', null, t('So kommst du hin:')),
      h('ul', null,
        h('li', null, t('Öffne die Mail auf dem Gerät, mit dem du die Einladung angenommen hast, oder')),
        h('li', null, t('öffne deinen persönlichen Link (z. B. aus deinen Notizen oder deinem Passwortmanager), oder')),
        h('li', null, t('stelle deinen Zugang mit dem Wiederherstellungscode wieder her.')),
        h('li', null, t('Noch nicht angenommen? Dann öffne die Einladung, die du bekommen hast.'))),
      h('div', { class: 'form-actions' },
        h('a', { class: 'btn btn-primary', href: '#wiederherstellen' }, t('Zugang wiederherstellen')),
        h('a', { class: 'btn', href: '#' }, t('Zur Startseite'))),
    ),
  ));
}
