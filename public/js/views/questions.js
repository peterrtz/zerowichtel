// Rückfragen an die Organisator:in (2.9) – Karten für Teilnehmende und Organisator:in.
import { h, add, clear, svg, toast, actionButton } from '../lib/dom.js';
import * as Q from '../lib/questions.js';
import { formatShort } from '../lib/dates.js';
import { t } from '../lib/i18n.js';
import { card, notice, chip } from './common.js';

const dayDate = (d) => (d ? formatShort(d * 86400 + 43200) : '');

/** Fragezeichen im Kreis (eigene Zeichnung). */
export function helpIcon() {
  return svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20, class: 'help-icon', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { cx: 12, cy: 12, r: 10 }),
    svg('path', { d: 'M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.2' }),
    svg('circle', { cx: 12, cy: 17.6, r: 0.6, class: 'dot' }));
}

/** Knopf „Frage an die Organisator:in“ – springt zur Karte und setzt den Fokus ins Textfeld. */
export function helpButton() {
  return h('button', {
    type: 'button', class: 'btn btn-small help-btn',
    on: {
      click: () => {
        const el = document.getElementById('rueckfragen');
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.querySelector('textarea')?.focus({ preventScroll: true });
      },
    },
  }, helpIcon(), ' ', t('Frage an die Organisator:in'));
}

function counter(textarea) {
  const c = h('p', { class: 'hint char-count', 'aria-live': 'polite' });
  const upd = () => { c.textContent = t('{n} von {max} Zeichen', { n: [...textarea.value].length, max: Q.QUESTION_MAX }); };
  textarea.addEventListener('input', upd);
  upd();
  return c;
}

// ---------------------------------------------------------------- Teilnehmende

export function personQuestionsCard({ pctx, round }) {
  const mode = round.questions?.mode ?? 0;
  if (mode < 1) return null;
  const body = h('div');
  const list = h('div', { class: 'q-list' });

  const text = h('textarea', { rows: 4, maxlength: Q.QUESTION_MAX * 2, id: 'q-text', placeholder: t('z. B. Bis wann muss ich zusagen? Wie funktioniert die Wichtelpost?') });
  const anon = h('input', { type: 'checkbox', id: 'q-anon' });
  const send = actionButton(t('Frage senden'), async () => {
    try {
      const { stored } = await Q.askQuestion(pctx, round, text.value, mode === 2 && anon.checked);
      text.value = '';
      text.dispatchEvent(new Event('input'));
      toast(t('Frage gesendet.'), 'ok');
      if (!stored) toast(t('Dieser Browser speichert nichts – die Antwort auf deine anonyme Frage kannst du hier später nicht abrufen.'), 'warn');
      await renderList();
    } catch (e) {
      toast(e.message, 'error');
    }
  }, { cls: 'btn btn-primary' });

  const renderList = async () => {
    clear(list);
    let qs = [];
    try {
      qs = await Q.loadMyQuestions(pctx, round);
    } catch (e) {
      add(list, notice(e.message, 'warn'));
      return;
    }
    if (!qs.length) return;
    add(list, h('h3', null, t('Deine Fragen')), h('ul', { class: 'q-items' }, qs.map((q) => h('li', { class: 'q-item' },
      h('p', { class: 'q-meta' }, q.anon ? chip(t('anonym'), 'muted') : null, q.day ? ` ${dayDate(q.day)}` : ''),
      h('p', { class: 'q-text' }, q.text),
      q.answer
        ? h('div', { class: 'q-answer' }, h('strong', null, t('Antwort:')), ' ', q.answer)
        : h('p', { class: 'hint' }, q.unavailable ? t('Gerade nicht abrufbar.') : t('Noch keine Antwort.'))))));
  };

  add(body,
    h('p', null, t('Etwas unklar oder brauchst du Hilfe? Frag hier die Organisator:in. Nur sie kann deine Frage lesen.')),
    notice(t('Bitte schreib nichts darüber, wen du beschenkst – auch die Organisator:in soll das nicht erfahren.'), 'info'),
    h('div', { class: 'field' }, h('label', { for: 'q-text' }, t('Deine Frage')), text, counter(text)),
    mode === 2
      ? h('div', { class: 'field' },
        h('label', { class: 'check', for: 'q-anon' }, anon, ' ', t('Anonym fragen')),
        h('p', { class: 'hint' }, t('Die Organisator:in sieht dann nicht, von wem die Frage kommt. Die Antwort siehst du nur in diesem Browser auf diesem Gerät. In kleinen Runden verraten Schreibstil und Uhrzeit trotzdem manchmal, wer gefragt hat.')))
      : null,
    h('div', { class: 'form-actions' }, send),
    list);
  renderList();
  return h('section', { id: 'rueckfragen' }, card(h('span', { class: 'card-title-icon' }, helpIcon(), ' ', t('Frage an die Organisator:in')), body));
}

// ---------------------------------------------------------------- Organisator:in

export function adminQuestionsCard({ ctx, data, reload }) {
  const { round, participants } = data;
  const names = Object.fromEntries(participants.map((p) => [p.id, p.name]));
  const mode = round.questions?.mode ?? 0;
  const body = h('div');
  const list = h('div', { class: 'q-list' });
  const summary = h('summary', null, t('Rückfragen'));

  const radios = [[0, t('Aus')], [1, t('Mit Namen')], [2, t('Mit Namen oder anonym')]].map(([v, label]) => {
    const r = h('input', { type: 'radio', name: 'qmode', value: String(v), checked: mode === v });
    return h('label', { class: 'mode-option' }, r, h('span', null, h('strong', null, label)));
  });
  const saveMode = actionButton(t('Speichern'), async () => {
    const v = Number(body.querySelector('input[name="qmode"]:checked')?.value ?? 0);
    try {
      await Q.setQuestionMode(ctx, v);
      toast(t('Gespeichert.'), 'ok');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }, { cls: 'btn' });

  const renderList = async () => {
    clear(list);
    let qs;
    try {
      qs = await Q.loadAdminQuestions(ctx);
    } catch (e) {
      add(list, notice(e.message, 'warn'));
      return;
    }
    const open = qs.filter((q) => !q.answer && !q.broken).length;
    summary.textContent = open ? t('Rückfragen ({n} offen)', { n: open }) : t('Rückfragen');
    if (!qs.length) {
      if (mode) add(list, h('p', { class: 'hint' }, t('Noch keine Rückfragen.')));
      return;
    }
    add(list, h('ul', { class: 'q-items' }, qs.map((q) => {
      const ta = h('textarea', { rows: 3, maxlength: Q.QUESTION_MAX * 2, 'aria-label': t('Antwort') });
      ta.value = q.answer ?? '';
      return h('li', { class: 'q-item' },
        h('p', { class: 'q-meta' }, q.anon ? chip(t('anonym'), 'muted') : chip(names[q.pid] ?? t('(entfernte Person)'), 'muted'), ` ${dayDate(q.day)}`,
          q.answer ? chip(t('beantwortet'), 'ok') : chip(t('offen'), 'warn')),
        q.broken ? notice(t('Diese Frage lässt sich nicht entschlüsseln.'), 'warn') : h('p', { class: 'q-text' }, q.text),
        q.broken ? null : h('div', { class: 'field' }, ta, counter(ta)),
        h('div', { class: 'form-actions' },
          q.broken ? null : actionButton(q.answer ? t('Antwort ändern') : t('Antworten'), async () => {
            try {
              await Q.answerQuestion(ctx, q, ta.value);
              toast(t('Antwort gespeichert.'), 'ok');
              await renderList();
            } catch (e) { toast(e.message, 'error'); }
          }, { cls: 'btn btn-primary btn-small' }),
          actionButton(t('Löschen'), async () => {
            if (!confirm(t('Diese Rückfrage löschen? Die fragende Person sieht sie dann auch nicht mehr.'))) return;
            try {
              await Q.deleteQuestion(ctx, q.id);
              await renderList();
            } catch (e) { toast(e.message, 'error'); }
          }, { cls: 'btn btn-ghost btn-small' })));
    })));
  };

  add(body,
    h('p', null, t('Teilnehmende können dir Fragen stellen, etwa wenn sie Hilfe brauchen oder etwas nicht verstehen. Fragen und Antworten sind verschlüsselt; der Server kann sie nicht lesen.')),
    h('div', { class: 'mode-pick', role: 'radiogroup', 'aria-label': t('Rückfragen') }, radios),
    h('p', { class: 'hint' }, t('Anonym: Du siehst nicht, von wem eine Frage kommt. Das kann missbraucht werden, etwa für unfreundliche Nachrichten – schalte es nur ein, wenn es zur Runde passt. Du kannst einzelne Fragen löschen und Rückfragen jederzeit abschalten.')),
    h('div', { class: 'form-actions' }, saveMode),
    list);
  renderList();
  return h('details', { class: 'card rules-card', id: 'rueckfragen-admin', open: mode > 0 }, summary, body);
}
