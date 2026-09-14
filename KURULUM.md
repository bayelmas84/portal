# Tera Portal — Kurulum Kılavuzu

Bu belge kurulumu yapacak kişi için yazılmıştır. Uygulama **tek bir statik dosyadan**
(`index.html`) ibarettir — veritabanı, çalışma zamanı (Node/PHP/…) veya derleme
adımı gerekmez. Kurulum, bu dosyayı bir web sunucusunun sunduğu şekilde yerleştirmekten
ibarettir.

Sırayla uygulayın; her adımın sonunda bir **doğrulama** komutu vardır.

---

## 0. Ne kuracaksınız?

| Bileşen | Görevi |
|---|---|
| Bir web sunucusu (Nginx önerilir) | `index.html` dosyasını HTTPS üzerinden sunar |
| TLS sertifikası | Tarayıcı ile sunucu arası şifreleme |
| DNS kaydı | `portal.terayatirim.com.tr` (veya seçtiğiniz alan adı) |

Uygulama tarayıcıda çalışır; sunucu tarafında hiçbir işlem, veritabanı veya API
yoktur. Sunucunun tek görevi dosyayı istemciye iletmektir.

## 1. Sunucu gereksinimleri

- **İşletim sistemi:** Ubuntu 22.04 / RHEL 9 (veya herhangi bir Linux/Windows sunucu)
- **Donanım:** 1 vCPU, 512 MB RAM, 5 GB disk yeterlidir (dosya ~3 MB, trafik statik)
  — sadece eşzamanlı kullanıcı sayısı çok yüksekse (binlerce) Nginx önbelleği ve
  bant genişliği ölçeklendirilir, CPU/RAM ihtiyacı artmaz
- **Ağ:** 443 (HTTPS) ve kurulum sırasında 80 (yalnızca sertifika doğrulaması için)
  dışarıya açık olmalı
- **Yazılım:** Nginx (veya Apache/Caddy), bir TLS sertifikası (Let's Encrypt veya
  kurumsal CA)
- **DNS:** `portal.terayatirim.com.tr` (örnek) için A/AAAA kaydı, sunucunun genel IP'sine

Alternatif barındırma (sunucu yönetmek istemiyorsanız): GitHub Pages, Netlify,
Vercel veya bir bulut nesne deposu (S3/Cloud Storage + CDN) — hepsi tek bir statik
dosyayı doğrudan kabul eder, bölüm 2-4 bu durumda gerekmez, doğrudan bölüm 5'e geçin.

Ağ erişimini şimdi doğrulayın (kendi bilgisayarınızdan):

```bash
nslookup portal.terayatirim.com.tr   # sunucunun IP'sini göstermeli
```

---

## 2. Sistem paketleri

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

**Doğrulama**

```bash
nginx -v
certbot --version
```

---

## 3. Dosyanın yerleştirilmesi

```bash
sudo mkdir -p /var/www/tera-portal
sudo cp index.html /var/www/tera-portal/index.html
sudo chown -R www-data:www-data /var/www/tera-portal
sudo chmod 644 /var/www/tera-portal/index.html
```

**Doğrulama**

```bash
ls -la /var/www/tera-portal/index.html
```

---

## 4. Nginx yapılandırması

`/etc/nginx/sites-available/tera-portal` dosyasını oluşturun:

```nginx
server {
    listen 80;
    server_name portal.terayatirim.com.tr;
    root /var/www/tera-portal;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Tek sayfalık uygulama: önbellek kısa tutulur ki güncelleme yayınca
    # kullanıcılar eski sürümde takılı kalmasın.
    add_header Cache-Control "no-cache, must-revalidate";

    # Uygulama gömülü <script> ve satır içi stil kullanır (tek dosyalık
    # tasarımın gereği); bu nedenle CSP burada 'unsafe-inline' ile
    # tanımlanmıştır. Daha sıkı bir CSP isteniyorsa uygulamanın script/style
    # bloklarının ayrı dosyalara bölünmesi ve nonce/hash kullanılması gerekir
    # — bu, ayrı bir geliştirme işidir.
    add_header X-Content-Type-Options "nosniff";
    add_header X-Frame-Options "DENY";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tera-portal /etc/nginx/sites-enabled/tera-portal
sudo nginx -t
sudo systemctl reload nginx
```

**Doğrulama**

```bash
sudo nginx -t                 # "syntax is ok" / "test is successful" görmelisiniz
curl -I http://portal.terayatirim.com.tr | head -5   # 200 OK dönmeli
```

---

## 5. TLS sertifikası

```bash
sudo certbot --nginx -d portal.terayatirim.com.tr
```

Certbot, Nginx ayarını otomatik olarak HTTPS'e yönlendirecek şekilde günceller ve
90 günde bir otomatik yenileme için bir zamanlanmış görev kurar.

**Doğrulama**

```bash
curl -I https://portal.terayatirim.com.tr | head -5   # 200 OK, HTTPS üzerinden
sudo certbot renew --dry-run                          # otomatik yenileme çalışıyor mu
```

---

## 6. Son kontrol listesi

- [ ] `https://portal.terayatirim.com.tr` tarayıcıda açılıyor, giriş ekranı görünüyor
- [ ] Masaüstü, tablet ve telefon genişliklerinde arayüz bozulmuyor (tarayıcıda
      geliştirici araçlarından cihaz simülasyonu ile kontrol edin)
- [ ] `http://` isteği `https://`'ye yönleniyor (certbot bunu otomatik yapar)
- [ ] Sayfa yenilendiğinde girilen veri kaybolur — bu beklenen davranıştır,
      bkz. `README.md` "Sınırlar" bölümü
- [ ] Yeni bir sürüm yayınlarken sadece `index.html` dosyasını değiştirip
      üzerine kopyalamanız yeterlidir (adım 3'ü tekrarlayın); sunucu veya
      Nginx yeniden başlatmaya gerek yoktur

## 7. Güncelleme

```bash
sudo cp yeni-index.html /var/www/tera-portal/index.html
```

Başka hiçbir adım gerekmez — servis kesintisi olmaz.

## 8. Sorun giderme

| Belirti | Olası neden |
|---|---|
| 502/504 hatası | Nginx `root` yolu yanlış veya dosya izinleri eksik (bölüm 3'ü doğrulayın) |
| Sertifika alınamıyor | 80 portu dışarıya kapalı veya DNS henüz yayılmamış |
| Tarayıcıda beyaz/boş ekran | Tarayıcı konsolunda (F12) hata var mı bakın; genelde eski bir tarayıcının
  desteklemediği bir JS özelliğinden kaynaklanır — güncel Chrome/Edge/Firefox/Safari önerilir |
| Değişiklik yayınlandı ama görünmüyor | Tarayıcı önbelleği; sert yenileme (Ctrl+Shift+R) deneyin |
