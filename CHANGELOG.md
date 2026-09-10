# Değişiklik günlüğü

## 1.7.0
- Yeni rol ve ünvan: **Proje Yönetim Direktörü** (Bayram Elmas). Proje Yönetimi'nde tam yetki
  (okuma, yazma, ekleme, silme) ve faz kapısını tek imzayla onaylama yetkisi
- Faz kapısı: yazma yetkisi olmayan rollerde toggle yerine salt okunur gösterge; tek imzayla
  ilerletmede gerekçe zorunlu ve denetim kaydına "authority approval" olarak yazılır
- Giriş ekranı: tanıtım cümlesi ve düğme altındaki yardım metni kaldırıldı, görsel yenilendi
- Yöneticisi tanımlı olmayan kişinin genel duyurusu Teftiş onayına düşer
- Prototip: iş kalemi oluşturma (Board ve Backlog), proje ekibi atama (PM, Developer, QA,
  Business Owner, Product Owner, Vendor, Analyst), proje dokümanları (PDF, değiştirilemez dosya,
  BO+PO onayından sonra salt görüntüleme), onaycılar sekmesi ve değişiklik talepleri (Change Request)

## 1.7.0
- Proje Yönetim Direktörü ünvanı (`PYD`) ve rolü (`pmd`): Proje Yönetimi modülünde tam yetki
- Faz kapısı uçları: kriter işaretleme, iki imza kuralı ve gerekçeli tek imza override'ı
- GMY faz kapısı imzalayabilir (iki imza kuralının ikinci ayağı)
- Yöneticisi olmayan kişinin genel duyurusu Teftiş onayına düşer
- Giriş ekranı yeniden tasarlandı; uygulama içeriğine dair ifade kaldırıldı
- Stage Gates: salt okunur rollerde yanıltıcı toggle yerine durum göstergesi
- Yönetici özetinde tıklanabilir göstergeler ve birim filtresi

## 1.7.0
- Proje Yönetim Direktörü rolü ve PYD ünvanı: Proje Yönetimi'nde tam yetki (ekleme, değiştirme, silme)
- Faz kapısı (stage gate) uçları: kriter işaretleme, imza, iki farklı kural
  (iki imza veya yetkili tek imzası); tek yetkili onayı denetim kaydında ayrı olay
- Proje ekleme ve silme uçları; silme yalnızca Proje Yönetim Direktörü'nde
- İç Kontrol faz kapısında ikinci imzayı atabilir
- Yönetici özeti kutuları tıklanabilir, tablo filtrelenir (üretim ve prototip)
- Stage Gates: yazma yetkisi olmayan rolde yanıltıcı toggle yerine salt okunur gösterge
- Giriş ekranı yeniden tasarlandı; yetkilendirmeye dair ifade kaldırıldı
- ops/create-user.js: kullanıcı tanımlama betiği (kimlik bilgisi almaz)

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
