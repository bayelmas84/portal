"use strict";
/* Yetkilendirme tek merkez. Sunucu her istekte yeniden kontrol eder; istemciden gelen rol/yetki bilgisine güvenilmez. */
const db = require("../lib/db");

const MODULES = [
  { key: "delivery", label: "Proje Yönetimi" },
  { key: "documents", label: "Doküman Yönetimi" },
  { key: "announce", label: "Duyurular" },
  { key: "training", label: "Eğitimler" },
  { key: "reports", label: "Raporlar" },
  { key: "approvals", label: "Onaylar" },
  { key: "compliance", label: "Uyum ve Teftiş" },
  { key: "admin", label: "Admin Panel" },
  { key: "shortcuts", label: "Kısayollar" },
];

const SCREENS = {
  delivery: [["d.my", "İşlerim"], ["d.projects", "Projeler"], ["d.board", "Board"], ["d.backlog", "Backlog"], ["d.sprint", "Sprint"], ["d.gate", "Stage Gates"],
             ["d.charts", "Proje grafikleri"], ["d.exec", "Yönetici özeti"]],
  documents: [["k.docs", "Dokümanlar"], ["k.queue", "Teftiş kuyruğu"], ["k.mail", "Gönderilen bildirimler"]],
  announce: [["a.list", "Duyurular"]],
  training: [["t.un", "Okunmamış"], ["t.done", "Tamamlananlar"]],
  reports: [["r.list", "Rapor kataloğu"], ["r.view", "Rapor"],
            ["r.dev", "Rapor geliştirme"], ["r.publish", "Yayınlama onayı"], ["r.usage", "Kullanım raporu"]],
  approvals: [["p.in", "Onayımda bekleyenler"], ["p.my", "Onay beklediklerim"], ["p.done", "Onayladıklarım"]],
  compliance: [["c.read", "Okuma raporu"], ["c.rem", "Hatırlatma planı"], ["c.audit", "Denetim kaydı"]],
  admin: [["m.ann", "Duyuru yönetimi"], ["m.users", "Kullanıcılar"], ["m.units", "Birimler"], ["m.titles", "Ünvanlar"],
          ["m.roles", "Roller ve yetkiler"], ["m.access", "Ekran yetkileri"], ["m.notif", "Bildirim tanımları"],
          ["m.mail", "E-posta ayarları"], ["m.dir", "Dizin (AD) ayarları"],
          ["m.avail", "Ekran yönetimi"], ["m.short", "Kısayol yönetimi"]],
  shortcuts: [["s.all", "Tüm kısayollar"]],
};

/* Kapatılamayan anahtarlar: yönetici kendini dışarıda bırakamaz */
const UNCLOSABLE = new Set(["admin", "m.avail"]);

const moduleOfScreen = (screenKey) =>
  Object.keys(SCREENS).find((m) => SCREENS[m].some(([k]) => k === screenKey)) || null;

async function permissionsOf(roleKey) {
  const rows = await db.many("SELECT screen_key, level FROM role_permissions WHERE role_key = $1", [roleKey]);
  return Object.fromEntries(rows.map((r) => [r.screen_key, r.level]));
}

async function screenStates() {
  const rows = await db.many("SELECT screen_key, state FROM screen_state");
  return Object.fromEntries(rows.map((r) => [r.screen_key, r.state]));
}

/* açık = kullanılabilir, bakim = menüde ama kullanılamaz, kapali = hiç yok */
function stateOf(states, key) { return states[key] || "acik"; }

async function context(user) {
  const [perms, states] = await Promise.all([permissionsOf(user.role_key), screenStates()]);
  return { perms, states };
}

function level(ctx, key) {
  if (key === "shortcuts" || String(key).startsWith("s.")) return "write";
  return ctx.perms[key] || "none";
}
function visible(ctx, key) {
  if (level(ctx, key) === "none") return false;
  const mod = moduleOfScreen(key);
  if (stateOf(ctx.states, key) === "kapali") return false;
  if (mod && stateOf(ctx.states, mod) === "kapali") return false;
  return true;
}
function usable(ctx, key) {
  if (!visible(ctx, key)) return false;
  const mod = moduleOfScreen(key);
  if (stateOf(ctx.states, key) !== "acik") return false;
  if (mod && stateOf(ctx.states, mod) !== "acik") return false;
  return true;
}
const canRead = (ctx, key) => usable(ctx, key);
const canWrite = (ctx, key) => usable(ctx, key) && level(ctx, key) === "write";

module.exports = {
  MODULES, SCREENS, UNCLOSABLE, moduleOfScreen,
  permissionsOf, screenStates, stateOf, context, level, visible, usable, canRead, canWrite,
};
