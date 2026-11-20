// ZeroWichtel – Hell/Dunkel. Läuft als normales Skript im <head>, damit das Design
// vor dem ersten Zeichnen feststeht (kein Aufblitzen). Kein Inline-Code (CSP).
// Gespeichert wird die Wahl nur auf diesem Gerät (localStorage), auf ausdrücklichen Wunsch.
(function () {
  'use strict';
  const KEY = 'zw.theme';
  const COLORS = { light: '#1f3d2b', dark: '#111612' };
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch (e) { return null; }
  }
  function effective() { return stored() || (mq && mq.matches ? 'dark' : 'light'); }
  // Sprache wie in js/lib/i18n.js (gespeicherte Wahl, sonst Browsersprache)
  function english() {
    let v = null;
    try { v = localStorage.getItem('zw.lang'); } catch (e) { v = null; }
    if (v === 'de' || v === 'en') return v === 'en';
    const list = navigator.languages || [navigator.language || 'de'];
    for (let i = 0; i < list.length; i++) {
      const b = String(list[i]).toLowerCase().slice(0, 2);
      if (b === 'de') return false;
      if (b === 'en') return true;
    }
    return false;
  }

  function apply() {
    const s = stored();
    if (s) root.setAttribute('data-theme', s); else root.removeAttribute('data-theme');
    const eff = effective();
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    for (let i = 0; i < metas.length; i++) {
      if (s) metas[i].setAttribute('content', COLORS[eff]);
      else metas[i].setAttribute('content', metas[i].getAttribute('media') && metas[i].getAttribute('media').indexOf('dark') >= 0 ? COLORS.dark : COLORS.light);
    }
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      const toDark = eff === 'light';
      const en = english();
      const label = toDark ? (en ? 'Switch to dark theme' : 'Dunkles Design einschalten') : (en ? 'Switch to light theme' : 'Helles Design einschalten');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('data-mode', eff);
    }
    // Auswahl in der Fußzeile: Wie Gerät / Hell / Dunkel
    const sel = document.getElementById('theme-select');
    if (sel) sel.value = s || '';
  }

  function set(v) {
    try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) { /* privater Modus: nur für diese Sitzung */ }
    if (!v) root.removeAttribute('data-theme');
    apply();
  }

  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  document.addEventListener('zw:lang', apply);

  document.addEventListener('DOMContentLoaded', function () {
    apply();
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', function () { set(effective() === 'light' ? 'dark' : 'light'); });
    const sel = document.getElementById('theme-select');
    if (sel) sel.addEventListener('change', function () { set(sel.value === 'light' || sel.value === 'dark' ? sel.value : null); });
  });
  // Falls localStorage blockiert ist, gilt die Wahl wenigstens bis zum Neuladen
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
})();
