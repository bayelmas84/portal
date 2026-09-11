"use strict";
/* Proje dokümanları için altı adımlı, sıralı onay zinciri (CHANGELOG 1.13.0):
     1. Ürün Sahibi (projenin Product Owner'ı)
     2. İş Birimi Sahibi (projenin Business Owner'ı)
     3. Ürün Sahibi'nin yöneticisi
     4. İş Birimi Sahibi'nin yöneticisi
     5. Teftiş (projenin zorunlu Internal Audit üyesi)
     6. Kurumsal Risk Grup Direktörü (role_key='control' AND title_code='GDIR')

   "Her adımı yalnızca o adımın kişisi onaylar; beklenen onaycı portalda kullanıcı
   değilse Proje Yönetim Direktörü vekaleten onaylar ve bu kayıtta 'vekaleten'
   olarak işaretlenir." — bir adımın beklenen kişisi çözülemezse (proje ekibinde o rol
   atanmamış, yöneticisi tanımsız, ya da Kurumsal Risk Grup Direktörü unvanında kimse
   yoksa) Proje Yönetim Direktörü (rol pmd / unvan PYD) o adımı vekaleten onaylayabilir. */
const db = require("./db");
const projects = require("./projects");

/* Sabit tip sırası: bir tip, kendinden önceki tip onaylanmadan yüklenemez. */
const DOC_TYPE_ORDER = ["Proje Kartı", "BRD", "FRD", "UAT", "Go Live", "Risk ve Uyumluluk", "Kapanış"];

async function memberWithRole(projectId, projectRole) {
  const m = await db.one(
    `SELECT pm.username FROM project_members pm JOIN users u ON u.username = pm.username
      WHERE pm.project_id = $1 AND pm.project_role = $2 AND u.active`,
    [projectId, projectRole]);
  return m ? m.username : null;
}

async function managerOf(username) {
  if (!username) return null;
  const u = await db.one("SELECT manager FROM users WHERE username = $1", [username]);
  if (!u || !u.manager) return null;
  const mgr = await db.one("SELECT username FROM users WHERE username = $1 AND active", [u.manager]);
  return mgr ? mgr.username : null;
}

async function riskGroupDirector() {
  const u = await db.one(
    "SELECT username FROM users WHERE role_key = 'control' AND title_code = 'GDIR' AND active ORDER BY username LIMIT 1");
  return u ? u.username : null;
}

/* Adım tanımları: her biri projeId alır, o adımı onaylaması gereken kullanıcı adını
   (varsa) döner. null dönerse: o adımda atanmış kimse yok, yalnızca PMD vekaleten onaylar. */
const STEPS = [
  { no: 1, name: "Ürün Sahibi", resolve: (pid) => memberWithRole(pid, "Product Owner") },
  { no: 2, name: "İş Birimi Sahibi", resolve: (pid) => memberWithRole(pid, "Business Owner") },
  { no: 3, name: "Ürün Sahibi'nin yöneticisi", resolve: async (pid) => managerOf(await memberWithRole(pid, "Product Owner")) },
  { no: 4, name: "İş Birimi Sahibi'nin yöneticisi", resolve: async (pid) => managerOf(await memberWithRole(pid, "Business Owner")) },
  { no: 5, name: "Teftiş", resolve: (pid) => memberWithRole(pid, "Internal Audit") },
  { no: 6, name: "Kurumsal Risk Grup Direktörü", resolve: () => riskGroupDirector() },
];

function stepAt(no) {
  const s = STEPS.find((s) => s.no === no);
  if (!s) throw Object.assign(new Error("Geçersiz onay adımı"), { status: 400 });
  return s;
}

/* Bir sonraki onaycı isteyen tarafın kim olduğunu (ya da vekalet gerektiğini) döner.
   UI'da "onayımda bekliyor" listesi için de kullanılabilir. */
async function expectedApprover(projectId, stepNo) {
  const step = stepAt(stepNo);
  const username = await step.resolve(projectId);
  return { stepNo, stepName: step.name, username };
}

/* req.user bu adımı onaylayabilir mi? Ya tam olarak beklenen kişidir, ya da beklenen
   kişi çözülemiyorsa (proxy=true) Proje Yönetim Direktörü'dür. */
async function canApproveStep(user, projectId, stepNo) {
  const { username } = await expectedApprover(projectId, stepNo);
  if (username) return { allowed: user.username === username, isProxy: false, expected: username };
  return { allowed: projects.isGateAuthority(user), isProxy: true, expected: null };
}

function nextTypeAllowed(existingApprovedTypes, docType) {
  const idx = DOC_TYPE_ORDER.indexOf(docType);
  if (idx <= 0) return true; // ilk tip (Proje Kartı) her zaman serbest
  const previous = DOC_TYPE_ORDER[idx - 1];
  return existingApprovedTypes.has(previous);
}

module.exports = { DOC_TYPE_ORDER, STEPS, stepAt, expectedApprover, canApproveStep, nextTypeAllowed, memberWithRole, managerOf, riskGroupDirector };
