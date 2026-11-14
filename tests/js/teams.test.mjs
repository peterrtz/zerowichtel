// 2.5: Team-Wichteln – Vorprüfung, Ziehung zwischen Teams, Teamliste, Team-Wunschzettel, „Was jetzt?“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamPrecheck, drawTeams, isSingleCycle } from '../../public/js/lib/draw.js';
import { validateTeams, validateTeamWish } from '../../public/js/lib/model.js';
import { nextSteps } from '../../public/js/views/person.js';

const teams = [{ id: 'a', name: 'Einkauf', max: 2 }, { id: 'b', name: 'IT', max: null }, { id: 'c', name: 'Pflege', max: null }];
const p = (id, team) => ({ id, name: id.toUpperCase(), team });

test('Vorprüfung: ohne Team, zu wenige, 2 Teams mit Hinweis, Höchstgröße', () => {
  let r = teamPrecheck(teams, [p('x', 'a'), p('y', 'b')]);
  assert.equal(r.ok, false, 'weniger als 3 Zusagen');
  r = teamPrecheck(teams, [p('x', 'a'), p('y', 'b'), p('z', null), p('w', 'gelöscht')]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Z, W/, 'nennt alle ohne (gültiges) Team');
  r = teamPrecheck(teams, [p('x', 'a'), p('y', 'a'), p('z', 'a')]);
  assert.equal(r.ok, false, 'nur ein Team mit Mitgliedern');
  r = teamPrecheck(teams, [p('x', 'a'), p('y', 'b'), p('z', 'b')]);
  assert.equal(r.ok, true, 'zwei Teams erlaubt');
  assert.deepEqual(r.active, ['a', 'b']);
  assert.match(r.warnings.join(), /Nur 2 Teams/);
  r = teamPrecheck(teams, [p('x', 'a'), p('y', 'a'), p('v', 'a'), p('z', 'b'), p('u', 'c')]);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Einkauf.*3.*2/, 'Höchstgröße überschritten = Hinweis, kein Abbruch');
});

test('Ziehung zwischen Teams: ein Kreis, nie das eigene Team; bei 2 Teams gegenseitig', () => {
  for (let n = 3; n <= 12; n++) {
    const ids = Array.from({ length: n }, (_, i) => `t${i}`);
    for (let k = 0; k < 30; k++) {
      const { pairs } = drawTeams(ids);
      assert.equal(pairs.length, n);
      assert.ok(isSingleCycle(pairs), 'ein Kreis');
      assert.ok(pairs.every(([g, r]) => g !== r));
      assert.equal(new Set(pairs.map((x) => x[1])).size, n, 'jedes Team wird genau einmal beschenkt');
    }
  }
  assert.deepEqual(drawTeams(['a', 'b']).pairs, [['a', 'b'], ['b', 'a']]);
  assert.throws(() => drawTeams(['a']));
});

test('Teamliste: Namen Pflicht und eindeutig, Höchstgröße 1–50, IDs bleiben', () => {
  const out = validateTeams([{ id: 'keep', name: '  Einkauf ', max: '3' }, { name: 'IT', max: '' }]);
  assert.deepEqual(out.map((x) => [x.name, x.max]), [['Einkauf', 3], ['IT', null]]);
  assert.equal(out[0].id, 'keep');
  assert.match(out[1].id, /^[A-Za-z0-9_-]{22}$/, 'neue ID');
  assert.throws(() => validateTeams([{ name: '' }]), /Namen/);
  assert.throws(() => validateTeams([{ name: 'IT' }, { name: 'it' }]), /gleich/);
  assert.throws(() => validateTeams([{ name: 'X', max: 0 }]));
  assert.throws(() => validateTeams([{ name: 'X', max: 2.5 }]));
  assert.throws(() => validateTeams(Array.from({ length: 31 }, (_, i) => ({ name: `T${i}` }))));
});

test('Team-Wunschzettel: keine Gesundheitsangaben, keine persönlichen Größen, Autor:in vermerkt', () => {
  const w = validateTeamWish({
    noIdea: false, items: [{ text: 'Brettspiel', link: '' }], noGo: 'keine Kerzen',
    profile: { likes: 'Kaffee', colors: 'Grün', size: 'L', shoe: '42', allergies: 'Nüsse', consent: { v: 1, at: 1 } },
  }, 'Anna');
  assert.deepEqual(w.profile, { colors: 'Grün', likes: 'Kaffee' });
  assert.equal(w.team, true);
  assert.equal(w.by, 'Anna');
  assert.equal(w.items.length, 1);
});

test('„Was jetzt?“ bei Team-Wichteln', () => {
  const DAY = 86400;
  const now = 1_800_000_000;
  const round = (o = {}) => ({ status: 'offen', mode: 'wichteln', rsvpDeadline: now + 5 * DAY, wishDeadline: now + 10 * DAY, eventDate: now + 20 * DAY, deleteAfter: now + 34 * DAY, ...o });
  const me = (o = {}) => ({ rsvp: 'dabei', wishCt: null, assignmentCt: null, ...o });
  let s = nextSteps({ round: round(), me: me(), confirmed: true, now, budget: 30, teams, myTeam: null });
  assert.match(s.join('|'), /Wähl unten dein Team/);
  assert.doesNotMatch(s.join('|'), /Trag deine Wünsche/, 'keine persönliche Wunschliste');
  s = nextSteps({ round: round(), me: me(), confirmed: true, now, budget: 30, teams, myTeam: 'b' });
  assert.doesNotMatch(s.join('|'), /Wähl unten/);
  s = nextSteps({ round: round({ status: 'gezogen' }), me: me({ assignmentCt: 'x' }), confirmed: true, now, budget: 30, teams, myTeam: 'b' });
  assert.match(s.join('|'), /welches Team ihr beschenkt/);
});
