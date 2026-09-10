# Değişiklik günlüğü

## 1.6.1
- Stage Gates: yazma yetkisi olmayan rollerde toggle yerine salt okunur durum göstergesi
  (Admin ve GMY'de toggle "çalışmıyor" görünüyordu; aslında `disabled` çiziliyordu)
- Stage Gates: proje seçici eklendi (ekran CORE projesine sabitti)
- Yönetici özeti: gösterge kutuları, birim satırları ve proje satırları tıklanabilir; tablo filtrelenir
- Prototipte Dizin (AD) ayarları ekranı; doğrulama hatasında form girdileri korunuyor

## 1.6.0
- Sapma göstergesi puan yerine yüzde: (iş % − takvim %) ÷ takvim %
- Proje grafiklerinde drill-down: kutu ve grafik satırlarına tıklayınca ilgili iş kalemleri listelenir
- Koyu modda açık toggle rengi düzeltildi (CSS özgüllüğü)

## 1.5.0
- Admin Panel > Dizin (AD) ayarları: bağlantı ekrandan yönetilir, servis parolası şifreli
- Kapalı ekran 404 yerine ana sayfaya yönlendirme sinyali döner
- Duyurular kapalıyken giriş pop-up'ı gösterilmez
- Proje ekranları ve raporları İngilizce
- Güvenlik: denetim zinciri HMAC ile imzalı, BI devir anahtarı tek kullanımlık,
  hesap bazlı giriş kilidi, sabit süreli giriş yanıtı, PDF yanıtı kum havuzunda,
  çıkışta Clear-Site-Data
- BI kataloğu PRISMA modüllerini de tutabilir (entry_type)

## 1.4.0
- Proje metrikleri: tamamlanma, burndown, hız, dağılım tabloları ve zamanlanmış anlık görüntü işi
- Yönetici özet raporu (Direktör, Grup Direktörü, GMY ünvanları)
- Varsayılan açık ekranlar: Proje Yönetimi, Admin Panel, Kısayollar

## 1.3.0
- Raporlar modülü: BI kataloğu, geliştirme, yayın onayı, kullanım raporu, SSO devri
- Varsayılan kapalı ekranlar ve Ekran yönetimi

## 1.2.x
- PRISMA Fortify bulgularının bu kod tabanına uyarlanması
- En az yetkili veritabanı hesabı, sıkılaştırılmış konteyner dosyaları
- Onay bekleyen dokümanın görünürlüğü: giren, yöneticisi ve Teftiş

## 1.1.0
- Admin Panel > E-posta ayarları (SMTP), parola şifreli saklanır

## 1.0.0
- İlk üretim sürümü: duyuru ve doküman onay akışları, zorunlu okuma ve sınav,
  bildirim tanımları, denetim kaydı, kurulum ve güvenlik dokümantasyonu
