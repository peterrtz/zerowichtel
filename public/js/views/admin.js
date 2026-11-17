import { h, add, field, toast, errorBox, actionButton } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { saveLink, removeLink, findLink, updateLink, listLinks } from '../lib/store.js';
import { shareBar, shareText, copyText } from '../lib/share.js';
import { toDateInput, deadlineFromInput, eventFromInput, formatDate, nowSec } from '../lib/dates.js';
import { markdownEditor } from '../lib/editor.js';
import { t, tn } from '../lib/i18n.js';
import { page, card, chip, mount, setTitle, loading, notice, roundHeader, factList, md, calendarButton, qrSvg, printInviteCards, timeline } from './common.js';
import { linkBase } from '../lib/api.js';
import { adminDrawSection, helperInviteText, helperNameOf } from './admin-draw.js';
import { schrottCard } from './game.js';
import { rulesEditor } from './rules-editor.js';

const RSVP_CHIP = { dabei: ['dabei', 'ok'], raus: ['raus', 'muted'], offen: ['keine Antwort', ''] };

function inviteText(meta, name, link) {
  return t('Hallo {name}! Du bist zur Wichtelrunde „{title}“ eingeladen.\n\nDein persönlicher Link – bitte nicht weiterleiten:\n{link}', { name, title: meta.title, link });
}

function groupText(meta, link) {
  return t('Wichteln mit ZeroWichtel: „{title}“. Trag dich über diesen Link selbst ein – jede:r nur einmal, bitte nur in dieser Gruppe teilen:\n{link}', { title: meta.title, link });
}

/** Checkliste für die Organisator:in: was erledigt ist und was als Nächstes kommt. */
export function organizerChecklist({ round, participants, confirmed, selfDone, now = nowSec() }) {
  const open = round.status === 'offen';
  const wichteln = round.mode === 'wichteln';
  const total = participants.length;
  const claimed = participants.filter((p) => p.claimed).length;
  const unanswered = participants.filter((p) => p.rsvp === 'offen').length;
  const min = wichteln ? 3 : 2;
  const items = [
    [t('Admin-Link sichern'), confirmed],
    [t('Dich selbst eintragen, falls du mitwichtelst'), selfDone || !open],
    [tn(min, 'Mindestens {n} Person eintragen', 'Mindestens {n} Personen eintragen'), total >= min || !open],
    [t('Alle einladen: Link teilen, Karte drucken oder Gruppenlink'), (total > 0 && claimed === total) || !open],
    [t('Zusagen abwarten (Antwortfrist {date})', { date: formatDate(round.rsvpDeadline) }), (total > 0 && unanswered === 0) || now >= round.rsvpDeadline || !open],
  ];
  if (wichteln) {
    const drawn = participants.filter((p) => p.inDraw);
    items.push([t('Auslosen'), !open]);
    items.push([t('Alle haben nachgesehen, wen sie beschenken'), !open && drawn.length > 0 && drawn.every((p) => p.drawSeen)]);
    items.push([t('Bescherung am {date}', { date: formatDate(round.eventDate) }), now >= round.eventDate]);
  } else {
    items.push([t('Spieleabend am {date}', { date: formatDate(round.eventDate) }), now >= round.eventDate]);
  }
  return items.map(([text, done]) => ({ text, done: !!done }));
}

function checklistCard(items, round) {
  const next = items.findIndex((i) => !i.done);
  const list = h('ol', { class: 'checklist' }, items.map((it, i) => h('li', { class: [it.done && 'check-done', i === next && 'check-next'] },
    h('span', { class: 'check-mark', 'aria-hidden': 'true' }, it.done ? '✓' : String(i + 1)),
    h('span', null, it.text),
    it.done ? h('span', { class: 'visually-hidden' }, ` – ${t('erledigt')}`) : null,
    i === next ? h('span', { class: 'check-next-label' }, t('Als Nächstes')) : null)));
  const allDone = next === -1;
  return h('details', { class: ['card', 'checklist-card', allDone && 'card-quiet'], open: !allDone },
    h('summary', null, allDone ? t('Checkliste: alles erledigt') : t('Checkliste: {done} von {total} erledigt', { done: items.filter((i) => i.done).length, total: items.length })),
    timeline(round),
    list);
}

function groupLinkCard({ ctx, data, meta, reload }) {
  const { round, join, participants, maxParticipants } = data;
  const now = nowSec();
  if (!join) {
    const until = h('input', { type: 'date', min: toDateInput(now), max: toDateInput(round.eventDate) });
    until.value = toDateInput(Math.max(round.rsvpDeadline, now + 86400));
    const max = h('input', { type: 'number', min: 1, max: maxParticipants, step: 1, inputmode: 'numeric' });
    max.value = String(Math.max(1, maxParticipants - participants.length));
    return h('details', { class: 'card card-quiet group-link' },
      h('summary', null, t('Gruppenlink (optional)')),
      h('p', null, t('Statt alle einzeln einzuladen, kannst du einen Link für alle teilen – z. B. in der Familien- oder Teamgruppe. Wer ihn öffnet, trägt sich selbst mit Namen ein und ist gleich dabei.')),
      h('p', { class: 'hint' }, t('Bedenke: Wer den Link hat, kann sich eintragen. Teile ihn nur in einer geschlossenen Gruppe, begrenze die Zahl und lass ihn rechtzeitig ablaufen. Einzelne Einladungen bleiben weiterhin möglich.')),
      field(t('Gültig bis'), until, t('Spätestens bis zum Wichteldatum.')),
      field(t('Höchstens so viele Personen'), max),
      actionButton(t('Gruppenlink erstellen'), async () => {
        let u = deadlineFromInput(until.value);
        if (!u) throw new Error(t('Bitte ein Datum wählen.'));
        u = Math.min(u, round.eventDate);
        await M.setJoinLink(ctx, { until: u, max: Number(max.value) });
        toast(t('Gruppenlink erstellt.'), 'ok');
        reload();
      }, { cls: 'btn btn-primary' }));
  }
  const link = M.joinLink(ctx, join.token);
  const expired = now >= join.until;
  const full = join.used >= join.max;
  return card(t('Gruppenlink'),
    h('p', { class: 'stats' },
      chip(t('{used} von {max} eingetragen', { used: join.used, max: join.max }), full ? 'warn' : 'ok'), ' ',
      expired ? chip(t('abgelaufen'), 'warn') : chip(t('gültig bis {date}', { date: formatDate(join.until) }), 'muted')),
    expired || full
      ? notice(expired ? t('Der Gruppenlink ist abgelaufen. Erzeuge bei Bedarf einen neuen.') : t('Die Höchstzahl ist erreicht. Erzeuge bei Bedarf einen neuen Link.'), 'warn')
      : h('div', { class: 'group-share' },
        h('div', null,
          shareBar({ title: t('Gruppenlink'), text: groupText(meta, link), subject: `ZeroWichtel: ${meta.title}` }),
          h('p', { class: 'hint' }, t('Der Link enthält den Schlüssel der Runde (Titel, Begrüßung und Namen), aber keinen Zugang zur Verwaltung.'))),
        qrSvg(link, { size: 132, label: t('QR-Code zum Gruppenlink') })),
    h('div', { class: 'form-actions' },
      actionButton(t('Neuen Link erzeugen'), async () => {
        if (!confirm(t('Neuen Gruppenlink erzeugen? Der bisherige funktioniert dann nicht mehr; wer sich schon eingetragen hat, bleibt dabei.'))) return;
        await M.setJoinLink(ctx, { until: expired ? Math.min(Math.max(round.rsvpDeadline, now + 86400), round.eventDate) : join.until, max: join.max });
        toast(t('Neuer Gruppenlink erzeugt.'), 'ok');
        reload();
      }, { cls: 'btn btn-small' }),
      actionButton(t('Gruppenlink widerrufen'), async () => {
        if (!confirm(t('Gruppenlink widerrufen? Wer sich schon eingetragen hat, bleibt dabei.'))) return;
        await M.deleteJoinLink(ctx);
        toast(t('Gruppenlink widerrufen.'), 'ok');
        reload();
      }, { cls: 'btn btn-small btn-ghost btn-danger' })));
}

export async function renderAdmin(root, ctx) {
  setTitle(t('Verwaltung'));
  mount(root, loading());
  let data;
  try {
    data = await M.loadAdmin(ctx);
  } catch (e) {
    if (e.status === 404) {
      removeLink({ kind: 'a', roundId: ctx.roundId });
      mount(root, page(notice(t('Diese Runde gibt es nicht (mehr). Sie wurde gelöscht oder der Admin-Link ist ungültig.'), 'warn'),
        h('p', null, h('a', { href: '#', class: 'btn' }, t('Zur Startseite')))));
    } else {
      mount(root, page(errorBox(e), h('p', null, actionButton(t('Erneut versuchen'), () => renderAdmin(root, ctx)))));
    }
    return;
  }

  const { round, meta, participants } = data;
  const fragment = M.adminFragment(ctx);
  const known = findLink({ kind: 'a', roundId: ctx.roundId });
  // Kennt dieses Gerät die Runde noch nicht, wurde der Admin-Link von außen geöffnet (Passwortmanager, Notizen,
  // anderes Gerät) – er ist also gesichert. Nachgefragt wird nur auf dem Gerät, auf dem die Runde angelegt wurde,
  // bis dort „gesichert“ bestätigt ist.
  const confirmed = known ? (known.confirmed ?? false) : true;
  saveLink({ ...(known || {}), kind: 'a', roundId: ctx.roundId, fragment, title: meta.title, eventDate: round.eventDate, confirmed });
  setTitle(meta.title);
  const reload = () => renderAdmin(root, ctx);
  const justCreated = sessionStorage.getItem('zw.justCreated') === ctx.roundId;
  if (justCreated) sessionStorage.removeItem('zw.justCreated');

  // ---------- Admin-Link sichern
  const adminLink = M.adminLink(ctx);
  const saveBox = card(confirmed ? null : t('Zuerst: Admin-Link sichern'),
    h('p', null, t('Dieser Link ist der einzige Schlüssel zur Verwaltung. Es gibt kein Passwort und keine Wiederherstellung über den Server. Schick ihn dir selbst, z. B. in deinen Signal-Notizen-Chat, oder speichere ihn im Passwortmanager.')),
    shareBar({ title: t('Admin-Link'), text: t('Admin-Link für „{title}“ (ZeroWichtel) – nicht weitergeben:\n{link}', { title: meta.title, link: adminLink }), subject: `ZeroWichtel: ${meta.title}` }),
    data.emailAvailable ? adminMailForm(ctx) : null,
    confirmed ? null : h('p', null, h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-small',
      on: { click: () => { updateLink({ kind: 'a', roundId: ctx.roundId }, { confirmed: true }); reload(); } },
    }, t('Erledigt, ich habe den Link gesichert'))),
  );
  saveBox.classList.add(confirmed ? 'card-quiet' : 'card-attention');
  const saveSection = confirmed
    ? h('details', { class: 'card card-quiet' }, h('summary', null, t('Admin-Link')), ...[...saveBox.childNodes])
    : saveBox;

  // ---------- Teilnehmende
  const counts = {
    total: participants.length,
    claimed: participants.filter((p) => p.claimed).length,
    dabei: participants.filter((p) => p.rsvp === 'dabei').length,
    raus: participants.filter((p) => p.rsvp === 'raus').length,
  };
  const open = round.status === 'offen';
  const drawn = round.status === 'gezogen';
  const canReinvite = open || (drawn && round.wishDeadline && nowSec() < round.wishDeadline);
  const list = h('ul', { class: 'people' });
  const analog = data.admin.analog || [];
  const nameOf = Object.fromEntries(participants.map((x) => [x.id, x.name]));
  for (const p of participants) {
    const [rsvpLabel, rsvpKind] = RSVP_CHIP[p.rsvp];
    const link = p.inviteToken ? M.inviteLink(ctx, p.id, p.inviteToken) : null;
    // Ohne Smartphone: Die Einladung geht an die Helfer:in (nur hier sichtbar, sonst für niemanden)
    const analogEntry = analog.find((e) => e.pid === p.id);
    const helping = analog.find((e) => e.helper === p.id);
    const invite = analogEntry
      ? helperInviteText(meta, p.name, helperNameOf(analogEntry, nameOf), link)
      : inviteText(meta, p.name, link);
    const actions = h('div', { class: 'person-actions' });
    if (link && open) {
      add(actions,
        h('button', { type: 'button', class: 'btn btn-small btn-primary', on: { click: () => shareText(t('Einladung'), invite) } }, analogEntry ? t('Link an Helfer:in') : t('Einladen')),
        h('button', { type: 'button', class: 'btn btn-small', on: { click: () => copyText(invite) } }, t('Kopieren')),
        round.emailEnabled && p.hasEmail && !analogEntry
          ? actionButton(t('Per E-Mail'), async () => {
            await M.mailInvite(ctx, p.id, p.inviteToken);
            toast(t('Einladung an {to} verschickt.', { to: p.email ?? t('die hinterlegte Adresse') }), 'ok');
          }, { cls: 'btn btn-small' })
          : null,
      );
    }
    const more = h('details', { class: 'menu' }, h('summary', { class: 'btn btn-small btn-ghost', 'aria-label': t('Weitere Aktionen für {name}', { name: p.name }) }, '⋯'));
    const menu = h('div', { class: 'menu-body' });
    add(menu,
      actionButton(t('Umbenennen'), async () => {
        const n = prompt(t('Neuer Name:'), p.name);
        if (n === null) return;
        await M.renamePerson(ctx, p.id, n);
        toast(t('Name geändert.'), 'ok');
        reload();
      }, { cls: 'btn btn-small btn-ghost' }),
    );
    if (round.emailEnabled && (open || drawn)) {
      add(menu, actionButton(p.hasEmail ? t('E-Mail ändern') : t('E-Mail hinterlegen'), async () => {
        const v = prompt(p.hasEmail ? t('E-Mail-Adresse (leer lassen zum Entfernen):') : t('E-Mail-Adresse:'), p.email ?? '');
        if (v === null) return;
        await M.setPersonEmail(ctx, p.id, v);
        toast(v.trim() ? t('Adresse gespeichert.') : t('Adresse entfernt.'), 'ok');
        reload();
      }, { cls: 'btn btn-small btn-ghost' }));
    }
    if (link && open) {
      add(menu, h('a', { class: 'btn btn-small btn-ghost', href: '#' + link.split('#')[1], title: t('Wenn du selbst mitwichtelst: deine Einladung hier öffnen') }, t('Selbst hier öffnen')));
    }
    if (canReinvite) {
      add(menu,
        actionButton(t('Neu einladen'), async () => {
          const warn = drawn
            ? t('Neue Einladung für {name}? Der bisherige Link wird ungültig, und die Ziehung wird zurückgesetzt – danach musst du neu auslosen. Alle bekommen dann eine neue Person.', { name: p.name })
            : p.claimed
              ? t('{name} hat die Einladung schon angenommen. Neu einladen macht den bisherigen persönlichen Link und den Wiederherstellungscode ungültig und setzt die Antwort zurück. Fortfahren?', { name: p.name })
              : t('Neuen Einladungslink erzeugen? Der bisherige wird ungültig.');
          if (!confirm(warn)) return;
          await M.reinvitePerson(ctx, p.id);
          toast(drawn ? t('Neue Einladung erstellt. Ziehung zurückgesetzt – bitte neu auslosen, sobald die Person angenommen hat.') : t('Neue Einladung erstellt.'), 'ok');
          reload();
        }, { cls: 'btn btn-small btn-ghost' }),
      );
    }
    if (open) {
      add(menu,
        actionButton(t('Entfernen'), async () => {
          if (!confirm(t('{name} aus der Runde entfernen?', { name: p.name }))) return;
          await M.removePerson(ctx, p.id);
          toast(t('Entfernt.'), 'ok');
          reload();
        }, { cls: 'btn btn-small btn-ghost btn-danger' }),
      );
    }
    add(more, menu);
    add(actions, more);
    add(list, h('li', { class: 'person' },
      h('div', { class: 'person-main' },
        h('span', { class: 'person-name' }, p.name),
        h('span', { class: 'person-chips' },
          p.viaGroup ? chip(t('per Gruppenlink'), 'muted') : p.claimed ? chip(t('angenommen'), 'ok') : chip(t('Einladung offen'), 'warn'),
          p.hasEmail ? chip(p.notify ? t('✉ E-Mail') : t('✉ ohne Erinnerungen'), 'muted') : null,
          analogEntry ? chip(t('ohne Smartphone · hilft: {helper}', { helper: helperNameOf(analogEntry, nameOf) }), 'muted') : null,
          helping ? chip(t('hilft {name}', { name: nameOf[helping.pid] ?? '?' }), 'muted') : null,
          chip(t(rsvpLabel), rsvpKind)),
      ),
      actions,
    ));
  }
  if (!participants.length) add(list, h('li', { class: 'empty' }, t('Noch niemand eingeladen. Trag als Erstes dich selbst ein, wenn du mitwichtelst.')));

  const nameInput = h('input', { type: 'text', maxlength: M.LIMITS.name, placeholder: t('Name oder Spitzname'), autocomplete: 'off', 'aria-label': t('Name') });
  const emailInput = round.emailEnabled
    ? h('input', { type: 'email', maxlength: 254, placeholder: t('E-Mail (optional)'), autocomplete: 'off', inputmode: 'email', 'aria-label': t('E-Mail (optional)') })
    : null;
  const addForm = h('form', { class: ['add-person', emailInput && 'add-person-email'] },
    nameInput,
    emailInput,
    h('button', { type: 'submit', class: 'btn btn-primary' }, t('Hinzufügen')),
  );
  addForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = addForm.querySelector('button');
    btn.disabled = true;
    try {
      await M.addPerson(ctx, nameInput.value, emailInput?.value ?? null);
      toast(t('Hinzugefügt – jetzt einladen.'), 'ok');
      reload();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  });

  // Organisator:in wichtelt mit? Der Admin-Link macht niemanden zur Teilnehmer:in. Der Hinweis verschwindet,
  // sobald auf diesem Gerät eine eigene Teilnahme an der Runde gespeichert ist oder „wichtle nicht mit“ gewählt wurde.
  const selfJoined = listLinks().some((e) => e.kind === 'p' && e.roundId === ctx.roundId);
  const selfHint = open && !selfJoined && !known?.notPlaying
    ? h('div', { class: 'notice notice-warn self-hint' },
      h('p', null, h('strong', null, t('Wichtelst du selbst mit?')), ' ',
        t('Dann trag dich hier wie alle anderen als Person ein und nimm deine Einladung über „Selbst hier öffnen“ an.'), ' ',
        t('Der Admin-Link allein macht dich nicht zur Teilnehmer:in – ohne eigene Einladung wirst du nicht mit ausgelost.')),
      h('p', null, h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-small',
        on: { click: () => { updateLink({ kind: 'a', roundId: ctx.roundId }, { notPlaying: true }); reload(); } },
      }, t('Ich wichtle nicht selbst mit'))))
    : null;

  // Einladungskarten: offene Einladungen und ggf. der Gruppenlink, je mit QR-Code
  const printable = open ? participants.filter((p) => p.inviteToken && !p.claimed) : [];
  const joinActive = open && data.join && nowSec() < data.join.until && data.join.used < data.join.max;
  const printBtn = printable.length || joinActive
    ? h('button', {
      type: 'button',
      class: 'btn btn-small',
      on: {
        click: () => {
          if (!confirm(t('Einladungskarten drucken? Jede Karte enthält einen persönlichen Link – wer sie findet, kann die Einladung annehmen. Karten nur persönlich übergeben.'))) return;
          printInviteCards({
            round, meta,
            cards: [
              ...printable.map((p) => ({ name: p.name, link: M.inviteLink(ctx, p.id, p.inviteToken) })),
              ...(joinActive ? [{ name: null, link: M.joinLink(ctx, data.join.token) }] : []),
            ],
          });
        },
      },
    }, t('Einladungskarten drucken'))
    : null;

  const peopleCard = card(t('Teilnehmende ({n}/{max})', { n: counts.total, max: data.maxParticipants }),
    selfHint,
    h('p', { class: 'stats' },
      chip(t('{n} angenommen', { n: counts.claimed })), ' ', chip(t('{n} dabei', { n: counts.dabei }), 'ok'), ' ', chip(t('{n} raus', { n: counts.raus }), 'muted')),
    list,
    open && counts.total < data.maxParticipants ? addForm : null,
    printBtn ? h('p', { class: 'print-row' }, printBtn, ' ', h('span', { class: 'hint' }, t('Vier Karten pro Seite, mit QR-Code – schön zum Verschenken oder Aufhängen.'))) : null,
    open ? h('p', { class: 'hint' }, t('Namen sehen alle Eingeladenen. Pseudonyme sind ausdrücklich erlaubt. Jede Einladung gilt für genau eine Person und wird beim ersten Öffnen eingelöst.')) : null,
  );

  // ---------- Bearbeiten
  const editCard = editSection(ctx, round, meta, reload, data.emailAvailable);

  // ---------- Löschen
  const confirmInput = h('input', { type: 'text', placeholder: meta.title, autocomplete: 'off' });
  const delBtn = actionButton(t('Runde beenden und endgültig löschen'), async () => {
    if (confirmInput.value.trim() !== meta.title.trim()) {
      throw new Error(t('Bitte zur Bestätigung den Titel exakt eintippen.'));
    }
    await M.deleteRound(ctx);
    removeLink({ kind: 'a', roundId: ctx.roundId });
    toast(t('Runde gelöscht. Alle Daten sind entfernt.'), 'ok');
    location.hash = '';
  }, { cls: 'btn btn-danger' });
  const dangerCard = h('details', { class: 'card card-danger' },
    h('summary', null, t('Runde beenden und löschen')),
    h('p', null, t('Löscht sofort und unwiderruflich alle Daten dieser Runde: Namen, Antworten, Wünsche, Zuordnungen, Nachrichten. Alle Links werden ungültig.')),
    field(t('Zur Bestätigung den Titel eintippen'), confirmInput),
    delBtn,
  );

  const checklist = organizerChecklist({ round, participants, confirmed, selfDone: selfJoined || !!known?.notPlaying });

  mount(root, page(
    roundHeader(round, meta, chip(t('Verwaltung'), 'admin')),
    justCreated ? notice(t('Die Runde ist angelegt. Sichere jetzt den Admin-Link. Danach trag dich selbst ein, falls du mitwichtelst, und lade die Teilnehmenden ein.'), 'ok') : null,
    saveSection,
    checklistCard(checklist, round),
    meta.greeting ? card(null, md(meta.greeting)) : null,
    card(null, factList(round, meta), calendarButton({ round, meta, role: 'admin', url: `${linkBase()}/` })),
    round.mode === 'schrott' ? schrottCard({ meta, round, packages: counts.dabei, storageKey: round.id }) : null,
    peopleCard,
    open ? groupLinkCard({ ctx, data, meta, reload }) : null,
    await adminDrawSection({ ctx, data, reload }),
    editCard,
    dangerCard,
  ));
}

function adminMailForm(ctx) {
  const input = h('input', { type: 'email', maxlength: 254, placeholder: t('deine@adresse.de'), autocomplete: 'email', inputmode: 'email', 'aria-label': t('Deine E-Mail-Adresse') });
  return h('div', { class: 'admin-mail' },
    h('div', { class: 'inline-form' }, input,
      actionButton(t('An mich mailen'), async () => {
        await M.mailAdminLink(ctx, input.value);
        input.value = '';
        toast(t('Admin-Link verschickt.'), 'ok');
      }, { cls: 'btn' })),
    h('p', { class: 'hint' }, t('Die Adresse wird nur für diesen einen Versand verwendet und nicht gespeichert.')));
}

function editSection(ctx, round, meta, reload, emailAvailable = false) {
  const open = round.status === 'offen';
  const title = h('input', { type: 'text', maxlength: M.LIMITS.title });
  title.value = meta.title;
  const budget = h('input', { type: 'number', min: 0, max: M.LIMITS.budgetMax, step: 1 });
  budget.value = meta.budget ?? '';
  const greeting = markdownEditor({ value: meta.greeting, maxLength: M.LIMITS.greeting, label: t('Begrüßung') });
  const rsvp = h('input', { type: 'date', disabled: !open });
  const wish = h('input', { type: 'date', disabled: !open });
  const event = h('input', { type: 'date', disabled: !open });
  rsvp.value = toDateInput(round.rsvpDeadline);
  wish.value = toDateInput(round.wishDeadline);
  event.value = toDateInput(round.eventDate);
  const rules = round.mode === 'schrott' ? rulesEditor(meta.rules) : null;
  const emailOn = h('input', { type: 'checkbox', checked: round.emailEnabled });
  const mailTitle = h('input', { type: 'text', maxlength: 80, placeholder: t('leer = kein Titel in Mails') });
  mailTitle.value = round.mailTitle ?? '';
  const mailLang = h('select', null,
    h('option', { value: 'de', selected: round.lang !== 'en' }, 'Deutsch'),
    h('option', { value: 'en', selected: round.lang === 'en' }, 'English'));

  const save = actionButton(t('Änderungen speichern'), async () => {
    const changes = { meta: { ...meta, title: title.value, greeting: greeting.textarea.value, budget: budget.value === '' ? null : budget.value } };
    if (rules) changes.meta.rules = rules.get();
    if (emailAvailable) {
      if (round.emailEnabled && !emailOn.checked && !confirm(t('E-Mail-Modus ausschalten? Alle hinterlegten Adressen dieser Runde werden sofort gelöscht.'))) return;
      if (emailOn.checked !== round.emailEnabled) changes.emailEnabled = emailOn.checked;
      if (emailOn.checked && (mailTitle.value.trim() || null) !== (round.mailTitle ?? null)) changes.mailTitle = mailTitle.value;
      if (mailLang.value !== (round.lang ?? 'de')) changes.lang = mailLang.value;
    }
    if (open) {
      const r = deadlineFromInput(rsvp.value);
      const e = eventFromInput(event.value);
      const w = round.mode === 'wichteln' ? deadlineFromInput(wish.value) : null;
      if (r !== round.rsvpDeadline) changes.rsvpDeadline = r;
      if (e !== round.eventDate) changes.eventDate = e;
      if (round.mode === 'wichteln' && w !== round.wishDeadline) changes.wishDeadline = w;
      if (changes.rsvpDeadline !== undefined && changes.rsvpDeadline <= nowSec()) {
        throw new Error(t('Die Antwortfrist muss in der Zukunft liegen.'));
      }
    }
    await M.updateRound(ctx, changes);
    toast(t('Gespeichert.'), 'ok');
    reload();
  }, { cls: 'btn btn-primary' });

  return h('details', { class: 'card' },
    h('summary', null, t('Runde bearbeiten')),
    field(t('Titel'), title),
    h('div', { class: 'field' }, h('label', null, t('Begrüßung und Beschreibung')), greeting.el),
    field(t('Betragslimit in €'), budget, t('Leer = kein Limit.')),
    field(t('Antwortfrist'), rsvp),
    round.mode === 'wichteln' ? field(t('Wunschfrist'), wish) : null,
    field(t('Wichteldatum'), event, t('Löschung erfolgt 14 Tage danach (derzeit {date}).', { date: formatDate(round.deleteAfter) })),
    open ? null : h('p', { class: 'hint' }, t('Nach der Ziehung lassen sich die Termine nicht mehr ändern.')),
    rules ? h('div', { class: 'field' }, h('label', null, t('Spielregeln')), rules.el) : null,
    emailAvailable
      ? h('div', { class: 'field' },
        h('label', { class: 'check' }, emailOn, ' ', t('Einladungen und Erinnerungen auch per E-Mail')),
        field(t('Titel in E-Mail-Betreffzeilen'), mailTitle, t('Optional. Der Server kann ihn lesen. Ausschalten löscht alle Adressen der Runde.')),
        field(t('Sprache der E-Mails'), mailLang, t('Automatische Mails gehen in dieser Sprache an alle in der Runde.')))
      : null,
    save,
  );
}
