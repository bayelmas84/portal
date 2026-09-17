# BY Portal — Kurulum Kılavuzu

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
| Active Directory (LDAPS) — opsiyonel | Kimlik doğrulama; admin panelinden açılıp kapatılabilir bir anahtardır (bkz. aşağı) |
| SMTP | Bildirim e-postaları (Admin Panel > SMTP Ayarları'ndan girilir) |

`index.html` (arayüz) statik olarak Nginx'ten sunulur; `/api/*` istekleri Node
uygulamasına yönlendirilir.

**Güncel durum:** Arayüz gerçek API'ye tam olarak bağlıdır (giriş, onay
akışları, admin paneli, denetim kaydı, arama, bildirimler — hepsi canlı
backend üzerinden çalışır). Arayüz yalnızca `index.html` dosyasının Claude
önizleyicisi gibi bir sandbox'ta AÇILMADIĞI, gerçek bir tarayıcıda backend'siz
açıldığı durumlarda otomatik olarak "demo modu"na (bellek içi sahte veri) düşer
— bu, geliştirme/tanıtım kolaylığı içindir, üretimde kullanılmaz.

**Kimlik doğrulama modeli (önemli — mevcut durum):** Portal iki modu destekler,
Admin Panel > Dizin (AD) Ayarları ekranındaki tek bir anahtarla seçilir:

- **AD/LDAPS aktif:** Parola AD tarafından doğrulanır, portalda hiç saklanmaz.
  Parola politikası (süre, karmaşıklık, kilitlenme) tamamen AD'nin sorumluluğundadır.
- **AD kapalı (yerel mod):** Portal kendi parola sistemini kullanır. **Şifresiz
  giriş yoktur.** Her kullanıcı admin tarafından oluşturulurken bir ilk giriş
  şifresi alır (argon2 ile hashlenip saklanır) ve ilk girişte bu şifreyi kendi
  seçtiği bir şifreyle değiştirmek ZORUNDADIR (iki kez teyit ile). Kasıtlı
  olarak bir "şifremi unuttum" (self-service, e-posta ile sıfırlama) akışı
  YOKTUR — bunun yerine admin, Kullanıcılar ekranından "Şifreyi sıfırla"
  eylemini kullanır (yeni bir geçici şifre belirler, kullanıcının mevcut
  oturumları sonlanır, kullanıcı bir sonraki girişte yine kendi şifresini
  seçmek zorunda kalır).

**Bu belgede henüz yer almayan, üretim öncesi MUTLAKA yapılması gereken adımlar:**
- `NETWORK_ALLOWED_CIDRS` (bkz. adım 6) **mutlaka** kurumsal ağ aralığınızla
  doldurulmalıdır; boş bırakılırsa herkese açık kalır.
- AD'yi kullanmayacaksanız (yerel mod), her gerçek kullanıcıya admin panelinden
  AYRI birer ilk giriş şifresi vermeniz ve bunu güvenli bir kanaldan (yüz yüze,
  telefonla — e-posta ile DEĞİL) iletmeniz gerekir.

---

---

## 0b. Docker ile kurulum (alternatif — önerilir)

**Docker nedir, ne işe yarar:** Uygulamanızı (Node.js sürümü, sistem
kütüphaneleri, PostgreSQL, Nginx dahil) tek bir "konteyner imajı" içine
paketleyen bir teknolojidir. Aşağıdaki bölüm 1-9'daki manuel adımların
(Node kurulumu, PostgreSQL kurulumu, sistem servis dosyası yazma vb.)
büyük kısmını ortadan kaldırır.

**Bu projeye somut faydaları:**
- **"Benim sunucumda çalışmıyor" sorunu ortadan kalkar** — geliştirme
  ortamında test edilen Node/PostgreSQL sürümü, üretimde de birebir aynıdır.
- **Kurulum bir komuta iner**: `docker compose up -d` — Node kurulumu,
  PostgreSQL kurulumu, sistemd servis dosyası yazma gibi adımların yerini alır.
- **İzolasyon**: Portal'ın bağımlılıkları, sunucudaki diğer uygulamalardan
  ayrıdır; paket çakışması riski olmaz.
- **Kolay geri alma**: Yeni sürüm sorun çıkarırsa, önceki imaja saniyeler
  içinde dönülür.
- **Veritabanı hâlâ kalıcıdır**: PostgreSQL verisi bir Docker "volume"unda
  tutulur, konteyner yeniden başlasa/güncellense de veri kaybolmaz.

**Dürüst olarak belirtmem gereken sınırlar:**
- Docker, uygulamanın *kendi* güvenlik açıklarını kapatmaz — bu depodaki
  güvenlik sertleştirmesi (parametreli sorgular, CSRF, WAF vb.) hâlâ gereklidir.
- Ekstra bir soyutlama katmanıdır; bir sorunu debug ederken bazen
  "konteyner içinde mi, dışında mı" ayrımı yapmanız gerekir.
- PostgreSQL'i konteynerde çalıştırmak, yedekleme stratejinizi (volume
  yedekleme) ayrıca kurmanızı gerektirir — "kurulup unutulacak" bir şey değildir.

Bu depoda `Dockerfile`, `docker-compose.yml` ve `docker/nginx.conf` dosyaları
**hazır ve sözdizimi doğrulanmış** olarak bulunur (bu geliştirme ortamında
Docker Hub'a ağ erişimi kısıtlı olduğu için `docker compose up` ile tam
entegrasyon testi yapılamadı — bunu kendi sunucunuzda mutlaka doğrulayın).

### Adımlar

```bash
# 1) Docker ve Compose eklentisini kurun (Ubuntu):
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y docker-compose-plugin

# 2) .env dosyasını hazırlayın (bkz. .env.example — DB_PASSWORD ve
#    APP_ENCRYPTION_KEY mutlaka doldurulmalı):
cp .env.example .env
nano .env

# 3) Yapılandırmayı doğrulayın (imaj indirmeden sözdizimi kontrolü):
docker compose config

# 4) Derleyip ayağa kaldırın (ilk çalıştırmada migration otomatik uygulanır):
docker compose up -d --build

# 5) Sağlık kontrolü:
curl http://localhost/api/healthz
# beklenen: {"ok":true}

# 6) İLK KURULUMDA BİR KEZ: örnek/test kullanıcıları seed etmek isterseniz
#    (üretimde GENELLİKLE İSTENMEZ, gerçek kullanıcıları admin panelinden
#    kendiniz oluşturmanız önerilir):
docker compose exec app node server/src/seed.js
```

Loglar: `docker compose logs -f app`. Durdurmak: `docker compose down`
(veriyi de silmek isterseniz `docker compose down -v` — **dikkat, bu
PostgreSQL volume'unu da siler**).

WAF (bölüm 8b) bu Docker kurulumuna dahil değildir; ModSecurity'yi
`docker/nginx.conf` yerine kendi sunucunuzdaki Nginx'e (bölüm 8b'deki
adımlarla) kurmanız veya `nginx:alpine` yerine ModSecurity içeren bir imaj
kullanmanız gerekir.

---



- Ubuntu 22.04 / RHEL 9, en az 2 vCPU, 4 GB RAM, 20 GB disk
  - Yük testiyle doğrulandı (`autocannon`): normal kullanım (oturum açmış
    kullanıcıların GET istekleri) tek çekirdekte bile saniyede ~600
    istek, %97.5 gecikme ~95ms — kurumsal içi bir portal için bolca pay.
    Ancak `/api/auth/login` bilinçli olarak CPU-yoğun argon2id hashleme
    kullanır (brute-force'u zorlaştırmak için); tek çekirdekli bir test
    ortamında 20 eşzamanlı giriş isteği %50 gecikmeyi ~3.6 saniyeye
    çıkardı. Bu, günlük kullanımda (kullanıcılar zamana yayılı giriş
    yapar) sorun yaratmaz, ama "herkes sabah 9'da aynı anda giriş
    yapıyor" gibi yoğun-eşzamanlı senaryolar bekleniyorsa en az 2-4
    vCPU'lu bir sunucu (bu maddedeki asgari değerin üstü) önerilir.
- DNS kaydı + TLS sertifikası (Let's Encrypt veya kurumsal CA)
- AD servis hesabı (okuma yetkili) ve LDAPS (636) erişimi
- SMTP sunucu adresi
- PostgreSQL için yönetici erişimi

```bash
nc -zv dc01.byelmas.local 636      # LDAPS açık olmalı (gerçek AD kullanılacaksa)
```

## 2. Sistem paketleri ve kullanıcı

```bash
sudo apt update
sudo apt install -y curl ca-certificates postgresql postgresql-contrib nginx certbot python3-certbot-nginx unzip

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --home /opt/byelmas-portal --shell /usr/sbin/nologin byelmasportal
```

**Doğrulama**
```bash
node -v && psql --version && nginx -v && id byelmasportal
```

## 3. Dosyaların yerleştirilmesi

```bash
sudo mkdir -p /opt/byelmas-portal /var/lib/byelmas-portal/uploads /var/log/byelmas-portal
sudo unzip byelmas-portal.zip -d /opt/byelmas-portal
cd /opt/byelmas-portal
sudo npm ci --omit=dev
sudo chown -R byelmasportal:byelmasportal /opt/byelmas-portal /var/lib/byelmas-portal /var/log/byelmas-portal
```

**Doğrulama**
```bash
ls /opt/byelmas-portal/server/src/index.js && echo "dosyalar yerinde"
```

## 4. Veritabanı

```bash
sudo -u postgres psql <<'SQL'
CREATE USER byelmas_portal WITH PASSWORD 'BURAYA_GUCLU_PAROLA';
CREATE DATABASE byelmas_portal OWNER byelmas_portal ENCODING 'UTF8';
SQL
```

```bash
cd /opt/byelmas-portal
sudo -u byelmasportal cp .env.example .env
sudo -u byelmasportal nano .env   # DB_PASSWORD, LDAP_*, APP_ENCRYPTION_KEY doldurun
sudo -u byelmasportal npm run migrate
sudo -u byelmasportal npm run seed    # yalnızca ilk kurulumda — başlangıç kullanıcıları/rolleri
```

Şifreleme anahtarı üretmek için:
```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY için
```

**Doğrulama**
```bash
sudo -u postgres psql -d byelmas_portal -c '\dt'   # tablolar listelenmeli
sudo -u postgres psql -d byelmas_portal -c 'select count(*) from users;'   # 12 dönmeli (seed sonrası)
```

## 5. Üretim ortamı ayarları (.env)

`.env` içinde en az şunlar doldurulmalı:

```
NODE_ENV=production
AUTH_MODE=ldap
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
DB_PASSWORD=<adım 4'te verdiğiniz parola>
LDAP_URL=ldaps://dc01.byelmas.local:636
LDAP_BASE_DN=DC=byelmas,DC=local
LDAP_BIND_DN=CN=svc-portal,OU=ServisHesaplari,DC=byelmas,DC=local
NETWORK_ALLOWED_CIDRS=10.20.0.0/16   # kurumsal ağ/VPN aralığınız — BOŞ BIRAKMAYIN
LOGIN_MAX_ATTEMPTS=8                 # sonradan Admin Panel > Genel Ayarlar'dan da değiştirilebilir
```

`AUTH_MODE=mock` yalnızca geliştirme/testtedir — üretimde `ldap` olmadan
uygulama başlarken uyarı basar (bkz. `server/src/config.js`). SMTP ve AD servis
hesabı parolası `.env`'e değil, uygulama açıldıktan sonra **Admin Panel**
ekranlarından girilir; veritabanında şifreli saklanır.

## 6. systemd servisi

`/etc/systemd/system/byelmas-portal.service`:

```ini
[Unit]
Description=BY Portal API
After=network.target postgresql.service

[Service]
Type=simple
User=byelmasportal
WorkingDirectory=/opt/byelmas-portal
EnvironmentFile=/opt/byelmas-portal/.env
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/byelmas-portal /var/log/byelmas-portal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now byelmas-portal
```

**Doğrulama**
```bash
sudo systemctl status byelmas-portal
curl -s http://127.0.0.1:8080/api/healthz    # {"ok":true} dönmeli
```

## 7. Nginx (statik dosya + API ters vekili)

`/etc/nginx/sites-available/byelmas-portal`:

```nginx
server {
    listen 80;
    server_name portal.byelmas.com;
    root /opt/byelmas-portal;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # GÜVENLİK — $proxy_add_x_forwarded_for KULLANMAYIN: o değişken,
        # istemciden gelen X-Forwarded-For header'ını (varsa) KORUYUP sonuna
        # ekler. TRUST_PROXY=true olduğunda (bu kurulumda zorunlu), Node bu
        # zincirin EN SOLUNDAKİ değeri "gerçek istemci IP'si" sayar — yani bir
        # saldırgan sahte bir X-Forwarded-For göndererek NETWORK_ALLOWED_CIDRS
        # ağ kısıtlamasını tamamen atlatabilir. $remote_addr, Nginx'in
        # GERÇEKTEN gördüğü bağlantıyı kullanır ve istemciden gelen header'ı
        # tamamen yok sayarak bu sahteciliği engeller.
        proxy_set_header X-Forwarded-For $remote_addr;
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
sudo ln -s /etc/nginx/sites-available/byelmas-portal /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d portal.byelmas.com
```

**Doğrulama**
```bash
curl -I https://portal.byelmas.com/api/healthz   # 200 OK
```

## 8. Teslim kontrol listesi

- [ ] `npm test` sunucuda (veya CI'da) 8/8 geçiyor
- [ ] `npm audit` sıfır zafiyet gösteriyor (bu depo teslim anında öyleydi;
      düzenli olarak — örn. ayda bir — tekrar kontrol edin, yeni CVE'ler çıkabilir)
- [ ] AD kullanacaksanız: Admin Panel > Dizin (AD) Ayarları'ndan gerçek sunucu
      bilgisi girilip "Bağlantıyı sına" başarılı, ardından gerçek bir AD
      hesabıyla giriş denendi
- [ ] AD kullanmayacaksanız (yerel mod): her gerçek kullanıcıya admin panelinden
      AYRI birer ilk giriş şifresi verildi ve güvenli bir kanaldan iletildi;
      ilk girişte zorunlu şifre değişimi test edildi
- [ ] Admin Panel > SMTP Ayarları'ndan gerçek sunucu bilgisi girilip "Bağlantıyı sına" başarılı
- [ ] `NETWORK_ALLOWED_CIDRS` gerçek kurumsal ağ/VPN aralığınızla dolduruldu ve
      kurumsal ağ DIŞINDAN bir denemeyle (örn. mobil veri) erişimin reddedildiği
      doğrulandı
- [ ] `systemctl status byelmas-portal` "active (running)"
- [ ] Arayüz (`index.html`) gerçek API'ye bağlıdır ve bu depoda test edilmiştir
      (giriş, şifre değişimi, onay akışları, admin paneli, arama, bildirimler)
      — ancak bu testler geliştirme ortamında (mock AD/SMTP) yapılmıştır; SİZİN
      gerçek AD ve SMTP sunucunuza karşı ilk canlı denemeyi mutlaka siz yapmalısınız
- [ ] **Bağımsız (üçüncü taraf) sızma testi** hâlâ yapılmadı — bu depoda
      manuel olarak denenen ve düzeltilen açıklar (SQLi, XSS, CSRF, IDOR, dosya
      sahteciliği, rate-limit atlatma, LDAP/oturum zaman aşımı vb.) gerçek bir
      güvenlik firmasının sistematik taramasının (OWASP ZAP/Burp Suite gibi
      araçlarla) yerini TUTMAZ. Kurumun kendi güvenlik politikası gereği
      canlıya çıkmadan önce bunu yaptırması önerilir.
- [ ] Yedekten geri dönüş (restore) provası yapılmadı — `pg_dump`/`pg_restore`
      ile düzenli yedek alma ve geri yükleme testinin kurulması IT ekibinin işidir
- [ ] Yük testi bu ortamda simüle edilmiş verilerle yapıldı (50 eşzamanlı
      kullanıcı, gerçek DB sorgusu, %100 başarı, ort. 94ms gecikme — bu sırada
      genel API rate limiter'da kritik bir hata bulunup düzeltildi). Gerçek
      kullanıcı sayınızla (özellikle NAT arkasından) canlıda bir kez daha
      izlenmesi önerilir
- [ ] **KVKK (Kişisel Verilerin Korunması Kanunu) değerlendirmesi** hâlâ
      yapılmadı — sistem çalışan e-postası, fotoğrafı, organizasyon şeması gibi
      kişisel veri tutuyor. Bu hukuki bir değerlendirmedir, kod yazarak
      kapatılamaz; kurumun hukuk/uyum ekibinin yapması gerekir

## 8b. WAF (Web Application Firewall) kurulumu — ModSecurity + OWASP CRS

**Bu bölümdeki tüm adımlar bu ortamda gerçekten kurulup test edilmiştir** —
canlı bir SQL Injection, XSS ve komut enjeksiyonu denemesi WAF katmanında
403 ile durdurulmuş, meşru bir giriş isteği ise sorunsuz geçmiştir (yanlış
pozitif yok). Aşağıdaki adımlar, üretim sunucunuzda aynı sonucu verir.

**Neden gerekli:** Uygulama zaten kendi savunmalarına sahiptir (parametreli
SQL sorguları, çıktı escape'i, CSRF token'ı vb. — bkz. güvenlik testi
raporu). WAF bunun **yerine geçmez**, üstüne eklenir: kötücül bir istek
uygulama koduna hiç ulaşmadan, ağ katmanında (Nginx seviyesinde) reddedilir.
Bu, hem ekstra bir güvenlik katmanı hem de saldırı trafiğinin uygulama
sunucusuna (ve veritabanına) hiç ulaşmaması anlamına gelir.

### Kurulum

```bash
sudo apt update
sudo apt install -y libnginx-mod-http-modsecurity modsecurity-crs
```

`/etc/nginx/modsecurity.conf` içinde algılama modundan (log tutar ama
engellemez) engelleme moduna geçirin:

```bash
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/nginx/modsecurity.conf
```

OWASP Core Rule Set'i (921 kural) yükleyin. Paketin varsayılan yükleme
dosyası bu Nginx modülünün desteklemediği bir yönerge (`IncludeOptional`)
içerdiği için, kendi düzeltilmiş yükleme dosyanızı oluşturun:

```bash
sudo tee /etc/nginx/owasp-crs-load-fixed.conf > /dev/null << 'EOF'
Include /etc/modsecurity/crs/crs-setup.conf
Include /usr/share/modsecurity-crs/rules/*.conf
EOF

sudo tee /etc/nginx/modsecurity_includes.conf > /dev/null << 'EOF'
include modsecurity.conf
include /etc/nginx/owasp-crs-load-fixed.conf
EOF
```

Adım 6'daki (Nginx) site tanımına, `location /api/` bloğundan hemen önce
şu iki satırı ekleyin:

```nginx
    # WAF: ModSecurity + OWASP Core Rule Set
    modsecurity on;
    modsecurity_rules_file /etc/nginx/modsecurity_includes.conf;
```

Doğrulayın ve yeniden başlatın:

```bash
sudo nginx -t
# beklenen çıktı: "rules loaded inline/local/remote: 0/921/0" ve "syntax is ok"
sudo systemctl reload nginx
```

### Doğrulama (canlıya almadan önce mutlaka yapın)

```bash
# SQLi denemesi — 403 dönmeli
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://portal.byelmas.com/api/auth/login \
  -H "Content-Type: application/json" -d "{\"username\":\"x' OR '1'='1\",\"password\":\"x\"}"

# Meşru bir giriş — 200/401 (normal davranış) dönmeli, ASLA 403 OLMAMALI
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://portal.byelmas.com/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"gercek.kullanici","password":"gercek-sifre"}'
```

### Önemli: Yanlış pozitif riski

OWASP CRS **agresiftir** — meşru ama sıra dışı görünen bazı girdileri
(örn. duyuru metninde çok fazla özel karakter, çok uzun bir başlık) yanlış
pozitif olarak engelleyebilir. Canlıya almadan önce:

1. **Önce `DetectionOnly` modunda birkaç gün çalıştırın** (yukarıdaki
   `sed` adımını atlayın), `/var/log/nginx/modsec_audit.log` dosyasını
   izleyin, gerçek kullanıcı trafiğinizde hangi kuralların tetiklendiğini
   görün.
2. Yanlış pozitif veren belirli kuralları, ID'lerine göre
   `/etc/modsecurity/crs/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf`
   dosyasında devre dışı bırakın (CRS dokümantasyonundaki `SecRuleRemoveById`
   örneklerine bakın) — kuralın tamamını kapatmak yerine, mümkünse yalnızca
   belirli bir endpoint için hariç tutun.
3. `SecAuditLog /var/log/nginx/modsec_audit.log` dosyasını düzenli
   izleyin; bu dosya büyüyebilir, log rotasyonu kurun.

### Alternatif: Yönetilen (SaaS) WAF

Kendi sunucunuzda ModSecurity işletmek istemiyorsanız, Cloudflare gibi bir
CDN/WAF sağlayıcısının önüne koyduğu yönetilen WAF de aynı işi görür ve
bakım yükü gerektirmez — DNS'inizi ilgili sağlayıcıya yönlendirmeniz
yeterlidir. Bu, kurumun kendi tercihine bağlı bir altyapı kararıdır.

## 8c. WAF sonrası yeniden test

WAF kurulduktan sonra, daha önceki güvenlik testi raporundaki senaryoları
(özellikle SQLi/XSS) **artık Nginx üzerinden** (doğrudan Node portuna değil)
tekrar çalıştırıp, hem saldırıların engellendiğini hem gerçek kullanıcı
akışlarının (giriş, duyuru oluşturma, dosya yükleme) bozulmadığını
doğrulayın.



```bash
cd /opt/byelmas-portal
sudo -u byelmasportal git pull   # veya yeni paketi açın
sudo -u byelmasportal npm ci --omit=dev
sudo -u byelmasportal npm run migrate   # yeni göç varsa
sudo systemctl restart byelmas-portal
```

## 10. Sorun giderme

| Belirti | Olası neden |
|---|---|
| `APP_ENCRYPTION_KEY tanımlı değil` hatasıyla başlamıyor | `.env`'de üretim modunda bu alan zorunlu, adım 5'i tamamlayın |
| Girişte "Dizin sunucusuna ulaşılamadı" | LDAPS 636 portu kapalı veya `LDAP_URL` yanlış |
| SMTP "Bağlantıyı sına" başarısız | Admin Panel'den girilen sunucu adresi/port yanlış veya ağdan erişilemiyor |
| 403 "CSRF doğrulaması başarısız" | İstekte `X-CSRF-Token` başlığı eksik/yanlış — giriş yanıtındaki `csrfToken` her istekte gönderilmeli |
| 429 "Çok fazla başarısız giriş denemesi" | `LOGIN_MAX_ATTEMPTS` aşıldı, 15 dakika sonra tekrar deneyin |

### Acil durum: tüm adminler yerel modda şifrelerini unuttu / kilitlendi

Normal kurtarma yolu, bir adminin BAŞKA bir admini uygulama içinden sıfırlamasıdır
(Admin Panel > Kullanıcılar > "Şifreyi sıfırla" — yalnızca AD kapalıyken/yerel
modda görünür). Ama TÜM adminler aynı anda erişimini kaybederse, uygulama
içinden çözüm YOKTUR — bu kasıtlıdır (self-service şifre sıfırlama akışı
bilinçli olarak eklenmedi). Bu durumda IT ekibi, sunucuya doğrudan erişimle
(SSH), veritabanı üzerinden TEK BİR kullanıcının şifresini manuel olarak
yeni bir geçici şifreyle değiştirir ve zorunlu değişikliği tetikler:

```bash
# Önce yeni geçici şifrenin hash'ini üretin (argon2id):
node -e "require('/opt/byelmas-portal/server/src/lib/password').hashPassword(process.argv[1]).then(h=>console.log(h))" 'GeciciSifre123'

# Çıkan hash'i aşağıdaki sorguda kullanın:
sudo -u postgres psql -d byelmas_portal -c "
  UPDATE users SET password_hash='<yukarida-uretilen-hash>', must_change_password=true WHERE username='KULLANICI_ADI';
  DELETE FROM sessions WHERE username='KULLANICI_ADI';
"
```

Kullanıcı bu geçici şifreyle girip normal zorunlu değişim akışından geçecektir.
Bu komutu çalıştırma yetkisi olan kişi zaten sunucuya kök erişimine sahip
olduğu için, bu bir güvenlik açığı değil — fiziksel/altyapı erişimi olan
birinin son çare olarak başvurduğu, denetim kaydına (audit_log) YANSIMAYAN
tek istisnai müdahaledir. Bu yüzden erişimi son derece kısıtlı tutulmalı ve
kullanıldığında ayrıca (örn. IT bilet sistemine) not düşülmelidir.
