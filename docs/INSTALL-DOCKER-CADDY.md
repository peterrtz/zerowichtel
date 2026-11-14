# Installation als Docker-Container hinter Caddy

Für einen Server, auf dem Caddy selbst in Docker Compose läuft und schon andere Seiten ausliefert. In den Beispielen liegt dieser Caddy-Stack in `/opt/caddy`; das Installationsskript ermittelt den tatsächlichen Ordner selbst und zeigt ihn an. ZeroWichtel bekommt einen eigenen Container; Caddy leitet die Subdomain dorthin weiter und holt das Zertifikat selbst.

```yaml
ziel:
  domain: wichteln.example.org
  ordner: /opt/zerowichtel             # compose.yaml, config/config.json, data/, build/
  container: zerowichtel               # offizielles Image node:24-trixie-slim (Debian 13), läuft als www-data
  netz: zerowichtel-proxy              # nur ZeroWichtel und Caddy; kein öffentlicher Port
  haertung: [read_only, cap_drop ALL, no-new-privileges, mem 256 MB, ohne npm/yarn im Image, keine Zugriffsprotokolle]
  hintergrund: im Container             # Löschung und Erinnerungen – kein Cronjob
  logs: docker logs zerowichtel        # nur Start, Fehler und „Konfiguration neu geladen“, max. 3 × 1 MB
neue_firewall_regeln: keine             # Caddy nutzt die bestehenden Ports 80/443
getestet:
  - Docker 29.8, Compose 5.5, Caddy 2.6 als Compose-Dienst (Testumgebung mit lokaler CA)
  - Erstinstallation, Update 1.2.1 → 2.0 mit Übernahme von config.php und Datenbank, erneuter Update-Lauf
  - automatischer Rückfall auf 1.2.1, wenn die neue Version nicht startet
  - Browser-Durchläufe (inkl. Admin-Bereich und Barrierefreiheit) über Caddy → Container
```

## Was das Skript anfasst – und was nicht

| Das Skript macht | Das machst du von Hand (zwei kleine Ergänzungen, nur bei der Erstinstallation) |
| --- | --- |
| `/opt/zerowichtel` anlegen, Image bauen, Container starten | Caddy in das Netz `zerowichtel-proxy` hängen (`compose.override.yml`) |
| `config/config.json` mit zufälligem Serverschlüssel – oder aus der `config.php` von 1.x übernommen | Block für die Subdomain im Caddyfile |
| Docker-Netz `zerowichtel-proxy`; alten Cronjob (1.x) entfernen | DNS-A-Eintrag |
| Prüft Container, Caddy-Verbindung und HTTPS | |

Caddyfile und Compose-Dateien des Caddy-Stacks bleiben unberührt, weil sie in der Regel von Hand gepflegt sind.

## Update von 1.x auf 2.0

Ab 2.0 läuft ZeroWichtel mit Node.js statt PHP. Für dich ändert sich fast nichts: dasselbe Skript, dieselbe Domain, dieselben Links, dieselbe Datenbank, derselbe Caddy-Block.

```yaml
update_1x_auf_2_0:
  befehl: sudo bash install-docker-caddy.sh zerowichtel-2.5.3.zip
  konfiguration: config/config.php wird automatisch nach config/config.json übernommen (Serverschlüssel, Mail, Betreiber, Admin)
  alte_datei: config/config.php.1x               # bleibt nur für einen Rückfall liegen
  datenbank: unverändert weiterverwendet          # Runden, Adressen, Admin-Zugang, Codes, Notfallcodes
  cronjob: /etc/cron.d/zerowichtel wird entfernt  # erledigt jetzt der Container
  caddy: keine Änderung nötig
  rueckfall_automatisch: startet 2.0 nicht, läuft sofort wieder 1.x (Image, compose.yaml und config.php)
```

Kommandos heißen jetzt `zw …` statt `php /var/www/zerowichtel/bin/….php`:

| bisher (1.x) | ab 2.0 |
| --- | --- |
| `docker exec zerowichtel php /var/www/zerowichtel/bin/codes.php create …` | `docker exec zerowichtel zw codes create …` |
| `docker exec -it zerowichtel php /var/www/zerowichtel/bin/admin.php setup` | `docker exec -it zerowichtel zw admin setup` |
| `docker exec zerowichtel php /var/www/zerowichtel/cron/cleanup.php` | `docker exec zerowichtel zw cleanup` (läuft ohnehin automatisch) |
| `docker exec zerowichtel php -v` | `docker exec zerowichtel zw check` |
| `nano config/config.php` (`'admin' => ['enabled' => true],`) | `nano config/config.json` (`"admin": { "enabled": true }`) |

Einmal nach dem Update prüfen, ob alles übernommen wurde:

```sh
sudo docker exec zerowichtel zw check
sudo head -20 /opt/zerowichtel/config/config.json
```

Zurück auf 1.x von Hand (nur solange `zerowichtel:previous` noch das PHP-Image ist, also direkt nach dem Update):

```sh
cd /opt/zerowichtel
sudo docker tag zerowichtel:previous zerowichtel:local
sudo cp compose.yaml.previous compose.yaml
sudo mv config/config.php.1x config/config.php
sudo docker compose up -d --force-recreate --no-build app
```

Die Datenbank funktioniert dabei in beide Richtungen; was du unter 2.0 angelegt hast, bleibt unter 1.x lesbar.

## 1. DNS

A-Eintrag `wichteln.example.org` → `<IPv4-Adresse des Servers>` (AAAA nur, falls der Server IPv6 hat). Prüfen:

```sh
dig +short wichteln.example.org
```

## 2. Paket hochladen und Skript starten

Vom eigenen Rechner:

```sh
scp -i ~/.ssh/<dein-key> zerowichtel-2.5.3.zip <benutzer>@<server>:~
```

Auf dem Server:

```sh
cd ~
unzip -o -j zerowichtel-2.5.3.zip deploy/install-docker-caddy.sh -d .
sudo DOMAIN=wichteln.example.org bash install-docker-caddy.sh zerowichtel-2.5.3.zip   # erste Installation
sudo bash install-docker-caddy.sh zerowichtel-2.5.3.zip                               # Update: Domain kommt aus config.json
```

Bei der ersten Installation muss `DOMAIN=` angegeben werden (es gibt keinen Standardwert). Bei einem Update liest das Skript die Domain aus `base_url` der vorhandenen `config/config.json`.

Der erste Lauf baut das Image (einige Minuten), startet den Container und prüft ihn. Am Ende zeigt er an, was im Caddy-Stack noch fehlt – mit den passenden Namen für deinen Server.

## 3. Caddy anbinden

**A) Netz:** In `/opt/caddy/compose.override.yml` beim Caddy-Dienst das Netz ergänzen. Bestehende Netze bleiben stehen (etwa für weitere Dienste, die Caddy anbindet). Hat der Dienst bisher keinen `networks:`-Eintrag, muss `- default` mit aufgeführt werden, sonst verliert Caddy die Verbindung zu den übrigen Diensten.

```yaml
services:
  caddy:
    networks:
      - default            # bzw. die bisherigen Netze
      - zerowichtel-proxy

networks:
  zerowichtel-proxy:
    external: true
```

Vorher und nachher vergleichen:

```sh
cd /opt/caddy
sudo docker compose config | sed -n '/^  caddy:/,/^  [a-z]/p' | grep -A5 'networks:'
```

**B) Caddyfile:** neuer Block am Ende, ohne `log` (keine Zugriffsprotokolle mit IP-Adressen), ohne Statistik-Einbindungen (z. B. per `replace-response`), ohne gemeinsame Header-Snippets anderer Seiten – die Sicherheitsheader und die CSP setzt ZeroWichtel selbst:

```caddyfile
wichteln.example.org {
	encode zstd gzip
	reverse_proxy zerowichtel:8080 {
		header_down -Server
	}
}
```

Prüfen und übernehmen – **kein `caddy fmt`**:

```sh
cd /opt/caddy
sudo docker compose config --quiet
sudo docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker compose up -d --force-recreate caddy
```

Falls das Caddyfile im Container unter einem anderen Pfad liegt, den Pfad aus dem `volumes:`-Eintrag des Caddy-Dienstes nehmen.

Danach das Installationsskript noch einmal starten. Es meldet dann zusätzlich „Caddy erreicht ZeroWichtel“ und „Öffentlich erreichbar“.

## 4. Einrichten

```sh
# Betreiberangaben (Impressum/Datenschutz): operator, hoster, privacy; optional E-Mail-Versand (mail)
sudo nano /opt/zerowichtel/config/config.json

# Organisator-Code erzeugen (wird nur einmal angezeigt)
sudo docker exec zerowichtel zw codes create --label "Kim" --rounds 3 --days 60

# Codes ansehen / widerrufen
sudo docker exec zerowichtel zw codes list
sudo docker exec zerowichtel zw codes revoke ZW-XXXX-XXXX-XXXX-XXXX
```

`config.json` ist JSON: Texte in doppelten Anführungszeichen, Kommas zwischen den Einträgen, kein Komma nach dem letzten. Zeilen, die mit `//` beginnen, sind Kommentare; alle Einträge sind in `/opt/zerowichtel/config.example.json` erklärt. Änderungen übernimmt der Container innerhalb einer Minute (sofort: `sudo docker kill -s HUP zerowichtel`). Ist die Datei fehlerhaft, läuft die bisherige Konfiguration weiter und `sudo docker logs --tail 5 zerowichtel` zeigt Zeile und Spalte des Fehlers. Der Container bindet den Ordner `config/` ein (nicht die einzelne Datei), daher ist egal, mit welchem Editor du speicherst.

## 5. Admin-Bereich (optional)

Organisator-Codes im Browser erzeugen, ansehen und widerrufen – geschützt mit Masterpasswort und Authenticator-App (TOTP). Eingerichtet wird nur auf der Konsole, nie im Browser.

```sh
# 1. Einrichten (interaktiv: Passwort, QR-Code für die Authenticator-App, Bestätigungscode, 10 Notfallcodes)
sudo docker exec -it zerowichtel zw admin setup

# 2. Einschalten: in config.json  "admin": { "enabled": true, "session_minutes": 30 }
sudo nano /opt/zerowichtel/config/config.json

# 3. Die angezeigte Adresse https://wichteln.example.org/#backend/… als Lesezeichen speichern
```

```yaml
admin_bereich:
  anmeldung: Masterpasswort (Argon2id) + 6-stelliger Code aus der App, ersatzweise ein Notfallcode (je einmal)
  sperre: nach 5 Fehlversuchen 15 Minuten, für alle
  sitzung: 30 Minuten fest, nur im geöffneten Tab, keine Cookies
  adresse: geheimer Pfad; falsch, ausgeschaltet oder nicht eingerichtet = 404 wie jede unbekannte Adresse
  kann: Codes erzeugen (mit Teilen-Menü, QR und Direktlink), auflisten, widerrufen; Zähler; Protokoll ohne IP
  kann_nicht: Runden, Namen, Wünsche, Zuordnungen sehen; config.json ändern
```

Weitere Befehle (alle mit `sudo docker exec -it zerowichtel zw admin …`):

| Befehl | Wofür |
| --- | --- |
| `status` | Zustand, Sperre, übrige Notfallcodes, letzte Ereignisse |
| `password` | Passwort ändern (meldet alle ab) |
| `totp` | Authenticator neu einrichten, z. B. neues Handy |
| `recovery` | neue Notfallcodes (alte werden ungültig) |
| `new-url` | neue geheime Adresse, falls die alte bekannt geworden ist |
| `logout-all` | alle Sitzungen beenden |
| `unlock` | Sperre nach Fehlversuchen sofort aufheben |
| `remove` | Admin-Zugang vollständig entfernen |

Passwort und Notfallcodes gehören in den Passwortmanager. Wenn Handy und Notfallcodes weg sind: per SSH `zw admin totp` – der Konsolenzugang bleibt immer der Rückweg.

## Update

Neues ZIP hochladen und dasselbe Skript erneut ausführen. `config/` und `data/` bleiben erhalten; das Basis-Image wird dabei frisch gezogen, so kommen auch Sicherheitsupdates von Node.js und Debian in den Container. Einmal im Monat neu bauen lohnt sich auch ohne neue ZeroWichtel-Version:

```sh
sudo bash install-docker-caddy.sh zerowichtel-2.5.3.zip
```

## Domain wechseln

Beispiel: von `alt.example.org` auf `wichteln.example.org`. Codes, Runden und der Admin-Zugang bleiben erhalten; die Schlüssel stecken im Teil hinter `#`, nicht in der Domain.

1. DNS für die neue Domain (und `www.`) auf den Server zeigen lassen. Vom Registrar voreingestellte Einträge (Parkseite, fremde AAAA-Einträge) entfernen, sonst scheitert das Zertifikat.
2. Im Caddyfile den ZeroWichtel-Block auf die neue Domain umstellen und die alte Domain sowie `www.` weiterleiten:

   ```caddyfile
   wichteln.example.org {
   	encode zstd gzip
   	reverse_proxy zerowichtel:8080 {
   		header_down -Server
   	}
   }

   www.wichteln.example.org, alt.example.org {
   	redir https://wichteln.example.org{uri} permanent
   }
   ```

   Browser hängen den Teil hinter `#` bei einer Weiterleitung wieder an. Alte Einladungs-, Personen- und Admin-Links funktionieren deshalb über die Weiterleitung weiter.
3. In `config/config.json` `base_url` auf `https://wichteln.example.org` setzen; neue Links und E-Mails verwenden dann die neue Domain. Mit E-Mail-Modus auch `from_email` anpassen.
4. `caddy validate`, `docker compose up -d --force-recreate caddy`, dann das Installationsskript mit `DOMAIN=wichteln.example.org` erneut ausführen; es prüft den neuen Weg.

Was nicht mitkommt: „Meine Runden“ auf der Startseite und installierte Home-Bildschirm-Apps gehören im Browser zur alten Domain. Eine Runde taucht unter der neuen Domain wieder auf, sobald man ihren Link einmal öffnet. Eine installierte App von der alten Domain entfernt man und legt sie neu an. Die Weiterleitung sollte so lange bestehen bleiben, bis alle unter der alten Domain verschickten Runden gelöscht sind (spätestens 14 Tage nach dem jeweiligen Wichteldatum).

## Image und Rückfall

```yaml
image:
  basis: node:24-trixie-slim       # offizielles Node.js-Image (Debian 13), bei jedem Skriptlauf frisch gezogen (--pull)
  entfernt: [npm, npx, corepack, yarn]   # zur Laufzeit nicht gebraucht
  prozess: node /app/server/main.mjs serve (www-data, Port 8080 nur im Docker-Netz)
  kommandozeile: zw                 # = node /app/server/main.mjs
  rueckfall:
    automatisch: startet die neue Version nicht, läuft sofort wieder die vorherige
    vorherige: bleibt als Image zerowichtel:previous (und compose.yaml.previous) liegen
```

Von Hand zurück auf die vorherige Version:

```sh
cd /opt/zerowichtel
sudo docker tag zerowichtel:previous zerowichtel:local
sudo cp compose.yaml.previous compose.yaml
sudo docker compose up -d --force-recreate --no-build app
```

Welche Version gerade läuft:

```sh
sudo docker exec zerowichtel zw check
```

## Updates und Backups

**Updates verlieren keine Daten.** Die Datenbank liegt in `/opt/zerowichtel/data/` außerhalb des Images; ein Update baut nur das Image neu. Schemaänderungen sind rein additiv (neue Spalten/Tabellen, nichts wird gelöscht oder umgebaut) und laufen beim Start automatisch. Der Installer sichert vor jedem Update zuerst die Datenbank (`zw backup` → `data/backup/`, ab 2.4.0; schlägt das fehl, bricht er ab, bevor etwas geändert wird), legt `zerowichtel:previous` und `compose.yaml.previous` an und rollt bei einem fehlgeschlagenen Gesundheitscheck selbst zurück. Achtung: Nach einem Update mit Schemaänderung (z. B. 2.4.0 → Schema 6) kann eine ältere Version die Datenbank weiter lesen, weil nur hinzugefügt wird – zurück geht es also, aber neue Funktionen fehlen dann.

**Backups sind erlaubt und sinnvoll**, damit laufende Runden einen Serverausfall überstehen. Die Inhalte (Namen, Wünsche, Zuordnungen) sind darin genauso verschlüsselt wie auf dem Server. Damit das Löschversprechen ehrlich bleibt:

```yaml
backup:
  befehl: sudo docker exec zerowichtel zw backup        # konsistente Kopie, auch im laufenden Betrieb (VACUUM INTO)
  ziel: /opt/zerowichtel/data/backup/zerowichtel-JJJJMMTT-hhmmss.sqlite   # nur für den Container-Benutzer lesbar (0600)
  rotation: löscht eigene Sicherungen älter als privacy.backup_days (sonst 14 Tage); --keep <tage> überschreibt
  taeglich: |
    # /etc/cron.d/zerowichtel-backup
    17 3 * * * root docker exec zerowichtel zw backup >/dev/null
  serverbackup: data/backup/ mitsichern (statt der laufenden zerowichtel.sqlite); dort ebenfalls höchstens 14 Tage aufbewahren
  datenschutzerklaerung: in config.json  "privacy": { "backup_days": 14 }   # erscheint dann in Abschnitt 4
  serverschluessel: config/config.json getrennt und verschlüsselt sichern – sie entschlüsselt E-Mail-Adressen und das TOTP-Geheimnis.
                    Ohne sie sind gesicherte Runden trotzdem nutzbar, nur gespeicherte E-Mail-Adressen und der Admin-Zugang nicht.
  wiederherstellen: |
    cd /opt/zerowichtel && sudo docker compose stop app
    sudo rm -f data/zerowichtel.sqlite-wal data/zerowichtel.sqlite-shm
    sudo install -m 600 -o 33 -g 33 data/backup/zerowichtel-….sqlite data/zerowichtel.sqlite   # 33 = www-data im Container
    sudo docker compose up -d --force-recreate app
    # Links der Teilnehmenden funktionieren wieder; Änderungen nach dem Sicherungszeitpunkt fehlen.
```

Prüfen, ob die vorhandenen Server-Backups des Caddy-Stacks auch `compose.override.yml` und das Caddyfile erfassen – dann sind die zwei Ergänzungen für ZeroWichtel automatisch mitgesichert.

## Fehlersuche

| Symptom | Prüfen |
| --- | --- |
| 502 von Caddy | `sudo docker ps --filter name=zerowichtel` – läuft und „healthy“? Caddy im Netz? `sudo docker network inspect zerowichtel-proxy` |
| Kein Zertifikat | DNS zeigt auf den Server? `cd /opt/caddy && sudo docker compose logs caddy \| grep -i zerowichtel` |
| API meldet Fehler 500 | `sudo docker logs --tail 50 zerowichtel` |
| Änderung an config.json wirkt nicht | `sudo docker logs --tail 5 zerowichtel` – steht dort „kein gültiges JSON … line X column Y“? |
| Andere Seiten nach Schritt A nicht erreichbar | Caddy hat sein bisheriges Netz verloren – `- default` bzw. die alten Netze wieder aufführen, `up -d --force-recreate caddy` |
| Erinnerungen kommen nicht an | `sudo docker logs zerowichtel \| grep Mail`; sofort auslösen: `sudo docker exec zerowichtel zw cleanup` |

## Entfernen

1. Block im Caddyfile und Netz-Einträge in `/opt/caddy/compose.override.yml` wieder entfernen, `validate`, `up -d --force-recreate caddy`.
2. Dann:

```sh
cd /opt/zerowichtel && sudo docker compose down --rmi local
sudo docker image rm zerowichtel:previous
sudo docker network rm zerowichtel-proxy
sudo rm -rf /opt/zerowichtel
```
