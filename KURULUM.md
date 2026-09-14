# Tera Portal — Kurulum Kılavuzu

Bu belge kurulumu yapacak kişi için yazılmıştır. Sırayla uygulayın; her adımın
sonunda bir **doğrulama** komutu vardır.

Sunucuya `root`/`sudo` yetkisiyle bağlanmış olmalısınız. Örnek alan adı/AD adresi
gibi değerleri kendi ortamınızdakiyle değiştirin.

---

## 0. Ne kuracaksınız?

| Bileşen | Görevi |
|---|---|
| Node.js 20 uygulaması (`server/`) | API, `127.0.0.1:8080` dinler |
| PostgreSQL 14+ | Tüm veriler |
| Nginx | TLS sonlandırma, statik dosya + API ters vekili (reverse proxy) |
| Active Directory (LDAPS) | Kimlik doğrulama — parola portalda saklanmaz |
| SMTP | Bildirim e-postaları (Admin Panel > SMTP Ayarları'ndan girilir) |

`index.html` (arayüz) statik olarak Nginx'ten sunulur; `/api/*` istekleri Node
uygulamasına yönlendirilir.

**Önemli — mevcut durum:** `index.html` şu an bu API'ye bağlı değildir; kendi
başına, bellek içi sahte veriyle çalışan bir tasarım/iş kuralı prototipidir.
Gerçek API (`server/`) çalışır ve test edilmiştir, ancak arayüzün bu API'yi
çağıracak şekilde yeniden yazılması **ayrı, tamamlanmamış bir iştir**. Bu belge
yalnızca backend'in kurulumunu anlatır.

---

## 1. Sunucu gereksinimleri

- Ubuntu 22.04 / RHEL 9, en az 2 vCPU, 4 GB RAM, 20 GB disk
- DNS kaydı + TLS sertifikası (Let's Encrypt veya kurumsal CA)
- AD servis hesabı (okuma yetkili) ve LDAPS (636) erişimi
- SMTP sunucu adresi
- PostgreSQL için yönetici erişimi

```bash
nc -zv dc01.tera.local 636      # LDAPS açık olmalı (gerçek AD kullanılacaksa)
```

## 2. Sistem paketleri ve kullanıcı

```bash
sudo apt update
sudo apt install -y curl ca-certificates postgresql postgresql-contrib nginx certbot python3-certbot-nginx unzip

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --home /opt/tera-portal --shell /usr/sbin/nologin teraportal
```

**Doğrulama**
```bash
node -v && psql --version && nginx -v && id teraportal
```

## 3. Dosyaların yerleştirilmesi

```bash
sudo mkdir -p /opt/tera-portal /var/lib/tera-portal/uploads /var/log/tera-portal
sudo unzip tera-portal.zip -d /opt/tera-portal
cd /opt/tera-portal
sudo npm ci --omit=dev
sudo chown -R teraportal:teraportal /opt/tera-portal /var/lib/tera-portal /var/log/tera-portal
```

**Doğrulama**
```bash
ls /opt/tera-portal/server/src/index.js && echo "dosyalar yerinde"
```

## 4. Veritabanı

```bash
sudo -u postgres psql <<'SQL'
CREATE USER tera_portal WITH PASSWORD 'BURAYA_GUCLU_PAROLA';
CREATE DATABASE tera_portal OWNER tera_portal ENCODING 'UTF8';
SQL
```

```bash
cd /opt/tera-portal
sudo -u teraportal cp .env.example .env
sudo -u teraportal nano .env   # DB_PASSWORD, LDAP_*, APP_ENCRYPTION_KEY doldurun
sudo -u teraportal npm run migrate
sudo -u teraportal npm run seed    # yalnızca ilk kurulumda — başlangıç kullanıcıları/rolleri
```

Şifreleme anahtarı üretmek için:
```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY için
```

**Doğrulama**
```bash
sudo -u postgres psql -d tera_portal -c '\dt'   # tablolar listelenmeli
sudo -u postgres psql -d tera_portal -c 'select count(*) from users;'   # 12 dönmeli (seed sonrası)
```

## 5. Üretim ortamı ayarları (.env)

`.env` içinde en az şunlar doldurulmalı:

```
NODE_ENV=production
AUTH_MODE=ldap
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
DB_PASSWORD=<adım 4'te verdiğiniz parola>
LDAP_URL=ldaps://dc01.tera.local:636
LDAP_BASE_DN=DC=tera,DC=local
LDAP_BIND_DN=CN=svc-portal,OU=ServisHesaplari,DC=tera,DC=local
```

`AUTH_MODE=mock` yalnızca geliştirme/testtedir — üretimde `ldap` olmadan
uygulama başlarken uyarı basar (bkz. `server/src/config.js`). SMTP ve AD servis
hesabı parolası `.env`'e değil, uygulama açıldıktan sonra **Admin Panel**
ekranlarından girilir; veritabanında şifreli saklanır.

## 6. systemd servisi

`/etc/systemd/system/tera-portal.service`:

```ini
[Unit]
Description=Tera Portal API
After=network.target postgresql.service

[Service]
Type=simple
User=teraportal
WorkingDirectory=/opt/tera-portal
EnvironmentFile=/opt/tera-portal/.env
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/tera-portal /var/log/tera-portal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tera-portal
```

**Doğrulama**
```bash
sudo systemctl status tera-portal
curl -s http://127.0.0.1:8080/api/healthz    # {"ok":true} dönmeli
```

## 7. Nginx (statik dosya + API ters vekili)

`/etc/nginx/sites-available/tera-portal`:

```nginx
server {
    listen 80;
    server_name portal.terayatirim.com.tr;
    root /opt/tera-portal;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri /index.html;
    }

    add_header X-Content-Type-Options "nosniff";
    add_header X-Frame-Options "DENY";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tera-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d portal.terayatirim.com.tr
```

**Doğrulama**
```bash
curl -I https://portal.terayatirim.com.tr/api/healthz   # 200 OK
```

## 8. Teslim kontrol listesi

- [ ] `npm test` sunucuda (veya CI'da) 8/8 geçiyor
- [ ] `AUTH_MODE=ldap` ve gerçek bir AD hesabıyla giriş denendi
- [ ] Admin Panel > SMTP Ayarları'ndan gerçek sunucu bilgisi girilip "Bağlantıyı sına" başarılı
- [ ] `systemctl status tera-portal` "active (running)"
- [ ] **Arayüz (`index.html`) henüz bu API'ye bağlı değil** — bu, ayrıca yapılması
      gereken bir geliştirme adımıdır (bkz. giriş bölümündeki not)
- [ ] Bağımsız sızma testi, gerçek AD/SMTP saha testi, yük testi, yedekten dönüş
      provası yapılmadı — bunlar canlıya çıkmadan önce kurumun kendisinin
      yapması/yaptırması gereken, kod yazarak kapatılamayan işlerdir

## 9. Güncelleme

```bash
cd /opt/tera-portal
sudo -u teraportal git pull   # veya yeni paketi açın
sudo -u teraportal npm ci --omit=dev
sudo -u teraportal npm run migrate   # yeni göç varsa
sudo systemctl restart tera-portal
```

## 10. Sorun giderme

| Belirti | Olası neden |
|---|---|
| `APP_ENCRYPTION_KEY tanımlı değil` hatasıyla başlamıyor | `.env`'de üretim modunda bu alan zorunlu, adım 5'i tamamlayın |
| Girişte "Dizin sunucusuna ulaşılamadı" | LDAPS 636 portu kapalı veya `LDAP_URL` yanlış |
| SMTP "Bağlantıyı sına" başarısız | Admin Panel'den girilen sunucu adresi/port yanlış veya ağdan erişilemiyor |
| 403 "CSRF doğrulaması başarısız" | İstekte `X-CSRF-Token` başlığı eksik/yanlış — giriş yanıtındaki `csrfToken` her istekte gönderilmeli |
| 429 "Çok fazla başarısız giriş denemesi" | `LOGIN_MAX_ATTEMPTS` aşıldı, 15 dakika sonra tekrar deneyin |
