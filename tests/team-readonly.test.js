"use strict";
/* Ekip üyeliğine göre salt okunur erişim: role_key'i "staff" olan biri, yalnızca
   atandığı projede ve yalnızca okuma amaçlı d.projects/d.gate ekranlarına girebilir. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor, PASSWORD } = require("./harness");

async function seedProject(pool) {
  const row = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('ROTM','Salt okunur erişim testi','Scrum','tolga.firat','BT','devam','planinda') RETURNING id`
  )).rows[0];
  await pool.query(
    `INSERT INTO project_items (project_id,item_key,type,title,state,priority,points)
     VALUES ($1,'ROTM-1','Story','Örnek iş kalemi','todo','Medium',5)`, [row.id]);
  return row.id;
}

test("ekipte olmayan staff kullanıcı projeye giremez", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const staff = agentFor(app);
  await staff.login("nazli.han", PASSWORD); // role_key: staff, bu projenin ekibinde değil

  const res = await staff.get(`/api/projects/${projectId}`);
  assert.equal(res.status, 403);
});

test("Product Owner olarak eklenen staff kullanıcı projeyi SALT OKUNUR görür", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);

  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  const add = await pm.post(`/api/projects/${projectId}/team`).send({
    username: "nazli.han", projectRole: "Product Owner",
  });
  assert.equal(add.status, 201);

  const po = agentFor(app);
  await po.login("nazli.han", PASSWORD);

  const read = await po.get(`/api/projects/${projectId}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.metrics.code, "ROTM");
  assert.equal(read.body.items[0].item_key, "ROTM-1");

  const gates = await po.get(`/api/gates/project/${projectId}`);
  assert.equal(gates.status, 200);
});

test("ekip üyeliği yazma yetkisi vermez (board'a dokunamaz)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);

  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.post(`/api/projects/${projectId}/team`).send({
    username: "nazli.han", projectRole: "QA",
  });

  const qa = agentFor(app);
  await qa.login("nazli.han", PASSWORD);

  const write = await qa.put("/api/projects/items/ROTM-1/state").send({ state: "prog" });
  assert.equal(write.status, 403);
});

test("ekip üyeliği başka projeye erişim vermez (proje-bazlı sınır)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const otherId = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('DIGR','Diğer proje','Scrum','tolga.firat','BT','devam','planinda') RETURNING id`
  )).rows[0].id;

  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.post(`/api/projects/${projectId}/team`).send({
    username: "nazli.han", projectRole: "Business Owner",
  });

  const bo = agentFor(app);
  await bo.login("nazli.han", PASSWORD);
  assert.equal((await bo.get(`/api/projects/${projectId}`)).status, 200);
  assert.equal((await bo.get(`/api/projects/${otherId}`)).status, 403);
});

test("Internal Audit / Risk zorunlu üyeliği board erişimi vermez", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await pm.get(`/api/projects/${projectId}/team`); // zorunlu üyeliği tetikler

  const inspection = agentFor(app);
  await inspection.login("kerem.aslan", PASSWORD); // role_key: inspection, bu projede Internal Audit
  const res = await inspection.get(`/api/projects/${projectId}`);
  assert.equal(res.status, 403);
});

test("Proje Yöneticisi rolü değişmeden normal şekilde çalışmaya devam eder (regresyon)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  const res = await pm.get(`/api/projects/${projectId}`);
  assert.equal(res.status, 200);
});
