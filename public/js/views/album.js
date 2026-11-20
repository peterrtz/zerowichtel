// Adventsalbum (2.13): Fotos der Vorweihnachtszeit, nur für die Runde, und Erinnerungsalbum als PDF.
import { h, add, clear, toast, actionButton } from '../lib/dom.js';
import * as P from '../lib/photos.js';
import { adventSundays, dayKey } from '../lib/photos.js';
import { buildAlbumPdf, LAYOUTS, DESIGNS, normalizeOptions, COVER_TEXT_MAX } from '../lib/album-pdf.js';
import { nowSec, formatDate } from '../lib/dates.js';
import { t, tn } from '../lib/i18n.js';
import { card, notice, chip } from './common.js';

const MB = (b) => (b / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Nach Tagen gruppiert, neueste zuerst. */
function groupByDay(items) {
  const groups = new Map();
  for (const it of [...items].sort((a, b) => b.at - a.at)) {
    const k = dayKey(it.at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return groups;
}

function dayLabel(key, items, eventDate) {
  const [y] = key.split('-').map(Number);
  const advent = adventSundays(y).get(key);
  const extra = [];
  if (advent) extra.push(t('{n}. Advent', { n: advent }));
  if (eventDate && dayKey(eventDate) === key) extra.push(t('Bescherung'));
  return [formatDate(items[0].at), ...extra].join(' · ');
}

let viewer = null;

/** Großansicht in einem Dialog. */
function showPhoto(item, getFull, onDelete) {
  viewer?.remove();
  const img = h('img', { class: 'album-full', alt: item.meta?.caption || t('Foto') });
  const status = h('p', { class: 'hint' }, t('Wird geladen …'));
  const close = h('button', { type: 'button', class: 'btn btn-small' }, t('Schließen'));
  const del = onDelete ? actionButton(t('Foto löschen'), async () => {
    if (!confirm(t('Dieses Foto löschen? Es verschwindet für alle in der Runde.'))) return;
    try {
      await onDelete(item);
      viewer.close();
    } catch (e) { toast(e.message, 'error'); }
  }, { cls: 'btn btn-small btn-ghost' }) : null;
  viewer = h('dialog', { class: 'modal album-viewer', 'aria-label': t('Foto') },
    h('div', { class: 'modal-body' },
      h('figure', null, img,
        h('figcaption', null,
          item.meta?.caption ? h('strong', null, item.meta.caption) : null,
          h('span', { class: 'hint' }, [item.meta?.name, formatDate(item.at)].filter(Boolean).join(' · ')))),
      status),
    h('div', { class: 'modal-actions' }, del, close));
  close.addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', (ev) => { if (ev.target === viewer) viewer.close(); });
  viewer.addEventListener('close', () => {
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    viewer.remove();
  });
  document.body.append(viewer);
  viewer.showModal();
  getFull(item.id).then(({ blob }) => {
    img.src = URL.createObjectURL(blob);
    status.remove();
  }).catch((e) => { status.textContent = e.message; });
}

function timelineView(items, { eventDate, getFull, canDelete, onDelete }) {
  if (!items.length) return h('p', { class: 'hint' }, t('Noch keine Fotos. Plätzchen gebacken, Weihnachtsmarkt besucht, die erste Kerze angezündet? Teil es hier mit der Runde.'));
  const groups = groupByDay(items);
  return h('div', { class: 'album-timeline' }, [...groups].map(([key, list]) => h('section', { class: 'album-day' },
    h('h3', { class: 'album-day-title' }, dayLabel(key, list, eventDate)),
    h('ul', { class: 'album-grid' }, list.map((it) => h('li', null,
      h('button', {
        type: 'button', class: 'album-thumb',
        'aria-label': it.broken ? t('Unlesbares Foto') : t('Foto von {name} öffnen: {caption}', { name: it.meta.name || '?', caption: it.meta.caption || t('ohne Bildunterschrift') }),
        on: {
          click: async () => {
            if (!it.broken) return showPhoto(it, getFull, canDelete(it) ? onDelete : null);
            if (!canDelete(it)) return toast(t('Dieses Foto lässt sich nicht entschlüsseln oder ist kein Bild.'), 'warn');
            if (!confirm(t('Diese Datei lässt sich nicht entschlüsseln oder ist kein Bild. Löschen?'))) return;
            try { await onDelete(it); } catch (e) { toast(e.message, 'error'); }
          },
        },
      },
      it.thumbUrl ? h('img', { src: it.thumbUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'album-broken' }, '?')),
      h('p', { class: 'album-cap' },
        it.meta?.caption ? h('span', null, it.meta.caption) : null,
        h('span', { class: 'hint' }, it.meta?.name ?? ''))))))));
}

const PREF_KEY = (roundId) => `zw.albumPdf.${roundId}`;
function loadPrefs(roundId) {
  try { return JSON.parse(localStorage.getItem(PREF_KEY(roundId)) ?? '{}') ?? {}; } catch { return {}; }
}
function savePrefs(roundId, o) {
  try { localStorage.setItem(PREF_KEY(roundId), JSON.stringify(o)); } catch { /* nur Komfort */ }
}

/** Dialog „Erinnerungsalbum als PDF“: Layout, Design, Format, Titelblatt. */
function pdfDialog({ roundId, title, eventDate, items, getFull }) {
  const o = normalizeOptions(loadPrefs(roundId));
  const radio = (name, value, checked, label, hint, extra = null) => h('label', { class: 'mode-option' },
    h('input', { type: 'radio', name, value, checked }),
    h('span', null, extra, h('strong', null, label), hint ? h('span', { class: 'hint' }, hint) : null));
  const layouts = Object.entries(LAYOUTS).map(([k, v]) => radio('pdf-layout', k, o.layout === k, t(v.label), t(v.hint)));
  const designs = Object.entries(DESIGNS).map(([k, v]) => radio('pdf-design', k, o.design === k, t(v.label), null, h('span', { class: `swatch swatch-${k}`, 'aria-hidden': 'true' })));
  const formats = [['hoch', t('Hochformat')], ['quer', t('Querformat')]].map(([k, l]) => radio('pdf-format', k, o.orientation === k, l));
  const tTitle = h('input', { type: 'text', id: 'pdf-title', maxlength: 60, placeholder: t('Adventsalbum') });
  const tSub = h('input', { type: 'text', id: 'pdf-sub', maxlength: 100, placeholder: title });
  const tText = h('textarea', { id: 'pdf-text', rows: 3, maxlength: COVER_TEXT_MAX, placeholder: t('z. B. Unser Advent 2026 – danke für die schönen Momente!') });
  tTitle.value = o.title;
  tSub.value = o.subtitle;
  tText.value = o.text;
  const usable = [...items].filter((x) => !x.broken).sort((a, b) => a.at - b.at);
  const cover = h('select', { id: 'pdf-cover' },
    h('option', { value: 'first' }, t('Erstes Foto')),
    h('option', { value: 'none' }, t('Kein Foto')),
    usable.map((it, i) => h('option', { value: it.id }, `${i + 1}. ${it.meta.caption || t('ohne Bildunterschrift')} (${it.meta.name || '?'})`)));
  cover.value = [...cover.options].some((x) => x.value === o.coverPhoto) ? o.coverPhoto : 'first';
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  const read = () => {
    const f = new FormData(form);
    return normalizeOptions({ layout: f.get('pdf-layout'), design: f.get('pdf-design'), orientation: f.get('pdf-format'), title: tTitle.value, subtitle: tSub.value, text: tText.value, coverPhoto: cover.value });
  };
  const close = h('button', { type: 'button', class: 'btn btn-ghost' }, t('Abbrechen'));
  const make = actionButton(t('PDF erstellen'), async () => {
    const opts = read();
    savePrefs(roundId, opts);
    try {
      const blob = await buildAlbumPdf({
        title, eventDate, items, getFull, options: opts,
        onProgress: (d, n) => { status.textContent = t('Foto {d} von {n} …', { d: Math.min(d + 1, n), n }); },
      });
      status.textContent = t('Fertig – der Download startet.');
      const a = h('a', { href: URL.createObjectURL(blob), download: `${opts.title || t('Adventsalbum')} ${title}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'), class: 'visually-hidden' }, t('PDF herunterladen'));
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (e) {
      status.textContent = '';
      toast(e.message, 'error');
    }
  }, { cls: 'btn btn-primary' });
  const form = h('form', { class: 'pdf-form', on: { submit: (ev) => ev.preventDefault() } },
    h('fieldset', null, h('legend', null, t('Layout')), h('div', { class: 'mode-pick' }, layouts)),
    h('fieldset', null, h('legend', null, t('Design')), h('div', { class: 'mode-pick pdf-designs' }, designs)),
    h('fieldset', null, h('legend', null, t('Format')), h('div', { class: 'mode-pick pdf-formats' }, formats)),
    h('fieldset', null, h('legend', null, t('Titelblatt')),
      h('div', { class: 'field' }, h('label', { for: 'pdf-title' }, t('Titel')), tTitle),
      h('div', { class: 'field' }, h('label', { for: 'pdf-sub' }, t('Untertitel')), tSub),
      h('div', { class: 'field' }, h('label', { for: 'pdf-text' }, t('Text (optional)')), tText),
      h('div', { class: 'field' }, h('label', { for: 'pdf-cover' }, t('Titelfoto')), cover)),
    h('p', { class: 'hint' }, t('Die PDF entsteht nur in deinem Browser; nichts davon geht an den Server. Deine Auswahl merkt sich dieser Browser.')),
    status);
  const dlg = h('dialog', { class: 'modal pdf-dialog', 'aria-labelledby': 'pdf-dlg-title' },
    h('div', { class: 'modal-body' }, h('h2', { id: 'pdf-dlg-title' }, t('Erinnerungsalbum als PDF')), form),
    h('div', { class: 'modal-actions' }, close, make));
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function pdfButton(args) {
  return h('p', { class: 'album-pdf' }, h('button', { type: 'button', class: 'btn', on: { click: () => pdfDialog(args) } }, t('Erinnerungsalbum als PDF')));
}

// ---------------------------------------------------------------- Teilnehmende

export function personAlbumCard({ pctx, data, name }) {
  const { round, me, meta } = data;
  if (!round.album?.enabled) return null;
  const body = h('div');
  const section = h('section', { id: 'adventsalbum' }, card(t('Adventsalbum'), body));
  if (me.rsvp !== 'dabei') {
    add(body, h('p', { class: 'hint' }, t('Das Adventsalbum der Runde sehen alle, die zugesagt haben.')));
    return section;
  }
  const list = h('div');
  const usage = h('p', { class: 'hint' });
  const getFull = (id) => P.fullMine(pctx, id);
  let state = { items: [], usage: { mine: 0, roundBytes: 0 }, limits: null };

  const render = async () => {
    try {
      const r = await P.loadMine(pctx);
      state = { items: await P.openList(pctx.kRound, pctx.roundId, r.photos), usage: r.usage, limits: r.limits };
    } catch (e) {
      clear(list);
      add(list, notice(e.message, 'warn'));
      return;
    }
    const { limits, usage: u } = state;
    usage.textContent = t('{mine} von {max} eigenen Fotos · Album {used} von {total} MB', { mine: u.mine, max: limits.personPhotos, used: MB(u.roundBytes), total: MB(limits.roundBytes) });
    clear(list);
    add(list,
      round.album.pdf && nowSec() >= round.eventDate && state.items.length ? pdfButton({ roundId: round.id, title: meta.title, eventDate: round.eventDate, items: state.items, getFull }) : null,
      timelineView(state.items, {
        eventDate: round.eventDate, getFull,
        canDelete: (it) => it.own,
        onDelete: async (it) => { await P.deleteMine(pctx, it.id); toast(t('Foto gelöscht.'), 'ok'); await render(); },
      }));
  };

  // Hochladen: Auswahl → Aufbereitung → Vorschau mit Bildunterschrift → senden
  const file = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'album-file', tabindex: '-1', 'aria-label': t('Foto hinzufügen') });
  const stage = h('div', { class: 'album-stage' });
  const pick = h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => file.click() } }, t('Foto hinzufügen'));
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    clear(stage);
    add(stage, h('p', { class: 'hint' }, t('Foto wird vorbereitet …')));
    let prepared;
    try {
      prepared = await P.preparePhoto(f);
    } catch (e) {
      clear(stage);
      add(stage, notice(e.message, 'warn'));
      return;
    }
    const url = URL.createObjectURL(new Blob([prepared.thumb.bytes], { type: `image/${prepared.thumb.type}` }));
    const cap = h('input', { type: 'text', id: 'album-caption', maxlength: P.PHOTO.caption, placeholder: t('z. B. Erste Plätzchen 🍪') });
    const done = () => { URL.revokeObjectURL(url); clear(stage); };
    clear(stage);
    add(stage,
      h('div', { class: 'album-preview' }, h('img', { src: url, alt: t('Vorschau') }),
        h('div', null,
          h('div', { class: 'field' }, h('label', { for: 'album-caption' }, t('Bildunterschrift (optional)')), cap),
          h('p', { class: 'hint' }, t('{kb} KB, {w} × {h} Pixel. Ort, Kamera und Aufnahmedaten sind entfernt.', { kb: Math.round(prepared.full.bytes.length / 1024), w: prepared.full.w, h: prepared.full.h })),
          h('div', { class: 'form-actions' },
            actionButton(t('Hochladen'), async () => {
              try {
                await P.uploadPhoto(pctx, prepared, cap.value, name);
                done();
                toast(t('Foto geteilt.'), 'ok');
                await render();
              } catch (e) { toast(e.message, 'error'); }
            }, { cls: 'btn btn-primary' }),
            h('button', { type: 'button', class: 'btn btn-ghost', on: { click: done } }, t('Abbrechen'))))));
    cap.focus();
  });

  add(body,
    h('p', null, t('Momente aus der Vorweihnachtszeit: Plätzchen backen, Weihnachtsmarkt, die erste Kerze. Sichtbar nur für alle in dieser Runde, Ende-zu-Ende-verschlüsselt.')),
    h('div', { class: 'form-actions' }, pick, file),
    h('p', { class: 'hint' }, t('Bitte nur Fotos teilen, mit denen alle Abgebildeten einverstanden sind – bei Kindern die Eltern. Das Album wird mit der Runde gelöscht.')),
    usage,
    stage,
    list);
  render();
  return section;
}

// ---------------------------------------------------------------- Organisator:in

export function adminAlbumCard({ ctx, data, reload }) {
  const { round, participants, meta } = data;
  if (!data.albumAvailable && !round.album?.enabled) return null;
  const names = Object.fromEntries(participants.map((p) => [p.id, p.name]));
  const body = h('div');
  const on = h('input', { type: 'checkbox', id: 'album-on', checked: Boolean(round.album?.enabled) });
  const pdf = h('input', { type: 'checkbox', id: 'album-pdf', checked: Boolean(round.album?.pdf) });
  const list = h('div');
  const getFull = (id) => P.fullAdmin(ctx, id);

  const render = async () => {
    clear(list);
    let r;
    try {
      r = await P.loadAdmin(ctx);
    } catch (e) {
      add(list, notice(e.message, 'warn'));
      return;
    }
    const items = (await P.openList(ctx.kRound, ctx.roundId, r.photos)).map((it) => ({ ...it, meta: it.meta ? { ...it.meta, name: names[it.pid] ?? it.meta.name } : null }));
    add(list,
      h('p', { class: 'hint' }, tn(items.length, '{n} Foto', '{n} Fotos'), ` · ${t('{used} von {total} MB', { used: MB(r.usage.roundBytes), total: MB(r.limits.roundBytes) })}`),
      round.album?.pdf && nowSec() >= round.eventDate && items.length ? pdfButton({ roundId: round.id, title: meta.title, eventDate: round.eventDate, items, getFull }) : null,
      items.length ? timelineView(items, {
        eventDate: round.eventDate, getFull,
        canDelete: () => true,
        onDelete: async (it) => { await P.deleteAdmin(ctx, it.id); toast(t('Foto gelöscht.'), 'ok'); await render(); },
      }) : null);
  };

  add(body,
    h('p', null, t('Teilnehmende, die zugesagt haben, können Fotos aus der Vorweihnachtszeit teilen – verschlüsselt, nur für diese Runde. Du kannst jedes Foto löschen.')),
    data.albumAvailable ? null : notice(t('Das Adventsalbum ist auf diesem Server abgeschaltet.'), 'warn'),
    h('label', { class: 'check', for: 'album-on' }, on, ' ', t('Adventsalbum einschalten')),
    h('label', { class: 'check', for: 'album-pdf' }, pdf, ' ', t('Ab der Bescherung als PDF-Erinnerungsalbum herunterladbar')),
    h('p', { class: 'hint' }, t('Ausschalten blendet das Album aus; die Fotos bleiben bis zur Löschung der Runde gespeichert. Einzelne Fotos löschst du unten.')),
    h('div', { class: 'form-actions' }, actionButton(t('Speichern'), async () => {
      try {
        await P.setAlbum(ctx, on.checked, pdf.checked);
        toast(t('Gespeichert.'), 'ok');
        reload();
      } catch (e) { toast(e.message, 'error'); }
    }, { cls: 'btn' })),
    round.album?.enabled || round.album?.pdf ? list : null);
  if (round.album?.enabled || round.album?.pdf) render();
  return h('details', { class: 'card rules-card', id: 'adventsalbum-admin', open: Boolean(round.album?.enabled) },
    h('summary', null, t('Adventsalbum'), round.album?.enabled ? ' ' : '', round.album?.enabled ? chip(t('an'), 'ok') : null), body);
}
