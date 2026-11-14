// Gruppenlink (#j/…): ein Link für alle, jede Person trägt sich selbst ein.
// Wie beim Annehmen einer Einladung entstehen Schlüssel, Zugang und Wiederherstellungscode nur in diesem Browser.

import { h, add, errorBox, field, actionButton } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { x25519Supported } from '../lib/crypto.js';
import { saveLink, listLinks } from '../lib/store.js';
import { t, tn } from '../lib/i18n.js';
import { page, card, mount, setTitle, loading, notice, roundHeader, factList, md } from './common.js';
import { rulesView } from './rules-editor.js';

export async function renderJoin(root, jctx, { onJoined }) {
  setTitle(t('Gruppenlink'));
  mount(root, loading());
  let data;
  try {
    data = await M.loadJoin(jctx);
  } catch (e) {
    const mine = listLinks().find((l) => l.kind === 'p' && l.roundId === jctx.roundId);
    const back = mine ? card(t('Dein Zugang ist auf diesem Gerät gespeichert'), h('a', { class: 'btn btn-primary', href: mine.fragment }, t('Zur Wichtelrunde'))) : null;
    if (e.status === 410) mount(root, page(notice(e.message, 'warn'), back));
    else if (e.status === 404) mount(root, page(notice(t('Dieser Gruppenlink ist ungültig. Vielleicht wurde er widerrufen oder durch einen neuen ersetzt, oder die Runde ist bereits gelöscht.'), 'warn'), back));
    else mount(root, page(errorBox(e)));
    return;
  }

  const { round, meta, free } = data;
  setTitle(meta.title);
  const supported = await x25519Supported();
  const mine = listLinks().filter((l) => l.kind === 'p' && l.roundId === jctx.roundId);

  const nameInput = h('input', { type: 'text', maxlength: M.LIMITS.name, autocomplete: 'nickname', required: true });
  const join = actionButton(t('Mich eintragen'), async () => {
    const { pctx, recoveryCode } = await M.joinRound(jctx, nameInput.value);
    const fragment = M.personFragment(pctx);
    saveLink({ kind: 'p', roundId: pctx.roundId, pid: pctx.pid, fragment, title: meta.title, eventDate: round.eventDate, recoveryCode, confirmed: false });
    sessionStorage.setItem('zw.justJoined', pctx.pid);
    // Gruppenlink aus dem Verlauf ersetzen: Zurück führt zur eigenen Seite, nicht zum Eintragen.
    history.replaceState(null, '', fragment);
    onJoined(pctx);
  }, { cls: 'btn btn-primary btn-large' });

  const form = h('div', { class: 'join-form' },
    field(t('Dein Name'), nameInput, t('So sehen dich die anderen in der Runde. Ein Spitzname reicht.')),
    supported ? join : notice(t('Dein Browser ist zu alt für die Verschlüsselung (X25519). Bitte aktualisiere ihn oder nutze einen aktuellen Browser.'), 'error'),
    h('p', { class: 'hint' }, t('Beim Eintragen erzeugt dein Browser einen persönlichen Schlüssel, den nur du kennst – auch die Organisator:in nicht. Du bist damit gleich „dabei“; absagen kannst du bis zur Antwortfrist.')));
  nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') join.click(); });

  const already = mine.length
    ? card(t('Du bist schon eingetragen'),
      h('p', null, t('Auf diesem Gerät gibt es bereits eine Teilnahme an dieser Runde.')),
      h('p', null, h('a', { class: 'btn btn-primary', href: mine[0].fragment }, t('Zur Wichtelrunde'))),
      h('details', { class: 'inline-details' }, h('summary', null, t('Jemand anderes auf diesem Gerät eintragen')), form))
    : card(t('Mitmachen'), form);

  const page_ = page(
    roundHeader(round, meta),
    h('p', { class: 'lead' }, t('Du bist eingeladen, dich selbst einzutragen.')),
    meta.greeting ? card(null, md(meta.greeting)) : null,
    card(null, factList(round, meta)),
    round.mode === 'schrott' ? card(t('Spielregeln'), rulesView(meta.rules)) : null,
    already,
  );
  add(page_, h('p', { class: 'hint center' }, tn(free, 'Über diesen Link ist noch {n} Platz frei.', 'Über diesen Link sind noch {n} Plätze frei.')));
  mount(root, page_);
}
