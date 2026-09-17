# BY Portal

BYELMAS AŞ kurumsal portalı — proje yönetimi, doküman/onay akışları, eğitim,
duyuru, denetim kaydı ve daha fazlasını kapsayan Jira benzeri bir iş uygulaması.

**Kurulum için `KURULUM.md` dosyasını açın** (sunucu gereksinimleri dahil).

## Bu depoda ne var

| Yol | Ne |
|---|---|
| `index.html` | Tüm arayüz — tek dosyalık frontend. Hem gerçek backend'e (LIVE_BACKEND modu) hem sunucusuz bir demo moduna (bellek içi sahte veri) bağlanabilir |
| `server/` | Gerçek backend: Express + PostgreSQL, AD (LDAPS) kimlik doğrulama, SMTP entegrasyonu |
| `server/migrations/` | PostgreSQL şeması, 46 migration dosyası |
| `tests/` | `server/`'ı gerçek bir veritabanına karşı sınayan uçtan uca testler (`npm test`, 35+ test) |

**Arayüz gerçek API'ye tam olarak bağlıdır** — giriş, onay akışları, admin
paneli, denetim kaydı, arama, bildirimler, otomasyon kuralları, kayıtlı
filtreler, kişisel to-do listesi dahil her şey canlı backend üzerinden
çalışır. `index.html`, backend'e ulaşamadığı durumlarda (ör. bir sandbox
önizleyicide açıldığında) otomatik olarak "demo modu"na düşer — bu yalnızca
geliştirme/tanıtım kolaylığı içindir, üretimde backend her zaman canlıdır.

## server/ mimarisi

```
Tarayıcı ──HTTPS──> Nginx (443) ──/api/*──> Node/Express (127.0.0.1:8080) ──> PostgreSQL
                      └──/ (statik)                    │
                                                        ├──> Active Directory (LDAPS 636)
                                                        └──> SMTP (Admin Panel'den girilir)
```

- `server/src/routes` — auth, announcements, training, projects (ekip/doküman/
  onay zinciri/değişiklik talebi/toplantı notu/Gantt/otomasyon kuralları),
  admin (AD/SMTP/marka/kullanıcılar), audit, search, notifications,
  saved-filters, todo (kişisel to-do listesi)
- `server/src/auth` — oturum (cookie + CSRF), LDAP
- `server/src/lib` — denetim kaydı, e-posta (SMTP etkin değilse gerçekten
  göndermez), sır şifreleme (AES-256-GCM), rol×ekran erişim matrisi,
  otomasyon motoru (tetikleyici→koşul→eylem, döngü koruması)
- `server/migrations` — PostgreSQL şeması (46 migration)
- `tests/` — `supertest` ile gerçek HTTP + gerçek Postgres'e karşı testler

## Öne çıkan özellikler

- Proje yönetimi: Backlog, Board (Kanban), Sprint planlama + kapasite,
  Gantt, Stage Gate'ler, bağımlılık grafiği
- Otomasyon kuralları: tetikleyici → koşul → eylem, cascade/döngü koruması
- Kayıtlı filtreler, Release Notes oluşturma, Denetim Kaydı arama/filtreleme
- Kişisel To-Do listesi: kategori/durum/tarih aralığı filtreleme, arşivleme
- Doküman yönetimi (altı adımlı onay zinciri), Eğitimler, Duyurular
- Admin Panel: AD/SMTP ayarları, marka özelleştirme, kullanıcı/rol yönetimi
- Klavye kısayolları, konu şablonları, PDF export, mobil optimizasyon

## Temel iş kuralları (server/ tarafında uygulanan)

- Kimse kendi talebini onaylayamaz.
- Duyuru: Yasal → Teftiş onayı, Genel → girenin yöneticisi onayı.
- Proje dokümanı: sabit tip sırası, altı adımlı onay zinciri (PO → BO → yöneticileri
  → Teftiş → Kurumsal Risk); önceki tip tam onaylanmadan sıradaki yüklenemez.
- Teftiş ve Kurumsal Risk her projede zorunlu, çıkarılamaz ekip üyesidir.
- Toplantı notu: yalnızca proje yönetimi rolü (`pm`/`pmdir`) oluşturabilir; katılımcı
  olmayan personel göremez; Teftiş/İç Kontrol/Bilgi Güvenliği her zaman görür.
  Madde "sonraki toplantıya aktar" ile kapatılınca proje devir kuyruğuna düşer.
- SMTP tanımlı ve etkin olmadan **hiçbir ekran gerçekten e-posta gönderemez** —
  gönderim denemesi denetim kaydına başarısız olarak düşer.
- AD/SMTP parolaları veritabanında düz metin tutulmaz, AES-256-GCM ile şifrelenir.
- Otomasyon kuralları zincirleme tetiklenebilir (bir eylem başka bir kuralı
  tetikleyebilir) ama 3 adım sonra otomatik durur — sonsuz döngü mümkün değildir.
- Kişisel to-do kalemleri kullanıcı-izoledir; hiçbir kullanıcı başka birinin
  notlarını göremez veya değiştiremez.

## Geliştirme

```bash
npm ci
cp .env.example .env    # DB_* ve AUTH_MODE=mock ile geliştirme yapılabilir
npm run migrate
npm run seed
npm start                # http://localhost:8080
npm test                 # gerçek Postgres bağlantısı gerektirir
```

## Üretime alma

Bkz. `KURULUM.md` (adım adım sunucu kurulumu) ya da `docker-compose.yml` +
`Dockerfile` (konteyner tabanlı dağıtım).
