// ZeroWichtel – Ideen-Würfel und Adventstürchen. Standardliste im Code: kein Shop, kein Tracking.
// Jeder Eintrag: [deutsch, englisch].
// Ab 2.12 kann der Betreiber die Liste im Admin-Bereich ergänzen oder ersetzen; die App holt sie dann einmal von
// /api/ideas (eigener Server, ohne Personenbezug). Ohne Verbindung gilt die Standardliste.

import { lang } from './i18n.js';
import { cryptoRandomInt } from './draw.js';
import { api } from './api.js';

/** Ideen nach Preisklasse (Obergrenze in Euro). Eine Idee passt in ihre Klasse und alle teureren. */
// Jeder Eintrag: [deutsch, englisch, Mindestalter, Höchstalter (null = ohne)]. Kein Alkohol in der Standardliste.
export const IDEAS = [
  [5, [
    ['Ein Päckchen Lieblingstee mit selbst geschriebenem Etikett', 'A pack of favourite tea with a hand-written label', 10, null],
    ['Saatgut-Bomben oder Kräutersamen fürs Fensterbrett', 'Seed bombs or herb seeds for the windowsill', 4, null],
    ['Ein Gutschein für „einmal Kuchen backen“', 'A voucher for “one homemade cake”', 0, null],
    ['Eine selbst zusammengestellte Playlist mit QR-Code auf einer Karte', 'A home-made playlist with a QR code on a card', 10, null],
    ['Lustige Socken', 'Funny socks', 0, null],
    ['Ein Rätselheft oder ein Kartenspiel im Taschenformat', 'A puzzle book or a pocket card game', 6, null],
    ['Knete oder Straßenmalkreide', 'Modelling clay or pavement chalk', 3, 10],
  ]],
  [10, [
    ['Eine gute Schokolade und ein Rezept, das sie verwendet', 'Good chocolate plus a recipe that uses it', 8, null],
    ['Ein kleines Notizbuch und ein schöner Stift', 'A small notebook and a nice pen', 6, null],
    ['Eine Gewürzmischung aus dem Feinkostladen', 'A spice blend from the deli', 16, null],
    ['Eine Taschenlampe oder Stirnlampe', 'A torch or head torch', 6, null],
    ['Ein Ableger einer robusten Zimmerpflanze im Topf', 'A cutting of a hardy houseplant in a pot', 10, null],
    ['Handwärmer zum Wiederverwenden', 'Reusable hand warmers', 6, null],
    ['Ein kleines Bastelset', 'A small craft kit', 5, 12],
  ]],
  [20, [
    ['Ein Taschenbuch, das du selbst geliebt hast – mit Widmung', 'A paperback you loved yourself – with a dedication', 10, null],
    ['Ein Brettspiel für zwei', 'A board game for two', 8, null],
    ['Eine Thermoskanne oder ein Becher für unterwegs', 'A flask or travel mug', 10, null],
    ['Ein Set Lieblingskaffee aus einer kleinen Rösterei', 'Favourite coffee from a small roastery', 16, null],
    ['Ein Puzzle mit einem Motiv, das zur Person passt', 'A jigsaw puzzle with a fitting motif', 6, null],
    ['Ein Kinogutschein', 'A cinema voucher', 6, null],
    ['Ein Kinderbuch zum Vorlesen oder Selberlesen', 'A children’s book to read aloud or alone', 3, 10],
  ]],
  [30, [
    ['Kuschelige Wollsocken oder ein Schal', 'Cosy wool socks or a scarf', 0, null],
    ['Ein Kochbuch zu einer Küche, die die Person mag', 'A cookbook for a cuisine the person loves', 14, null],
    ['Eine Powerbank', 'A power bank', 10, null],
    ['Ein Workshop-Gutschein im Ort (Töpfern, Brot backen …)', 'A local workshop voucher (pottery, bread baking …)', 12, null],
    ['Ein gutes Messer für die Küche', 'A good kitchen knife', 18, null],
    ['Ein Experimentierkasten', 'A science experiment kit', 8, 14],
  ]],
  [50, [
    ['Kopfhörer für unterwegs', 'Headphones for on the go', 8, null],
    ['Eine Kuscheldecke', 'A cosy blanket', 0, null],
    ['Konzert- oder Theaterkarten', 'Concert or theatre tickets', 12, null],
    ['Ein Spiel, das schon lange auf der Wunschliste steht', 'A game that has been on the wish list for ages', 6, null],
    ['Ein gemeinsamer Ausflug als Gutschein', 'A joint day out as a voucher', 0, null],
    ['Ein Baukasten zum Selberbauen', 'A construction kit to build yourself', 5, 14],
  ]],
  [Infinity, [
    ['Ein Erlebnis: Kletterhalle, Escape-Room oder Kochkurs', 'An experience: climbing hall, escape room or cooking class', 12, null],
    ['Etwas Langlebiges in guter Qualität statt vieler Kleinigkeiten', 'One durable, good-quality item instead of many small things', 0, null],
    ['Eine Spende im Namen der Person an ein Projekt, das ihr wichtig ist', 'A donation in the person’s name to a cause they care about', 16, null],
  ]],
];

const pick = (pair) => (lang() === 'en' ? pair[1] || pair[0] : pair[0]);

const CLASSES = [5, 10, 20, 30, 50, Infinity];
const LIMITS = { items: 200, text: 120 };

/** Altersgruppen für den Würfel: ungefähres Alter der beschenkten Person (Untergrenze zählt beim Mindestalter). */
export const AGE_GROUPS = [
  ['egal', 'Alter egal', null],
  ['kind', 'Kind (6–12)', 6],
  ['jugend', 'Jugendlich (13–17)', 13],
  ['erwachsen', 'Erwachsen (18+)', 18],
];

/** Mindest- und Höchstalter bereinigen: 0…99, Höchstalter nie unter Mindestalter. */
export function readAges(min, max) {
  const minAge = Number.isInteger(min) && min >= 0 && min <= 99 ? min : 0;
  const maxAge = Number.isInteger(max) && max >= minAge && max <= 99 ? max : null;
  return { minAge, maxAge };
}

/**
 * Passt ein Vorschlag zur Altersgruppe? Mindestalter streng (Untergrenze der Gruppe), Höchstalter als Empfehlung.
 * group = Untergrenze der Gruppe oder null (egal).
 */
export function fitsAge(entry, group) {
  if (group === null || group === undefined) return true;
  return (entry[2] ?? 0) <= group && (entry[3] ?? Infinity) >= group;
}

/** Liste des Betreibers defensiv lesen (nie dem Inhalt vertrauen). Gibt null für „Standardliste“. */
export function readIdeas(raw) {
  if (!raw || typeof raw !== 'object' || !['extend', 'replace'].includes(raw.mode) || !Array.isArray(raw.items)) return null;
  const clean = (v) => (typeof v === 'string' ? [...v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, LIMITS.text).join('') : '');
  const items = raw.items.slice(0, LIMITS.items)
    .map((it) => ({ max: it?.max === null ? Infinity : it?.max, de: clean(it?.de), en: clean(it?.en), ...readAges(it?.minAge, it?.maxAge) }))
    .filter((it) => CLASSES.includes(it.max) && it.de);
  if (raw.mode === 'replace' && !items.length) return null;
  return { mode: raw.mode, items };
}

/** Standardliste, ergänzt oder ersetzt durch die Liste des Betreibers; immer alle sechs Preisklassen. */
export function buildClasses(source = null) {
  const own = (max) => (source?.items ?? []).filter((it) => it.max === max).map((it) => [it.de, it.en, it.minAge ?? 0, it.maxAge ?? null]);
  return CLASSES.map((max, i) => [max, source?.mode === 'replace' ? own(max) : [...IDEAS[i][1], ...own(max)]]);
}

let active = buildClasses();
let loading = null;

/** Liste des Betreibers einmal je Seitenaufruf laden. Fehler (offline, alter Server) = Standardliste. */
export function loadIdeas() {
  loading ??= api('GET', '/ideas').then((r) => { active = buildClasses(readIdeas(r)); }).catch(() => {});
  return loading;
}

/** Alle Ideen bis zum Betragslimit (null = ohne Limit). */
export function ideasFor(budget, classes = active) {
  const max = budget === null || budget === undefined ? Infinity : Number(budget);
  // Klasse i reicht von classes[i-1][0] bis classes[i][0]; sie passt, wenn ihre Untergrenze unter dem Limit liegt.
  return classes.filter((_, i) => i === 0 || classes[i - 1][0] < max).flatMap(([, list]) => list);
}

/** Zufälliger Vorschlag als { text, minAge, maxAge } (nicht derselbe wie zuletzt); null, wenn keiner passt. */
export function rollIdeaItem(budget, last = null, rnd = cryptoRandomInt, classes = active, age = null) {
  const list = ideasFor(budget, classes).filter((e) => fitsAge(e, age)).map((e) => ({ text: pick(e), minAge: e[2] ?? 0, maxAge: e[3] ?? null }));
  if (!list.length) return null;
  if (list.length < 2) return list[0];
  let item;
  do { item = list[rnd(list.length)]; } while (item.text === last);
  return item;
}

/** Zufällige Idee als Text (nicht dieselbe wie zuletzt); null, wenn keine passt. */
export function rollIdea(budget, last = null, rnd = cryptoRandomInt, classes = active, age = null) {
  return rollIdeaItem(budget, last, rnd, classes, age)?.text ?? null;
}

/** Ein kleiner Tipp für jedes Adventstürchen (1–24). */
export const ADVENT = [
  ['Heute schon an die Wunschliste gedacht? Kleine Details helfen deinem Wichtel enorm.', 'Thought about your wish list yet? Small details help your Secret Santa a lot.'],
  ['Geschenkpapier aus Zeitung oder Stoff sieht toll aus und spart Müll.', 'Wrapping paper made from newspaper or fabric looks great and saves waste.'],
  ['Ein handgeschriebener Zettel macht jedes Geschenk persönlicher.', 'A handwritten note makes every present more personal.'],
  ['Frag anonym nach, wenn du unsicher bist – dafür gibt es die Wichtelpost.', 'Ask anonymously if you are unsure – that is what the Secret Santa mail is for.'],
  ['Ein Geschenk muss nicht teuer sein, um zu begeistern.', 'A present does not need to be expensive to delight.'],
  ['Nikolaus! Zeit für ein kleines Stück Schokolade.', 'St Nicholas Day! Time for a little piece of chocolate.'],
  ['Rätselhinweise machen die Bescherung spannender – plane doch einen.', 'Riddle hints make the exchange more exciting – why not plan one?'],
  ['Denk an Allergien und das „Bitte nicht“ im Steckbrief.', 'Remember allergies and the “please not” in the profile.'],
  ['Lokal einkaufen: kleine Läden freuen sich über Wichtel.', 'Shop locally: small shops love Secret Santas.'],
  ['Selbstgemachtes zählt doppelt.', 'Home-made counts double.'],
  ['Halbzeit bis Weihnachten – liegt das Geschenk schon bereit?', 'Halfway to Christmas – is the present ready yet?'],
  ['Eine Playlist zum Geschenk? Auch das ist ein Geschenk.', 'A playlist with the present? That is a present too.'],
  ['Name aufs Päckchen nicht vergessen – aber nicht deinen!', 'Do not forget the name on the parcel – but not yours!'],
  ['Wer nicht mitwichteln kann, freut sich über eine Karte.', 'Those who cannot join in will appreciate a card.'],
  ['Zeit für eine Tasse Tee und ein gutes Buch.', 'Time for a cup of tea and a good book.'],
  ['Noch keine Idee? Würfel dir eine.', 'No idea yet? Roll one.'],
  ['Erlebnisse statt Dinge: ein Gutschein für gemeinsame Zeit.', 'Experiences instead of things: a voucher for time together.'],
  ['Kleine Geste: Schreib deiner beschenkten Person einen netten Gruß.', 'A small gesture: send your giftee a kind greeting.'],
  ['Geschenke verpacken bei Musik macht mehr Spaß.', 'Wrapping presents to music is more fun.'],
  ['Prüf noch einmal den Termin der Bescherung.', 'Check the date of the exchange once more.'],
  ['Wintersonnenwende – ab morgen werden die Tage länger.', 'Winter solstice – from tomorrow the days get longer.'],
  ['Durchatmen. Es muss nicht perfekt sein.', 'Breathe. It does not have to be perfect.'],
  ['Morgen ist Heiligabend – alles eingepackt?', 'Christmas Eve tomorrow – everything wrapped?'],
  ['Frohe Weihnachten!', 'Merry Christmas!'],
];

export function adventTip(day) {
  const e = ADVENT[day - 1];
  return e ? pick(e) : null;
}
