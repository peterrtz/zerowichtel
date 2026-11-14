# ZeroWichtel – Container-Image auf Basis des offiziellen Node.js-Images (Debian 13 „trixie“, schlank).
#
# Gebaut vom Installationsskript deploy/install-docker-caddy.sh (mit --pull: Sicherheitsupdates von Node.js
# und Debian kommen bei jedem Lauf mit). Der Code liegt im Image (zur Laufzeit nicht änderbar); config/
# (→ /etc/zerowichtel) und data/ werden von außen eingebunden. Kein npm-Paket, kein Webserver davor im
# Container: Node liefert App und API selbst aus. Das Dateisystem ist schreibgeschützt, der Prozess läuft
# als www-data (UID 33) – dieselbe Kennung wie im früheren PHP-Image, data/ bleibt also unverändert nutzbar.
FROM node:24-trixie-slim
LABEL org.zerowichtel.image=app

ENV NODE_ENV=production \
    TZ=Europe/Berlin \
    ZW_CONFIG=/etc/zerowichtel/config.json \
    ZW_DB_PATH=/app/data/zerowichtel.sqlite

# Sicherheitsupdates des Basissystems; npm, npx, corepack und yarn werden zur Laufzeit nicht gebraucht – weg damit.
RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/* \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Argon2 (Admin-Passwort) gibt es in Node.js erst ab 24.7 – Build bricht sonst ab
RUN node -e 'process.exit(typeof require("node:crypto").argon2Sync === "function" ? 0 : 1)' || { echo "Node.js ab 24.7 nötig" >&2; exit 1; }

# Code: root-eigen, für www-data nur lesbar. „zw“ = Kommandozeile (zw admin setup, zw codes …).
COPY --chown=root:root app/ /app/
RUN printf '#!/bin/sh\nexec node /app/server/main.mjs "$@"\n' > /usr/local/bin/zw \
 && chmod 755 /usr/local/bin/zw \
 && find /app -type d -exec chmod 755 {} + \
 && find /app -type f -exec chmod 644 {} + \
 && install -d -o www-data -g www-data -m 700 /app/data

USER www-data
WORKDIR /app
EXPOSE 8080
# X-Forwarded-Proto verhindert die HTTPS-Weiterleitung beim internen Aufruf.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/info',{headers:{'X-Forwarded-Proto':'https'}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "/app/server/main.mjs", "serve", "--host", "0.0.0.0", "--port", "8080"]
