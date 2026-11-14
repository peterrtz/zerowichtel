#!/usr/bin/env bash
# ZeroWichtel – Installation und Update als Docker-Container hinter einem bestehenden Caddy
# (Caddy läuft selbst in Docker Compose).
#
#   sudo bash install-docker-caddy.sh zerowichtel-<version>.zip
#
# Was das Skript tut (wiederholbar, ein zweiter Lauf = Update):
#   1. Prüft Docker, Compose und DNS
#   2. Legt /opt/zerowichtel an: build/ (Code + Image-Dateien), compose.yaml, config/config.json, data/
#   3. config/config.json beim ersten Mal mit zufälligem Serverschlüssel – oder übernimmt beim Update von
#      1.x die bisherige config/config.php (Serverschlüssel und alle Angaben bleiben gleich)
#   4. Docker-Netz „zerowichtel-proxy“ (nur ZeroWichtel und Caddy hängen darin)
#   5. Baut das Image (Node.js), startet den Container (kein öffentlicher Port, schreibgeschützt, ohne Capabilities);
#      startet die neue Version nicht, läuft automatisch wieder die vorherige
#   6. Löschung und Erinnerungen erledigt der Container selbst – ein alter Cronjob (1.x) wird entfernt
#   7. Prüft den Container, sucht den Caddy-Container und zeigt, was dort noch zu tun ist
#
# Caddyfile und Compose-Dateien des Caddy-Stacks werden NICHT verändert – die zwei kleinen Ergänzungen dort
# zeigt das Skript am Ende an (siehe docs/INSTALL-DOCKER-CADDY.md).
#
# Einstellungen per Umgebungsvariable:
#   DOMAIN=wichteln.example.org  (bei der ersten Installation nötig; bei Updates aus config.json gelesen)
#   BASE_DIR=/opt/zerowichtel  CADDY_CONTAINER=<name>
#   ZW_TEST=1  nur für Tests (keine DNS-Prüfung, Basis-Image nicht neu ziehen)

set -euo pipefail
umask 027

BASE_DIR="${BASE_DIR:-/opt/zerowichtel}"
# Domain: ausdrücklich angegeben, sonst bei einem Update aus der vorhandenen config.json (base_url).
# Es gibt bewusst keinen Standardwert – eine falsche Domain führte zu falschen Hinweisen und Prüfungen.
DOMAIN="${DOMAIN:-}"
if [[ -z "$DOMAIN" && -r "$BASE_DIR/config/config.json" ]]; then
  # Kommentarzeilen überspringen; funktioniert für mehrzeilige und einzeilige JSON-Dateien
  DOMAIN="$(grep -v '^[[:space:]]*//' "$BASE_DIR/config/config.json" | grep -o '"base_url"[[:space:]]*:[[:space:]]*"https\{0,1\}://[^"/:]*' | head -n 1 | sed 's#.*://##' || true)"
fi
NETWORK="zerowichtel-proxy"
CONTAINER="zerowichtel"
WWW_UID=33   # www-data im Image (wie schon im PHP-Image von 1.x)
TEST="${ZW_TEST:-0}"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_off=$'\e[0m'
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '%s[ok]%s %s\n' "$c_ok" "$c_off" "$*"; }
warn() { printf '%s[!]%s  %s\n' "$c_warn" "$c_off" "$*"; }
die()  { printf '%s[x]%s  %s\n' "$c_err" "$c_off" "$*" >&2; exit 1; }
ask()  { local a; read -r -p "$1 [j/N] " a; [[ "$a" =~ ^[jJyY]$ ]]; }

# Anfrage an den Container selbst (ohne Caddy) über seine Adresse im Docker-Netz;
# X-Forwarded-Proto verhindert die HTTPS-Weiterleitung. Im Image gibt es kein curl.
cip() { docker inspect -f "{{(index .NetworkSettings.Networks \"${NETWORK}\").IPAddress}}" "$CONTAINER" 2>/dev/null; }
in_container() { local path="${*: -1}"; set -- "${@:1:$#-1}"; curl -s --max-time 5 -H 'X-Forwarded-Proto: https' "$@" "http://$(cip):8080${path}"; }

# ---------------------------------------------------------------- 0. Vorprüfung
step "Vorprüfung"
[[ $EUID -eq 0 ]] || die "Bitte mit sudo ausführen."
[[ -n "$DOMAIN" ]] || die "Domain fehlt. Erste Installation: sudo DOMAIN=wichteln.example.org bash $0 zerowichtel-<version>.zip"
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Ungültige Domain: ${DOMAIN}"
ZIP="${1:-}"
[[ -n "$ZIP" && -f "$ZIP" ]] || die "Aufruf: sudo bash $0 zerowichtel-<version>.zip"
command -v docker >/dev/null || die "docker nicht gefunden."
docker info >/dev/null 2>&1 || die "Docker läuft nicht (sudo systemctl status docker)."
docker compose version >/dev/null 2>&1 || die "Docker Compose (Plugin) nicht gefunden."
command -v unzip >/dev/null || die "unzip fehlt: sudo apt install unzip"
command -v curl >/dev/null || die "curl fehlt: sudo apt install curl"
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'), $(docker compose version --short 2>/dev/null || echo 'Compose')"
ok "Domain: ${DOMAIN}, Zielordner: ${BASE_DIR}"

if [[ "$TEST" != 1 ]]; then
  server_ips="$(hostname -I 2>/dev/null || true)"
  dns_ips="$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
  if [[ -z "$dns_ips" ]]; then
    warn "Für ${DOMAIN} gibt es noch keinen DNS-Eintrag. Caddy bekommt dann kein Zertifikat."
    warn "Der Container lässt sich trotzdem schon installieren."
  else
    match=0
    for ip in $dns_ips; do [[ " $server_ips " == *" $ip "* ]] && match=1; done
    if [[ $match == 1 ]]; then ok "DNS zeigt auf diesen Server (${dns_ips% })"
    else warn "DNS (${dns_ips% }) passt nicht zu den Adressen dieses Servers (${server_ips% })."; fi
  fi
fi

# ---------------------------------------------------------------- 1. Dateien
step "Dateien"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP/pkg"
[[ -f "$TMP/pkg/server/main.mjs" && -f "$TMP/pkg/public/index.html" && -f "$TMP/pkg/deploy/docker/Dockerfile" ]] \
  || die "Das ZIP sieht nicht wie ein ZeroWichtel-Paket (ab 2.0) aus."
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TMP/pkg/RELEASE.json" 2>/dev/null | head -1)"
VERSION="${VERSION:-?}"

install -d -m 755 -o root -g root "$BASE_DIR"
# build/ wird jedes Mal neu aufgebaut – dort liegt nichts, was erhalten bleiben muss
rm -rf "$BASE_DIR/build.new"
install -d -m 755 "$BASE_DIR/build.new/app"
cp -a "$TMP/pkg/deploy/docker/." "$BASE_DIR/build.new/"
rm -f "$BASE_DIR/build.new/compose.yaml"
for item in public server config.example.json package.json LICENSE README.md CHANGELOG.md RELEASE.json; do
  [[ -e "$TMP/pkg/$item" ]] && cp -a "$TMP/pkg/$item" "$BASE_DIR/build.new/app/"
done
chown -R root:root "$BASE_DIR/build.new"
chmod -R u=rwX,go=rX "$BASE_DIR/build.new"
rm -rf "$BASE_DIR/build.old"
[[ -e "$BASE_DIR/build" ]] && mv "$BASE_DIR/build" "$BASE_DIR/build.old"
mv "$BASE_DIR/build.new" "$BASE_DIR/build"
rm -rf "$BASE_DIR/build.old"
# Bisherige compose.yaml für den Rückfall aufheben (1.x bindet data/ an einer anderen Stelle ein)
[[ -f "$BASE_DIR/compose.yaml" ]] && cp -a "$BASE_DIR/compose.yaml" "$BASE_DIR/compose.yaml.previous"
install -m 644 -o root -g root "$TMP/pkg/deploy/docker/compose.yaml" "$BASE_DIR/compose.yaml"
rm -f "$BASE_DIR/config.example.php"
cp "$TMP/pkg/config.example.json" "$BASE_DIR/config.example.json" && chmod 644 "$BASE_DIR/config.example.json"
install -d -m 700 -o "$WWW_UID" -g "$WWW_UID" "$BASE_DIR/data"
ok "ZeroWichtel ${VERSION} nach ${BASE_DIR}/build entpackt"

# ---------------------------------------------------------------- 2. Konfiguration
step "Konfiguration"
CFG_DIR="$BASE_DIR/config"
CFG="$CFG_DIR/config.json"
OLD_CFG="$CFG_DIR/config.php"
# Ordner statt Einzeldatei einbinden: Docker sieht bei einer einzeln eingebundenen Datei nach dem
# Bearbeiten (neue Datei statt überschriebener) weiter die alte Fassung.
install -d -m 750 -o root -g "$WWW_UID" "$CFG_DIR"
[[ -f "$BASE_DIR/config.php" && ! -f "$OLD_CFG" && ! -f "$CFG" ]] && mv "$BASE_DIR/config.php" "$OLD_CFG"   # Ort vor 1.1

# PHP-Konfiguration (1.x) als JSON ausgeben – mit dem bisherigen Image, sonst mit php auf dem Server
php_config_json() {
  local code='$c = require "/etc/zerowichtel/config.php"; unset($c["db_path"]); echo json_encode($c, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);'
  if docker image inspect zerowichtel:local >/dev/null 2>&1 \
     && docker run --rm --entrypoint php zerowichtel:local -v >/dev/null 2>&1; then
    docker run --rm --network none --entrypoint php -v "$CFG_DIR:/etc/zerowichtel:ro" zerowichtel:local -r "$code"
  elif command -v php >/dev/null; then
    php -r "${code//\/etc\/zerowichtel/$CFG_DIR}"
  else
    return 1
  fi
}

if [[ -f "$CFG" ]]; then
  ok "config.json vorhanden – bleibt unverändert"
elif [[ -f "$OLD_CFG" ]]; then
  json="$(php_config_json)" || die "config.php (1.x) ließ sich nicht lesen. Bitte ${CFG} von Hand aus ${BASE_DIR}/config.example.json anlegen (Serverschlüssel übernehmen!)."
  { printf '// ZeroWichtel – Konfiguration, am %s aus config.php (1.x) übernommen.\n' "$(date +%F)"
    printf '// Erklärungen zu allen Einträgen: %s/config.example.json\n' "$BASE_DIR"
    printf '%s\n' "$json"; } > "$CFG.new"
  grep -q '"server_key"' "$CFG.new" || die "Übernahme aus config.php unvollständig (server_key fehlt) – nichts geändert."
  mv "$CFG.new" "$CFG"
  ok "config.php (1.x) nach ${CFG} übernommen – Serverschlüssel und alle Angaben unverändert"
else
  KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
  sed -e "s#\"HIER-EINEN-ZUFALLSWERT-EINTRAGEN\"#\"${KEY}\"#" \
      -e "s#\"https://wichteln.example.org\"#\"https://${DOMAIN}\"#" \
      -e 's#"lazy_cleanup": true#"lazy_cleanup": false#' \
      -e 's#"client_ip_header": null#"client_ip_header": "X-Forwarded-For"#' \
      "$BASE_DIR/config.example.json" > "$CFG"
  grep -q '"client_ip_header": "X-Forwarded-For"' "$CFG" || die "config.json: client_ip_header ließ sich nicht setzen."
  grep -q "HIER-EINEN-ZUFALLSWERT" "$CFG" && die "config.json: Serverschlüssel ließ sich nicht setzen."
  grep -q "\"base_url\": \"https://${DOMAIN}\"" "$CFG" || die "config.json: base_url ließ sich nicht setzen."
  ok "config.json angelegt (zufälliger Serverschlüssel, Client-IP von Caddy)"
  warn "Betreiberangaben (operator, hoster) später in ${CFG} eintragen."
fi
# Im Container läuft Node als www-data (UID 33): lesen ja, schreiben nein
chown root:"$WWW_UID" "$CFG"
chmod 640 "$CFG"

# ---------------------------------------------------------------- 3. Netz
step "Docker-Netz"
if docker network inspect "$NETWORK" >/dev/null 2>&1; then ok "Netz ${NETWORK} vorhanden"
else
  docker network create --driver bridge "$NETWORK" >/dev/null
  ok "Netz ${NETWORK} angelegt"
fi

# ---------------------------------------------------------------- 3b. Sicherung vor dem Update
# Bevor irgendetwas am laufenden System geändert wird: konsistente Kopie der Datenbank nach data/backup/
# (zw backup, ab 2.4.0). Schlägt sie fehl, bricht das Update hier ab – die bisherige Version läuft unverändert weiter.
# Bewusst überspringen: ZW_SKIP_BACKUP=1.
PRE_BACKUP=""
if [[ -f "$BASE_DIR/data/zerowichtel.sqlite" ]] && docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  step "Sicherung vor dem Update"
  if [[ "${ZW_SKIP_BACKUP:-0}" == 1 ]]; then
    warn "Sicherung übersprungen (ZW_SKIP_BACKUP=1)."
  elif out="$(docker exec "$CONTAINER" zw backup 2>&1)" && PRE_BACKUP="$(printf '%s\n' "$out" | sed -n 's/^Sicherung: //p' | head -n 1)" && [[ -n "$PRE_BACKUP" ]]; then
    PRE_BACKUP="${BASE_DIR}/data/backup/$(basename "$PRE_BACKUP")"
    [[ -s "$PRE_BACKUP" ]] || die "Sicherung vor dem Update fehlt oder ist leer (${PRE_BACKUP}) – nichts geändert."
    ok "Datenbank gesichert: ${PRE_BACKUP}"
  elif docker exec "$CONTAINER" zw help 2>/dev/null | grep -q 'backup'; then
    printf '%s\n' "$out" >&2
    die "Sicherung vor dem Update fehlgeschlagen – nichts geändert. (Bewusst ohne Sicherung: ZW_SKIP_BACKUP=1)"
  else
    warn "Die laufende Version kennt „zw backup“ noch nicht (älter als 2.4.0) – keine automatische Sicherung."
    warn "Empfehlung: jetzt abbrechen (Strg+C) und ${BASE_DIR}/data von Hand sichern. Weiter in 10 Sekunden …"
    [[ "$TEST" == 1 ]] || sleep 10
  fi
fi

# ---------------------------------------------------------------- 4. Image und Container
step "Image bauen und Container starten"
cd "$BASE_DIR"
PULL=(--pull)
[[ "$TEST" == 1 ]] && PULL=()
# Rückfall vorbereiten: bisheriges Image als zerowichtel:previous aufheben
had_previous=0
if docker image inspect zerowichtel:local >/dev/null 2>&1; then
  docker tag zerowichtel:local zerowichtel:previous
  had_previous=1
fi
# Der Build läuft, während die bisherige Version weiter antwortet
docker compose build "${PULL[@]}" --quiet app || die "Image-Build fehlgeschlagen – die bisherige Version läuft unverändert weiter."
# Basisimage nachvollziehbar machen (SEC-005): Der Tag bleibt bewusst beweglich, damit jedes Update die
# Sicherheitskorrekturen von Node.js und Debian mitbringt; der tatsächlich verwendete Digest wird festgehalten.
BASE_IMAGE="$(sed -n 's/^FROM[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p' "$BASE_DIR/build/Dockerfile" | head -n 1)"
BASE_DIGEST="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' "$BASE_IMAGE" 2>/dev/null || echo unbekannt)"
printf '%s  %s  ZeroWichtel %s  Basis %s\n' "$(date -u +%FT%TZ)" "$BASE_DIGEST" "$VERSION" "$BASE_IMAGE" >> "$BASE_DIR/base-images.log"
ok "Basisimage ${BASE_IMAGE}: ${BASE_DIGEST} (protokolliert in ${BASE_DIR}/base-images.log)"

wait_healthy() {
  local state=starting
  for _ in $(seq 1 40); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo starting)"
    [[ "$state" == healthy ]] && return 0
    if [[ "$state" != unhealthy ]] && in_container -fo /dev/null /api/info 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
check_app() {
  docker exec "$CONTAINER" zw check >/dev/null
}
rollback() {
  docker logs --tail 30 "$CONTAINER" >&2 2>/dev/null || true
  if [[ $had_previous == 1 ]]; then
    warn "Neue Version startet nicht – zurück auf die vorherige."
    docker tag zerowichtel:previous zerowichtel:local
    [[ -f compose.yaml.previous ]] && cp -a compose.yaml.previous compose.yaml
    docker compose up -d --force-recreate --no-build app >/dev/null 2>&1 || true
    if wait_healthy; then
      [[ -n "$PRE_BACKUP" ]] && warn "Die Datenbank von vor dem Update liegt in ${PRE_BACKUP} (Wiederherstellen: docs/INSTALL-DOCKER-CADDY.md, „Updates und Backups“)."
      die "$1 Die vorherige Version läuft wieder. Fehlermeldungen stehen oben."
    fi
  fi
  die "$1"
}

docker compose up -d --force-recreate app >/dev/null 2>&1 || rollback "Container-Start fehlgeschlagen."
wait_healthy || rollback "Container antwortet nicht."
check_app || rollback "config.json ist ungültig oder die Datenbank lässt sich nicht öffnen."
host_sum="$(sha256sum "$CFG" | cut -d' ' -f1)"
cont_sum="$(docker exec "$CONTAINER" sha256sum /etc/zerowichtel/config.json 2>/dev/null | cut -d' ' -f1 || true)"
[[ "$host_sum" == "$cont_sum" ]] || rollback "Der Container sieht eine andere config.json als ${CFG}."
NODEV="$(docker exec "$CONTAINER" node -v 2>/dev/null || echo '?')"
ok "Container ${CONTAINER} läuft mit Node.js ${NODEV} (kein öffentlicher Port, nur im Netz ${NETWORK})"
docker exec "$CONTAINER" zw check | sed 's/^/     /'
if [[ -f "$OLD_CFG" ]]; then
  mv "$OLD_CFG" "$CFG_DIR/config.php.1x"
  ok "Alte config.php als config/config.php.1x aufgehoben (nur für einen Rückfall auf 1.x)"
fi
docker image prune -f --filter "label=org.zerowichtel.image=app" >/dev/null 2>&1 || true   # nur alte, unbenannte ZeroWichtel-Images
[[ $had_previous == 1 ]] && ok "Vorherige Version als Image zerowichtel:previous aufgehoben (manueller Rückweg, siehe Doku)"
[[ -n "$PRE_BACKUP" ]] && ok "Datenbank von vor dem Update: ${PRE_BACKUP} (wird nach 14 Tagen von „zw backup“ aufgeräumt)"

# ---------------------------------------------------------------- 5. Aufräumen und Erinnerungen
step "Aufräumen und Erinnerungen"
if [[ -f /etc/cron.d/zerowichtel ]]; then
  rm -f /etc/cron.d/zerowichtel
  ok "Alter Cronjob (1.x) entfernt – das erledigt jetzt der Container selbst"
fi
docker exec "$CONTAINER" zw cleanup >/dev/null || warn "Erster Löschlauf mit Fehler – docker logs ${CONTAINER}"
ok "Löschung und Erinnerungen laufen im Container (alle 10 Minuten, kein Cronjob nötig)"

# ---------------------------------------------------------------- 6. Prüfung im Container
step "Prüfung (Container direkt)"
out="$(in_container /api/info || true)"
echo "$out" | grep -q '"requireOrganizerCode"' && ok "API antwortet" || warn "Unerwartete API-Antwort: ${out:0:200}"
hdr="$(in_container -I / || true)"
echo "$hdr" | grep -qi "content-security-policy" && ok "Startseite mit Sicherheitsheadern" || warn "Sicherheitsheader fehlen"
echo "$hdr" | grep -qi "^server:" && warn "Server-Header verrät die Software" || true
for p in /config.json /config.php /..%2fconfig.json /.git/config /data/zerowichtel.sqlite /server/main.mjs; do
  code="$(in_container -o /dev/null -w '%{http_code}' --path-as-is "${p}" || true)"
  [[ "$code" =~ ^(403|404)$ ]] || warn "${p} liefert HTTP ${code} – bitte prüfen"
done
ok "Konfiguration, Datenbank, Servercode und versteckte Dateien nicht abrufbar"
static_ok=1
for p in /css/app.css /js/app.js /sw.js /manifest.webmanifest /icons/icon-192.png; do
  code="$(in_container -o /dev/null -w '%{http_code}' "${p}" || true)"
  [[ "$code" == 200 ]] || { static_ok=0; warn "${p} liefert HTTP ${code}"; }
done
[[ $static_ok == 1 ]] && ok "Statische Dateien (App, Service Worker, Icons) werden ausgeliefert"
if in_container /robots.txt | grep -qx 'Disallow: /' \
   && [[ "$(in_container -o /dev/null -w '%{http_code}' /.well-known/tdmrep.json || true)" == 200 ]] \
   && echo "$hdr" | grep -qi '^x-robots-tag: noindex'; then
  ok "Crawler und KI ausgeschlossen (robots.txt, X-Robots-Tag, TDM-Vorbehalt)"
else
  warn "robots.txt, X-Robots-Tag oder /.well-known/tdmrep.json fehlen"
fi
code="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://$(cip):8080/" || true)"
[[ "$code" == 301 ]] && ok "Ohne HTTPS: Weiterleitung auf https://" || warn "HTTP ohne Proxy liefert ${code} statt 301"

# ---------------------------------------------------------------- 7. Caddy
step "Caddy"
CADDY="${CADDY_CONTAINER:-}"
if [[ -z "$CADDY" ]]; then
  CADDY="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($0) ~ /caddy/ {print $1; exit}')"
fi
caddy_ready=0
if [[ -z "$CADDY" ]]; then
  warn "Kein laufender Caddy-Container gefunden (Name mit CADDY_CONTAINER=… angeben)."
else
  CADDY_DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CADDY" 2>/dev/null || true)"
  CADDY_SVC="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$CADDY" 2>/dev/null || true)"
  ok "Caddy-Container: ${CADDY}${CADDY_DIR:+ (Compose: ${CADDY_DIR}, Dienst ${CADDY_SVC})}"
  if docker inspect -f '{{json .NetworkSettings.Networks}}' "$CADDY" | grep -q "\"${NETWORK}\""; then
    ok "Caddy hängt im Netz ${NETWORK}"
    if docker exec "$CADDY" wget -q -O - --header 'X-Forwarded-Proto: https' "http://${CONTAINER}:8080/api/info" 2>/dev/null | grep -q requireOrganizerCode; then
      ok "Caddy erreicht ZeroWichtel unter ${CONTAINER}:8080"
      caddy_ready=1
    else
      warn "Caddy erreicht ${CONTAINER}:8080 nicht."
    fi
  else
    warn "Caddy hängt noch nicht im Netz ${NETWORK} – siehe Schritt A unten."
  fi
fi

public_ok=0
if [[ "$TEST" != 1 && $caddy_ready == 1 ]]; then
  if curl -fsS --max-time 10 "https://${DOMAIN}/api/info" 2>/dev/null | grep -q requireOrganizerCode; then
    public_ok=1
    ok "Öffentlich erreichbar: https://${DOMAIN}"
  else
    warn "https://${DOMAIN} antwortet noch nicht – siehe Schritt B unten."
  fi
fi

CD="${CADDY_DIR:-<Ordner des Caddy-Stacks>}"
SVC="${CADDY_SVC:-caddy}"
show_a=0; show_b=0
if [[ $caddy_ready != 1 ]]; then show_a=1; show_b=1
elif [[ "$TEST" != 1 && $public_ok != 1 ]]; then show_b=1; fi

if [[ $show_a == 1 || $show_b == 1 ]]; then
  printf '\nNoch zu tun im Caddy-Stack (%s) – von Hand, das Skript ändert dort nichts:\n' "$CD"
fi
if [[ $show_a == 1 ]]; then
  cat <<EOF

  A) ${CD}/compose.override.yml: Caddy zusätzlich ins Netz ${NETWORK} hängen.
     Unter services → ${SVC} → networks den Eintrag ergänzen (bestehende Netze NICHT entfernen;
     hatte ${SVC} bisher keinen networks-Eintrag, zusätzlich "- default" aufführen):

       services:
         ${SVC}:
           networks:
             - default            # bzw. die bisherigen Netze
             - ${NETWORK}

       networks:
         ${NETWORK}:
           external: true
EOF
fi
if [[ $show_b == 1 ]]; then
  cat <<EOF

  B) Caddyfile: neuer Block, falls noch nicht vorhanden (ohne "log", ohne Statistik/replace-response,
     ohne gemeinsame Header-Snippets – die Sicherheitsheader setzt ZeroWichtel selbst):

       ${DOMAIN} {
           encode zstd gzip
           reverse_proxy ${CONTAINER}:8080 {
               header_down -Server
           }
       }

     Dazu ein DNS-A-Eintrag ${DOMAIN} → Adresse dieses Servers (Caddy holt das Zertifikat selbst).
EOF
fi
if [[ $show_a == 1 || $show_b == 1 ]]; then
  cat <<EOF

  Dann prüfen und übernehmen (kein "caddy fmt"):

       cd ${CD}
       sudo docker compose config --quiet
       sudo docker compose exec ${SVC} caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
       sudo docker compose up -d --force-recreate ${SVC}

  Anschließend dieses Skript erneut starten – es prüft dann den ganzen Weg.
EOF
fi

# shellcheck disable=SC1111  # deutsche Anführungszeichen im Text
cat <<EOF

ZeroWichtel ${VERSION} ist installiert (Container ${CONTAINER}).

Nächste Schritte:
  1. Betreiberangaben eintragen:  sudo nano ${CFG}      (operator, hoster; optional mail)
                                  Änderungen gelten nach spätestens einer Minute, kein Neustart nötig.
  2. Organisator-Code erzeugen:   sudo docker exec ${CONTAINER} zw codes create --label "Kim"
     oder im Admin-Bereich:       sudo docker exec -it ${CONTAINER} zw admin setup
                                  danach in config.json:  "admin": { "enabled": true }
  3. Seite öffnen, Runde anlegen, auf dem Handy „Zum Home-Bildschirm“.

Update später: neues ZIP hochladen und dieses Skript erneut ausführen.
Updates behalten alle Runden (data/ bleibt, Schemaänderungen nur additiv).
Backups von ${BASE_DIR}/data: gern, aber rotierend höchstens 14 Tage und in config.json
"privacy": { "backup_days": 14 } eintragen. config/config.json getrennt und verschlüsselt sichern.
EOF
