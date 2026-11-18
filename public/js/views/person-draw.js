// Teilnahme: eigene Wünsche und Steckbrief, Zuordnung, Wünsche des Gegenübers, anonyme Wichtelpost,
// Rätselhinweise, Raten, Auflösen und Dankeschön.

import { h, add, clear, toast, actionButton, field } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { markdownEditor } from '../lib/editor.js';
import { formatDate, formatShort, formatDateTime, nowSec, relative, euro, toDateInput } from '../lib/dates.js';
import { t, tn } from '../lib/i18n.js';
import { card, chip, md, notice } from './common.js';
import { revealBox, ideaDice } from './extras.js';

// ---------- Anzeige einer Wunschliste

function profileView(raw) {
  const profile = M.visibleProfile(raw); // Gesundheitsangaben nur mit gültiger Einwilligung
  const rows = Object.entries(M.PROFILE_FIELDS).filter(([k]) => profile?.[k]).map(([k, [label]]) => [h('dt', null, t(label)), h('dd', null, profile[k])]);
  return rows.length ? h('dl', { class: 'facts profile' }, rows) : null;
}

const FREEZE_GRACE = 86400; // 24 h Korrekturzeit nach dem Festlegen (2.11)

/** Hinweis für den Wichtel: Wünsche festgelegt (endgültig bzw. Korrekturen noch bis …). */
function frozenNote(frozenAt) {
  if (!frozenAt) return null;
  const until = frozenAt + FREEZE_GRACE;
  return h('p', { class: 'wish-frozen' }, chip(t('Festgelegt'), 'ok'), ' ', nowSec() < until
    ? t('Deine Person hat ihre Wünsche festgelegt; kleine Korrekturen sind noch bis {date} möglich.', { date: formatDateTime(until) })
    : t('Deine Person hat ihre Wünsche am {date} festgelegt – sie ändern sich nicht mehr. Du kannst schon loslegen.', { date: formatShort(frozenAt) }));
}

export function wishView(wish, { team = false, frozenAt = null } = {}) {
  if (!wish) {
    return notice(team
      ? t('Das Team hat noch keinen Wunschzettel geschrieben. Fragt ruhig über die Wichtelpost nach.')
      : t('Noch keine Wunschliste freigegeben. Sie erscheint, sobald deine Person ihre Seite nach der Ziehung einmal öffnet. Die Organisator:in sieht, wer noch nicht nachgesehen hat, und kann erinnern.'), 'info');
  }
  const parts = [];
  if (wish.noIdea) {
    parts.push(h('p', { class: 'wish-noidea' }, t('Keine konkreten Wünsche – überrasch mich!')));
  } else if (!wish.items.length) {
    parts.push(h('p', { class: 'muted' }, t('Noch keine Wünsche eingetragen.')));
  } else {
    parts.push(h('ol', { class: 'wishes' }, wish.items.map((it) => {
      let linkEl = null;
      if (it.link) {
        let host = '';
        // Wünsche kommen von einer anderen Person: Link hier erneut prüfen, nicht der Absenderseite vertrauen.
        let safe = false;
        try {
          const u = new URL(it.link);
          safe = u.protocol === 'https:' && !u.username && !u.password;
          host = u.hostname.replace(/^www\./, '');
        } catch { host = ''; }
        if (host && safe) {
          linkEl = h('a', { href: it.link, target: '_blank', rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer', class: 'ext-link' },
            `${host} ↗`);
        }
      }
      return h('li', null, it.text ? md(it.text) : null, linkEl, linkEl ? h('span', { class: 'hint' }, ' ', t('externer Link')) : null);
    })));
  }
  const profile = profileView(wish.profile);
  if (profile) parts.push(h('h4', null, t('Steckbrief')), profile);
  if (wish.noGo) parts.push(h('div', { class: 'nogo' }, h('strong', null, t('Bitte nicht:')), ' ', md(wish.noGo)));
  if (wish.updatedAt > 0) {
    parts.push(h('p', { class: 'hint' }, wish.team && wish.by
      ? t('Stand: {date}, zuletzt geändert von {name}', { date: formatShort(Math.floor(wish.updatedAt / 1000)), name: wish.by })
      : t('Stand: {date}', { date: formatShort(Math.floor(wish.updatedAt / 1000)) })));
  }
  return h('div', { class: 'wish-view' }, frozenNote(frozenAt), parts);
}

// ---------- Editor für die eigene Wunschliste

/**
 * Gesundheitsangaben (Allergien, Unverträglichkeiten): Feld erst nach ausdrücklicher Einwilligung beschreibbar.
 * Häkchen entfernen = Widerruf; war die Angabe schon gespeichert, wird sie sofort gelöscht (onWithdraw).
 */
function healthFields(state, initial, onWithdraw, rerender) {
  const consent = h('input', { type: 'checkbox', checked: M.hasHealthConsent(state.profile), 'aria-describedby': 'health-consent-text' });
  const blocks = M.HEALTH_FIELDS.map((k) => {
    const [label, max] = M.PROFILE_FIELDS[k];
    const input = h('input', { type: 'text', maxlength: max, autocomplete: 'off', disabled: !consent.checked });
    input.value = state.profile[k] ?? '';
    input.addEventListener('input', () => { state.profile[k] = input.value; });
    return field(t(label), input);
  });
  const savedWithConsent = M.hasHealthConsent(initial?.profile) && M.HEALTH_FIELDS.some((k) => initial?.profile?.[k]);
  const legacy = !M.hasHealthConsent(initial?.profile) && M.HEALTH_FIELDS.some((k) => initial?.profile?.[k]);
  consent.addEventListener('change', async () => {
    if (consent.checked) {
      state.profile.consent = { v: M.CONSENT_VERSION, at: Date.now() };
      return rerender();
    }
    if (savedWithConsent) {
      if (!confirm(t('Einwilligung widerrufen? Deine Angabe zu Allergien und Unverträglichkeiten wird sofort gelöscht – auch in der Kopie für deinen Wichtel.'))) {
        consent.checked = true;
        return;
      }
      try {
        await onWithdraw();
        toast(t('Einwilligung widerrufen, Angabe gelöscht.'), 'ok');
      } catch (e) {
        consent.checked = true;
        toast(e.message, 'error');
      }
      return;
    }
    delete state.profile.consent;
    for (const k of M.HEALTH_FIELDS) state.profile[k] = '';
    rerender();
  });
  return h('fieldset', { class: 'health-consent' },
    h('legend', null, t('Allergien und Unverträglichkeiten (besondere Daten)')),
    legacy ? notice(t('Für deine bisherige Angabe fehlt die Einwilligung. Dein Wichtel sieht sie nicht; ohne Häkchen wird sie beim nächsten Speichern gelöscht.'), 'warn') : null,
    h('label', { class: 'check consent-check' }, consent, ' ', h('span', { id: 'health-consent-text' }, t('Ich willige ausdrücklich ein, dass meine Angabe zu Allergien und Unverträglichkeiten – eine Gesundheitsangabe nach Art. 9 DSGVO – verschlüsselt gespeichert und ausschließlich meinem Wichtel angezeigt wird, damit das Geschenk für mich verträglich ist. Sie wird mit der Runde gelöscht, spätestens 14 Tage nach dem Wichteldatum. Ich kann die Einwilligung jederzeit widerrufen, indem ich das Häkchen entferne; die Angabe wird dann sofort gelöscht, auch nach der Wunschfrist.'))),
    h('p', { class: 'hint' }, t('Freiwillig: Ohne Einwilligung bleibt das Feld leer, alles andere funktioniert genauso. Für Kinder unter 16 Jahren entscheidet eine erziehungsberechtigte Person.')),
    blocks);
}

function wishEditor({ initial, deadline, onSave, onWithdraw, team = false, freeze = null }) {
  const state = initial ? structuredClone(initial) : M.emptyWish();
  state.profile ??= {};
  if (!state.items.length) state.items.push({ text: '', link: '' });
  const body = h('div', { class: 'wish-editor' });
  // Festlegen (2.11): freeze = { frozenAt, unlockRequested, onFreeze, onUnlockRequest } – nur Personen-Runden
  const frozenAt = freeze?.frozenAt ?? null;
  const locked = frozenAt !== null && nowSec() >= frozenAt + FREEZE_GRACE;
  const beforeDeadline = nowSec() < deadline;
  const editable = beforeDeadline && !locked;

  const render = () => {
    clear(body);
    if (!editable) {
      add(body, initial ? wishView(initial) : h('p', { class: 'muted' }, t('Du hast keine Wünsche eingetragen – dein Wichtel lässt sich überraschen.')));
      if (!beforeDeadline) {
        add(body, h('p', { class: 'hint' }, t('Die Wunschfrist ist abgelaufen.')));
      } else {
        add(body, notice(t('Du hast deine Wünsche am {date} festgelegt. Ändern geht nur noch, wenn die Organisator:in die Festlegung aufhebt.', { date: formatShort(frozenAt) }), 'info'));
        add(body, freeze.unlockRequested
          ? h('p', { class: 'hint' }, t('Deine Bitte um Freigabe ist bei der Organisator:in angekommen.'))
          : h('p', null, actionButton(t('Organisator:in um Freigabe bitten'), async () => {
            await freeze.onUnlockRequest();
            toast(t('Bitte gesendet. Die Organisator:in sieht sie in der Verwaltung.'), 'ok');
          }, { cls: 'btn btn-small' })));
      }
      // Widerruf bleibt jederzeit möglich (Art. 7 Abs. 3 DSGVO)
      if (M.HEALTH_FIELDS.some((k) => initial?.profile?.[k])) {
        add(body, h('p', null, actionButton(t('Einwilligung widerrufen und Allergie-Angabe löschen'), async () => {
          if (!confirm(t('Einwilligung widerrufen? Deine Angabe zu Allergien und Unverträglichkeiten wird sofort gelöscht – auch in der Kopie für deinen Wichtel.'))) return;
          await onWithdraw();
          toast(t('Einwilligung widerrufen, Angabe gelöscht.'), 'ok');
        }, { cls: 'btn btn-small btn-ghost btn-danger' })));
      }
      return;
    }
    const noIdea = h('input', { type: 'checkbox', checked: state.noIdea });
    noIdea.addEventListener('change', () => { state.noIdea = noIdea.checked; render(); });
    add(body, h('label', { class: 'check' }, noIdea, ' ', t('Keine konkreten Wünsche / keine Idee')));

    if (!state.noIdea) {
      state.items.forEach((it, i) => {
        const ed = markdownEditor({ value: it.text, maxLength: M.WISH_LIMITS.text, rows: 3, label: t('Wunsch {n}', { n: i + 1 }), placeholder: t('z. B. ein gutes Buch über Vögel') });
        ed.textarea.addEventListener('input', () => { it.text = ed.textarea.value; });
        const link = h('input', { type: 'url', inputmode: 'url', maxlength: M.WISH_LIMITS.link, placeholder: t('https://… (optional)') });
        link.value = it.link || '';
        link.addEventListener('input', () => { it.link = link.value; });
        add(body, h('div', { class: 'wish-item' },
          h('div', { class: 'wish-item-head' }, h('strong', null, t('Wunsch {n}', { n: i + 1 })),
            state.items.length > 1
              ? h('button', { type: 'button', class: 'btn btn-small btn-ghost', on: { click: () => { state.items.splice(i, 1); render(); } } }, t('Entfernen'))
              : null),
          ed.el,
          field(t('Link'), link)));
      });
      if (state.items.length < M.WISH_LIMITS.items) {
        add(body, h('button', { type: 'button', class: 'btn btn-small', on: { click: () => { state.items.push({ text: '', link: '' }); render(); } } }, t('+ Weiterer Wunsch')));
      }
    }

    // Steckbrief: hilft auch ohne konkrete Wünsche
    const profileKeys = team ? M.TEAM_PROFILE_FIELDS : Object.keys(M.PROFILE_FIELDS).filter((k) => !M.HEALTH_FIELDS.includes(k));
    const profileInputs = Object.entries(M.PROFILE_FIELDS).filter(([k]) => profileKeys.includes(k)).map(([k, [label, max]]) => {
      const input = h('input', { type: 'text', maxlength: max, autocomplete: 'off' });
      input.value = state.profile[k] ?? '';
      input.addEventListener('input', () => { state.profile[k] = input.value; });
      return field(t(label), input);
    });
    const filled = Object.entries(state.profile).some(([k, v]) => k !== 'consent' && String(v ?? '').trim());
    add(body, team
      ? h('details', { class: 'inline-details profile-edit', open: filled },
        h('summary', null, t('Über euer Team (optional)')),
        h('p', { class: 'hint' }, t('Was ihr mögt, eure Farben. Persönliche Angaben wie Größen oder Allergien gehören nicht in den gemeinsamen Wunschzettel – wer etwas nicht verträgt, schreibt es selbst über die Wichtelpost.')),
        profileInputs)
      : h('details', { class: 'inline-details profile-edit', open: filled },
        h('summary', null, t('Steckbrief (optional)')),
        h('p', { class: 'hint' }, t('Größen, Farben, was du magst – und was du nicht verträgst. Alles freiwillig und genauso verschlüsselt wie deine Wünsche.')),
        profileInputs,
        healthFields(state, initial, onWithdraw, render)));

    const nogo = h('textarea', { rows: 2, maxlength: M.WISH_LIMITS.noGo, placeholder: t('z. B. bitte keine Süßigkeiten, keine Duftkerzen') });
    nogo.value = state.noGo || '';
    nogo.addEventListener('input', () => { state.noGo = nogo.value; });
    add(body,
      field(t('Bitte nicht (optional)'), nogo, team
        ? t('Was ihr auf keinen Fall bekommen möchtet.')
        : t('Was du auf keinen Fall bekommen möchtest. Allergien und Unverträglichkeiten bitte nur im Steckbrief eintragen – dort mit Einwilligung.')),
      frozenAt !== null
        ? notice(t('Festgelegt am {date}. Kleine Korrekturen sind noch bis {until} möglich, danach nicht mehr.', { date: formatShort(frozenAt), until: formatDateTime(frozenAt + FREEZE_GRACE) }), 'ok')
        : null,
      h('div', { class: 'form-actions' },
        actionButton(t('Wünsche speichern'), async () => {
          const stats = {};
          // Ohne Einwilligung keine Gesundheitsangaben (auch nicht aus älteren Versionen)
          if (team || !M.hasHealthConsent(state.profile)) for (const k of M.HEALTH_FIELDS) state.profile[k] = '';
          const saved = await onSave(state, stats);
          initial = saved; // Widerruf bezieht sich ab jetzt auf den gespeicherten Stand
          Object.assign(state, structuredClone(saved));
          state.profile ??= {};
          if (!state.items.length) state.items.push({ text: '', link: '' });
          render();
          toast(stats.removed
            ? tn(stats.removed, 'Wünsche gespeichert. Aus deinen Links wurde {n} Tracking-Angabe entfernt.', 'Wünsche gespeichert. Aus deinen Links wurden {n} Tracking-Angaben entfernt.')
            : t('Wünsche gespeichert.'), 'ok');
        }, { cls: 'btn btn-primary' }),
        freeze && frozenAt === null ? actionButton(t('Speichern & festlegen'), async () => {
          if (!confirm(t('Wünsche festlegen? Danach hast du noch 24 Stunden für kleine Korrekturen, dann sind sie fest – nur die Organisator:in kann das wieder aufheben. Dein Wichtel sieht, dass deine Wünsche feststehen, und kann früher loslegen.'))) return;
          const stats = {};
          if (!M.hasHealthConsent(state.profile)) for (const k of M.HEALTH_FIELDS) state.profile[k] = '';
          await onSave(state, stats, { freeze: true });
          toast(t('Wünsche gespeichert und festgelegt.'), 'ok');
          freeze.onFreeze();
        }, { cls: 'btn' }) : null,
        h('span', { class: 'hint' }, frozenAt === null
          ? t('Änderbar bis {date} ({rel}).', { date: formatDate(deadline), rel: relative(deadline) })
          : t('Korrekturen bis {date}.', { date: formatDateTime(Math.min(frozenAt + FREEZE_GRACE, deadline)) }))),
      freeze && frozenAt === null
        ? h('p', { class: 'hint' }, t('„Festlegen“: Du bist fertig und änderst nichts mehr. Dein Wichtel sieht das und kann schon vor der Wunschfrist ein Geschenk besorgen.'))
        : null,
      h('p', { class: 'hint' }, t('Links werden beim Speichern von Tracking-Angaben befreit (z. B. utm_…, fbclid, Partner-Kennungen). So verrät ein Link nicht, woher du ihn hast.')),
    );
  };
  render();
  return body;
}

function freezeOpts(pctx, me, reload) {
  return {
    frozenAt: me.wishFrozenAt ?? null,
    unlockRequested: !!me.unlockRequested,
    onFreeze: reload,
    onUnlockRequest: async () => { await M.requestWishUnlock(pctx); reload(); },
  };
}

// ---------- Wichtelpost

const KIND_LABEL = { guess: 'Tipp', reveal: 'Auflösung', thanks: 'Dankeschön' };

function messageText(m, team = false) {
  if (m.kind === 'reveal') return team ? t('Wir waren euer Wichtel-Team: {name}', { name: m.text }) : t('Ich war dein Wichtel: {name}', { name: m.text });
  if (m.kind === 'guess') return team ? t('Wir tippen auf: {name}', { name: m.text }) : t('Ich tippe auf: {name}', { name: m.text });
  return m.text;
}

function thread({ box, role, messages, otherLabel, canWrite, onSent, emptyText, team = false }) {
  const list = h('ul', { class: 'thread' }, messages.map((m) => {
    const mine = (role === 'g') === (m.direction === 'frage');
    return h('li', { class: ['msg', mine ? 'msg-mine' : 'msg-other', m.kind !== 'msg' && `msg-${m.kind}`] },
      h('span', { class: 'msg-who' }, mine ? (team ? t('Euer Team') : t('Du')) : otherLabel, m.kind !== 'msg' ? ` · ${t(KIND_LABEL[m.kind])}` : ''),
      h('p', null, messageText(m, team)),
      h('span', { class: 'msg-day' }, formatShort(m.day * 86400 + 43200)));
  }));
  if (!messages.length) add(list, h('li', { class: 'hint' }, emptyText));
  if (!canWrite) return h('div', null, list, h('p', { class: 'hint' }, t('Die Wichtelpost ist geschlossen (eine Woche nach dem Wichteldatum).')));
  const label = team
    ? (role === 'g' ? t('Nachricht an das beschenkte Team') : t('Nachricht an euer Wichtel-Team'))
    : (role === 'g' ? t('Nachricht an deine Person') : t('Nachricht an deinen Wichtel'));
  const ta = h('textarea', { rows: 2, maxlength: M.WISH_LIMITS.message, 'aria-label': label, placeholder: role === 'g' ? (team ? t('z. B. Lieber Tee oder Kaffee?') : t('z. B. Welche Kleidergröße hast du?')) : t('Deine Antwort …') });
  return h('div', null, list,
    h('div', { class: 'msg-compose' }, ta,
      actionButton(role === 'g' ? t('Anonym fragen') : t('Antworten'), async () => {
        await M.sendMessage(box, role, ta.value);
        ta.value = '';
        toast(t('Gesendet.'), 'ok');
        onSent();
      }, { cls: 'btn btn-primary' })));
}

// ---------- Rätselhinweise

const DAY = 86400;

/** Freischaltung am gewählten Tag um 8 Uhr (Ortszeit), frühestens jetzt, spätestens zum Wichteldatum. */
function releaseFromInput(v, eventDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (!m) return null;
  const ts = Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8, 0, 0).getTime() / 1000);
  return Math.min(Math.max(ts, nowSec()), eventDate);
}

function hintsGiver({ box, mailbox, round, reload }) {
  const now = nowSec();
  const list = h('ul', { class: 'hints' }, mailbox.hints.map((x) => h('li', { class: ['hint-item', x.releaseAt <= now && 'hint-live'] },
    h('p', null, x.text),
    h('span', { class: 'hint' }, x.releaseAt <= now
      ? t('sichtbar seit {date}', { date: formatShort(x.releaseAt) })
      : t('erscheint am {date}', { date: formatShort(x.releaseAt) })),
    x.releaseAt > now
      ? actionButton(t('Zurückziehen'), async () => {
        await M.deleteHint(box, x.id);
        toast(t('Hinweis zurückgezogen.'), 'ok');
        reload();
      }, { cls: 'btn btn-small btn-ghost' })
      : null)));
  const canAdd = now < round.eventDate && mailbox.hints.length < M.LIMITS.hints;
  let form = null;
  if (canAdd) {
    const ta = h('textarea', { rows: 2, maxlength: M.LIMITS.hint, placeholder: t('z. B. Ich trinke meinen Kaffee schwarz.') });
    const date = h('input', { type: 'date', min: toDateInput(now), max: toDateInput(round.eventDate) });
    date.value = toDateInput(Math.min(now + 2 * DAY, round.eventDate));
    form = h('div', { class: 'hint-form' },
      field(t('Neuer Hinweis'), ta),
      field(t('Erscheint am'), date, t('Um 8 Uhr morgens, spätestens am Wichteldatum.')),
      actionButton(t('Hinweis planen'), async () => {
        const at = releaseFromInput(date.value, round.eventDate);
        if (!at) throw new Error(t('Bitte ein Datum wählen.'));
        await M.addHint(box, ta.value, at);
        toast(t('Hinweis geplant.'), 'ok');
        reload();
      }, { cls: 'btn' }));
  }
  return h('details', { class: 'inline-details hints-giver', open: mailbox.hints.length > 0 },
    h('summary', null, t('Rätselhinweise (optional)')),
    h('p', { class: 'hint' }, tn(M.LIMITS.hints, 'Mach es spannend: Plane bis zu {n} Hinweis auf dich. Deine Person sieht jeden erst ab dem gewählten Tag – vorher gibt der Server ihn nicht heraus.', 'Mach es spannend: Plane bis zu {n} Hinweise auf dich. Deine Person sieht jeden erst ab dem gewählten Tag – vorher gibt der Server ihn nicht heraus.')),
    mailbox.hints.length ? list : null,
    form);
}

function hintsReceiver(mailbox) {
  if (!mailbox.hints.length && !mailbox.hintsPending) return null;
  return h('div', { class: 'hints-receiver' },
    h('h3', null, t('Rätselhinweise deines Wichtels')),
    mailbox.hints.length
      ? h('ol', { class: 'hints' }, mailbox.hints.map((x) => h('li', { class: 'hint-item hint-live' }, h('p', null, x.text), h('span', { class: 'hint' }, formatShort(x.releaseAt)))))
      : null,
    mailbox.hintsPending
      ? h('p', { class: 'hint' }, tn(mailbox.hintsPending, 'Noch {n} Hinweis kommt – der nächste am {date}.', 'Noch {n} Hinweise kommen – der nächste am {date}.', { date: formatShort(mailbox.nextHintAt) }))
      : null);
}

// ---------- Nach der Bescherung: raten, auflösen, danken

function afterEventReceiver({ box, mailbox, reload, team = false }) {
  const revealed = mailbox.messages.find((m) => m.kind === 'reveal' && m.direction === 'frage');
  const guessed = mailbox.messages.filter((m) => m.kind === 'guess');
  const thanked = mailbox.messages.some((m) => m.kind === 'thanks');
  const guess = h('input', { type: 'text', maxlength: M.LIMITS.name, autocomplete: 'off' });
  const thanks = h('textarea', { rows: 2, maxlength: M.WISH_LIMITS.message, placeholder: t('z. B. Danke, ich habe mich riesig gefreut!') });
  return h('div', { class: 'after-event' },
    h('h3', null, t('Wer war’s?')),
    revealed
      ? notice(team ? t('Euer Wichtel-Team hat sich zu erkennen gegeben: {name}', { name: revealed.text }) : t('Dein Wichtel hat sich zu erkennen gegeben: {name}', { name: revealed.text }), 'ok')
      : h('p', { class: 'hint' }, team
        ? t('Ratet, welches Team euch beschenkt hat. Das Team sieht euren Tipp und kann sich zu erkennen geben – muss aber nicht.')
        : t('Rate, wer dich beschenkt hat. Dein Wichtel sieht deinen Tipp und kann sich zu erkennen geben – muss aber nicht.')),
    revealed ? null : h('div', { class: 'inline-form' },
      field(guessed.length ? t('Noch ein Tipp') : t('Dein Tipp'), guess),
      actionButton(t('Tipp abgeben'), async () => {
        await M.sendMessage(box, 'r', guess.value, 'guess');
        toast(t('Tipp verschickt.'), 'ok');
        reload();
      }, { cls: 'btn' })),
    h('h3', null, t('Anonymes Dankeschön')),
    h('p', { class: 'hint' }, thanked ? t('Du hast dich schon bedankt. Doppelt hält besser.') : team ? t('Sagt eurem Wichtel-Team Danke – ohne zu wissen, wer es ist.') : t('Sag deinem Wichtel Danke – ohne zu wissen, wer es ist.')),
    field(t('Dein Dankeschön'), thanks),
    actionButton(t('Danke senden'), async () => {
      await M.sendMessage(box, 'r', thanks.value, 'thanks');
      toast(t('Dankeschön verschickt.'), 'ok');
      reload();
    }, { cls: 'btn' }));
}

function afterEventGiver({ box, mailbox, name, reload, team = false }) {
  const done = mailbox.messages.some((m) => m.kind === 'reveal');
  const guesses = mailbox.messages.filter((m) => m.kind === 'guess');
  return h('div', { class: 'after-event' },
    h('h3', null, t('Auflösen?')),
    guesses.length
      ? h('p', null, (team ? t('Das beschenkte Team tippt auf: {names}', { names: guesses.map((g) => `„${g.text}“`).join(', ') }) : t('Deine Person tippt auf: {names}', { names: guesses.map((g) => `„${g.text}“`).join(', ') })))
      : null,
    done
      ? h('p', { class: 'hint' }, t('Du hast dich zu erkennen gegeben.'))
      : h('div', null,
        h('p', { class: 'hint' }, team
          ? t('Wenn ihr mögt, verratet ihr dem beschenkten Team jetzt, wer ihr seid. Es sieht dann euren Teamnamen ({name}). Das kann jedes Mitglied für euch tun.', { name })
          : t('Wenn du magst, verrätst du deiner Person jetzt, dass du ihr Wichtel warst. Sie sieht dann deinen Namen ({name}).', { name })),
        actionButton(team ? t('Uns zu erkennen geben') : t('Mich zu erkennen geben'), async () => {
          if (!confirm(team ? t('Dem beschenkten Team euren Teamnamen ({name}) verraten?', { name }) : t('Deiner Person deinen Namen ({name}) verraten?', { name }))) return;
          await M.sendMessage(box, 'g', name, 'reveal');
          toast(t('Aufgelöst.'), 'ok');
          reload();
        }, { cls: 'btn' })));
}

// ---------- Team-Wichteln

/** Vor der Auslosung: eigenes Team wählen oder wechseln. */
function teamChoiceCard({ pctx, data, reload }) {
  const { teams, myTeam, teamCounts, me } = data;
  const name = `team-${pctx.pid}`;
  const list = h('div', { class: 'team-choice', role: 'radiogroup', 'aria-label': t('Dein Team') });
  const choose = async (id) => {
    list.querySelectorAll('input').forEach((x) => { x.disabled = true; });
    try {
      await M.setOwnTeam(pctx, id);
      toast(id ? t('Team gespeichert.') : t('Du bist in keinem Team.'), 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
    reload();
  };
  for (const x of teams) {
    const n = teamCounts[x.id] ?? 0;
    const mine = myTeam === x.id;
    const full = !mine && x.max && n >= x.max;
    const input = h('input', { type: 'radio', name, value: x.id, checked: mine, disabled: full || me.rsvp === 'raus' });
    input.addEventListener('change', () => choose(x.id));
    add(list, h('label', { class: mine ? 'is-selected' : '' }, input, h('span', null, x.name),
      chip(full ? t('voll') : x.max ? t('{n} von {max}', { n, max: x.max }) : tn(n, '{n} dabei', '{n} dabei'), full ? 'warn' : 'muted')));
  }
  return card(t('Dein Team'),
    h('p', null, me.rsvp === 'dabei'
      ? t('Bei dieser Runde beschenken sich Teams. Wähl das Team, mit dem du gemeinsam schenkst – ändern kannst du es bis zur Auslosung.')
      : t('Bei dieser Runde beschenken sich Teams. Sag zuerst zu, dann wähl dein Team.')),
    list,
    myTeam && teams.some((x) => x.id === myTeam)
      ? h('p', null, actionButton(t('Kein Team'), () => choose(null), { cls: 'btn btn-small btn-ghost' }))
      : notice(t('Du hast noch kein Team gewählt.'), 'warn'),
    h('p', { class: 'hint' }, t('Du siehst nur, wie viele in jedem Team sind, nicht wer. Wer mit dir im Team ist, erfährst du nach der Auslosung.')),
    notice(t('Euren gemeinsamen Team-Wunschzettel schreibt ihr nach der Auslosung.'), 'info'));
}

/** Nach der Auslosung: Team beschenkt Team. */
async function teamDrawnView({ round, meta, name, drawn, reload, wrap }) {
  const { giving, receiving, myTeam, receiverTeam } = drawn;
  const [giveBox, recvBox] = await Promise.all([M.loadMailbox(giving, 'g'), M.loadMailbox(receiving, 'r')]);
  const now = nowSec();
  const openUntil = recvBox.openUntil ?? round.eventDate;
  const canWrite = now < openUntil;
  const afterEvent = now >= round.eventDate && canWrite;
  const teamLabel = t('Team {name}', { name: myTeam.name });

  const revealCard = h('section', { class: 'card card-reveal' },
    revealBox(`${receiving.mid}.${round.drawnAt}`, [
      h('p', { class: 'reveal-kicker' }, t('Euer Team beschenkt')),
      h('p', { class: 'reveal-name' }, receiverTeam.name),
    ]),
    h('p', { class: 'team-members' }, t('Mitglieder: {names}', { names: receiverTeam.members.join(', ') })),
    h('p', { class: 'hint' }, t('Ihr seid {team}: {names}. Betragslimit: {budget} · Bescherung: {date}', { team: teamLabel, names: myTeam.members.join(', '), budget: euro(meta.budget), date: formatDate(round.eventDate) })),
    h('h3', null, t('Team-Wunschzettel')),
    wishView(giveBox.wish, { team: true }),
    now < round.eventDate ? h('details', { class: 'inline-details' }, h('summary', null, t('Ideen-Würfel')), ideaDice(meta.budget)) : null,
    now < round.eventDate || giveBox.hints.length ? hintsGiver({ box: giving, mailbox: giveBox, round, reload }) : null,
    afterEvent ? afterEventGiver({ box: giving, mailbox: giveBox, name: teamLabel, reload, team: true }) : null,
    h('h3', null, t('Anonym nachfragen')),
    thread({ box: giving, role: 'g', messages: giveBox.messages, otherLabel: receiverTeam.name, canWrite, onSent: reload, emptyText: t('Noch keine Fragen gestellt.'), team: true }),
    h('p', { class: 'hint' }, t('Das andere Team sieht nur „Euer Wichtel-Team“, nie euren Teamnamen. Alle in eurem Team sehen diese Nachrichten.')),
  );

  let rev = recvBox.wishRev;
  add(wrap,
    revealCard,
    card(t('Euer Team-Wunschzettel'),
      h('p', { class: 'hint' }, t('Gemeinsam für {team}: Jedes Mitglied kann ihn ändern. Das Team, das euch beschenkt, sieht immer den neuesten Stand.', { team: teamLabel })),
      recvBox.wish?.by
        ? h('p', { class: 'hint' }, t('Stand: {date}, zuletzt geändert von {name}', { date: formatShort(Math.floor(recvBox.wish.updatedAt / 1000)), name: recvBox.wish.by }))
        : null,
      wishEditor({
        initial: recvBox.wish, deadline: round.wishDeadline, team: true,
        onSave: async (w, stats) => {
          try {
            const res = await M.saveTeamWish(receiving, w, rev, name, stats);
            rev = res.rev;
            return res.wish;
          } catch (e) {
            if (e.code === 'conflict') setTimeout(reload, 1500);
            throw e;
          }
        },
        onWithdraw: async () => {},
      })),
    card(t('Post an euer Team'),
      hintsReceiver(recvBox),
      afterEvent ? afterEventReceiver({ box: receiving, mailbox: recvBox, reload, team: true }) : null,
      !afterEvent && canWrite ? h('p', { class: 'hint' }, t('Ab der Bescherung könnt ihr raten, welches Team euch beschenkt hat, und euch anonym bedanken.')) : null,
      h('h3', null, t('Nachrichten')),
      thread({ box: receiving, role: 'r', messages: recvBox.messages, otherLabel: t('Euer Wichtel-Team'), canWrite, onSent: reload, emptyText: t('Noch keine Fragen eures Wichtel-Teams.'), team: true })),
  );
  return wrap;
}

// ---------- Abschnitt für die Personenansicht

export async function personDrawSection({ pctx, data, reload }) {
  const { round, meta, me, name } = data;
  if (round.mode !== 'wichteln') return null;
  const wrap = h('div', { class: 'page' });

  if (data.teams) {
    if (round.status === 'offen') {
      if (me.rsvp === 'raus') return null;
      add(wrap, teamChoiceCard({ pctx, data, reload }));
      return wrap;
    }
    const drawnTeam = await M.openDraw(pctx, me);
    if (!drawnTeam) {
      add(wrap, notice(t('Die Ziehung ist erfolgt. Du bist bei dieser Runde nicht dabei.'), 'info'));
      return wrap;
    }
    if (drawnTeam.team) return teamDrawnView({ round, meta, name, drawn: drawnTeam, reload, wrap });
  }

  const own = await M.loadOwnWish(pctx, me);
  if (round.status === 'offen') {
    if (me.rsvp === 'raus') return null;
    add(wrap, card(t('Deine Wünsche'),
      h('p', { class: 'hint' }, t('Dein Wichtel sieht sie erst nach der Ziehung. Betragslimit: {budget}.', { budget: euro(meta.budget) })),
      wishEditor({ initial: own, deadline: round.wishDeadline, onSave: (w, stats, o = {}) => M.saveOwnWish(pctx, w, null, stats, { ...o, frozenAt: me.wishFrozenAt }),
        onWithdraw: async () => { await M.withdrawHealthConsent(pctx, own, null); reload(); },
        freeze: freezeOpts(pctx, me, reload) })));
    return wrap;
  }

  const drawn = await M.openDraw(pctx, me);
  if (!drawn) {
    add(wrap, notice(t('Die Ziehung ist erfolgt. Du bist bei dieser Runde nicht dabei.'), 'info'));
    return wrap;
  }
  const { giving, receiving } = drawn;
  const [giveBox, recvBox] = await Promise.all([M.loadMailbox(giving, 'g'), M.loadMailbox(receiving, 'r')]);
  try {
    await M.syncWishToMailbox(own, receiving, recvBox, me.wishFrozenAt ?? null);
  } catch (e) {
    toast(t('Wunschliste konnte nicht übertragen werden: {msg}', { msg: e.message }), 'error');
  }
  const now = nowSec();
  const openUntil = recvBox.openUntil ?? round.eventDate;
  const canWrite = now < openUntil;
  const afterEvent = now >= round.eventDate && canWrite;
  const otherName = giving.name || t('deine gezogene Person');

  const revealCard = h('section', { class: 'card card-reveal' },
    revealBox(`${pctx.pid}.${round.drawnAt}`, [
      h('p', { class: 'reveal-kicker' }, t('Du beschenkst')),
      h('p', { class: 'reveal-name' }, otherName),
    ]),
    h('p', { class: 'hint' }, t('Betragslimit: {budget} · Bescherung: {date}', { budget: euro(meta.budget), date: formatDate(round.eventDate) })),
    h('h3', null, t('Wünsche')),
    wishView(giveBox.wish, { frozenAt: now < round.wishDeadline ? giveBox.wishFrozenAt : null }),
    now < round.eventDate ? h('details', { class: 'inline-details' }, h('summary', null, t('Ideen-Würfel')), ideaDice(meta.budget)) : null,
    now < round.eventDate || giveBox.hints.length ? hintsGiver({ box: giving, mailbox: giveBox, round, reload }) : null,
    afterEvent ? afterEventGiver({ box: giving, mailbox: giveBox, name, reload }) : null,
    h('h3', null, t('Anonym nachfragen')),
    thread({ box: giving, role: 'g', messages: giveBox.messages, otherLabel: giving.name || t('Antwort'), canWrite, onSent: reload, emptyText: t('Noch keine Fragen gestellt.') }),
    h('p', { class: 'hint' }, t('Deine Person sieht nur „Dein Wichtel“, nie deinen Namen.')),
  );

  add(wrap,
    revealCard,
    card(t('Deine Wünsche'),
      wishEditor({ initial: own, deadline: round.wishDeadline, onSave: (w, stats, o = {}) => M.saveOwnWish(pctx, w, receiving, stats, { ...o, frozenAt: me.wishFrozenAt }),
        onWithdraw: async () => { await M.withdrawHealthConsent(pctx, own, receiving); reload(); },
        freeze: freezeOpts(pctx, me, reload) })),
    card(t('Post von deinem Wichtel'),
      hintsReceiver(recvBox),
      afterEvent ? afterEventReceiver({ box: receiving, mailbox: recvBox, reload }) : null,
      !afterEvent && canWrite ? h('p', { class: 'hint' }, t('Ab der Bescherung kannst du raten, wer dein Wichtel war, und dich anonym bedanken.')) : null,
      h('h3', null, t('Nachrichten')),
      thread({ box: receiving, role: 'r', messages: recvBox.messages, otherLabel: t('Dein Wichtel'), canWrite, onSent: reload, emptyText: t('Noch keine Fragen deines Wichtels.') })),
  );
  return wrap;
}
