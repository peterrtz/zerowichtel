// ZeroWichtel – Rückfragen an die Organisator:in (2.9).
//
// Schlüssel:
//   Organisator-Schlüsselpaar: aus K_admin abgeleitet (nichts zu speichern); öffentlicher Teil liegt auf dem Server.
//   Frage:   für die Organisator:in versiegelt {text, rk, anon}; rk = zufälliger Antwortschlüssel.
//   Antwort: mit rk verschlüsselt – lesen können nur Organisator:in und fragende Person.
//   Mit Namen: eigene Kopie {text, rk} für den eigenen Schlüssel versiegelt (auf jedem Gerät der Person lesbar).
//   Anonym:  gesendet mit einem Token, das alle in der Runde aus K_round ableiten (kein Personen-Zugang);
//            Abholtoken, rk und Text liegen NUR im lokalen Speicher dieses Geräts.
import * as C from './crypto.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { validateEmail } from './model.js';

export const QUESTION_MAX = 700;
export const QUESTION_STORE = 'zw.anonQuestions.v1';
export const Q_AAD = {
  q: (r, id) => ['q', r, id],
  own: (r, id) => ['qown', r, id],
  a: (r, id) => ['qa', r, id],
  orgEmail: (r) => ['orgemail', r],
};

const chars = (s) => [...s].length;
const authP = (p) => `p.${p.pid}.${p.accessToken}`;
const authA = (a) => `a.${a.roundId}.${a.adminToken}`;

export async function organizerKeypair(kAdmin) {
  return C.keypairFromSecret(C.b64uEncode(await C.hkdf(C.b64uDecode(kAdmin), 'org-questions', 32)));
}

export async function anonToken(kRound) {
  return C.b64uEncode(await C.hkdf(C.b64uDecode(kRound), 'questions-anon', 16));
}

/** Prüft den Text einer Frage oder Antwort; gibt den bereinigten Text zurück oder wirft. */
export function validateQuestionText(text) {
  const v = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!v) throw new Error(t('Bitte etwas eintragen.'));
  if (chars(v) > QUESTION_MAX) throw new Error(t('Höchstens {n} Zeichen.', { n: QUESTION_MAX }));
  return v;
}

// ---------------------------------------------------------------- Organisator:in

export async function setQuestionMode(ctx, mode) {
  const body = { mode };
  if (mode >= 1) body.pub = (await organizerKeypair(ctx.kAdmin)).publicB64;
  if (mode === 2) body.anonHash = await C.tokenHash(await anonToken(ctx.kRound));
  return api('PUT', `/rounds/${ctx.roundId}/questions/settings`, { auth: authA(ctx), body });
}

/** Adresse der Organisator:in für Hinweise (2.10); leer = löschen. Anzeige-Kopie mit K_admin. */
export async function setOrganizerEmail(ctx, email) {
  const e = validateEmail(email);
  if (!e) return api('PUT', `/rounds/${ctx.roundId}/organizer-email`, { auth: authA(ctx), body: { email: null } });
  const emailViewCt = await C.encryptJson(ctx.kAdmin, e, Q_AAD.orgEmail(ctx.roundId));
  return api('PUT', `/rounds/${ctx.roundId}/organizer-email`, { auth: authA(ctx), body: { email: e, emailViewCt } });
}

export async function organizerEmail(ctx, round) {
  if (!round.orgEmailViewCt) return null;
  try {
    return await C.decryptJson(ctx.kAdmin, round.orgEmailViewCt, Q_AAD.orgEmail(ctx.roundId));
  } catch {
    return null;
  }
}

export async function loadAdminQuestions(ctx) {
  const kp = await organizerKeypair(ctx.kAdmin);
  const { questions } = await api('GET', `/rounds/${ctx.roundId}/questions`, { auth: authA(ctx) });
  const out = [];
  for (const q of questions) {
    try {
      const body = await C.openSealed(kp, q.qCt, Q_AAD.q(ctx.roundId, q.id));
      const answer = q.aCt ? (await C.decryptJson(body.rk, q.aCt, Q_AAD.a(ctx.roundId, q.id))).text : null;
      out.push({ id: q.id, pid: q.pid, anon: q.anon, text: String(body.text), rk: body.rk, answer, day: q.day, answerDay: q.answerDay });
    } catch {
      out.push({ id: q.id, pid: q.pid, anon: q.anon, text: null, rk: null, answer: null, day: q.day, answerDay: q.answerDay, broken: true });
    }
  }
  return out;
}

export async function answerQuestion(ctx, q, text) {
  const v = validateQuestionText(text);
  const aCt = await C.encryptJson(q.rk, { v: 1, text: v }, Q_AAD.a(ctx.roundId, q.id));
  return api('PUT', `/rounds/${ctx.roundId}/questions/${q.id}/answer`, { auth: authA(ctx), body: { aCt } });
}

export async function deleteQuestion(ctx, id) {
  return api('DELETE', `/rounds/${ctx.roundId}/questions/${id}`, { auth: authA(ctx) });
}

// ---------------------------------------------------------------- Teilnehmende

function loadStore(storage) {
  try {
    const v = JSON.parse(storage.getItem(QUESTION_STORE) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.token === 'string') : [];
  } catch {
    return [];
  }
}
function saveStore(list, storage) {
  try {
    storage.setItem(QUESTION_STORE, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Stellt eine Frage. anon nur, wenn die Runde das erlaubt (mode 2). Gibt { id, stored } zurück. */
export async function askQuestion(pctx, round, text, anon, storage = globalThis.localStorage) {
  const v = validateQuestionText(text);
  const mode = round.questions?.mode ?? 0;
  if (mode < 1 || !round.questions.pub) throw new Error(t('Rückfragen sind in dieser Runde nicht freigegeben.'));
  if (anon && mode !== 2) throw new Error(t('Anonyme Rückfragen sind in dieser Runde nicht freigegeben.'));
  const id = C.newId();
  const rk = C.newKey();
  const qCt = await C.sealTo(round.questions.pub, { v: 1, text: v, rk, anon: !!anon }, Q_AAD.q(round.id, id));
  if (!anon) {
    const me = await C.keypairFromSecret(pctx.secret);
    const ownCt = await C.sealTo(me.publicB64, { v: 1, text: v, rk }, Q_AAD.own(round.id, id));
    await api('POST', '/me/questions', { auth: authP(pctx), body: { id, qCt, ownCt } });
    return { id, stored: true };
  }
  const token = C.newId();
  await api('POST', '/questions/anon', { auth: `q.${round.id}.${await anonToken(pctx.kRound)}`, body: { id, qCt, threadHash: await C.tokenHash(token) } });
  const list = loadStore(storage);
  list.push({ roundId: round.id, pid: pctx.pid, id, token, rk, text: v, at: Math.floor(Date.now() / 1000) });
  return { id, stored: saveStore(list, storage) };
}

/** Eigene Fragen: mit Namen vom Server, anonyme aus dem lokalen Speicher (Antwort per Abholtoken). */
export async function loadMyQuestions(pctx, round, storage = globalThis.localStorage) {
  const out = [];
  const me = await C.keypairFromSecret(pctx.secret);
  const { questions } = await api('GET', '/me/questions', { auth: authP(pctx) });
  for (const q of questions) {
    try {
      const own = await C.openSealed(me, q.ownCt, Q_AAD.own(round.id, q.id));
      const answer = q.aCt ? (await C.decryptJson(own.rk, q.aCt, Q_AAD.a(round.id, q.id))).text : null;
      out.push({ id: q.id, anon: false, text: own.text, answer, day: q.day, answerDay: q.answerDay });
    } catch { /* unlesbar (z. B. neu eingeladen) – überspringen */ }
  }
  const list = loadStore(storage);
  const keep = [];
  for (const x of list) {
    if (x.roundId !== round.id || x.pid !== pctx.pid) { keep.push(x); continue; }
    try {
      const d = await api('GET', '/questions/thread', { auth: `k.${x.id}.${x.token}` });
      const answer = d.aCt ? (await C.decryptJson(x.rk, d.aCt, Q_AAD.a(round.id, x.id))).text : null;
      out.push({ id: x.id, anon: true, text: x.text, answer, day: d.day, answerDay: d.answerDay });
      keep.push(x);
    } catch (e) {
      if (e.status !== 404) { keep.push(x); out.push({ id: x.id, anon: true, text: x.text, answer: null, unavailable: true }); }
      // 404: von der Organisator:in gelöscht oder Runde gelöscht → lokal entfernen
    }
  }
  if (keep.length !== list.length) saveStore(keep, storage);
  return out.sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
}

/** Lokal gespeicherte anonyme Fragen einer Runde entfernen (z. B. wenn der Link vom Gerät entfernt wird). */
export function forgetAnonQuestions(roundId, storage = globalThis.localStorage) {
  saveStore(loadStore(storage).filter((x) => x.roundId !== roundId), storage);
}
