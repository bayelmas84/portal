"use strict";
/* Proje ekibi: zorunlu üyelik (Internal Audit, Risk), ekleme/çıkarma yetkisi,
   zorunlu üyenin çıkarılamaması. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor, PASSWORD } = require("./harness");

async function seedProject(pool) {
  const row = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('TEAM','Ekip testi projesi','Kanban','tolga.firat','BT','devam','planinda') RETURNING id`
  )).rows[0];
  return row.id;
}

test("proje oluşturulunca Internal Audit ve Risk otomatik ve zorunlu eklenir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);

  const created = await pm.post("/api/projects").send({
    code: "AUTOM", name: "Otomatik ekip testi", method: "Kanban", lead: "tolga.firat",
  });
  assert.equal(created.status, 201);

  const team = await pm.get(`/api/projects/${created.body.id}/team`);
  assert.equal(team.status, 200);
  const roles = team.body.items.map((m) => m.project_role).sort();
  assert.deepEqual(roles, ["Internal Audit", "Risk"]);
  assert.ok(team.body.items.every((m) => m.is_mandatory === true));
  // Teftiş rolündeki tek aktif kullanıcı kerem.aslan, İç Kontrol tek aktif kullanıcı gonul.aladag
  const byRole = Object.fromEntries(team.body.items.map((m) => [m.project_role, m.username]));
  assert.equal(byRole["Internal Audit"], "kerem.aslan");
  assert.equal(byRole["Risk"], "gonul.aladag");
});

test("mevcut (eski) projede eksik zorunlu üyelik GET sırasında tamamlanır (lazy backfill)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);

  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  const before = await pool.query("SELECT count(*)::int AS c FROM project_members WHERE project_id=$1", [projectId]);
  assert.equal(before.rows[0].c, 0);

  const team = await pm.get(`/api/projects/${projectId}/team`);
  assert.equal(team.status, 200);
  assert.equal(team.body.items.length, 2);
});

test("PM zorunlu olmayan bir üyeyi ekleyebilir ve çıkarabilir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);

  const add = await pm.post(`/api/projects/${projectId}/team`).send({
    username: "mert.balkan", projectRole: "Developer",
  });
  assert.equal(add.status, 201);

  const dup = await pm.post(`/api/projects/${projectId}/team`).send({
    username: "mert.balkan", projectRole: "Developer",
  });
  assert.equal(dup.status, 409);

  const remove = await pm.del(`/api/projects/${projectId}/team/mert.balkan`);
  assert.equal(remove.status, 200);

  const team = await pm.get(`/api/projects/${projectId}/team`);
  assert.ok(!team.body.items.some((m) => m.username === "mert.balkan"));
});

test("Internal Audit / Risk elle eklenemez ve zorunlu üye çıkarılamaz", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`); // backfill tetikler

  const manualAdd = await pm.post(`/api/projects/${projectId}/team`).send({
    username: "kerem.aslan", projectRole: "Internal Audit",
  });
  assert.equal(manualAdd.status, 400);

  const removeAttempt = await pm.del(`/api/projects/${projectId}/team/kerem.aslan`);
  assert.equal(removeAttempt.status, 409);
});

test("Geliştirici rolü ekip ekranını göremez (yetki yok)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const dev = agentFor(app);
  await dev.login("mert.balkan", PASSWORD);

  const res = await dev.get(`/api/projects/${projectId}/team`);
  assert.equal(res.status, 403);
});

test("Proje Yönetim Direktörü zorunlu üyeliği de görür, ekleme yapabilir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const dir = agentFor(app);
  await dir.login("bayram.elmas", PASSWORD);

  const team = await dir.get(`/api/projects/${projectId}/team`);
  assert.equal(team.status, 200);
  assert.equal(team.body.items.length, 2);

  const add = await dir.post(`/api/projects/${projectId}/team`).send({
    username: "nazli.han", projectRole: "Analyst",
  });
  assert.equal(add.status, 201);
});
