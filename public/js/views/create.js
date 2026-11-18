import { h, field, toast, errorBox, markInvalid } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { createRound, adminFragment, LIMITS } from '../lib/model.js';
import { setQuestionMode } from '../lib/questions.js';
import { saveLink } from '../lib/store.js';
import { toDateInput, deadlineFromInput, eventFromInput, formatDate, nowSec } from '../lib/dates.js';
import { markdownEditor } from '../lib/editor.js';
import { page, card, mount, setTitle, loading } from './common.js';
import { rulesEditor } from './rules-editor.js';
import { t } from '../lib/i18n.js';

function defaults() {
  const now = new Date();
  let ev = new Date(now.getFullYear(), 11, 24, 12);
  if (ev.getTime() - now.getTime() < 10 * 86400000) ev = new Date(now.getTime() + 30 * 86400000);
  const day = 86400;
  const e = Math.floor(ev.getTime() / 1000);
  return {
    event: e,
    rsvp: Math.max(nowSec() + 3 * day, e - 21 * day),
    wish: Math.max(nowSec() + 6 * day, e - 7 * day),
  };
}

export async function renderCreate(root, prefillCode = '') {
  setTitle(t('Neue Runde'));
  mount(root, loading());
  let info;
  try {
    info = await api('GET', '/info');
  } catch (e) {
    mount(root, page(errorBox(e)));
    return;
  }

  const d = defaults();
  const code = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ZW-XXXX-XXXX-XXXX-XXXX', required: true });
  if (/^ZW-[A-Z0-9-]{16,24}$/i.test(prefillCode)) {
    code.value = prefillCode.toUpperCase();
    // Code nicht in der Adresszeile bzw. im Verlauf stehen lassen
    history.replaceState(null, '', '#neu');
  }
  const title = h('input', { type: 'text', maxlength: LIMITS.title, required: true, placeholder: t('z. B. Familienwichteln 2026') });
  const budget = h('input', { type: 'number', min: 0, max: LIMITS.budgetMax, step: 1, inputmode: 'numeric', placeholder: t('z. B. 30') });
  budget.value = '30';
  const greeting = markdownEditor({
    maxLength: LIMITS.greeting,
    label: t('Begrüßung'),
    placeholder: t('Ihr Lieben, dieses Jahr wichteln wir wieder! …'),
  });
  const rsvp = h('input', { type: 'date', required: true });
  const wish = h('input', { type: 'date', required: true });
  const event = h('input', { type: 'date', required: true });
  rsvp.value = toDateInput(d.rsvp);
  wish.value = toDateInput(d.wish);
  event.value = toDateInput(d.event);
  const delInfo = h('p', { class: 'hint' });

  const modeWichteln = h('input', { type: 'radio', name: 'mode', value: 'wichteln', checked: true });
  const modeSchrott = h('input', { type: 'radio', name: 'mode', value: 'schrott' });
  const wishField = field(t('Wunschfrist'), wish, t('Bis zu diesem Tag (23:59 Uhr) können Wünsche geändert werden.'));
  const rules = rulesEditor(null);
  const rulesCard = card(t('Spielregeln'),
    h('p', { class: 'hint' }, t('Alle Eingeladenen sehen die Regeln vorab. Vor Ort läuft das Spiel auf einem Gerät – mit Rundentimer und auf Wunsch App-Würfel.')),
    rules.el);
  const budgetHint = h('p', { class: 'hint' });

  const sync = () => {
    const isW = modeWichteln.checked;
    wishField.hidden = !isW;
    rulesCard.hidden = isW;
    wish.required = isW;
    budgetHint.textContent = isW
      ? t('Höchstbetrag je Geschenk in ganzen Euro. Leer lassen für „kein Limit“.')
      : t('Beim Schrottwichteln oft 0 € – es kommt, was zu Hause übrig ist.');
    const ev = eventFromInput(event.value);
    delInfo.textContent = ev ? t('Alle Daten werden spätestens am {date} endgültig gelöscht.', { date: formatDate(ev + 14 * 86400) }) : '';
  };
  [modeWichteln, modeSchrott, event].forEach((el) => el.addEventListener('change', sync));
  modeSchrott.addEventListener('change', () => { if (budget.value === '30') budget.value = '0'; });
  sync();

  const emailOn = h('input', { type: 'checkbox' });
  const mailTitle = h('input', { type: 'text', maxlength: 80, placeholder: t('leer lassen = kein Titel in Mails') });
  const emailCard = info.emailAvailable
    ? card(t('E-Mail (optional)'),
      h('label', { class: 'check' }, emailOn, ' ', t('Einladungen und Erinnerungen auch per E-Mail')),
      h('p', { class: 'hint' }, t('Dann kannst du bei jeder Person eine Adresse hinterlegen. Adressen liegen verschlüsselt auf dem Server, werden nur für den Versand entschlüsselt und mit der Runde gelöscht. Mails enthalten keine Namen und keine Wünsche.')),
      field(t('Titel in E-Mail-Betreffzeilen'), mailTitle, t('Optional. Der Server kann diesen Titel lesen – anders als den eigentlichen Rundentitel.')))
    : null;

  // Anlegen ohne Code (2.4): Code optional; E-Mail-Versand ggf. nur mit Code
  const optionalCode = !info.requireOrganizerCode && info.openCreation?.limited && info.openCreation?.available;
  if (optionalCode) code.required = false;
  const emailNeedsCode = optionalCode && !info.openCreation.email;
  if (emailNeedsCode && emailCard) {
    const note = h('p', { class: 'hint email-needs-code' }, t('E-Mail-Versand gibt es nur mit Organisator-Code. Ohne Code lädst du per Teilen-Menü ein.'));
    emailCard.appendChild(note);
    const sync = () => {
      const has = code.value.trim() !== '';
      emailOn.disabled = !has;
      if (!has) emailOn.checked = false;
      note.hidden = has;
    };
    code.addEventListener('input', sync);
    sync();
  }
  // Rückfragen an die Organisator:in (2.9): Standard aus
  const qRadios = [[0, t('Aus'), t('Teilnehmende können dir in der App keine Fragen stellen.')], [1, t('Mit Namen'), t('Du siehst, wer fragt, und antwortest in der App.')],
    [2, t('Mit Namen oder anonym'), t('Zusätzlich können Teilnehmende anonym fragen. Kann missbraucht werden – nur einschalten, wenn es zur Runde passt.')]]
    .map(([v, label, hint]) => h('label', { class: 'mode-option' }, h('input', { type: 'radio', name: 'qmode-create', value: String(v), checked: v === 0 }),
      h('span', null, h('strong', null, label), h('small', null, hint))));
  const questionsCard = card(t('Rückfragen an dich (optional)'),
    h('p', { class: 'hint' }, t('Teilnehmende können dir über ein Hilfe-Symbol Fragen stellen, etwa wenn sie etwas nicht verstehen. Fragen und Antworten sind verschlüsselt. Du kannst das später in der Verwaltung ändern.')),
    h('div', { class: 'mode-pick', role: 'radiogroup', 'aria-label': t('Rückfragen an dich') }, qRadios));
  const errSlot = h('div', { id: 'create-errors' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, t('Runde anlegen'));
  const form = h('form', { class: 'form', novalidate: true },
    h('p', { class: 'hint' }, t('Felder mit * sind Pflichtfelder.')),
    info.requireOrganizerCode
      ? card(t('Organisator-Code'), field(t('Einladungscode'), code, info.openCreation?.full
        ? t('Ohne Code sind gerade alle Plätze belegt. Sobald eine Runde gelöscht ist, wird wieder einer frei – mit Code geht es sofort.')
        : t('Das Anlegen von Runden ist derzeit nur mit einem Code möglich.')))
      : optionalCode
        ? card(t('Organisator-Code (optional)'), field(t('Einladungscode'), code, t('Du kannst auch ohne Code loslegen, solange freie Plätze da sind. Hast du einen Code, trag ihn ein – dann gilt das Kontingent deines Codes.')))
        : null,
    card(t('Spielart'),
      h('div', { class: 'mode-pick', role: 'radiogroup', 'aria-label': t('Spielart') },
        h('label', { class: 'mode-option' }, modeWichteln,
          h('span', null, h('strong', null, t('Wichteln')), h('small', null, t('Verschlüsselte Ziehung, Wunschlisten, anonyme Rückfragen.')))),
        h('label', { class: 'mode-option' }, modeSchrott,
          h('span', null, h('strong', null, t('Schrottwichteln')), h('small', null, t('Alle bringen ein Päckchen mit, vor Ort wird gewürfelt.')))),
      ),
      h('a', { class: 'mode-option mode-link', href: '#analog' },
        h('span', null, h('strong', null, t('Analoge Wichtelrunde')), h('small', null, t('Ganz ohne Handy: Namen eintragen, Lose, Regeln und Karten ausdrucken. Ohne Code, nichts wird auf dem Server gespeichert.')))),
    ),
    card(t('Die Runde'),
      field(t('Titel'), title),
      h('div', { class: 'field' }, h('label', null, t('Begrüßung und Beschreibung (optional)')), greeting.el,
        h('p', { class: 'hint' }, t('Sehen alle Eingeladenen. Fett, kursiv, unterstrichen und Aufzählungen sind möglich.'))),
      h('div', { class: 'field' }, h('label', { for: 'budget' }, t('Betragslimit')),
        h('div', { class: 'input-suffix' }, Object.assign(budget, { id: 'budget' }), h('span', null, '€')), budgetHint),
    ),
    rulesCard,
    card(t('Termine'),
      field(t('Antwortfrist'), rsvp, t('Bis dahin sagen alle zu oder ab.')),
      wishField,
      field(t('Wichteldatum'), event, t('Tag der Bescherung bzw. des Würfelspiels.')),
      delInfo,
    ),
    emailCard,
    questionsCard,
    errSlot,
    h('div', { class: 'form-actions' }, submit, h('a', { class: 'btn btn-ghost', href: '#' }, t('Abbrechen'))),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errSlot.replaceChildren();
    const mode = modeWichteln.checked ? 'wichteln' : 'schrott';
    const r = deadlineFromInput(rsvp.value);
    const w = mode === 'wichteln' ? deadlineFromInput(wish.value) : null;
    const e = eventFromInput(event.value);
    const problems = [];
    const bad = [];
    const fail = (msg, ...els) => { problems.push(msg); bad.push(...els); };
    if (info.requireOrganizerCode && !code.value.trim()) fail(t('Bitte den Organisator-Code eingeben.'), code);
    if (!title.value.trim()) fail(t('Bitte einen Titel angeben.'), title);
    if (!r || !e || (mode === 'wichteln' && !w)) fail(t('Bitte alle Termine ausfüllen.'), ...[!r && rsvp, mode === 'wichteln' && !w && wish, !e && event].filter(Boolean));
    else if (r <= nowSec()) fail(t('Die Antwortfrist muss in der Zukunft liegen.'), rsvp);
    else if (mode === 'wichteln' && !(r < w && w < e)) fail(t('Reihenfolge: Antwortfrist vor Wunschfrist vor Wichteldatum.'), rsvp, wish, event);
    else if (r >= e) fail(t('Die Antwortfrist muss vor dem Wichteldatum liegen.'), rsvp, event);
    let rulesValue = null;
    if (mode === 'schrott') {
      try { rulesValue = rules.get(); } catch (err) { problems.push(err.message); }
    }
    if (problems.length) {
      const msg = h('div', { class: 'notice notice-error', role: 'alert', id: 'create-errors-msg' },
        problems.length === 1 ? problems[0] : h('ul', { class: 'error-list' }, problems.map((p) => h('li', null, p))));
      errSlot.appendChild(msg);
      if (bad.length) markInvalid([...new Set(bad)], msg);
      return;
    }
    submit.disabled = true;
    submit.textContent = t('Wird verschlüsselt und angelegt …');
    try {
      const ctx = await createRound({
        organizerCode: code.value.trim(),
        mode,
        meta: { title: title.value, greeting: greeting.textarea.value, budget: budget.value === '' ? null : budget.value, rules: rulesValue },
        rsvpDeadline: r,
        wishDeadline: w,
        eventDate: e,
        emailEnabled: emailOn.checked,
        mailTitle: mailTitle.value,
      });
      const qMode = Number(form.querySelector('input[name="qmode-create"]:checked')?.value ?? 0);
      if (qMode > 0) {
        try { await setQuestionMode(ctx, qMode); } catch { toast(t('Rückfragen konnten nicht eingeschaltet werden. Du kannst das in der Verwaltung nachholen.'), 'warn'); }
      }
      const fragment = adminFragment(ctx);
      saveLink({ kind: 'a', roundId: ctx.roundId, fragment, title: title.value.trim(), eventDate: e, confirmed: false });
      sessionStorage.setItem('zw.justCreated', ctx.roundId);
      toast('Runde angelegt.', 'ok');
      location.hash = fragment;
    } catch (err) {
      errSlot.appendChild(errorBox(err));
      submit.disabled = false;
      submit.textContent = t('Runde anlegen');
    }
  });

  setTitle(t('Neue Runde'));
  mount(root, page(h('h1', null, t('Neue Wichtelrunde')), form));
}
