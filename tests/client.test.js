"use strict";
/* İstemci varlıkları sunucudan doğru başlıklarla ve CSP'ye uygun servis ediliyor mu */
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { boot } = require("./harness");

test("istemci dosyaları servis ediliyor ve satır içi betik içermiyor", async () => {
  const { app } = await boot();
  const html = await request(app).get("/");
  assert.equal(html.status, 200);
  assert.match(html.text, /<script src="\/app\.js" defer><\/script>/);
  assert.ok(!/<script>[^<]/.test(html.text), "satır içi betik CSP'yi ihlal eder");
  assert.ok(!/\son\w+\s*=/i.test(html.text), "satır içi olay işleyici olmamalı");

  const js = await request(app).get("/app.js");
  assert.equal(js.status, 200);
  assert.ok(!/eval\(|new Function\(/.test(js.text), "eval kullanılmamalı");
  assert.ok(!/localStorage|sessionStorage/.test(js.text), "oturum verisi tarayıcı deposunda tutulmamalı");
});

test("gizli dosyalar ve dizin listeleme kapalı", async () => {
  const { app } = await boot();
  for (const p of ["/.env", "/../server/src/config.js", "/app.js.map"]) {
    const res = await request(app).get(p);
    assert.ok([403, 404].includes(res.status), `${p} → ${res.status}`);
  }
});

test("e-posta ayarları formu parolayı ekrana yazmıyor", async () => {
  const { app } = await boot();
  const js = await request(app).get("/app.js");
  /* Parola alanı yalnızca giriş için; value ile doldurulmamalı. */
  assert.ok(!/name="password"[^>]*value=/.test(js.text), "parola alanı value ile doldurulmamalı");
  assert.match(js.text, /autocomplete="new-password"/, "tarayıcı otomatik doldurması engellenir");
  assert.match(js.text, /passwordSet/, "parolanın tanımlı olduğu bilgisi kullanılır");
});

test("proje ekranları İngilizce etiketlerle geliyor", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  for (const label of ["My Work", "Projects", "Project charts", "Executive summary",
                       "Burndown", "Velocity", "Status distribution", "Open work by assignee",
                       "Needs attention", "Project comparison", "By unit", "On track", "At risk", "Delayed"])
    assert.ok(js.includes(label), `İngilizce etiket eksik: ${label}`);
  /* Delivery ekranlarında Türkçe etiket kalmamalı */
  for (const tr of ["İşlerim", "Proje grafikleri\"", "Yönetici özeti\""])
    assert.ok(!js.includes(tr), `proje ekranında Türkçe etiket kaldı: ${tr}`);
});

test("dizin ayarları formu servis parolasını ekrana yazmıyor", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  assert.ok(!/name="bindPassword"[^>]*value=/.test(js), "parola alanı value ile doldurulmamalı");
  assert.match(js, /passwordSet \? "kayıtlı/, "yalnızca kayıtlı olduğu bilgisi gösterilir");
});

test("kapalı bölüm yanıtında istemci ana sayfaya döner", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  assert.match(js, /body\.redirect === "home"/, "yönlendirme sinyali işlenir");
  assert.match(js, /S\.view = "home"/, "ana sayfaya dönülür");
});

test("grafik ekranı sapmayı yüzde gösterir ve drill-down sunar", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  assert.match(js, /"Drift %"/, "sapma yüzde etiketiyle gösterilir");
  assert.ok(!/m\.drift \+ " pts"/.test(js), "puan birimi kalmadı");
  for (const a of ['data-a="drill:', 'data-a="drillState:', 'data-a="drillType:', 'data-a="drillWho:'])
    assert.ok(js.includes(a), `drill-down eksik: ${a}`);
  assert.match(js, /Click any tile or chart row to drill down/, "kullanıcıya nasıl kullanılacağı söylenir");
});

test("yönetici özeti kutuları tıklanabilir ve tablo filtrelenir", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  /* Kutu etiketleri döngüde üretilir; filtre anahtarları ve işleyiciler aranır. */
  for (const a of ['data-a="execFilter:${x[2]}"', 'data-a="execUnit:${encodeURIComponent(u.unit)}"',
                   'k === "execFilter"', 'k === "execUnit"', "Clear filter"])
    assert.ok(js.includes(a), `yönetici özetinde eksik: ${a}`);
  for (const key of ['"delayed"', '"risk"', '"bugs"', '"ontrack"', '"active"'])
    assert.ok(js.includes(key), `filtre anahtarı eksik: ${key}`);
  assert.match(js, /No projects match this filter/, "boş filtre durumu ele alınıyor");
});




test("giriş ekranı kaynak hero görselini değiştirmeden kullanır", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  const css = (await request(app).get("/app.css")).text;

  assert.match(js, /const HERO = "\/assets\/images\/hero-login\.png"/, "görsel statik varlıktan gelir");
  assert.match(js, /width="\$\{HERO_W\}" height="\$\{HERO_H\}"/, "doğal çözünürlük bildirilir");
  assert.match(js, /HERO_W = 1482, HERO_H = 1061/, "kaynak çözünürlük korunur");
  /* Görselin üzerine yazı, logo veya renk katmanı eklenmez — logo ve slogan görselin içinde.
     Slogan yalnızca alt metninde geçebilir (erişilebilirlik), görünür öğe olarak değil. */
  const stage = js.slice(js.indexOf('<div class="login-stage">'), js.indexOf('class="login-legal'));
  for (const bad of ["brand-logo", "login-scrim", "<h1>", "brand-sub"])
    assert.ok(!stage.includes(bad), `görsel üzerine eklenmemeli: ${bad}`);
  const visible = stage.replace(/alt="[^"]*"/g, "");
  assert.ok(!/Her şey bir arada|TERA YATIRIM/.test(visible), "slogan ve logo HTML metni olarak yazılmamış");

  assert.match(css, /\.hero\{[^}]*object-fit:contain/, "kırpma yok");
  assert.ok(!/\.hero\{[^}]*(filter|opacity|mix-blend)/.test(css), "filtre veya opaklık yok");
  assert.match(css, /aspect-ratio:1482 \/ 1061/, "sahne kaynak oranını korur");

  /* Dosya bire bir servis edilir: PNG, yeniden sıkıştırılmamış boyutta. */
  const img = await request(app).get("/assets/images/hero-login.png");
  assert.equal(img.status, 200);
  assert.match(img.headers["content-type"], /image\/png/);
  assert.equal(img.body.subarray(1, 4).toString(), "PNG");
  assert.ok(img.body.length > 1900000, `kaynak boyut korunmuş (${img.body.length} bayt)`);
});

test("giriş formu ölçüleri kaynak görselin oranlarına bağlı", async () => {
  const { app } = await boot();
  const css = (await request(app).get("/app.css")).text;
  /* 1482 px referansta: başlık 27px, alan kutusu 57px, düğme 56px, kutu genişliği 510px. */
  const pairs = [[/font-size:1\.82cqw/, "başlık 27px"], [/height:3\.85cqw/, "alan kutusu 57px"],
                 [/height:3\.78cqw/, "düğme 56px"], [/width:34\.44%/, "kutu genişliği 510px"],
                 [/top:30\.2%/, "dikey hizalama"]];
  for (const [rx, label] of pairs) assert.match(css, rx, `ölçü eksik: ${label}`);
  /* Panel container query birimleriyle ölçekleniyor; sabit px ile büyümüyor. */
  const panel = css.slice(css.indexOf(".login-panel{"), css.indexOf(".login-legal{"));
  assert.ok(!/font-size:\d+px/.test(panel), "panelde sabit px yazı boyutu yok");
});

test("sol ray ve alt menü tam yükseklikte sabit, yalnızca içerik kayar", async () => {
  const { app } = await boot();
  const css = (await request(app).get("/app.css")).text;
  /* Satır başından ara: koyu mod varyantlarına takılmamak için. */
  const rule = (sel) => {
    const i = css.indexOf("\n" + sel + "{");
    return i < 0 ? "" : css.slice(i + 1, css.indexOf("}", i + 1) + 1);
  };
  const shell = rule(".shell"), nv = rule(".nv"), sub = rule(".sub"), main = rule(".main");
  assert.match(shell, /height:100vh/, "kabuk ekran yüksekliğinde");
  assert.match(shell, /overflow:hidden/, "kabuk kendisi kaymıyor");
  assert.match(nv, /height:100vh/, "sol ray tam yükseklikte");
  assert.match(sub, /height:100vh/, "alt menü tam yükseklikte — zemin rengi en alta kadar sürer");
  assert.ok(!/max-height/.test(sub), "alt menü içerik boyuna göre kısalmıyor");
  assert.match(sub, /background:var\(--s1\)/, "alt menü zemin rengi");
  assert.match(main, /overflow-y:auto/, "yalnızca içerik alanı kayar");
  assert.match(css, /\.top\{position:sticky/, "üst bant kayan alanın tepesinde sabit");
});
