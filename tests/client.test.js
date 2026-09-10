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

test("giriş ekranı yeniden tasarlandı ve uygulama içeriğine dair ifade içermiyor", async () => {
  const { app } = await boot();
  const js = (await request(app).get("/app.js")).text;
  const css = (await request(app).get("/app.css")).text;
  /* Yorumlar kullanıcıya görünmez; denetim yalnızca ekranda çıkan metinler üzerinde yapılır. */
  const login = js.slice(js.indexOf("function loginView"), js.indexOf("function annView"))
    .replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(!js.includes("Kurumsal işlerinizin"), "eski slogan kaldırıldı");
  /* Giriş ekranı uygulamanın içeriğini, modüllerini veya yetkilendirmesini anlatmaz. */
  for (const bad of ["LDAPS", "Active Directory", "Kimlik doğrulama", "\\byetki", "\\brol\\b",
                     "\\bmodül", "\\bduyuru", "\\bdoküman", "\\bonay", "\\brapor"])
    assert.ok(!new RegExp(bad, "i").test(login), `giriş ekranında yer almamalı: ${bad}`);

  assert.match(login, /alt="Tera Yatırım"/, "kurumsal logo");
  assert.match(login, /Her şey bir arada/, "kurumsal başlık");
  assert.match(login, /powered by bayelmas/, "silik imza");
  assert.match(login, /login-art/, "görsel katman");
  assert.match(login, /Oturum açın/, "form başlığı");
  assert.match(login, /togglePw/, "parola göster/gizle");
  for (const cls of [".login{", ".login-art{", ".login-form{", ".brand-mark{", ".input-wrap{", ".login-submit{"])
    assert.ok(css.includes(cls), `stil eksik: ${cls}`);
  assert.match(css, /@media\(max-width:880px\)/, "küçük ekranda tek kolona düşüyor");
});

