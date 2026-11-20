import { h } from '../lib/dom.js';
import { listLinks, removeLink, storageAvailable } from '../lib/store.js';
import { formatShort } from '../lib/dates.js';
import { page, card, mount, setTitle, notice } from './common.js';
import { t } from '../lib/i18n.js';
import { donationCard } from '../lib/donation.js';

export function renderHome(root) {
  setTitle('');
  const links = listLinks();
  const list = h('ul', { class: 'round-list' });
  for (const e of links) {
    const role = e.kind === 'a' ? t('Organisation') : t('Teilnahme');
    const del = h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-small',
      title: t('Nur von diesem Gerät entfernen'),
      on: {
        click: () => {
          if (!confirm(e.kind === 'a'
            ? t('„{title}“ von diesem Gerät entfernen?\n\nDie Runde selbst bleibt bestehen. Ohne gesicherten Link kommst du nicht mehr in die Verwaltung.', { title: e.title })
            : t('„{title}“ von diesem Gerät entfernen?\n\nDie Runde selbst bleibt bestehen. Ohne gesicherten Link brauchst du deinen Wiederherstellungscode.', { title: e.title }))) return;
          removeLink(e);
          renderHome(root);
        },
      },
    }, t('Entfernen'));
    list.appendChild(h('li', null,
      h('a', { href: e.fragment, class: 'round-link' },
        h('span', { class: 'round-link-title' }, e.title || t('Wichtelrunde')),
        h('span', { class: 'round-link-meta' }, `${role}${e.who ? ' · ' + e.who : ''}${e.eventDate ? ' · ' + formatShort(e.eventDate) : ''}`),
      ),
      del,
    ));
  }

  // Unterstützungslink des Betreibers (2.12), nur falls eingeschaltet; kommt nachträglich, blockiert nichts
  const support = donationCard(card);

  mount(root, page(
    h('section', { class: 'hero' },
      h('h1', null, t('Wichteln ohne Konto.'), h('br'), h('span', { class: 'accent' }, t('Und ohne Datenspur.'))),
      h('p', { class: 'lead' }, t('ZeroWichtel lost aus, wer wen beschenkt – Ende-zu-Ende-verschlüsselt. Der Server kann weder Namen noch Wünsche noch die Zuordnung lesen. Spätestens 14 Tage nach dem Wichteldatum ist alles gelöscht.')),
      h('div', { class: 'hero-actions' },
        h('a', { class: 'btn btn-primary btn-large', href: '#neu' }, t('Neue Wichtelrunde anlegen')),
        h('a', { class: 'btn btn-large', href: '#wiederherstellen' }, t('Zugang wiederherstellen')),
      ),
    ),
    !storageAvailable() ? notice(t('Dieser Browser speichert keine Daten (z. B. privater Modus). Sichere deine Links unbedingt selbst.'), 'warn') : null,
    links.length ? card(t('Meine Runden auf diesem Gerät'), list) : null,
    card(t('So funktioniert’s'),
      h('ol', { class: 'steps' },
        h('li', null, h('strong', null, t('Runde anlegen. ')), t('Titel, Spielart, Betragslimit und Fristen festlegen.')),
        h('li', null, h('strong', null, t('Einladen. ')), t('Jede Person bekommt einen eigenen Link – per Signal, Threema, Nachrichten oder E-Mail. Oder du teilst einen Gruppenlink, über den sich alle selbst eintragen.')),
        h('li', null, h('strong', null, t('Zusagen. ')), t('Alle sagen „dabei“ oder „diesmal raus“.')),
        h('li', null, h('strong', null, t('Losen und wünschen. ')), t('Die Ziehung passiert verschlüsselt im Browser; jede:r sieht nur die eigene Person und deren Wünsche.')),
      ),
      h('p', { class: 'muted' }, t('Keine Konten, keine Passwörter, keine Cookies, kein Tracking.')),
      h('p', { class: 'home-links' },
        h('a', { href: '#demo' }, t('Ziehung ausprobieren – ohne Anmeldung →')), h('br'),
        h('a', { href: '#wuerfel' }, t('Nur Schrottwichteln würfeln – ganz ohne Runde →')), h('br'),
        h('a', { href: '#analog' }, t('Analoge Wichtelrunde zum Ausdrucken – ganz ohne Handy →'))),
    ),
    support,
  ));
}
