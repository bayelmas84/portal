# Değişiklik günlüğü

## 1.12.0
- **Bekleyen silme talebi artık yalnızca taraflarına görünüyor**: talebi giren, onun yöneticisi,
  onaycı ve Teftiş. Admin yayınlanmış duyuruyu görmeye devam eder ama süregelen talebi görmez;
  talebin sahibi ve onaycısı istemciye hiç gönderilmez
- Silme talebini yalnızca duyuruyu giren kişi veya Teftiş açabilir; Admin rolünden `a.del`
  yetkisi kaldırıldı (Admin duyuru yönetiminde yapılandırma yapar, onay akışının tarafı değildir)

## 1.11.1
- Giriş formu ölçüleri düzeltildi: `cqw` değerleri kaynak görseldeki gerçek piksel ölçülerinden
  yeniden hesaplandı (başlık 27px → 1.82cqw, alan kutusu 57px → 3.85cqw, düğme 56px → 3.78cqw).
  Önceki değerler yaklaşık 2,3 kat büyüktü; "Oturum açın" ve alanlar olması gerekenden iri görünüyordu
- Panelin dikey konumu %30.2 olarak ayarlandı; alanlar ve düğme kaynak görseldeki y konumlarına oturuyor

## 1.11.0
- Giriş ekranı artık **kaynak hero görselinden** oluşuyor: verilen PNG (1482×1061) bire bir,
  yeniden çizilmeden, dönüştürülmeden ve yeniden sıkıştırılmadan kullanılıyor
- Görsele kırpma, filtre, opaklık veya renk katmanı uygulanmıyor; sahne kaynak oranını
  (`aspect-ratio: 1482/1061`) koruyor, `object-fit: contain` ile tamamı görünüyor
- Logo ve slogan görselin içinde; HTML ile yeniden yazılmıyor, font benzetilmiyor
- Giriş formu ayrı bir katman olarak görselin sağındaki temiz lacivert alana yerleşiyor;
  ölçüler container query birimleriyle (`cqw`) görselle birlikte ölçekleniyor
- Üretimde görsel `client/assets/images/hero-login.png` yolundan olduğu gibi servis ediliyor;
  prototipte kayıpsız base64 olarak gömülü (bayt dizisi kaynak dosyayla birebir aynı)
- Telefonda da kırpma yok: görsel tam görünür, form altına yerleşir

## 1.10.3
- **Sol üstteki beyaz dikdörtgen giderildi.** Kurumsal logo PNG'sinin zemini saydam değil beyazdı;
  koyu ekranda beyaz bir kutu olarak görünüyordu. Zemin şeffaflaştırıldı ve iki sürüm üretildi:
  koyu zeminler için beyaz logo, açık zeminler için lacivert logo
- CSS filtresi (`brightness(0) invert(1)`) kaldırıldı — filtre beyaz zemini de beyaza çevirdiği
  için sorunun kaynağıydı
- Üretimde logolar statik dosya olarak servis edilir (`client/logo-white.png`, `client/logo.png`);
  gömülü veri URI kaldırıldığı için app.js 6 KB küçüldü

## 1.10.2
- Giriş ekranındaki açık renkli iki bölge kaldırıldı: form üstündeki beyaz marka kutusu ve
  açık zeminli düğmeler. Fotoğraf üstündeki tüm öğeler koyu zemine uyarlandı

## 1.10.1
- Giriş ekranı görseli artık **tüm sayfayı** kaplıyor: form tarafının arkasında da manzara görünüyor,
  giriş düğmesinin altında su ve köprü açıkta kalıyor
- Kademe iki yönlü: dikeyde metin okunabilirliği, yatayda form tarafında hafif koyulaşma
- Form alanları koyu zemine uyarlandı (saydam koyu alan, beyaz yazı, altın odak çerçevesi),
  giriş düğmesi altın
- Yatay kompozisyonlu görsel (1600×900, 123 KB) metinsizdir; logo ve slogan HTML katmanında

## 1.10.0
- Giriş ekranı kurumsal fotoğrafla yenilendi (gece İstanbul + piyasa grafiği). Görsel metinsizdir;
  logo, slogan ve kurum adı HTML ile yazılır — büyütmede bulanıklaşmaz, ekran okuyucu okur,
  metin değiştirmek için görsele dokunmak gerekmez
- Fotoğrafın üstüne okunabilirlik kademesi (scrim) ve slogan altına altın çizgi eklendi
- Üretimde görsel statik dosya olarak servis edilir (`client/login-art.jpg`, 72 KB, 5 dk önbellek);
  prototipte veri URI olarak gömülüdür. Her iki durumda dış bağlantı yoktur

## 1.9.1
- `ops/push.sh`: tek komutla commit, etiket ve gönderim; öncesinde testler ve statik denetim
  çalışır, `.env` sızıntısı ve eksik uzak depo kontrol edilir
- `docs/GONDERIM.md`: depoya gönderme adımları ve kimlik kurulumu

## 1.9.0
- **Marka ve metinler parametrik**: şirket adı, ürün adı, kısaltma, slogan, giriş başlığı ve alt
  metni, alt bilgi, imza ve vurgu rengi Admin Panel > Marka ve metinler ekranından yönetilir.
  Kodda sabit metin bırakılmadı; sunucu tarafında `brand_settings` tablosu ve `/api/brand` ucu,
  istemcide varsayılanlar. Portal başka bir kurum veya ürün adıyla kullanılabilir.
- Giriş ekranının üstüne ve ana ekranın üstüne kurumsal logolu marka bandı (gömülü PNG + SVG grafik)
- Şirket adı değiştiğinde alt bilgi otomatik güncellenir
- Marka ekranı Proje Yönetim Direktörü'nde salt okunur

## 1.8.0
- Kurumsal Tera Yatırım logosu (veri URI olarak gömülü) giriş ve ana ekranda; ürün adı **Tera Bir**
- Giriş sloganı: "Her şey bir arada, tek bir yerde"; ana ekrandaki modül listesi metni kaldırıldı
- Proje Yönetim Direktörü Admin Panel'in tamamını görür, hiçbir ekranında değişiklik yapamaz (salt okunur)
- Sol menü ve üst bant sabit; yalnızca içerik alanı kayar
- Jira hiyerarşisi: Epic → Story → Task/Bug. Task ve Bug doğrudan Epic altına açılamaz;
  alt kayıtları kapanmayan üst kayıt Done'a taşınamaz
- Board'da sürükle-bırak ile durum değiştirme
- Proje dokümanları: sabit tip listesi (Proje Kartı, BRD, FRD, UAT, Go Live, Risk ve Uyumluluk, Kapanış),
  üç kademeli onay (proje sahibi birim yöneticisi, Teftiş yöneticisi, IT yöneticisi), UAT'ta ek olarak iş birimi,
  onaycı ünvanı Direktör ve üzeri, sıra kuralı (önceki doküman onaylanmadan sonraki onaylanamaz),
  kick-off ilk üç dokümana, go-live UAT onayına bağlı, görüntülemeden onay verilemez,
  proje kolonu ve proje filtresi, yalnızca PDF
- Change request detay ekranı; talep sahibinin yöneticisi ve proje ekibi onayı birlikte zorunlu

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
