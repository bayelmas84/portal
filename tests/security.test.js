"use strict";
/* Güvenlik ve sızma denemeleri. Her test bir saldırı senaryosunu taklit eder ve
   uygulamanın reddettiğini doğrular. Başarısız test = açık demektir. */
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { boot, agentFor, PASSWORD } = require("./harness");

/* Hatalı deneme için kullanılan değer de çalışma anında üretilir. */
const WRONG = "W-" + require("crypto").randomBytes(9).toString("base64url");

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1024, 0x20)]);
const ann = (o = {}) => ({
  title: "Güvenlik testi duyurusu", body: "Bu duyuru güvenlik testinde kullanılan uzun bir metindir.",
  category: "Genel", criticality: "Orta", validUntil: "2027-01-01", popup: false, ...o,
});

/* A01 — Bozuk erişim denetimi */
test("A01/1 oturumsuz istek her uçta 401 döner", async () => {
  const { app } = await boot();
  const paths = ["/api/me", "/api/announcements", "/api/documents", "/api/approvals/inbox",
                 "/api/admin/users", "/api/admin/screens", "/api/shortcuts"];
  for (const p of paths) {
    const res = await request(app).get(p);
    assert.equal(res.status, 401, `${p} korumasız`);
  }
});

test("A01/2 personel yönetici uçlarına erişemez", async () => {
  const { app } = await boot();
  const staff = agentFor(app); await staff.login("nazli.han");
  for (const p of ["/api/admin/users", "/api/admin/permissions", "/api/admin/screens", "/api/admin/notifications"]) {
    const res = await staff.get(p);
    assert.ok([403, 404].includes(res.status), `${p} → ${res.status}`);
  }
  const w = await staff.put("/api/admin/permissions").send({ roleKey: "staff", screenKey: "admin", level: "write" });
  assert.ok([403, 404].includes(w.status), "yetki yükseltme reddedilmeli");
});

test("A01/3 yatay erişim (IDOR): başkasının bekleyen kaydı ve talebi görünmez", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-IDOR-001").field("title", "IDOR testi prosedürü").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const created = await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  const reqId = (await bg.get("/api/approvals/mine")).body.items[0].id;

  const other = agentFor(app); await other.login("meltem.aydin");
  assert.equal((await other.get(`/api/documents/${up.body.id}`)).status, 404);
  assert.equal((await other.get(`/api/documents/${up.body.id}/file`)).status, 404);
  assert.equal((await other.get(`/api/approvals/${reqId}`)).status, 404);
  const anns = (await other.get("/api/announcements")).body.items.map((x) => x.id);
  assert.ok(!anns.includes(created.body.id), "bekleyen duyuru sızdı");
});

test("A01/4 kapalı ekran hiç kimseye açılmaz, bakımdaki ekran 503 verir", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/screens").send({ key: "announce", state: "kapali" });

  const other = agentFor(app); await other.login("meltem.aydin");
  const closed = await other.get("/api/announcements");
  assert.equal(closed.status, 409, "kapalı modül erişilemez");
  assert.equal(closed.body.redirect, "home", "kullanıcı ana sayfaya yönlendirilir");

  await admin.put("/api/admin/screens").send({ key: "announce", state: "bakim" });
  assert.equal((await other.get("/api/announcements")).status, 503, "bakımdaki modül 503 vermeli");
});

/* A02 — Kriptografi ve oturum */
test("A02/1 oturum çerezi HttpOnly ve SameSite=Strict, rol bilgisi taşımaz", async () => {
  const { app } = await boot();
  const res = await request(app).post("/api/auth/login").send({ username: "elif.yalcin", password: PASSWORD });
  const cookie = (res.headers["set-cookie"] || []).find((c) => c.startsWith("tp_sid="));
  assert.ok(cookie, "oturum çerezi yok");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const value = cookie.split(";")[0].split("=")[1];
  assert.ok(!/admin|role|rol/i.test(Buffer.from(value, "base64url").toString("utf8")), "çerez rol bilgisi taşımamalı");
});

test("A02/2 çıkış sonrası oturum kimliği yeniden kullanılamaz", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("elif.yalcin");
  assert.equal((await a.get("/api/me")).status, 200);
  await a.post("/api/auth/logout").send({});
  assert.equal((await a.get("/api/me")).status, 401, "iptal edilen oturum çalışmamalı");
});

test("A02/3 pasife alınan kullanıcının açık oturumu düşer", async () => {
  const { app } = await boot();
  const victim = agentFor(app); await victim.login("tolga.firat");
  assert.equal((await victim.get("/api/me")).status, 200);
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/users/tolga.firat").send({
    displayName: "Tolga Fırat", roleKey: "pm", unitCode: "BT", titleCode: "MDR", manager: "elif.yalcin", active: false });
  assert.equal((await victim.get("/api/me")).status, 401, "pasif kullanıcının oturumu geçersiz olmalı");
});

/* A03 — Enjeksiyon */
test("A03/1 SQL enjeksiyon denemeleri veri sızdırmaz", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("elif.yalcin");
  const payloads = ["1 OR 1=1", "1; DROP TABLE users;--", "' UNION SELECT username FROM users--", "%27%20OR%201=1"];
  for (const p of payloads) {
    const res = await a.get(`/api/documents/${encodeURIComponent(p)}`);
    assert.ok([400, 404].includes(res.status), `enjeksiyon yükü kabul edildi: ${p} → ${res.status}`);
  }
  const still = await a.get("/api/admin/users");
  assert.equal(still.status, 200, "tablo hâlâ ayakta olmalı");
  assert.ok(still.body.items.length >= 8);
});

test("A03/2 LDAP filtre karakterleri kaçırılır", async () => {
  const { escapeFilter } = require("../server/src/services/ldap");
  assert.equal(escapeFilter("a*b(c)d\\e"), "a\\2ab\\28c\\29d\\5ce");
  const { authenticate } = require("../server/src/services/ldap");
  await assert.rejects(() => authenticate("admin)(objectClass=*", "x", {}), /Geçersiz kullanıcı adı/);
});

test("A03/3 XSS yükü depolanır ama HTML olarak yorumlanmaz", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const payload = "<script>alert('xss')</script>";
  const res = await bg.post("/api/announcements").send(ann({ title: `Duyuru ${payload}` }));
  assert.equal(res.status, 201);
  const list = await bg.get("/api/announcements");
  assert.equal(list.headers["content-type"].split(";")[0], "application/json", "yanıt HTML değil JSON");
  assert.match(list.text, /\\u003c|<script>/, "veri JSON dizesi olarak taşınır");
  assert.equal(list.headers["x-content-type-options"], "nosniff");
});

/* A04/A05 — Tasarım ve yanlış yapılandırma */
test("A05/1 güvenlik başlıkları eksiksiz", async () => {
  const { app } = await boot();
  const res = await request(app).get("/healthz");
  const csp = res.headers["content-security-policy"];
  assert.ok(csp, "CSP yok");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(!/unsafe-inline/.test(csp), "CSP unsafe-inline içermemeli");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["referrer-policy"], "same-origin");
  assert.equal(res.headers["x-powered-by"], undefined, "sunucu teknolojisi sızdırılmamalı");
  assert.match(res.headers["cache-control"], /no-store/);
});

test("A05/2 üretim yapılandırması zayıf ayarları reddeder", async () => {
  const { load } = require("../server/src/config");
  const key = require("crypto").randomBytes(32).toString("base64");
  const base = { DB_PASSWORD: "x", LDAP_BIND_DN: "cn=svc", LDAP_BIND_PASSWORD: "y",
                 CSRF_SECRET: "0123456789abcdef0123456789abcdef01", APP_ENCRYPTION_KEY: key,
                 NODE_ENV: "production", APP_URL: "https://portal.tera.local", LDAP_URL: "ldaps://dc:636" };
  assert.throws(() => load({ ...base, LDAP_TLS_REJECT_UNAUTHORIZED: "false" }), /LDAP_TLS/);
  assert.throws(() => load({ ...base, LDAP_URL: "ldap://dc:389" }), /ldaps/);
  assert.throws(() => load({ ...base, APP_URL: "http://portal" }), /https/);
  assert.throws(() => load({ ...base, CSRF_SECRET: "kisa" }), /CSRF_SECRET/);
  assert.throws(() => load({ ...base, APP_ENCRYPTION_KEY: "kisa" }), /APP_ENCRYPTION_KEY/);
});

/* A07 — Kimlik doğrulama */
test("A07/1 CSRF belirteci olmadan değişiklik isteği reddedilir", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("burak.temel");
  const res = await a.postNoCsrf("/api/announcements").send(ann());
  assert.equal(res.status, 403);
  assert.match(res.body.error, /CSRF/);
});

test("A07/2 hatalı giriş denemeleri sınırlanır", async () => {
  const { app } = await boot();
  let limited = false;
  for (let i = 0; i < 8; i++) {
    const res = await request(app).post("/api/auth/login").send({ username: "elif.yalcin", password: WRONG + i });
    if (res.status === 429) { limited = true; break; }
  }
  assert.ok(limited, "kaba kuvvet denemesi sınırlanmalı");
});

test("A07/3 giriş yanıtı kullanıcı varlığını ele vermez", async () => {
  const { app } = await boot();
  const yok = await request(app).post("/api/auth/login").send({ username: "olmayan.kisi", password: "x" });
  const var_ = await request(app).post("/api/auth/login").send({ username: "elif.yalcin", password: WRONG });
  assert.equal(yok.body.error, var_.body.error, "mesajlar aynı olmalı");
  assert.equal(yok.status, var_.status);
});

/* A08 — Bütünlük */
test("A08/1 denetim kaydı değiştirilirse zincir bozulur", async () => {
  const { app, pool } = await boot();
  const insp = agentFor(app); await insp.login("kerem.aslan");
  assert.equal((await insp.get("/api/admin/audit/verify")).body.ok, true);
  await pool.query("DELETE FROM audit_log WHERE id = (SELECT MIN(id) FROM audit_log)");
  assert.equal((await insp.get("/api/admin/audit/verify")).body.ok, false, "silinen satır tespit edilmeli");
});

test("A08/2 dosya yükleme: tür, imza, boyut ve ad denetimi", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");

  const exe = await bg.post("/api/documents")
    .field("docNo", "PR-SEC-001").field("title", "Zararlı yükleme denemesi").field("category", "Genel")
    .attach("file", Buffer.from("MZ\x90\x00"), { filename: "virus.exe", contentType: "application/x-msdownload" });
  assert.equal(exe.status, 400, "çalıştırılabilir dosya reddedilmeli");

  const disguised = await bg.post("/api/documents")
    .field("docNo", "PR-SEC-002").field("title", "Sahte PDF denemesi").field("category", "Genel")
    .attach("file", Buffer.from("<?php system($_GET['c']); ?>"), { filename: "shell.pdf", contentType: "application/pdf" });
  assert.equal(disguised.status, 400, "uzantısı PDF ama içeriği farklı dosya reddedilmeli");

  const traversal = await bg.post("/api/documents")
    .field("docNo", "PR-SEC-003").field("title", "Yol gezinme denemesi").field("category", "Genel")
    .attach("file", PDF, { filename: "../../../../etc/passwd.pdf", contentType: "application/pdf" });
  assert.equal(traversal.status, 201, "dosya kabul edilir ama ad temizlenir");
  const doc = (await bg.get("/api/documents")).body.items.find((d) => d.doc_no === "PR-SEC-003");
  assert.ok(!doc.file_name.includes("/") && !doc.file_name.includes(".."), "dosya adı temizlenmeli: " + doc.file_name);
});

test("A08/3 istemci okuma süresini kısaltamaz", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-SEC-010").field("title", "Süre atlatma denemesi").field("category", "Genel").field("pageCount", "3")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items[0];
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});

  const staff = agentFor(app); await staff.login("nazli.han");
  const st = await staff.post(`/api/documents/${up.body.id}/reading/start`).send({});
  const sid = st.body.sessionId;
  await staff.post(`/api/documents/reading/${sid}/ping`).send({ page: 0, seconds: 99999 });
  const ack = await staff.post(`/api/documents/reading/${sid}/ack`).send({ seconds: 99999, pages: [0, 1, 2] });
  assert.equal(ack.status, 422, "istemci süresi kabul edilmemeli");
  assert.ok(ack.body.missingPages.length >= 1);
});

test("A08/4 başkasının okuma oturumu kullanılamaz", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-SEC-020").field("title", "Oturum çalma denemesi").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items[0];
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});

  const s1 = agentFor(app); await s1.login("nazli.han");
  const sid = (await s1.post(`/api/documents/${up.body.id}/reading/start`).send({})).body.sessionId;
  const s2 = agentFor(app); await s2.login("meltem.aydin");
  assert.equal((await s2.post(`/api/documents/reading/${sid}/ping`).send({ page: 0 })).status, 404);
});

/* A09 — Kayıt ve izleme */
test("A09/1 hata yanıtı yığın izi ve iç ayrıntı sızdırmaz", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("elif.yalcin");
  const res = await a.get("/api/documents/999999999999999999999");
  assert.ok([400, 404].includes(res.status));
  assert.ok(!/at .*\.js:\d+|Error:|pg-mem|node_modules/.test(JSON.stringify(res.body)), "iç ayrıntı sızdı");
});

test("A09/2 kritik olaylar denetim kaydına yazılır", async () => {
  const { app, pool } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  const rows = (await pool.query("SELECT event, actor FROM audit_log ORDER BY id")).rows;
  const events = rows.map((r) => r.event);
  for (const e of ["giris.basarili", "duyuru.onaya_gonderildi"])
    assert.ok(events.includes(e), `${e} denetim kaydında yok`);
});

/* Yetki ayrımı ve iş kuralı sızmaları */
test("SoD/1 yönetici kendi rolünün yetkisini ve kendi rolünü değiştiremez", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  assert.equal((await admin.put("/api/admin/permissions")
    .send({ roleKey: "admin", screenKey: "d.board", level: "write" })).status, 403);
  assert.equal((await admin.put("/api/admin/users/elif.yalcin").send({
    displayName: "Elif Yalçın", roleKey: "inspection", unitCode: "BT", titleCode: "DIR",
    manager: "deniz.okur", active: true })).status, 403);
});

test("SoD/2 yayınlanmış duyuruyu yalnızca Teftiş değiştirir", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items[0];
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});
  const id = Number(rq.target_id);

  assert.equal((await bg.put(`/api/announcements/${id}`).send(ann({ title: "Sahibi değiştirmeye çalışıyor" }))).status, 403);
  assert.equal((await insp.put(`/api/announcements/${id}`).send(ann({
    title: "Teftiş düzeltmesi yapıldı", category: "Yasal", criticality: "Kritik" }))).status, 200);
});

test("SoD/3 personel duyuru giremez, doküman yükleyemez", async () => {
  const { app } = await boot();
  const staff = agentFor(app); await staff.login("nazli.han");
  assert.equal((await staff.post("/api/announcements").send(ann())).status, 403);
  const up = await staff.post("/api/documents")
    .field("docNo", "PR-SEC-030").field("title", "Yetkisiz yükleme").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  assert.equal(up.status, 403);
});

test("Gövde boyutu ve istek sınırı uygulanır", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("burak.temel");
  const big = "x".repeat(300 * 1024);
  const res = await a.post("/api/announcements").send(ann({ body: big }));
  assert.ok([400, 413].includes(res.status), `büyük gövde kabul edildi: ${res.status}`);
});

/* --- PRISMA Fortify raporundaki kategorilerin bu kod tabanında kapalı olduğunun sınanması --- */

test("Fortify/1 oturum ve CSRF çerezleri yalnızca /api yolunda geçerli", async () => {
  const { app } = await boot();
  const res = await request(app).post("/api/auth/login").send({ username: "elif.yalcin", password: PASSWORD });
  const cookies = res.headers["set-cookie"] || [];
  const sid = cookies.find((c) => c.startsWith("tp_sid="));
  const csrf = cookies.find((c) => c.startsWith("tp_csrf="));
  assert.match(sid, /Path=\/api/, "oturum çerezi geniş kapsamlı olmamalı");
  assert.match(csrf, /Path=\/api/, "CSRF çerezi geniş kapsamlı olmamalı");
});

test("Fortify/2 hata referansı tahmin edilebilir üreteçten gelmiyor", async () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../server/src/middleware/errors.js"), "utf8");
  assert.ok(!/Math\.random/.test(src), "Math.random kullanılmamalı");
  assert.match(src, /crypto\.randomBytes/, "kriptografik üreteç kullanılmalı");
});

test("Fortify/3 yanıt başlığındaki dosya adı yüklenen addan türetilmiyor", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const evil = 'kotu"; filename="sahte.html';
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-HDR-001").field("title", "Başlık enjeksiyon denemesi").field("category", "Genel")
    .attach("file", PDF, { filename: evil + ".pdf", contentType: "application/pdf" });
  assert.equal(up.status, 201);
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.subject.includes("PR-HDR-001"));
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});

  const file = await insp.get(`/api/documents/${up.body.id}/file`);
  const cd = file.headers["content-disposition"] || "";
  assert.equal(cd, 'inline; filename="PR-HDR-001_v1.0.pdf"', "başlık kayıt alanlarından üretilmeli: " + cd);
  assert.ok(!/sahte\.html/.test(cd), "yüklenen ad başlığa geçmemeli");
});

test("Fortify/4 bozuk dosya yolu kaydı dosya açmaya izin vermez", async () => {
  const { app, pool } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-PATH-001").field("title", "Yol denetimi denemesi").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  /* Veritabanı düzeyinde yol kurcalanırsa dosya servis edilmemeli. */
  await pool.query("UPDATE documents SET file_path = $1 WHERE id = $2", ["../../../../etc/passwd", up.body.id]);
  const res = await bg.get(`/api/documents/${up.body.id}/file`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Geçersiz dosya kaydı/);
});

test("Fortify/5 günlük yapılandırması kişisel veriyi ve sırları maskeler", async () => {
  const app_src = require("fs").readFileSync(require("path").join(__dirname, "../server/src/app.js"), "utf8");
  for (const p of ["req.headers.cookie", "req.remoteAddress", "*.password", "*.authPass"])
    assert.ok(app_src.includes(p), `günlük maskesinde eksik: ${p}`);
  const err_src = require("fs").readFileSync(require("path").join(__dirname, "../server/src/middleware/errors.js"), "utf8");
  assert.match(err_src, /mask\(req\.user/, "kullanıcı adı maskelenmeli");
});

test("Fortify/6 kaynakta sabit kimlik bilgisi yok", async () => {
  const fs = require("fs"), path = require("path");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const files = [...walk(path.join(__dirname, "../server/src")), ...walk(path.join(__dirname, "../client"))]
    .filter((f) => /\.(js|css|html)$/.test(f));
  const rx = /(password|parola|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!rx.test(src), `sabit kimlik bilgisi: ${path.basename(f)}`);
  }
});

test("Fortify/7 konteyner ve veritabanı sıkılaştırma dosyaları paketle geliyor", async () => {
  const fs = require("fs"), path = require("path");
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const dockerfile = read("ops/Dockerfile");
  assert.match(dockerfile, /^USER node$/m, "konteyner root çalışmamalı");
  const compose = read("ops/docker-compose.yml");
  assert.match(compose, /cap_drop: \["ALL"\]/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /no-new-privileges:true/);
  const lp = read("ops/least-privilege.sql");
  assert.match(lp, /REVOKE CREATE ON SCHEMA public FROM tera_portal/);
  assert.match(lp, /REVOKE UPDATE, DELETE, TRUNCATE ON audit_log/);
});
