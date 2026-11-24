// Benachrichtigungen im E-Mail-Modus (läuft im Hintergrund des Servers).
//
//  - Erinnerung an die Antwortfrist: 48 h vorher, an alle ohne Antwort
//  - Hinweis nach der Ziehung (auch nach einer Neuziehung): an alle Gezogenen
//  - Erinnerung an die Wunschfrist: 48 h vorher, an alle Zusagenden
//  - Nachricht der Organisator:in an alle (2.14): Hinweis ohne Inhalt, nur auf Wunsch, höchstens einmal am Tag
//  - Tageshinweis „Neue Wichtelpost“: höchstens einmal am Tag, an ALLE Zusagenden der Runde.
//    Der Server weiß nicht, welches Postfach zu wem gehört – ein gezielter Hinweis würde die Zuordnung verraten.
// Jede Mail enthält einen Direktlink ohne Geheimnis (#zu/<personId>), der auf dem eigenen Gerät zur Seite führt.
// Jede Benachrichtigung wird pro Runde genau einmal ausgelöst; fehlgeschlagene Mails werden nicht wiederholt.
import { all, run, value } from './db.mjs';
import * as Texts from './mail/texts.mjs';

export const LEAD = 2 * 86400;

export class Notifier {
  constructor(db, mailer, crypto, baseUrl) {
    Object.assign(this, { db, mailer, crypto, baseUrl });
  }

  async run(now, limit = 200) {
    let sent = 0;
    let failed = 0;
    const base = this.baseUrl;
    for (const r of all(this.db, 'SELECT * FROM rounds WHERE email_enabled = 1 AND delete_after > ?', now)) {
      if (sent >= limit) break;
      const title = this.crypto.open(r.mail_title_ct, `title|${r.id}`);
      const del = r.delete_after;
      const jobs = []; // [Spalte, Wert, Empfängerfilter, Text je Person]

      if (r.status === 'offen' && r.reminded_rsvp === null && now >= r.rsvp_deadline - LEAD && now < r.rsvp_deadline) {
        jobs.push(['reminded_rsvp', now, "rsvp = 'offen'", (pid) => Texts.rsvpReminder(title, r.rsvp_deadline, base, del, pid, r.lang)]);
      }
      if (r.status === 'gezogen' && r.drawn_at !== null && (r.notified_draw === null || r.notified_draw < r.drawn_at)) {
        jobs.push(['notified_draw', r.drawn_at, "rsvp = 'dabei' AND assignment_ct IS NOT NULL", (pid) => Texts.drawNotice(title, r.wish_deadline, base, del, pid, r.lang)]);
      }
      if (r.mode === 'wichteln' && r.wish_deadline !== null && r.reminded_wish === null && now >= r.wish_deadline - LEAD && now < r.wish_deadline) {
        jobs.push(['reminded_wish', now, "rsvp = 'dabei'", (pid) => Texts.wishReminder(title, r.wish_deadline, base, del, pid, r.lang)]);
      }
      if (r.status === 'gezogen' && now < r.event_date + 8 * 86400) { // Wichtelpost ist bis eine Woche nach dem Wichteldatum offen
        const maxId = value(this.db, 'SELECT COALESCE(MAX(m.id), 0) FROM messages m JOIN mailboxes b ON b.id = m.mailbox_id WHERE b.round_id = ?', r.id);
        const today = Math.floor(now / 86400);
        if (maxId > r.digest_msg_id && today > r.digest_day) {
          jobs.push(['digest', [maxId, today], "rsvp = 'dabei'", (pid) => Texts.digest(title, base, del, pid, r.lang)]);
        }
      }

      // Nachricht der Organisator:in an alle (2.14): Hinweis ohne Inhalt an alle, die nicht abgesagt haben – nur wenn
      // die Organisator:in ihn beim Senden angefordert hat und die Nachricht noch da ist
      if (r.ann_mail_req > r.ann_mail_done) {
        if (value(this.db, 'SELECT COUNT(*) FROM announcements WHERE rowid = ? AND round_id = ?', r.ann_mail_req, r.id)) {
          jobs.push(['ann_mail_done', r.ann_mail_req, "rsvp <> 'raus'", (pid) => Texts.announcementNotice(title, base, del, pid, r.lang)]);
        } else {
          run(this.db, 'UPDATE rounds SET ann_mail_done = ? WHERE id = ?', r.ann_mail_req, r.id);
        }
      }

      // Neue Rückfragen an die Organisator:in (2.10): höchstens ein Hinweis am Tag, nur wenn eine Adresse hinterlegt ist
      if (r.org_email_ct) {
        const maxQ = value(this.db, 'SELECT COALESCE(MAX(rowid), 0) FROM questions WHERE round_id = ?', r.id);
        const today = Math.floor(now / 86400);
        if (maxQ > r.q_notified_rowid && today > r.q_notified_day && sent < limit) {
          const to = this.crypto.open(r.org_email_ct, `orgemail|${r.id}`);
          if (to) {
            const [subject, text] = Texts.questionNotice(title, base, del, r.lang);
            try {
              await this.mailer.send(to, subject, text);
              sent++;
            } catch (e) {
              failed++;
              console.error(`ZeroWichtel Mail: ${e.message}`);
            }
          }
          run(this.db, 'UPDATE rounds SET q_notified_rowid = ?, q_notified_day = ? WHERE id = ?', maxQ, today, r.id);
        }
      }

      // Antworten auf Rückfragen mit Namen (2.9): einmal je Antwort, nur an die fragende Person
      const answered = all(this.db, `SELECT q.id, q.pid FROM questions q JOIN participants p ON p.id = q.pid
                                     WHERE q.round_id = ? AND q.a_ct IS NOT NULL AND q.notified = 0`, r.id);
      for (const q of answered) {
        if (sent >= limit) break;
        const [rec] = this.#recipients(r.id, 'id = ?', q.pid);
        if (rec) {
          const [subject, text] = Texts.answerNotice(title, base, del, rec[0], r.lang);
          try {
            await this.mailer.send(rec[1], subject, text);
            sent++;
          } catch (e) {
            failed++;
            console.error(`ZeroWichtel Mail: ${e.message}`);
          }
        }
        run(this.db, 'UPDATE questions SET notified = 1 WHERE id = ?', q.id);
      }

      for (const [flag, val, filter, compose] of jobs) {
        for (const [pid, email] of this.#recipients(r.id, filter)) {
          const [subject, text] = compose(pid);
          try {
            await this.mailer.send(email, subject, text);
            sent++;
          } catch (e) {
            failed++;
            console.error(`ZeroWichtel Mail: ${e.message}`);
          }
        }
        if (flag === 'digest') run(this.db, 'UPDATE rounds SET digest_msg_id = ?, digest_day = ? WHERE id = ?', val[0], val[1], r.id);
        else run(this.db, `UPDATE rounds SET ${flag} = ? WHERE id = ?`, val, r.id);
      }
    }
    return { sent, failed };
  }

  /** [Personen-ID, entschlüsselte Adresse] aller passenden Empfänger:innen. */
  #recipients(roundId, filter, ...args) {
    return all(this.db, `SELECT id, email_ct FROM participants WHERE round_id = ? AND email_ct IS NOT NULL AND notify = 1 AND ${filter}`, roundId, ...args)
      .map((p) => [p.id, this.crypto.open(p.email_ct, `email|${p.id}`)])
      .filter(([, email]) => email !== null);
  }
}
