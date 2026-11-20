// ZeroWichtel – Unterstützungslink des Betreibers (2.12).
// Kommt aus /api/info, nur wenn der Betreiber ihn eingeschaltet hat. Angezeigt als gewöhnlicher Link: neuer Tab,
// ohne Referrer und ohne Opener. Nichts wird eingebettet oder vorab geladen.
import { h } from './dom.js';
import { api } from './api.js';
import { t } from './i18n.js';

let pending = null;

/** Liest den Link einmal je Seitenaufruf. Fehler (offline, alter Server) = kein Link. */
export function loadDonation() {
  pending ??= api('GET', '/info').then((info) => readDonation(info?.donation)).catch(() => null);
  return pending;
}

/** Defensiv lesen: nur https, Texte begrenzt. */
export function readDonation(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.url !== 'string') return null;
  let u;
  try { u = new URL(raw.url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const text = (v, n) => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, n).join('') : '');
  return { url: u.href, label: text(raw.label, 40), note: text(raw.note, 200), inRounds: raw.inRounds === true };
}

export const donationLabel = (d) => d.label || t('Unterstützen');

/** Link zum Unterstützen; Ziel erst beim Klick, ohne Referrer. */
export function donationLink(d, cls = null) {
  return h('a', {
    href: d.url, target: '_blank', rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer', class: cls,
    'data-donation': '',
    title: t('Öffnet {host} in einem neuen Tab', { host: new URL(d.url).hostname }),
  }, donationLabel(d));
}

/** Link in der Fußzeile ergänzen (einmal beim Start). */
export async function initFooterDonation() {
  const d = await loadDonation();
  const foot = document.querySelector('footer.footer');
  if (!d || !foot || foot.querySelector('[data-donation]')) return;
  const a = donationLink(d, 'footer-donate');
  foot.insertBefore(a, foot.querySelector('span') ?? null);
  document.addEventListener('zw:lang', () => {
    a.textContent = donationLabel(d);
    a.title = t('Öffnet {host} in einem neuen Tab', { host: new URL(d.url).hostname });
  });
}

/**
 * Karte „ZeroWichtel unterstützen“ – auf der Startseite immer (falls eingeschaltet), in den Runden nur, wenn der
 * Betreiber das ausdrücklich gewählt hat. Gibt sofort einen leeren Platzhalter zurück; die Karte kommt nachträglich.
 * card = die card()-Funktion der Ansichten (hier übergeben, um keine Abhängigkeit von views/ einzuführen).
 */
export function donationCard(card, { inRound = false } = {}) {
  const slot = h('div', { class: 'donation-slot' });
  loadDonation().then((d) => {
    if (!d || (inRound && !d.inRounds)) return;
    slot.append(card(t('ZeroWichtel unterstützen'),
      h('p', null, d.note || t('ZeroWichtel ist kostenlos, werbefrei und ohne Tracking. Wenn es dir gefällt, freut sich der Betreiber über deine Unterstützung.')),
      h('p', null, donationLink(d, 'btn')),
      h('p', { class: 'hint' }, t('Der Link führt zu {host} und öffnet sich erst bei deinem Klick. ZeroWichtel gibt dabei nichts weiter; dort gelten die Datenschutzbestimmungen des Anbieters.', { host: new URL(d.url).hostname }))));
  });
  return slot;
}
