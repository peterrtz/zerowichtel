// Prüfung von E-Mail-Adressen.
//
// Bis 2.3.0 stand hier der reguläre Ausdruck aus php-src (filter_var, FILTER_VALIDATE_EMAIL). PCRE in PHP bricht
// übermäßiges Backtracking über pcre.backtrack_limit ab, V8 nicht: Eingaben wie „a@a.a.a.…!“ brauchten exponentiell
// lange und blockierten den Server (SEC-001, CWE-1333). Diese Fassung zerlegt die Adresse und prüft jedes Teilstück
// mit einfachen Mustern ohne verschachtelte Wiederholungen – Laufzeit linear in der Länge.
//
// Regeln (wie filter_var, an einzelnen Stellen strenger, nie großzügiger):
//   - nur ASCII, höchstens 254 Byte, keine Leer- und Steuerzeichen und keine Zeichen < > , ; "
//   - Local-Part 1–64 Zeichen, „dot-atom“: Atome aus RFC-5322-atext, getrennt durch einzelne Punkte
//     (Quoted Strings wie "a b"@… sind nicht erlaubt – die verbotenen Zeichen schließen sie ohnehin aus)
//   - Domain: mindestens zwei Labels, je 1–63 Zeichen aus Buchstaben, Ziffern und inneren Bindestrichen,
//     Top-Level-Domain beginnt mit einem Buchstaben oder ist xn--…; alternativ eine IPv4-Adresse in [ ]
import { phpTrim } from './validate.mjs';

const MAX = 254;
const ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[A-Za-z0-9]+(?:-+[A-Za-z0-9]+)*$/;
const TLD = /^(?:[A-Za-z][A-Za-z0-9]*|xn--[A-Za-z0-9]+)(?:-+[A-Za-z0-9]+)*$/;
const IPV4 = /^\[(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\]$/;

function validLocal(local) {
  if (local.length < 1 || local.length > 64) return false;
  return local.split('.').every((atom) => ATOM.test(atom));
}

function validDomain(domain) {
  const ip = IPV4.exec(domain);
  if (ip) return ip.slice(1).every((o) => Number(o) <= 255 && !/^0\d/.test(o));
  if (domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  const tld = labels.pop();
  return labels.every((l) => l.length <= 63 && LABEL.test(l)) && tld.length <= 63 && TLD.test(tld);
}

/** Gibt die bereinigte Adresse zurück oder null. Zeichen, die in Kopfzeilen gefährlich wären, sind ausgeschlossen. */
export function validEmail(e) {
  if (typeof e !== 'string') return null;
  // Länge zuerst begrenzen: alle weiteren Prüfungen arbeiten auf höchstens MAX Zeichen.
  if (e.length > 1024) return null;
  e = phpTrim(e);
  if (e === '' || e.length > MAX || Buffer.byteLength(e) > MAX) return null;
  if (/[^\x21-\x7E]|[<>,;"]/.test(e)) return null;
  const at = e.lastIndexOf('@');
  if (at < 1 || e.indexOf('@') !== at) return null;
  return validLocal(e.slice(0, at)) && validDomain(e.slice(at + 1)) ? e : null;
}
