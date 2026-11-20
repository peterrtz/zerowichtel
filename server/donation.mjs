// Unterstützungs- bzw. Spendenlink des Betreibers (2.12), im Admin-Bereich oder per „zw donation“ einstellbar.
// Optional (inRounds) zusätzlich als Karte am Ende der Runden-Seiten – dort, wo Teilnehmende tatsächlich ankommen.
//
// ZeroWichtel ist kostenlos. Wer es betreibt, kann einen Link anzeigen lassen (z. B. „Buy me a coffee“ oder eine
// Spendenaktion). Der Link erscheint in der Fußzeile und auf der Startseite – als gewöhnlicher Link, der sich erst
// beim Klick in einem neuen Tab öffnet (ohne Referrer). Nichts wird eingebettet oder vorab geladen.
// Gespeichert in der Tabelle meta; ohne Eintrag gilt: aus.
import { getMeta, setMeta } from './cleanup.mjs';

export const DONATION_LIMITS = { url: 500, label: 40, note: 200 };
export const DONATION_DEFAULT = { enabled: false, url: '', label: '', note: '', inRounds: false };
export const DONATION_LABEL = 'Unterstützen';

const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const chars = (s) => [...s].length;

export class DonationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

/** Prüft eine Adresse: nur https, ohne Zugangsdaten, mit echtem Hostnamen. Gibt die normalisierte Adresse zurück. */
export function checkDonationUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new DonationError('url', 'Bitte eine Adresse angeben.');
  if (s.length > DONATION_LIMITS.url) throw new DonationError('url', `Die Adresse ist zu lang (höchstens ${DONATION_LIMITS.url} Zeichen).`);
  if (CTRL.test(s) || /\s/.test(s)) throw new DonationError('url', 'Die Adresse enthält Leer- oder Steuerzeichen.');
  let u;
  try { u = new URL(s); } catch { throw new DonationError('url', 'Das ist keine gültige Adresse.'); }
  if (u.protocol !== 'https:') throw new DonationError('url', 'Nur Adressen mit https:// sind erlaubt.');
  if (u.username || u.password) throw new DonationError('url', 'Die Adresse darf keine Zugangsdaten enthalten.');
  const host = u.hostname;
  if (!host.includes('.') || host.endsWith('.') || /^[\d.]+$/.test(host) || host.startsWith('[')) {
    throw new DonationError('url', 'Bitte eine Adresse mit Domainnamen angeben (keine IP-Adresse, kein lokaler Name).');
  }
  if (u.href.length > DONATION_LIMITS.url) throw new DonationError('url', `Die Adresse ist zu lang (höchstens ${DONATION_LIMITS.url} Zeichen).`);
  return u.href;
}

function cleanText(v, field, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (CTRL.test(s)) throw new DonationError(field, 'Der Text enthält Steuerzeichen.');
  if (chars(s) > max) throw new DonationError(field, `Höchstens ${max} Zeichen.`);
  return s;
}

/** Prüft und normalisiert eine Einstellung. Ausgeschaltet darf die Adresse leer sein. */
export function normalizeDonation({ enabled, url, label, note, inRounds } = {}) {
  if (typeof enabled !== 'boolean') throw new DonationError('enabled', 'enabled muss true oder false sein.');
  if (inRounds !== undefined && inRounds !== null && typeof inRounds !== 'boolean') throw new DonationError('inRounds', 'inRounds muss true oder false sein.');
  const u = String(url ?? '').trim();
  return {
    enabled,
    url: enabled || u ? checkDonationUrl(u) : '',
    label: cleanText(label, 'label', DONATION_LIMITS.label),
    note: cleanText(note, 'note', DONATION_LIMITS.note),
    inRounds: inRounds === true,
  };
}

export function donationSettings(db) {
  const raw = getMeta(db, 'donation');
  if (!raw) return { ...DONATION_DEFAULT };
  try {
    return normalizeDonation(JSON.parse(raw));
  } catch {
    // Unlesbarer oder ungültiger Eintrag: lieber nichts anzeigen
    return { ...DONATION_DEFAULT };
  }
}

export function saveDonation(db, settings) {
  const s = normalizeDonation(settings);
  setMeta(db, 'donation', JSON.stringify(s));
  return s;
}

/** Was die App öffentlich bekommt: nur eingeschaltet und mit Adresse. */
export function publicDonation(db) {
  const s = donationSettings(db);
  // Leerer Linktext: die App setzt einen übersetzten Standardtext ein
  return s.enabled && s.url ? { url: s.url, label: s.label, note: s.note, inRounds: s.inRounds } : null;
}

export function describeDonation(s) {
  if (!s.enabled) return s.url ? `aus (gespeichert: ${hostOf(s.url)})` : 'aus';
  return `an – „${s.label || DONATION_LABEL}“ → ${hostOf(s.url)}${s.inRounds ? ', auch in den Runden' : ', Fußzeile und Startseite'}`;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return '?'; }
}
