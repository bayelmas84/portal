# Tera Portal

Tera Yatırım kurumsal portalı: duyurular, kontrollü dokümanlar, zorunlu okuma,
onay akışları, ekran ve bildirim yönetimi.

**Kurulum yapacaksanız `docs/KURULUM.md` dosyasını açın.** Bu dosya yalnızca genel bakıştır.

## Belgeler

| Dosya | İçerik | Kime |
|---|---|---|
| `docs/KURULUM.md` | Adım adım kurulum, doğrulama, sorun giderme | Sistem yöneticisi |
| `docs/GUVENLIK.md` | Uygulanan kontroller ve bilinen sınırlar | Bilgi güvenliği, teftiş |
| `docs/TEST-RAPORU.md` | 41 testin sonucu, OWASP eşlemesi | İç kontrol, teftiş |

## Mimari

```
Tarayıcı ──HTTPS──> Nginx (443) ──> Node/Express (127.0.0.1:8080) ──> PostgreSQL
                                            │
                                            ├──> Active Directory (LDAPS 636)
                                            └──> Dosya deposu (/var/lib/tera-portal/uploads)
```

- `server/src/routes` — uç noktalar (duyuru, doküman, onay, yönetim)
- `server/src/services` — yetki modeli, bildirim, LDAP
- `server/src/middleware` — oturum, yetki, güvenlik başlıkları, CSRF, hata
- `server/src/lib` — veri katmanı, denetim zinciri, göç, başlangıç verisi
- `client` — API'ye bağlı tek sayfa arayüz (satır içi betik yok, CSP uyumlu)
- `ops` — systemd birimi, nginx yapılandırması, yedek, sağlık denetimi, statik tarama, zamanlanmış işler
- `tests` — 92 otomatik test (51 işlevsel, 41 güvenlik; 7'si PRISMA Fortify kategorilerinin karşılığı)

## Temel iş kuralları

- Her duyuru onaydan geçer: **Yasal → Teftiş**, **Genel → girenin yöneticisi**.
- Onay bekleyen duyuru ve doküman yalnızca **girene ve Teftiş'e** görünür.
- Doküman onayı yalnızca Teftiş'tedir; giren dosyayı değiştirebilir veya talebi iptal edebilir.
- Silme ve kaldırma doğrudan yapılmaz; gerekçeli talep açılır.
- Zorunlu okumada sayfa başına asgari süre **sunucuda** ölçülür.
- Ekranlar rollerden bağımsız olarak açık / bakımda / kapalı yapılabilir.
- Kimse kendi talebini onaylayamaz, kendi rolünün yetkisini değiştiremez.
- Yayına giren doküman tüm aktif kullanıcılara zorunlu okuma olarak atanır.
- Kavrama sınavı puanı sunucuda hesaplanır (ağırlıklı, geçme 70); kalan kişi dokümanı baştan okur.
- Süresi geçmiş zorunlu okuması olan kullanıcıya portalın kalanı kapanır.
- Active Directory bağlantısı ve e-posta ayarları (SMTP sunucusu, port, şifreleme, kimlik, gönderen, grup adresleri) Admin Panel'den girilir; parola şifreli saklanır ve ekrana geri dönmez.
- Kurulumda **yalnızca Proje Yönetimi, Admin Panel ve Kısayollar açıktır**; diğer modüller kapalı gelir ve Ekran yönetimi'nden açılır.
- Raporlar modülü BI servisinin (PRISMA) katalogu ve yaşam döngüsüdür: geliştirme → Teftiş onayı → yayın → emekli. Rapor açılışında portal imzalı, 60 saniye geçerli bir kimlik devri anahtarı üretir.

## Geliştirme

```bash
npm ci
npm test                  # tüm testler (49)
npm run test:security     # yalnızca güvenlik paketi
npm run audit             # bağımlılık zafiyet taraması
ops/security-scan.sh      # statik kod taraması (23 Fortify kalıbı)
```

## Zamanlanmış işler

| İş | Betik | Önerilen sıklık |
|---|---|---|
| E-posta kuyruğunu boşaltma | `ops/mail-worker.js` | 5 dakika |
| Zorunlu okuma hatırlatmaları | `ops/reminder-job.js` | Hafta içi 08:00 |
| Sprint burndown anlık görüntüsü | `ops/burndown-job.js` | Günlük 23:55 |
| Yedekleme | `ops/backup.sh` | Günlük 02:00 |

Cron satırları `docs/KURULUM.md` bölüm 12.1 ve 13'te yazılıdır.
