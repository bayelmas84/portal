# Tera Portal

Tera Yatırım kurumsal portalı.

**Kurulum için `KURULUM.md` dosyasını açın** (sunucu gereksinimleri dahil).

## Bu depoda ne var

| Yol | Ne | Durum |
|---|---|---|
| `index.html` | Tasarım/iş kuralı prototipi — sunucusuz, bellek içi sahte veriyle çalışır | Arayüz tasarımı tamam; **gerçek API'ye bağlı değil** |
| `server/` | Gerçek backend: Express + PostgreSQL, AD (LDAPS) kimlik doğrulama, SMTP entegrasyonu | Yazıldı, gerçek Postgres'e karşı 8/8 test geçiyor |
| `tests/` | `server/`'ı gerçek bir veritabanına karşı sınayan uçtan uca testler | `npm test` ile çalışır |

**Şu an eksik olan tek şey, `index.html`'in `server/` API'sini çağıracak şekilde
yeniden yazılmasıdır.** Bu ikisi bağımsız hazırlandı; arayüzü backend'e
bağlamak ayrı, henüz yapılmamış bir geliştirme adımıdır.

## server/ mimarisi

```
Tarayıcı ──HTTPS──> Nginx (443) ──/api/*──> Node/Express (127.0.0.1:8080) ──> PostgreSQL
                      └──/ (statik)                    │
                                                        ├──> Active Directory (LDAPS 636)
                                                        └──> SMTP (Admin Panel'den girilir)
```

- `server/src/routes` — auth, announcements, training, projects (ekip/doküman/onay
  zinciri/değişiklik talebi/toplantı notu/Gantt), admin (AD/SMTP/marka/kullanıcılar)
- `server/src/auth` — oturum (cookie + CSRF), LDAP
- `server/src/lib` — denetim kaydı, e-posta (SMTP etkin değilse gerçekten göndermez),
  sır şifreleme (AES-256-GCM), rol×ekran erişim matrisi
- `server/migrations` — PostgreSQL şeması
- `tests/` — `supertest` ile gerçek HTTP + gerçek Postgres'e karşı testler

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

## Geliştirme

```bash
npm ci
cp .env.example .env    # DB_* ve AUTH_MODE=mock ile geliştirme yapılabilir
npm run migrate
npm run seed
npm start                # http://localhost:8080
npm test                 # gerçek Postgres bağlantısı gerektirir
```
