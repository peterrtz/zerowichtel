// ZeroWichtel – Markdown-light
// Unterstützt: **fett**, *kursiv*, ++unterstrichen++, Aufzählungen mit "- ", Absätze, Zeilenumbrüche,
// \-Escapes. Kein HTML: parse() liefert einen Baum aus reinen Objekten, toDom() baut daraus
// DOM-Knoten ausschließlich über createElement/textContent.

const MARKERS = [
  { m: '**', t: 'b' },
  { m: '++', t: 'u' },
  { m: '*', t: 'i' },
];

function findClose(s, marker, from) {
  for (let j = from; j <= s.length - marker.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s.startsWith(marker, j)) {
      // "*" darf nicht Teil von "**" sein
      if (marker === '*' && s[j + 1] === '*') { j++; continue; }
      // "***" am Ende: die letzten zwei Sterne schließen "**", der erste gehört nach innen
      if (marker === '**') while (s[j + 2] === '*') j++;
      return j;
    }
  }
  return -1;
}

export function parseInline(s, depth = 0) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && '*+-\\'.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') { flush(); out.push({ t: 'br' }); i++; continue; }
    let matched = false;
    if (depth < 4) {
      for (const { m, t } of MARKERS) {
        if (!s.startsWith(m, i)) continue;
        if (m === '*' && s[i + 1] === '*') continue;
        const j = findClose(s, m, i + m.length);
        if (j > i + m.length && !/\s/.test(s[i + m.length]) && !/\s/.test(s[j - 1])) {
          flush();
          out.push({ t, c: parseInline(s.slice(i + m.length, j), depth + 1) });
          i = j + m.length;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-•]\s+/;

export function parse(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const endPara = () => {
    if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join('\n')) }); para = []; }
  };
  const endList = () => { if (list) { blocks.push(list); list = null; } };
  for (const line of lines) {
    if (BULLET.test(line)) {
      endPara();
      if (!list) list = { t: 'ul', items: [] };
      list.items.push(parseInline(line.replace(BULLET, '')));
    } else if (line.trim() === '') {
      endPara();
      endList();
    } else {
      endList();
      para.push(line);
    }
  }
  endPara();
  endList();
  return blocks;
}

/** Reiner Text ohne Formatierung, z. B. für Vorschauen. */
export function toPlain(text) {
  const walk = (nodes) => nodes.map((n) => (n.t === 'text' ? n.v : n.t === 'br' ? ' ' : walk(n.c))).join('');
  return parse(text)
    .map((b) => (b.t === 'p' ? walk(b.c) : b.items.map((i) => '• ' + walk(i)).join(' ')))
    .join(' ');
}

const TAG = { b: 'strong', i: 'em', u: 'u' };

function inlineToDom(doc, nodes, parent) {
  for (const n of nodes) {
    if (n.t === 'text') parent.appendChild(doc.createTextNode(n.v));
    else if (n.t === 'br') parent.appendChild(doc.createElement('br'));
    else {
      const el = doc.createElement(TAG[n.t]);
      inlineToDom(doc, n.c, el);
      parent.appendChild(el);
    }
  }
}

/** Baut einen DocumentFragment aus Markdown-light. */
export function toDom(text, doc = globalThis.document) {
  const frag = doc.createDocumentFragment();
  for (const b of parse(text)) {
    if (b.t === 'p') {
      const p = doc.createElement('p');
      inlineToDom(doc, b.c, p);
      frag.appendChild(p);
    } else {
      const ul = doc.createElement('ul');
      for (const item of b.items) {
        const li = doc.createElement('li');
        inlineToDom(doc, item, li);
        ul.appendChild(li);
      }
      frag.appendChild(ul);
    }
  }
  return frag;
}
