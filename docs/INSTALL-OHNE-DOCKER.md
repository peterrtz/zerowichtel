# Installation ohne Docker (Node.js + systemd + Reverse Proxy)

Für Server ohne Docker. ZeroWichtel läuft als systemd-Dienst unter einem eigenen Benutzer und hört nur auf `127.0.0.1:8080`; davor steht ein Reverse Proxy mit HTTPS (Caddy oder nginx). Empfohlen bleibt die [Docker-Variante](INSTALL-DOCKER-CADDY.md) – sie bringt Installer, Prüfungen und automatischen Rückfall mit.

```yaml
voraussetzungen:
  node: ">= 24.7"                     # node:sqlite, crypto.argon2, chacha20-poly1305 eingebaut; keine npm-Pakete
  reverse_proxy: caddy oder nginx      # setzt X-Forwarded-Proto und X-Forwarded-For
ordner:
  code: /opt/zerowichtel               # root-eigen, nur lesbar
  konfiguration: /etc/zerowichtel/config.json
  daten: /var/lib/zerowichtel          # legt systemd an (StateDirectory), nur für den Dienst
dienst: deploy/zerowichtel.service      # gehärtet: ProtectSystem=strict, keine Capabilities, Syscall-Filter, 256 MB
stand: Unit-Datei mit systemd-analyze geprüft; dieser Weg ist nicht Teil der automatischen Tests
```

## 1. Node.js 24 installieren

Über die Paketquelle von NodeSource oder die offiziellen Binärdateien von nodejs.org. Prüfen:

```sh
node -e 'console.log(process.version, typeof require("node:crypto").argon2Sync)'   # v24.x function
```

## 2. Code, Benutzer, Konfiguration

Das Paket `zerowichtel-2.5.3.zip` von der [Release-Seite](https://github.com/peterrtz/zerowichtel/releases) laden und die dort genannte SHA-256-Prüfsumme vergleichen.

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin zerowichtel
sudo mkdir -p /opt/zerowichtel /etc/zerowichtel
sudo unzip -o zerowichtel-2.5.3.zip 'server/*' 'public/*' config.example.json -d /opt/zerowichtel
sudo chown -R root:root /opt/zerowichtel && sudo chmod -R u=rwX,go=rX /opt/zerowichtel

# Konfiguration mit zufälligem Serverschlüssel
KEY="$(head -c 32 /dev/urandom | base64)"
sudo sh -c "sed -e 's#\"HIER-EINEN-ZUFALLSWERT-EINTRAGEN\"#\"$KEY\"#' \
  -e 's#\"client_ip_header\": null#\"client_ip_header\": \"X-Forwarded-For\"#' \
  /opt/zerowichtel/config.example.json > /etc/zerowichtel/config.json"
sudo chown root:zerowichtel /etc/zerowichtel/config.json && sudo chmod 640 /etc/zerowichtel/config.json
sudo nano /etc/zerowichtel/config.json    # base_url, operator, hoster, optional mail
```

Wer von 1.x kommt: Werte aus `config.php` übernehmen – vor allem **denselben `server_key`**, sonst sind gespeicherte E-Mail-Adressen und der Admin-Zugang nicht mehr lesbar. Die SQLite-Datei nach `/var/lib/zerowichtel/zerowichtel.sqlite` kopieren (Dienst vorher anlegen, damit der Ordner existiert, und Eigentümer `zerowichtel` setzen).

## 3. Dienst

```sh
sudo cp /opt/zerowichtel/deploy/zerowichtel.service /etc/systemd/system/ 2>/dev/null \
  || sudo unzip -o -j zerowichtel-2.5.3.zip deploy/zerowichtel.service -d /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zerowichtel
systemctl status zerowichtel
```

Liegt `node` nicht unter `/usr/bin/node`, den Pfad in `ExecStart` anpassen (`command -v node`).

## 4. Reverse Proxy

Caddy:

```caddyfile
wichteln.example.org {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}
```

nginx (Zertifikat z. B. per certbot; keine Zugriffsprotokolle):

```nginx
server {
    listen 443 ssl;
    server_name wichteln.example.org;
    access_log off;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;   # überschreiben, nicht anhängen
    }
}
```

Die Sicherheitsheader setzt ZeroWichtel selbst.

## Betrieb

```sh
sudo -u zerowichtel env ZW_CONFIG=/etc/zerowichtel/config.json ZW_DB_PATH=/var/lib/zerowichtel/zerowichtel.sqlite \
  node /opt/zerowichtel/server/main.mjs check          # bzw. codes create …, admin setup, cleanup
sudo systemctl reload zerowichtel                       # Konfiguration sofort neu laden (sonst innerhalb einer Minute)
journalctl -u zerowichtel                               # nur Start, Fehler, Neuladen – keine Zugriffe
```

Update: neues ZIP nach `/opt/zerowichtel` entpacken (wie oben), dann `sudo systemctl restart zerowichtel`.

`/var/lib/zerowichtel` darf gesichert werden – rotierend mit höchstens 14 Tagen Aufbewahrung und `"privacy": { "backup_days": 14 }` in der config.json, damit die Datenschutzerklärung stimmt. Die Konfiguration (Serverschlüssel) getrennt und verschlüsselt sichern.
