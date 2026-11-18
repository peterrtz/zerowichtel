// Wichtel-Mixtape der Runde (2.11): eigene Lieder eintragen, gemischte Trackliste ohne Namen, Such-Links.
import { h, add, svg, toast, actionButton } from '../lib/dom.js';
import * as M from '../lib/model.js';
import { MIX_LIMITS, buildTracklist, trackLabel, searchLinks, tracklistText } from '../lib/mixtape.js';
import { copyText } from '../lib/share.js';
import { nowSec, formatDate } from '../lib/dates.js';
import { t, tn } from '../lib/i18n.js';
import { card } from './common.js';

/** Kassette als eigene Linienzeichnung (keine Marke, kein fremdes Motiv). */
function cassette(count) {
  return svg('svg', { viewBox: '0 0 240 150', class: 'mix-cassette', role: 'img', 'aria-label': tn(count, '{n} Lied auf dem Mixtape', '{n} Lieder auf dem Mixtape') },
    svg('rect', { x: 6, y: 6, width: 228, height: 138, rx: 14, class: 'shell' }),
    svg('rect', { x: 26, y: 22, width: 188, height: 70, rx: 8, class: 'label' }),
    svg('path', { d: 'M38 40 H180 M38 52 H150', class: 'lines' }),
    svg('rect', { x: 64, y: 62, width: 112, height: 24, rx: 12, class: 'window' }),
    svg('circle', { cx: 84, cy: 74, r: 9, class: 'reel' }), svg('circle', { cx: 156, cy: 74, r: 9, class: 'reel' }),
    svg('path', { d: 'M84 67 V81 M77 74 H91 M156 67 V81 M149 74 H163', class: 'spokes' }),
    svg('path', { d: 'M56 144 L70 112 H170 L184 144', class: 'base' }),
    svg('circle', { cx: 92, cy: 128, r: 4, class: 'hole' }), svg('circle', { cx: 148, cy: 128, r: 4, class: 'hole' }),
    svg('path', { d: 'M196 28 l3 6 6 1 -4.5 4.3 1 6.2 -5.5 -3 -5.5 3 1 -6.2 -4.5 -4.3 6 -1z', class: 'star' }));
}

export function mixtapeCard({ pctx, data, name, reload }) {
  const { round, me, meta } = data;
  if (me.rsvp === 'raus') return null;
  const own = data.mix?.own ?? null;
  const others = data.mix?.others ?? [];
  const editable = nowSec() < round.eventDate;
  const revealOpen = nowSec() >= round.eventDate;
  const tracks = buildTracklist([own, ...others], round.id);
  const body = h('div');

  // Trackliste
  const item = (x, i) => h('li', { class: 'mix-track' },
    h('span', { class: 'mix-no', 'aria-hidden': 'true' }, trackLabel(i, tracks.length)),
    h('div', { class: 'mix-main' },
      h('span', { class: 'mix-title' }, x.title),
      x.artist ? h('span', { class: 'mix-artist' }, ` – ${x.artist}`) : null,
      x.count > 1 ? h('span', { class: 'hint' }, ' ', tn(x.count, '(von {n} Person gewählt)', '(von {n} Personen gewählt)')) : null,
      x.by.length ? h('span', { class: 'mix-by' }, ' ', t('· aufgedeckt: {names}', { names: x.by.join(', ') })) : null,
      h('details', { class: 'mix-listen' },
        h('summary', null, t('Anhören')),
        h('p', { class: 'mix-links' }, searchLinks(x).map((l) => h('a', {
          href: l.url, target: '_blank', rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer', class: 'btn btn-small',
          'aria-label': t('„{title}“ bei {service} suchen (öffnet {service})', { title: x.title, service: l.name }),
        }, l.name))))));
  const list = tracks.length
    ? h('ol', { class: 'mix-tracks' }, tracks.map(item))
    : h('p', { class: 'hint' }, t('Noch keine Lieder. Trag deine Lieblings-Weihnachtslieder ein – sie erscheinen hier gemischt und ohne Namen.'));

  // Eigene Lieder
  const rows = [];
  for (let i = 0; i < MIX_LIMITS.songs; i++) {
    const s = own?.songs[i] ?? { title: '', artist: '' };
    const ti = h('input', { type: 'text', maxlength: MIX_LIMITS.title, 'aria-label': t('Lied {n}: Titel', { n: i + 1 }), placeholder: t('Titel') });
    const ar = h('input', { type: 'text', maxlength: MIX_LIMITS.artist, 'aria-label': t('Lied {n}: Interpret', { n: i + 1 }), placeholder: t('Interpret (optional)') });
    ti.value = s.title;
    ar.value = s.artist;
    rows.push([ti, ar]);
  }
  const read = () => rows.map(([ti, ar]) => ({ title: ti.value, artist: ar.value }));
  const editor = editable
    ? h('details', { class: 'inline-details mix-edit', open: !own },
      h('summary', null, own ? t('Deine Lieder ändern') : t('Deine Lieder eintragen')),
      h('div', { class: 'mix-rows' }, rows.map(([ti, ar], i) => h('div', { class: 'mix-row' }, h('span', { class: 'mix-no', 'aria-hidden': 'true' }, String(i + 1)), ti, ar))),
      h('div', { class: 'form-actions' },
        actionButton(t('Lieder speichern'), async () => {
          try {
            const saved = await M.saveMix(pctx, read());
            toast(saved.songs.length ? t('Lieder gespeichert.') : t('Deine Lieder sind entfernt.'), 'ok');
            reload();
          } catch (e) { toast(e.message, 'error'); }
        }, { cls: 'btn btn-primary' })),
      h('p', { class: 'hint' }, t('Bis zu {n} Lieder, änderbar bis zur Bescherung am {date}. Alle in der Runde sehen sie ohne deinen Namen.', { n: MIX_LIMITS.songs, date: formatDate(round.eventDate) })))
    : null;

  // Aufdecken ab der Bescherung
  const reveal = revealOpen && own?.songs.length
    ? h('p', null, actionButton(own.by ? t('Meine Lieder wieder verbergen') : t('Meine Lieder aufdecken'), async () => {
      try {
        await M.saveMix(pctx, own.songs, own.by ? null : name);
        toast(own.by ? t('Deine Lieder sind wieder ohne Namen.') : t('Aufgedeckt – alle sehen jetzt, welche Lieder von dir sind.'), 'ok');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    }, { cls: 'btn btn-small' }))
    : null;

  add(body,
    h('div', { class: 'mix-head' }, cassette(tracks.length),
      h('p', null, revealOpen
        ? t('Die Lieblings-Weihnachtslieder der Runde, gemischt. Wer welches Lied ausgesucht hat? Jetzt darf jede:r die eigenen Lieder aufdecken.')
        : t('Die Lieblings-Weihnachtslieder der Runde, gemischt und ohne Namen. Ratet beim Wichteln, wer welches Lied ausgesucht hat – ab der Bescherung kann jede:r die eigenen Lieder aufdecken.'))),
    list,
    tracks.length ? h('p', null, actionButton(t('Trackliste kopieren'), async () => {
      await copyText(tracklistText(t('Wichtel-Mixtape: {title}', { title: meta.title }), tracks));
    }, { cls: 'btn btn-small btn-ghost' })) : null,
    h('p', { class: 'hint' }, t('„Anhören“ öffnet die Suche beim jeweiligen Dienst erst beim Klick; dorthin gehen nur Titel und Interpret. ZeroWichtel lädt nichts von Musikdiensten.')),
    reveal,
    editor);
  return h('section', { id: 'mixtape' }, card(t('Wichtel-Mixtape'), body));
}
