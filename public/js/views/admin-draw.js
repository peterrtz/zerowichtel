// Verwaltung: Untergruppen, Ausschlüsse und Ziehung (nur Modus Wichteln).

import { h, add, clear, toast, actionButton } from '../lib/dom.js';
import { shareText } from '../lib/share.js';
import { linkBase } from '../lib/api.js';
import * as M from '../lib/model.js';
import { precheck, teamPrecheck } from '../lib/draw.js';
import { formatDate, nowSec } from '../lib/dates.js';
import { card, chip, notice } from './common.js';
import { t, tn } from '../lib/i18n.js';

const newGroupId = () => Math.random().toString(36).slice(2, 10);

/** Wer hat seine Seite seit der Ziehung geöffnet? Nur ja/nein – verrät keine Zuordnung. */
function seenSection({ ctx, data, reload }) {
  const { round, meta, participants } = data;
  const drawn = participants.filter((p) => p.inDraw);
  const pending = drawn.filter((p) => !p.drawSeen);
  const title = meta.title;
  const team = data.teams !== null;
  const personText = (p) => team
    ? t('Hallo {name}! Bei „{title}“ wurde ausgelost. Öffne bitte deine ZeroWichtel-Seite: Dort siehst du, welches Team ihr beschenkt, und schreibt euren Team-Wunschzettel.\n\n{link}', { name: p.name, title, link: M.jumpLink(p.id) })
    : t('Hallo {name}! Bei „{title}“ wurde ausgelost. Öffne bitte einmal deine ZeroWichtel-Seite – erst dann bekommt dein Wichtel deine Wunschliste.\n\nAuf dem Gerät, mit dem du die Einladung angenommen hast:\n{link}\n\nSonst deinen persönlichen Link oder den Wiederherstellungscode verwenden.', { name: p.name, title, link: M.jumpLink(p.id) });
  const groupText = team
    ? t('Bei „{title}“ wurde ausgelost! Auf eurer ZeroWichtel-Seite seht ihr, welches Team ihr beschenkt, und schreibt euren Team-Wunschzettel. Zu finden unter {base} → „Meine Runden“.', { title, base: linkBase() })
    : t('Bei „{title}“ wurde ausgelost! Wer seine ZeroWichtel-Seite noch nicht geöffnet hat: bitte einmal öffnen – erst dann sieht euer Wichtel eure Wunschliste. Auf dem Gerät mit der angenommenen Einladung findet ihr die Runde unter {base} → „Meine Runden“.', { title, base: linkBase() });

  const list = h('ul', { class: 'people seen-list' });
  for (const p of drawn) {
    const actions = h('div', { class: 'person-actions' });
    if (!p.drawSeen) {
      add(actions,
        h('button', { type: 'button', class: 'btn btn-small', on: { click: () => shareText(t('Erinnerung'), personText(p)) } }, t('Erinnern')),
        round.emailEnabled && p.hasEmail && p.notify && !(p.drawRemindedAt && nowSec() - p.drawRemindedAt < 20 * 3600)
          ? actionButton(t('Per E-Mail'), async () => {
            await M.remindDraw(ctx, p.id);
            toast(t('Erinnerung an {to} verschickt.', { to: p.email ?? p.name }), 'ok');
            reload();
          }, { cls: 'btn btn-small' })
          : null);
    }
    add(list, h('li', { class: 'person' },
      h('div', { class: 'person-main' },
        h('span', { class: 'person-name' }, p.name),
        h('span', { class: 'person-chips' },
          p.drawSeen ? chip(t('hat nachgesehen'), 'ok') : chip(t('noch nicht nachgesehen'), 'warn'),
          p.drawRemindedAt && !p.drawSeen ? chip(t('per E-Mail erinnert {date}', { date: formatDate(p.drawRemindedAt) }), 'muted') : null)),
      actions));
  }
  return h('div', { class: 'seen' },
    h('h3', null, t('Schon nachgesehen: {n} von {total}', { n: drawn.length - pending.length, total: drawn.length })),
    h('p', { class: 'hint' }, team
      ? t('Du siehst nur, ob jemand nachgesehen hat – nicht, welches Team er beschenkt.')
      : t('Erst wenn jemand seine Seite nach der Ziehung einmal öffnet, bekommt sein Wichtel die Wunschliste. Du siehst nur, ob jemand nachgesehen hat – nicht, wen er beschenkt.')),
    list,
    pending.length > 1
      ? h('p', null, h('button', { type: 'button', class: 'btn btn-small', on: { click: () => shareText(t('Erinnerung'), groupText) } }, t('Sammel-Erinnerung teilen')))
      : null);
}

/** Team-Wichteln: an/aus, Teams anlegen, Personen zuordnen. Nur vor der Ziehung. */
function teamCard({ ctx, data, reload }) {
  const { participants } = data;
  const on = data.teams !== null;
  const body = h('div');
  const state = { teams: structuredClone(data.teams ?? []), dirty: false };

  const render = () => {
    clear(body);
    if (!on) {
      add(body,
        h('p', null, t('Statt Person für Person beschenken sich ganze Teams: Team A beschenkt Team B, Team B beschenkt Team C … Wer zugesagt hat, wählt auf der eigenen Seite ein Team; du kannst Personen auch selbst zuordnen.')),
        h('p', { class: 'hint' }, t('Jedes Team schreibt nach der Auslosung einen gemeinsamen Wunschzettel. Teamliste und Teamwahl sind verschlüsselt; der Server erfährt nur, wie viele Teams es gibt.')),
        actionButton(t('Team-Wichteln einschalten'), async () => {
          await M.setTeams(ctx, [{ name: t('Team {n}', { n: 1 }) }, { name: t('Team {n}', { n: 2 }) }, { name: t('Team {n}', { n: 3 }) }]);
          toast(t('Team-Wichteln eingeschaltet. Benenne die Teams und speichere.'), 'ok');
          reload();
        }, { cls: 'btn' }));
      return;
    }
    const change = () => { state.dirty = true; render(); };
    const count = (id) => participants.filter((p) => p.team === id && p.rsvp !== 'raus').length;
    const list = h('div', { class: 'groups teams' });
    state.teams.forEach((x, i) => {
      const nameIn = h('input', { type: 'text', maxlength: M.TEAM_LIMITS.name, 'aria-label': t('Name von Team {n}', { n: i + 1 }) });
      nameIn.value = x.name;
      nameIn.addEventListener('change', () => { x.name = nameIn.value; change(); });
      const maxIn = h('input', { type: 'number', min: 1, max: M.TEAM_LIMITS.maxSize, inputmode: 'numeric', class: 'input-narrow', 'aria-label': t('Höchstgröße von Team {n} (optional)', { n: i + 1 }), placeholder: t('beliebig') });
      maxIn.value = x.max ?? '';
      maxIn.addEventListener('change', () => { x.max = maxIn.value === '' ? null : Number(maxIn.value); change(); });
      const members = participants.filter((p) => p.team === x.id);
      add(list, h('div', { class: 'group' },
        h('div', { class: 'group-head' }, nameIn, h('label', { class: 'team-max' }, h('span', { 'aria-hidden': 'true' }, t('max.')), maxIn),
          h('button', { type: 'button', class: 'btn btn-small btn-ghost btn-danger', on: { click: () => { state.teams.splice(i, 1); change(); } } }, t('Löschen'))),
        h('div', { class: 'person-chips' },
          x.id && members.length ? members.map((p) => chip(p.name, p.rsvp === 'raus' ? 'muted' : '')) : h('span', { class: 'hint' }, t('Noch niemand im Team.')),
          x.id ? chip(tn(count(x.id), '{n} dabei', '{n} dabei'), 'muted') : null)));
    });
    const addTeam = h('button', { type: 'button', class: 'btn btn-small', disabled: state.teams.length >= M.TEAM_LIMITS.teams,
      on: { click: () => { state.teams.push({ name: t('Team {n}', { n: state.teams.length + 1 }), max: null }); change(); } } }, t('+ Team'));

    const saved = (data.teams ?? []).filter((x) => x.id);
    const assign = saved.length && !state.dirty
      ? h('ul', { class: 'assign-list' }, participants.filter((p) => p.rsvp !== 'raus').map((p) => {
        const sel = h('select', { 'aria-label': t('Team für {name}', { name: p.name }) },
          h('option', { value: '' }, t('– noch kein Team –')),
          saved.map((x) => h('option', { value: x.id, selected: p.team === x.id }, x.name)));
        sel.addEventListener('change', async () => {
          sel.disabled = true;
          try {
            await M.setPersonTeam(ctx, p.id, sel.value || null);
            toast(t('Team für {name} gespeichert.', { name: p.name }), 'ok');
            reload();
          } catch (e) {
            sel.disabled = false;
            toast(e.message, 'error');
          }
        });
        return h('li', null, h('span', null, p.name), sel);
      }))
      : null;

    add(body,
      h('p', null, t('Wer zugesagt hat, wählt auf der eigenen Seite ein Team – bis zur Auslosung. Du kannst hier jederzeit umsetzen.')),
      list, addTeam,
      h('div', { class: 'form-actions' },
        actionButton(state.dirty ? t('Teams speichern') : t('Gespeichert'), async () => {
          await M.setTeams(ctx, state.teams);
          toast(t('Teams gespeichert.'), 'ok');
          reload();
        }, { cls: state.dirty ? 'btn btn-primary' : 'btn' })),
      state.dirty ? h('p', { class: 'hint' }, t('Erst speichern, dann Personen zuordnen.')) : null,
      assign ? h('h3', null, t('Zuordnung')) : null,
      assign,
      notice(t('Den gemeinsamen Team-Wunschzettel schreiben die Teams erst nach der Auslosung – lose deshalb nicht zu knapp vor der Wunschfrist ({date}) aus.', { date: formatDate(data.round.wishDeadline) }), 'info'),
      h('details', { class: 'inline-details' },
        h('summary', null, t('Team-Wichteln ausschalten')),
        h('p', null, t('Danach wird wieder Person für Person ausgelost. Alle Teamwahlen werden gelöscht.')),
        actionButton(t('Ausschalten'), async () => {
          if (!confirm(t('Team-Wichteln ausschalten? Alle Teamwahlen werden gelöscht.'))) return;
          await M.setTeams(ctx, null);
          toast(t('Team-Wichteln ausgeschaltet.'), 'ok');
          reload();
        }, { cls: 'btn btn-small btn-danger' })));
  };
  render();
  return on
    ? card(t('Team-Wichteln'), body)
    : h('details', { class: 'card rules-card' }, h('summary', null, t('Team-Wichteln (optional)')), body);
}

export async function adminDrawSection({ ctx, data, reload }) {
  const { round, participants } = data;
  if (round.mode !== 'wichteln') return null;
  const names = Object.fromEntries(participants.map((p) => [p.id, p.name]));
  const wrap = h('div', { class: 'page' });

  if (round.status === 'offen') {
    // Arbeitskopie der Regeln; gespeichert wird verschlüsselt mit K_admin
    const known = new Set(participants.map((p) => p.id));
    const state = {
      groups: (data.admin.groups || []).map((g) => ({ ...g, members: g.members.filter((m) => known.has(m)) })),
      exclusions: (data.admin.exclusions || []).filter(([a, b]) => known.has(a) && known.has(b)),
      dirty: false,
    };
    const rulesBody = h('div');
    const drawBody = h('div');

    const save = async () => {
      await M.updateAdminData(ctx, { v: 1, groups: state.groups, exclusions: state.exclusions });
      state.dirty = false;
      data.admin = { v: 1, groups: state.groups, exclusions: state.exclusions };
    };

    const renderRules = () => {
      clear(rulesBody);
      const groupOf = (pid) => state.groups.find((g) => g.members.includes(pid));
      const change = () => { state.dirty = true; renderRules(); renderDraw(); };

      // Untergruppen
      const groupList = h('div', { class: 'groups' });
      for (const g of state.groups) {
        const nameIn = h('input', { type: 'text', maxlength: 30, 'aria-label': t('Name der Untergruppe') });
        nameIn.value = g.name;
        nameIn.addEventListener('change', () => { g.name = nameIn.value.trim().slice(0, 30) || t('Untergruppe'); change(); });
        add(groupList, h('div', { class: 'group' },
          h('div', { class: 'group-head' }, nameIn,
            h('button', { type: 'button', class: 'btn btn-small btn-ghost btn-danger', on: { click: () => { state.groups = state.groups.filter((x) => x !== g); change(); } } }, t('Löschen'))),
          h('div', { class: 'person-chips' }, g.members.length ? g.members.map((m) => chip(names[m] ?? '?')) : h('span', { class: 'hint' }, t('Noch niemand zugeordnet.'))),
        ));
      }
      const addGroup = h('button', {
        type: 'button', class: 'btn btn-small',
        on: { click: () => { state.groups.push({ id: newGroupId(), name: t('Untergruppe {n}', { n: state.groups.length + 1 }), members: [] }); change(); } },
      }, t('+ Untergruppe'));

      const assign = state.groups.length
        ? h('ul', { class: 'assign-list' }, participants.map((p) => {
          const sel = h('select', { 'aria-label': t('Untergruppe für {name}', { name: p.name }) },
            h('option', { value: '' }, t('– keine –')),
            state.groups.map((g) => h('option', { value: g.id, selected: groupOf(p.id) === g }, g.name)));
          sel.addEventListener('change', () => {
            state.groups.forEach((g) => { g.members = g.members.filter((m) => m !== p.id); });
            const g = state.groups.find((x) => x.id === sel.value);
            if (g) g.members.push(p.id);
            change();
          });
          return h('li', null, h('span', null, p.name), sel);
        }))
        : null;

      // Ausschlüsse
      const exList = h('ul', { class: 'ex-list' }, state.exclusions.map(([a, b], i) => h('li', null,
        h('span', null, `${names[a]} ⇄ ${names[b]}`),
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', on: { click: () => { state.exclusions.splice(i, 1); change(); } } }, t('Entfernen')))));
      const opts = () => [h('option', { value: '' }, t('Person wählen')), ...participants.map((p) => h('option', { value: p.id }, p.name))];
      const selA = h('select', { 'aria-label': t('Erste Person') }, opts());
      const selB = h('select', { 'aria-label': t('Zweite Person') }, opts());
      const addEx = h('button', {
        type: 'button', class: 'btn btn-small',
        on: {
          click: () => {
            const [a, b] = [selA.value, selB.value];
            if (!a || !b || a === b) return toast(t('Bitte zwei verschiedene Personen wählen.'), 'error');
            if (state.exclusions.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return toast(t('Dieser Ausschluss besteht schon.'), 'error');
            state.exclusions.push([a, b]);
            change();
          },
        },
      }, t('Ausschließen'));

      add(rulesBody, 
        h('p', null, t('Personen derselben Untergruppe ziehen sich nie gegenseitig – z. B. ein Haushalt, damit die Tochter nicht die eigene Mutter zieht. Einzelne Paare, etwa Partner:innen, kannst du zusätzlich ausschließen. Beides ist optional.')),
        h('h3', null, t('Untergruppen')),
        groupList, addGroup,
        assign,
        h('h3', null, t('Ausschlüsse')),
        state.exclusions.length ? exList : h('p', { class: 'hint' }, t('Keine Ausschlüsse.')),
        h('div', { class: 'ex-add' }, selA, selB, addEx),
        h('p', { class: 'hint' }, t('Gruppen und Ausschlüsse sind verschlüsselt und nur für dich sichtbar.')),
        h('div', { class: 'form-actions' },
          actionButton(state.dirty ? t('Regeln speichern') : t('Gespeichert'), async () => { await save(); toast(t('Regeln gespeichert.'), 'ok'); renderRules(); },
            { cls: state.dirty ? 'btn btn-primary' : 'btn' })),
      );
    };

    const renderDraw = () => {
      clear(drawBody);
      // Nur wer angenommen hat, besitzt einen Schlüssel und kann gezogen werden (z. B. nach „Neu einladen“ wichtig).
      const dabei = participants.filter((p) => p.rsvp === 'dabei' && p.claimed);
      const waiting = participants.filter((p) => p.rsvp === 'dabei' && !p.claimed);
      const open = participants.filter((p) => p.rsvp === 'offen');
      const ids = dabei.map((p) => p.id);
      const teamMode = data.teams !== null;
      const pre = teamMode ? teamPrecheck(data.teams, dabei) : precheck(ids, state.groups, state.exclusions, names);
      const deadlinePassed = nowSec() >= round.rsvpDeadline;
      add(drawBody, 
        h('p', null, tn(dabei.length, '{n} Person ist dabei.', '{n} Personen sind dabei.')),
        open.length
          ? notice(`${t('Noch keine Antwort: {names}.', { names: open.map((p) => p.name).join(', ') })} ${deadlinePassed ? t('Die Antwortfrist ist abgelaufen – sie sind nicht dabei.') : t('Wer bis zur Ziehung nicht zusagt, ist nicht dabei.')}`, 'warn')
          : null,
        waiting.length
          ? notice(t('Neu eingeladen, aber noch nicht angenommen: {names}. Erst nach dem Annehmen kann ausgelost werden – sonst bleiben sie außen vor.', { names: waiting.map((p) => p.name).join(', ') }), 'warn')
          : null,
        pre.ok
          ? notice(teamMode
            ? tn(pre.active.length, 'Ziehung möglich: {n} Team.', 'Ziehung möglich: {n} Teams beschenken sich im Kreis.')
            : t('Ziehung möglich. Es wird ein einziger großer Kreis gebildet, sofern die Regeln es zulassen.'), 'ok')
          : notice(pre.reason, 'error'),
        ...(pre.warnings ?? []).map((w) => notice(w, 'warn')),
        h('p', { class: 'hint' }, t('Die Ziehung passiert hier in deinem Browser. Das Ergebnis wird sofort für jede Person einzeln verschlüsselt – du selbst siehst nicht, wer wen beschenkt.')),
        actionButton(t('Jetzt auslosen'), async () => {
          const msg = deadlinePassed
            ? t('Jetzt für {n} Personen auslosen?', { n: dabei.length })
            : t('Die Antwortfrist läuft noch. Jetzt für {n} Personen auslosen? Danach sind keine Zu- oder Absagen mehr möglich.', { n: dabei.length });
          if (!confirm(msg)) return;
          if (teamMode) {
            const res = await M.performTeamDraw(ctx, data);
            toast(tn(res.teams, 'Ausgelost.', 'Ausgelost – {n} Teams beschenken sich im Kreis.'), 'ok');
            return reload();
          }
          if (state.dirty) await save();
          const res = await M.performDraw(ctx, data.admin, names);
          toast(res.form === 'kreis' ? t('Ausgelost – alle bilden einen großen Kreis.') : t('Ausgelost. Ein Kreis war wegen der Regeln nicht möglich, es gibt freie Paare.'), 'ok');
          reload();
        }, { cls: pre.ok ? 'btn btn-primary btn-large' : 'btn btn-large' }),
      );
      if (!pre.ok) drawBody.querySelector('button').disabled = true;
    };

    renderRules();
    renderDraw();
    add(wrap,
      teamCard({ ctx, data, reload }),
      data.teams === null
        ? h('details', { class: 'card rules-card', open: state.groups.length > 0 || state.exclusions.length > 0 },
          h('summary', null, t('Untergruppen und Ausschlüsse')), rulesBody)
        : null,
      card(t('Auslosen'), drawBody),
    );
    return wrap;
  }

  // Bereits gezogen
  const canRedraw = nowSec() < round.wishDeadline;
  add(wrap, card(t('Ausgelost'),
    h('p', null, data.teams !== null
      ? t('Die Ziehung ist am {date} erfolgt. Jedes Team sieht jetzt, welches Team es beschenkt – du auch, wenn du mitwichtelst. Wer wen beschenkt, weißt nicht einmal du.', { date: formatDate(round.drawnAt) })
      : t('Die Ziehung ist am {date} erfolgt. Alle Zusagenden sehen jetzt, wen sie beschenken – du auch, wenn du mitwichtelst. Wer wen beschenkt, weißt nicht einmal du.', { date: formatDate(round.drawnAt) })),
    seenSection({ ctx, data, reload }),
    canRedraw
      ? h('details', { class: 'inline-details' },
        h('summary', null, t('Neu auslosen')),
        h('p', null, t('Nur nötig, wenn jemand ausfällt oder den Zugang verloren hat. Alle bekommen eine neue Person; bisherige Rückfragen gehen verloren. Möglich bis zur Wunschfrist.')),
        actionButton(t('Ziehung wiederholen'), async () => {
          if (!confirm(t('Wirklich neu auslosen? Alle bekommen eine neue Person zugeordnet.'))) return;
          if (data.teams !== null) {
            await M.performTeamDraw(ctx, data);
            toast(t('Neu ausgelost.'), 'ok');
            return reload();
          }
          const res = await M.performDraw(ctx, data.admin, names);
          toast(res.form === 'kreis' ? t('Neu ausgelost.') : t('Neu ausgelost (freie Paare).'), 'ok');
          reload();
        }, { cls: 'btn btn-danger' }))
      : h('p', { class: 'hint' }, t('Die Wunschfrist ist vorbei; die Ziehung steht fest.')),
  ));
  return wrap;
}
