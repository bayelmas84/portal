# Tera Portal — Test Raporu

Sürüm 1.2.0 · Rapor tarihi: 2026-09-10 · Ortam: Node v22.22.2, test veritabanı pg-mem (üretim şemasının aynısı)

## Özet

| Ölçüt | Sonuç |
|---|---|
| Toplam otomatik test | 59 |
| Geçen | 59 |
| Kalan | 0 |
| Güvenlik testi | 34 |
| İşlevsel test | 25 |
| Bağımlılık zafiyeti (`npm audit --omit=dev`) | 0 |
| Statik kod taraması (`ops/security-scan.sh`) | 10/10 temiz |

Tekrar çalıştırmak için: `npm test` (59 test) · yalnızca güvenlik: `npm run test:security` · statik tarama: `ops/security-scan.sh`

## Testlerin tamamı

```
GECTI  istemci dosyaları servis ediliyor ve satır içi betik içermiyor
GECTI  gizli dosyalar ve dizin listeleme kapalı
GECTI  e-posta ayarları formu parolayı ekrana yazmıyor
GECTI  kimlik: doğru parola girişi açar, hatalı parola ve pasif hesap reddedilir
GECTI  menü sunucudan gelir ve role göre farklıdır
GECTI  duyuru: yasal Teftiş'e, genel yöneticiye gider; onaysız yayınlanmaz
GECTI  duyuru: yasal kritiklik kısıtı ve zorunlu alanlar doğrulanır
GECTI  onay: yalnızca onaycı karar verir, kimse kendi talebini onaylayamaz
GECTI  onay: ret gerekçesi zorunlu ve kayda geçer
GECTI  duyuru silme: doğrudan silinmez, gerekçeli talep açılır ve geri çekilebilir
GECTI  doküman: yalnızca gerçek PDF kabul edilir, bekleyen kayıt üçüncü kişiye görünmez
GECTI  doküman: onay Teftiş'te, kaldırma talebi yalnızca yükleyende
GECTI  zorunlu okuma: süre sunucuda hesaplanır, erken onay reddedilir
GECTI  yönetim: kendi rolünün yetkisi değiştirilemez, Admin Panel kapatılamaz
GECTI  bildirim alıcıları tanım tablosundan gelir; kaldırma tüm personele gitmez
GECTI  denetim kaydı zinciri doğrulanır ve oynama tespit edilir
GECTI  e-posta ayarları ekranı yalnızca Admin'de
GECTI  ayarlar kaydedilir; parola hiçbir uçtan geri dönmez
GECTI  parola veritabanında şifreli saklanır ve düz metin bulunmaz
GECTI  parola alanı boş bırakılırsa mevcut parola korunur, "" gönderilirse silinir
GECTI  geçersiz ayarlar reddedilir
GECTI  bağlantı ve deneme gönderimi tanımsız sunucuda hata döner, kayda geçer
GECTI  parola denetim kaydına yazılmaz
GECTI  bildirim grup adresleri ekran ayarından gelir
GECTI  kuyruk elle boşaltılabilir ve durum ekranda görünür
GECTI  A01/1 oturumsuz istek her uçta 401 döner
GECTI  A01/2 personel yönetici uçlarına erişemez
GECTI  A01/3 yatay erişim (IDOR): başkasının bekleyen kaydı ve talebi görünmez
GECTI  A01/4 kapalı ekran hiç kimseye açılmaz, bakımdaki ekran 503 verir
GECTI  A02/1 oturum çerezi HttpOnly ve SameSite=Strict, rol bilgisi taşımaz
GECTI  A02/2 çıkış sonrası oturum kimliği yeniden kullanılamaz
GECTI  A02/3 pasife alınan kullanıcının açık oturumu düşer
GECTI  A03/1 SQL enjeksiyon denemeleri veri sızdırmaz
GECTI  A03/2 LDAP filtre karakterleri kaçırılır
GECTI  A03/3 XSS yükü depolanır ama HTML olarak yorumlanmaz
GECTI  A05/1 güvenlik başlıkları eksiksiz
GECTI  A05/2 üretim yapılandırması zayıf ayarları reddeder
GECTI  A07/1 CSRF belirteci olmadan değişiklik isteği reddedilir
GECTI  A07/2 hatalı giriş denemeleri sınırlanır
GECTI  A07/3 giriş yanıtı kullanıcı varlığını ele vermez
GECTI  A08/1 denetim kaydı değiştirilirse zincir bozulur
GECTI  A08/2 dosya yükleme: tür, imza, boyut ve ad denetimi
GECTI  A08/3 istemci okuma süresini kısaltamaz
GECTI  A08/4 başkasının okuma oturumu kullanılamaz
GECTI  A09/1 hata yanıtı yığın izi ve iç ayrıntı sızdırmaz
GECTI  A09/2 kritik olaylar denetim kaydına yazılır
GECTI  SoD/1 yönetici kendi rolünün yetkisini ve kendi rolünü değiştiremez
GECTI  SoD/2 yayınlanmış duyuruyu yalnızca Teftiş değiştirir
GECTI  SoD/3 personel duyuru giremez, doküman yükleyemez
GECTI  Gövde boyutu ve istek sınırı uygulanır
GECTI  uygulama ayağa kalkıyor ve sağlık ucu yanıt veriyor
GECTI  yayına giren doküman tüm aktif kullanıcılara zorunlu okuma olarak atanır
GECTI  sınav okuma onayı verilmeden açılmaz
GECTI  okuma tamamlanınca sınav açılır, doğru yanıt istemciye gönderilmez
GECTI  sınav puanı sunucuda hesaplanır; 70 altı kalır ve okuma onayı düşer
GECTI  süresi geçmiş okuması olan kullanıcı portalın kalanına erişemez
GECTI  hatırlatma işi son 3 güne girenlere ve süresi geçenlere posta üretir
GECTI  uyum ekranları: okuma raporu ve hatırlatma planı yalnızca yetkili rollere açık
GECTI  e-posta kuyruğu SMTP tanımsızken beklemede kalır, kayıp olmaz
```

## Güvenlik testlerinin OWASP karşılığı

| OWASP Top 10 (2021) | Kapsanan senaryolar | Sonuç |
|---|---|---|
| A01 Bozuk erişim denetimi | Oturumsuz erişim, dikey yetki yükseltme, yatay erişim (IDOR), kapalı/bakımdaki ekran, uyum ekranlarına yetkisiz erişim | Geçti |
| A02 Kriptografik hatalar | Çerez bayrakları, çerez içeriği, oturum iptali, pasif kullanıcının oturumunun düşmesi | Geçti |
| A03 Enjeksiyon | SQL enjeksiyon yükleri, LDAP filtre kaçırma, XSS yükü | Geçti |
| A04 Güvensiz tasarım | Görevler ayrılığı: kendi talebini onaylama, kendi yetkisini/rolünü değiştirme, Admin Panel'i kapatma | Geçti |
| A05 Hatalı yapılandırma | Güvenlik başlıkları, üretimde zayıf ayarların reddi, gizli dosyalara erişim | Geçti |
| A06 Eski bileşen | `npm audit --omit=dev` → 0 bulgu (express, ldapts ve nodemailer yükseltildi) | Geçti |
| A07 Kimlik doğrulama hataları | CSRF, kaba kuvvet sınırı, kullanıcı sayımı engeli | Geçti |
| A08 Yazılım ve veri bütünlüğü | Denetim zinciri oynaması, dosya türü/imza/ad denetimi, okuma süresi atlatma, başkasının okuma oturumu, sınav puanının istemciden etkilenememesi | Geçti |
| A09 Kayıt ve izleme eksikliği | Kritik olayların denetim kaydına yazılması, hata yanıtında sızıntı olmaması | Geçti |
| A10 SSRF | Uygulama kullanıcı girdisiyle dışarıya istek yapmaz; kısayollar yalnızca tarayıcıda açılır | Kapsam dışı |

## İş kuralı testleri

| Kural | Test |
|---|---|
| Yasal duyuru Teftiş'e, genel duyuru yöneticiye gider | Geçti |
| Onay bekleyen kayıt yalnızca girene ve Teftiş'e görünür | Geçti |
| Kimse kendi talebini onaylayamaz | Geçti |
| Ret gerekçesi zorunlu ve kayda geçer | Geçti |
| Silme/kaldırma doğrudan yapılmaz, onaya düşer | Geçti |
| Kaldırma talebini yalnızca yükleyen açar | Geçti |
| Yayınlanmış duyuruyu yalnızca Teftiş değiştirir | Geçti |
| Okuma süresi sunucuda ölçülür, istemci kısaltamaz | Geçti |
| Yayına giren doküman tüm aktif kullanıcılara atanır | Geçti |
| Sınav okuma onayından önce açılmaz | Geçti |
| Sınav puanı sunucuda hesaplanır, 70 altı kalır ve okuma sıfırlanır | Geçti |
| Süresi geçmiş okuma portalı kilitler | Geçti |
| Hatırlatmalar son 3 güne girenlere, süre aşımında yönetici ve Teftiş'e gider | Geçti |
| Bildirim alıcıları tanım tablosundan gelir; kaldırma tüm personele gitmez | Geçti |
| E-posta kuyruğu SMTP yokken kayıp vermez | Geçti |
| E-posta ayarları yalnızca Admin'de görünür ve değiştirilebilir | Geçti |
| SMTP parolası veritabanında şifreli, düz metin yok | Geçti |
| SMTP parolası hiçbir uçtan geri dönmez | Geçti |
| Parola alanı boşken kayıtlı parola korunur | Geçti |
| Parola denetim kaydına yazılmaz | Geçti |
| Geçersiz SMTP ayarları (host, port, şifreleme, adres) reddedilir | Geçti |
| Bildirim grup adresleri ekran ayarından okunur | Geçti |
| Bağlantı ve deneme gönderimi sonucu kayda geçer | Geçti |
| Kuyruk ekrandan elle boşaltılabilir | Geçti |

## Testte yakalanıp düzeltilen bulgular

1. **Denetim kaydının tamamı silinince fark edilmiyordu.** Zincir doğrulaması boş tabloyu "bütün" sayıyordu. Zincir başlığı ayrı tabloya (`audit_checkpoint`) taşındı; satır sayısı ve son hash uyuşmazlığı artık tespit ediliyor.
2. **Doğrulama hataları 500 dönüyordu.** Hatalı girdi sunucu hatası gibi görünüyordu. `ZodError` artık 400 ve eksik alan listesiyle dönüyor.
3. **İlişkili alt sorgular taşınabilir değildi.** `LEFT JOIN` biçimine çevrildi.
4. **Kolon listesi şablon değişkeniyle üretiliyordu.** Statik tarama yakaladı; tüm sorgular sabit metne çevrildi.
5. **nodemailer 6.x'te 12 zafiyet vardı.** 10.0.2'ye yükseltildi; audit temizlendi.
6. **SMTP bağlantı denemesi sunucu tanımsızken kayıt tutmuyordu.** Ekranda "henüz deneme yapılmadı" görünüyor, sebebi anlaşılmıyordu. Tanımsızlık da artık sonuç olarak kaydediliyor.

## Test edilmeyenler

Bu rapor otomatik testleri kapsar. Aşağıdakiler yapılmamıştır ve canlıya çıkmadan önce planlanmalıdır:

- Bağımsız ekip tarafından **sızma testi** (yetkilendirilmiş, kutu dışı)
- Gerçek Active Directory ile **entegrasyon testi** (testlerde LDAP taklit edilir)
- Gerçek SMTP ile **uçtan uca bildirim testi**
- **Yük ve dayanıklılık testi** (eşzamanlı kullanıcı, dosya yükleme yükü)
- **Yedekten dönüş provası** (KURULUM.md bölüm 13)
- Tarayıcı **erişilebilirlik denetimi** (WCAG)

## Statik güvenlik denetimi

`ops/security-scan.sh` kaynak kodu tarar. Son çalıştırma: 10 denetimin tamamı temiz.

| Denetim | Sonuç |
|---|---|
| SQL birleştirme (şablon değişkeni) | temiz |
| `eval` / `new Function` | temiz |
| `child_process` kullanımı | temiz |
| Sabit kodlanmış parola veya anahtar | temiz |
| Konsola parola yazımı | temiz |
| TLS doğrulamasının kapatılması | temiz |
| Tarayıcı deposunda oturum verisi | temiz |
| Kaçırılmamış girdinin `innerHTML`'e yazılması | temiz |
| `.env` sürüm kontrolü dışında | temiz |
| Bağımlılık zafiyeti | temiz |
