# GitHub'a commit — adım adım

Bu adımları **kendi bilgisayarınızda** uygularsınız. Ben depoya yazamıyorum; ne bir GitHub
bağlayıcısı tanımlı ne de bir kimlik bilgisini sizin adınıza kullanırım. Aşağıdaki akış aynı
sonucu veriyor: iki dakikalık kurulum, sonrası tek komut.

---

## A. İlk kurulum (bir kez)

### A1. Git kurulu mu?
```bash
git --version
```
Çıktı vermiyorsa: Windows → https://git-scm.com/download/win · macOS → `xcode-select --install`

### A2. Kimliğinizi tanımlayın
```bash
git config --global user.name "Bayram Elmas"
git config --global user.email "bayram.elmas@terayatirim.com.tr"
```

### A3. Token'ı bir kez kasaya yazın
```bash
git config --global credential.helper store            # Linux
git config --global credential.helper osxkeychain      # macOS
git config --global credential.helper manager-core     # Windows
```
Token'ı **hiçbir dosyaya, betiğe veya yazışmaya yazmayın**. Yalnızca `git push` sorduğunda
parola alanına yapıştırın; bir daha sormaz.

### A4. Depoyu bundle'dan oluşturun
`tera-portal-git.bundle` dosyasını indirdiğiniz klasörde:
```bash
git clone tera-portal-git.bundle portal
cd portal
```
Bu klasör artık tam bir git deposudur: tüm sürüm geçmişi ve etiketler içinde.

### A5. Kendi deponuzu bağlayın
```bash
git remote remove origin
git remote add origin https://github.com/bayelmas84/portal.git
git remote -v          # doğrulama: origin ... (fetch) / (push)
```

### A6. İlk gönderim
```bash
git push -u origin main
```
- **Username:** GitHub kullanıcı adınız
- **Password:** token (ekranda görünmez, yapıştırıp Enter)

Etiketleri de gönderin:
```bash
git push origin --tags
```

### A7. Kontrol
Tarayıcıda `https://github.com/bayelmas84/portal` — dosyalar ve **Releases/Tags** altında
`v1.10.2` görünüyor olmalı.

---

## B. Sonraki her sürümde (tek komut)

Yeni zip'i mevcut `portal` klasörünün üzerine açın:

```bash
cd portal
rm -rf client server ops docs README.md CHANGELOG.md package.json package-lock.json .env.example
unzip -o ~/Downloads/tera-portal-v1.11.0.zip -d .
ops/push.sh
```

Windows PowerShell'de:
```powershell
cd portal
Remove-Item -Recurse -Force client,server,ops,docs,README.md,CHANGELOG.md,package.json,package-lock.json,.env.example
Expand-Archive -Force $HOME\Downloads\tera-portal-v1.11.0.zip -DestinationPath .
bash ops/push.sh
```

`ops/push.sh` sırayla: testleri çalıştırır → statik güvenlik denetimi yapar → `.env` sızıntısı
kontrol eder → commit atar → `vX.Y.Z` etiketi oluşturur → dalı ve etiketi gönderir.
Testlerden biri geçmezse **gönderim durur**.

Elle yapmak isterseniz:
```bash
git add -A
git commit -m "Sürüm 1.11.0 — ayrıntılar CHANGELOG.md"
git tag -a v1.11.0 -m "Sürüm 1.11.0"
git push && git push --tags
```

---

## C. Git kurmak istemiyorsanız: tarayıcıdan yükleme

1. `https://github.com/bayelmas84/portal` → **Add file** → **Upload files**
2. Zip'i bilgisayarınızda açın, **içindeki** klasörleri (client, server, ops, docs) ve dosyaları
   sürükleyip bırakın. Zip'i doğrudan yüklemeyin; GitHub açmaz.
3. Alttaki **Commit changes** kutusuna "Sürüm 1.11.0" yazıp onaylayın.

Bu yöntemde sürüm geçmişi ve etiketler oluşmaz; kalıcı çözüm A + B akışıdır.

---

## D. Sık karşılaşılanlar

| Belirti | Sebep | Çözüm |
|---|---|---|
| `remote origin already exists` | Bundle'dan gelen uzak tanım | `git remote remove origin` sonra tekrar ekleyin |
| `Authentication failed` | Token süresi dolmuş veya yetkisi yok | Yeni token üretin, yetki: **repo** |
| `Support for password authentication was removed` | Parola değil token gerekiyor | Parola alanına token yapıştırın |
| `rejected — non-fast-forward` | Depoda sizde olmayan commit var | `git pull --rebase origin main` sonra tekrar push |
| `.env` gönderilmeye çalışılıyor | Yanlışlıkla eklenmiş | `git rm --cached .env` |
| Etiket zaten var | Aynı sürüm ikinci kez | `git tag -d vX.Y.Z` sonra yeniden oluşturun |

---

## E. Yükleme sonrası iki ayar

1. Depoyu **private** yapın: repo → Settings → General → Change visibility.
   Bu kod iş kurallarını, yetki matrisini ve altyapı yapılandırmasını içeriyor.
2. Daha önce sohbette paylaştığınız token'ı **iptal edin**:
   Settings → Developer settings → Personal access tokens → **Revoke**.
