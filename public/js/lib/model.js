// ZeroWichtel – Fachlogik im Browser. Hier wird verschlüsselt, bevor irgendetwas den Server erreicht.

import * as C from './crypto.js';
import { api, linkBase } from './api.js';
import { buildLink, buildFragment } from './links.js';
import { draw as runDraw, verify as verifyDraw, drawTeams, isSingleCycle } from './draw.js';
import { normalizeAnalog, analogPrecheck, mergeExclusions } from './analog.js';
import { validateMix, readMix } from './mixtape.js';
import { normalizeRules, defaultRules } from './rules.js';
import { cleanUrl, cleanTextUrls } from './cleanurl.js';
import { openAnnouncements } from './announce.js';
import { t, lang as uiLang } from './i18n.js';

export const LIMITS = { title: 80, greeting: 2000, name: 40, budgetMax: 1000, hint: 300, hints: 5 };

/** AAD je Zweck – bindet jeden Chiffretext an Runde, Person und Feld. */
export const AAD = {
  meta: (r) => ['meta', r],
  admin: (r) => ['admin', r],
  name: (r, p) => ['name', r, p],
  invite: (r, p) => ['invite', r, p],
  recovery: () => ['recovery'],
  wish: (r, p) => ['wish', r, p],
  assign: (r, p) => ['assign', r, p],
  mailbox: (r, p) => ['mailbox', r, p],
  mbwish: (m) => ['mbwish', m],
  msg: (m, dir) => ['msg', m, dir],
  email: (r, p) => ['email', r, p],
  join: (r) => ['join', r],
  hint: (m, id) => ['hint', m, id],
  teams: (r) => ['teams', r],
  team: (r, p) => ['team', r, p],
  done: (r, p) => ['done', r, p],
  mix: (r) => ['mix', r],
};

export const TEAM_LIMITS = { name: 30, teams: 30, maxSize: 50 };

export const WISH_LIMITS = { items: 20, text: 2000, link: 500, noGo: 1000, message: 500, totalBytes: 24000, profile: 120, likes: 300 };

/** Steckbrief: alles optional. Schlüssel → [Bezeichnung, Höchstlänge]. */
export const PROFILE_FIELDS = {
  size: ['Kleidergröße', WISH_LIMITS.profile],
  shoe: ['Schuhgröße', WISH_LIMITS.profile],
  colors: ['Lieblingsfarben', WISH_LIMITS.profile],
  likes: ['Mag ich', WISH_LIMITS.likes],
  allergies: ['Allergien und Unverträglichkeiten', WISH_LIMITS.profile],
};

/**
 * Allergien und Unverträglichkeiten sind Gesundheitsdaten (Art. 9 DSGVO). Sie werden nur mit ausdrücklicher
 * Einwilligung gespeichert; der Nachweis (Zeitpunkt und Fassung des Einwilligungstextes) liegt verschlüsselt
 * in der Wunschliste selbst – der Server erfährt nicht einmal, ob es eine solche Angabe gibt.
 * Neue Textfassung → CONSENT_VERSION erhöhen.
 */
export const HEALTH_FIELDS = ['allergies'];
export const CONSENT_VERSION = 1;

/** Gültige Einwilligung für Gesundheitsangaben im Steckbrief? */
export function hasHealthConsent(profile) {
  const c = profile?.consent;
  return !!c && c.v === CONSENT_VERSION && Number.isFinite(c.at) && c.at > 0;
}

export const authA = (c) => `a.${c.roundId}.${c.adminToken}`;
export const authI = (c) => `i.${c.pid}.${c.inviteToken}`;
export const authP = (c) => `p.${c.pid}.${c.accessToken}`;

export function cleanText(s, max) {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function validateMeta(meta) {
  const title = cleanText(meta.title, LIMITS.title).replace(/\n/g, ' ');
  if (!title) throw new Error(t('Bitte einen Titel angeben.'));
  const greeting = cleanText(meta.greeting, LIMITS.greeting);
  let budget = meta.budget;
  if (budget === '' || budget === undefined) budget = null;
  if (budget !== null) {
    budget = Number(budget);
    if (!Number.isInteger(budget) || budget < 0 || budget > LIMITS.budgetMax) {
      throw new Error(t('Betragslimit bitte als ganze Zahl von 0 bis {max} €.', { max: LIMITS.budgetMax }));
    }
  }
  return { v: 1, title, greeting, budget, rules: meta.rules ? normalizeRules(meta.rules) : null };
}

export function validateName(name) {
  const n = cleanText(name, LIMITS.name).replace(/\n/g, ' ');
  if (!n) throw new Error(t('Bitte einen Namen angeben.'));
  return n;
}

// ------------------------------------------------------------------ Organisator:in

export async function checkOrganizerCode(code) {
  return api('POST', '/organizer/check', { body: { organizerCode: code } });
}

/** Legt eine Runde an. Gibt den Admin-Kontext zurück (alles Nötige für den Admin-Link). */
export async function createRound({ organizerCode, mode, meta, rsvpDeadline, wishDeadline, eventDate, emailEnabled = false, mailTitle = '', lang = uiLang() }) {
  const m = validateMeta({ ...meta, rules: mode === 'schrott' ? (meta.rules ?? defaultRules()) : null });
  const ctx = { roundId: C.newId(), adminToken: C.newId(), kRound: C.newKey(), kAdmin: C.newKey() };
  const body = {
    organizerCode: organizerCode || undefined,
    id: ctx.roundId,
    adminHash: await C.tokenHash(ctx.adminToken),
    mode,
    rsvpDeadline,
    wishDeadline: mode === 'wichteln' ? wishDeadline : null,
    eventDate,
    lang,
    metaCt: await C.encryptJson(ctx.kRound, m, AAD.meta(ctx.roundId)),
    adminCt: await C.encryptJson(ctx.kAdmin, { v: 1, groups: [], exclusions: [] }, AAD.admin(ctx.roundId)),
  };
  if (emailEnabled) {
    body.emailEnabled = true;
    const mt = cleanText(mailTitle, 80).replace(/\n/g, ' ');
    if (mt) body.mailTitle = mt;
  }
  await api('POST', '/rounds', { body });
  return ctx;
}

export function adminFragment(ctx) {
  return buildFragment('a', ctx);
}

export function adminLink(ctx) {
  return buildLink(linkBase(), 'a', ctx);
}

export async function loadAdmin(ctx) {
  const data = await api('GET', `/rounds/${ctx.roundId}/admin`, { auth: authA(ctx) });
  const r = data.round;
  const meta = await C.decryptJson(ctx.kRound, r.metaCt, AAD.meta(r.id));
  const admin = r.adminCt ? await C.decryptJson(ctx.kAdmin, r.adminCt, AAD.admin(r.id)) : { v: 1, groups: [], exclusions: [] };
  const participants = [];
  for (const p of data.participants) {
    const name = await C.decryptJson(ctx.kRound, p.nameCt, AAD.name(r.id, p.id));
    let inviteToken = null;
    if (p.inviteCt) {
      inviteToken = (await C.decryptJson(ctx.kAdmin, p.inviteCt, AAD.invite(r.id, p.id))).t;
    }
    const email = p.emailViewCt ? await C.decryptJson(ctx.kAdmin, p.emailViewCt, AAD.email(r.id, p.id)) : null;
    const team = p.teamCt ? (await C.decryptJson(ctx.kRound, p.teamCt, AAD.team(r.id, p.id))).team : null;
    participants.push({ ...p, name, inviteToken, email, team });
  }
  const teams = r.teamsCt ? (await C.decryptJson(ctx.kRound, r.teamsCt, AAD.teams(r.id))).teams : null;
  const join = r.join ? { ...r.join, token: (await C.decryptJson(ctx.kAdmin, r.join.ct, AAD.join(r.id))).t } : null;
  // Analoge Mitwichtelnde: nur Einträge zu Personen, die es (noch) gibt
  admin.analog = normalizeAnalog(admin.analog, participants.map((p) => p.id));
  return { round: r, meta, admin, participants, join, teams, maxParticipants: data.maxParticipants, emailAvailable: !!data.emailAvailable, albumAvailable: data.albumAvailable !== false,
    announcements: await openAnnouncements(ctx.kRound, r.id, data.announcements), announceMailToday: !!data.announceMailToday };
}

async function inviteFields(ctx, pid) {
  const inviteToken = C.newId();
  return {
    inviteToken,
    inviteHash: await C.tokenHash(inviteToken),
    inviteCt: await C.encryptJson(ctx.kAdmin, { t: inviteToken }, AAD.invite(ctx.roundId, pid)),
  };
}

export function validateEmail(email) {
  const e = String(email ?? '').trim();
  if (!e) return null;
  if (e.length > 254 || !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(e)) throw new Error(t('„{e}“ ist keine gültige E-Mail-Adresse.', { e }));
  return e;
}

async function emailFields(ctx, pid, email) {
  const e = validateEmail(email);
  if (!e) return {};
  return { email: e, emailViewCt: await C.encryptJson(ctx.kAdmin, e, AAD.email(ctx.roundId, pid)) };
}

export async function addPerson(ctx, name, email = null) {
  const n = validateName(name);
  const pid = C.newId();
  const inv = await inviteFields(ctx, pid);
  await api('POST', `/rounds/${ctx.roundId}/participants`, {
    auth: authA(ctx),
    body: {
      id: pid,
      inviteHash: inv.inviteHash,
      inviteCt: inv.inviteCt,
      nameCt: await C.encryptJson(ctx.kRound, n, AAD.name(ctx.roundId, pid)),
      ...(await emailFields(ctx, pid, email)),
    },
  });
  return { pid, name: n, inviteToken: inv.inviteToken };
}

/** Adresse setzen oder (mit leerem Wert) entfernen. */
export async function setPersonEmail(ctx, pid, email) {
  await api('PUT', `/rounds/${ctx.roundId}/participants/${pid}/email`, {
    auth: authA(ctx),
    body: { email: null, ...(await emailFields(ctx, pid, email)) },
  });
}

export async function mailInvite(ctx, pid, inviteToken) {
  return api('POST', '/mail/link', { auth: authA(ctx), body: { kind: 'invite', pid, link: inviteLink(ctx, pid, inviteToken) } });
}

/** Erinnerung per E-Mail an eine Person, die ihre Seite seit der Ziehung nicht geöffnet hat. */
export async function remindDraw(ctx, pid) {
  return api('POST', `/rounds/${ctx.roundId}/participants/${pid}/remind`, { auth: authA(ctx) });
}

/** Direktlink ohne Geheimnis – führt auf dem Gerät der Person zu ihrer Seite. */
export function jumpLink(pid) {
  return `${linkBase()}/#zu/${pid}`;
}

export async function mailAdminLink(ctx, email) {
  const e = validateEmail(email);
  if (!e) throw new Error(t('Bitte eine E-Mail-Adresse angeben.'));
  return api('POST', '/mail/link', { auth: authA(ctx), body: { kind: 'admin', link: adminLink(ctx), email: e } });
}

export async function renamePerson(ctx, pid, name) {
  const n = validateName(name);
  await api('PATCH', `/rounds/${ctx.roundId}/participants/${pid}`, {
    auth: authA(ctx),
    body: { nameCt: await C.encryptJson(ctx.kRound, n, AAD.name(ctx.roundId, pid)) },
  });
  return n;
}

export async function removePerson(ctx, pid) {
  await api('DELETE', `/rounds/${ctx.roundId}/participants/${pid}`, { auth: authA(ctx) });
}

export async function reinvitePerson(ctx, pid) {
  const inv = await inviteFields(ctx, pid);
  await api('POST', `/rounds/${ctx.roundId}/participants/${pid}/reinvite`, {
    auth: authA(ctx),
    body: { inviteHash: inv.inviteHash, inviteCt: inv.inviteCt },
  });
  return inv.inviteToken;
}

export function inviteLink(ctx, pid, inviteToken) {
  return buildLink(linkBase(), 'i', { roundId: ctx.roundId, pid, inviteToken, kRound: ctx.kRound });
}

export async function updateRound(ctx, { meta, rsvpDeadline, wishDeadline, eventDate, emailEnabled, mailTitle, lang } = {}) {
  const body = {};
  if (lang !== undefined) body.lang = lang;
  if (emailEnabled !== undefined) body.emailEnabled = !!emailEnabled;
  if (mailTitle !== undefined) body.mailTitle = cleanText(mailTitle, 80).replace(/\n/g, ' ') || null;
  if (meta) body.metaCt = await C.encryptJson(ctx.kRound, validateMeta(meta), AAD.meta(ctx.roundId));
  if (rsvpDeadline !== undefined) body.rsvpDeadline = rsvpDeadline;
  if (wishDeadline !== undefined && wishDeadline !== null) body.wishDeadline = wishDeadline;
  if (eventDate !== undefined) body.eventDate = eventDate;
  return api('PATCH', `/rounds/${ctx.roundId}`, { auth: authA(ctx), body });
}

export async function updateAdminData(ctx, adminData) {
  return api('PATCH', `/rounds/${ctx.roundId}`, {
    auth: authA(ctx),
    body: { adminCt: await C.encryptJson(ctx.kAdmin, adminData, AAD.admin(ctx.roundId)) },
  });
}

export async function deleteRound(ctx) {
  await api('DELETE', `/rounds/${ctx.roundId}`, { auth: authA(ctx) });
}

// ------------------------------------------------------------------ Gruppenlink (optional)

/**
 * Ein Link für alle: wer ihn hat, trägt sich selbst ein (bis zum Ablauf oder zur Höchstzahl).
 * Der Server kennt nur den Hash des Tokens; das Token selbst liegt mit K_admin verschlüsselt bei der Runde,
 * damit die Organisator:in den Link später erneut teilen kann.
 */
export async function setJoinLink(ctx, { until, max }) {
  const token = C.newId();
  await api('PUT', `/rounds/${ctx.roundId}/join`, {
    auth: authA(ctx),
    body: {
      joinHash: await C.tokenHash(token),
      joinCt: await C.encryptJson(ctx.kAdmin, { t: token }, AAD.join(ctx.roundId)),
      until,
      max,
    },
  });
  return token;
}

export async function deleteJoinLink(ctx) {
  await api('DELETE', `/rounds/${ctx.roundId}/join`, { auth: authA(ctx) });
}

export function joinLink(ctx, joinToken) {
  return buildLink(linkBase(), 'j', { roundId: ctx.roundId, joinToken, kRound: ctx.kRound });
}

export const authJ = (c) => `j.${c.roundId}.${c.joinToken}`;

export async function loadJoin(jctx) {
  const data = await api('GET', '/join', { auth: authJ(jctx) });
  const r = data.round;
  return { round: r, meta: await C.decryptJson(jctx.kRound, r.metaCt, AAD.meta(r.id)), free: data.free };
}

/** Selbst eintragen: wie Einladung annehmen und „dabei“ sagen in einem Schritt. */
export async function joinRound(jctx, name) {
  const n = validateName(name);
  const pctx = { roundId: jctx.roundId, pid: C.newId(), accessToken: C.newId(), kRound: jctx.kRound, secret: C.newKey() };
  const kp = await C.keypairFromSecret(pctx.secret);
  const rec = await recoveryFields(pctx);
  await api('POST', '/join', {
    auth: authJ(jctx),
    body: {
      id: pctx.pid,
      nameCt: await C.encryptJson(jctx.kRound, n, AAD.name(jctx.roundId, pctx.pid)),
      accessHash: await C.tokenHash(pctx.accessToken),
      pubkey: kp.publicB64,
      recoveryHash: rec.recoveryHash,
      recoveryCt: rec.recoveryCt,
    },
  });
  return { pctx, recoveryCode: rec.code, name: n };
}

// ------------------------------------------------------------------ Einladung und Teilnahme

export async function loadInvite(ctx) {
  const data = await api('GET', '/invite', { auth: authI(ctx) });
  const r = data.round;
  return {
    round: r,
    meta: await C.decryptJson(ctx.kRound, r.metaCt, AAD.meta(r.id)),
    name: await C.decryptJson(ctx.kRound, data.me.nameCt, AAD.name(r.id, data.me.id)),
  };
}

async function recoveryFields(pctx) {
  const rk = C.randomBytes(C.RECOVERY_BYTES);
  const rm = await C.recoveryMaterial(rk);
  const payload = { roundId: pctx.roundId, pid: pctx.pid, kRound: pctx.kRound, secret: pctx.secret };
  return {
    rk,
    code: C.encodeRecoveryCode(rk),
    recoveryHash: rm.authHash,
    recoveryCt: await C.encryptJson(rm.encKey, payload, AAD.recovery()),
  };
}

/**
 * Löst eine Einladung ein. Erzeugt im Browser das Personen-Geheimnis (kennt sonst niemand),
 * das Schlüsselpaar, das Zugangstoken und den Wiederherstellungscode.
 */
export async function claimInvite(ictx) {
  const pctx = {
    roundId: ictx.roundId,
    pid: ictx.pid,
    accessToken: C.newId(),
    kRound: ictx.kRound,
    secret: C.newKey(),
  };
  const kp = await C.keypairFromSecret(pctx.secret);
  const rec = await recoveryFields(pctx);
  await api('POST', '/invite/claim', {
    auth: authI(ictx),
    body: {
      accessHash: await C.tokenHash(pctx.accessToken),
      pubkey: kp.publicB64,
      recoveryHash: rec.recoveryHash,
      recoveryCt: rec.recoveryCt,
    },
  });
  return { pctx, recoveryCode: rec.code };
}

export function personFragment(pctx) {
  return buildFragment('p', pctx);
}

export function personLink(pctx) {
  return buildLink(linkBase(), 'p', pctx);
}

export function recoveryLink(code) {
  return `${linkBase()}/#wiederherstellen/${code.replace(/-/g, '')}`;
}

export async function loadMe(pctx) {
  const data = await api('GET', '/me', { auth: authP(pctx) });
  const r = data.round;
  return {
    round: r,
    meta: await C.decryptJson(pctx.kRound, r.metaCt, AAD.meta(r.id)),
    name: await C.decryptJson(pctx.kRound, data.me.nameCt, AAD.name(r.id, data.me.id)),
    me: data.me,
    counts: data.counts,
    giftDone: await readGiftDone(pctx, r.id, data.me),
    mix: await readMixes(pctx, r.id, data),
    announcements: await openAnnouncements(pctx.kRound, r.id, data.announcements),
    ...(await teamView(pctx, r, data)),
  };
}

/** Eigener Haken „Geschenk erledigt“ (2.8): verschlüsselt mit K_round, an die Person gebunden; nur sie bekommt ihn. */
async function readGiftDone(pctx, roundId, me) {
  if (!me.doneCt) return false;
  try {
    return (await C.decryptJson(pctx.kRound, me.doneCt, AAD.done(roundId, me.id))).gift === true;
  } catch {
    return false;
  }
}

/** Wichtel-Mixtape (2.11): eigener Eintrag und die der anderen (ohne Zuordnung). Unlesbares wird übersprungen. */
async function readMixes(pctx, roundId, data) {
  const open = async (ct) => {
    try { return readMix(await C.decryptJson(pctx.kRound, ct, AAD.mix(roundId))); } catch { return null; }
  };
  const own = data.me.mixCt ? await open(data.me.mixCt) : null;
  const others = [];
  for (const ct of data.mixCts ?? []) {
    const m = await open(ct);
    if (m?.songs.length) others.push(m);
  }
  return { own, others };
}

/** Eigene Lieder speichern; leer = Eintrag entfernen. by = eigener Name zum Aufdecken (ab der Bescherung). */
export async function saveMix(pctx, songs, by = null) {
  const mix = validateMix(songs, by);
  const mixCt = mix.songs.length ? await C.encryptJson(pctx.kRound, mix, AAD.mix(pctx.roundId)) : null;
  await api('PUT', '/me/mix', { auth: authP(pctx), body: { mixCt } });
  return mix;
}

export async function setGiftDone(pctx, done) {
  const doneCt = done ? await C.encryptJson(pctx.kRound, { v: 1, gift: true }, AAD.done(pctx.roundId, pctx.pid)) : null;
  return api('PUT', '/me/done', { auth: authP(pctx), body: { doneCt } });
}

/** Team-Wichteln aus Sicht einer Person: Teamliste, eigenes Team, Mitgliederzahl je Team (ohne Namen). */
async function teamView(pctx, r, data) {
  if (!r.teamsCt) return { teams: null, myTeam: null, teamCounts: {} };
  const teams = (await C.decryptJson(pctx.kRound, r.teamsCt, AAD.teams(r.id))).teams;
  const myTeam = data.me.teamCt ? (await C.decryptJson(pctx.kRound, data.me.teamCt, AAD.team(r.id, data.me.id))).team : null;
  const teamCounts = {};
  for (const x of data.teamCts ?? []) {
    try {
      const { team } = await C.decryptJson(pctx.kRound, x.teamCt, AAD.team(r.id, x.id));
      teamCounts[team] = (teamCounts[team] ?? 0) + 1;
    } catch { /* unlesbar: nicht mitzählen */ }
  }
  return { teams, myTeam, teamCounts };
}

/** Teamliste prüfen: Namen 1–30 Zeichen, eindeutig, optionale Höchstgröße 1–50. */
export function validateTeams(list) {
  const teams = (list ?? []).map((x) => {
    const name = cleanText(x.name, TEAM_LIMITS.name).replace(/\n/g, ' ');
    if (!name) throw new Error(t('Bitte jedem Team einen Namen geben.'));
    const max = x.max === '' || x.max === undefined || x.max === null ? null : Number(x.max);
    if (max !== null && (!Number.isInteger(max) || max < 1 || max > TEAM_LIMITS.maxSize)) {
      throw new Error(t('Höchstgröße bitte als ganze Zahl von 1 bis {max}.', { max: TEAM_LIMITS.maxSize }));
    }
    return { id: x.id || C.newId(), name, max };
  });
  if (teams.length > TEAM_LIMITS.teams) throw new Error(t('Höchstens {n} Teams.', { n: TEAM_LIMITS.teams }));
  const names = teams.map((x) => x.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error(t('Zwei Teams heißen gleich. Bitte unterschiedliche Namen wählen.'));
  return teams;
}

/** Team-Wichteln ein- (Teamliste) oder ausschalten (null). Ausschalten löscht alle Teamwahlen. */
export async function setTeams(ctx, list) {
  const teamsCt = list === null ? null : await C.encryptJson(ctx.kRound, { v: 1, teams: validateTeams(list) }, AAD.teams(ctx.roundId));
  return api('PATCH', `/rounds/${ctx.roundId}`, { auth: authA(ctx), body: { teamsCt } });
}

async function teamCt(kRound, roundId, pid, team) {
  return team ? C.encryptJson(kRound, { v: 1, team }, AAD.team(roundId, pid)) : null;
}

/** Organisator:in setzt das Team einer Person (null = ohne Team). */
export async function setPersonTeam(ctx, pid, team) {
  return api('PUT', `/rounds/${ctx.roundId}/participants/${pid}/team`, { auth: authA(ctx), body: { teamCt: await teamCt(ctx.kRound, ctx.roundId, pid, team) } });
}

/** Eigenes Team wählen (null = keins). */
export async function setOwnTeam(pctx, team) {
  return api('PUT', '/me/team', { auth: authP(pctx), body: { teamCt: await teamCt(pctx.kRound, pctx.roundId, pctx.pid, team) } });
}

export async function mailOwnLink(pctx) {
  return api('POST', '/mail/link', { auth: authP(pctx), body: { kind: 'personal', link: personLink(pctx) } });
}

export async function setNotify(pctx, notify) {
  return api('PUT', '/me/notify', { auth: authP(pctx), body: { notify: !!notify } });
}

export async function deleteOwnEmail(pctx) {
  return api('DELETE', '/me/email', { auth: authP(pctx) });
}

export async function setRsvp(pctx, rsvp) {
  return api('PUT', '/me/rsvp', { auth: authP(pctx), body: { rsvp } });
}

/** Erzeugt einen neuen Wiederherstellungscode; der alte wird ungültig. */
export async function renewRecovery(pctx) {
  const rec = await recoveryFields(pctx);
  await api('PUT', '/me/recovery', { auth: authP(pctx), body: { recoveryHash: rec.recoveryHash, recoveryCt: rec.recoveryCt } });
  return rec.code;
}

/** Stellt den persönlichen Zugang aus dem Wiederherstellungscode wieder her. */
export async function recoverFromCode(code) {
  const rk = C.decodeRecoveryCode(code);
  const rm = await C.recoveryMaterial(rk);
  const accessToken = C.newId();
  const data = await api('POST', '/recover', {
    body: { recoveryToken: rm.authToken, accessHash: await C.tokenHash(accessToken) },
  });
  const payload = await C.decryptJson(rm.encKey, data.recoveryCt, AAD.recovery());
  if (payload.roundId !== data.roundId || payload.pid !== data.pid) throw new Error(t('Wiederherstellungsdaten passen nicht zusammen.'));
  return { roundId: payload.roundId, pid: payload.pid, accessToken, kRound: payload.kRound, secret: payload.secret };
}

// ------------------------------------------------------------------ Meilenstein 2: Ziehung


export async function loadKeys(ctx) {
  return (await api('GET', `/rounds/${ctx.roundId}/keys`, { auth: authA(ctx) })).keys;
}

export const tokenAuth = (role, box) => `${role}.${box.mid}.${box.t}`;

/**
 * Ziehung im Browser der Organisator:in.
 * Pro Paar entstehen ein Paarschlüssel M und ein Postfach mit getrennten Tokens für Wichtel (g) und Beschenkte:n (r).
 * Wichtel erhält {Empfänger, Name, M, Postfach, g-Token}, Beschenkte:r nur {M, Postfach, r-Token} –
 * jeweils an den eigenen öffentlichen Schlüssel versiegelt. Danach wird alles im Speicher verworfen.
 */
export async function performDraw(ctx, adminData, names) {
  const keys = await loadKeys(ctx);
  const ids = keys.map((k) => k.id);
  const pub = Object.fromEntries(keys.map((k) => [k.id, k.pubkey]));
  const groups = (adminData.groups || []).map((g) => ({ ...g, members: g.members.filter((m) => pub[m]) }));
  // Analoge Mitwichtelnde: Grenze und Helfer-Regeln prüfen; Paare analog ↔ Helfer:in immer ausschließen,
  // auch wenn sie (etwa nach Bearbeitung mit einer älteren App-Version) in der Ausschlussliste fehlen.
  const analog = adminData.analog || [];
  const pre = analogPrecheck(analog, ids, names);
  if (!pre.ok) throw new Error(pre.reason);
  const exclusions = mergeExclusions(adminData.exclusions, analog).filter(([a, b]) => pub[a] && pub[b]);
  const result = runDraw(ids, groups, exclusions, { names });
  if (!verifyDraw(ids, result.pairs, groups, exclusions)) throw new Error(t('Interner Fehler bei der Ziehung.'));

  const participants = [];
  const mailboxes = [];
  for (const [g, r] of result.pairs) {
    const m = C.newKey();
    const mid = C.newId();
    const gTok = C.newId();
    const rTok = C.newId();
    mailboxes.push({ id: mid, giverHash: await C.tokenHash(gTok), receiverHash: await C.tokenHash(rTok) });
    participants.push({
      id: g,
      assignmentCt: await C.sealTo(pub[g], { v: 1, receiver: r, name: names[r] ?? '', m, mid, t: gTok }, AAD.assign(ctx.roundId, g)),
      _mk: { r, ct: await C.sealTo(pub[r], { v: 1, m, mid, t: rTok }, AAD.mailbox(ctx.roundId, r)) },
    });
  }
  const mkByReceiver = Object.fromEntries(participants.map((p) => [p._mk.r, p._mk.ct]));
  const body = {
    participants: participants
      .map((p) => ({ id: p.id, assignmentCt: p.assignmentCt, mailboxkeyCt: mkByReceiver[p.id] }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    // sortiert nach zufälliger ID: Reihenfolge verrät keine Zuordnung
    mailboxes: mailboxes.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  result.pairs.length = 0;
  await api('PUT', `/rounds/${ctx.roundId}/draw`, { auth: authA(ctx), body });
  return { form: result.form, count: ids.length };
}

/**
 * Team-Wichteln: Kreis zwischen Teams. Je Team-Paar ein Postfach; alle Mitglieder des schenkenden Teams erhalten
 * den Wichtel-Zugang, alle Mitglieder des beschenkten Teams den Beschenkten-Zugang – jeweils für sich versiegelt.
 * @param {{teams:{id,name}[], participants:{id,name,team}[]}} data  aus loadAdmin
 */
export async function performTeamDraw(ctx, data) {
  if ((data.admin?.analog || []).length) throw new Error(t('Analoge Mitwichtelnde gibt es nur beim Wichteln Person für Person, nicht beim Team-Wichteln.'));
  const keys = await loadKeys(ctx);
  const pub = Object.fromEntries(keys.map((k) => [k.id, k.pubkey]));
  const people = data.participants.filter((p) => pub[p.id]);
  const teamById = Object.fromEntries(data.teams.map((x) => [x.id, x]));
  if (people.some((p) => !teamById[p.team])) throw new Error(t('Noch nicht alle Zusagenden sind in einem Team.'));
  const members = (id) => people.filter((p) => p.team === id);
  const active = data.teams.filter((x) => members(x.id).length > 0).map((x) => x.id);
  const result = drawTeams(active);
  if (!(result.pairs.length === active.length && isSingleCycle(result.pairs) && result.pairs.every(([g, r]) => g !== r))) {
    throw new Error(t('Interner Fehler bei der Ziehung.'));
  }
  const teamInfo = (id) => ({ id, name: teamById[id].name, members: members(id).map((p) => p.name) });
  const assign = {};
  const mk = {};
  const mailboxes = [];
  for (const [g, r] of result.pairs) {
    const m = C.newKey();
    const mid = C.newId();
    const gTok = C.newId();
    const rTok = C.newId();
    mailboxes.push({ id: mid, giverHash: await C.tokenHash(gTok), receiverHash: await C.tokenHash(rTok) });
    const giverTeam = teamInfo(g);
    const receiverTeam = teamInfo(r);
    for (const p of members(g)) {
      // receiver/name zusätzlich wie v1: eine noch zwischengespeicherte ältere App zeigt so wenigstens den Teamnamen
      assign[p.id] = await C.sealTo(pub[p.id], { v: 2, kind: 'team', team: giverTeam, receiverTeam, receiver: r, name: receiverTeam.name, m, mid, t: gTok }, AAD.assign(ctx.roundId, p.id));
    }
    for (const p of members(r)) mk[p.id] = await C.sealTo(pub[p.id], { v: 1, team: true, m, mid, t: rTok }, AAD.mailbox(ctx.roundId, p.id));
  }
  const body = {
    kind: 'team',
    participants: people.map((p) => ({ id: p.id, assignmentCt: assign[p.id], mailboxkeyCt: mk[p.id] })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    mailboxes: mailboxes.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  result.pairs.length = 0;
  await api('PUT', `/rounds/${ctx.roundId}/draw`, { auth: authA(ctx), body });
  return { form: result.form, count: people.length, teams: active.length };
}

/** Entschlüsselt, wen ich beschenke (giving) und mein eigenes Postfach als Beschenkte:r (receiving). */
export async function openDraw(pctx, me) {
  if (!me.assignmentCt || !me.mailboxkeyCt) return null;
  const kp = await C.keypairFromSecret(pctx.secret);
  const a = await C.openSealed(kp, me.assignmentCt, AAD.assign(pctx.roundId, pctx.pid));
  const b = await C.openSealed(kp, me.mailboxkeyCt, AAD.mailbox(pctx.roundId, pctx.pid));
  if (a.v === 2 && a.kind === 'team') {
    return {
      team: true,
      myTeam: a.team,
      receiverTeam: a.receiverTeam,
      giving: { receiverId: a.receiverTeam.id, name: a.receiverTeam.name, m: a.m, mid: a.mid, t: a.t },
      receiving: { m: b.m, mid: b.mid, t: b.t },
    };
  }
  return {
    team: false,
    giving: { receiverId: a.receiver, name: a.name, m: a.m, mid: a.mid, t: a.t },
    receiving: { m: b.m, mid: b.mid, t: b.t },
  };
}

// ------------------------------------------------------------------ Wünsche

async function selfKey(pctx) {
  return C.hkdf(C.b64uDecode(pctx.secret), 'self-wish', 32);
}

export function emptyWish() {
  return { v: 1, noIdea: false, items: [], noGo: '', profile: {}, updatedAt: 0 };
}

/** Steckbrief bereinigen; leere Felder entfallen. */
export function cleanProfile(p) {
  const out = {};
  for (const [k, [, max]] of Object.entries(PROFILE_FIELDS)) {
    const v = cleanText(p?.[k], max).replace(/\n/g, ' ');
    if (v) out[k] = v;
  }
  const health = HEALTH_FIELDS.some((k) => out[k]);
  if (health) {
    if (!hasHealthConsent(p)) throw new Error(t('Für die Angabe zu Allergien und Unverträglichkeiten brauchen wir deine ausdrückliche Einwilligung. Setz das Häkchen oder lass das Feld leer.'));
    out.consent = { v: CONSENT_VERSION, at: p.consent.at };
  }
  return out;
}

/** Für die Anzeige beim Wichtel: Gesundheitsangaben nur mit gültiger Einwilligung. */
export function visibleProfile(p) {
  if (!p) return {};
  const out = { ...p };
  delete out.consent;
  if (!hasHealthConsent(p)) for (const k of HEALTH_FIELDS) delete out[k];
  return out;
}

/** Wunschliste ohne Gesundheitsangaben und ohne Einwilligung (Widerruf). */
export function withoutHealthData(w) {
  const out = structuredClone(w ?? emptyWish());
  out.profile = { ...(out.profile ?? {}) };
  for (const k of HEALTH_FIELDS) delete out.profile[k];
  delete out.profile.consent;
  out.updatedAt = Date.now();
  return out;
}

/**
 * Prüft und bereinigt eine Wunschliste. Tracking-Parameter in Links werden entfernt;
 * stats.removed zählt, wie viele (für die Rückmeldung an die Person).
 */
export function validateWish(w, stats = {}) {
  stats.removed = 0;
  const items = (w.items || [])
    .map((it) => {
      const cleaned = cleanTextUrls(cleanText(it.text, WISH_LIMITS.text));
      stats.removed += cleaned.removed;
      const text = cleaned.text.slice(0, WISH_LIMITS.text);
      let link = cleanText(it.link, WISH_LIMITS.link).replace(/\s/g, '');
      if (link) {
        let u;
        try { u = new URL(link); } catch { throw new Error(t('Der Link „{link}“ ist ungültig.', { link: link.slice(0, 40) })); }
        if (u.protocol !== 'https:') throw new Error(t('Links müssen mit https:// beginnen.'));
        const c = cleanUrl(u.href);
        stats.removed += c.removed;
        link = c.url;
      }
      return { text, link };
    })
    .filter((it) => it.text || it.link);
  if (items.length > WISH_LIMITS.items) throw new Error(t('Höchstens {n} Wünsche.', { n: WISH_LIMITS.items }));
  const noGo = cleanTextUrls(cleanText(w.noGo, WISH_LIMITS.noGo));
  stats.removed += noGo.removed;
  const out = {
    v: 1,
    noIdea: !!w.noIdea,
    items: w.noIdea ? [] : items,
    noGo: noGo.text,
    profile: cleanProfile(w.profile),
    updatedAt: Date.now(),
  };
  // Gesamtgröße begrenzen, damit der Chiffretext sicher unter dem Server-Limit bleibt
  if (new TextEncoder().encode(JSON.stringify(out)).length > WISH_LIMITS.totalBytes) {
    throw new Error(t('Die Wunschliste ist insgesamt zu lang. Bitte kürzen oder Wünsche zusammenfassen.'));
  }
  return out;
}

export async function loadOwnWish(pctx, me) {
  if (!me.wishCt) return null;
  return C.decryptJson(await selfKey(pctx), me.wishCt, AAD.wish(pctx.roundId, pctx.pid));
}

/** frozenAt: undefined = Festlegung unverändert, Zahl = festlegen (Zeitpunkt der eigenen Festlegung), null = aufheben. */
async function pushWishToMailbox(receiving, wish, frozenAt = undefined) {
  const body = { wishCt: await C.encryptJson(receiving.m, wish, AAD.mbwish(receiving.mid)) };
  if (frozenAt !== undefined) body.frozenAt = frozenAt;
  await api('PUT', '/mailbox/wish', { auth: tokenAuth('r', receiving), body });
}

/** Bitte an die Organisator:in, festgelegte Wünsche wieder freizugeben (2.11). */
export async function requestWishUnlock(pctx) {
  return api('POST', '/me/wishes/unlock-request', { auth: authP(pctx), body: {} });
}

/** Organisator:in hebt die Festlegung einer Person auf (2.11). */
export async function unfreezeWishes(ctx, pid) {
  return api('POST', `/rounds/${ctx.roundId}/participants/${pid}/unfreeze`, { auth: authA(ctx), body: {} });
}

/** Speichert die eigene Wunschliste; nach der Ziehung zusätzlich für den Wichtel im Postfach. */
export async function saveOwnWish(pctx, wish, receiving, stats = {}, { freeze = false, frozenAt = null } = {}) {
  const w = validateWish(wish, stats);
  const body = { wishCt: await C.encryptJson(await selfKey(pctx), w, AAD.wish(pctx.roundId, pctx.pid)) };
  if (freeze) body.freeze = true;
  await api('PUT', '/me/wishes', { auth: authP(pctx), body });
  // Festlegen (2.11): auch die Kopie beim Wichtel als festgelegt markieren
  if (receiving) await pushWishToMailbox(receiving, w, freeze || frozenAt ? (frozenAt ?? Math.floor(Date.now() / 1000)) : undefined);
  return w;
}

/**
 * Widerruf der Einwilligung (Art. 7 Abs. 3 DSGVO): Gesundheitsangaben sofort aus der eigenen Wunschliste und
 * aus der Kopie für den Wichtel entfernen – auch nach der Wunschfrist (der Server lässt dafür „withdraw“ zu).
 */
export async function withdrawHealthConsent(pctx, own, receiving) {
  const w = withoutHealthData(own);
  await api('PUT', '/me/wishes', {
    auth: authP(pctx),
    body: { withdraw: true, wishCt: await C.encryptJson(await selfKey(pctx), w, AAD.wish(pctx.roundId, pctx.pid)) },
  });
  if (receiving) {
    await api('PUT', '/mailbox/wish', {
      auth: tokenAuth('r', receiving),
      body: { withdraw: true, wishCt: await C.encryptJson(receiving.m, w, AAD.mbwish(receiving.mid)) },
    });
  }
  return w;
}

/** Team-Wunschzettel: wie eine Wunschliste, Steckbrief nur mit Farben und „Mag ich“ – keine Gesundheitsangaben. */
export const TEAM_PROFILE_FIELDS = ['colors', 'likes'];

export function validateTeamWish(w, by, stats = {}) {
  const profile = Object.fromEntries(TEAM_PROFILE_FIELDS.filter((k) => w.profile?.[k]).map((k) => [k, w.profile[k]]));
  const out = validateWish({ ...w, profile }, stats);
  out.team = true;
  out.by = cleanText(by, LIMITS.name).replace(/\n/g, ' ');
  return out;
}

/**
 * Gemeinsamen Team-Wunschzettel speichern. rev = zuletzt gesehener Stand; hat inzwischen jemand anderes
 * gespeichert, wirft der Server 409 (code „conflict“). Gibt den neuen Stand zurück.
 */
export async function saveTeamWish(receiving, wish, rev, by, stats = {}) {
  const w = validateTeamWish(wish, by, stats);
  await api('PUT', '/mailbox/wish', {
    auth: tokenAuth('r', receiving),
    body: { rev, wishCt: await C.encryptJson(receiving.m, w, AAD.mbwish(receiving.mid)) },
  });
  return { wish: w, rev: rev + 1 };
}

/** Arten von Wichtelpost: normale Nachricht, Tipp (wer war's?), Auflösung des Wichtels, Dankeschön. */
export const MSG_KINDS = ['msg', 'guess', 'reveal', 'thanks'];

/** Nachrichten bis 2.2 sind reine Texte; ab 2.3 optional {k, text}. */
function normalizeMessage(body) {
  if (typeof body === 'string') return { kind: 'msg', text: body };
  const kind = MSG_KINDS.includes(body?.k) ? body.k : 'msg';
  return { kind, text: typeof body?.text === 'string' ? body.text : '' };
}

export async function loadMailbox(box, role) {
  const d = await api('GET', '/mailbox', { auth: tokenAuth(role, box) });
  const wish = d.wishCt ? await C.decryptJson(box.m, d.wishCt, AAD.mbwish(box.mid)) : null;
  const messages = [];
  for (const msg of d.messages) {
    messages.push({ ...msg, ...normalizeMessage(await C.decryptJson(box.m, msg.bodyCt, AAD.msg(box.mid, msg.direction))) });
  }
  const hints = [];
  for (const x of d.hints ?? []) {
    hints.push({ id: x.id, releaseAt: x.releaseAt, text: await C.decryptJson(box.m, x.bodyCt, AAD.hint(box.mid, x.id)) });
  }
  return { wish, wishRev: d.wishRev ?? 0, wishFrozenAt: d.wishFrozenAt ?? null, messages, hints, hintsPending: d.hintsPending ?? 0, nextHintAt: d.nextHintAt ?? null, openUntil: d.openUntil ?? null };
}

/**
 * Nach der Ziehung: eigene Wünsche ins Postfach übertragen, falls dort noch nicht aktuell.
 * Gibt true zurück, wenn übertragen wurde.
 */
export async function syncWishToMailbox(own, receiving, mailbox, frozenAt = null) {
  const target = own ?? { ...emptyWish(), updatedAt: -1 };
  // Festlegung (2.11): eigene Festlegung an die Kopie beim Wichtel weitergeben – oder deren Aufhebung
  const freezeChange = (frozenAt !== null) !== (mailbox.wishFrozenAt !== null && mailbox.wishFrozenAt !== undefined);
  if (mailbox.wish && mailbox.wish.updatedAt === target.updatedAt && !freezeChange) return false;
  try {
    await pushWishToMailbox(receiving, target, freezeChange ? frozenAt : undefined);
    return true;
  } catch (e) {
    if (e.status === 409) return false; // nach Frist bereits übertragen
    throw e;
  }
}

/**
 * Wichtelpost schreiben. kind: 'msg' (normal), 'guess' und 'thanks' (nur Beschenkte:r), 'reveal' (nur Wichtel).
 * Normale Nachrichten bleiben reine Texte (lesbar auch für ältere Versionen).
 */
export async function sendMessage(box, role, text, kind = 'msg') {
  const body = cleanText(text, WISH_LIMITS.message);
  if (!body) throw new Error(t('Bitte eine Nachricht eingeben.'));
  if (!MSG_KINDS.includes(kind) || (kind === 'reveal' && role !== 'g') || ((kind === 'guess' || kind === 'thanks') && role !== 'r')) {
    throw new Error(t('Diese Nachricht passt nicht zu deiner Rolle.'));
  }
  const direction = role === 'g' ? 'frage' : 'antwort';
  const payload = kind === 'msg' ? body : { k: kind, text: body };
  await api('POST', '/mailbox/messages', {
    auth: tokenAuth(role, box),
    body: { bodyCt: await C.encryptJson(box.m, payload, AAD.msg(box.mid, direction)) },
  });
}

// ------------------------------------------------------------------ Rätselhinweise

/** Hinweis des Wichtels, für die beschenkte Person ab releaseAt sichtbar (der Server liefert ihn vorher nicht aus). */
export async function addHint(box, text, releaseAt) {
  const body = cleanText(text, LIMITS.hint);
  if (!body) throw new Error(t('Bitte einen Hinweis eingeben.'));
  const id = C.newId();
  await api('POST', '/mailbox/hints', {
    auth: tokenAuth('g', box),
    body: { id, releaseAt, bodyCt: await C.encryptJson(box.m, body, AAD.hint(box.mid, id)) },
  });
  return id;
}

export async function deleteHint(box, id) {
  await api('DELETE', `/mailbox/hints/${id}`, { auth: tokenAuth('g', box) });
}
