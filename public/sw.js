// ZeroWichtel – Service Worker.
// Speichert nur die App-Hülle für schnelles Laden und Installation als PWA.
// API-Antworten werden NIE zwischengespeichert. URL-Fragmente (mit Schlüsseln) erreichen den Service Worker nicht.

// Wird von bin/release.mjs im Paket durch Version und Inhalts-Prüfsumme ersetzt.
const VERSION = 'zw-dev';
const SHELL = [
  './',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon.svg',
  'index.html',
  'js/app.js',
  'js/lib/api.js',
  'js/lib/cleanurl.js',
  'js/lib/crypto.js',
  'js/lib/dates.js',
  'js/lib/dom.js',
  'js/lib/draw.js',
  'js/lib/analog.js',
  'js/lib/analog-round.js',
  'js/lib/questions.js',
  'js/lib/mixtape.js',
  'js/lib/donation.js',
  'js/lib/photos.js',
  'js/lib/pdf.js',
  'js/lib/album-pdf.js',
  'js/lib/crop.js',
  'js/lib/announce.js',
  'js/lib/editor.js',
  'js/lib/en.js',
  'js/lib/i18n.js',
  'js/lib/ics.js',
  'js/lib/ideas.js',
  'js/lib/links.js',
  'js/lib/markdown.js',
  'js/lib/model.js',
  'js/lib/music.js',
  'js/lib/recovery-image.js',
  'js/lib/rules.js',
  'js/lib/share.js',
  'js/lib/snow.js',
  'js/lib/store.js',
  'js/theme.js',
  'js/vendor/jsqr.mjs',
  'js/vendor/qrcode.mjs',
  'js/views/admin-draw.js',
  'js/views/analog.js',
  'js/views/questions.js',
  'js/views/mixtape.js',
  'js/views/album.js',
  'js/views/cropper.js',
  'js/views/section-nav.js',
  'js/views/announce.js',
  'js/views/admin.js',
  'js/views/backend.js',
  'js/views/common.js',
  'js/views/create.js',
  'js/views/crypto-info.js',
  'js/views/demo.js',
  'js/views/extras.js',
  'js/views/game.js',
  'js/views/home.js',
  'js/views/info.js',
  'js/views/invite.js',
  'js/views/join.js',
  'js/views/jump.js',
  'js/views/person-draw.js',
  'js/views/person.js',
  'js/views/recover.js',
  'js/views/rules-editor.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api')) return;
  // Musik (Teilanfragen, groß) nicht über den Service Worker – nur online, auf ausdrücklichen Klick
  if (url.pathname.includes('/audio/') || req.headers.has('range')) return;
  // Netz zuerst (Aktualisierungen sofort sichtbar), Cache als Rückfall bei fehlender Verbindung.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
