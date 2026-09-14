# Tera Portal

Tek dosyalık, sunucusuz bir web uygulaması. Tüm arayüz, veri ve iş mantığı
`index.html` içinde çalışır; bir derleme adımına, veritabanına veya backend'e
ihtiyaç duymaz.

**Kurulum için `KURULUM.md` dosyasını açın.**

## İçerik

`index.html` şunları içerir:

- Duyurular, zorunlu okuma ve kavrama sınavı, onay akışları
- Proje Yönetimi: Toplantı Notları (gündem takibi, devir), Gantt Chart
- Admin Panel: kullanıcı/rol/yetki yönetimi, Dizin (AD) ve SMTP ayarları ekranları,
  marka/metin yönetimi, ekran açma/kapama
- Duyarlı (responsive) tasarım: masaüstü, tablet ve mobilde kullanılabilir

## Sınırlar (önemli)

Bu uygulama tarayıcıda bellek içinde çalışır:

- Sayfa yenilendiğinde tüm veriler (kullanıcılar, projeler, toplantı notları,
  duyurular) sıfırlanır — kalıcı bir veritabanı yoktur.
- "Giriş" ekranı gerçek bir kimlik doğrulama değildir; herhangi bir hesap
  şifresiz seçilebilir.
- SMTP/Dizin (AD) ayarları ekranları gerçek bir sunucuya bağlanmaz; bağlantı
  denemeleri ve e-posta gönderimi taklit edilir (prototip/demo amaçlıdır).

Bu sınırları kaldırıp gerçek, kalıcı veri ve kimlik doğrulamasıyla çalışan bir
sürüm isterseniz, bu ayrı bir geliştirme işidir (gerçek bir backend ve
veritabanı gerektirir).
