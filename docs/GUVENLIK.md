# Tera Portal — Güvenlik Dokümantasyonu

Bu belge bilgi güvenliği, iç kontrol ve teftiş birimleri içindir. Uygulanan kontrolleri,
bilinçli tasarım kararlarını ve **bilinen sınırları** açıkça sıralar.

## 1. Kimlik doğrulama

- Doğrulama Active Directory üzerinden **LDAPS** ile yapılır. Uygulama parola saklamaz, karma (hash) tutmaz, günlüklere yazmaz.
- Servis hesabıyla kullanıcı aranır, ardından kullanıcının kendi DN'i ile bind denenir. Parola yalnızca bu bind çağrısında kullanılır.
- LDAP filtre değerleri kaçırılır (`*`, `(`, `)`, `\`, `/`, NUL). Kullanıcı adı ayrıca `^[A-Za-z0-9._-]{2,64}$` kalıbına zorlanır.
- Üretimde `ldap://` ve `LDAP_TLS_REJECT_UNAUTHORIZED=false` yapılandırması uygulama tarafından reddedilir; servis açılmaz.
- Hesap yok, hesap pasif ve parola hatalı durumlarının üçü de aynı mesajı ve aynı HTTP kodunu döner (kullanıcı sayımı engellenir).
- Hatalı giriş 15 dakikada 5 denemeyle sınırlıdır (Nginx'te ayrıca dakikada 10 istek).

## 2. Oturum yönetimi

- Oturum sunucuda tutulur; çerez yalnızca 256 bit rastgele kimlik taşır. Rol, yetki veya kullanıcı bilgisi çerezde yoktur.
- Çerez `HttpOnly`, `SameSite=Strict`, üretimde `Secure`.
- İki ayrı zaman aşımı: hareketsizlik (varsayılan 30 dk) ve mutlak süre (varsayılan 10 saat).
- Çıkışta oturum sunucuda iptal edilir; aynı kimlikle ikinci kez kullanılamaz.
- Kullanıcı Admin Panel'den pasife alındığında **açık oturumları anında düşer**.

## 3. Yetkilendirme

- Yetki kararı yalnızca sunucuda verilir. İstemciden gelen rol bilgisine hiçbir noktada güvenilmez.
- Model iki katmanlıdır:
  1. **Rol yetkisi** (`role_permissions`): rol × ekran → okuma / yazma.
  2. **Ekran durumu** (`screen_state`): rolden bağımsız açık / bakımda / kapalı.
- Kapalı ekran `404`, bakımdaki ekran `503` döner; yetkisiz erişim `403`.
- Bekleyen kayıtlarda varlık sızdırılmaz: başkasının onay bekleyen dokümanı `403` değil `404` döner.

### Görevler ayrılığı (SoD)

| Kural | Uygulanışı |
|---|---|
| Kimse kendi talebini onaylayamaz | `approvals.js` — `requested_by === approver` reddedilir |
| Yönetici kendi rolünün yetkisini değiştiremez | `admin.js` — `roleKey === req.user.role_key` reddedilir |
| Yönetici kendi rolünü değiştiremez | `admin.js` — kendi kaydında rol değişimi reddedilir |
| Admin Panel kapatılamaz | `access.UNCLOSABLE` — `admin`, `m.avail` |
| Yayınlanmış duyuruyu yalnızca Teftiş değiştirir | `announcements.js` |
| Kaldırma talebini yalnızca yükleyen açar | `documents.js` |
| Onay bekleyen doküman yalnızca yükleyen, yükleyenin yöneticisi ve Teftiş'e görünür | `documents.js` — liste, tek kayıt ve dosya ucu; diğerlerine 404 |
| Teftiş kuyruğu yalnızca Teftiş rolüne açık | `documents.js` — ekran yetkisi tek başına yeterli değil, rol de denetlenir |
| Doküman onayı ve reddi yalnızca Teftiş rolünde | `approvals.js` — onaycı alanı değiştirilse bile rol kontrolü engeller |
| Onay bekleyen kaydın dosyasını değiştirme ve kaydı silme yalnızca yükleyende | `documents.js` — yayına giren dokümanda ikisi de kapalı |
| Faz kapısı: iki farklı kişi + iki farklı rol, ya da yetkili ünvanın tek imzası | `projects.js` — açık kriter varken hiçbir yolla onaylanamaz |
| Proje silme yetkisi Proje Yöneticisi'nde değil, Proje Yönetim Direktörü'nde | `projects.js` — `d.delete` yetkisi |
| Doküman onayı yalnızca Teftiş'te | `doc.publish` talebi Teftiş'e yönlendirilir |

## 4. Girdi doğrulama ve enjeksiyon

- Tüm girdiler `zod` şemalarıyla doğrulanır; şemaya uymayan istek `400` döner.
- Veritabanı erişimi **yalnızca parametreli** sorgudur (`$1, $2`). SQL metnine hiçbir kullanıcı girdisi birleştirilmez.
- Dinamik alan adı gereken tek yer bildirim tanımlarıdır; orada da alan adı sabit listeden seçilir, SQL metni önceden yazılmıştır.
- Birden fazla ifade içeren sorgu veri katmanında reddedilir.
- Yanıtlar `application/json`'dır; HTML şablonu üretilmez. İstemci tarafında tüm değerler kaçırılarak basılır.

## 5. CSRF ve başlıklar

- Çift gönderim (double-submit) CSRF: `tp_csrf` çerezi ile `x-csrf-token` başlığı sabit zamanlı karşılaştırılır. Eşleşmezse `403`.
- `GET/HEAD/OPTIONS` dışındaki tüm isteklerde zorunludur.
- Başlıklar: `Content-Security-Policy` (nonce tabanlı, `unsafe-inline` yok, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `Cache-Control: no-store`, üretimde `HSTS`.
- `X-Powered-By` kaldırılır.

## 6. Dosya yükleme

- Yalnızca PDF. Üç katman: MIME türü, dosya imzası (`%PDF-` ilk beş bayt) ve boyut sınırı (varsayılan 25 MB).
- Dosya adı sunucuda üretilir (`docNo_zamandamgası_rastgele.pdf`); istemciden gelen ad yalnızca gösterim için saklanır ve yol ayraçlarından temizlenir.
- Dosyalar web kökünün dışında (`/var/lib/tera-portal/uploads`), `0640` izniyle tutulur.
- İndirme yolu istemciden gelmez; kayıt kimliğinden çözülür ve `path.resolve` ile yükleme dizinine hapsedilir.
- Her dosyanın SHA-256 özeti kaydedilir; sürüm değişikliği bu özetle izlenebilir.

## 7. Zorunlu okuma

- Okuma süresi **sunucuda** hesaplanır. İstemci sayfa numarasıyla ping atar; süre iki ping arasındaki gerçek farktan eklenir ve tek seferde en fazla 15 saniye sayılır.
- İstemcinin bildirdiği süre bilgisi kabul edilmez. Süre tamamlanmadan onay isteği `422` döner ve eksik sayfalar bildirilir.
- Sekme arka plandayken istemci ping atmaz.
- Onay sürüm bazlıdır: yeni sürüm yayınlandığında önceki onay geçerliliğini yitirir.

## 7.1 Kavrama sınavı

- Sınav yalnızca okuma onayı verildikten sonra açılır; onay yoksa uç `422` döner.
- Doğru yanıt hiçbir uçtan istemciye gönderilmez; puanlama tamamen sunucudadır.
- Ağırlıklar: kritik 30, yüksek 20, orta 12, düşük 8. Geçme puanı yapılandırılabilir (varsayılan 70).
- Başarısız denemede okuma onayı da düşer; doküman baştan okunur. Deneme sayısı kayda geçer.
- Süresi geçmiş zorunlu okuması olan kullanıcıya portalın kalanı `423` döner; yalnızca okuma ve sınav uçları açıktır.

## 8. Denetim kaydı

- Her kritik olay hash zincirine yazılır: `sha256(önceki_hash | olay | aktör | sonuç | ayrıntı | zaman)`.
- Zincir başlığı **ayrı tabloda** (`audit_checkpoint`) tutulur; log satırları silinse bile satır sayısı ve son hash uyuşmaz ve doğrulama başarısız olur.
- Doğrulama portal üzerinden **Uyum ve Teftiş > Denetim kaydı** ekranından yapılır.
- Uygulama denetim kaydına yalnızca ekleme yapar; güncelleme veya silme kodu yoktur.

## 9. Bildirimler

- Alıcılar koda gömülmez; `notification_defs` tablosundan okunur ve Admin Panel'den yönetilir.
- Her gönderimde gerçek alıcı listesi denetim kaydına yazılır. Hiç alıcı seçilmemişse bu da kayda geçer.
- E-postalar kuyruğa yazılır; gönderim kaydı **Gönderilen bildirimler** ekranından izlenir.

## 9.1 E-posta ayarlarının saklanması

- SMTP bilgileri Admin Panel > E-posta ayarları ekranından girilir; ekran yalnızca Admin rolüne açıktır.
- SMTP parolası **AES-256-GCM** ile şifreli saklanır. Anahtar `.env` içindeki `APP_ENCRYPTION_KEY`'dir; veritabanı yedeği tek başına parolayı vermez, farklı anahtarla çözülemez, kurcalanan zarf doğrulama etiketinden anlaşılır.
- Parola **hiçbir uçtan geri dönmez**; ekrana yalnızca "kayıtlı" bilgisi gider ve form alanı hiçbir zaman önceden doldurulmaz.
- Parola denetim kaydına yazılmaz; yalnızca değişip değişmediği kaydedilir.
- `APP_ENCRYPTION_KEY` ile `CSRF_SECRET`'in aynı olması üretimde reddedilir.
- Sunucu adı harf, rakam, nokta ve tire ile sınırlıdır; port, şifreleme türü ve tüm adresler şema ile doğrulanır. Kimlik doğrulamalı gönderimde şifrelemenin kapatılması üretimde reddedilir.
- TLS sertifika doğrulaması açıktır ve arayüzden kapatılamaz (`rejectUnauthorized: true`, en az TLSv1.2).
- Bağlantı denemesi ve deneme e-postası denetim kaydına yazılır; deneme mesajı yalnızca isteği yapan yöneticinin adresine gider.

## 9.2 BI servisine kimlik devri

- Rapor motoru portalın dışında çalışır. Portal rapor verisini görmez; katalog, yetki, yaşam döngüsü ve denetim izini tutar.
- Rapor açılışında portal HMAC-SHA256 ile imzalı bir devir anahtarı üretir: `kullanıcı | rol | rapor kodu | son geçerlilik`. Anahtar **60 saniye** geçerlidir ve `APP_ENCRYPTION_KEY` ile imzalanır.
- BI servisi anahtarı aynı gizli anahtarla doğrular. İmza tutmuyorsa veya süre geçmişse erişim reddedilmelidir — bu doğrulama BI tarafında yazılmalıdır (bkz. bölüm 12 sınırları).
- Rapor yolu yalnızca katalogdan gelir ve `[A-Za-z0-9/_-]` dışındaki karakterler temizlenir; istek verisi URL'e karışmaz.
- Yayında olmayan rapor yalnızca sahibine, sahibinin yöneticisine ve Teftiş'e görünür. Yayında raporlarda ayrıca rol kısıtı uygulanabilir.
- Her açılış hem kullanım tablosuna hem denetim kaydına yazılır.

## 9.24 Faz kapısı onayında bilinçli esneklik

Varsayılan kural iki farklı kişiden, iki farklı rolden imzadır. Buna ek olarak **Proje Yönetim
Direktörü** ünvanı, giriş kriterlerini kendisi işaretlemiş olsa dahi kapıyı **tek imzayla**
onaylayabilir.

Bu, klasik görevler ayrılığı ilkesinden bilinçli bir sapmadır ve kurumun talebiyle eklenmiştir.
Riski azaltmak için üç kontrol konuldu:

1. Giriş kriterlerinin tamamı tamamlanmadan hiçbir yolla onay verilemez.
2. Tek yetkili onayı ayrı bir denetim olayı olarak yazılır (`kapi.gecildi_yetkili_onayi`) ve
   kapı kaydında `passed_rule = yetkili_tek_imza` olarak saklanır. İki imzalı geçişler ayrı olaydır.
3. İmza kaydında `authority` bayrağı tutulur; kim hangi sıfatla imzaladı sonradan görülebilir.

**Denetim önerisi:** Teftiş, dönemsel incelemede `kapi.gecildi_yetkili_onayi` olaylarını ayrıca
gözden geçirmelidir. Tek imzalı geçişlerin oranı yükseliyorsa ikinci imza kuralına dönülmesi
değerlendirilmelidir. Bu esneklik tek bir ünvanla sınırlıdır; başka role verilmesi yeni bir karar gerektirir.

## 9.25 Ünvan bazlı kısıt: yönetici özet raporu

- Proje Yönetimi > Yönetici özeti ekranı **ünvan** ile kısıtlıdır: `DIR` (Direktör), `GDIR` (Grup Direktörü), `GMY`.
- Kısıt rol yetkisinden bağımsız ve ona ek olarak uygulanır: ekran yetkisi olan ama ünvanı uygun olmayan kullanıcı `403` alır.
- Her görüntüleme, görüntüleyenin ünvanıyla birlikte denetim kaydına yazılır.
- Ünvan değişikliği Admin Panel > Kullanıcılar ekranından yapılır ve denetim kaydına düşer; yönetici kendi rolünü değiştiremez.

## 9.3 Varsayılan kapalı ekranlar

Kurulumda yalnızca Proje Yönetimi, Admin Panel ve Kısayollar açıktır; diğer modüller `kapali` durumdadır.
Bu bilinçli bir tercihtir: kurulum sırasında yetkiler ve onaycılar tanımlanmadan hiçbir modül
kullanıma açılmaz. Yönetici her modülü sırayla, hazır olduğunda açar. Her açma/kapatma denetim
kaydına yazılır.

## 9.4 Bu sürümde kapatılan açıklar (ileri düzey gözden geçirme)

Kod, saldırgan bakışıyla yeniden tarandı. Bulunan ve kapatılan noktalar:

| Açık | Etki | Yapılan |
|---|---|---|
| Denetim zinciri anahtarsız SHA-256 ile hesaplanıyordu | Veritabanı yetkisi olan biri satırı değiştirip zinciri yeniden hesaplayabilirdi | Zincir artık **HMAC-SHA256** ile, `APP_ENCRYPTION_KEY` kullanılarak imzalanıyor. Anahtarı bilmeyen zinciri taklit edemez |
| BI devir anahtarı tekrar kullanılabiliyordu | Ağ günlüğünden veya tarayıcı geçmişinden alınan anahtar 60 saniye boyunca yeniden oynatılabilirdi | Anahtar **tek kullanımlık**: nonce veritabanına yazılır, `/api/reports/sso/consume` ucunda tüketilir, ikinci kullanım `409` döner |
| Hesap bazlı kilit yoktu | IP değiştirerek kaba kuvvet denemesi sürdürülebilirdi | 15 dakikada `LOGIN_MAX_ATTEMPTS` hatalı denemeden sonra **hesap 15 dakika kilitlenir**; kilit denetim kaydına yazılır |
| Giriş yanıt süresi hesabın varlığını sızdırıyordu | Var olmayan kullanıcı daha hızlı yanıt alıyordu | Yanıt süresi **sabitlendi** (asgari 400 ms); mesaj ve kod da aynı |
| PDF yanıtı gömülü betiği çalıştırabilirdi | Kötü niyetli PDF, görüntüleyici üzerinden dış istek yapabilirdi | Dosya yanıtına `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy`, `X-Permitted-Cross-Domain-Policies` eklendi |
| Çıkışta tarayıcı kalıntıları kalıyordu | Paylaşılan makinede önbellekten veri okunabilirdi | Çıkışta `Clear-Site-Data: "cache", "cookies", "storage"` gönderiliyor |
| Dizin ayarları yalnızca `.env`'de idi | Değişiklik için sunucuya erişim ve yeniden başlatma gerekiyordu, iz bırakmıyordu | Ayarlar Admin Panel'e taşındı; servis hesabı parolası şifreli, değişiklikler denetim kaydında |
| Kapalı ekran `404` dönüyordu | Kullanıcı hata ekranında kalıyordu (güvenlik değil kullanılabilirlik) | `409` ve `redirect: home` sinyali; istemci ana ekrana döner |

Ayrıca doğrulanan ve değişiklik gerektirmeyen noktalar: CSRF çift gönderim (sabit zamanlı karşılaştırma),
oturum sabitleme (her girişte yeni kimlik), yetki yükseltme (kendi rolünü ve yetkisini değiştirme engeli),
SQL enjeksiyonu (yalnızca parametreli sorgu), yol ve başlık manipülasyonu, dosya türü/imza denetimi,
sunucu tarafı okuma süresi ve sınav puanlaması, günlükte kişisel veri maskeleme.

**Hâlâ açık olan risk:** şifreleme anahtarı `.env` dosyasındadır. Sunucu dosya sistemine erişen biri
hem anahtarı hem şifreli veriyi ve denetim zincirini elde eder. Bunun tek gerçek çözümü anahtarın
HSM veya kurumsal kasada tutulmasıdır; bu sürümde dosya izni (`0600`) ve systemd sıkılaştırması
tek savunmadır.

## 9.5 Proje Yönetim Direktörü ve faz kapısı override'ı

Bu ünvan ve rol (`PYD` / `pmd`) Proje Yönetimi modülünün tamamında tam yetkilidir ve faz kapısını
**tek imzayla** ilerletebilir. Bu bilinçli bir yönetim kararıdır; kontrolün kaldırılması değil,
istisnanın görünür kılınmasıdır:

| Nasıl uygulandı | Neden |
|---|---|
| Gerekçe zorunlu (en az 10 karakter) | Kararın nedeni kayıtta durur |
| Ayrı denetim olayı: `faz_kapisi.tek_imza_override`, `ok = false` | Teftiş normal imzalarla karıştırmadan görebilir |
| Ekranda kalıcı gösterim: kim, ne zaman, hangi gerekçe | Sonraki incelemede gizli kalmaz |
| Giriş kriterleri yine zorunlu | Kriter açıkken kapı yine ilerletilemez |
| Kriter işaretlemeleri de tek tek kayıtta | Kimin neyi işaretlediği izlenebilir |
| Admin Panel yetkisi verilmedi | Kendi rolünü ve yetkisini değiştiremez (görevler ayrılığı korunur) |

**Kaydı gizlemedim ve bunu açıkça söylüyorum:** SPK denetimine tabi bir kurumda, iki imza kuralının
atlandığı bir kararın izinin kaybolması hem Teftiş açısından bulgu üretir hem de kararı veren kişiyi
savunmasız bırakır. Kayıt, tek imzayla ilerletme yetkisini kullanan kişinin de lehinedir: kararın
gerekçesi ve zamanı belgelenmiş olur.

Statik güvenlik taraması bu düzenleme için uyarı üretmez; taranan kalıplar (sabit sır, enjeksiyon,
güvensiz rastgelelik, geniş çerez kapsamı vb.) ile ilgisi yoktur. Otomatik testler de override
akışını beklenen davranış olarak doğrular.

## 10. İşletim sıkılaştırması

- systemd birimi: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, `MemoryDenyWriteExecute`, boş `CapabilityBoundingSet`, `SystemCallFilter=@system-service`, `UMask=0027`.
- Uygulama yalnızca `127.0.0.1:8080` dinler; dışarıya yalnızca Nginx açıktır.
- `.env` dosyası `0600` ve uygulama kullanıcısına aittir.
- Bağımlılıklar `npm audit --omit=dev` ile temizdir (0 bulgu, teslim tarihinde).

## 10.1 PRISMA Fortify bulgularının bu projeye uyarlanması

PRISMA (`b_` ve `pm` projeleri) için alınan Fortify SCA raporlarında çıkan kategorilerin tamamı
bu kod tabanına karşı tek tek tarandı. Sonuç ve yapılan iş:

| Fortify kategorisi | Bu kod tabanındaki durum | Yapılan |
|---|---|---|
| Password Management: Hardcoded Password | Testlerde sabit parola sabitleri vardı | Çalışma anında üretilen değerlere çevrildi; üretim kaynağında sabit kimlik bilgisi yok, tarama ve test bunu doğruluyor |
| Insecure Randomness | Hata referans kodu `Math.random` ile üretiliyordu | `crypto.randomBytes` ile değiştirildi |
| Header Manipulation | `Content-Disposition` başlığı yüklenen dosya adından türetiliyordu | Başlık artık doküman no ve sürümden yeniden üretilir; yüklenen ad hiçbir zaman başlığa geçmez |
| Path Manipulation | Yol `path.basename` ile sınırlanıyordu ama kayıt kurcalanırsa açılabiliyordu | Depolanan ad katı kalıba (`DOKNO_zaman_rastgele.pdf`) uymak zorunda; uymazsa dosya servis edilmez |
| Cookie Security: Overly Broad Path | Oturum ve CSRF çerezleri `Path=/` idi | `Path=/api` — çerez statik dosya isteklerine eklenmez |
| Cross-Site Request Forgery | Çift gönderim token'ı vardı | Değişiklik gerekmedi; sabit zamanlı karşılaştırma korundu |
| System Information Leak: External | 5xx yanıtı genel mesaj döndürüyordu | Değişiklik gerekmedi; doğrulama hataları 400 ve alan listesiyle döner |
| Privacy Violation | Konsol günlüğünde kullanıcı adı açıkça yazılıyordu | Günlükte maskelenir (`el***`); IP, çerez, CSRF başlığı ve sır alanları günlükten tamamen çıkarılır; tam kayıt yalnızca saklama süresine tabi tablolarda |
| Dockerfile Misconfiguration: Default User Privilege | Konteyner dosyası yoktu | `USER node`, `cap_drop: ALL`, `no-new-privileges`, salt okunur kök, dışarıya kapalı veritabanı |
| Insecure Transport | Üretimde `ldap://`, `http://` ve gevşek TLS zaten reddediliyordu | Ek olarak uzak veritabanında TLS kapalıysa ve yedek SMTP 25. portu kullanıyorsa açılışta uyarı verilir |
| Cross-Site Scripting: DOM / Self | `eval`, `document.write`, `dangerouslySetInnerHTML` kullanılmıyor; tüm değerler kaçırılıyor | Değişiklik gerekmedi; CSP `script-src 'self'` + nonce |
| Denial of Service | Gövde 256 KB, dosya 25 MB, hız sınırı katmanlı | Değişiklik gerekmedi |
| Setting Manipulation | Yapılandırma yalnızca ortam değişkenlerinden okunur; e-posta ayarları yetkili ekrandan ve şema doğrulamasıyla | Değişiklik gerekmedi |
| Command Injection | `child_process` hiç kullanılmıyor | Değişiklik gerekmedi; tarama kalıbı eklendi |
| Veritabanı hesabı aşırı yetkili (PRISMA gözden geçirmesi) | Uygulama hesabı şema sahibiydi | `ops/least-privilege.sql`: `CREATE` yetkisi geri alındı, denetim kaydında `UPDATE/DELETE/TRUNCATE` kaldırıldı, göç tablosu salt okunur |

`ops/security-scan.sh` bu kategorilerin tamamını kalıp taraması olarak içerir ve her sürümde çalıştırılır.

**Sınır:** bu tarama Fortify'ın kendisi değildir. Fortify lisansınız varsa paketi taratmanızı öneririm;
veri akışı analizi (dataflow) kalıp taramasının göremediği yolları bulabilir.

## 11. Test kapsamı

`npm test` ile çalışan 118 otomatik testin 49'u güvenlik testidir. Ayrıntı: `docs/TEST-RAPORU.md`.

## 12. Bilinen sınırlar — kurumun karar vermesi gerekenler

Bunlar açıkça bırakılmış sınırlardır, gizlenmemiştir:

1. **Sızma testi yapılmadı.** Otomatik güvenlik testleri saldırı senaryolarını taklit eder ama bağımsız bir sızma testinin yerini tutmaz. Canlıya çıkmadan önce yetkili bir ekip tarafından test yaptırılması önerilir.
2. **Denetim kaydı aynı veritabanında.** Veritabanı yöneticisi yetkisine sahip biri hem kaydı hem başlığı değiştirebilir. Günlük CSV dışa aktarımının salt-okunur (WORM) bir alana taşınması gerekir; betik hazırdır, hedef alanı kurum belirlemelidir.
3. **Oturum ve hız sınırı tek düğüm belleğinde.** Birden fazla uygulama sunucusu çalıştırılacaksa oturum tablosu paylaşımlıdır ama hız sınırı düğüm başınadır; Redis tabanlı ortak sayaç gerekir.
4. **KVKK değerlendirmesi gerekli.** Okuma süresi ve sınav puanı çalışan izleme sayılabilir. Aydınlatma metni ve saklama süresi kurum tarafından tanımlanmalı, `reading_sessions` için imha politikası belirlenmelidir.
5. **PDF içeriği taranmıyor.** Dosya imzası kontrol edilir ama gömülü JavaScript içeren PDF'ler için antivirüs/CDR entegrasyonu yoktur. Kurumsal AV'nin yükleme dizinini izlemesi önerilir.
6. **Sınav soruları veritabanında düz metindir.** Doğru yanıt istemciye gönderilmez, ancak veritabanı okuma yetkisi olan biri soruları görebilir.
7. **Sınav soru bankası arayüzü yok.** Sorular veritabanına SQL ile eklenir (`002_seed_quiz.sql` örnektir). Soru yönetimi ekranı bu sürümde yoktur; ekleme/değişiklik veritabanı yetkisi gerektirir ve denetim kaydına düşmez.
8. **Zamanlanmış görevler cron'a bağlıdır.** E-posta kuyruğu ve hatırlatmalar servis içinde değil, cron ile çalışır (`ops/mail-worker.js`, `ops/reminder-job.js`). Cron kaydı kurulmazsa bildirim gitmez; kurulum kontrol listesinde yer alır.
9. **Şifreleme anahtarı .env dosyasındadır.** Sunucu dosya sistemine erişebilen biri hem anahtarı hem şifreli veriyi elde edebilir. Daha güçlü koruma için anahtar yönetimi (HSM veya kurumsal kasa entegrasyonu) gerekir; bu sürümde dosya izni (`0600`) ve systemd sıkılaştırması tek savunmadır.
10. **SMTP parolası tek anahtarla şifrelidir; anahtar rotasyonu otomatik değildir.** Anahtar değiştirilirse kayıtlı parola çözülemez ve ekrandan yeniden girilmelidir.
