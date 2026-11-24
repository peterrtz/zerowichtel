// Mailtexte (Deutsch und Englisch, je nach Sprache der Runde).
// Grundsatz: keine Inhalte – keine Namen, keine Wünsche, keine Zuordnung. Höchstens der optionale Titel,
// den die Organisator:in ausdrücklich für Mails freigegeben hat. Jede Funktion liefert [Betreff, Text].

const FMT = {
  de: new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }),
  en: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'long', year: 'numeric' }),
};
const L = (lang) => (lang === 'en' ? 'en' : 'de');

/** Datum als TT.MM.JJJJ (deutsch) bzw. „5 December 2026“ (englisch), deutsche Zeit. */
export const date = (ts, lang = 'de') => FMT[L(lang)].format(new Date(ts * 1000));

const S = {
  de: {
    subject: (what, title) => `ZeroWichtel: ${what}${title ? ` – ${title}` : ''}`,
    round: (title) => (title ? `der Wichtelrunde „${title}“` : 'deiner Wichtelrunde'),
    hello: 'Hallo!',
    jump: ['Direkt zu deiner Seite:', '(Funktioniert auf dem Gerät, auf dem du die Einladung angenommen hast. Auf anderen Geräten öffne deinen persönlichen Link oder nutze deinen Wiederherstellungscode.)'],
    sent: (base) => `Diese Nachricht hat ZeroWichtel (${base}) automatisch verschickt. Bitte nicht antworten.`,
    optOut: 'Keine Erinnerungen mehr? Öffne deinen persönlichen Link und schalte unter „E-Mail“ die Erinnerungen aus.',
    deleted: (d) => `Alle Daten der Runde werden spätestens am ${d} endgültig gelöscht.`,
    invite: ['Einladung zum Wichteln', (r) => `Du bist zu ${r} eingeladen. Öffne deine persönliche Einladung:`,
      ['Der Link gilt nur für dich und lässt sich genau einmal annehmen. Bitte nicht weiterleiten.', 'ZeroWichtel braucht kein Konto; alles Persönliche wird in deinem Browser verschlüsselt.']],
    personal: ['Dein persönlicher Link', (r) => `Hier ist dein persönlicher Link zu ${r}:`, ['Er enthält deinen Schlüssel. Bitte niemandem weitergeben.']],
    admin: ['Dein Admin-Link', (r) => `Hier ist der Admin-Link zur Verwaltung ${r}:`,
      ['Es gibt keine andere Möglichkeit, in die Verwaltung zu kommen. Gut aufbewahren und nicht weitergeben.', 'Diese Adresse wurde nicht gespeichert.']],
    rsvp: ['Bist du dabei?', (r, d) => `Du hast bei ${r} noch nicht geantwortet. Die Antwortfrist endet am ${d}.`,
      'Öffne deinen persönlichen Link (oder die Einladung, falls du sie noch nicht angenommen hast) und sag „dabei“ oder „diesmal raus“.'],
    draw: ['Es wurde ausgelost', (r) => `Bei ${r} wurde ausgelost. Öffne deine Seite, um zu sehen, wen du beschenkst.`,
      'Wichtig: Erst wenn du deine Seite einmal geöffnet hast, sieht dein Wichtel deine Wunschliste.'],
    drawReminder: ['Erinnerung: Es wurde ausgelost', (r) => `Bei ${r} wurde schon ausgelost – du hast aber noch nicht nachgesehen, wen du beschenkst.`,
      'Bitte öffne deine Seite einmal: Erst dann bekommt dein Wichtel deine Wunschliste.'],
    wishUntil: (d) => `Wünsche kannst du bis zum ${d} ändern.`,
    wish: ['Wunschliste prüfen', (r, d) => `Bei ${r} endet die Wunschfrist am ${d}.`, 'Wenn du noch etwas ergänzen möchtest – oder „keine Idee“ angeben –, öffne deine Seite.'],
    question: ['Neue Rückfrage', (r) => `In ${r} gibt es eine neue Rückfrage an dich.`, 'Öffne deinen Admin-Link, um sie zu lesen und zu beantworten. Dieser Hinweis kommt höchstens einmal am Tag und verrät nicht, wer gefragt hat. Abbestellen: Adresse in der Verwaltung unter „Rückfragen“ entfernen.'],
    answer: ['Antwort auf deine Rückfrage', (r) => `In ${r} hat die Organisator:in auf deine Rückfrage geantwortet.`, 'Öffne deine Seite, um die Antwort zu lesen.'],
    announce: ['Nachricht der Organisator:in', (r) => `In ${r} hat die Organisator:in eine Nachricht an alle geschrieben.`,
      ['Der Text steht verschlüsselt auf deiner Seite – nur ihr in der Runde könnt ihn lesen. Dort siehst du auch, ob bei dir noch etwas offen ist.']],
    digest: ['Neue Wichtelpost', (r) => `In ${r} gibt es neue anonyme Nachrichten.`,
      ['Diese Erinnerung geht an alle in der Runde – sie verrät nicht, wer wem geschrieben hat.', 'Öffne deine Seite, um nachzusehen.']],
  },
  en: {
    subject: (what, title) => `ZeroWichtel: ${what}${title ? ` – ${title}` : ''}`,
    round: (title) => (title ? `the Secret Santa “${title}”` : 'your Secret Santa'),
    hello: 'Hello!',
    jump: ['Straight to your page:', '(Works on the device where you accepted the invitation. On other devices, open your personal link or use your recovery code.)'],
    sent: (base) => `This message was sent automatically by ZeroWichtel (${base}). Please do not reply.`,
    optOut: 'No more reminders? Open your personal link and switch off reminders under “Email”.',
    deleted: (d) => `All data of this round will be permanently deleted on ${d} at the latest.`,
    invite: ['Secret Santa invitation', (r) => `You are invited to ${r}. Open your personal invitation:`,
      ['The link is for you only and can be accepted exactly once. Please do not forward it.', 'ZeroWichtel needs no account; everything personal is encrypted in your browser.']],
    personal: ['Your personal link', (r) => `Here is your personal link to ${r}:`, ['It contains your key. Please do not share it with anyone.']],
    admin: ['Your admin link', (r) => `Here is the admin link to manage ${r}:`,
      ['There is no other way to access the management page. Keep it safe and do not share it.', 'This address has not been stored.']],
    rsvp: ['Are you in?', (r, d) => `You have not answered yet for ${r}. The reply deadline is ${d}.`,
      'Open your personal link (or the invitation, if you have not accepted it yet) and say “I’m in” or “not this time”.'],
    draw: ['Names have been drawn', (r) => `Names have been drawn for ${r}. Open your page to see who you are giving a present to.`,
      'Important: your Secret Santa only sees your wish list once you have opened your page.'],
    drawReminder: ['Reminder: names have been drawn', (r) => `Names have been drawn for ${r} – but you have not looked yet who you are giving a present to.`,
      'Please open your page once: only then does your Secret Santa receive your wish list.'],
    wishUntil: (d) => `You can change your wishes until ${d}.`,
    wish: ['Check your wish list', (r, d) => `The wish list deadline for ${r} is ${d}.`, 'If you want to add something – or say “no idea” – open your page.'],
    question: ['New question', (r) => `There is a new question for you in ${r}.`, 'Open your admin link to read and answer it. This notice comes at most once a day and does not reveal who asked. To stop it, remove the address under “Questions” in the admin view.'],
    answer: ['Reply to your question', (r) => `The organiser of ${r} has replied to your question.`, 'Open your page to read the reply.'],
    announce: ['Message from the organiser', (r) => `The organiser of ${r} has written a message to everyone.`,
      ['The text is encrypted on your page – only the people in the round can read it. There you can also see whether anything is still open for you.']],
    digest: ['New Secret Santa mail', (r) => `There are new anonymous messages in ${r}.`,
      ['This reminder goes to everyone in the round – it does not reveal who wrote to whom.', 'Open your page to read them.']],
  },
};

/**
 * Direktlink ohne Geheimnis: führt auf dem Gerät, auf dem die Einladung angenommen wurde, zur eigenen Seite
 * (der Zugang ist dort gespeichert). Der vollständige persönliche Link steht nie in automatischen Mails.
 */
const jump = (t, base, pid) => (pid ? ['', t.jump[0], `${base}/#zu/${pid}`, t.jump[1]] : []);

function footer(t, lang, base, deleteAfter, reminder = true) {
  return ['', '–', t.sent(base), ...(reminder ? [t.optOut] : []), t.deleted(date(deleteAfter, lang))].join('\n');
}

const mail = (t, lang, what, title, lines, base, del, reminder = true) => [t.subject(what, title), lines.join('\n') + footer(t, lang, base, del, reminder)];

/** Mails mit Link (Einladung, eigener Link, Admin-Link): der Link steht in der Mitte. */
function linkMail(kind, reminder) {
  return (title, link, base, del, lang = 'de') => {
    const t = S[L(lang)];
    const [what, intro, after] = t[kind];
    return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), '', link, '', ...after], base, del, reminder);
  };
}

export const invite = linkMail('invite', false);
export const personalLink = linkMail('personal', true);
export const adminLink = linkMail('admin', false);

export function rsvpReminder(title, deadline, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, action] = t.rsvp;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title), date(deadline, lang)), '', action, ...jump(t, base, pid)], base, del);
}

export function drawNotice(title, wishDeadline, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, note] = t.draw;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), ...jump(t, base, pid), '', note,
    ...(wishDeadline !== null ? [t.wishUntil(date(wishDeadline, lang))] : [])], base, del);
}

/** Von der Organisator:in ausgelöst, wenn jemand die Seite seit der Ziehung noch nicht geöffnet hat. */
export function drawReminder(title, wishDeadline, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, note] = t.drawReminder;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), note, ...jump(t, base, pid),
    ...(wishDeadline !== null ? ['', t.wishUntil(date(wishDeadline, lang))] : [])], base, del);
}

export function wishReminder(title, deadline, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, action] = t.wish;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title), date(deadline, lang)), action, ...jump(t, base, pid)], base, del);
}

/** Neue Rückfrage an die Organisator:in (2.10) – ohne Inhalt und ohne Link (der Admin-Link wird nie gespeichert). */
export function questionNotice(title, base, del, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, action] = t.question;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), action], base, del, false);
}

/** Antwort auf eine Rückfrage mit Namen (2.9) – ohne Frage und Antwort, nur der Hinweis. */
export function answerNotice(title, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, action] = t.answer;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), action, ...jump(t, base, pid)], base, del);
}

export function announcementNotice(title, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, after] = t.announce;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), ...after, ...jump(t, base, pid)], base, del);
}

export function digest(title, base, del, pid = null, lang = 'de') {
  const t = S[L(lang)];
  const [what, intro, after] = t.digest;
  return mail(t, lang, what, title, [t.hello, '', intro(t.round(title)), ...after, ...jump(t, base, pid)], base, del);
}
