// ZeroWichtel – Hintergrundmusik (Notensymbol oben rechts).
// Startet nie von selbst (WCAG 1.4.2): erst ein Klick lädt und spielt die Datei. Sie kommt vom eigenen
// Server, nicht von Pixabay. Läuft über Seitenwechsel weiter (die App lädt nicht neu), pausiert, solange
// der Tab im Hintergrund ist. Die Wahl wird nicht gespeichert – nach dem Neuladen ist die Musik aus.
// Quelle und Lizenz: #lizenzen

import { t } from './i18n.js';

const SRC = 'audio/christmas-background-music.mp3';
const VOLUME = 0.35;

export function initMusic(button = document.getElementById('music-toggle')) {
  if (!button) return;
  let audio = null;
  let on = false;

  const render = () => {
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('title', on ? t('Hintergrundmusik ausschalten') : t('Hintergrundmusik einschalten'));
  };

  async function start() {
    audio ??= Object.assign(new Audio(SRC), { loop: true, volume: VOLUME, preload: 'auto' });
    try {
      await audio.play();
      on = true;
    } catch {
      on = false; // z. B. stummgeschaltetes Gerät oder blockierte Wiedergabe
    }
    render();
  }

  function stop() {
    audio?.pause();
    on = false;
    render();
  }

  button.addEventListener('click', () => (on ? stop() : start()));
  document.addEventListener('zw:lang', render);
  document.addEventListener('visibilitychange', () => {
    if (!audio || !on) return;
    if (document.hidden) audio.pause();
    else audio.play().catch(() => {});
  });
  render();
}
