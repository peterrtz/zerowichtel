// ZeroWichtel – lokale Ablage der eigenen Links in diesem Browser.
// localStorage ist für die Funktion unbedingt erforderlich (§ 25 Abs. 2 TDDDG). Keine Cookies.
// Gespeichert wird nur auf diesem Gerät; der Server erfährt davon nichts.

const KEY = 'zw.links.v1';

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const same = (a, b) => a.kind === b.kind && a.roundId === b.roundId && (a.pid ?? null) === (b.pid ?? null);

/** entry: { kind: 'a'|'p', roundId, pid?, fragment, title, eventDate?, rk? } */
export function saveLink(entry) {
  const list = readAll().filter((e) => !same(e, entry));
  list.unshift({ ...entry, savedAt: Date.now() });
  return writeAll(list.slice(0, 50));
}

export function updateLink(match, patch) {
  const list = readAll().map((e) => (same(e, match) ? { ...e, ...patch } : e));
  writeAll(list);
}

export function findLink(match) {
  return readAll().find((e) => same(e, match)) ?? null;
}

export function listLinks() {
  return readAll();
}

export function removeLink(match) {
  writeAll(readAll().filter((e) => !same(e, match)));
}

export function storageAvailable() {
  try {
    localStorage.setItem('zw.test', '1');
    localStorage.removeItem('zw.test');
    return true;
  } catch {
    return false;
  }
}
