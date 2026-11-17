// ZeroWichtel – Admin-Bereich: Organisator-Codes verwalten.
// Erreichbar unter #backend/<geheimer Pfad>. Eingerichtet wird nur per Konsole (zw admin setup).
// Das Sitzungs-Token lebt ausschließlich in dieser Modul-Variable – kein Cookie, kein Storage.

import { h, add, field, toast, errorBox, actionButton, clear } from '../lib/dom.js';
import { api, ApiError, linkBase } from '../lib/api.js';
import { formatDate } from '../lib/dates.js';
import { shareBar } from '../lib/share.js';
import { page, card, chip, mount, setTitle, loading, notice, codeView, qrSvg } from './common.js';

let session = null; // { auth, slug, expiresAt }
let expiryTimer = null;

const STATUS_CHIP = { aktiv: ['aktiv', 'ok'], aufgebraucht: ['aufgebraucht', 'muted'], abgelaufen: ['abgelaufen', 'warn'] };

function base(slug) {
  return `/admin/${slug}`;
}

function clock(ts) {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function dateTime(ts) {
  return new Date(ts * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function endSession(root, slug, message) {
  session = null;
  clearTimeout(expiryTimer);
  renderLogin(root, slug, message);
}

async function call(root, method, path, body) {
  try {
    return await api(method, base(session.slug) + path, { body, auth: session.auth });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
      endSession(root, session?.slug, e.status === 401 ? 'Sitzung abgelaufen. Bitte neu anmelden.' : 'Der Admin-Bereich ist nicht mehr erreichbar.');
      throw new Error('Abgemeldet.');
    }
    throw e;
  }
}

export async function renderBackend(root, slug) {
  setTitle('Admin');
  if (!/^[a-z2-7]{26}$/.test(slug || '')) {
    mount(root, page(card('Admin-Bereich', notice('Diese Adresse ist unvollständig.', 'error'))));
    return;
  }
  if (session?.slug === slug && session.expiresAt * 1000 > Date.now()) {
    return renderPanel(root);
  }
  renderLogin(root, slug);
}

function renderLogin(root, slug, message) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const code = h('input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', required: true,
    autocapitalize: 'characters', spellcheck: 'false', maxlength: 20, placeholder: '123456', class: 'mono',
  });
  const err = h('div');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, 'Anmelden');
  const form = h('form', { class: 'form' },
    card(null,
      message ? notice(message, 'warn') : null,
      field('Masterpasswort', pw),
      field('Code aus der Authenticator-App', code, 'Ohne Handy: einen der Notfallcodes eingeben (XXXX-XXXX-XXXX). Jeder gilt nur einmal.'),
      err,
      submit,
    ),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.replaceChildren();
    submit.disabled = true;
    try {
      const res = await api('POST', base(slug) + '/login', { body: { password: pw.value, code: code.value.trim() } });
      pw.value = '';
      session = { auth: res.session, slug, expiresAt: res.expiresAt };
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => endSession(root, slug, 'Sitzung abgelaufen. Bitte neu anmelden.'), Math.max(0, res.expiresAt * 1000 - Date.now()));
      await renderPanel(root);
    } catch (e) {
      code.value = '';
      err.appendChild(e instanceof ApiError && e.status === 404
        ? errorBox(new Error('Der Admin-Bereich ist unter dieser Adresse nicht verfügbar.'))
        : errorBox(e));
      submit.disabled = false;
      code.focus();
    }
  });
  mount(root, page(
    h('header', { class: 'round-head' },
      h('div', { class: 'round-kicker' }, chip('Admin', 'admin')),
      h('h1', null, 'Organisator-Codes')),
    form,
    h('p', { class: 'hint' }, 'Nach fünf Fehlversuchen ist die Anmeldung 15 Minuten gesperrt. Die Sitzung endet automatisch; es werden keine Cookies gesetzt.'),
  ));
  pw.focus();
}

async function renderPanel(root) {
  mount(root, loading());
  let data;
  try {
    data = await call(root, 'GET', '/overview');
  } catch (e) {
    if (session) mount(root, page(errorBox(e)));
    return;
  }
  session.expiresAt = data.expiresAt;
  const slug = session.slug;
  const reload = () => renderPanel(root);

  // ---------- Neuer Code
  const label = h('input', { type: 'text', maxlength: 60, placeholder: 'z. B. Familie M. oder Verein' });
  const rounds = h('input', { type: 'number', min: 1, max: 20, step: 1, inputmode: 'numeric', value: '3' });
  const days = h('input', { type: 'number', min: 1, max: 365, step: 1, inputmode: 'numeric', value: '60' });
  const result = h('div');
  const createForm = h('form', { class: 'form' },
    field('Für wen?', label, 'Nur für deine Übersicht. Wird nicht an die Person weitergegeben.'),
    h('div', { class: 'grid-2' },
      field('Runden', rounds),
      field('Gültig (Tage)', days)),
    h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Code erzeugen')),
    result,
  );
  createForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = createForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await call(root, 'POST', '/codes', { label: label.value.trim(), rounds: Number(rounds.value), days: Number(days.value) });
      const link = `${linkBase()}/#neu/${res.code}`;
      const text = `Hier ist dein Organisator-Code für ZeroWichtel: ${res.code}\n`
        + `Damit kannst du ${res.rounds === 1 ? 'eine Wichtelrunde' : `bis zu ${res.rounds} Wichtelrunden`} anlegen (gültig bis ${formatDate(res.expiresAt)}).\n`
        + `Direkt loslegen: ${link}`;
      clear(result).appendChild(h('div', { class: 'card card-reveal new-code' },
        h('p', null, h('strong', null, 'Neuer Code – wird nur jetzt angezeigt.')),
        codeView(res.code),
        qrSvg(link, { size: 148, label: 'QR-Code: Runde mit diesem Code anlegen' }),
        shareBar({ title: 'ZeroWichtel-Organisator-Code', text, subject: 'Dein Organisator-Code für ZeroWichtel' }),
        h('p', { class: 'hint' }, 'Der Code steht im Text und im Link. Wer ihn hat, kann Runden anlegen – also wie ein Passwort weitergeben.'),
      ));
      label.value = '';
      toast('Code erzeugt.', 'ok');
      refreshList();
    } catch (e) {
      toast(e?.message || String(e), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Liste
  const listCard = card('Codes');
  function renderList(codes) {
    const list = h('ul', { class: 'people' });
    if (!codes.length) list.appendChild(h('li', null, h('span', { class: 'empty' }, 'Noch keine Codes.')));
    for (const c of codes) {
      const [txt, kind] = STATUS_CHIP[c.status] || [c.status, ''];
      add(list, h('li', { class: 'person' },
        h('div', { class: 'person-main' },
          h('span', { class: 'person-name' }, c.label || '–'),
          h('div', { class: 'person-chips' },
            chip(txt, kind),
            chip(`${c.usedRounds}/${c.maxRounds} Runden`, 'muted'),
            chip(c.status === 'abgelaufen' ? `seit ${formatDate(c.expiresAt)}` : `bis ${formatDate(c.expiresAt)}`, 'muted'))),
        c.status === 'aktiv'
          ? h('div', { class: 'person-actions' }, actionButton('Widerrufen', async () => {
            if (!confirm(`Code „${c.label || '–'}“ widerrufen? Bereits angelegte Runden bleiben bestehen.`)) return;
            await call(root, 'DELETE', `/codes/${c.ref}`);
            toast('Code widerrufen.', 'ok');
            reload();
          }, { cls: 'btn btn-small btn-danger' }))
          : null,
      ));
    }
    listCard.replaceChildren(h('h2', null, 'Codes'), list,
      h('p', { class: 'hint' }, 'Abgelaufene Codes verschwinden 90 Tage nach Ablauf automatisch.'));
  }
  async function refreshList() {
    try {
      const d = await call(root, 'GET', '/overview');
      renderList(d.codes);
      renderOverview(d.stats);
    } catch { /* Meldung kam bereits */ }
  }
  renderList(data.codes);

  // ---------- Überblick
  const overview = card('Überblick');
  function renderOverview(st) {
    const facts = [
      ['Runden', `${st.rounds} (offen ${st.roundsOpen}, ausgelost ${st.roundsDrawn})`],
      ['Personen', `${st.participants} eingeladen, ${st.claimed} angenommen`],
      ['E-Mail-Modus', `${st.emailRounds} Runde(n)`],
      ['Nächste Löschung', st.nextDeletion ? formatDate(st.nextDeletion) : '–'],
      ['Aktive Codes', String(st.activeCodes)],
      ['Runden ohne Code', String(st.roundsWithoutCode ?? 0)],
      ['Analoge Runden vorbereitet', st.analog ? `${st.analog.total} insgesamt, ${st.analog.years?.[new Date().getFullYear()] ?? 0} in diesem Jahr` : '–'],
      ['Notfallcodes übrig', `${st.recoveryLeft} von 10`],
    ];
    overview.replaceChildren(...[h('h2', null, 'Überblick'),
      h('dl', { class: 'facts' }, facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
      st.recoveryLeft <= 3 ? notice('Nur noch wenige Notfallcodes. Neue erzeugen: zw admin recovery', 'warn') : null,
      h('p', { class: 'hint' }, 'Nur Zähler. Namen, Wünsche und Zuordnungen sind verschlüsselt und auch hier nicht einsehbar.'),
    ].filter(Boolean));
  }
  renderOverview(data.stats);

  // ---------- Anlegen ohne Code
  const openCard = card('Anlegen ohne Code');
  function renderOpen(o) {
    const on = h('input', { type: 'checkbox', checked: o.enabled });
    const max = h('input', { type: 'number', min: 1, max: 500, step: 1, inputmode: 'numeric', value: String(o.maxRounds) });
    const mail = h('input', { type: 'checkbox', checked: o.email });
    const save = actionButton('Speichern', async () => {
      const res = await call(root, 'PUT', '/open', { enabled: on.checked, maxRounds: Number(max.value), email: mail.checked });
      toast(res.openCreation.enabled ? 'Anlegen ohne Code eingeschaltet.' : 'Anlegen ohne Code ausgeschaltet.', 'ok');
      renderOpen(res.openCreation);
    }, { cls: 'btn btn-primary' });
    openCard.replaceChildren(...[h('h2', null, 'Anlegen ohne Code'),
      o.codeRequiredByConfig
        ? null
        : notice('In config.json steht "require_organizer_code": false – dann kann ohnehin jede:r ohne Code und ohne Obergrenze Runden anlegen. Diese Einstellung greift erst, wenn dort wieder true steht.', 'warn'),
      h('p', null, 'Mit Organisator-Code geht das Anlegen immer (bis zum Kontingent des Codes). Ohne Code nur, solange weniger Runden ohne Code bestehen als hier erlaubt. Eine Runde belegt ihren Platz, bis sie gelöscht ist – sofort durch die Organisator:in oder spätestens 14 Tage nach dem Wichteldatum.'),
      h('label', { class: 'check' }, on, ' Anlegen ohne Code erlauben'),
      field('Höchstens gleichzeitig bestehende Runden ohne Code', max),
      h('label', { class: 'check' }, mail, ' E-Mail-Versand auch für Runden ohne Code'),
      h('p', { class: 'hint' }, 'Empfehlung: E-Mail für Runden ohne Code aus lassen. Sonst kann jede:r ohne Code über deinen Mailversand Nachrichten an fremde Adressen auslösen (begrenzt, aber möglich). Einladen per Teilen-Menü geht immer.'),
      h('p', { class: 'stats' }, chip(`belegt: ${o.used} von ${o.maxRounds}`, o.enabled && o.free === 0 ? 'warn' : 'muted'), ' ', chip(o.enabled ? `frei: ${o.free}` : 'aus', o.enabled ? 'ok' : 'muted')),
      h('div', { class: 'form-actions' }, save)].filter(Boolean));
  }
  renderOpen(data.openCreation);

  // ---------- Protokoll
  const log = h('details', { class: 'card' },
    h('summary', null, 'Protokoll'),
    h('ul', { class: 'log-list' }, data.log.map((l) => h('li', null,
      h('span', { class: 'log-time' }, dateTime(l.ts)),
      h('span', null, l.event, l.detail ? h('span', { class: 'muted' }, ` · ${l.detail}`) : null)))),
    h('p', { class: 'hint' }, 'Ohne IP-Adressen, 90 Tage.'),
  );

  mount(root, page(
    h('header', { class: 'round-head' },
      h('div', { class: 'round-kicker' }, chip('Admin', 'admin'), h('span', { class: 'muted' }, `Abmeldung um ${clock(session.expiresAt)}`)),
      h('h1', null, 'Organisator-Codes')),
    card('Neuer Code', createForm),
    listCard,
    openCard,
    overview,
    log,
    h('div', { class: 'form-actions' },
      actionButton('Abmelden', async () => {
        try { await call(root, 'POST', '/logout'); } catch { /* ohnehin abgemeldet */ }
        endSession(root, slug, 'Abgemeldet.');
      }, { cls: 'btn' })),
  ));
}
