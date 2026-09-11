"use strict";
/* Proje dokümanları: sabit tip listesi, sıra kuralı, altı adımlı onay zinciri (vekalet dahil). */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor, PASSWORD } = require("./harness");

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("örnek içerik")]);

async function seedProject(pool) {
  const row = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('DOCX','Doküman testi projesi','Waterfall','tolga.firat','BT','devam','planinda') RETURNING id`
  )).rows[0];
  return row.id;
}

/* Proje ekibini kurar: nazli.han -> Product Owner, mert.balkan -> Business Owner.
   nazli.han'ın yöneticisi meltem.aydin (opsdir), mert.balkan'ın yöneticisi tolga.firat (pm).
   Internal Audit (kerem.aslan) ve Risk (gonul.aladag) otomatik gelir (ensureMandatoryMembers). */
async function seedTeam(agentApp, pm, projectId) {
  await pm.get(`/api/projects/${projectId}/team`); // zorunlu üyeliği tetikler
  await pm.post(`/api/projects/${projectId}/team`).send({ username: "nazli.han", projectRole: "Product Owner" });
  await pm.post(`/api/projects/${projectId}/team`).send({ username: "mert.balkan", projectRole: "Business Owner" });
}

test("Proje Kartı dışındaki bir tip, önceki tip onaylanmadan yüklenemez (sıra kuralı)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pm = agentFor(app);
  await pm.login("tolga.firat", PASSWORD);
  await seedTeam(agentFor(app), pm, projectId);

  const res = await pm.post(`/api/projects/${projectId}/documents`)
    .field("docType", "BRD").field("title", "İş gereksinimleri")
    .attach("file", PDF, { filename: "brd.pdf", contentType: "application/pdf" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Proje Kartı/);
});

test("Proje Kartı yüklenip altı adım sırayla onaylanınca doküman onaylanır", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pmAgent = agentFor(app);
  await pmAgent.login("tolga.firat", PASSWORD);
  await seedTeam(agentFor(app), pmAgent, projectId);

  const up = await pmAgent.post(`/api/projects/${projectId}/documents`)
    .field("docType", "Proje Kartı").field("title", "Proje kartı")
    .attach("file", PDF, { filename: "kart.pdf", contentType: "application/pdf" });
  assert.equal(up.status, 201);
  const docId = up.body.id;

  const detail0 = await pmAgent.get(`/api/projects/${projectId}/documents/${docId}`);
  assert.equal(detail0.body.item.current_step, 1);
  assert.equal(detail0.body.nextApprover.stepName, "Ürün Sahibi");
  assert.equal(detail0.body.nextApprover.username, "nazli.han");

  // Adım 1: Ürün Sahibi (nazli.han)
  const po = agentFor(app); await po.login("nazli.han", PASSWORD);
  const s1 = await po.post(`/api/projects/${projectId}/documents/${docId}/approve`);
  assert.equal(s1.status, 200);
  assert.equal(s1.body.step, 1);
  assert.equal(s1.body.finished, false);

  // Yanlış kişi adım 2'yi onaylayamaz
  const wrong = await po.post(`/api/projects/${projectId}/documents/${docId}/approve`);
  assert.equal(wrong.status, 403);

  // Adım 2: İş Birimi Sahibi (mert.balkan)
  const bo = agentFor(app); await bo.login("mert.balkan", PASSWORD);
  assert.equal((await bo.post(`/api/projects/${projectId}/documents/${docId}/approve`)).status, 200);

  // Adım 3: PO'nun yöneticisi (meltem.aydin)
  const poMgr = agentFor(app); await poMgr.login("meltem.aydin", PASSWORD);
  assert.equal((await poMgr.post(`/api/projects/${projectId}/documents/${docId}/approve`)).status, 200);

  // Adım 4: BO'nun yöneticisi (tolga.firat, aynı zamanda PM)
  assert.equal((await pmAgent.post(`/api/projects/${projectId}/documents/${docId}/approve`)).status, 200);

  // Adım 5: Teftiş (kerem.aslan, Internal Audit)
  const insp = agentFor(app); await insp.login("kerem.aslan", PASSWORD);
  assert.equal((await insp.post(`/api/projects/${projectId}/documents/${docId}/approve`)).status, 200);

  // Adım 6: Kurumsal Risk Grup Direktörü — seed kullanıcılarında role_key=control + title_code=GDIR
  // kombinasyonunda kimse yok, yalnızca Proje Yönetim Direktörü (bayram.elmas) vekaleten onaylayabilir.
  const other = agentFor(app); await other.login("gonul.aladag", PASSWORD); // control ama title MDR
  const notAllowed = await other.post(`/api/projects/${projectId}/documents/${docId}/approve`);
  assert.equal(notAllowed.status, 403);

  const dir = agentFor(app); await dir.login("bayram.elmas", PASSWORD);
  const final = await dir.post(`/api/projects/${projectId}/documents/${docId}/approve`);
  assert.equal(final.status, 200);
  assert.equal(final.body.finished, true);

  const detail = await pmAgent.get(`/api/projects/${projectId}/documents/${docId}`);
  assert.equal(detail.body.item.status, "onaylandi");
  assert.equal(detail.body.approvals.length, 6);
  assert.equal(detail.body.approvals[5].is_proxy, true); // adım 6 vekaleten
  assert.equal(detail.body.approvals[0].is_proxy, false); // adım 1 gerçek PO
});

test("reddedilen doküman yeniden yüklenebilir, onaylanan tekrar yüklenemez", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pmAgent = agentFor(app);
  await pmAgent.login("tolga.firat", PASSWORD);
  await seedTeam(agentFor(app), pmAgent, projectId);

  const up = await pmAgent.post(`/api/projects/${projectId}/documents`)
    .field("docType", "Proje Kartı").field("title", "Proje kartı v1")
    .attach("file", PDF, { filename: "kart.pdf", contentType: "application/pdf" });
  const docId = up.body.id;

  const po = agentFor(app); await po.login("nazli.han", PASSWORD);
  const rej = await po.post(`/api/projects/${projectId}/documents/${docId}/reject`).send({ reason: "Eksik bilgi var, düzeltilmeli." });
  assert.equal(rej.status, 200);

  const reupload = await pmAgent.post(`/api/projects/${projectId}/documents`)
    .field("docType", "Proje Kartı").field("title", "Proje kartı v2 (düzeltildi)")
    .attach("file", PDF, { filename: "kart2.pdf", contentType: "application/pdf" });
  assert.equal(reupload.status, 201);
  assert.equal(reupload.body.id, docId); // aynı kayıt güncellenir

  const detail = await pmAgent.get(`/api/projects/${projectId}/documents/${docId}`);
  assert.equal(detail.body.item.status, "onay_akisinda");
  assert.equal(detail.body.item.current_step, 1);
});

test("PDF olmayan dosya reddedilir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pmAgent = agentFor(app);
  await pmAgent.login("tolga.firat", PASSWORD);
  await seedTeam(agentFor(app), pmAgent, projectId);

  const res = await pmAgent.post(`/api/projects/${projectId}/documents`)
    .field("docType", "Proje Kartı").field("title", "Sahte pdf")
    .attach("file", Buffer.from("bu bir pdf degil"), { filename: "sahte.pdf", contentType: "application/pdf" });
  assert.equal(res.status, 400);
});

test("proje ekibinde olmayan biri dokümanları göremez, blanket erişimi olan roller görebilir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const otherProjectId = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('DOCY','Diğer proje','Scrum','tolga.firat','BT','devam','planinda') RETURNING id`
  )).rows[0].id;
  const pmAgent = agentFor(app);
  await pmAgent.login("tolga.firat", PASSWORD);
  await seedTeam(agentFor(app), pmAgent, projectId);

  // Blanket erişimi olan rol (infosec): hiçbir projenin ekibinde değil ama yine de görebilir.
  const outsider = agentFor(app); await outsider.login("burak.temel", PASSWORD);
  assert.equal((await outsider.get(`/api/projects/${projectId}/documents`)).status, 200);

  // Blanket erişimi olmayan bir kullanıcı (dev): bu projenin (otherProjectId) ekibinde değil -> 403.
  const devOutsider = agentFor(app); await devOutsider.login("mert.balkan", PASSWORD);
  assert.equal((await devOutsider.get(`/api/projects/${otherProjectId}/documents`)).status, 403);
});

test("Teftiş (zorunlu üye) dokümanları görebilir ama board'a giremez (önceki testle tutarlı)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const projectId = await seedProject(pool);
  const pmAgent = agentFor(app);
  await pmAgent.login("tolga.firat", PASSWORD);
  await pmAgent.get(`/api/projects/${projectId}/team`);

  const insp = agentFor(app); await insp.login("kerem.aslan", PASSWORD);
  const docs = await insp.get(`/api/projects/${projectId}/documents`);
  assert.equal(docs.status, 200);
  const board = await insp.get(`/api/projects/${projectId}`);
  assert.equal(board.status, 403);
});
