# Depoya gönderme

## Kısa cevap: ben gönderemiyorum, ama iş tek komuta indi

Bu sohbette depoya doğrudan yazamam. İki sebep var:

1. **Bağlayıcı yok.** Bu hesapta GitHub bağlayıcısı (connector) tanımlı değil; dizinde de bulunmuyor.
   Bağlayıcı olsaydı yetkilendirme platform tarafında yapılırdı ve ben sırrınızı hiç görmeden
   commit atabilirdim.
2. **Token'ı kullanmam doğru olmaz.** Bir kimlik bilgisini sizin adınıza kullanmam, hem kural gereği
   hem de pratik olarak yanlış: yazışmaya girmiş bir token artık güvenli değildir.

Bu yüzden gönderimi siz yapıyorsunuz — ama tek komuta indirdim.

---

## 1. Tek seferlik kurulum (5 dakika)

```bash
# a) Depoyu bundle'dan oluştur
git clone tera-portal-git.bundle portal
cd portal
git remote remove origin
git remote add origin https://github.com/<kullanici>/<depo>.git

# b) Token'ı git'in kendi kasasına bir kez yaz
git config --global credential.helper store          # Linux
# macOS:   git config --global credential.helper osxkeychain
# Windows: git config --global credential.helper manager-core

# c) İlk gönderim (kullanıcı adı + parola sorar; parola alanına TOKEN'ı yapıştırın)
git push -u origin main
git push origin v1.8.0
```

Token'ı bir daha girmeniz gerekmez. Token'ı hiçbir dosyaya, betiğe veya yazışmaya yazmayın.

---

## 2. Sonraki her sürümde: tek komut

Yeni zip'i mevcut klonun içine açın ve:

```bash
ops/push.sh
```

Betik şunları yapar:

| Adım | Ne yapar |
|---|---|
| Ön kontrol | `.env` depoya girmiş mi, uzak depo tanımlı mı |
| Test | `npm test` ve `ops/security-scan.sh` — biri başarısızsa gönderim durur |
| Commit | `Sürüm X.Y.Z — ayrıntılar CHANGELOG.md` |
| Etiket | `vX.Y.Z` (varsa yeniden oluşturmaz) |
| Gönderim | dal + etiket |

Sürümü elle vermek isterseniz: `ops/push.sh 1.9.0`
Testleri atlamak isterseniz: `SKIP_TESTS=1 ops/push.sh`

Zip'i klonun üzerine açma:

```bash
cd portal
rm -rf client server ops docs README.md CHANGELOG.md package.json package-lock.json .env.example
unzip -o ../tera-portal-v1.9.0.zip -d .
ops/push.sh
```

---

## 3. Benim her sürümde gönderdiğim şey

Her turun sonunda depoyu bende de commit'liyorum ve `tera-portal-git.bundle` dosyasını yeniliyorum.
Bundle bir depo kopyasıdır: commit geçmişi ve sürüm etiketleri içinde. Yani düzeltmeler kaybolmuyor;
siz push etmeseniz bile geçmiş bundle'da duruyor.

İlk kurulumu yaptıktan sonra yeni bundle'ı klonlamanız **gerekmez** — zip + `ops/push.sh` yeterlidir.
Bundle'ı yalnızca sıfırdan kurulum veya geçmişi karşılaştırmak için kullanın.

---

## 4. Gerçekten "Claude commit atsın" istiyorsanız

Tek gerçek yol **Claude Code**: kendi makinenizde, kendi git kimlik bilgilerinizle çalışır.
Depoyu açar, değişikliği yapar, commit ve push'u sizin onayınızla atar — token hiçbir yazışmaya girmez.
Bu sohbet arayüzünde ise dosya üretip size veriyorum, gönderimi siz yapıyorsunuz.

---

## 5. Güvenlik hatırlatması

Daha önce paylaştığınız token'ı **iptal ettiyseniz** iyi; etmediyseniz hemen edin:
GitHub > Settings > Developer settings > Personal access tokens > **Revoke**.
Depoyu da **private** tutun: repo > Settings > General > Change visibility.
Bu kod iş kurallarını, yetki matrisini ve altyapı yapılandırmasını içeriyor.
