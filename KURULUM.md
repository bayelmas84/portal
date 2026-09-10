# Tera Portal — Kurulum Kılavuzu

Bu belge kurulumu yapacak kişi için yazılmıştır. Sırayla uygulayın; her adımın sonunda bir **doğrulama** komutu vardır, o komut beklenen çıktıyı vermeden sonraki adıma geçmeyin.

Sunucuya `root` veya `sudo` yetkisiyle bağlanmış olmanız gerekir. Komutlardaki `portal.terayatirim.com.tr`, `dc01.tera.local` gibi değerleri kendi ortamınızdakiyle değiştirin.

---

## 0. Ne kuracaksınız?

| Bileşen | Görevi |
|---|---|
| Node.js 20 uygulaması | Portalın kendisi, `127.0.0.1:8080` dinler |
| PostgreSQL 14+ | Tüm veriler |
| Nginx | TLS sonlandırma, dışarıya açılan tek kapı |
| Active Directory | Kimlik doğrulama (parola portalda saklanmaz) |
| SMTP | Bildirim e-postaları |

Uygulama internete doğrudan açılmaz. Kullanıcı → Nginx (443) → uygulama (127.0.0.1:8080) zinciri kurulur.

---

## 1. Ön gereksinimler

Kuruluma başlamadan önce elinizde şunlar olmalı:

- [ ] Sunucu: Ubuntu 22.04 / RHEL 9, en az 2 vCPU, 4 GB RAM, 40 GB disk
- [ ] `portal.terayatirim.com.tr` için DNS kaydı ve geçerli TLS sertifikası (`.crt` + `.key`)
- [ ] AD servis hesabı: okuma yetkili, örn. `CN=svc-portal,OU=ServisHesaplari,DC=tera,DC=local` ve parolası
- [ ] AD sunucusunun **LDAPS (636)** portu bu sunucudan erişilebilir
- [ ] SMTP sunucusu adresi ve portalın gönderim yapabileceği bir adres
- [ ] PostgreSQL için yönetici erişimi
- [ ] `tera-portal.zip` paketi

Ağ erişimini şimdi doğrulayın:

```bash
nc -zv dc01.tera.local 636      # LDAPS açık olmalı
nc -zv smtp.tera.local 25       # SMTP açık olmalı
```

---

## 2. Sistem paketleri ve kullanıcı

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg postgresql postgresql-contrib nginx unzip

# Node.js 20 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Uygulama yalnız bu kullanıcıyla çalışır; kabuk girişi kapalıdır
sudo useradd --system --home /opt/tera-portal --shell /usr/sbin/nologin teraportal
```

**Doğrulama**

```bash
node -v      # v20.x veya üzeri
psql --version
nginx -v
id teraportal
```

---

## 3. Dosyaların yerleştirilmesi

```bash
sudo mkdir -p /opt/tera-portal /var/lib/tera-portal/uploads /var/log/tera-portal
sudo unzip tera-portal.zip -d /opt/tera-portal
cd /opt/tera-portal

sudo npm ci --omit=dev            # yalnızca üretim bağımlılıkları

sudo chown -R teraportal:teraportal /opt/tera-portal /var/lib/tera-portal /var/log/tera-portal
sudo chmod 750 /var/lib/tera-portal/uploads
```

**Doğrulama**

```bash
ls /opt/tera-portal/server/src/index.js && echo "dosyalar yerinde"
sudo -u teraportal test -w /var/lib/tera-portal/uploads && echo "yükleme dizini yazılabilir"
```

---

## 4. Veritabanı

```bash
sudo -u postgres psql <<'SQL'
CREATE USER tera_portal WITH PASSWORD 'BURAYA_GUCLU_PAROLA';
CREATE DATABASE tera_portal OWNER tera_portal ENCODING 'UTF8' LC_COLLATE 'tr_TR.UTF-8' LC_CTYPE 'tr_TR.UTF-8' TEMPLATE template0;
\c tera_portal
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO tera_portal;
SQL
```

Parolayı bir yere not edin; bir sonraki adımda `.env` dosyasına yazacaksınız.

### 4.1 Uygulama hesabının yetkilerini kısıtlayın

Uygulama hesabı tabloları oluşturmamalı, denetim kaydını değiştirmemelidir. Şemayı ayrı bir
sahip hesap oluşturur, uygulama yalnızca veri işler.

```bash
sudo -u postgres psql -d tera_portal <<'SQL'
CREATE USER tera_portal_owner WITH PASSWORD 'BURAYA_AYRI_GUCLU_PAROLA';
ALTER DATABASE tera_portal OWNER TO tera_portal_owner;
ALTER SCHEMA public OWNER TO tera_portal_owner;
GRANT USAGE ON SCHEMA public TO tera_portal;
SQL
```

Göçleri sahip hesapla çalıştıracağınız için `.env` dosyasına ek olarak şu satırı da yazın
(yalnızca göç sırasında kullanılır, uygulama bu hesabı kullanmaz):

```
MIGRATION_DB_USER=tera_portal_owner
MIGRATION_DB_PASSWORD=BURAYA_AYRI_GUCLU_PAROLA
```

Şema kurulduktan sonra (adım 6'nın ardından) yetki kısıtlama betiğini çalıştıracaksınız:

```bash
sudo -u postgres psql -d tera_portal -f /opt/tera-portal/ops/least-privilege.sql
```

Bu betik uygulama hesabından `CREATE` yetkisini geri alır, denetim kaydında `UPDATE`,
`DELETE` ve `TRUNCATE` yetkisini kaldırır, göç tablosunu salt okunur yapar.

**Doğrulama** — uygulama hesabı tablo oluşturamamalı:

```bash
PGPASSWORD='UYGULAMA_PAROLASI' psql -h 127.0.0.1 -U tera_portal -d tera_portal \
  -c 'CREATE TABLE deneme(id int);'     # "permission denied for schema public" dönmeli
```

Yalnızca yerel bağlantıya izin verin — `/etc/postgresql/*/main/pg_hba.conf` içinde uygulama için satır:

```
host    tera_portal     tera_portal     127.0.0.1/32     scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

**Doğrulama**

```bash
PGPASSWORD='BURAYA_GUCLU_PAROLA' psql -h 127.0.0.1 -U tera_portal -d tera_portal -c 'SELECT current_database();'
```

---

## 5. Yapılandırma dosyası

```bash
cd /opt/tera-portal
sudo cp .env.example .env
sudo nano .env
```

Doldurulması **zorunlu** alanlar:

| Alan | Ne yazılacak |
|---|---|
| `APP_URL` | `https://portal.terayatirim.com.tr` (https olmak zorunda) |
| `DB_PASSWORD` | Adım 4'te belirlediğiniz parola |
| `LDAP_URL` | `ldaps://dc01.tera.local:636` (ldap:// kabul edilmez) |
| `LDAP_BIND_DN` | AD servis hesabının tam DN'i |
| `LDAP_BIND_PASSWORD` | Servis hesabı parolası |
| `LDAP_BASE_DN` | Kullanıcıların arandığı kök, örn. `DC=tera,DC=local` |
| `CSRF_SECRET` | Aşağıdaki ilk komutun çıktısı |
| `APP_ENCRYPTION_KEY` | Aşağıdaki ikinci komutun çıktısı |
| `BI_BASE_URL` | BI (PRISMA) adresi — Raporlar modülü kullanılacaksa; `https://` olmak zorunda |

```bash
openssl rand -base64 48        # çıktıyı CSRF_SECRET satırına yapıştırın
openssl rand -base64 32        # çıktıyı APP_ENCRYPTION_KEY satırına yapıştırın
```

`APP_ENCRYPTION_KEY`, Admin Panel'den girilen SMTP parolasını şifrelemek için kullanılır.
İki anahtar birbirinden farklı olmalıdır; aynı olursa uygulama açılmaz. **Bu anahtarı parola
kasasına kaydedin:** kaybolursa kayıtlı SMTP parolası çözülemez ve ekrandan yeniden girilmesi gerekir.

`SMTP_HOST` alanını doldurmanız gerekmez — e-posta ayarlarını adım 11.5'te ekrandan gireceksiniz.

Dosyayı kilitleyin:

```bash
sudo chown teraportal:teraportal /opt/tera-portal/.env
sudo chmod 600 /opt/tera-portal/.env
```

**Doğrulama** — yapılandırma hatalıysa uygulama açılmaz, sebebini yazar:

```bash
sudo -u teraportal bash -c 'cd /opt/tera-portal && node -e "require(\"./server/src/config\").load(); console.log(\"yapılandırma geçerli\")"'
```

---

## 6. Şema ve başlangıç verisi

```bash
cd /opt/tera-portal
sudo -u teraportal npm run migrate     # tabloları oluşturur
sudo -u teraportal npm run seed        # rolleri, yetki matrisini, bildirim tanımlarını yükler
```

Beklenen çıktı, göç dosyalarının sırayla uygulandığı ve şuna benzer üç satır:

```
Başlangıç verisi yüklendi: 9 rol, 15 bildirim tanımı, 40 ekran.
Varsayılan durum: 24 ekran açık (Proje Yönetimi, Admin Panel, Kısayollar), 24 ekran kapalı.
Diğer modülleri Admin Panel > Ekran yönetimi ekranından açabilirsiniz.
```

**Bu önemlidir:** kurulumda yalnızca **Proje Yönetimi**, **Admin Panel** ve **Kısayollar** açık gelir.
Duyurular, Doküman Yönetimi, Eğitimler, Raporlar, Onaylar, Uyum ve Teftiş modülleri kapalıdır ve
hiçbir rolde menüde görünmez. Bunları adım 11.11'de, kurum hazır olduğunda tek tek açacaksınız.

Göç dosyaları: `001_init.sql` şema, `002_seed_quiz.sql` örnek sınav soruları,
`003_mail_settings.sql` e-posta ayarları tablosu, `004_bi_reports.sql` BI rapor kataloğu.
`005_requests_kind_upgrade.sql` yalnızca 1.2 öncesi kurulumları yükseltir; yeni kurulumda
hiçbir şey değiştirmez.

Şema oluştuktan sonra yetki kısıtlamasını uygulayın (adım 4.1'de hazırlanan betik):

```bash
sudo -u postgres psql -d tera_portal -f /opt/tera-portal/ops/least-privilege.sql
```

**Doğrulama**

```bash
PGPASSWORD='...' psql -h 127.0.0.1 -U tera_portal -d tera_portal -c '\dt' | head -20
# uygulama hesabının yetkileri:
PGPASSWORD='...' psql -h 127.0.0.1 -U tera_portal -d tera_portal \
  -c "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='tera_portal' AND table_name='audit_log';"
# yalnızca SELECT ve INSERT görünmeli
```

---

## 7. İlk yöneticinin tanımlanması

Portal kullanıcı listesini AD'den otomatik almaz; kimin hangi rolde olduğunu siz belirlersiniz. İlk yöneticiyi komutla ekleyin — bundan sonrakiler Admin Panel'den eklenir.

```bash
cd /opt/tera-portal
sudo -u teraportal node ops/create-admin.js elif.yalcin "Elif Yalçın" BT DIR
```

Kullanıcı adı AD'deki `sAMAccountName` ile birebir aynı olmalıdır. Parola sorulmaz; giriş AD parolasıyla yapılır.

---

## 8. Servisin başlatılması

```bash
sudo cp /opt/tera-portal/ops/tera-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tera-portal
sudo systemctl status tera-portal --no-pager
```

**Doğrulama**

```bash
curl -s http://127.0.0.1:8080/healthz     # {"ok":true}
sudo tail -20 /var/log/tera-portal/app.log
```

Servis açılmazsa `journalctl -u tera-portal -n 50 --no-pager` çıktısına bakın; yapılandırma hataları burada Türkçe yazılır.

---

## 9. Nginx ve TLS

```bash
sudo cp /opt/tera-portal/ops/nginx-tera-portal.conf /etc/nginx/sites-available/tera-portal
sudo nano /etc/nginx/sites-available/tera-portal      # sunucu adı ve sertifika yollarını düzeltin
sudo ln -s /etc/nginx/sites-available/tera-portal /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Sertifika dosyalarının izinleri:

```bash
sudo chmod 640 /etc/ssl/private/portal.terayatirim.key
sudo chown root:ssl-cert /etc/ssl/private/portal.terayatirim.key
```

**Doğrulama**

```bash
curl -I https://portal.terayatirim.com.tr           # 200 dönmeli
curl -I http://portal.terayatirim.com.tr            # 301 dönmeli
curl -sI https://portal.terayatirim.com.tr | grep -i strict-transport-security
```

---

## 10. Güvenlik duvarı

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp
sudo ufw deny 8080/tcp        # uygulamaya dışarıdan doğrudan erişim kapalı
sudo ufw enable
```

**Doğrulama** — başka bir makineden:

```bash
nc -zv portal.terayatirim.com.tr 8080     # bağlantı REDDEDİLMELİ
```

---

## 11. İlk giriş ve kurulum testi

Tarayıcıdan `https://portal.terayatirim.com.tr` adresine gidin ve adım 7'de tanımladığınız kullanıcıyla, **AD parolanızla** giriş yapın.

Sırayla şunları doğrulayın:

1. Giriş yapıldı, sol menüde modüller göründü.
2. **Admin Panel > Kullanıcılar** — kendinizi görüyorsunuz.
3. **Admin Panel > Kullanıcılar** üzerinden Teftiş rolünde en az bir kişi ekleyin. *Bu zorunludur:* yasal duyurular ve tüm dokümanlar Teftiş onayına düşer, Teftiş rolünde aktif kullanıcı yoksa yükleme yapılamaz.
4. Her kullanıcının **yöneticisi** alanını doldurun. Genel duyurular yöneticiye gider; boşsa duyuru girilemez.
5. **Duyurular > Duyuru gir** ile deneme duyurusu oluşturun, onaycıya düştüğünü görün.
6. **Doküman Yönetimi > Doküman ekle** ile küçük bir PDF yükleyin; Teftiş kullanıcısıyla girip **Teftiş kuyruğu > Detay** ekranında dosyanın açıldığını doğrulayın.
7. **Admin Panel > Bildirim tanımları** ekranında hangi olayda kimin e-posta alacağını gözden geçirin.
8. **Admin Panel > E-posta ayarları** ekranını açın ve SMTP bilgilerini girin:

   | Alan | Örnek / açıklama |
   |---|---|
   | SMTP sunucusu | `smtp.tera.local` |
   | Port ve şifreleme | Kurum içi röle için genelde 25 / şifreleme yok, kimlik doğrulamalı sunucu için 587 / STARTTLS, doğrudan TLS için 465 / TLS |
   | Kimlik doğrulama kullanıcısı | Röle kimlik istemiyorsa boş bırakın |
   | Parola | Şifreli saklanır, ekrana bir daha gelmez |
   | Gönderen adresi | `portal@terayatirim.com.tr` |
   | E-posta alan adı | `terayatirim.com.tr` — adresi kayıtlı olmayan kullanıcı için ad.soyad@alanadı üretilir |
   | Teftiş ekibi / tüm personel grup adresi | Dağıtım listeleriniz |
   | Bu ayarları kullan | İşaretleyin |

   Kaydettikten sonra **Bağlantıyı sına** düğmesine basın; TLS ve kimlik doğrulama denenir, posta gönderilmez.
   Ardından **Deneme e-postası gönder** ile kendi adresinize bir mesaj gönderip kutunuzu kontrol edin.
   Sonuç aynı ekranda "Son deneme" kutusunda ve denetim kaydında görünür.

   Ayar ekrandan yapıldığı için `.env` içindeki SMTP satırları gereksizdir; "Bu ayarları kullan"
   işaretini kaldırırsanız uygulama yedek olarak `.env` değerlerine düşer.

9. Yüklediğiniz doküman yayına girdiğinde **tüm aktif kullanıcılara zorunlu okuma olarak atanır**
   (varsayılan süre 30 gün, `.env` içinde `READING_DUE_DAYS`). Personel bir kullanıcıyla girip
   **Eğitimler > Okunmamış** listesinde göründüğünü doğrulayın.
10. **Raporlar modülünü kullanacaksanız** `.env` içindeki `BI_BASE_URL` değerini doldurun ve
   modülü açtıktan sonra şu akışı doğrulayın: Proje Yöneticisi rolündeki bir kullanıcıyla
   **Raporlar > Rapor geliştirme** ekranında yeni rapor tanımlayın (kod, ad, alan, sıklık, BI yolu),
   **Yayın onayına gönder** ile Teftiş'e gönderin. Teftiş kullanıcısıyla girip onaylayın; rapor
   katalogda görünsün. Katalogdaki **Raporu aç** düğmesi raporu BI servisinde yeni sekmede açar.

   Portal, BI'a imzalı ve 60 saniye geçerli bir kimlik devri anahtarı gönderir
   (`?sso=...`). **BI tarafında bu anahtarı doğrulayan uç noktanın yazılması gerekir**;
   doğrulama `APP_ENCRYPTION_KEY` ile HMAC-SHA256 üzerinden yapılır. Anahtar içeriği
   `kullanıcı|rol|rapor kodu|son geçerlilik` biçimindedir. Bu iş portal paketinin dışındadır.


   **Yönetici özet raporu ünvana bağlıdır.** Proje Yönetimi > Yönetici özeti ekranı yalnızca
   **Direktör**, **Grup Direktörü** ve **Genel Müdür Yardımcısı** ünvanlarına açıktır. Rol yetkisi
   tek başına yeterli değildir: Proje Yöneticisi rolündeki bir Müdür bu raporu göremez, aynı rol
   Direktör ünvanındaysa görebilir. Ünvanları **Admin Panel > Kullanıcılar** ekranından atarsınız;
   ünvan listesi **Admin Panel > Ünvanlar** ekranında yönetilir ve `GDIR` (Grup Direktörü) kodu
   kurulumla birlikte gelir.

   Grafiklerde ve gösterge kutularında **drill-down** vardır: bir kutuya veya grafik satırına
   tıkladığınızda altındaki iş kalemleri liste olarak açılır. Sapma göstergesi yüzdedir:
   `(iş % − takvim %) ÷ takvim %`. Takvimin %20'sinden fazla gerisinde kalan projeler yönetici
   özetinde "Needs attention" başlığında toplanır.

   Proje grafikleri (burndown, hız, durum ve kişi dağılımı) `burndown-job.js` zamanlanmış görevinin
   yazdığı günlük anlık görüntülerden çizilir. Cron kaydını kurmazsanız burndown grafiği boş kalır;
   diğer grafikler ve tamamlanma yüzdeleri anlık hesaplandığı için etkilenmez.

11. **Kullanıma açılacak modülleri belirleyin.** **Admin Panel > Ekran yönetimi** ekranını açın;
   kapalı gelen her modülü, o modülün onaycıları ve yetkileri tanımlandıktan sonra `açık` yapın.
   Önerilen sıra:

   | Sıra | Modül | Açmadan önce hazır olması gereken |
   |---|---|---|
   | 1 | Duyurular | Her kullanıcının yöneticisi tanımlı, Teftiş rolünde aktif kullanıcı var |
   | 2 | Onaylar | Duyurular veya Dokümanlar açık (onaya düşecek talep olsun) |
   | 3 | Doküman Yönetimi | Teftiş rolü ve yükleme dizini hazır |
   | 4 | Eğitimler | En az bir doküman yayında |
   | 5 | Uyum ve Teftiş | Teftiş ve İç Kontrol kullanıcıları tanımlı |
   | 6 | Raporlar | `BI_BASE_URL` tanımlı ve BI tarafı SSO doğrulamasını yapıyor |
   | 7 | — | Kısayollar zaten açık gelir; adresleri Admin Panel > Kısayol yönetimi'nden girin |

   Bir modülü geçici olarak durdurmak isterseniz `kapalı` yerine `bakımda` seçin: menüde kalır,
   açıldığında bakım bilgisi verir, ana ekrandaki yönlendirmeler gizlenir.

12. Kavrama sınavı soruları veritabanında tutulur. `server/migrations/002_seed_quiz.sql` örnek beş soru yükler;
   kendi sorularınızı aynı biçimde ekleyin. Sorusu olmayan doküman için okuma onayı yeterlidir.

---

## 12. Kurulum sonrası denetim

```bash
sudo /opt/tera-portal/ops/healthcheck.sh
```

On beş denetimin tamamı `TAMAM` dönmelidir. `HATA` görürseniz:

| Denetim | Sık sebep | Çözüm |
|---|---|---|
| servis çalışıyor | `.env` eksik/hatalı | `journalctl -u tera-portal -n 50` |
| veritabanı erişilebilir | `pg_hba.conf` satırı yok | Adım 4'ü tekrarlayın |
| uygulama yanıt veriyor | port çakışması | `ss -tlnp \| grep 8080` |
| HSTS / CSP başlığı | Nginx yapılandırması yüklenmemiş | `nginx -t && systemctl reload nginx` |
| oturumsuz API 401 | ters vekil yanlış yönlendiriyor | `proxy_pass` satırını kontrol edin |
| uygulama hesabı tablo oluşturamıyor | `least-privilege.sql` çalıştırılmadı | Adım 4.1 ve 6'yı tekrarlayın |
| `.env` dosya izni 600 | izin gevşek bırakılmış | `sudo chmod 600 /opt/tera-portal/.env` |
| statik güvenlik denetimi temiz | kodda kalıp bulgusu | `ops/security-scan.sh` çıktısındaki satırı inceleyin |

---

## 12.1 Zamanlanmış görevler

Portal iki arka plan işi kullanır. İkisi de cron ile çalışır; servis içinde zamanlayıcı yoktur.

```bash
sudo crontab -e
```

```
# E-posta kuyruğunu her 5 dakikada bir boşaltır
*/5 * * * * cd /opt/tera-portal && sudo -u teraportal node ops/mail-worker.js >> /var/log/tera-portal/mail.log 2>&1

# Zorunlu okuma hatırlatmaları: hafta içi her sabah 08:00
0 8 * * 1-5 cd /opt/tera-portal && sudo -u teraportal node ops/reminder-job.js >> /var/log/tera-portal/reminder.log 2>&1

# Sprint burndown anlık görüntüsü: her gün 23:55 (proje grafikleri bu kayıtlardan çizilir)
55 23 * * * cd /opt/tera-portal && sudo -u teraportal node ops/burndown-job.js >> /var/log/tera-portal/burndown.log 2>&1
```

Hatırlatma kuralı: son tarihe 3, 2, 1 ve 0 gün kala ilgili kişiye posta gider. Süre geçtiğinde
her gün tekrarlanır ve yöneticiyle Teftiş ekibi de bilgilendirilir (alıcılar Admin Panel'den değiştirilebilir).

E-posta ayarları Admin Panel'den girildiyse bu işler o ayarları kullanır; `.env` düzenlemeye gerek yoktur.

**Doğrulama** — elle bir tur çalıştırın:

```bash
cd /opt/tera-portal
sudo -u teraportal node ops/reminder-job.js     # kontrol/hatırlatma/süre aşımı sayıları
sudo -u teraportal node ops/mail-worker.js      # gönderilen/başarısız/kuyrukta sayıları
```

SMTP tanımlı değilse postalar kaybolmaz, kuyrukta bekler; ayar girildiğinde ilk turda gönderilir.
Kuyruğu **Admin Panel > E-posta ayarları** ekranından elle de boşaltabilirsiniz. Kuyruğu portal üzerinden
**Doküman Yönetimi > Gönderilen bildirimler** ekranından da izleyebilirsiniz.

---

## 11.12 Active Directory bağlantısını ekrandan tanımlama

`.env` dosyasındaki LDAP satırları ilk kurulum için yeterlidir, ancak bağlantıyı **Admin Panel >
Dizin (AD) ayarları** ekranından yönetmeniz önerilir: değişiklik sunucuya girmeden yapılır,
servis hesabı parolası şifreli saklanır ve her değişiklik denetim kaydına yazılır.

| Alan | Örnek |
|---|---|
| Sunucu adresi | `ldaps://dc01.tera.local:636` (üretimde `ldap://` kabul edilmez) |
| Base DN | `DC=tera,DC=local` |
| Servis hesabı DN | `CN=svc-portal,OU=Servis,DC=tera,DC=local` |
| Servis hesabı parolası | Şifreli saklanır, ekrana bir daha gelmez |
| Kullanıcı filtresi | `(&(objectClass=user)(sAMAccountName={username}))` — `{username}` zorunlu |
| TLS doğrulama | Açık kalmalı; üretimde kapatılamaz |
| Bu ayarları kullan | İşaretleyin |

Kaydettikten sonra **Bağlantıyı sına** düğmesiyle servis hesabının bağlanabildiğini doğrulayın,
ardından **Kullanıcı sorgula** ile bir kullanıcının dizinde bulunduğunu görün. İki denemenin de
sonucu ekranda "Son deneme" kutusunda ve denetim kaydında görünür.

Giriş yapabilmek için iki koşul birlikte gerekir: kullanıcı **dizinde** doğrulanmalı ve portalda
**tanımlı ve aktif** olmalı. Dizinde olup portalda tanımlı olmayan kişi giriş yapamaz; kullanıcıyı
Admin Panel > Kullanıcılar ekranından eklemeniz gerekir.

Hesap güvenliği: 15 dakika içinde `LOGIN_MAX_ATTEMPTS` (varsayılan 5) hatalı denemeden sonra hesap
15 dakika kilitlenir. Kilidi beklemeden açmak için:

```bash
PGPASSWORD='...' psql -h 127.0.0.1 -U tera_portal -d tera_portal \
  -c "UPDATE users SET locked_until = NULL WHERE username = 'ad.soyad';"
```

---

## 12.2 Statik güvenlik denetimi

Kurulumdan önce ve her sürüm yükseltmesinde çalıştırın:

```bash
cd /opt/tera-portal
sudo -u teraportal ops/security-scan.sh
```

Tarama 23 kalıbı kontrol eder; bunlar PRISMA projesinin Fortify SCA raporunda çıkan
kategorilerden türetilmiştir (sabit kimlik bilgisi, güvensiz rastgelelik, başlık ve yol
manipülasyonu, geniş çerez kapsamı, bilgi sızıntısı, günlükte kişisel veri, root konteyner,
güvensiz taşıma, aşırı yetkili veritabanı hesabı ve diğerleri). Tamamı `temiz` dönmelidir.

Bu tarama Fortify'ın kendisi değildir. Fortify lisansınız varsa paketi ayrıca taratın;
veri akışı analizi kalıp taramasının göremediği yolları bulabilir.

---

## 12.3 Konteynerle kurulum (isteğe bağlı)

Sunucuya doğrudan kurulum yapacaksanız bu bölümü atlayın. Konteyner tercih ederseniz:

```bash
cd /opt/tera-portal
cp .env.example .env && nano .env          # adım 5'teki alanları doldurun
docker compose -f ops/docker-compose.yml up -d --build
docker compose -f ops/docker-compose.yml exec api npm run migrate
docker compose -f ops/docker-compose.yml exec api npm run seed
docker compose -f ops/docker-compose.yml exec api node ops/create-admin.js elif.yalcin "Elif Yalçın" BT DIR
```

Konteynerler şu sıkılaştırmalarla çalışır: uygulama `node` kullanıcısıyla (root değil),
kök dosya sistemi salt okunur, tüm Linux yetenekleri düşürülmüş (`cap_drop: ALL`),
`no-new-privileges` açık, veritabanı dışarıya hiç açılmıyor, uygulama yalnızca `127.0.0.1:8080`
üzerinde dinliyor. TLS için önüne yine Nginx koymanız gerekir (adım 9).

Yükleme dizini ve veritabanı kalıcı volume'lardadır; yedekleme betiği konteyner dışından
çalıştırılacaksa `pg_dump` komutunu `docker compose exec db` üzerinden çağıracak şekilde düzenleyin.

---

## 13. Yedekleme

```bash
sudo mkdir -p /var/backups/tera-portal
sudo crontab -e
```

Şu satırı ekleyin:

```
0 2 * * * /opt/tera-portal/ops/backup.sh >> /var/log/tera-portal/backup.log 2>&1
```

Yedek üç şey alır: veritabanı dökümü, yüklenen PDF'ler ve denetim kaydının CSV dışa aktarımı. **Denetim kaydı kopyasını salt-okunur (WORM) bir alana taşıyın**; aynı sunucuda durursa denetim değeri azalır.

İlk yedeği elle çalıştırıp doğrulayın:

```bash
sudo /opt/tera-portal/ops/backup.sh
ls -lh /var/backups/tera-portal/
```

**Geri dönüş provası** (yılda en az bir kez, test sunucusunda):

```bash
pg_restore -h 127.0.0.1 -U tera_portal -d tera_portal_test -c /var/backups/tera-portal/db-YYYYMMDD-HHMM.dump
```

---

## 14. Günlük işletim

| İş | Komut / yer |
|---|---|
| Servisi yeniden başlatma | `sudo systemctl restart tera-portal` |
| Günlükleri izleme | `sudo tail -f /var/log/tera-portal/app.log` |
| Denetim zincirini doğrulama | Portal: **Uyum ve Teftiş > Denetim kaydı** |
| Kullanıcı pasife alma | Portal: **Admin Panel > Kullanıcılar** (oturumu anında düşer) |
| Bir modülü bakıma alma | Portal: **Admin Panel > Ekran yönetimi** |
| Bildirim alıcılarını değiştirme | Portal: **Admin Panel > Bildirim tanımları** |
| E-posta sunucusu ayarları | Portal: **Admin Panel > E-posta ayarları** |
| Bir modülü kullanıma açma veya kapatma | Portal: **Admin Panel > Ekran yönetimi** |
| Rapor yayınlama ve emekliye alma | Portal: **Raporlar > Rapor geliştirme** (onay Teftiş'te) |
| Rapor kullanım istatistiği | Portal: **Raporlar > Kullanım raporu** |
| Proje grafikleri (burndown, hız, dağılım) | Portal: **Proje Yönetimi > Proje grafikleri** |
| Yönetici özet raporu | Portal: **Proje Yönetimi > Yönetici özeti** (Direktör, Grup Direktörü, GMY ünvanları) |
| E-posta kuyruğunu görme | Portal: **Doküman Yönetimi > Gönderilen bildirimler** |

---

## 15. Sürüm yükseltme

```bash
sudo systemctl stop tera-portal
sudo /opt/tera-portal/ops/backup.sh            # önce yedek
sudo unzip -o tera-portal-YENI.zip -d /opt/tera-portal
cd /opt/tera-portal
sudo npm ci --omit=dev
sudo -u teraportal npm run migrate             # yeni göçler varsa uygular
sudo systemctl start tera-portal
sudo /opt/tera-portal/ops/healthcheck.sh
```

Göç betikleri yalnızca uygulanmamış dosyaları çalıştırır; ikinci kez çalıştırmak zarar vermez.

---

## 16. Sorun giderme

**"Yapılandırma hatalı" ile açılmıyor**
Eksik alan adları ekrana yazılır. `.env` içinde o satırları doldurup servisi yeniden başlatın.

**Giriş "Kullanıcı adı veya parola hatalı" diyor ama parola doğru**
Üç sebepten biri: kullanıcı portalda tanımlı değil (Admin Panel'den eklenmeli), kullanıcı pasif, ya da AD bağlantısı kurulamıyor. Üçüncüsünü ayırt etmek için:
```bash
sudo tail -50 /var/log/tera-portal/error.log | grep -i ldap
```

**Doküman yüklenmiyor, "Teftiş rolünde aktif kullanıcı yok" diyor**
Adım 11.3'ü yapmamışsınız. Admin Panel'den Teftiş rolünde bir kullanıcı tanımlayın.

**Duyuru girilmiyor, "Yöneticiniz tanımlı değil" diyor**
Admin Panel > Kullanıcılar ekranında ilgili kişinin yönetici alanı boş. Doldurun.

**PDF görünmüyor**
Yükleme dizini izinlerini kontrol edin: `sudo -u teraportal ls -l /var/lib/tera-portal/uploads`. Ayrıca Nginx'te `client_max_body_size` değerinin `UPLOAD_MAX_MB`'den büyük olduğundan emin olun.

**Menüde hiçbir modül görünmüyor**
Kurulumda modüller kapalı gelir. Admin Panel > Ekran yönetimi'nden ilgili modülü `açık` yapın
(adım 11.11). Admin Panel her zaman açıktır ve kapatılamaz.

**Raporu aç düğmesi "BI adresi tanımlı değil" diyor**
`.env` içindeki `BI_BASE_URL` boş. Doldurup servisi yeniden başlatın.

**Rapor açılıyor ama BI oturum açmıyor**
BI tarafı devir anahtarını doğrulamamış olabilir. En kolay yol portalın hazır ucunu çağırmaktır:

```
POST https://portal.terayatirim.com.tr/api/reports/sso/consume
{ "token": "<sso parametresindeki değer>" }
```

Yanıt `{ ok: true, username, role, reportCode }` dönerse anahtar geçerlidir ve **tüketilmiştir**;
aynı anahtar ikinci kez kabul edilmez. Alternatif olarak BI, imzayı `APP_ENCRYPTION_KEY` ile
HMAC-SHA256 hesaplayarak kendisi doğrulayabilir, ancak bu durumda tekrar kullanım korumasını da
kendisi uygulamalıdır.

**Hesap kilitlendi**
Art arda hatalı denemeden sonra hesap 15 dakika kilitlenir. Bölüm 11.12'deki komutla elle açılır.

**Oturum sık düşüyor**
`.env` içindeki `SESSION_IDLE_MIN` varsayılan 30 dakikadır. Kurum politikanıza göre artırabilirsiniz; 480 dakikadan büyük değer kabul edilmez.

---

## 17. Kurulumu teslim ederken

Aşağıdakileri kuruma teslim edin ve bu dosyayı da paylaşın:

- [ ] `.env` dosyasındaki parolalar kurumsal parola kasasına eklendi, dosyanın kendisi kimseye e-postayla gönderilmedi
- [ ] İlk yönetici ve Teftiş kullanıcısı tanımlandı
- [ ] Yedekleme cron kaydı çalışıyor ve ilk yedek alındı
- [ ] E-posta kuyruğu ve hatırlatma cron kayıtları kuruldu (bölüm 12.1)
- [ ] E-posta ayarları ekrandan girildi, bağlantı sınandı ve deneme e-postası alındı
- [ ] `APP_ENCRYPTION_KEY` parola kasasına kaydedildi
- [ ] `ops/least-privilege.sql` çalıştırıldı, uygulama hesabı tablo oluşturamıyor
- [ ] `ops/security-scan.sh` çıktısında bulgu yok
- [ ] Kullanıma açılacak modüller Ekran yönetimi'nden açıldı, açılmayanlar bilinçli olarak kapalı
- [ ] Raporlar kullanılacaksa `BI_BASE_URL` tanımlı ve BI tarafı SSO doğrulamasını yapıyor
- [ ] Kavrama sınavı soruları yüklendi veya kurumun kendi soruları eklendi
- [ ] `healthcheck.sh` çıktısı temiz
- [ ] `docs/GUVENLIK.md` bilgi güvenliği birimine iletildi
- [ ] `docs/TEST-RAPORU.md` iç kontrol/teftişe iletildi
