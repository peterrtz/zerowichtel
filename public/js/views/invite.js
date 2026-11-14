import { h, errorBox, actionButton } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { x25519Supported } from '../lib/crypto.js';
import { saveLink, listLinks } from '../lib/store.js';
import { t } from '../lib/i18n.js';
import { page, card, mount, setTitle, loading, notice, roundHeader, factList, md } from './common.js';
import { rulesView } from './rules-editor.js';

export async function renderInvite(root, ictx, { onClaimed }) {
  setTitle(t('Einladung'));
  mount(root, loading());
  let data;
  try {
    data = await M.loadInvite(ictx);
  } catch (e) {
    if (e.status === 410) {
      const mine = listLinks().find((l) => l.kind === 'p' && l.roundId === ictx.roundId && l.pid === ictx.pid);
      mount(root, page(
        notice(t('Diese Einladung wurde bereits angenommen.'), 'warn'),
        mine
          ? card(t('Dein Zugang ist auf diesem Gerät gespeichert'), h('a', { class: 'btn btn-primary', href: mine.fragment }, t('Zur Wichtelrunde')))
          : card(t('Warst das nicht du?'),
            h('p', null, t('Dann hat jemand anderes deinen Link zuerst geöffnet. Bitte die Organisator:in, dir eine neue Einladung zu schicken.')),
            h('p', null, t('Hast du die Einladung selbst angenommen und deinen Link verloren? Dann hilft dein Wiederherstellungscode.')),
            h('a', { class: 'btn', href: '#wiederherstellen' }, t('Zugang wiederherstellen'))),
      ));
    } else if (e.status === 404) {
      mount(root, page(notice(t('Diese Einladung ist ungültig. Vielleicht wurde sie neu ausgestellt oder die Runde ist bereits gelöscht.'), 'warn')));
    } else {
      mount(root, page(errorBox(e)));
    }
    return;
  }

  const { round, meta, name } = data;
  setTitle(meta.title);
  const supported = await x25519Supported();

  const accept = actionButton(t('Einladung annehmen'), async () => {
    const { pctx, recoveryCode } = await M.claimInvite(ictx);
    const fragment = M.personFragment(pctx);
    saveLink({ kind: 'p', roundId: pctx.roundId, pid: pctx.pid, fragment, title: meta.title, eventDate: round.eventDate, recoveryCode, confirmed: false });
    sessionStorage.setItem('zw.justClaimed', pctx.pid);
    // Einladung aus dem Verlauf ersetzen: Zurück-Taste führt nicht zur eingelösten Einladung.
    history.replaceState(null, '', fragment);
    onClaimed(pctx);
  }, { cls: 'btn btn-primary btn-large' });

  mount(root, page(
    roundHeader(round, meta),
    h('p', { class: 'lead' }, t('Hallo {name}! Du bist eingeladen.', { name })),
    meta.greeting ? card(null, md(meta.greeting)) : null,
    card(null, factList(round, meta)),
    round.mode === 'schrott' ? card(t('Spielregeln'), rulesView(meta.rules)) : null,
    round.status !== 'offen'
      ? notice(t('Diese Runde nimmt keine neuen Zusagen mehr an.'), 'warn')
      : card(t('Mitmachen'),
        h('p', null, t('Beim Annehmen erzeugt dein Browser einen persönlichen Schlüssel, den nur du kennst – auch die Organisator:in nicht. Danach sagst du zu oder ab.')),
        supported ? accept : notice(t('Dein Browser ist zu alt für die Verschlüsselung (X25519). Bitte aktualisiere ihn oder nutze einen aktuellen Browser.'), 'error'),
        h('p', { class: 'hint' }, t('Diese Einladung gilt nur für dich und lässt sich genau einmal annehmen.')),
      ),
  ));
}
