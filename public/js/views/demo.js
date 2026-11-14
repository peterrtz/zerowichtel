// Probelauf (#demo): zeigt, wie die Ziehung funktioniert – ganz ohne Server, Konto oder Runde.
// Dieselbe Ziehung und dieselbe Verschlüsselung wie im Ernstfall, nur dass hier alle Schlüssel im selben Browser liegen.

import { h, add, clear, toast, actionButton } from '../lib/dom.js';
import * as C from '../lib/crypto.js';
import { draw } from '../lib/draw.js';
import { t } from '../lib/i18n.js';
import { page, card, mount, setTitle, notice } from './common.js';

const MAX = 8;
const DEFAULT_NAMES = () => [t('Anna'), t('Ben'), t('Cem'), t('Dana')];

export function renderDemo(root) {
  setTitle(t('Probelauf'));
  const names = DEFAULT_NAMES();
  const nameList = h('div', { class: 'demo-names' });
  const result = h('div', { class: 'demo-result', 'aria-live': 'polite' });

  const renderNames = () => {
    clear(nameList);
    names.forEach((n, i) => {
      const input = h('input', { type: 'text', maxlength: 40, 'aria-label': t('Name {n}', { n: i + 1 }) });
      input.value = n;
      input.addEventListener('input', () => { names[i] = input.value; });
      add(nameList, h('div', { class: 'inline-form' }, input,
        names.length > 3
          ? h('button', { type: 'button', class: 'btn btn-small btn-ghost', 'aria-label': t('{name} entfernen', { name: n || t('Name {n}', { n: i + 1 }) }), on: { click: () => { names.splice(i, 1); renderNames(); } } }, '✕')
          : null));
    });
    if (names.length < MAX) {
      add(nameList, h('button', { type: 'button', class: 'btn btn-small', on: { click: () => { names.push(''); renderNames(); nameList.querySelectorAll('input')[names.length - 1]?.focus(); } } }, t('+ Person')));
    }
  };

  const run = async () => {
    const people = names.map((n) => n.trim()).filter(Boolean);
    if (people.length < 3) throw new Error(t('Für eine Ziehung braucht es mindestens 3 Namen.'));
    if (new Set(people).size !== people.length) throw new Error(t('Bitte jeden Namen nur einmal verwenden.'));
    // Jede Person bekommt ein eigenes Schlüsselpaar – im Ernstfall entsteht es auf ihrem Gerät.
    const keys = await Promise.all(people.map(() => C.keypairFromSecret(C.newKey())));
    const ids = people.map((_, i) => String(i));
    const { pairs, form } = draw(ids, [], []);
    // Die Organisator:in versiegelt jede Zuordnung an den öffentlichen Schlüssel der schenkenden Person.
    const envelopes = await Promise.all(pairs.map(async ([g, r]) => ({
      giver: Number(g),
      ct: await C.sealTo(keys[Number(g)].publicB64, { receiver: people[Number(r)] }, ['demo', g]),
    })));
    pairs.length = 0;
    envelopes.sort((a, b) => a.giver - b.giver);

    clear(result);
    add(result,
      notice(form === 'kreis' ? t('Ausgelost: Alle bilden einen großen Kreis.') : t('Ausgelost.'), 'ok'),
      h('p', null, t('Das sieht die Organisator:in nach der Ziehung – verschlossene Umschläge. Öffnen kann jeden nur die Person, an deren Schlüssel er versiegelt ist. Hier liegen ausnahmsweise alle Schlüssel in deinem Browser, also kannst du jeden öffnen:')),
      h('ul', { class: 'envelopes' }, envelopes.map((env) => {
        const out = h('p', { class: 'envelope-out' });
        const btn = actionButton(t('Als {name} öffnen', { name: people[env.giver] }), async () => {
          const opened = await C.openSealed(keys[env.giver], env.ct, ['demo', String(env.giver)]);
          out.textContent = t('{giver} beschenkt {receiver}.', { giver: people[env.giver], receiver: opened.receiver });
          btn.disabled = true;
          btn.classList.add('is-done');
        }, { cls: 'btn btn-small' });
        return h('li', { class: 'envelope' },
          h('span', { class: 'envelope-icon', 'aria-hidden': 'true' }, '✉'),
          h('div', null,
            h('strong', null, t('Umschlag für {name}', { name: people[env.giver] })),
            h('code', { class: 'envelope-ct', title: t('Ausschnitt des Chiffretexts') }, `${env.ct.slice(0, 28)}…`),
            out),
          btn);
      })),
      h('p', { class: 'hint' }, t('Mit einem fremden Schlüssel bleibt ein Umschlag zu: Jeder ist mit X25519 an genau eine Person versiegelt und mit AES-256-GCM verschlüsselt. Auch der Server bekommt im Ernstfall nur solche Umschläge.')),
    );
    toast(t('Ausgelost.'), 'ok');
  };

  renderNames();
  mount(root, page(
    h('h1', null, t('Probelauf')),
    h('p', { class: 'lead' }, t('Probier die Ziehung aus, ohne eine Runde anzulegen. Nichts davon verlässt deinen Browser.')),
    card(t('Wer macht mit?'),
      nameList,
      h('div', { class: 'form-actions' }, actionButton(t('Auslosen'), run, { cls: 'btn btn-primary' })),
      h('p', { class: 'hint' }, t('Im Probelauf gibt es keine Untergruppen und Ausschlüsse; in einer echten Runde schon.'))),
    result,
    card(t('Bereit?'),
      h('p', null, t('In einer echten Runde lädst du alle ein, sie sagen zu, und die Ziehung läuft genauso – nur dass jeder Schlüssel auf dem Gerät der jeweiligen Person bleibt.')),
      h('p', null, h('a', { class: 'btn btn-primary', href: '#neu' }, t('Echte Runde anlegen')))),
  ));
}
