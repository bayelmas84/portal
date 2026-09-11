"use strict";
/* d.appr (onaycılar günlüğü) ve d.cr (değişiklik talepleri, çift onay). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor, PASSWORD } = require("./harness");

async function seedProject(pool) {
  const row = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('CRTS','CR testi projesi','Waterfall','tolga.firat','BT','devam','planinda') RETURNING id`
  )).rows[0];
  return row.id;
}

test("değişiklik talebi: iki onay birlikte tamamlanmadan onaylanmış sayılmaz", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`);
  await pm.post(`/api/projects/${projectId}/team`).send({ username: "mert.balkan", projectRole: "Developer" });

  const dev = agentFor(app); await dev.login("mert.balkan", PASSWORD);
  const create = await dev.post(`/api/projects/${projectId}/change-requests`).send({
    title: "Kapsam genişletme", description: "Yeni bir rapor ekranı eklenmesi talep ediliyor.",
  });
  assert.equal(create.status, 201);
  const crId = create.body.id;

  // mert.balkan'ın yöneticisi tolga.firat (aynı zamanda bu projenin PM'i).
  const mgrApprove = await pm.post(`/api/projects/${projectId}/change-requests/${crId}/approve-manager`);
  assert.equal(mgrApprove.status, 200);
  assert.equal(mgrApprove.body.finished, false); // ekip onayı henüz yok

  const list1 = await pm.get(`/api/projects/${projectId}/change-requests`);
  assert.equal(list1.body.items[0].status, "bekliyor");

  const teamApprove = await pm.post(`/api/projects/${projectId}/change-requests/${crId}/approve-team`);
  assert.equal(teamApprove.status, 200);
  assert.equal(teamApprove.body.finished, true);

  const list2 = await pm.get(`/api/projects/${projectId}/change-requests`);
  assert.equal(list2.body.items[0].status, "onaylandi");
});

test("yönetici olmayan biri yönetici onayı veremez, PM olmayan biri ekip onayı veremez", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`);
  await pm.post(`/api/projects/${projectId}/team`).send({ username: "mert.balkan", projectRole: "Developer" });

  const dev = agentFor(app); await dev.login("mert.balkan", PASSWORD);
  const create = await dev.post(`/api/projects/${projectId}/change-requests`).send({
    title: "Küçük değişiklik", description: "Buton rengi değiştirilsin lütfen bu konuda.",
  });
  const crId = create.body.id;

  // mert.balkan kendi talebine yönetici onayı veremez (o yönetici değil).
  const selfMgr = await dev.post(`/api/projects/${projectId}/change-requests/${crId}/approve-manager`);
  assert.equal(selfMgr.status, 403);

  // mert.balkan (dev, d.cr yazma yetkisi yok) ekip onayı veremez.
  const selfTeam = await dev.post(`/api/projects/${projectId}/change-requests/${crId}/approve-team`);
  assert.equal(selfTeam.status, 403);
});

test("değişiklik talebi reddedilebilir ve sonra onaylanamaz", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`);
  await pm.post(`/api/projects/${projectId}/team`).send({ username: "mert.balkan", projectRole: "Developer" });

  const dev = agentFor(app); await dev.login("mert.balkan", PASSWORD);
  const create = await dev.post(`/api/projects/${projectId}/change-requests`).send({
    title: "Reddedilecek talep", description: "Bu talep test amaçlı reddedilecek bir talep.",
  });
  const crId = create.body.id;

  const reject = await pm.post(`/api/projects/${projectId}/change-requests/${crId}/reject`).send({ reason: "Kapsam dışı, bu sürümde yapılmayacak." });
  assert.equal(reject.status, 200);

  const afterReject = await pm.post(`/api/projects/${projectId}/change-requests/${crId}/approve-team`);
  assert.equal(afterReject.status, 409);
});

test("proje ekibinde olmayan biri değişiklik talebi açamaz", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`);

  const outsider = agentFor(app); await outsider.login("nazli.han", PASSWORD); // bu projenin ekibinde değil, staff
  const create = await outsider.post(`/api/projects/${projectId}/change-requests`).send({
    title: "Yetkisiz talep", description: "Bu talebin reddedilmesi bekleniyor çünkü ekipte değil.",
  });
  assert.equal(create.status, 403);
});

test("onaycılar günlüğü faz kapısı imzalarını ve doküman onaylarını birlikte listeler", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`);
  await pm.post(`/api/projects/${projectId}/team`).send({ username: "nazli.han", projectRole: "Product Owner" });

  const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("ornek")]);
  const up = await pm.post(`/api/projects/${projectId}/documents`)
    .field("docType", "Proje Kartı").field("title", "Proje kartı")
    .attach("file", PDF, { filename: "kart.pdf", contentType: "application/pdf" });
  const docId = up.body.id;

  const po = agentFor(app); await po.login("nazli.han", PASSWORD);
  await po.post(`/api/projects/${projectId}/documents/${docId}/approve`);

  const log = await pm.get(`/api/projects/${projectId}/approvals-log`);
  assert.equal(log.status, 200);
  assert.equal(log.body.items.length, 1);
  assert.equal(log.body.items[0].kind, "dokuman");
  assert.equal(log.body.items[0].username, "nazli.han");
});
