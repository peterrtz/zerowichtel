import { h, toast, errorBox, actionButton } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { saveLink, removeLink, findLink, updateLink } from '../lib/store.js';
import { shareBar } from '../lib/share.js';
import { relative, nowSec, formatDate, euro } from '../lib/dates.js';
import { t } from '../lib/i18n.js';
import { page, card, chip, mount, setTitle, loading, notice, roundHeader, factList, md, printRecovery, qrSvg, codeView, calendarButton, timeline } from './common.js';
import { personDrawSection } from './person-draw.js';
import { schrottCard } from './game.js';
import { countdownCard } from './extras.js';
import { personQuestionsCard, helpButton } from './questions.js';
import { mixtapeCard } from './mixtape.js';
import { personAlbumCard } from './album.js';
import { donationCard } from '../lib/donation.js';
import { forgetAnonQuestions } from '../lib/questions.js';
import { recoveryPng, saveImage } from '../lib/recovery-image.js';

/** „Was jetzt?“ – die nächsten Schritte aus Sicht der Teilnehmenden, rein aus Status und Terminen. */
export function nextSteps({ round, me, confirmed, now = nowSec(), budget, teams = null, myTeam = null, giftDone = false }) {
  const steps = [];
  const open = round.status === 'offen';
  const wichteln = round.mode === 'wichteln';
  if (!confirmed) steps.push(t('Sichere deinen Zugang: persönlichen Link speichern und den Wiederherstellungscode aufheben.'));
  if (open) {
    if (me.rsvp === 'offen') {
      steps.push(now < round.rsvpDeadline
        ? t('Sag zu oder ab – bis {date}.', { date: formatDate(round.rsvpDeadline) })
        : t('Die Antwortfrist ist vorbei. Ohne Zusage bist du nicht dabei – frag notfalls die Organisator:in.'));
    } else if (me.rsvp === 'raus') {
      steps.push(t('Du bist diesmal raus. Es gibt nichts weiter zu tun.'));
    } else if (wichteln && teams) {
      if (!myTeam || !teams.some((x) => x.id === myTeam)) steps.push(t('Wähl unten dein Team – bis zur Auslosung.'));
      steps.push(t('Warte auf die Auslosung. Danach seht ihr hier, welches Team ihr beschenkt, und schreibt gemeinsam euren Team-Wunschzettel.'));
    } else if (wichteln) {
      if (!me.wishCt) steps.push(t('Trag deine Wünsche ein (oder „keine Idee“) – bis {date}.', { date: formatDate(round.wishDeadline) }));
      else if (me.wishFrozenAt) steps.push(t('Deine Wünsche sind festgelegt.'));
      steps.push(t('Warte auf die Ziehung. Danach siehst du hier, wen du beschenkst.'));
    } else {
      steps.push(giftDone
        ? t('Dein Geschenk ist gefunden und verpackt. Komm am {date} zum Spieleabend und bring es mit.', { date: formatDate(round.eventDate) })
        : t('Komm am {date} zum Spieleabend und bring ein eingepacktes Schrottgeschenk mit.', { date: formatDate(round.eventDate) }));
    }
    return steps;
  }
  if (!wichteln) {
    steps.push(now < round.eventDate
      ? (giftDone
        ? t('Dein Geschenk ist gefunden und verpackt. Komm am {date} zum Spieleabend und bring es mit.', { date: formatDate(round.eventDate) })
        : t('Komm am {date} zum Spieleabend und bring ein eingepacktes Schrottgeschenk mit.', { date: formatDate(round.eventDate) }))
      : t('Die Runde ist vorbei. Alle Daten werden spätestens am {date} gelöscht.', { date: formatDate(round.deleteAfter) }));
    return steps;
  }
  if (!me.assignmentCt) {
    steps.push(t('Bei dieser Ziehung bist du nicht dabei.'));
    return steps;
  }
  const after = round.eventDate + 7 * 86400;
  if (now < round.eventDate && giftDone) {
    steps.push(t('Alles erledigt: Geschenk besorgt und verpackt. Jetzt nur noch auf die Bescherung am {date} warten.', { date: formatDate(round.eventDate) }));
    if (now < round.wishDeadline) {
      steps.push(teams
        ? t('Euren Team-Wunschzettel könnt ihr noch bis {date} ergänzen.', { date: formatDate(round.wishDeadline) })
        : me.wishFrozenAt ? t('Deine Wünsche sind festgelegt.') : t('Deine eigenen Wünsche kannst du noch bis {date} ergänzen.', { date: formatDate(round.wishDeadline) }));
    }
  } else if (now < round.eventDate && teams) {
    steps.push(t('Schau unten nach, welches Team ihr beschenkt, und besorgt gemeinsam ein Geschenk bis {date} (Betragslimit: {budget}).', { date: formatDate(round.eventDate), budget: euro(budget) }));
    if (now < round.wishDeadline) steps.push(t('Euren Team-Wunschzettel könnt ihr noch bis {date} ergänzen.', { date: formatDate(round.wishDeadline) }));
    steps.push(t('Unsicher? Fragt das andere Team anonym über die Wichtelpost.'));
  } else if (now < round.eventDate) {
    steps.push(t('Schau unten nach, wen du beschenkst, und besorg ein Geschenk bis {date} (Betragslimit: {budget}).', { date: formatDate(round.eventDate), budget: euro(budget) }));
    if (now < round.wishDeadline) steps.push(me.wishFrozenAt ? t('Deine Wünsche sind festgelegt – dein Wichtel sieht das und kann schon loslegen.') : t('Deine eigenen Wünsche kannst du noch bis {date} ergänzen.', { date: formatDate(round.wishDeadline) }));
    steps.push(t('Unsicher? Frag deine Person anonym über die Wichtelpost.'));
  } else if (now < after) {
    steps.push(t('Rate, wer dein Wichtel war, und sag anonym Danke – bis {date}.', { date: formatDate(after) }));
  } else {
    steps.push(t('Die Runde ist vorbei. Alle Daten werden spätestens am {date} gelöscht.', { date: formatDate(round.deleteAfter) }));
  }
  return steps;
}

export async function renderPerson(root, pctx) {
  setTitle(t('Wichtelrunde'));
  mount(root, loading());
  let data;
  try {
    data = await M.loadMe(pctx);
  } catch (e) {
    if (e.status === 404) {
      removeLink({ kind: 'p', roundId: pctx.roundId, pid: pctx.pid });
      mount(root, page(
        notice(t('Dieser Link ist nicht mehr gültig. Entweder wurde die Runde gelöscht, die Organisator:in hat dich neu eingeladen, oder dein Zugang wurde auf einem anderen Gerät wiederhergestellt.'), 'warn'),
        h('p', null, h('a', { class: 'btn', href: '#wiederherstellen' }, t('Zugang wiederherstellen')), ' ', h('a', { class: 'btn btn-ghost', href: '#' }, t('Startseite'))),
      ));
    } else {
      mount(root, page(errorBox(e), h('p', null, actionButton(t('Erneut versuchen'), () => renderPerson(root, pctx)))));
    }
    return;
  }

  const { round, meta, name, me, counts } = data;
  const key = { kind: 'p', roundId: pctx.roundId, pid: pctx.pid };
  const fragment = M.personFragment(pctx);
  const known = findLink(key);
  saveLink({ ...(known || {}), ...key, fragment, title: meta.title, who: name, eventDate: round.eventDate });
  setTitle(meta.title);
  const reload = () => renderPerson(root, pctx);
  const stored = findLink(key);
  const justClaimed = sessionStorage.getItem('zw.justClaimed') === pctx.pid;
  const justJoined = sessionStorage.getItem('zw.justJoined') === pctx.pid;
  sessionStorage.removeItem('zw.justClaimed');
  sessionStorage.removeItem('zw.justJoined');

  // ---------- Zugang sichern
  const link = M.personLink(pctx);
  const code = stored?.recoveryCode;
  const accessBody = [
    h('p', null, t('Dein persönlicher Link öffnet diese Runde. Schick ihn dir selbst (z. B. Signal-Notizen) oder speichere ihn im Passwortmanager. Er enthält deinen Schlüssel – bitte niemandem weitergeben.')),
    shareBar({ title: t('Mein Wichtel-Link'), text: t('Mein ZeroWichtel-Link für „{title}“ – nicht weitergeben:\n{link}', { title: meta.title, link }), subject: `ZeroWichtel: ${meta.title}` }),
    round.emailEnabled && me.hasEmail
      ? h('p', null, actionButton(t('An meine hinterlegte E-Mail-Adresse schicken'), async () => {
        await M.mailOwnLink(pctx);
        toast(t('Link verschickt.'), 'ok');
      }, { cls: 'btn btn-small' }))
      : null,
    h('h3', null, t('Wiederherstellungscode')),
    code
      ? h('div', { class: 'recovery' },
        h('div', null,
          codeView(code),
          h('p', { class: 'hint' }, t('Falls der Link verloren geht, stellst du damit deinen Zugang wieder her. Ausdrucken oder als Bild speichern – das Bild lässt sich später auf der Startseite unter „Zugang wiederherstellen“ wieder hochladen.')),
          h('p', { class: 'hint' }, t('Achtung: Fotos werden oft automatisch in eine Cloud synchronisiert (iCloud, Google Fotos). Wer Zugriff darauf hat, kann deine Runde öffnen – im Zweifel ausdrucken.')),
          h('div', { class: 'share-bar' },
            h('button', { type: 'button', class: 'btn', on: { click: () => printRecovery({ title: meta.title, name, code, link: M.recoveryLink(code) }) } }, t('Ausdrucken')),
            actionButton(t('Als Bild speichern'), async () => {
              const blob = await recoveryPng({ title: meta.title, name, code, link: M.recoveryLink(code) });
              const r = await saveImage(blob, `zerowichtel-wiederherstellung-${round.id.slice(0, 6)}.png`);
              if (r !== 'aborted') toast(t('Bild erstellt. Bewahre es wie einen Schlüssel auf.'), 'ok');
            }),
            actionButton(t('Neuen Code erzeugen'), async () => {
              if (!confirm(t('Neuen Wiederherstellungscode erzeugen? Der bisherige wird ungültig.'))) return;
              const c = await M.renewRecovery(pctx);
              updateLink(key, { recoveryCode: c });
              toast(t('Neuer Code erzeugt.'), 'ok');
              reload();
            }),
          )),
        qrSvg(M.recoveryLink(code), { size: 132, label: t('QR-Code zur Wiederherstellung') }))
      : h('div', null,
        h('p', null, t('Auf diesem Gerät ist kein Wiederherstellungscode gespeichert.')),
        actionButton(t('Code erzeugen'), async () => {
          const c = await M.renewRecovery(pctx);
          updateLink(key, { recoveryCode: c });
          toast(t('Code erzeugt. Ein evtl. früherer Code ist jetzt ungültig.'), 'ok');
          reload();
        })),
  ];
  const confirmed = stored?.confirmed;
  const accessSection = confirmed
    ? h('details', { class: 'card card-quiet' }, h('summary', null, t('Mein Zugang und Wiederherstellung')), ...accessBody)
    : card(t('Zuerst: Zugang sichern'), ...accessBody,
      h('p', null, h('button', {
        type: 'button',
        class: 'btn btn-ghost btn-small',
        on: { click: () => { updateLink(key, { confirmed: true }); reload(); } },
      }, t('Erledigt, ich habe Link und Code gesichert'))));
  if (!confirmed) accessSection.classList.add('card-attention');

  // ---------- Umfrage
  const canAnswer = round.status === 'offen' && nowSec() < round.rsvpDeadline;
  const rsvpCard = card(t('Bist du dabei?'),
    h('div', { class: 'rsvp' },
      actionButton(t('Ich bin dabei'), async () => { await M.setRsvp(pctx, 'dabei'); toast(t('Schön, dass du dabei bist!'), 'ok'); reload(); },
        { cls: ['btn', 'btn-large', me.rsvp === 'dabei' ? 'btn-primary is-selected' : ''].join(' ') }),
      actionButton(t('Diesmal raus'), async () => { await M.setRsvp(pctx, 'raus'); toast(t('Alles klar – vielleicht beim nächsten Mal.'), 'ok'); reload(); },
        { cls: ['btn', 'btn-large', me.rsvp === 'raus' ? 'btn-primary is-selected' : ''].join(' ') }),
    ),
    h('p', { class: 'hint' },
      me.rsvp === 'offen' ? t('Du hast noch nicht geantwortet.') : me.rsvp === 'dabei' ? t('Deine Antwort: dabei.') : t('Deine Antwort: raus.'),
      ' ',
      canAnswer ? t('Änderbar bis zur Antwortfrist ({rel}).', { rel: relative(round.rsvpDeadline) }) : t('Die Antwortfrist ist abgelaufen.')),
    h('p', { class: 'stats' }, chip(t('{n} von {total} dabei', { n: counts.dabei, total: counts.invited }), 'ok')),
  );
  if (!canAnswer) rsvpCard.querySelectorAll('.rsvp button').forEach((b) => { b.disabled = true; });

  const emailCard = round.emailEnabled && me.hasEmail
    ? (() => {
      const box = h('input', { type: 'checkbox', checked: me.notify });
      box.addEventListener('change', async () => {
        try {
          await M.setNotify(pctx, box.checked);
          toast(box.checked ? t('Erinnerungen eingeschaltet.') : t('Keine E-Mails mehr – außer solchen, die du selbst anforderst.'), 'ok');
        } catch (e) {
          box.checked = !box.checked;
          toast(e.message, 'error');
        }
      });
      return h('details', { class: 'card card-quiet' }, h('summary', null, t('E-Mail')),
        h('div', { class: 'email-box' },
          h('p', { class: 'hint' }, t('Für dich ist eine E-Mail-Adresse hinterlegt. Erinnerungen enthalten nie Namen, Wünsche oder Links.')),
          h('label', { class: 'check' }, box, ' ', t('Erinnerungen per E-Mail erhalten')),
          actionButton(t('Meine Adresse löschen'), async () => {
            if (!confirm(t('E-Mail-Adresse endgültig löschen? Du bekommst dann keine Erinnerungen mehr.'))) return;
            await M.deleteOwnEmail(pctx);
            toast(t('Adresse gelöscht.'), 'ok');
            reload();
          }, { cls: 'btn btn-small btn-ghost btn-danger' })));
    })()
    : null;

  const removeBtn = h('button', {
    type: 'button',
    class: 'btn btn-ghost btn-small',
    on: {
      click: () => {
        if (!confirm(t('Link von diesem Gerät entfernen? Die Teilnahme bleibt bestehen. Zurück kommst du nur mit deinem gesicherten Link oder dem Wiederherstellungscode.'))) return;
        removeLink(key);
        forgetAnonQuestions(round.id);
        location.hash = '';
      },
    },
  }, t('Von diesem Gerät entfernen'));

  const drawPart = await personDrawSection({ pctx, data, reload });
  const steps = nextSteps({ round, me, confirmed, budget: meta.budget, teams: data.teams, myTeam: data.myTeam, giftDone: data.giftDone });
  // Eigener Haken „Geschenk erledigt“: Wichteln nach der Ziehung (wer zugelost ist), Schrottwichteln bei Zusage
  const giftable = nowSec() < round.eventDate && me.rsvp === 'dabei'
    && (round.mode === 'wichteln' ? round.status === 'gezogen' && !!me.assignmentCt : true);
  const giftBox = giftable ? (() => {
    const box = h('input', { type: 'checkbox', checked: data.giftDone });
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        await M.setGiftDone(pctx, box.checked);
        toast(box.checked ? t('Abgehakt. Schön, dass du schon so weit bist!') : t('Haken entfernt.'), 'ok');
        reload();
      } catch (e) {
        box.checked = !box.checked;
        box.disabled = false;
        toast(e.message, 'error');
      }
    });
    return h('label', { class: 'check gift-check' }, box, h('span', null,
      round.mode === 'wichteln' ? t('Mein Geschenk ist besorgt und verpackt') : t('Mein Geschenk ist gefunden und verpackt'),
      h('small', { class: 'hint' }, t('Nur für dich sichtbar – zum Abhaken, wenn alles erledigt ist.'))));
  })() : null;

  mount(root, page(
    roundHeader(round, meta),
    h('p', { class: 'lead' }, t('Hallo {name}!', { name })),
    justClaimed ? notice(t('Einladung angenommen. Sichere jetzt deinen Zugang, dann sag zu oder ab.'), 'ok') : null,
    justJoined ? notice(t('Du bist eingetragen und dabei. Sichere jetzt deinen Zugang.'), 'ok') : null,
    card(t('Was jetzt?'), h('ul', { class: 'next-steps' }, steps.map((s) => h('li', null, s))), giftBox, timeline(round, { ...(giftable || data.giftDone ? { gift: data.giftDone } : {}), wishFrozen: !!me.wishFrozenAt }),
      (round.questions?.mode ?? 0) > 0 ? h('p', { class: 'help-row' }, helpButton()) : null),
    me.rsvp !== 'raus' ? countdownCard(round) : null,
    accessSection,
    round.status === 'offen' ? rsvpCard : null,
    drawPart,
    personQuestionsCard({ pctx, round }),
    personAlbumCard({ pctx, data, name }),
    mixtapeCard({ pctx, data, name, reload }),
    meta.greeting ? card(null, md(meta.greeting)) : null,
    round.mode === 'schrott' && me.rsvp !== 'raus' ? schrottCard({ meta, round, packages: counts.dabei, storageKey: round.id }) : null,
    card(null, factList(round, meta), me.rsvp !== 'raus' ? calendarButton({ round, meta, role: 'person', url: M.jumpLink(pctx.pid) }) : null),
    emailCard,
    donationCard(card, { inRound: true }),
    h('p', { class: 'center' }, removeBtn),
  ));
}
