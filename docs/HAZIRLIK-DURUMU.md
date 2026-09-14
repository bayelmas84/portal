# Hazırlık durumu — sürüm 1.13.1

Bu belge "paket hazır mı, güvenlik kontrollerinden geçti mi" sorusunun ölçülmüş cevabıdır.
Tarih: paketin oluşturulduğu tur. Ölçümler temiz bir dizine açılmış paket üzerinde,
`npm ci` ile bağımlılıklar kurulduktan sonra yapılmıştır.

---

## 1. Otomatik doğrulama — geçti

| Kontrol | Sonuç |
|---|---|
| Otomatik test | **129 / 129 geçti**, 0 başarısız, 0 atlanan |
| Bunlardan güvenlik testi | 32 (OWASP Top 10 A01–A09 kapsandı; A10 kapsam dışı) |
| Statik güvenlik denetimi (`ops/security-scan.sh`) | 23 kalıp, tamamı temiz |
| Bağımlılık zafiyeti (`npm audit --omit=dev`) | 0 |
| İşletim betikleri sözdizimi | 4 kabuk + 5 Node betiği, tamamı geçerli |
| Paket bütünlüğü | Temiz dizine açıldı, kuruldu, testler yeniden geçti |

Test dosyaları: `smoke`, `functional`, `security`, `gates`, `client`, `defaults`, `mail`,
`directory`, `projects`, `reports`, `training`, `brand`.

## 2. Statik denetimin kapsadığı kategoriler

PRISMA Fortify SCA raporundaki kategorilerden türetilmiştir:
sabit kimlik bilgisi, güvensiz rastgelelik, başlık ve yol manipülasyonu, komut ve kod enjeksiyonu,
XSS (DOM/self), güvensiz taşıma, TLS doğrulamasının kapatılması, tarayıcı deposunda oturum,
SQL metninde şablon değişkeni, ayar manipülasyonu, geniş çerez kapsamı, CSRF, bilgi sızıntısı,
günlükte kişisel veri, root konteyner, düşürülmemiş yetenekler, aşırı yetkili veritabanı hesabı,
`.env` sürüm kontrolünde, bağımlılık zafiyeti.

## 3. Bu sürümde kapatılan açıklar

Denetim zinciri anahtarla imzalı (HMAC), BI devir anahtarı tek kullanımlık, hesap bazlı giriş
kilidi, sabit süreli giriş yanıtı, PDF yanıtı kum havuzunda, çıkışta `Clear-Site-Data`,
dizin ve e-posta ayarlarının şifreli saklanması, çerez kapsamının `/api` ile sınırlanması,
görev ayrılığı (kimse kendi talebini onaylamaz), kendi rolünü değiştirme engeli.
Ayrıntı: `docs/GUVENLIK.md` bölüm 9.4 ve 10.1.

---

## 4. YAPILMAYANLAR — canlıya çıkmadan önce gerekli

Bunlar paketin dışındadır; otomatik testler bunların yerini tutmaz.

| Eksik | Neden gerekli |
|---|---|
| **Bağımsız sızma testi** | Otomatik testler saldırıyı taklit eder, gerçek bir ekibin bulacaklarını bulmaz |
| **Gerçek AD entegrasyon testi** | Testlerde dizin taklit edilir; şema, filtre ve TLS zinciri sahada doğrulanmalı |
| **Gerçek SMTP uçtan uca testi** | Kuyruk mantığı test edilir, kurumsal röle davranışı edilmez |
| **Yük ve dayanıklılık testi** | Eşzamanlı okuma oturumu ve rapor açılışı altındaki davranış bilinmiyor |
| **Yedekten dönüş provası** | `ops/backup.sh` yazılı; geri yükleme denenmedi |
| **Erişilebilirlik denetimi (WCAG)** | Ekran okuyucu ve klavye akışı gerçek araçla test edilmedi |
| **KVKK değerlendirmesi** | Okuma süresi ve sınav puanı çalışan izleme sayılabilir; aydınlatma ve imha politikası kurumun |
| **Fortify taraması** | Statik tarama Fortify değildir; lisans varsa paket ayrıca taratılmalı |

## 5. Üretim paketinde HENÜZ OLMAYAN, prototipte tasarlanan bölümler

Bunlar prototipte çalışır durumdadır ancak üretim koduna geçirilmemiştir:

- **Proje ekibi** (`d.team`) — ekip atama, zorunlu Teftiş/Risk üyeliği
- **Proje dokümanları** (`d.docs`, `d.docview`) — PDF, tip listesi, sıra kuralı, kick-off/go-live kapıları
- **Onaycılar günlüğü** (`d.appr`)
- **Değişiklik talepleri** (`d.cr`) — yönetici + proje ekibi çifte onayı
- **Altı adımlı doküman onay zinciri** — PO → BO → yöneticileri → Teftiş → Kurumsal Risk
- **Ekip üyeliğine göre salt okunur erişim** — PO/BO/QA'nın panoları görmesi
- **Toplantı Notları** (`d.meeting`) — proje/tarih/katılımcı seçimi, gündem maddesi (açık/tamamlandı/iptal/devredildi), bir sonraki toplantıya devir, oluşturulunca katılımcılara bildirim
- **Gantt Chart** (`d.gantt`) — proje bazlı görev/tarih/ilerleme çubuğu
- **Admin Panel > SMTP Ayarları** — ekrandan sunucu/port/kullanıcı/parola/TLS/etkin anahtarı; SMTP tanımlı ve etkin olmadan hiçbir ekran e-posta göndermez
- **Duyarlı (responsive) düzen** — 900px ve 420px kırılma noktalarıyla tablet/mobil uyum

Üretim tarafında proje verisi (`006_projects.sql`), metrikler, burndown, yönetici özeti ve
BI rapor kataloğu mevcuttur; yukarıdaki liste bunların üzerine eklenecek bölümlerdir.
`server/src/lib/seed.js` içinde ilgili rollerde bu ekranların neden verilmediği yazılıdır.
Güncel prototip: `prototype/tera-portal-prototip.html` (üretim kodu değildir, bkz. `prototype/README.md`).

## 6. Dış bağımlılık

**BI (PRISMA) tarafında SSO doğrulama ucu yazılmalıdır.** Portal imzalı ve tek kullanımlık
anahtar üretir; doğrulama için `POST /api/reports/sso/consume` hazırdır. BI bu ucu çağırmazsa
rapor açılışı kimlik doğrulaması yapılmamış olur.

## 6.1 Bağımlılık notu (güncel doğrulama)

`multer@1.4.5-lts.x` yayıncı tarafından "bakımı sürmüyor, 2.x'e geçin" olarak işaretlendi
(`npm ci` bunu uyarı olarak basar). `npm audit --omit=dev` şu an **0 zafiyet** gösteriyor,
yani acil değil, ama üretime almadan önce `multer@2` geçişi planlanmalı (dosya yükleme
rotalarında API küçük farklar içerir, `server/src/routes` içinde `multer` kullanılan yerler
gözden geçirilmeli).

---

## 7. Özet cevap — bugün yeniden doğrulandı

Bu bölüm, paketin bugünkü haliyle (`npm ci` sonrası) yeniden çalıştırılan komutların **gerçek
çıktısıdır**, geçmiş bir kayıt değildir:

| Kontrol | Bugünkü sonuç |
|---|---|
| `npm test` | **129 / 129 geçti**, 0 başarısız |
| `npm audit --omit=dev` | 0 zafiyet |
| `ops/security-scan.sh` | 23 kalıp, tamamı temiz |

**Paket teknik olarak hazır ve otomatik güvenlik kontrollerinin tamamından geçiyor.**
Ancak **canlıya çıkmaya hazır değildir**: bağımsız sızma testi, gerçek AD/SMTP doğrulaması,
yük testi ve yedekten dönüş provası yapılmadan üretime alınmamalıdır (bölüm 4 — bunlar bu
paketin *dışında*, kurum tarafında yapılması gereken işlerdir, kod yazarak kapatılamazlar).
Prototipte tasarlanan proje yönetimi alt modülleri (bölüm 5) de üretim koduna eklenmeyi
bekliyor — bu, kapatılabilir ama henüz yapılmamış bir iş.

Kurulum ve doğrulama adımları: `docs/KURULUM.md` (21 bölüm, teslim kontrol listesi dahil,
sunucu gereksinimleri bölüm 0-1'de).
