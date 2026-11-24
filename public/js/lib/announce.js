// ZeroWichtel – Nachricht der Organisator:in an alle (2.14).
//
// Inhalt {v, text, todos} wird mit K_round verschlüsselt (AAD an Runde und Nachrichten-ID gebunden). Alle in der Runde
// können ihn lesen, der Server nicht. todos = true: Unter der Nachricht sieht jede Person ihre eigenen offenen
// Aufgaben – berechnet auf ihrem Gerät, die Organisator:in erfährt davon nichts.
// Gelesen/ungelesen merkt sich jedes Gerät selbst (localStorage), der Server erfährt nichts davon.
import * as C from './crypto.js';
import { api } from './api.js';
import { t } from './i18n.js';

export const ANNOUNCE_MAX = 1500;
export const ANNOUNCE_COUNT = 10;
const AAD = (roundId, id) => ['ann', roundId, id];
const authA = (a) => `a.${a.roundId}.${a.adminToken}`;
const chars = (s) => [...s].length;

/** Prüft den Text; gibt den bereinigten Text zurück oder wirft. */
export function validateAnnouncement(text) {
  const v = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!v) throw new Error(t('Bitte etwas eintragen.'));
  if (chars(v) > ANNOUNCE_MAX) throw new Error(t('Höchstens {n} Zeichen.', { n: ANNOUNCE_MAX }));
  return v;
}

/** Senden. mail = Hinweis ohne Inhalt per E-Mail anfordern. Gibt { id, createdAt, mailQueued } zurück. */
export async function sendAnnouncement(ctx, { text, todos = false, mail = false }) {
  const v = validateAnnouncement(text);
  const id = C.newId();
  const bodyCt = await C.encryptJson(ctx.kRound, { v: 1, text: v, todos: !!todos }, AAD(ctx.roundId, id));
  return api('POST', `/rounds/${ctx.roundId}/announcements`, { auth: authA(ctx), body: { id, bodyCt, mail: !!mail } });
}

export async function deleteAnnouncement(ctx, id) {
  return api('DELETE', `/rounds/${ctx.roundId}/announcements/${id}`, { auth: authA(ctx) });
}

/** Entschlüsselt die Liste (neueste zuerst). Unlesbare werden übersprungen. */
export async function openAnnouncements(kRound, roundId, list = []) {
  const out = [];
  for (const a of list) {
    try {
      const b = await C.decryptJson(kRound, a.bodyCt, AAD(roundId, a.id));
      if (typeof b?.text !== 'string') continue;
      out.push({ id: a.id, createdAt: a.createdAt, text: b.text, todos: b.todos === true });
    } catch { /* manipuliert oder fremder Schlüssel – nicht anzeigen */ }
  }
  return out;
}

// ---------------------------------------------------------------- gelesen (nur auf diesem Gerät)

const seenKey = (roundId, who) => `zw.annSeen.${roundId}.${who}`;

export function readAnnSeen(roundId, who, storage = globalThis.localStorage) {
  try {
    return Number(storage.getItem(seenKey(roundId, who))) || 0;
  } catch {
    return 0;
  }
}

export function writeAnnSeen(roundId, who, at, storage = globalThis.localStorage) {
  try {
    if (at > readAnnSeen(roundId, who, storage)) storage.setItem(seenKey(roundId, who), String(at));
  } catch { /* nur Komfort */ }
}
