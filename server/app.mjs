// HTTP-API. Der Server sieht nur Chiffretexte, Token-Hashes, Status und Fristen.
//
// Authentifizierung über den Header X-ZW-Auth:
//   a.<rundenId>.<adminToken>    Organisator:in
//   i.<personId>.<einladeToken>  Einladung (nur Lesen und Einlösen)
//   p.<personId>.<zugangsToken>  Teilnehmende:r
//   g./r.<postfachId>.<token>    Wichtelpost als Wichtel (g) bzw. Beschenkte:r (r)
//   x.<sitzungsId>.<token>       Admin-Bereich (nur unter /admin/<geheimer Pfad>/…)
//   q.<rundenId>.<anonToken>     anonyme Rückfrage stellen (Token aus K_round abgeleitet, für alle in der Runde gleich)
//   k.<frageId>.<token>          Antwort auf die eigene anonyme Rückfrage abholen
//
// Jeder Handler liefert { status, data } (data = null → 204 ohne Inhalt) oder wirft einen HttpError.
import { Admin } from './admin.mjs';
import { checkCode, consumeCode } from './codes.mjs';
import { openSettings, openStatus, openUsage, saveOpenSettings, describeOpen, OPEN_MAX } from './open-creation.mjs';
import { donationSettings, saveDonation, publicDonation, describeDonation, DonationError } from './donation.mjs';
import { ideasSettings, saveIdeas, publicIdeas, describeIdeas, IdeasError } from './ideas.mjs';
import { albumLimits, saveAlbumLimits, resetAlbumLimits, describeAlbumLimits, AlbumLimitsError } from './album-limits.mjs';
import { countAnalog } from './stats.mjs';
import { maybeCleanup, shred } from './cleanup.mjs';
import crypto from 'node:crypto';
import { ServerCrypto, safeEqual, sha256 } from './crypto.mjs';
import { all, isUnique, one, run, tx, value } from './db.mjs';
import * as Texts from './mail/texts.mjs';
import { Notifier } from './notifier.mjs';
import { RateLimiter } from './ratelimit.mjs';
import { HttpError, V, chars, fail, get, has, isArr, phpTrim } from './validate.mjs';
import { validEmail } from './email.mjs';

export const VERSION = '2.13.2';
const DAY = 86400;
const DELETE_AFTER_EVENT = 14 * DAY;
const MAX_FUTURE = 366 * DAY;
// Höchstlängen der Chiffretexte (Base64url-Zeichen)
const L = { META: 24000, ADMIN: 60000, NAME: 600, INVITE: 600, RECOVERY: 1200, SEALED: 2000, ASSIGN: 12000, WISH: 40000, MESSAGE: 3000, EMAIL_VIEW: 1200, JOIN: 600, HINT: 2000, TEAMS: 8000, TEAM: 400, DONE: 400, MIX: 4000, PHOTO_META: 2400, QUESTION: 6000, OWN: 6000, ANSWER: 6000 };
// Rückfragen: 700 Zeichen Text (bis 2100 Byte UTF-8) plus Schlüssel und Rahmen, Base64 → großzügig 6000
const Q_PER_DAY = 3;         // je Person (mit Namen) bzw. je Anschluss (anonym) und Tag
const Q_ANON_ROUND_DAY = 20;  // anonyme Fragen je Runde und Tag insgesamt
const Q_OPEN_MAX = 30;
const FREEZE_GRACE = DAY;      // nach dem Festlegen der Wünsche: 24 h für Korrekturen (2.11)        // gespeicherte Fragen je Person bzw. anonym je Runde
// ASSIGN: Team-Zuordnung enthält die Namen beider Teams. Gemessen: 50 Personen mit 40 Zeichen à 3 Byte = 9053 Zeichen.
const MAX_MESSAGES = 100;
const MAX_HINTS = 5;
// Wichtelpost bleibt nach dem Wichteldatum eine Woche offen: Dankeschön, „Errate deinen Wichtel“, Auflösung
const POST_EVENT = 7 * DAY;
// Adventsalbum (2.13): Foto und Vorschau als rohe Chiffretext-Bytes (12 Byte IV + Daten + 16 Byte Tag)
const PHOTO_MAX = 600 * 1024 + 28;
const THUMB_MAX = 48 * 1024 + 28;
const CT_RE = /^v1\.[A-Za-z0-9_-]+$/;

/** Chiffretext „v1.<base64url>“ → Bytes, mit Höchstgröße (nach dem Dekodieren). */
function photoBytes(b, f, max) {
  const v = get(b, f);
  if (typeof v !== 'string') fail(f);
  if (v.length > Math.ceil((max * 4) / 3) + 8) fail(f, 'ist zu groß');
  if (!CT_RE.test(v)) fail(f);
  const raw = Buffer.from(v.slice(3), 'base64url');
  if (raw.length < 12 + 16 + 1 || raw.length > max) fail(f, raw.length > max ? 'ist zu groß' : 'ungültig');
  return raw;
}
const LANGS = ['de', 'en'];
const MAIL_TITLE_MAX = 80;

const json = (data, status = 200) => ({ status, data });
const noContent = () => ({ status: 204, data: null });
const notFound = () => { throw new HttpError(404, 'not_found', 'Nicht gefunden oder Link ungültig.'); };
// Zugangsdaten einer Person oder eines Postfachs passen nicht (mehr): neu eingeladen, Zugang auf einem anderen Gerät
// wiederhergestellt, neu ausgelost oder Runde gelöscht. Eigener Code, damit die App das von „Foto gibt es nicht“ unterscheidet.
const invalidLink = () => { throw new HttpError(404, 'invalid_link', 'Nicht gefunden oder Link ungültig.'); };
const noMailer = () => new HttpError(409, 'email_unavailable', 'Auf diesem Server ist kein E-Mail-Versand eingerichtet.');

const STATUS_MSG = { gezogen: 'Die Ziehung ist bereits erfolgt.', beendet: 'Die Runde ist beendet.' };
function requireStatus(round, ...allowed) {
  if (!allowed.includes(round.status)) throw new HttpError(409, 'wrong_status', STATUS_MSG[round.status] ?? 'In diesem Status nicht möglich.');
}

function roundPublic(r) {
  return {
    id: r.id,
    mode: r.mode,
    status: r.status,
    emailEnabled: Boolean(r.email_enabled),
    rsvpDeadline: r.rsvp_deadline,
    wishDeadline: r.wish_deadline,
    eventDate: r.event_date,
    deleteAfter: r.delete_after,
    drawnAt: r.drawn_at,
    metaCt: r.meta_ct,
    teamsCt: r.teams_ct ?? null,
    lang: r.lang,
    // Rückfragen (2.9): Modus und öffentlicher Schlüssel der Organisator:in
    questions: { mode: r.q_mode ?? 0, pub: r.q_mode ? r.q_pub : null },
    // Adventsalbum (2.13)
    album: { enabled: Boolean(r.album_mode), pdf: Boolean(r.album_pdf) },
  };
}

function validateDates(mode, rsvp, wish, event, now, strictFuture) {
  const err = (msg) => new HttpError(400, 'dates', msg);
  if (event > now + MAX_FUTURE) throw err('Das Wichteldatum darf höchstens ein Jahr in der Zukunft liegen.');
  if (strictFuture && rsvp <= now) throw err('Die Antwortfrist muss in der Zukunft liegen.');
  if (rsvp >= event) throw err('Die Antwortfrist muss vor dem Wichteldatum liegen.');
  if (mode === 'wichteln') {
    if (wish === null) throw err('Beim Wichteln ist eine Wunschfrist nötig.');
    if (!(rsvp < wish && wish < event)) throw err('Reihenfolge nötig: Antwortfrist < Wunschfrist < Wichteldatum.');
  }
}

/** Laufende Benachrichtigungen je Datenbank. */
const notifying = new Map();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/#]/g, '\\$&');

export class App {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {object} config  normalisierte Konfiguration (config.mjs)
   * @param {{clock?: () => number, mailer?: object|null}} opts
   */
  constructor(db, config, { clock = () => Math.floor(Date.now() / 1000), mailer = null } = {}) {
    Object.assign(this, { db, config, clock, mailer });
    this.limiter = new RateLimiter(db, config.server_key_raw, config.rate_limits);
    this.sc = new ServerCrypto(config.server_key_raw, 'email');
    this.admin = new Admin(db, config.server_key_raw);
    this.baseUrl = String(config.base_url ?? '').replace(/\/+$/, '');
    this.notifier = mailer ? new Notifier(db, mailer, this.sc, this.baseUrl) : null;
    this.routes = this.#routes();
  }

  now() { return this.clock(); }

  /**
   * Aufräumen und Benachrichtigen, höchstens alle 10 Minuten. Die Mails gehen im Hintergrund raus;
   * ein zweiter Lauf startet erst, wenn der vorige fertig ist (auch über einen Konfigurationswechsel hinweg).
   */
  housekeeping(now = this.now(), limit = 200) {
    if (!maybeCleanup(this.db, now) || !this.notifier || notifying.has(this.db)) return;
    notifying.set(this.db, this.notifier.run(now, limit)
      .catch((e) => console.error(`ZeroWichtel: ${e.message}`))
      .finally(() => notifying.delete(this.db)));
  }

  /** @param {{method:string, path:string, body:object, auth:?string, ip:string}} req */
  async handle(req) {
    try {
      if (this.config.lazy_cleanup) this.housekeeping(this.now(), 50);
      return await this.#route(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(`ZeroWichtel: ${e?.stack ?? e}`);
      return json({ error: 'server', message: 'Interner Fehler.' }, 500);
    }
  }

  #routes() {
    const ID = '([A-Za-z0-9_-]{22})';
    const r = (method, path, fn) => [method, new RegExp(`^${path.replaceAll(':id', ID)}$`), fn];
    return [
      r('GET', '/info', () => this.info()),
      r('GET', '/ideas', () => json(publicIdeas(this.db))),
      // Adventsalbum (2.13)
      r('PUT', '/rounds/:id/album', (q, id) => this.albumSettings(q, id)),
      r('GET', '/rounds/:id/photos', (q, id) => this.adminPhotos(q, id)),
      r('GET', '/rounds/:id/photos/:id', (q, id, fid) => this.adminPhoto(q, id, fid)),
      r('DELETE', '/rounds/:id/photos/:id', (q, id, fid) => this.adminDeletePhoto(q, id, fid)),
      r('GET', '/me/photos', (q) => this.myPhotos(q)),
      r('POST', '/me/photos', (q) => this.uploadPhoto(q)),
      r('GET', '/me/photos/:id', (q, fid) => this.myPhoto(q, fid)),
      r('DELETE', '/me/photos/:id', (q, fid) => this.deleteMyPhoto(q, fid)),
      r('POST', '/organizer/check', (q) => this.organizerCheck(q)),
      r('POST', '/rounds', (q) => this.createRound(q)),
      r('GET', '/rounds/:id/admin', (q, id) => this.adminView(q, id)),
      r('PATCH', '/rounds/:id', (q, id) => this.updateRound(q, id)),
      r('DELETE', '/rounds/:id', (q, id) => this.deleteRound(q, id)),
      r('POST', '/rounds/:id/participants', (q, id) => this.addParticipant(q, id)),
      r('PATCH', '/rounds/:id/participants/:id', (q, id, pid) => this.renameParticipant(q, id, pid)),
      r('DELETE', '/rounds/:id/participants/:id', (q, id, pid) => this.removeParticipant(q, id, pid)),
      r('POST', '/rounds/:id/participants/:id/reinvite', (q, id, pid) => this.reinvite(q, id, pid)),
      r('POST', '/rounds/:id/participants/:id/remind', (q, id, pid) => this.remindDraw(q, id, pid)),
      r('GET', '/rounds/:id/keys', (q, id) => this.publicKeys(q, id)),
      r('PUT', '/rounds/:id/draw', (q, id) => this.saveDraw(q, id)),
      r('PUT', '/me/wishes', (q) => this.saveWishes(q)),
      r('POST', '/me/wishes/unlock-request', (q) => this.requestUnlock(q)),
      r('POST', '/rounds/:id/participants/:id/unfreeze', (q, id, pid) => this.unfreezeWishes(q, id, pid)),
      r('PUT', '/me/team', (q) => this.setOwnTeam(q)),
      r('PUT', '/me/done', (q) => this.setDone(q)),
      r('PUT', '/me/mix', (q) => this.setMix(q)),
      r('PUT', '/rounds/:id/participants/:id/team', (q, id, pid) => this.setTeam(q, id, pid)),
      r('GET', '/mailbox', (q) => this.mailboxView(q)),
      r('PUT', '/mailbox/wish', (q) => this.mailboxWish(q)),
      r('POST', '/mailbox/messages', (q) => this.mailboxMessage(q)),
      r('GET', '/invite', (q) => this.inviteView(q)),
      r('POST', '/invite/claim', (q) => this.claim(q)),
      r('GET', '/me', (q) => this.me(q)),
      r('PUT', '/me/rsvp', (q) => this.rsvp(q)),
      r('PUT', '/me/recovery', (q) => this.replaceRecovery(q)),
      r('POST', '/recover', (q) => this.recover(q)),
      r('PUT', '/rounds/:id/participants/:id/email', (q, id, pid) => this.setEmail(q, id, pid)),
      r('POST', '/mail/link', (q) => this.mailLink(q)),
      r('PUT', '/me/notify', (q) => this.setNotify(q)),
      r('DELETE', '/me/email', (q) => this.deleteOwnEmail(q)),
      r('PUT', '/rounds/:id/join', (q, id) => this.setJoin(q, id)),
      r('DELETE', '/rounds/:id/join', (q, id) => this.deleteJoin(q, id)),
      r('GET', '/join', (q) => this.joinView(q)),
      r('POST', '/join', (q) => this.join(q)),
      r('POST', '/mailbox/hints', (q) => this.addHint(q)),
      r('DELETE', '/mailbox/hints/:id', (q, hid) => this.deleteHint(q, hid)),
      r('POST', '/stats/analog', (q) => this.statsAnalog(q)),
      r('PUT', '/rounds/:id/questions/settings', (q, id) => this.questionSettings(q, id)),
      r('GET', '/rounds/:id/questions', (q, id) => this.adminQuestions(q, id)),
      r('PUT', '/rounds/:id/organizer-email', (q, id) => this.setOrganizerEmail(q, id)),
      r('PUT', '/rounds/:id/questions/:id/answer', (q, id, qid) => this.answerQuestion(q, id, qid)),
      r('DELETE', '/rounds/:id/questions/:id', (q, id, qid) => this.deleteQuestion(q, id, qid)),
      r('GET', '/me/questions', (q) => this.myQuestions(q)),
      r('POST', '/me/questions', (q) => this.askNamed(q)),
      r('POST', '/questions/anon', (q) => this.askAnon(q)),
      r('GET', '/questions/thread', (q) => this.anonThread(q)),
    ];
  }

  #route(req) {
    const path = req.path.replace(/\/+$/, '') || '/';
    this.limiter.hit(req.method === 'GET' ? 'read' : 'write', req.ip, this.now());

    const adm = /^\/admin\/([a-z2-7]{26})(\/[a-z0-9/]*)?$/.exec(path);
    if (adm) return this.adminRoute(req, adm[1], adm[2] ?? '');

    for (const [method, re, fn] of this.routes) {
      const m = method === req.method && re.exec(path);
      if (m) return fn(req, ...m.slice(1));
    }
    throw new HttpError(404, 'not_found', 'Unbekannter Endpunkt.');
  }

  // ------------------------------------------------------------------ Admin-Bereich

  adminRoute(req, slug, sub) {
    // Ausgeschaltet, nicht eingerichtet oder falscher Pfad: nicht von einem unbekannten Endpunkt zu unterscheiden.
    if (!this.config.admin?.enabled || !this.admin.slugMatches(slug)) throw new HttpError(404, 'not_found', 'Unbekannter Endpunkt.');
    const now = this.now();
    const { method, body } = req;

    if (method === 'POST' && sub === '/login') {
      this.limiter.hit('admin', req.ip, now);
      const [sid, token, exp] = this.admin.login(V.str(body, 'password', 256), V.str(body, 'code', 32), now, this.config.admin.session_minutes * 60);
      return json({ session: `x.${sid}.${token}`, expiresAt: exp });
    }

    const [, sid, token] = this.authParts(req, 'x');
    const exp = this.admin.session(sid, token, now);
    const revoke = /^\/codes\/([0-9a-f]{12})$/.exec(sub);

    if (method === 'POST' && sub === '/logout') {
      this.admin.logout(sid, now);
      return noContent();
    }
    if (method === 'GET' && sub === '/overview') {
      return json({ now, expiresAt: exp, codes: this.admin.codes(now), stats: this.admin.stats(now), log: this.admin.recentLog(),
        openCreation: { ...openStatus(this.db), codeRequiredByConfig: Boolean(this.config.require_organizer_code) },
        donation: donationSettings(this.db), ideas: ideasSettings(this.db),
        album: { ...albumLimits(this.db, this.config), enabled: this.config.album.enabled, defaults: { personPhotos: this.config.album.person_photos, roundMb: this.config.album.round_mb } } });
    }
    if (method === 'POST' && sub === '/codes') return this.adminCreateCode(body, now);
    if (method === 'PUT' && sub === '/open') return this.adminOpenCreation(body, now);
    if (method === 'PUT' && sub === '/donation') return this.adminDonation(body, now);
    if (method === 'PUT' && sub === '/ideas') return this.adminIdeas(body, now);
    if (method === 'PUT' && sub === '/album') return this.adminAlbumLimits(body, now);
    if (method === 'DELETE' && revoke) {
      this.admin.revokeCode(revoke[1], now);
      return noContent();
    }
    throw new HttpError(404, 'not_found', 'Unbekannter Endpunkt.');
  }

  // ------------------------------------------------------------------ Adventsalbum (2.13)
  //
  // Fotos sind im Browser neu gezeichnet (ohne EXIF), verkleinert und mit K_round verschlüsselt. Der Server prüft nur
  // Format, Größe und Grenzen – den Inhalt kann er nicht sehen. Sichtbar nur für Teilnehmende mit eigenem Zugang,
  // die zugesagt haben, und für die Organisator:in (zum Löschen). Gelöscht mit der Runde.

  albumLimits() {
    const l = albumLimits(this.db, this.config);
    return { available: this.config.album.enabled, personPhotos: l.personPhotos, roundBytes: l.roundMb * 1024 * 1024, photoBytes: PHOTO_MAX, thumbBytes: THUMB_MAX };
  }


  /**
   * Vorprüfung vor dem Lesen eines Foto-Uploads (Sicherheitsprüfung 2.13, Nr. 4): Nur mit gültigem Teilnehmerzugang,
   * Zusage und eingeschaltetem Album darf die Anfrage größer als 64 KB sein. Ohne gilt die normale Grenze.
   */
  photoUploadAllowed(auth) {
    try {
      const [p, round] = this.albumPerson({ auth });
      return Boolean(p && round);
    } catch {
      return false;
    }
  }

  albumSettings(req, roundId) {
    const round = this.adminRound(req, roundId);
    const enabled = get(req.body, 'enabled');
    const pdf = get(req.body, 'pdf');
    if (typeof enabled !== 'boolean') fail('enabled');
    if (typeof pdf !== 'boolean') fail('pdf');
    if (enabled && !this.config.album.enabled) throw new HttpError(409, 'album_unavailable', 'Das Adventsalbum ist auf diesem Server abgeschaltet.');
    run(this.db, 'UPDATE rounds SET album_mode = ?, album_pdf = ? WHERE id = ?', enabled ? 1 : 0, pdf ? 1 : 0, round.id);
    return noContent();
  }

  /** Person mit eigenem Zugang, zugesagt, Album an. */
  albumPerson(req) {
    const [p, round] = this.personByToken(req, 'p');
    if (!round.album_mode || !this.config.album.enabled) throw new HttpError(409, 'album_off', 'Das Adventsalbum ist in dieser Runde nicht eingeschaltet.');
    if (p.rsvp !== 'dabei') throw new HttpError(409, 'not_participating', 'Das Adventsalbum sehen alle, die zugesagt haben.');
    return [p, round];
  }

  /**
   * Fotoliste. pid und nameCt (verschlüsselter Name aus der Teilnehmerliste) der hochladenden Person: Die App zeigt
   * diesen Namen statt einer selbst eingetragenen Angabe – so kann niemand unter fremdem Namen posten. Der Name
   * steht beim Foto ohnehin; die Personen-ID verrät darüber hinaus nichts.
   */
  photoList(roundId, ownPid = null) {
    return all(this.db, `SELECT f.id, f.pid, f.created_at, f.bytes, f.thumb, f.meta_ct, p.name_ct
                           FROM photos f LEFT JOIN participants p ON p.id = f.pid
                          WHERE f.round_id = ? ORDER BY f.created_at, f.rowid`, roundId)
      .map((f) => ({
        id: f.id,
        at: f.created_at,
        bytes: f.bytes,
        own: ownPid !== null && f.pid === ownPid,
        pid: f.pid,
        nameCt: f.name_ct ?? null,
        thumbCt: `v1.${Buffer.from(f.thumb).toString('base64url')}`,
        metaCt: f.meta_ct,
      }));
  }

  usage(roundId, pid) {
    return {
      mine: pid ? value(this.db, 'SELECT COUNT(*) FROM photos WHERE round_id = ? AND pid = ?', roundId, pid) : 0,
      roundBytes: value(this.db, 'SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE round_id = ?', roundId),
    };
  }

  myPhotos(req) {
    const [p, round] = this.albumPerson(req);
    this.limiter.hit('photo_read', req.ip, this.now());
    return json({ photos: this.photoList(round.id, p.id), usage: this.usage(round.id, p.id), limits: this.albumLimits() });
  }

  uploadPhoto(req) {
    const [p, round] = this.albumPerson(req);
    const now = this.now();
    const b = req.body;
    const id = V.id(b, 'id');
    const photo = photoBytes(b, 'photoCt', PHOTO_MAX);
    const thumb = photoBytes(b, 'thumbCt', THUMB_MAX);
    const metaCt = V.ct(b, 'metaCt', L.PHOTO_META);
    this.limiter.hit('photo', req.ip, now);
    const total = photo.length + thumb.length;
    tx(this.db, () => {
      const u = this.usage(round.id, p.id);
      const lim = this.albumLimits();
      if (u.mine >= lim.personPhotos) throw new HttpError(409, 'photo_limit', `Höchstens ${lim.personPhotos} Fotos pro Person.`);
      if (u.roundBytes + total > lim.roundBytes) throw new HttpError(409, 'album_full', 'Das Album dieser Runde ist voll.');
      if (one(this.db, 'SELECT 1 AS x FROM photos WHERE id = ?', id)) throw new HttpError(409, 'exists', 'Dieses Foto gibt es schon.');
      run(this.db, 'INSERT INTO photos (id, round_id, pid, created_at, bytes, thumb, photo, meta_ct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, round.id, p.id, now, total, thumb, photo, metaCt);
    });
    return json({ id, at: now }, 201);
  }

  photoOut(roundId, fid) {
    const f = one(this.db, 'SELECT photo FROM photos WHERE id = ? AND round_id = ?', fid, roundId) ?? notFound();
    return json({ photoCt: `v1.${Buffer.from(f.photo).toString('base64url')}` });
  }

  myPhoto(req, fid) {
    const [, round] = this.albumPerson(req);
    // eigene, engere Grenze für Fotoabrufe (bis ~800 KB je Antwort; Sicherheitsprüfung 2.13, Nr. 3)
    this.limiter.hit('photo_read', req.ip, this.now());
    return this.photoOut(round.id, fid);
  }

  deleteMyPhoto(req, fid) {
    // Eigene Fotos lassen sich auch löschen, wenn das Album inzwischen aus ist oder man abgesagt hat
    const [p, round] = this.personByToken(req, 'p');
    const { changes } = run(this.db, 'DELETE FROM photos WHERE id = ? AND round_id = ? AND pid = ?', fid, round.id, p.id);
    if (changes !== 1) notFound();
    return noContent();
  }

  adminPhotos(req, roundId) {
    const round = this.adminRound(req, roundId);
    this.limiter.hit('photo_read', req.ip, this.now());
    return json({
      photos: this.photoList(round.id),
      usage: this.usage(round.id, null),
      limits: this.albumLimits(),
    });
  }

  adminPhoto(req, roundId, fid) {
    const round = this.adminRound(req, roundId);
    this.limiter.hit('photo_read', req.ip, this.now());
    return this.photoOut(round.id, fid);
  }

  adminDeletePhoto(req, roundId, fid) {
    const round = this.adminRound(req, roundId);
    const { changes } = run(this.db, 'DELETE FROM photos WHERE id = ? AND round_id = ?', fid, round.id);
    if (changes !== 1) notFound();
    return noContent();
  }

  // ------------------------------------------------------------------ Rückfragen an die Organisator:in (2.9)

  /** Ein-/Ausschalten. mode 0 = aus, 1 = mit Namen, 2 = auch anonym. Bestehende Fragen bleiben bei „aus“ lesbar. */
  questionSettings(req, roundId) {
    const round = this.adminRound(req, roundId);
    const b = req.body;
    const mode = V.int(b, 'mode');
    if (![0, 1, 2].includes(mode)) fail('mode');
    const pub = mode ? V.pubkey(b, 'pub') : round.q_pub;
    // Für anonyme Fragen: Hash des gemeinsamen Tokens. Bleibt gespeichert, damit Ein-/Ausschalten nichts verliert.
    const anonHash = mode === 2 ? V.hash(b, 'anonHash') : round.q_anon_hash;
    run(this.db, 'UPDATE rounds SET q_mode = ?, q_pub = ?, q_anon_hash = ? WHERE id = ?', mode, pub, anonHash, round.id);
    return noContent();
  }

  /**
   * Adresse der Organisator:in für Hinweise auf neue Rückfragen (2.10). Nur im E-Mail-Modus; null/'' = löschen.
   * Neu gesetzt: gilt nur für Fragen ab jetzt (keine Nachmeldung älterer).
   */
  setOrganizerEmail(req, roundId) {
    const round = this.adminRound(req, roundId);
    const b = req.body;
    const raw = get(b, 'email');
    if (raw === null || raw === '') {
      run(this.db, 'UPDATE rounds SET org_email_ct = NULL, org_email_view_ct = NULL WHERE id = ?', round.id);
      return noContent();
    }
    if (!this.mailer || !round.email_enabled) throw new HttpError(409, 'email_disabled', 'Für diese Runde ist der E-Mail-Modus nicht eingeschaltet.');
    const email = validEmail(raw);
    if (email === null) fail('email');
    const view = V.ct(b, 'emailViewCt', L.EMAIL_VIEW);
    const last = value(this.db, 'SELECT COALESCE(MAX(rowid), 0) FROM questions WHERE round_id = ?', round.id);
    run(this.db, 'UPDATE rounds SET org_email_ct = ?, org_email_view_ct = ?, q_notified_rowid = MAX(q_notified_rowid, ?) WHERE id = ?',
      this.sc.seal(email, `orgemail|${round.id}`), view, last, round.id);
    return noContent();
  }

  adminQuestions(req, roundId) {
    const round = this.adminRound(req, roundId);
    return json({
      questions: all(this.db, 'SELECT id, pid, q_ct, a_ct, day, answer_day FROM questions WHERE round_id = ? ORDER BY rowid', round.id)
        .map((q) => ({ id: q.id, pid: q.pid, anon: q.pid === null, qCt: q.q_ct, aCt: q.a_ct, day: q.day, answerDay: q.answer_day })),
    });
  }

  answerQuestion(req, roundId, qid) {
    const round = this.adminRound(req, roundId);
    const aCt = V.ct(req.body, 'aCt', L.ANSWER);
    const day = Math.floor(this.now() / DAY);
    // notified = 0: geänderte Antwort meldet sich erneut (nur bei Fragen mit Namen und E-Mail)
    const { changes } = run(this.db, 'UPDATE questions SET a_ct = ?, answer_day = ?, notified = 0 WHERE id = ? AND round_id = ?', aCt, day, qid, round.id);
    if (changes !== 1) notFound();
    return noContent();
  }

  deleteQuestion(req, roundId, qid) {
    const round = this.adminRound(req, roundId);
    const { changes } = run(this.db, 'DELETE FROM questions WHERE id = ? AND round_id = ?', qid, round.id);
    if (changes !== 1) notFound();
    return noContent();
  }

  myQuestions(req) {
    const [p] = this.personByToken(req, 'p');
    return json({
      questions: all(this.db, 'SELECT id, own_ct, a_ct, day, answer_day FROM questions WHERE pid = ? ORDER BY rowid', p.id)
        .map((q) => ({ id: q.id, ownCt: q.own_ct, aCt: q.a_ct, day: q.day, answerDay: q.answer_day })),
    });
  }

  /** Frage mit Namen: an die Person gebunden; ownCt = eigene Kopie (für den eigenen Schlüssel versiegelt). */
  askNamed(req) {
    const [p, round] = this.personByToken(req, 'p');
    if (round.q_mode < 1 || !round.q_pub) throw new HttpError(409, 'questions_off', 'Rückfragen sind in dieser Runde nicht freigegeben.');
    const b = req.body;
    const id = V.id(b, 'id');
    const qCt = V.ct(b, 'qCt', L.QUESTION);
    const ownCt = V.ct(b, 'ownCt', L.OWN);
    const day = Math.floor(this.now() / DAY);
    if (value(this.db, 'SELECT COUNT(*) FROM questions WHERE pid = ? AND day = ?', p.id, day) >= Q_PER_DAY) {
      throw new HttpError(429, 'questions_today', 'Höchstens 3 Rückfragen am Tag. Morgen geht es wieder.');
    }
    if (value(this.db, 'SELECT COUNT(*) FROM questions WHERE pid = ?', p.id) >= Q_OPEN_MAX) {
      throw new HttpError(409, 'questions_full', 'Es sind schon sehr viele Rückfragen gespeichert. Bitte die Organisator:in, alte zu löschen.');
    }
    this.insertQuestion(() => run(this.db, 'INSERT INTO questions (id, round_id, pid, q_ct, own_ct, day) VALUES (?, ?, ?, ?, ?, ?)', id, round.id, p.id, qCt, ownCt, day));
    return json({ id }, 201);
  }

  /**
   * Anonyme Frage: Auth mit dem gemeinsamen Token der Runde (q.<rundenId>.<token>), ohne Personen-Zugang.
   * Gespeichert wird nur der Hash des Abholtokens; kein Bezug zu einer Person, nur der Tag.
   */
  askAnon(req) {
    const [, rid, token] = this.authParts(req, 'q');
    const round = one(this.db, 'SELECT * FROM rounds WHERE id = ?', rid);
    if (!round || round.q_mode !== 2 || !round.q_anon_hash || !safeEqual(round.q_anon_hash, sha256(token))) {
      throw new HttpError(409, 'questions_off', 'Anonyme Rückfragen sind in dieser Runde nicht freigegeben.');
    }
    const b = req.body;
    const id = V.id(b, 'id');
    const qCt = V.ct(b, 'qCt', L.QUESTION);
    const threadHash = V.hash(b, 'threadHash');
    const now = this.now();
    const day = Math.floor(now / DAY);
    this.limiter.hit('question_anon', req.ip, now);
    if (value(this.db, 'SELECT COUNT(*) FROM questions WHERE round_id = ? AND pid IS NULL AND day = ?', round.id, day) >= Q_ANON_ROUND_DAY) {
      throw new HttpError(429, 'questions_today', 'Heute sind in dieser Runde schon sehr viele anonyme Rückfragen eingegangen.');
    }
    if (value(this.db, 'SELECT COUNT(*) FROM questions WHERE round_id = ? AND pid IS NULL', round.id) >= Q_OPEN_MAX) {
      throw new HttpError(409, 'questions_full', 'Es sind schon sehr viele anonyme Rückfragen gespeichert. Bitte die Organisator:in, alte zu löschen.');
    }
    this.insertQuestion(() => run(this.db, 'INSERT INTO questions (id, round_id, pid, thread_hash, q_ct, day) VALUES (?, ?, NULL, ?, ?, ?)', id, round.id, threadHash, qCt, day));
    return json({ id }, 201);
  }

  insertQuestion(fn) {
    try {
      fn();
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'Diese Frage gibt es schon.');
      throw e;
    }
  }

  /** Antwort auf eine anonyme Frage abholen (k.<frageId>.<abholtoken>). */
  anonThread(req) {
    const [, qid, token] = this.authParts(req, 'k');
    const q = one(this.db, 'SELECT * FROM questions WHERE id = ? AND pid IS NULL', qid);
    if (!q || !safeEqual(q.thread_hash, sha256(token))) notFound();
    return json({ id: q.id, aCt: q.a_ct, day: q.day, answerDay: q.answer_day });
  }

  /** Analoge Wichtelrunde vorbereitet: nur zählen, keine Inhalte. Begrenzt je Anschluss und Tag. */
  statsAnalog(req) {
    const now = this.now();
    this.limiter.hit('analog', req.ip, now);
    countAnalog(this.db, now);
    return noContent();
  }

  /** Grenzen des Adventsalbums (2.13.1): { personPhotos, roundMb } oder { reset: true } = zurück zu config.json. */
  adminAlbumLimits(b, now) {
    if (get(b, 'reset') === true) resetAlbumLimits(this.db);
    else {
      try {
        saveAlbumLimits(this.db, { personPhotos: get(b, 'personPhotos'), roundMb: get(b, 'roundMb') });
      } catch (e) {
        if (e instanceof AlbumLimitsError) throw new HttpError(400, `invalid_${e.field}`, e.message);
        throw e;
      }
    }
    const l = albumLimits(this.db, this.config);
    this.admin.log(now, 'Adventsalbum', describeAlbumLimits(l));
    return json({ album: { ...l, enabled: this.config.album.enabled, defaults: { personPhotos: this.config.album.person_photos, roundMb: this.config.album.round_mb } } });
  }

  /** Geschenkvorschläge des Ideen-Würfels (2.12): { mode: builtin|extend|replace, items: [{ max, de, en }] }. */
  adminIdeas(b, now) {
    let next;
    try {
      next = saveIdeas(this.db, b);
    } catch (e) {
      if (e instanceof IdeasError) throw new HttpError(400, 'invalid_ideas', e.message);
      throw e;
    }
    this.admin.log(now, 'Geschenkvorschläge', describeIdeas(next));
    return json({ ideas: next });
  }

  /** Unterstützungslink des Betreibers (2.12): an/aus, Adresse (nur https), Linktext, kurzer Hinweis. */
  adminDonation(b, now) {
    for (const f of ['url', 'label', 'note']) if (get(b, f) !== null && typeof get(b, f) !== 'string') fail(f);
    let next;
    try {
      next = saveDonation(this.db, { enabled: get(b, 'enabled'), url: get(b, 'url') ?? '', label: get(b, 'label') ?? '', note: get(b, 'note') ?? '', inRounds: get(b, 'inRounds') ?? false });
    } catch (e) {
      if (e instanceof DonationError) throw new HttpError(400, `invalid_${e.field}`, e.message);
      throw e;
    }
    this.admin.log(now, 'Unterstützungslink', describeDonation(next));
    return json({ donation: next });
  }

  /** Anlegen ohne Code ein-/ausschalten, Obergrenze gleichzeitiger Runden, E-Mail für solche Runden. */
  adminOpenCreation(b, now) {
    const enabled = get(b, 'enabled');
    const email = get(b, 'email');
    if (typeof enabled !== 'boolean') fail('enabled');
    if (typeof email !== 'boolean') fail('email');
    const maxRounds = V.int(b, 'maxRounds');
    if (maxRounds < 1 || maxRounds > OPEN_MAX) fail('maxRounds', `1 bis ${OPEN_MAX} Runden`);
    const next = { enabled, maxRounds, email };
    saveOpenSettings(this.db, next);
    this.admin.log(now, 'Anlegen ohne Code', describeOpen(next));
    return json({ openCreation: { ...openStatus(this.db), codeRequiredByConfig: Boolean(this.config.require_organizer_code) } });
  }

  /** Ohne Code anlegbar? (Konfiguration verlangt keinen Code, oder Anlegen ohne Code ist an und es gibt freie Plätze) */
  openAvailable() {
    if (!this.config.require_organizer_code) return { codeRequired: false, available: true, email: true };
    const s = openStatus(this.db);
    return { codeRequired: !(s.enabled && s.free > 0), available: s.enabled && s.free > 0, email: s.email, enabled: s.enabled };
  }

  adminCreateCode(b, now) {
    const label = get(b, 'label') ?? '';
    if (typeof label !== 'string' || chars(label) > 60 || /[\x00-\x1f\x7f]/.test(label)) fail('label');
    const rounds = V.int(b, 'rounds');
    const days = V.int(b, 'days');
    if (rounds < 1 || rounds > 20) fail('rounds', '1 bis 20 Runden');
    if (days < 1 || days > 365) fail('days', '1 bis 365 Tage');
    const code = this.admin.createCode(phpTrim(label), rounds, days, now);
    return json({ code, rounds, expiresAt: now + days * DAY }, 201);
  }

  // ------------------------------------------------------------------ Hilfen

  /** Zerlegt X-ZW-Auth; roles z. B. 'g|r'. Liefert [Rolle, ID, Token]. */
  authParts(req, roles) {
    const m = /^([aipgrxjqk])\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/.exec(req.auth ?? '');
    if (!m || !roles.split('|').includes(m[1])) throw new HttpError(401, 'unauthorized', 'Zugangsdaten fehlen oder sind ungültig.');
    return [m[1], m[2], m[3]];
  }

  adminRound(req, roundId) {
    const [, rid, token] = this.authParts(req, 'a');
    if (rid !== roundId) notFound();
    const round = one(this.db, 'SELECT * FROM rounds WHERE id = ?', roundId);
    if (!round || !safeEqual(round.admin_hash, sha256(token))) notFound();
    return round;
  }

  /** Person und Runde zum Einladungs- (i) oder Zugangstoken (p). */
  personByToken(req, role) {
    const [, pid, token] = this.authParts(req, role);
    const p = one(this.db, 'SELECT * FROM participants WHERE id = ?', pid);
    if (!p || !safeEqual(p[role === 'i' ? 'invite_hash' : 'access_hash'], sha256(token))) invalidLink();
    const round = one(this.db, 'SELECT * FROM rounds WHERE id = ?', p.round_id);
    if (!round) invalidLink();
    return [p, round];
  }

  participantOf(roundId, pid) {
    return one(this.db, 'SELECT * FROM participants WHERE id = ? AND round_id = ?', pid, roundId) ?? notFound();
  }

  mailTitle(round) {
    return this.sc.open(round.mail_title_ct, `title|${round.id}`);
  }

  // ------------------------------------------------------------------ Allgemein

  info() {
    const str = (v) => (v === null || v === undefined || v === false ? '' : String(v));
    const transport = this.config.mail?.transport;
    return json({
      requireOrganizerCode: this.openAvailable().codeRequired,
      // Anlegen ohne Code (2.4): nur ob es gerade geht und ob dann E-Mail möglich ist – keine Zahlen
      // limited = Codes gibt es grundsätzlich (Konfiguration), ohne Code nur mit freien Plätzen
      openCreation: (() => { const o = this.openAvailable(); return { available: o.available, full: Boolean(o.enabled && !o.available), email: o.email, limited: Boolean(this.config.require_organizer_code) }; })(),
      maxParticipants: this.config.max_participants,
      emailAvailable: this.mailer !== null,
      now: this.now(),
      operator: Object.fromEntries(Object.entries(this.config.operator).map(([k, v]) => [k, str(v)])),
      hoster: str(this.config.hoster),
      mailProviderName: str(this.config.privacy.mail_provider),
      noAccessLogs: Boolean(this.config.privacy.no_access_logs),
      backupDays: Math.max(0, Math.min(365, Math.trunc(Number(this.config.privacy.backup_days) || 0))),
      mailProvider: transport === 'brevo' || transport === 'smtp' ? transport : null,
      sourceUrl: this.config.source_url,
      albumAvailable: this.config.album.enabled,
      // Unterstützungslink des Betreibers (2.12), nur wenn eingeschaltet
      donation: publicDonation(this.db),
      version: VERSION,
    });
  }

  organizerCheck(req) {
    this.limiter.hit('create_round', req.ip, this.now());
    return json(checkCode(this.db, V.str(req.body, 'organizerCode', 64), this.now()));
  }

  // ------------------------------------------------------------------ Organisator:in

  createRound(req) {
    const now = this.now();
    this.limiter.hit('create_round', req.ip, now);
    const b = req.body;
    const id = V.id(b, 'id');
    const adminHash = V.hash(b, 'adminHash');
    const mode = V.enum(b, 'mode', ['wichteln', 'schrott']);
    const rsvp = V.int(b, 'rsvpDeadline');
    const wish = mode === 'wichteln' ? V.int(b, 'wishDeadline') : null;
    const event = V.int(b, 'eventDate');
    const meta = V.ct(b, 'metaCt', L.META);
    const adminCt = V.ct(b, 'adminCt', L.ADMIN, true);
    validateDates(mode, rsvp, wish, event, now, true);
    const emailEnabled = this.emailFlag(b);
    const mailTitle = this.mailTitleCt(b, id);
    const lang = get(b, 'lang') === null ? 'de' : V.enum(b, 'lang', LANGS); // Sprache der Mails
    const code = get(b, 'organizerCode');
    const withCode = typeof code === 'string' && code.trim() !== '';
    // Runden ohne Code: höchstens 2 je Anschluss und Tag, damit niemand alle freien Plätze belegt (SEC-007).
    // Vor der Transaktion gezählt – auch abgewiesene Versuche zählen.
    if (!withCode && this.config.require_organizer_code) this.limiter.hit('create_open', req.ip, now);

    try {
      tx(this.db, () => {
        let withoutCode = 0;
        if (this.config.require_organizer_code) {
          if (withCode) {
            consumeCode(this.db, V.str(b, 'organizerCode', 64), now); // mit Code geht es immer (bis zum Kontingent)
          } else {
            // Ohne Code: Einstellung und freie Plätze innerhalb derselben Schreibtransaktion prüfen (kein Wettlauf)
            const s = openSettings(this.db);
            if (!s.enabled) throw new HttpError(403, 'organizer_code', 'Organisator-Code ungültig, abgelaufen oder aufgebraucht.');
            if (openUsage(this.db) >= s.maxRounds) {
              throw new HttpError(403, 'open_full', 'Derzeit sind alle Plätze für Runden ohne Code belegt. Mit einem Organisator-Code geht es trotzdem.');
            }
            if (emailEnabled && !s.email) throw new HttpError(409, 'email_needs_code', 'E-Mail-Versand gibt es nur für Runden mit Organisator-Code.');
            withoutCode = 1;
          }
        }
        run(this.db, `INSERT INTO rounds (id, mode, status, admin_hash, email_enabled, mail_title_ct, rsvp_deadline, wish_deadline, event_date, delete_after, meta_ct, admin_ct, created_at, lang, without_code)
                      VALUES (?, ?, 'offen', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, mode, adminHash, emailEnabled ? 1 : 0, mailTitle, rsvp, wish, event, event + DELETE_AFTER_EVENT, meta, adminCt, now, lang, withoutCode);
      });
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'ID bereits vergeben, bitte erneut versuchen.');
      throw e;
    }
    return json({ id, deleteAfter: event + DELETE_AFTER_EVENT }, 201);
  }

  adminView(req, roundId) {
    const round = this.adminRound(req, roundId);
    const people = all(this.db, `SELECT id, name_ct, invite_ct, claimed_at, rsvp, email_ct, email_view_ct, notify, assignment_ct, draw_seen, draw_reminded, via_group, team_ct, wish_frozen_at, wish_unlock_req, created_at
                                   FROM participants WHERE round_id = ? ORDER BY created_at, rowid`, roundId).map((p) => ({
      id: p.id,
      nameCt: p.name_ct,
      inviteCt: p.claimed_at === null ? p.invite_ct : null,
      claimed: p.claimed_at !== null,
      rsvp: p.rsvp,
      hasEmail: p.email_ct !== null,
      emailViewCt: p.email_ct !== null ? p.email_view_ct : null,
      notify: Boolean(p.notify),
      inDraw: p.assignment_ct !== null,
      drawSeen: Boolean(p.draw_seen),
      drawRemindedAt: p.draw_reminded,
      viaGroup: Boolean(p.via_group),
      teamCt: p.team_ct,
      wishFrozenAt: p.wish_frozen_at ?? null,
      unlockRequested: p.wish_unlock_req === 1,
    }));
    const join = round.join_hash
      ? { ct: round.join_ct, until: round.join_until, max: round.join_max, used: round.join_used }
      : null;
    return json({
      round: { ...roundPublic(round), adminCt: round.admin_ct, mailTitle: this.mailTitle(round), join, orgEmailViewCt: round.org_email_ct !== null ? round.org_email_view_ct : null },
      participants: people,
      maxParticipants: this.config.max_participants,
      // Runden ohne Code: E-Mail nur, wenn im Admin-Bereich erlaubt (bereits eingeschaltete bleiben bedienbar)
      emailAvailable: this.mailer !== null && (round.without_code !== 1 || round.email_enabled === 1 || openSettings(this.db).email),
      albumAvailable: this.config.album.enabled,
    });
  }

  updateRound(req, roundId) {
    const round = this.adminRound(req, roundId);
    requireStatus(round, 'offen', 'gezogen');
    const b = req.body;
    const sets = [];
    const args = [];
    const set = (sql, ...a) => { sets.push(sql); args.push(...a); };

    const meta = V.ct(b, 'metaCt', L.META, true);
    if (meta !== null) set('meta_ct = ?', meta);
    if (has(b, 'adminCt')) {
      requireStatus(round, 'offen');
      set('admin_ct = ?', V.ct(b, 'adminCt', L.ADMIN));
    }
    let teamsOff = false;
    if (has(b, 'teamsCt')) {
      // Team-Wichteln an/aus bzw. Teamliste ändern – nur vor der Ziehung
      requireStatus(round, 'offen');
      if (round.mode !== 'wichteln') throw new HttpError(409, 'wrong_mode', 'Team-Wichteln gibt es nur beim Wichteln.');
      const teams = V.ct(b, 'teamsCt', L.TEAMS, true);
      teamsOff = teams === null;
      set('teams_ct = ?', teams);
    }
    if (has(b, 'emailEnabled')) {
      const on = this.emailFlag(b);
      if (on && round.without_code === 1 && !round.email_enabled && !openSettings(this.db).email) {
        throw new HttpError(409, 'email_needs_code', 'E-Mail-Versand gibt es nur für Runden mit Organisator-Code.');
      }
      set('email_enabled = ?', on ? 1 : 0);
    }
    if (has(b, 'mailTitle')) set('mail_title_ct = ?', this.mailTitleCt(b, roundId));
    if (has(b, 'lang')) set('lang = ?', V.enum(b, 'lang', LANGS));
    if (['rsvpDeadline', 'wishDeadline', 'eventDate'].some((k) => has(b, k))) {
      requireStatus(round, 'offen');
      const rsvp = V.int(b, 'rsvpDeadline', true) ?? round.rsvp_deadline;
      const wish = round.mode === 'wichteln' ? V.int(b, 'wishDeadline', true) ?? round.wish_deadline : null;
      const event = V.int(b, 'eventDate', true) ?? round.event_date;
      validateDates(round.mode, rsvp, wish, event, this.now(), false);
      set('rsvp_deadline = ?, wish_deadline = ?, event_date = ?, delete_after = ?', rsvp, wish, event, event + DELETE_AFTER_EVENT);
      // Geänderte Fristen: Erinnerungen dürfen erneut ausgelöst werden
      if (rsvp !== round.rsvp_deadline) set('reminded_rsvp = NULL');
      if (wish !== null && wish !== round.wish_deadline) set('reminded_wish = NULL');
    }
    if (!sets.length) throw new HttpError(400, 'nothing', 'Keine Änderung übermittelt.');
    run(this.db, `UPDATE rounds SET ${sets.join(', ')} WHERE id = ?`, ...args, roundId);
    if (teamsOff) run(this.db, 'UPDATE participants SET team_ct = NULL WHERE round_id = ?', roundId);
    if (get(b, 'emailEnabled') === false) {
      // Datensparsamkeit: E-Mail-Modus aus = alle Adressen der Runde löschen
      run(this.db, 'UPDATE participants SET email_ct = NULL, email_view_ct = NULL WHERE round_id = ?', roundId);
      run(this.db, 'UPDATE rounds SET org_email_ct = NULL, org_email_view_ct = NULL WHERE id = ?', roundId);
    }
    return json({ round: roundPublic(one(this.db, 'SELECT * FROM rounds WHERE id = ?', roundId)) });
  }

  deleteRound(req, roundId) {
    this.adminRound(req, roundId);
    run(this.db, 'DELETE FROM rounds WHERE id = ?', roundId);
    shred(this.db);
    return noContent();
  }

  addParticipant(req, roundId) {
    const round = this.adminRound(req, roundId);
    requireStatus(round, 'offen');
    const b = req.body;
    const pid = V.id(b, 'id');
    const inviteHash = V.hash(b, 'inviteHash');
    const inviteCt = V.ct(b, 'inviteCt', L.INVITE);
    const nameCt = V.ct(b, 'nameCt', L.NAME);
    const [emailCt, emailView] = this.emailFields(b, round, pid);
    const max = this.config.max_participants;
    try {
      tx(this.db, () => {
        if (value(this.db, 'SELECT COUNT(*) FROM participants WHERE round_id = ?', roundId) >= max) {
          throw new HttpError(409, 'full', `Die Runde ist voll (höchstens ${max} Personen).`);
        }
        run(this.db, 'INSERT INTO participants (id, round_id, invite_hash, invite_ct, name_ct, email_ct, email_view_ct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          pid, roundId, inviteHash, inviteCt, nameCt, emailCt, emailView, this.now());
      });
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'ID bereits vergeben, bitte erneut versuchen.');
      throw e;
    }
    return json({ id: pid }, 201);
  }

  renameParticipant(req, roundId, pid) {
    requireStatus(this.adminRound(req, roundId), 'offen', 'gezogen');
    this.participantOf(roundId, pid);
    run(this.db, 'UPDATE participants SET name_ct = ? WHERE id = ?', V.ct(req.body, 'nameCt', L.NAME), pid);
    return noContent();
  }

  /** Team einer Person (Organisator:in). teamCt null = ohne Team. Nur vor der Ziehung. */
  setTeam(req, roundId, pid) {
    const round = this.adminRound(req, roundId);
    this.teamWritable(round);
    this.participantOf(roundId, pid);
    run(this.db, 'UPDATE participants SET team_ct = ? WHERE id = ?', V.ct(req.body, 'teamCt', L.TEAM, true), pid);
    return noContent();
  }

  /** Eigenes Team wählen oder wechseln (Teilnehmende). Nur vor der Ziehung. */
  setOwnTeam(req) {
    const [p, round] = this.personByToken(req, 'p');
    this.teamWritable(round);
    if (p.rsvp === 'raus') throw new HttpError(409, 'not_participating', 'Wer diesmal raus ist, wählt kein Team.');
    run(this.db, 'UPDATE participants SET team_ct = ? WHERE id = ?', V.ct(req.body, 'teamCt', L.TEAM, true), p.id);
    return noContent();
  }

  /** Eigene Lieder fürs Wichtel-Mixtape (2.11); null = entfernen. Nur wer dabei ist. */
  setMix(req) {
    const [p] = this.personByToken(req, 'p');
    const mixCt = V.ct(req.body, 'mixCt', L.MIX, true);
    if (mixCt !== null && p.rsvp === 'raus') throw new HttpError(409, 'not_participating', 'Wer diesmal raus ist, trägt keine Lieder bei.');
    run(this.db, 'UPDATE participants SET mix_ct = ? WHERE id = ?', mixCt, p.id);
    return noContent();
  }

  /** Eigener Haken „Geschenk erledigt“ (2.8). Verschlüsselt; nur die Person selbst sieht ihn. null = zurücknehmen. */
  setDone(req) {
    const [p] = this.personByToken(req, 'p');
    run(this.db, 'UPDATE participants SET done_ct = ? WHERE id = ?', V.ct(req.body, 'doneCt', L.DONE, true), p.id);
    return noContent();
  }

  teamWritable(round) {
    if (round.teams_ct === null) throw new HttpError(409, 'no_teams', 'Diese Runde ist kein Team-Wichteln.');
    if (round.status !== 'offen') throw new HttpError(409, 'wrong_status', 'Nach der Ziehung lassen sich die Teams nicht mehr ändern.');
  }

  removeParticipant(req, roundId, pid) {
    requireStatus(this.adminRound(req, roundId), 'offen');
    this.participantOf(roundId, pid);
    run(this.db, 'DELETE FROM participants WHERE id = ?', pid);
    return noContent();
  }

  /**
   * Neue Einladung: alter Link und alte Schlüssel der Person verfallen.
   * Nach der Ziehung (bis zur Wunschfrist) wird die Ziehung zurückgesetzt; die Person bleibt „dabei“.
   */
  reinvite(req, roundId, pid) {
    const round = this.adminRound(req, roundId);
    requireStatus(round, 'offen', 'gezogen');
    const drawn = round.status === 'gezogen';
    if (drawn && this.now() >= round.wish_deadline) throw new HttpError(409, 'deadline', 'Nach der Wunschfrist ist keine Neuziehung mehr möglich.');
    const person = this.participantOf(roundId, pid);
    const inviteHash = V.hash(req.body, 'inviteHash');
    const inviteCt = V.ct(req.body, 'inviteCt', L.INVITE);
    tx(this.db, () => {
      run(this.db, `UPDATE participants SET invite_hash = ?, invite_ct = ?, claimed_at = NULL, access_hash = NULL, pubkey = NULL,
                           rsvp = ?, wish_ct = NULL, assignment_ct = NULL, mailboxkey_ct = NULL, recovery_hash = NULL, recovery_ct = NULL, done_ct = NULL, wish_frozen_at = NULL, wish_unlock_req = 0, mix_ct = NULL
                     WHERE id = ?`, inviteHash, inviteCt, drawn ? person.rsvp : 'offen', pid);
      run(this.db, 'DELETE FROM questions WHERE pid = ?', pid);
      if (drawn) this.resetDraw(roundId);
    });
    return json({ drawReset: drawn });
  }

  resetDraw(roundId) {
    run(this.db, 'DELETE FROM mailboxes WHERE round_id = ?', roundId);
    // Neue Ziehung → neue Person zu beschenken: eigener Haken „Geschenk erledigt“ gilt nicht mehr
    run(this.db, 'UPDATE participants SET assignment_ct = NULL, mailboxkey_ct = NULL, draw_seen = 0, draw_reminded = NULL, done_ct = NULL WHERE round_id = ?', roundId);
    run(this.db, "UPDATE rounds SET status = 'offen', drawn_at = NULL WHERE id = ?", roundId);
  }

  /** Erinnerung per E-Mail an eine Person, die ihre Seite seit der Ziehung noch nicht geöffnet hat. */
  async remindDraw(req, roundId, pid) {
    const round = this.adminRound(req, roundId);
    requireStatus(round, 'gezogen');
    if (!this.mailer || !round.email_enabled) throw new HttpError(409, 'email_unavailable', 'Der E-Mail-Modus ist für diese Runde nicht eingeschaltet.');
    const p = this.participantOf(roundId, pid);
    if (p.assignment_ct === null) throw new HttpError(409, 'not_in_draw', 'Diese Person ist nicht in der Ziehung.');
    if (p.draw_seen === 1) throw new HttpError(409, 'already_seen', 'Die Person hat ihre Seite bereits geöffnet.');
    if (!p.notify) throw new HttpError(409, 'unsubscribed', 'Die Person hat Erinnerungen per E-Mail abbestellt.');
    const now = this.now();
    if (p.draw_reminded !== null && now - p.draw_reminded < 20 * 3600) throw new HttpError(429, 'reminded', 'Diese Person wurde heute schon erinnert.');
    const email = this.sc.open(p.email_ct, `email|${pid}`);
    if (email === null) throw new HttpError(409, 'no_email', 'Für diese Person ist keine E-Mail-Adresse hinterlegt.');
    this.limiter.hit('mail', req.ip, now);
    this.limiter.hit('mail_round', `round|${roundId}`, now);
    const [subject, text] = Texts.drawReminder(this.mailTitle(round), round.wish_deadline, this.baseUrl, round.delete_after, pid, round.lang);
    try {
      await this.mailer.send(email, subject, text);
    } catch (e) {
      console.error(`ZeroWichtel Mail: ${e.message}`);
      throw new HttpError(502, 'mail_failed', 'Die E-Mail konnte nicht verschickt werden. Bitte später erneut versuchen.');
    }
    run(this.db, 'UPDATE participants SET draw_reminded = ? WHERE id = ?', now, pid);
    return json({ remindedAt: now });
  }

  // ------------------------------------------------------------------ Ziehung

  /** Öffentliche Schlüssel aller, die angenommen und zugesagt haben. */
  publicKeys(req, roundId) {
    requireStatus(this.adminRound(req, roundId), 'offen', 'gezogen');
    return json({ keys: all(this.db, "SELECT id, pubkey FROM participants WHERE round_id = ? AND rsvp = 'dabei' AND claimed_at IS NOT NULL ORDER BY id", roundId) });
  }

  /**
   * Speichert eine Ziehung. Der Server erhält je Person nur zwei für sie versiegelte Chiffretexte
   * und eine Liste zufälliger Postfach-IDs – keine Zuordnung.
   */
  saveDraw(req, roundId) {
    const round = this.adminRound(req, roundId);
    if (round.mode !== 'wichteln') throw new HttpError(409, 'wrong_mode', 'Beim Schrottwichteln gibt es keine Ziehung.');
    requireStatus(round, 'offen', 'gezogen');
    const now = this.now();
    if (now >= round.wish_deadline) throw new HttpError(409, 'deadline', 'Nach der Wunschfrist ist keine Ziehung mehr möglich.');
    const people = get(req.body, 'participants');
    const boxes = get(req.body, 'mailboxes');
    if (!Array.isArray(people) || !Array.isArray(boxes)) fail('participants');

    const expected = all(this.db, "SELECT id FROM participants WHERE round_id = ? AND rsvp = 'dabei' AND claimed_at IS NOT NULL", roundId).map((r) => r.id);
    const rows = new Map();
    for (const p of people) {
      if (!isArr(p)) fail('participants');
      rows.set(V.id(p, 'id'), [V.ct(p, 'assignmentCt', round.teams_ct === null ? L.SEALED : L.ASSIGN), V.ct(p, 'mailboxkeyCt', L.SEALED)]);
    }
    if (expected.length < 3) throw new HttpError(409, 'too_few', 'Für eine Ziehung braucht es mindestens 3 Zusagen.');
    if (rows.size !== expected.length || people.length !== rows.size || !expected.every((id) => rows.has(id))) {
      throw new HttpError(409, 'participants_changed', 'Die Teilnehmenden haben sich geändert. Bitte die Seite neu laden und erneut ziehen.');
    }
    const mbox = new Map();
    for (const mb of boxes) {
      if (!isArr(mb)) fail('mailboxes');
      mbox.set(V.id(mb, 'id'), [V.hash(mb, 'giverHash'), V.hash(mb, 'receiverHash')]);
    }
    // Personen-Wichteln: ein Postfach je Person. Team-Wichteln: ein Postfach je Team (mindestens 2).
    // Die Art muss ausdrücklich angegeben werden – so kann eine ältere App eine Team-Runde nicht versehentlich
    // als Personen-Runde auslosen.
    const kind = get(req.body, 'kind') ?? 'person';
    if (kind !== (round.teams_ct === null ? 'person' : 'team')) {
      throw new HttpError(409, 'draw_kind', round.teams_ct === null
        ? 'Diese Runde ist kein Team-Wichteln. Bitte die Seite neu laden.'
        : 'Diese Runde ist ein Team-Wichteln. Bitte die Seite neu laden, damit die aktuelle Version der App geladen wird.');
    }
    const okCount = kind === 'person' ? mbox.size === rows.size : mbox.size >= 2 && mbox.size <= rows.size;
    if (!okCount || boxes.length !== mbox.size) fail('mailboxes', 'passt nicht zur Zahl der Teilnehmenden');

    try {
      tx(this.db, () => {
        this.resetDraw(roundId);
        for (const [pid, [a, mk]] of rows) run(this.db, 'UPDATE participants SET assignment_ct = ?, mailboxkey_ct = ? WHERE id = ? AND round_id = ?', a, mk, pid, roundId);
        for (const [mid, [gh, rh]] of mbox) run(this.db, 'INSERT INTO mailboxes (id, round_id, giver_hash, receiver_hash) VALUES (?, ?, ?, ?)', mid, roundId, gh, rh);
        run(this.db, "UPDATE rounds SET status = 'gezogen', drawn_at = ? WHERE id = ?", now, roundId);
      });
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'Bitte erneut versuchen.');
      throw e;
    }
    return json({ status: 'gezogen', drawnAt: now });
  }

  // ------------------------------------------------------------------ Wünsche und Wichtelpost

  saveWishes(req) {
    const [p, round] = this.personByToken(req, 'p');
    if (round.mode !== 'wichteln') throw new HttpError(409, 'wrong_mode', 'Beim Schrottwichteln gibt es keine Wunschlisten.');
    requireStatus(round, 'offen', 'gezogen');
    // Widerruf einer Einwilligung (Art. 7 Abs. 3 DSGVO, z. B. Allergien) muss jederzeit möglich sein – auch nach der
    // Wunschfrist. Der Server kann den verschlüsselten Inhalt nicht prüfen; die App sendet „withdraw“ nur beim Widerruf.
    const withdraw = get(req.body, 'withdraw') === true;
    if (!withdraw && this.now() >= round.wish_deadline) throw new HttpError(409, 'deadline', 'Die Wunschfrist ist abgelaufen.');
    if (!withdraw && p.rsvp === 'raus') throw new HttpError(409, 'not_participating', 'Wer diesmal raus ist, braucht keine Wunschliste.');
    const now = this.now();
    // Festgelegt (2.11): 24 h Korrektur, danach gesperrt – außer Widerruf einer Einwilligung
    if (!withdraw && p.wish_frozen_at !== null && now >= p.wish_frozen_at + FREEZE_GRACE) {
      throw new HttpError(409, 'wishes_frozen', 'Deine Wünsche sind festgelegt. Die Organisator:in kann die Festlegung aufheben.');
    }
    const freeze = get(req.body, 'freeze') === true;
    if (freeze && round.teams_ct !== null) throw new HttpError(409, 'team', 'Beim Team-Wichteln lassen sich Wünsche nicht festlegen.');
    const ct = V.ct(req.body, 'wishCt', L.WISH);
    run(this.db, `UPDATE participants SET wish_ct = ?${freeze && p.wish_frozen_at === null ? ', wish_frozen_at = ?' : ''} WHERE id = ?`,
      ...(freeze && p.wish_frozen_at === null ? [ct, now, p.id] : [ct, p.id]));
    return noContent();
  }

  /** Bitte um Freigabe festgelegter Wünsche (nach den 24 h Korrekturzeit, vor der Wunschfrist). */
  requestUnlock(req) {
    const [p, round] = this.personByToken(req, 'p');
    const now = this.now();
    if (p.wish_frozen_at === null) throw new HttpError(409, 'not_frozen', 'Deine Wünsche sind nicht festgelegt.');
    if (now >= round.wish_deadline) throw new HttpError(409, 'deadline', 'Die Wunschfrist ist abgelaufen.');
    run(this.db, 'UPDATE participants SET wish_unlock_req = 1 WHERE id = ?', p.id);
    return noContent();
  }

  /** Organisator:in hebt die Festlegung auf (die App der Person gibt das an die Kopie beim Wichtel weiter). */
  unfreezeWishes(req, roundId, pid) {
    this.adminRound(req, roundId);
    this.participantOf(roundId, pid);
    run(this.db, 'UPDATE participants SET wish_frozen_at = NULL, wish_unlock_req = 0 WHERE id = ?', pid);
    return noContent();
  }

  /** Postfach (mit Status und Fristen der Runde) und Rolle: g = Wichtel, r = Beschenkte:r. */
  mailboxByToken(req, roles) {
    const [role, mid, token] = this.authParts(req, roles);
    const mb = one(this.db, 'SELECT m.*, r.status, r.wish_deadline, r.event_date, r.teams_ct FROM mailboxes m JOIN rounds r ON r.id = m.round_id WHERE m.id = ?', mid);
    if (!mb || !safeEqual(mb[role === 'g' ? 'giver_hash' : 'receiver_hash'], sha256(token))) invalidLink();
    return [mb, role];
  }

  mailboxView(req) {
    const [mb, role] = this.mailboxByToken(req, 'g|r');
    const now = this.now();
    const messages = all(this.db, 'SELECT id, direction, body_ct, created_day FROM messages WHERE mailbox_id = ? ORDER BY id', mb.id)
      .map((m) => ({ id: m.id, direction: m.direction, bodyCt: m.body_ct, day: m.created_day }));
    // Rätselhinweise: der Wichtel sieht alle eigenen; die beschenkte Person nur freigeschaltete –
    // der Inhalt künftiger Hinweise verlässt den Server vorher nicht (nur Anzahl und nächster Termin).
    const hints = all(this.db, 'SELECT id, body_ct, release_at FROM hints WHERE mailbox_id = ? ORDER BY release_at, id', mb.id);
    const visible = role === 'g' ? hints : hints.filter((x) => x.release_at <= now);
    const pending = hints.filter((x) => x.release_at > now);
    return json({
      wishCt: mb.wish_ct,
      wishDay: mb.wish_day,
      wishRev: mb.wish_rev,
      wishFrozenAt: mb.wish_frozen_at ?? null,
      messages,
      hints: visible.map((x) => ({ id: x.id, bodyCt: x.body_ct, releaseAt: x.release_at })),
      hintsPending: role === 'r' ? pending.length : undefined,
      nextHintAt: role === 'r' ? pending[0]?.release_at ?? null : undefined,
      openUntil: mb.event_date + POST_EVENT,
    });
  }

  /** Beschenkte:r hinterlegt die eigene Wunschliste für den Wichtel (mit dem Paar-Schlüssel verschlüsselt). */
  mailboxWish(req) {
    const [mb] = this.mailboxByToken(req, 'r');
    // Team-Wichteln: mehrere Mitglieder teilen einen Wunschzettel. Wer schreibt, nennt den Stand, den er gesehen
    // hat; hat inzwischen jemand anderes gespeichert, gibt es 409 statt stillem Überschreiben.
    const rev = V.int(req.body, 'rev', true);
    if (mb.teams_ct !== null && rev === null) throw new HttpError(409, 'draw_kind', 'Bitte die Seite neu laden, damit die aktuelle Version der App geladen wird.');
    if (rev !== null && rev !== mb.wish_rev) throw new HttpError(409, 'conflict', 'Jemand aus deinem Team hat den Wunschzettel gerade geändert. Bitte neu laden und erneut speichern.');
    // Nach der Wunschfrist nur noch die erste Übergabe (Inhalt ist dann ohnehin eingefroren) –
    // und der Widerruf einer Einwilligung (siehe saveWishes).
    // withdraw gibt es nur für die persönliche Wunschliste (Widerruf einer Einwilligung); der Team-Wunschzettel hat
    // keine Gesundheitsangaben – sonst ließe sich darüber die Wunschfrist umgehen.
    const withdraw = get(req.body, 'withdraw') === true && mb.teams_ct === null;
    const now = this.now();
    if (!withdraw && now >= mb.wish_deadline && mb.wish_ct !== null) throw new HttpError(409, 'deadline', 'Die Wunschfrist ist abgelaufen.');
    // Festlegung (2.11, nur Personen-Runden): frozenAt = Zeitpunkt aus der eigenen Festlegung, null = aufgehoben.
    // Aufheben darf nur die beschenkte Person selbst (r-Token); ihre App tut das erst nach Freigabe durch die
    // Organisator:in. Der Wichtel sieht jede Änderung des Zustands.
    let frozenAt = mb.wish_frozen_at;
    if (has(req.body, 'frozenAt')) {
      if (mb.teams_ct !== null) throw new HttpError(409, 'team', 'Beim Team-Wichteln lassen sich Wünsche nicht festlegen.');
      const f = V.int(req.body, 'frozenAt', true);
      if (f !== null && f < now - 400 * DAY) fail('frozenAt');
      // Einmal gesetzt und nach der Korrekturzeit: Inhalt bleibt gesperrt (nur Aufheben mit null geht)
      if (f !== null && !withdraw && mb.wish_frozen_at !== null && now >= mb.wish_frozen_at + FREEZE_GRACE && mb.wish_ct !== null) {
        throw new HttpError(409, 'wishes_frozen', 'Die Wünsche sind festgelegt.');
      }
      frozenAt = f === null ? null : (mb.wish_frozen_at ?? Math.min(f, now)); // Uhr des Geräts kann vorgehen
    } else if (!withdraw && mb.wish_frozen_at !== null && now >= mb.wish_frozen_at + FREEZE_GRACE && mb.wish_ct !== null) {
      throw new HttpError(409, 'wishes_frozen', 'Die Wünsche sind festgelegt.');
    }
    const res = run(this.db, 'UPDATE mailboxes SET wish_ct = ?, wish_day = ?, wish_rev = wish_rev + 1, wish_frozen_at = ? WHERE id = ? AND wish_rev = ?',
      V.ct(req.body, 'wishCt', L.WISH), Math.floor(now / DAY), frozenAt, mb.id, mb.wish_rev);
    if (res.changes !== 1) throw new HttpError(409, 'conflict', 'Jemand aus deinem Team hat den Wunschzettel gerade geändert. Bitte neu laden und erneut speichern.');
    return noContent(); // neuer Stand = rev + 1
  }

  mailboxMessage(req) {
    const [mb, role] = this.mailboxByToken(req, 'g|r');
    if (this.now() >= mb.event_date + POST_EVENT) throw new HttpError(409, 'deadline', 'Die Wichtelpost ist geschlossen (eine Woche nach dem Wichteldatum).');
    const ct = V.ct(req.body, 'bodyCt', L.MESSAGE);
    if (value(this.db, 'SELECT COUNT(*) FROM messages WHERE mailbox_id = ?', mb.id) >= MAX_MESSAGES) throw new HttpError(409, 'too_many', 'Dieses Postfach ist voll.');
    run(this.db, 'INSERT INTO messages (mailbox_id, direction, body_ct, created_day) VALUES (?, ?, ?, ?)',
      mb.id, role === 'g' ? 'frage' : 'antwort', ct, Math.floor(this.now() / DAY));
    return json({ ok: true }, 201);
  }

  /** Rätselhinweis des Wichtels, freigeschaltet zum gewählten Zeitpunkt (spätestens am Wichteldatum). */
  addHint(req) {
    const [mb] = this.mailboxByToken(req, 'g');
    const now = this.now();
    const id = V.id(req.body, 'id');
    const releaseAt = V.int(req.body, 'releaseAt');
    if (releaseAt < now - 60 || releaseAt > mb.event_date) throw new HttpError(400, 'invalid_releaseAt', 'Der Hinweis muss zwischen jetzt und dem Wichteldatum erscheinen.');
    const ct = V.ct(req.body, 'bodyCt', L.HINT);
    if (value(this.db, 'SELECT COUNT(*) FROM hints WHERE mailbox_id = ?', mb.id) >= MAX_HINTS) throw new HttpError(409, 'too_many', `Höchstens ${MAX_HINTS} Hinweise.`);
    try {
      run(this.db, 'INSERT INTO hints (id, mailbox_id, body_ct, release_at) VALUES (?, ?, ?, ?)', id, mb.id, ct, Math.max(releaseAt, now));
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'Bitte erneut versuchen.');
      throw e;
    }
    return json({ ok: true }, 201);
  }

  /** Noch nicht freigeschaltete Hinweise kann der Wichtel zurückziehen. */
  deleteHint(req, hid) {
    const [mb] = this.mailboxByToken(req, 'g');
    const changes = run(this.db, 'DELETE FROM hints WHERE id = ? AND mailbox_id = ? AND release_at > ?', hid, mb.id, this.now()).changes;
    if (changes !== 1) throw new HttpError(409, 'released', 'Dieser Hinweis ist schon sichtbar und bleibt bestehen.');
    return noContent();
  }

  // ------------------------------------------------------------------ Gruppenlink (optional)

  /**
   * Gruppenlink anlegen oder ersetzen: ein Link für alle, jede Person trägt sich selbst ein.
   * Der Server kennt nur den Hash des Tokens; joinCt (Token mit K_admin) braucht die Organisator:in zum erneuten Teilen.
   */
  setJoin(req, roundId) {
    const round = this.adminRound(req, roundId);
    requireStatus(round, 'offen');
    const b = req.body;
    const joinHash = V.hash(b, 'joinHash');
    const joinCt = V.ct(b, 'joinCt', L.JOIN);
    const until = V.int(b, 'until');
    const max = V.int(b, 'max');
    if (until <= this.now() || until > round.event_date) throw new HttpError(400, 'invalid_until', 'Der Gruppenlink muss in der Zukunft und spätestens am Wichteldatum ablaufen.');
    if (max < 1 || max > this.config.max_participants) fail('max', `1 bis ${this.config.max_participants} Personen`);
    run(this.db, 'UPDATE rounds SET join_hash = ?, join_ct = ?, join_until = ?, join_max = ?, join_used = 0 WHERE id = ?', joinHash, joinCt, until, max, roundId);
    return noContent();
  }

  deleteJoin(req, roundId) {
    this.adminRound(req, roundId);
    run(this.db, 'UPDATE rounds SET join_hash = NULL, join_ct = NULL, join_until = NULL, join_max = NULL, join_used = 0 WHERE id = ?', roundId);
    return noContent();
  }

  /** Runde zum Gruppenlink (j.<rundenId>.<token>); wirft 410, wenn der Link nicht (mehr) gilt. */
  joinRound(req) {
    const [, roundId, token] = this.authParts(req, 'j');
    const round = one(this.db, 'SELECT * FROM rounds WHERE id = ?', roundId);
    if (!round || !round.join_hash || !safeEqual(round.join_hash, sha256(token))) notFound();
    const closed = (msg) => new HttpError(410, 'join_closed', msg);
    if (round.status !== 'offen') throw closed('Die Ziehung ist schon erfolgt – Eintragen ist nicht mehr möglich.');
    if (this.now() >= round.join_until) throw closed('Dieser Gruppenlink ist abgelaufen. Bitte die Organisator:in um eine Einladung.');
    if (round.join_used >= round.join_max) throw closed('Über diesen Gruppenlink haben sich schon alle vorgesehenen Personen eingetragen.');
    return round;
  }

  joinView(req) {
    const round = this.joinRound(req);
    const count = value(this.db, 'SELECT COUNT(*) FROM participants WHERE round_id = ?', round.id);
    return json({ round: roundPublic(round), free: Math.max(0, Math.min(round.join_max - round.join_used, this.config.max_participants - count)) });
  }

  /** Selbst eintragen: legt eine angenommene Teilnahme mit Zusage an (wie Einladung + Annehmen + „dabei“). */
  join(req) {
    const now = this.now();
    this.limiter.hit('claim', req.ip, now);
    const round = this.joinRound(req);
    const b = req.body;
    const pid = V.id(b, 'id');
    const nameCt = V.ct(b, 'nameCt', L.NAME);
    const accessHash = V.hash(b, 'accessHash');
    const pubkey = V.pubkey(b, 'pubkey');
    const recoveryHash = V.hash(b, 'recoveryHash');
    const recoveryCt = V.ct(b, 'recoveryCt', L.RECOVERY);
    const max = this.config.max_participants;
    try {
      tx(this.db, () => {
        const r = one(this.db, 'SELECT join_used, join_max FROM rounds WHERE id = ?', round.id);
        if (r.join_used >= r.join_max) throw new HttpError(410, 'join_closed', 'Über diesen Gruppenlink haben sich schon alle vorgesehenen Personen eingetragen.');
        if (value(this.db, 'SELECT COUNT(*) FROM participants WHERE round_id = ?', round.id) >= max) {
          throw new HttpError(409, 'full', `Die Runde ist voll (höchstens ${max} Personen).`);
        }
        run(this.db, `INSERT INTO participants (id, round_id, invite_hash, invite_ct, claimed_at, access_hash, pubkey, name_ct, rsvp, recovery_hash, recovery_ct, via_group, created_at)
                      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'dabei', ?, ?, 1, ?)`,
        pid, round.id, sha256(crypto.randomBytes(32)), now, accessHash, pubkey, nameCt, recoveryHash, recoveryCt, now);
        run(this.db, 'UPDATE rounds SET join_used = join_used + 1 WHERE id = ?', round.id);
      });
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'Bitte erneut versuchen.');
      throw e;
    }
    return json({ id: pid }, 201);
  }

  // ------------------------------------------------------------------ Einladung

  inviteView(req) {
    const [p, round] = this.personByToken(req, 'i');
    if (p.claimed_at !== null) throw new HttpError(410, 'invite_used', 'Diese Einladung wurde bereits eingelöst.');
    return json({ round: roundPublic(round), me: { id: p.id, nameCt: p.name_ct } });
  }

  claim(req) {
    const now = this.now();
    this.limiter.hit('claim', req.ip, now);
    const [p, round] = this.personByToken(req, 'i');
    requireStatus(round, 'offen');
    const b = req.body;
    const accessHash = V.hash(b, 'accessHash');
    const pubkey = V.pubkey(b, 'pubkey');
    const recoveryHash = V.hash(b, 'recoveryHash');
    const recoveryCt = V.ct(b, 'recoveryCt', L.RECOVERY);
    let changes;
    try {
      changes = run(this.db, `UPDATE participants SET claimed_at = ?, access_hash = ?, pubkey = ?, recovery_hash = ?, recovery_ct = ?, invite_ct = NULL
                               WHERE id = ? AND claimed_at IS NULL AND invite_hash = ?`,
      now, accessHash, pubkey, recoveryHash, recoveryCt, p.id, p.invite_hash).changes;
    } catch (e) {
      if (isUnique(e)) throw new HttpError(409, 'exists', 'Bitte erneut versuchen.');
      throw e;
    }
    if (changes !== 1) throw new HttpError(410, 'invite_used', 'Diese Einladung wurde bereits eingelöst.');
    return json({ ok: true });
  }

  // ------------------------------------------------------------------ Teilnehmende

  me(req) {
    const [p, round] = this.personByToken(req, 'p');
    const day = Math.floor(this.now() / DAY);
    if (p.last_seen_day !== day) run(this.db, 'UPDATE participants SET last_seen_day = ? WHERE id = ?', day, p.id);
    // Erstes Öffnen nach der Ziehung: Die App gibt jetzt die Wunschliste an den Wichtel weiter.
    if (round.status === 'gezogen' && p.assignment_ct !== null && p.draw_seen === 0) run(this.db, 'UPDATE participants SET draw_seen = 1 WHERE id = ?', p.id);
    const c = one(this.db, "SELECT COUNT(*) AS total, SUM(rsvp = 'dabei') AS dabei FROM participants WHERE round_id = ?", round.id);
    return json({
      round: roundPublic(round),
      me: {
        id: p.id,
        nameCt: p.name_ct,
        rsvp: p.rsvp,
        wishCt: p.wish_ct,
        assignmentCt: p.assignment_ct,
        mailboxkeyCt: p.mailboxkey_ct,
        hasEmail: p.email_ct !== null,
        notify: Boolean(p.notify),
        teamCt: p.team_ct,
        doneCt: p.done_ct,
        wishFrozenAt: p.wish_frozen_at ?? null,
        unlockRequested: p.wish_unlock_req === 1,
        mixCt: p.mix_ct ?? null,
      },
      // Wichtel-Mixtape (2.11): Lieder der anderen Zusagenden – ohne Personen-ID, sortiert nach Chiffretext
      mixCts: all(this.db, "SELECT mix_ct FROM participants WHERE round_id = ? AND id <> ? AND rsvp = 'dabei' AND mix_ct IS NOT NULL ORDER BY mix_ct", round.id, p.id)
        .map((x) => x.mix_ct),
      counts: { invited: c.total, dabei: c.dabei ?? 0 },
      // Team-Wichteln: Teamwahlen aller Zusagenden für die Anzahl je Team – mit der zufälligen Personen-ID (an sie ist
      // der Chiffretext gebunden), ohne Namen. Sortiert nach ID, die Reihenfolge verrät nichts.
      teamCts: round.teams_ct === null ? undefined
        : all(this.db, "SELECT id, team_ct FROM participants WHERE round_id = ? AND team_ct IS NOT NULL AND rsvp = 'dabei' ORDER BY id", round.id)
          .map((x) => ({ id: x.id, teamCt: x.team_ct })),
    });
  }

  rsvp(req) {
    const [p, round] = this.personByToken(req, 'p');
    requireStatus(round, 'offen');
    if (this.now() >= round.rsvp_deadline) throw new HttpError(409, 'deadline', 'Die Antwortfrist ist abgelaufen.');
    const rsvp = V.enum(req.body, 'rsvp', ['dabei', 'raus']);
    run(this.db, 'UPDATE participants SET rsvp = ? WHERE id = ?', rsvp, p.id);
    return json({ rsvp });
  }

  // ------------------------------------------------------------------ Wiederherstellung

  /** Neuer Wiederherstellungscode, z. B. auf einem zweiten Gerät. Der alte wird ungültig. */
  replaceRecovery(req) {
    const [p] = this.personByToken(req, 'p');
    const hash = V.hash(req.body, 'recoveryHash');
    const ct = V.ct(req.body, 'recoveryCt', L.RECOVERY);
    run(this.db, 'UPDATE participants SET recovery_hash = ?, recovery_ct = ? WHERE id = ?', hash, ct, p.id);
    return noContent();
  }

  recover(req) {
    this.limiter.hit('recover', req.ip, this.now());
    const token = V.pubkey(req.body, 'recoveryToken'); // 32 Byte, Base64url
    const accessHash = V.hash(req.body, 'accessHash');
    const p = one(this.db, 'SELECT id, round_id, recovery_ct FROM participants WHERE recovery_hash = ?', sha256(token));
    if (!p) throw new HttpError(404, 'not_found', 'Code unbekannt oder Runde bereits gelöscht.');
    run(this.db, 'UPDATE participants SET access_hash = ? WHERE id = ?', accessHash, p.id);
    return json({ roundId: p.round_id, pid: p.id, recoveryCt: p.recovery_ct });
  }

  // ------------------------------------------------------------------ E-Mail-Modus

  emailFlag(b) {
    const v = get(b, 'emailEnabled') ?? false;
    if (typeof v !== 'boolean') fail('emailEnabled');
    if (v && !this.mailer) throw noMailer();
    return v;
  }

  /** Optionaler Titel für Betreffzeilen – mit dem Serverschlüssel verschlüsselt. */
  mailTitleCt(b, roundId) {
    const t = get(b, 'mailTitle');
    if (t === null || t === '') return null;
    if (typeof t !== 'string' || chars(t) > MAIL_TITLE_MAX || /[\x00-\x1F\x7F]/.test(t)) fail('mailTitle');
    return this.sc.seal(phpTrim(t), `title|${roundId}`);
  }

  /** [Server-Chiffrat, Anzeige-Chiffrat (K_admin)] einer optionalen Adresse. */
  emailFields(b, round, pid) {
    const raw = get(b, 'email');
    if (raw === null || raw === '') return [null, null];
    if (!round.email_enabled) throw new HttpError(409, 'email_disabled', 'Für diese Runde ist der E-Mail-Modus nicht eingeschaltet.');
    const email = validEmail(raw);
    if (email === null) fail('email');
    const view = V.ct(b, 'emailViewCt', L.EMAIL_VIEW);
    return [this.sc.seal(email, `email|${pid}`), view];
  }

  setEmail(req, roundId, pid) {
    const round = this.adminRound(req, roundId);
    requireStatus(round, 'offen', 'gezogen');
    this.participantOf(roundId, pid);
    const [ct, view] = this.emailFields(req.body, round, pid);
    run(this.db, 'UPDATE participants SET email_ct = ?, email_view_ct = ?, notify = 1 WHERE id = ?', ct, view, pid);
    return noContent();
  }

  setNotify(req) {
    const [p] = this.personByToken(req, 'p');
    const v = get(req.body, 'notify');
    if (typeof v !== 'boolean') fail('notify');
    run(this.db, 'UPDATE participants SET notify = ? WHERE id = ?', v ? 1 : 0, p.id);
    return json({ notify: v });
  }

  deleteOwnEmail(req) {
    const [p] = this.personByToken(req, 'p');
    run(this.db, 'UPDATE participants SET email_ct = NULL, email_view_ct = NULL WHERE id = ?', p.id);
    return noContent();
  }

  /**
   * Verschickt einen Link per Mail. Der Link enthält Schlüssel; er wird geprüft, versendet und sofort verworfen –
   * nie gespeichert oder protokolliert.
   *   invite   – Organisator:in schickt die aktuelle Einladung an die hinterlegte Adresse einer Person
   *   personal – Teilnehmende:r schickt sich den eigenen Link an die hinterlegte Adresse
   *   admin    – Organisator:in schickt sich den Admin-Link an eine Adresse, die nicht gespeichert wird
   */
  async mailLink(req) {
    if (!this.mailer) throw noMailer();
    this.limiter.hit('mail', req.ip, this.now());
    const b = req.body;
    const kind = V.enum(b, 'kind', ['invite', 'personal', 'admin']);
    const link = V.str(b, 'link', 400);
    if (this.baseUrl === '') throw new HttpError(500, 'config', 'base_url ist nicht konfiguriert.');
    const base = escapeRe(`${this.baseUrl}/#`);
    const ID = '([A-Za-z0-9_-]{22})';
    const KEY = '[A-Za-z0-9_-]{43}';
    let email;
    let mail;

    if (kind === 'invite') {
      const [, roundId] = this.authParts(req, 'a');
      const round = this.adminRound(req, roundId);
      requireStatus(round, 'offen', 'gezogen');
      const pid = V.id(b, 'pid');
      const p = this.participantOf(roundId, pid);
      const m = new RegExp(`^${base}i/${roundId}/${pid}/${ID}/${KEY}$`).exec(link);
      if (!m || !safeEqual(p.invite_hash, sha256(m[1])) || p.claimed_at !== null) throw new HttpError(400, 'invalid_link', 'Der Einladungslink passt nicht zu dieser Person.');
      email = round.email_enabled ? this.sc.open(p.email_ct, `email|${pid}`) : null;
      if (email === null) throw new HttpError(409, 'no_email', 'Für diese Person ist keine E-Mail-Adresse hinterlegt.');
      this.limiter.hit('mail_round', `round|${roundId}`, this.now());
      mail = Texts.invite(this.mailTitle(round), link, this.baseUrl, round.delete_after, round.lang);
    } else if (kind === 'personal') {
      const [p, round] = this.personByToken(req, 'p');
      const [, , token] = this.authParts(req, 'p');
      const m = new RegExp(`^${base}p/${round.id}/${p.id}/${ID}/${KEY}/${KEY}$`).exec(link);
      if (!m || !safeEqual(m[1], token)) throw new HttpError(400, 'invalid_link', 'Der Link passt nicht zu deinem Zugang.');
      email = round.email_enabled ? this.sc.open(p.email_ct, `email|${p.id}`) : null;
      if (email === null) throw new HttpError(409, 'no_email', 'Für dich ist keine E-Mail-Adresse hinterlegt.');
      this.limiter.hit('mail_round', `round|${round.id}`, this.now());
      mail = Texts.personalLink(this.mailTitle(round), link, this.baseUrl, round.delete_after, round.lang);
    } else {
      const [, roundId, token] = this.authParts(req, 'a');
      const round = this.adminRound(req, roundId);
      const m = new RegExp(`^${base}a/${roundId}/${ID}/${KEY}/${KEY}$`).exec(link);
      if (!m || !safeEqual(m[1], token)) throw new HttpError(400, 'invalid_link', 'Der Admin-Link passt nicht zu dieser Runde.');
      // Runden ohne Organisator-Code (SEC-012): Mails an frei gewählte Adressen nur, wenn der Admin E-Mail für solche
      // Runden erlaubt (gleiche Regel wie emailAvailable in adminView) – sonst könnte jede:r ohne Code Mails auslösen.
      if (round.without_code === 1 && round.email_enabled !== 1 && !openSettings(this.db).email) {
        throw new HttpError(409, 'email_needs_code', 'E-Mail-Versand gibt es nur für Runden mit Organisator-Code.');
      }
      email = validEmail(get(b, 'email'));
      if (email === null) fail('email');
      // Die Adresse ist frei gewählt (SEC-002): wenige Mails je Runde, und ohne den Mail-Titel der Runde –
      // so lässt sich der Versand nicht als Kanal für eigene Texte an fremde Adressen nutzen.
      this.limiter.hit('mail_admin', `round|${roundId}`, this.now());
      this.limiter.hit('mail_round', `round|${roundId}`, this.now());
      mail = Texts.adminLink(null, link, this.baseUrl, round.delete_after, round.lang);
    }

    try {
      await this.mailer.send(email, mail[0], mail[1]);
    } catch (e) {
      console.error(`ZeroWichtel Mail: ${e.message}`);
      throw new HttpError(502, 'mail_failed', 'Die E-Mail konnte nicht verschickt werden. Bitte später erneut versuchen oder den Link teilen.');
    }
    return json({ sent: true });
  }
}
