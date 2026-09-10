"use strict";
/* Proje metrikleri, grafik verileri ve ünvan bazlı yönetici özeti. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

/* Tarihler JS'te hesaplanır: test veritabanı tarih aritmetiğini desteklemiyor. */
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/* İki proje, iş kalemleri ve aktif sprint kurar. */
async function seedProjects(pool) {
  const p1 = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health,start_date,target_date)
     VALUES ('TRADE','Mobil işlem platformu','Scrum','tolga.firat','BT','devam','risk',$1,$2) RETURNING id`,
    [day(-40), day(10)])).rows[0].id;
  const p2 = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health,start_date,target_date)
     VALUES ('CORE','Portföy sistemi göçü','Waterfall','tolga.firat','BT','devam','gecikme',$1,$2) RETURNING id`,
    [day(-80), day(5)])).rows[0].id;
  const s1 = (await pool.query(
    `INSERT INTO sprints (project_id,name,goal,start_date,end_date,committed_points,active)
     VALUES ($1,'Sprint 26','Koşullu emir',$2,$3,40,TRUE) RETURNING id`, [p1, day(-6), day(4)])).rows[0].id;

  const items = [
    [p1, "TRADE-1", "Story", "Koşullu emir planlama", "done", "High", 8, "mert.balkan", s1],
    [p1, "TRADE-2", "Story", "Pozisyon limitleri", "done", "High", 5, "nazli.han", s1],
    [p1, "TRADE-3", "Bug", "Oturum düşüyor", "prog", "Highest", 5, "tolga.firat", s1],
    [p1, "TRADE-4", "Story", "İki faktörlü doğrulama", "todo", "Highest", 8, "mert.balkan", s1],
    [p1, "TRADE-5", "Story", "Fiyat alarm merkezi", "backlog", "Medium", 8, null, null],
    [p2, "CORE-1", "Story", "Custody eşleme", "done", "Highest", 13, "mert.balkan", null],
    [p2, "CORE-2", "Task", "Takasbank arayüzü", "review", "High", 8, "tolga.firat", null],
    [p2, "CORE-3", "Bug", "Bakiye yuvarlama", "todo", "High", 3, "nazli.han", null],
  ];
  for (const [pid, key, type, title, state, pri, pts, who, sid] of items)
    await pool.query(
      `INSERT INTO project_items (project_id,item_key,type,title,state,priority,points,assignee,sprint_id,closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $5='done' THEN now() ELSE NULL END)`,
      [pid, key, type, title, state, pri, pts, who, sid]);

  /* Üç günlük burndown anlık görüntüsü */
  for (const [d, rem, comp] of [[-5, 40, 0], [-3, 32, 8], [-1, 27, 13]])
    await pool.query(
      `INSERT INTO burndown_snapshots (sprint_id,day,remaining,completed) VALUES ($1,$2,$3,$4)`,
      [s1, day(d), rem, comp]);
  return { p1, p2, s1 };
}

test("proje tamamlanma metrikleri sunucuda hesaplanır", async () => {
  const { app, pool } = await boot();
  const { p1 } = await seedProjects(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");

  const detail = await pm.get(`/api/projects/${p1}`);
  assert.equal(detail.status, 200);
  const m = detail.body.metrics;
  assert.equal(m.items, 5);
  assert.equal(m.points, 34);
  assert.equal(m.done_points, 13);
  assert.equal(m.completion, Math.round((13 / 34) * 100), "puan bazlı tamamlanma");
  assert.equal(m.open_bugs, 1);
  assert.ok(m.timeProgress > 0 && m.timeProgress <= 100, "takvim ilerlemesi hesaplanır");
  /* Sapma yüzde: (iş % − takvim %) / takvim % */
  assert.equal(m.drift, Math.round(((m.completion - m.timeProgress) / m.timeProgress) * 100),
    "sapma yüzde olarak hesaplanır");
  assert.ok(m.drift < 0, "bu proje takvimin gerisinde");
});

test("burndown serisi ideal ve gerçek kalan işi verir", async () => {
  const { app, pool } = await boot();
  const { p1 } = await seedProjects(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");
  const charts = (await pm.get(`/api/projects/${p1}/charts`)).body;

  assert.equal(charts.burndown.sprint.name, "Sprint 26");
  assert.equal(charts.burndown.committed, 40);
  const series = charts.burndown.series;
  assert.ok(series.length >= 10, "sprint günlerinin tamamı seride");
  assert.equal(series[0].ideal, 40, "ideal çizgi taahhütten başlar");
  assert.equal(series[series.length - 1].ideal, 0, "ideal çizgi sıfırda biter");
  const measured = series.filter((x) => x.remaining !== null);
  assert.equal(measured.length, 3, "üç anlık görüntü");
  assert.deepEqual(measured.map((x) => x.remaining), [40, 32, 27], "kalan iş azalıyor");
});

test("hız ve dağılım grafikleri veri döner", async () => {
  const { app, pool } = await boot();
  const { p1 } = await seedProjects(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");
  const charts = (await pm.get(`/api/projects/${p1}/charts`)).body;

  assert.equal(charts.velocity.length, 1);
  assert.equal(charts.velocity[0].committed_points, 40);
  assert.equal(charts.velocity[0].completed_points, 13);

  const states = Object.fromEntries(charts.distribution.byState.map((x) => [x.state, x.items]));
  assert.equal(states.done, 2);
  assert.equal(states.prog, 1);
  const types = Object.fromEntries(charts.distribution.byType.map((x) => [x.type, x.items]));
  assert.equal(types.Bug, 1);
  const mert = charts.distribution.byAssignee.find((x) => x.assignee === "mert.balkan");
  assert.equal(mert.open_points, 8, "kişi başına açık iş yükü");
});

test("burndown anlık görüntüsü zamanlanmış görevle alınır", async () => {
  const { app, pool } = await boot();
  const { s1 } = await seedProjects(pool);
  const projects = require("../server/src/lib/projects");
  const r = await projects.snapshotBurndown();
  assert.equal(r.sprints, 1);
  const today = (await pool.query(
    "SELECT remaining, completed FROM burndown_snapshots WHERE sprint_id=$1 AND day=$2", [s1, day(0)])).rows[0];
  assert.equal(today.remaining, 13, "sprintte kalan: 5 (bug) + 8 (story)");
  assert.equal(today.completed, 13);
});

test("yönetici özeti yalnızca Direktör, Grup Direktörü ve GMY ünvanlarına açık", async () => {
  const { app, pool } = await boot();
  await seedProjects(pool);

  /* Deniz Okur: GMY ünvanı → görebilir */
  const gmy = agentFor(app); await gmy.login("deniz.okur");
  const okGmy = await gmy.get("/api/projects/reports/executive");
  assert.equal(okGmy.status, 200);
  assert.equal(okGmy.body.totals.projects, 2);

  /* Meltem Aydın: Direktör ünvanı → görebilir */
  const dir = agentFor(app); await dir.login("meltem.aydin");
  assert.equal((await dir.get("/api/projects/reports/executive")).status, 200);

  /* Tolga Fırat: Müdür ünvanı, Proje Yöneticisi rolü → göremez */
  const mdr = agentFor(app); await mdr.login("tolga.firat");
  const denied = await mdr.get("/api/projects/reports/executive");
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /Direktör, Grup Direktörü/);

  /* Grup Direktörü ünvanı verilince görebilir */
  await pool.query("UPDATE users SET title_code='GDIR' WHERE username='tolga.firat'");
  const again = agentFor(app); await again.login("tolga.firat");
  assert.equal((await again.get("/api/projects/reports/executive")).status, 200, "Grup Direktörü erişebilir");
});

test("yönetici özeti gecikenleri ve birim kırılımını verir", async () => {
  const { app, pool } = await boot();
  await seedProjects(pool);
  const gmy = agentFor(app); await gmy.login("deniz.okur");
  const s = (await gmy.get("/api/projects/reports/executive")).body;

  assert.equal(s.totals.active, 2);
  assert.equal(s.totals.delayed, 1, "bir proje gecikmede");
  assert.equal(s.totals.atRisk, 1);
  assert.equal(s.totals.openBugs, 2);
  assert.equal(s.totals.points, 34 + 24);
  assert.ok(s.totals.completion > 0);

  assert.ok(s.attention.length >= 1, "takvimin gerisinde kalan proje listelenir");
  assert.ok(s.attention.every((x) => x.drift <= -20), "yalnızca %20'den fazla sapma listelenir");
  const bt = s.byUnit.find((u) => u.unit === "Bilgi Teknolojileri");
  assert.equal(bt.projects, 2);
  assert.ok(bt.completion >= 0 && bt.completion <= 100);
});

test("yönetici özeti görüntülemeleri denetim kaydına yazılır", async () => {
  const { app, pool } = await boot();
  await seedProjects(pool);
  const gmy = agentFor(app); await gmy.login("deniz.okur");
  await gmy.get("/api/projects/reports/executive");
  const rows = (await pool.query("SELECT actor, detail FROM audit_log WHERE event='yonetici_ozeti.goruntulendi'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "deniz.okur");
});

test("iş kalemi durumu değiştirilebilir ve metrikler güncellenir", async () => {
  const { app, pool } = await boot();
  const { p1 } = await seedProjects(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");
  const before = (await pm.get(`/api/projects/${p1}`)).body.metrics.done_points;

  const mv = await pm.put("/api/projects/items/TRADE-4/state").send({ state: "done" });
  assert.equal(mv.status, 200);
  const after = (await pm.get(`/api/projects/${p1}`)).body.metrics.done_points;
  assert.equal(after, before + 8, "tamamlanan puan artar");

  const bad = await pm.put("/api/projects/items/TRADE-4/state").send({ state: "silindi" });
  assert.equal(bad.status, 400, "tanımsız durum reddedilir");
});

test("işlerim ekranı yalnızca kişinin açık işlerini döner", async () => {
  const { app, pool } = await boot();
  await seedProjects(pool);
  const dev = agentFor(app); await dev.login("mert.balkan");
  const items = (await dev.get("/api/projects/mine")).body.items;
  assert.ok(items.length > 0);
  assert.ok(items.every((x) => x.state !== "done"), "tamamlananlar listelenmez");
  assert.ok(items.some((x) => x.item_key === "TRADE-4"));
  assert.ok(!items.some((x) => x.item_key === "CORE-3"), "başkasının işi listelenmez");
});

test("Proje Yönetim Direktörü rolü proje yönetiminde tam yetkili", async () => {
  const { app, pool } = await boot();   /* Bayram Elmas örnek kullanıcılar arasında tanımlı */
  await seedProjects(pool);

  const dir = agentFor(app); await dir.login("bayram.elmas");
  const me = (await dir.get("/api/me")).body;
  const d = me.modules.find((m) => m.key === "delivery");
  assert.ok(d, "Proje Yönetimi modülü görünür");
  for (const k of ["d.my", "d.projects", "d.board", "d.backlog", "d.sprint", "d.gate", "d.charts", "d.exec"])
    assert.equal((d.screens.find((s) => s.key === k) || {}).level, "write", `${k} yazma yetkisi olmalı`);

  /* Ünvanı PYD olduğu için yönetici özetini görür. */
  const exec = await dir.get("/api/projects/reports/executive");
  assert.equal(exec.status, 200);

  /* İş kalemi ekleme ve durum değiştirme yetkisi var. */
  const mv = await dir.put("/api/projects/items/TRADE-3/state").send({ state: "done" });
  assert.equal(mv.status, 200);
});

test("yeni rol güvenlik taramasında bulgu üretmiyor", async () => {
  const fs = require("fs"), path = require("path");
  const seed = fs.readFileSync(path.join(__dirname, "../server/src/lib/seed.js"), "utf8");
  /* Rol tanımı yalnızca yetki listesidir: parola, anahtar veya kişiye özel istisna içermez. */
  assert.match(seed, /pmdir: \{/, "rol tanımlı");
  assert.ok(!/bayram|elmas/i.test(seed), "kaynakta kişiye özel sabit yok");
  const rx = /(password|parola|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i;
  assert.ok(!rx.test(seed), "sabit kimlik bilgisi yok");
});
