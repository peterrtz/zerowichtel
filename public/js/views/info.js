// Impressum, Datenschutzerklärung und Hilfe.
// Die Betreiberangaben kommen aus config.json (über /api/info) – im Code steht nichts Personenbezogenes.
// Die Texte sind ein sorgfältiger Entwurf, ersetzen aber keine Rechtsberatung.

import { h, add } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { page, card, mount, setTitle, notice, loading } from './common.js';
import { t, lang } from '../lib/i18n.js';

const MISSING = '[in config.json unter „operator“ eintragen]';
const STAND = '18. November 2026';

function operatorBlock(op) {
  const lines = [op.name, op.street, op.city].map((x) => x || null);
  const missing = !op.name || !op.street || !op.city;
  return h('address', { class: 'operator' },
    lines.filter(Boolean).map((l) => [l, h('br')]),
    op.email ? ['E-Mail: ', h('a', { href: `mailto:${op.email}` }, op.email), h('br')] : null,
    op.phone ? [`Telefon: ${op.phone}`, h('br')] : null,
    missing ? h('span', { class: 'muted' }, MISSING) : null);
}

function table(rows) {
  return h('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Tabelle: Welche Daten verarbeitet werden (seitlich scrollbar)' }, h('table', { class: 'legal-table' },
    h('thead', null, h('tr', null, ['Daten', 'Zweck', 'Rechtsgrundlage', 'Speicherdauer'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
}

function privacy(info) {
  const mail = info.mailProvider;
  const mailName = info.mailProviderName || '[E-Mail-Anbieter in config.json unter „privacy“ → „mail_provider“ eintragen]';
  const mailTracking = mail === 'brevo'
    ? 'Der Anbieter leitet Links über eigene Adressen um und erfasst dabei Klicks; Vorschauen und Öffnungs-Tracking sind abgeschaltet, die Mails enthalten kein HTML.'
    : 'Die Mails werden als reiner Text ohne Zählpixel und ohne umgeleitete Links verschickt.';
  const rows = [
    ['Verschlüsselte Inhalte: Titel, Begrüßung, Regeln, Namen, Wünsche und Steckbrief (ohne Gesundheitsangaben), Zuordnung, Nachrichten, Rätselhinweise', 'Durchführung der Wichtelrunde', 'Art. 6 Abs. 1 lit. b DSGVO (Organisator:in); lit. f (berechtigtes Interesse der Teilnehmenden an der Durchführung)', 'bis zur Löschung der Runde, spätestens 14 Tage nach dem Wichteldatum'],
    ['Optional im Steckbrief: Allergien und Unverträglichkeiten (Gesundheitsdaten), verschlüsselt, mit Zeitpunkt der Einwilligung', 'Damit der Wichtel ein verträgliches Geschenk wählen kann; sichtbar nur für den eigenen Wichtel', 'ausdrückliche Einwilligung, Art. 9 Abs. 2 lit. a i. V. m. Art. 6 Abs. 1 lit. a DSGVO', 'bis zum Widerruf, spätestens bis zur Löschung der Runde (14 Tage nach dem Wichteldatum)'],
    ['Zu- oder Absage, Fristen, Status der Runde (Klartext)', 'Ablauf, Erinnerungen, Löschung', 'wie oben', 'wie oben'],
    ['Sprache der Runde, Freischaltzeitpunkte von Rätselhinweisen (Klartext)', 'Sprache automatischer E-Mails; Hinweise erst zum gewählten Zeitpunkt ausliefern', 'wie oben', 'wie oben'],
    ['Gruppenlink (nur falls genutzt): Prüfwert, Ablaufdatum, Höchstzahl, Zahl der Eintragungen; je Person, ob sie sich selbst eingetragen hat', 'Selbst-Eintragen über einen gemeinsamen Link', 'wie oben', 'bis Widerruf des Links bzw. Löschung der Runde'],
    ['Team-Wichteln (nur falls genutzt): Teamliste, gewähltes Team je Person und gemeinsamer Team-Wunschzettel (ohne Gesundheitsangaben), alles verschlüsselt; im Klartext nur, ob eine Runde Teams hat, wie viele Teams gezogen wurden und ein Änderungszähler des Team-Wunschzettels', 'Gemeinsames Beschenken zwischen Teams. Vor der Auslosung sehen Teilnehmende je Team nur die Zahl der Mitglieder (dazu deren zufällige Kennungen, keine Namen); nach der Auslosung sehen sie die Namen im eigenen und im beschenkten Team', 'Art. 6 Abs. 1 lit. b und f DSGVO', 'bis zur Löschung der Runde; Teamwahlen sofort beim Ausschalten des Team-Wichtelns'],
    ['Ob und wann du deine Wünsche festgelegt hast (nur falls genutzt) und ob du um Freigabe gebeten hast – unverschlüsselt, damit der Server Änderungen nach der Korrekturzeit sperren kann', 'Verlässlichkeit für deinen Wichtel; die Organisator:in kann die Festlegung aufheben', 'Art. 6 Abs. 1 lit. b DSGVO', 'bis zur Löschung der Runde'],
    ['Eigener Haken „Geschenk besorgt/gefunden und verpackt“ (nur falls genutzt), verschlüsselt', 'Erinnerung für dich selbst; nur du bekommst ihn angezeigt, nicht die Organisator:in', 'Art. 6 Abs. 1 lit. b DSGVO', 'bis zur Löschung der Runde; bei neuer Auslosung zurückgesetzt'],
    ['Lieder fürs Wichtel-Mixtape (nur falls eingetragen), Ende-zu-Ende-verschlüsselt; die anderen in der Runde sehen sie gemischt und ohne deinen Namen, bis du sie selbst aufdeckst', 'Gemeinsame Trackliste der Runde; „Anhören“ öffnet die Suche beim gewählten Musikdienst erst bei deinem Klick – dann gelten dessen Datenschutzbestimmungen', 'Art. 6 Abs. 1 lit. b DSGVO', 'bis du sie entfernst, spätestens mit der Runde'],
    ['Rückfragen an die Organisator:in und ihre Antworten (nur falls freigegeben), Ende-zu-Ende-verschlüsselt; bei Fragen mit Namen die Zuordnung zur Person, bei anonymen Fragen nur der Tag', 'Hilfe bei Fragen zur Runde; Antwort an die fragende Person, bei Fragen mit Namen im E-Mail-Modus eine Mail ohne Inhalt. Hat die Organisator:in eine Adresse hinterlegt, bekommt sie höchstens einmal am Tag einen Hinweis ohne Inhalt; die Adresse liegt verschlüsselt auf dem Server und wird mit der Runde gelöscht', 'Art. 6 Abs. 1 lit. b DSGVO', 'bis die Organisator:in die Frage löscht, spätestens mit der Runde'],
    ['Analoge Wichtelrunde zum Ausdrucken (nur falls genutzt): ein Zähler, dass eine Runde vorbereitet wurde (gesamt und je Jahr) – ohne Namen, Termine oder Lose; zur Begrenzung kurzzeitig ein täglich wechselnder Prüfwert der IP-Adresse wie bei allen Anfragen', 'Überblick für den Betreiber, wie oft die Funktion genutzt wird; Schutz vor Verfälschung des Zählers', 'Art. 6 Abs. 1 lit. f DSGVO', 'Zähler dauerhaft (ohne Personenbezug); Prüfwert höchstens einen Tag'],
    ['Ohne Smartphone mitwichteln (nur falls genutzt): wer ohne Smartphone teilnimmt und wer dabei hilft (bei Hilfe von außerhalb deren Name), verschlüsselt und nur für die Organisator:in lesbar', 'Die Helfer:in öffnet den Link der Person auf dem eigenen Gerät, sieht für sie Zuordnung, Wünsche und Wichtelpost und trägt in ihrem Namen ein. Wer die Person beschenkt, erfährt davon nichts. Gesundheitsangaben trägt die Helfer:in nur mit Einverständnis der Person ein.', 'Art. 6 Abs. 1 lit. b und f DSGVO; für Gesundheitsangaben wie oben', 'bis zur Löschung der Runde'],
    ['Ob jemand seine Seite nach der Ziehung schon geöffnet hat (ja/nein) und wann zuletzt per E-Mail erinnert wurde', 'Erinnerung durch die Organisator:in, damit Wunschlisten ankommen; verrät nicht, wer wen beschenkt', 'Art. 6 Abs. 1 lit. f DSGVO', 'bis zur Löschung der Runde; zurückgesetzt bei Neuziehung'],
    ['Prüfwerte (Hashes) von Zugangscodes und öffentliche Schlüssel', 'Zugangskontrolle ohne Passwörter', 'wie oben', 'wie oben'],
    ['E-Mail-Adressen (nur im E-Mail-Modus, mit Serverschlüssel verschlüsselt)', 'Einladungen, Links auf Anforderung, Erinnerungen', 'Art. 6 Abs. 1 lit. b und f DSGVO', 'bis Abbestellen/Löschen durch die Person, Abschalten des E-Mail-Modus oder Löschung der Runde'],
    ['Gekürzter, täglich neu gesalzener Prüfwert der IP-Adresse (bei IPv6 des /64-Netzes)', 'Schutz vor Missbrauch (Begrenzung der Anfragen, z. B. höchstens 2 Runden ohne Code je Anschluss und Tag)', 'Art. 6 Abs. 1 lit. f DSGVO', 'höchstens 24 Stunden; die IP-Adresse selbst wird nicht gespeichert'],
    ['Organisator-Einladungscodes (nur Prüfwert, dazu eine Bezeichnung des Betreibers)', 'Freischaltung des Anlegens von Runden', 'Art. 6 Abs. 1 lit. f DSGVO', 'bis Widerruf, spätestens 90 Tage nach Ablauf des Codes'],
  ];
  return [
    germanOnly(),
    h('h1', null, 'Datenschutzerklärung'),
    notice('Entwurf – vor der öffentlichen Freigabe rechtlich prüfen lassen.', 'warn'),
    card('1. Verantwortlicher', operatorBlock(info.operator)),
    card('2. Das Prinzip',
      h('p', null, 'ZeroWichtel ist so gebaut, dass der Betreiber die Inhalte einer Wichtelrunde nicht lesen kann. Titel, Begrüßung, Namen, Wünsche, Nachrichten und die Zuordnung, wer wen beschenkt, werden in deinem Browser verschlüsselt. Die Schlüssel stehen nur im Teil des Links hinter dem „#“; Browser übertragen diesen Teil nie an den Server.'),
      h('p', null, 'Es gibt keine Konten, keine Passwörter, keine Cookies, kein Tracking, keine Werbung und keine eingebundenen Dienste Dritter beim Aufruf der Seite.')),
    card('3. Welche Daten verarbeitet werden', table(rows),
      h('p', { class: 'hint' }, 'Teilnehmende werden von der Organisator:in eingetragen. Pseudonyme sind ausdrücklich erlaubt. Für private Wichtelrunden im Familien- und Freundeskreis gilt für die Organisator:in in der Regel die Haushaltsausnahme (Art. 2 Abs. 2 lit. c DSGVO).')),
    card('3a. Gesundheitsangaben im Steckbrief (Art. 9 DSGVO)',
      h('p', null, 'Allergien und Unverträglichkeiten sind Gesundheitsdaten und damit besondere Kategorien personenbezogener Daten. Das Feld ist freiwillig und lässt sich erst ausfüllen, nachdem du ausdrücklich eingewilligt hast. Ohne Einwilligung entstehen dir keine Nachteile; alle anderen Funktionen bleiben gleich.'),
      h('p', null, 'Die Angabe wird wie deine Wünsche in deinem Browser verschlüsselt und nur deinem Wichtel angezeigt. Der Betreiber kann sie nicht lesen und erfährt nicht, ob es sie gibt. Zeitpunkt und Fassung deiner Einwilligung werden zusammen mit der Angabe verschlüsselt gespeichert.'),
      h('p', null, 'Widerruf (Art. 7 Abs. 3 DSGVO): jederzeit, indem du auf deiner Seite das Häkchen entfernst bzw. „Einwilligung widerrufen“ wählst – auch nach der Wunschfrist. Die Angabe wird dann sofort aus deiner Wunschliste und aus der Kopie für deinen Wichtel gelöscht. Was dein Wichtel bereits gelesen hat, kann die App nicht aus seinem Gedächtnis löschen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung bleibt unberührt.'),
      h('p', null, 'Für Kinder unter 16 Jahren soll eine erziehungsberechtigte Person über die Einwilligung entscheiden.')),
    card('4. Löschung',
      h('p', null, 'Jede Runde wird spätestens 14 Tage nach dem Wichteldatum vollständig und endgültig gelöscht; die Organisator:in kann sie jederzeit sofort löschen. Runden, in denen 30 Tage nach Anlage niemand eine Einladung angenommen hat, werden ebenfalls gelöscht. Gelöschte Daten werden in der Datenbankdatei überschrieben.'),
      info.backupDays > 0
        ? h('p', null, `Zum Schutz vor Datenverlust (z. B. nach einem Serverausfall) sichert der Betreiber die Datenbank regelmäßig. Sicherungen werden spätestens nach ${info.backupDays} Tagen überschrieben; so lange kann eine bereits gelöschte Runde noch in einer Sicherung enthalten sein – mit denselben verschlüsselten Inhalten, die auch der Betreiber nicht lesen kann. Eine Sicherung wird nur zur Wiederherstellung des Dienstes verwendet.`)
        : null,
      h('p', null, 'Sicherungskopien des Hosting-Anbieters können Datenbankstände für dessen Aufbewahrungsfrist enthalten; Inhalte sind darin verschlüsselt.')),
    card('5. Empfänger und Auftragsverarbeiter',
      h('ul', null,
        h('li', null, `Hosting: ${info.hoster || '[Hosting-Anbieter in config.json unter „hoster“ eintragen]'} – Auftragsverarbeitung nach Art. 28 DSGVO.`),
        mail
          ? h('li', null, `E-Mail-Versand (nur im E-Mail-Modus einer Runde): ${mailName} – Auftragsverarbeitung nach Art. 28 DSGVO, Verarbeitung im Europäischen Wirtschaftsraum. Beim Versand eines Links per E-Mail durchläuft dieser den Server und den Mailanbieter; ZeroWichtel speichert ihn nicht. ${mailTracking}`)
          : h('li', null, 'Es findet kein E-Mail-Versand statt.')),
      h('p', null, 'Eine Übermittlung in Drittländer ist nicht vorgesehen.')),
    card('6. Speicherung in deinem Browser',
      h('p', null, 'Damit du deine Runden wiederfindest, speichert die App deine Links und ggf. deinen Wiederherstellungscode im lokalen Speicher dieses Browsers (localStorage). Das ist für den von dir gewünschten Dienst unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Du kannst die Einträge jederzeit auf der Startseite entfernen. Der Server erfährt davon nichts.'),
      h('p', null, 'Stellst du eine anonyme Rückfrage, speichert die App den Schlüssel zum Abholen der Antwort und deinen Fragetext nur hier im lokalen Speicher; ohne ihn ist die Antwort für dich nicht abrufbar. Bei der analogen Wichtelrunde zum Ausdrucken speichert die App deine Eingaben (Namen, Termine, Lose) ebenfalls nur im lokalen Speicher dieses Browsers, damit sie ein Neuladen überstehen – bis du „Alles löschen“ wählst. Auch das ist unbedingt erforderlich für den von dir gewünschten Dienst (§ 25 Abs. 2 Nr. 2 TDDDG). Der Server erfährt davon nichts.'),
      h('p', null, 'Wählst du mit Sonne/Mond ein Design, wird diese Wahl ebenfalls nur in diesem Browser gespeichert („Design wie Gerät“ im Fußbereich entfernt sie).'),
      h('p', null, 'Ebenso nur lokal gespeichert werden, falls du sie nutzt: die gewählte Sprache, ob Schneefall an ist, welche Päckchen du schon ausgepackt hast, und der Spielstand beim Schrottwichteln.'),
      h('p', null, 'Speicherst du deinen Wiederherstellungscode „als Bild“, erzeugt dein Browser das Bild selbst. Lädst du zum Wiederherstellen ein Bild hoch, wird es nur in deinem Browser gelesen und nicht übertragen. Wo du das Bild ablegst (z. B. eine Fotomediathek mit Cloud-Abgleich), entscheidest du.'),
      h('p', null, 'Die Kalenderdatei („In den Kalender“) erzeugt dein Browser selbst; der Server ist daran nicht beteiligt. Was du in deinen Kalender übernimmst, verarbeitet dein Kalenderanbieter nach dessen Bedingungen.')),
    card('7. Server-Protokolle',
      h('p', null, info.noAccessLogs
        ? 'Weder ZeroWichtel noch der vorgeschaltete Webserver schreiben Zugriffsprotokolle mit IP-Adressen. Fehlermeldungen werden ohne IP-Adressen und nur kurz aufbewahrt.'
        : 'ZeroWichtel selbst schreibt keine Zugriffsprotokolle mit IP-Adressen. [Betreiber: in config.json unter „privacy“ → „no_access_logs“ bestätigen, dass auch der Webserver keine schreibt.]')),
    card('8. Deine Rechte',
      h('p', null, 'Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO). Weil der Betreiber Inhalte nicht entschlüsseln kann, kann er Auskunft nur zu den unverschlüsselten Angaben geben; die verschlüsselten Inhalte siehst du selbst in der App.'),
      h('p', null, 'Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (ldi.nrw.de).')),
    card('9. Keine automatisierte Entscheidung',
      h('p', null, 'Die Ziehung ist ein Zufallsverfahren ohne rechtliche Wirkung; es findet kein Profiling statt.')),
    card('10. Grenzen, offen benannt',
      h('ul', null,
        h('li', null, 'Der Betreiber sieht Zeitpunkte von Zugriffen und könnte daraus Vermutungen ableiten.'),
        h('li', null, 'Wer einen Link oder Wiederherstellungscode besitzt, hat Zugang – bitte wie einen Schlüssel behandeln.'),
        h('li', null, 'Die Ziehung läuft im Browser der Organisator:in; mit Entwicklerwerkzeugen ließe sie sich dort mitschneiden.'),
        h('li', null, 'Wer den Server kontrolliert, könnte veränderten Programmcode ausliefern. Deshalb ist ZeroWichtel Open Source, und zu jeder Version werden Prüfsummen veröffentlicht.'))),
    h('p', { class: 'hint' }, `Stand: ${STAND} · Version ${info.version ?? ''}`),
  ];
}

/** Rechtstexte gibt es nur auf Deutsch – im Englischen ein Hinweis darauf. */
function germanOnly() {
  return lang() === 'en' ? h('div', { class: 'notice notice-info', lang: 'en' }, 'This page is only available in German. The German version is the legally binding one.') : null;
}

function imprint(info) {
  return [
    germanOnly(),
    h('h1', null, 'Impressum'),
    card('Angaben gemäß § 5 DDG und § 18 Abs. 1 MStV', operatorBlock(info.operator)),
    card('Verantwortlich für den Inhalt', h('p', null, info.operator.name || MISSING)),
    card('Quellcode',
      h('p', null, 'ZeroWichtel ist freie Software unter der Europäischen Union Public Licence (EUPL-1.2).')),
    card('Hinweis',
      h('p', null, 'ZeroWichtel ist ein privates, nicht-kommerzielles Angebot. Der Betreiber hat keinen Zugriff auf die Inhalte der Wichtelrunden und kann diese weder einsehen noch wiederherstellen.')),
    card('Nutzungsvorbehalt',
      h('p', null, 'Die Nutzung der Inhalte dieser Website für Text und Data Mining, insbesondere zum Training von KI-Systemen, ist nicht gestattet (Vorbehalt nach § 44b Abs. 3 UrhG). Der Vorbehalt ist maschinenlesbar in robots.txt, /.well-known/tdmrep.json und den HTTP-Headern hinterlegt.')),
  ];
}

function accessibility(info) {
  const mail = info.operator?.email;
  return [
    germanOnly(),
    h('h1', null, 'Erklärung zur Barrierefreiheit'),
    card('Ziel',
      h('p', null, 'ZeroWichtel soll für alle nutzbar sein – mit Tastatur, Screenreader, Vergrößerung, hohem Kontrast und auf dem Handy. Maßstab sind die Web Content Accessibility Guidelines (WCAG) 2.2, Stufe AA.'),
      h('p', null, 'ZeroWichtel ist ein privates, nicht-kommerzielles Angebot. Eine gesetzliche Pflicht zur Barrierefreiheit (BFSG, BITV 2.0) besteht nach Einschätzung des Betreibers nicht; die Anforderungen werden trotzdem freiwillig umgesetzt.')),
    card('Stand der Vereinbarkeit',
      h('p', null, 'Die Anforderungen sind nach eigener Prüfung weitgehend erfüllt. Geprüft wird zu jeder Version:'),
      h('ul', null,
        h('li', null, 'automatisiert mit axe-core auf allen Ansichten, im hellen und im dunklen Design,'),
        h('li', null, 'Darstellung bei 320 Pixel Breite (entspricht 400 % Vergrößerung) und mit vergrößerten Text- und Zeilenabständen,'),
        h('li', null, 'Bedienung allein mit der Tastatur, sichtbarer Fokus, Fokus beim Seitenwechsel,'),
        h('li', null, 'Kontraste der Farben in beiden Designs.'))),
    card('Was ZeroWichtel dafür tut',
      h('ul', null,
        h('li', null, 'Helles und dunkles Design (Sonne/Mond oben rechts), standardmäßig wie das Gerät eingestellt.'),
        h('li', null, 'Schriftgrößen folgen der Einstellung des Geräts bzw. Browsers.'),
        h('li', null, '„Zum Inhalt springen“ für Tastatur und Screenreader; nach jedem Seitenwechsel steht der Fokus auf der Überschrift.'),
        h('li', null, 'Fehlermeldungen werden sofort angesagt und bleiben stehen, bis du sie schließt. Fehlerhafte Felder sind markiert.'),
        h('li', null, 'Schaltflächen auf Touch-Geräten mindestens 44 × 44 Pixel.'),
        h('li', null, 'Weniger Bewegung, wenn das Gerät „Bewegung reduzieren“ eingestellt hat; Würfel ohne Animation.'),
        h('li', null, 'Codes und Links gibt es immer auch als Text, nicht nur als QR-Code.'),
        h('li', null, 'Hintergrundmusik startet nie von selbst und lässt sich jederzeit mit dem Notensymbol oben rechts ausschalten.'),
        h('li', null, 'Schneefall ist aus, bis du ihn einschaltest, und erscheint nie bei „Bewegung reduzieren“. Das Auspacken der Zuordnung kommt dann ohne Animation aus.'),
        h('li', null, 'Die App gibt es auf Deutsch und Englisch (Umschalter im Fußbereich); die Rechtstexte nur auf Deutsch.'))),
    card('Bekannte Einschränkungen',
      h('ul', null,
        h('li', null, 'Einige Rückfragen (z. B. „Wirklich löschen?“) nutzen die Standard-Dialoge des Browsers. Wie sie vorgelesen werden, hängt vom Browser ab.'),
        h('li', null, 'Ein Test mit Screenreadern (VoiceOver, TalkBack, NVDA) durch Betroffene steht noch aus.'),
        h('li', null, 'Eine Fassung in Leichter Sprache gibt es nicht.'),
        h('li', null, 'Die Verschlüsselung setzt aktuelle Browser voraus (siehe Hilfe).'))),
    card('Barriere gefunden?',
      h('p', null, 'Wenn dir etwas den Zugang erschwert, freue ich mich über eine kurze Nachricht – gern mit Gerät, Browser und ggf. Hilfsmittel.'),
      mail ? h('p', null, 'E-Mail: ', h('a', { href: `mailto:${mail}?subject=${encodeURIComponent('ZeroWichtel – Barrierefreiheit')}` }, mail))
        : h('p', { class: 'muted' }, '[Kontaktadresse in config.json unter „operator“ → „email“ eintragen]')),
    h('p', { class: 'hint' }, `Erstellt am 21. Oktober 2026 · Version ${info.version ?? ''}`),
  ];
}

const ext = (href, text) => h('a', { href, rel: 'noopener noreferrer' }, text);

function licenses(info) {
  return [
    h('h1', null, t('Lizenzen und Quellen')),
    card('ZeroWichtel',
      h('p', null, t('Quellcode und App stehen unter der'), ' ', ext('https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12', 'European Union Public Licence (EUPL) 1.2'), '. ', t('Ausgenommen sind die unten genannten Bestandteile; für sie gelten ihre eigenen Lizenzen.'))),
    card(t('Hintergrundmusik'),
      h('dl', { class: 'facts' },
        h('dt', null, t('Titel')), h('dd', null, '„Christmas – Christmas Background Music“'),
        h('dt', null, t('Urheber')), h('dd', null, ext('https://pixabay.com/de/users/starostin-46826676/', 'starostin'), ' ', t('auf Pixabay')),
        h('dt', null, t('Quelle')), h('dd', null, ext('https://pixabay.com/de/music/weihnachten-christmas-christmas-background-music-438875/', 'pixabay.com – Audio 438875')),
        h('dt', null, t('Lizenz')), h('dd', null, ext('https://pixabay.com/de/service/license-summary/', t('Pixabay-Inhaltslizenz')), ' ', t('(Pixabay, eine Marke der Canva Germany GmbH, Berlin)')),
        h('dt', null, t('Bearbeitung')), h('dd', null, t('für das Web verkleinert (MP3, 128 kbit/s), Metadaten entfernt'))),
      h('p', { class: 'hint' }, t('Die Musikdatei steht nicht unter der EUPL. Sie ist Teil dieser App und darf nicht einzeln weiterverbreitet werden. Sie wird von diesem Server geladen – erst, wenn du die Musik über das Notensymbol einschaltest; Pixabay erfährt davon nichts.'))),
    card(t('Weitere Bestandteile'),
      h('ul', null,
        h('li', null, t('QR-Codes:'), ' ', ext('https://github.com/kazuhikoarase/qrcode-generator', 'qrcode-generator'), ' ', t('2.0.4 von Kazuhiko Arase, MIT-Lizenz. „QR Code“ ist eine Marke der DENSO WAVE INCORPORATED.')),
        h('li', null, t('QR-Codes aus Bildern lesen (Wiederherstellung):'), ' ', ext('https://github.com/cozmo/jsQR', 'jsQR'), ' ', t('1.4.0 von Cosmo Wolfe, Apache-2.0-Lizenz; unverändert, wird nur beim Hochladen eines Bildes geladen.')),
        h('li', null, t('Schriften: Systemschriften des Geräts; es werden keine Schriften nachgeladen.')),
        h('li', null, t('Symbole und Icons: eigene Gestaltung, Teil von ZeroWichtel (EUPL-1.2).')),
        h('li', null, t('Ideen-Würfel und Adventstipps: eigene Texte, Teil von ZeroWichtel (EUPL-1.2).')))),
    h('p', { class: 'hint' }, t('Version {v}', { v: info.version ?? '' })),
  ];
}

function help() {
  return [
    h('h1', null, t('Hilfe')),
    card(t('Ich habe meinen Link verloren'),
      h('p', null, t('Mit deinem Wiederherstellungscode bekommst du einen neuen Link: Startseite → „Zugang wiederherstellen“. Ohne Code kann dich die Organisator:in neu einladen; nach der Ziehung wird dann neu gelost.'))),
    card(t('Ich habe den Admin-Link verloren'),
      h('p', null, t('Den kann niemand wiederherstellen – auch der Betreiber nicht, denn er kennt den Schlüssel nicht. Die Runde wird automatisch 14 Tage nach dem Wichteldatum gelöscht.'))),
    card(t('Mein Wichtel sieht meine Wünsche nicht'),
      h('p', null, t('Öffne nach der Ziehung einmal deinen persönlichen Link. Erst dann wird deine Wunschliste für deinen Wichtel freigegeben – verschlüsselt, sodass niemand sonst sie lesen kann.'))),
    card(t('Kann die Organisator:in sehen, wer wen zieht?'),
      h('p', null, t('In der App nicht. Die Ziehung läuft im Browser der Organisator:in, das Ergebnis wird sofort für jede Person einzeln verschlüsselt. Mit Entwicklerwerkzeugen ließe sich der Vorgang technisch mitschneiden – das lässt sich bei einer Ziehung im Browser nicht ausschließen.')),
      h('p', null, h('a', { href: '#demo' }, t('Im Probelauf ausprobieren →')))),
    card(t('Was ist der Gruppenlink?'),
      h('p', null, t('Ein optionaler Link für alle: Wer ihn öffnet, trägt sich selbst mit Namen ein und ist gleich dabei. Praktisch für große Gruppen. Weil jede:r mit dem Link sich eintragen kann, legt die Organisator:in fest, wie lange er gilt und wie viele Personen sich eintragen dürfen – und kann ihn jederzeit widerrufen.'))),
    card(t('Was passiert mit Links in meiner Wunschliste?'),
      h('p', null, t('Beim Speichern entfernt ZeroWichtel Tracking-Angaben wie utm_…, fbclid oder Partner-Kennungen von Shops. Das Produkt bleibt gleich; der Link verrät aber nicht mehr, woher du ihn hast oder wer ihn geteilt hat.'))),
    card(t('Rätselhinweise, raten und Danke sagen'),
      h('p', null, t('Als Wichtel kannst du bis zu fünf Hinweise auf dich planen. Deine Person sieht jeden erst ab dem gewählten Tag. Ab dem Wichteldatum kann sie raten, wer ihr Wichtel war, und sich anonym bedanken; ob du dich zu erkennen gibst, entscheidest du. Eine Woche nach dem Wichteldatum schließt die Wichtelpost.'))),
    card(t('Warum Teilen statt Messenger-Anbindung?'),
      h('p', null, t('Signal, Threema und iMessage bieten keine offene Schnittstelle. Über das Teilen-Menü erreichst du jede App, ohne dass Telefonnummern auf einem Server landen.'))),
    card(t('Welche Browser?'),
      h('p', null, t('Aktuelle Versionen von Safari (ab 17), Chrome, Edge (ab 133) und Firefox (ab 130). Ältere Browser beherrschen die verwendete Verschlüsselung (X25519) nicht.'))),
  ];
}

export async function renderInfo(root, which) {
  const titles = { datenschutz: t('Datenschutz'), impressum: t('Impressum'), barrierefreiheit: t('Barrierefreiheit'), lizenzen: t('Lizenzen') };
  setTitle(titles[which] ?? t('Hilfe'));
  if (which === 'hilfe') {
    mount(root, page(...help(), h('p', null, h('a', { class: 'btn btn-ghost', href: '#' }, t('← Startseite')))));
    return;
  }
  mount(root, loading());
  let info;
  try {
    info = await api('GET', '/info');
  } catch {
    info = { operator: {}, hoster: '', mailProvider: null, mailProviderName: '', noAccessLogs: false };
  }
  const content = { datenschutz: privacy, barrierefreiheit: accessibility, lizenzen: licenses }[which]?.(info) ?? imprint(info);
  const p = page(...content);
  add(p, h('p', null, h('a', { class: 'btn btn-ghost', href: '#' }, t('← Startseite'))));
  mount(root, p);
}
