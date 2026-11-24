// Nachricht der Organisator:in an alle (2.14): Karte in der Verwaltung und Anzeige auf den Seiten der Teilnehmenden.
import { h, add, toast, actionButton } from '../lib/dom.js';
import * as A from '../lib/announce.js';
import { formatDateTime } from '../lib/dates.js';
import { t, tn } from '../lib/i18n.js';
import { card, md, notice, chip, whenSeen } from './common.js';
import { setNavBadge } from './section-nav.js';

const TEMPLATE = () => t('Hallo zusammen! Kurze Erinnerung: Schaut bitte einmal auf eure Seite. Direkt unter dieser Nachricht seht ihr, ob bei euch noch etwas offen ist – zum Beispiel die Zusage, eure Wünsche oder eine Frage in der Wichtelpost. Danke!');

/** Verwaltung: schreiben, mit eigenen offenen Aufgaben, optional Hinweis per E-Mail; frühere Nachrichten löschen. */
export function adminAnnounceCard({ ctx, data, reload }) {
  const { round } = data;
  const list = data.announcements ?? [];
  const ta = h('textarea', { id: 'announce-text', rows: 5, maxlength: A.ANNOUNCE_MAX });
  const todos = h('input', { type: 'checkbox', id: 'announce-todos', checked: true });
  const mailable = data.emailAvailable && round.emailEnabled;
  const mail = h('input', { type: 'checkbox', id: 'announce-mail', checked: mailable && !data.announceMailToday, disabled: !mailable || data.announceMailToday });
  const full = list.length >= A.ANNOUNCE_COUNT;

  const send = actionButton(t('An alle senden'), async () => {
    if (full) throw new Error(t('Höchstens {n} Nachrichten. Bitte eine alte löschen.', { n: A.ANNOUNCE_COUNT }));
    const res = await A.sendAnnouncement(ctx, { text: ta.value, todos: todos.checked, mail: mail.checked && !mail.disabled });
    toast(res.mailQueued ? t('Gesendet. Der E-Mail-Hinweis geht in den nächsten Minuten raus.') : t('Gesendet. Alle sehen die Nachricht beim nächsten Öffnen ihrer Seite.'), 'ok');
    reload();
  }, { cls: 'btn btn-primary' });

  const sent = list.length
    ? h('ul', { class: 'announce-list' }, list.map((a) => h('li', { class: 'announce-item' },
      h('p', { class: 'meta' }, formatDateTime(a.createdAt), a.todos ? ' · ' : '', a.todos ? chip(t('mit offenen Aufgaben'), 'muted') : null),
      md(a.text),
      actionButton(t('Löschen'), async () => {
        if (!confirm(t('Diese Nachricht löschen? Sie verschwindet dann bei allen.'))) return;
        await A.deleteAnnouncement(ctx, a.id);
        toast(t('Gelöscht.'), 'ok');
        reload();
      }, { cls: 'btn btn-ghost btn-small' }))))
    : h('p', { class: 'hint' }, t('Noch keine Nachricht gesendet.'));

  return card(t('Nachricht an alle'),
    h('p', { class: 'hint' }, t('Erscheint oben auf der Seite aller Eingeladenen. Verschlüsselt mit dem Schlüssel der Runde – der Server kann sie nicht lesen.')),
    h('label', { for: 'announce-text' }, t('Nachricht')),
    ta,
    h('p', null, h('button', { type: 'button', class: 'btn btn-ghost btn-small', on: { click: () => { ta.value = TEMPLATE(); ta.focus(); } } }, t('Vorlage: Erinnerung an offene Aufgaben'))),
    h('label', { class: 'check', for: 'announce-todos' }, todos, ' ', t('Darunter jeder Person ihre eigenen offenen Aufgaben zeigen')),
    h('p', { class: 'hint' }, t('Zum Beispiel fehlende Zusage, leere Wunschliste, ungesicherter Zugang oder eine unbeantwortete Frage in der Wichtelpost. Das berechnet jedes Gerät für sich – du erfährst dadurch nicht, wer was noch offen hat.')),
    h('label', { class: 'check', for: 'announce-mail' }, mail, ' ', t('Zusätzlich Hinweis per E-Mail (ohne Inhalt)')),
    h('p', { class: 'hint' }, !mailable
      ? t('E-Mail-Hinweise gibt es nur, wenn der E-Mail-Modus der Runde eingeschaltet ist.')
      : data.announceMailToday
        ? t('Heute ging schon ein E-Mail-Hinweis raus. Höchstens einer am Tag – die Nachricht selbst kannst du trotzdem senden.')
        : t('An alle mit hinterlegter Adresse, die ihre Einladung angenommen, nicht abgesagt und Erinnerungen nicht abbestellt haben. Die Mail enthält nur einen Hinweis und den Direktlink, nicht deinen Text. Höchstens einer am Tag.')),
    full ? notice(t('Höchstens {n} Nachrichten. Bitte eine alte löschen.', { n: A.ANNOUNCE_COUNT }), 'warn') : null,
    h('p', null, send),
    h('h3', null, t('Gesendet')),
    sent);
}

const SEEN_WHO = (pctx) => pctx.pid;

/**
 * Teilnehmende: neueste Nachricht oben, frühere aufklappbar. todos = eigene offene Aufgaben (Texte, auf diesem Gerät
 * berechnet). Gibt { el, apply } zurück; apply() setzt die Zahl am Sprungmenü (erst wenn es steht).
 */
export function personAnnounceCard({ pctx, list, todos }) {
  if (!list?.length) return { el: null, apply() {} };
  const seen = A.readAnnSeen(pctx.roundId, SEEN_WHO(pctx));
  const fresh = list.filter((a) => a.createdAt > seen);
  const newest = list[0];
  const item = (a, big = false) => h('article', { class: ['announce', big && 'announce-latest'] },
    h('p', { class: 'meta' }, formatDateTime(a.createdAt), a.createdAt > seen ? ' ' : '', a.createdAt > seen ? chip(t('neu'), 'ok') : null),
    md(a.text),
    a.todos ? todoList(todos) : null);
  const older = list.slice(1);
  const el = card(t('Nachricht von der Organisator:in'),
    item(newest, true),
    older.length ? h('details', { class: 'inline-details' }, h('summary', null, tn(older.length, 'Frühere Nachricht ({n})', 'Frühere Nachrichten ({n})')), older.map((a) => item(a))) : null);
  el.classList.add('card-announce');
  if (fresh.length) el.classList.add('card-attention');
  return {
    el,
    apply() {
      if (!fresh.length) return;
      setNavBadge('nachricht', fresh.length, tn(fresh.length, '{n} neue Nachricht', '{n} neue Nachrichten'));
      whenSeen(el, () => {
        A.writeAnnSeen(pctx.roundId, SEEN_WHO(pctx), newest.createdAt);
        setNavBadge('nachricht', 0);
      });
    },
  };
}

function todoList(todos) {
  const wrap = h('div', { class: 'announce-todos' }, h('h3', null, t('Bei dir noch offen')));
  if (!todos.length) add(wrap, h('p', { class: 'hint' }, t('Bei dir ist gerade nichts offen.')));
  else add(wrap, h('ul', null, todos.map((x) => h('li', null, x))));
  return wrap;
}
