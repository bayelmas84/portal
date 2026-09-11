"use strict";
/* Başlangıç verisi: roller, yetki matrisi, bildirim tanımları, birim/ünvan listesi, kısayollar.
   Kullanıcılar buraya elle eklenmez; ilk yönetici KURULUM.md adım 9'daki komutla tanımlanır. */
const db = require("../lib/db");
const access = require("../services/access");

const ROLES = [
  ["pmdir", "Proje Yönetim Direktörü"],
  ["admin", "Admin"], ["inspection", "Teftiş"], ["infosec", "Bilgi Güvenliği"],
  ["control", "İç Kontrol"], ["gmy", "Genel Müdür Yardımcısı"], ["opsdir", "Operasyon Direktörü"],
  ["pm", "Proje Yöneticisi"], ["pmd", "Proje Yönetim Direktörü"],
  ["dev", "Geliştirici"], ["staff", "Personel"],
];

const R = "read", W = "write";
/* Admin her ekranı okur, yalnızca Duyurular ve Admin Panel'de yazar. */
const PERMS = {
  /* Proje Yönetim Direktörü: Proje Yönetimi'nde tam yetki (okuma, yazma, ekleme, silme) ve
     faz kapısını tek imzayla onaylama. Diğer modüllerde okuma düzeyindedir. */
  pmdir: {
    delivery: W, "d.my": W, "d.projects": W, "d.team": W, "d.docs": W, "d.docview": W, "d.appr": W, "d.cr": W, "d.board": W, "d.backlog": W, "d.sprint": W,
    "d.gate": W, "d.gate.approve": W, "d.delete": W, "d.charts": W, "d.exec": W,
    documents: R, "k.docs": R, announce: R, "a.list": R,
    training: R, "t.un": W, "t.done": W,
    reports: R, "r.list": R, "r.view": R, "r.usage": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
    /* Admin Panel: tüm ekranlar görünür, ancak salt okunur — değişiklik yapamaz. */
    admin: R, "m.ann": R, "m.users": R, "m.units": R, "m.titles": R, "m.roles": R,
    "m.access": R, "m.notif": R, "m.mail": R, "m.dir": R, "m.brand": R, "m.avail": R, "m.short": R,
  },
  admin: {
    delivery: R, "d.my": R, "d.projects": R, "d.board": R, "d.backlog": R, "d.sprint": R, "d.gate": R,
    "d.charts": R, "d.exec": R,
    documents: R, "k.docs": R, "k.mail": R,   /* k.queue verilmez: onay bekleyen kayıtlar Admin'e görünmez */
    /* a.del verilmez: silme talebini duyuruyu giren kişi veya Teftiş açar. */
    announce: W, "a.list": W, "a.new": W,
    training: R, "t.un": R, "t.done": R,
    reports: R, "r.list": R, "r.view": R, "r.usage": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
    admin: W, "m.ann": W, "m.users": W, "m.units": W, "m.titles": W, "m.roles": W,
    "m.access": W, "m.notif": W, "m.mail": W, "m.dir": W, "m.brand": W, "m.avail": W, "m.short": W,
  },
  /* Teftiş: yalnızca kendi görev alanı — doküman kontrolü, duyuru denetimi, onaylar, uyum.
     Proje Yönetimi ve Admin Panel yetkisi yoktur; yetkisi olmayan modül menüde hiç görünmez. */
  inspection: {
    /* Teftiş doküman onay zincirinde yer alır; proje dokümanları ekranına genel salt okunur
       erişimi var (yalnızca üyesi olduğu projelerle sınırlı değil — denetim işlevi budur).
       Board, sprint, backlog, kapı ve CR kapalıdır. */
    "d.docs": R, "d.docview": R,
    documents: W, "k.docs": W, "k.new": W, "k.queue": W, "k.mail": W,
    announce: W, "a.list": W, "a.new": W, "a.edit": W, "a.del": W,
    training: R, "t.un": W, "t.done": W,
    reports: R, "r.list": R, "r.view": R, "r.publish": W, "r.usage": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
    compliance: W, "c.read": W, "c.rem": W, "c.audit": W,
  },
  /* Bilgi Güvenliği: proje yönetiminde işi yok; yalnızca proje dokümanlarını görür. */
  infosec: {
    /* Proje yönetiminde işi yok; tüm projelerin dokümanlarına genel salt okunur erişimi var. */
    "d.docs": R, "d.docview": R,
    documents: W, "k.docs": W, "k.new": W, "k.mail": R,
    announce: W, "a.list": W, "a.new": W, "a.del": W,
    training: R, "t.un": W, "t.done": W, reports: R, "r.list": R, "r.view": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
  control: {
    /* İç Kontrol / Kurumsal Risk: proje yönetiminde işlem yapmaz; tüm projelerin
       dokümanlarına genel salt okunur erişimi var (denetim/uyum işlevi). */
    "d.docs": R, "d.docview": R, "d.charts": R,
    documents: W, "k.docs": W, "k.new": W, "k.mail": R,
    announce: W, "a.list": W, "a.new": W, "a.del": W,
    training: R, "t.un": W, "t.done": W, reports: R, "r.list": R, "r.view": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
    compliance: W, "c.read": W, "c.rem": W,
  },
  gmy: {
    /* GMY faz kapısı imzalayabilir: iki imza kuralının ikinci ayağı yönetim kademesidir. */
    delivery: R, "d.my": R, "d.projects": R, "d.board": R, "d.sprint": R, "d.gate": W,
    "d.charts": R, "d.exec": R,
    documents: R, "k.docs": R, announce: R, "a.list": R,
    training: R, "t.un": W, "t.done": W, reports: R, "r.list": R, "r.view": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
  opsdir: {
    delivery: R, "d.my": R, "d.projects": R, "d.charts": R, "d.exec": R,
    documents: R, "k.docs": R,
    announce: R, "a.list": R, training: R, "t.un": W, "t.done": W,
    reports: R, "r.list": R, "r.view": R, approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
  /* Proje Yönetim Direktörü: Proje Yönetimi modülünün tamamında tam yetki (okuma, ekleme,
     değiştirme, silme). Diğer iş modüllerinde de yazma yetkisi vardır.
     Admin Panel'e bilinçli olarak dahil edilmez: kullanıcı ve yetki yönetimi ayrı bir görevdir,
     aksi hâlde kendi yetkisini de değiştirebilir hâle gelir (görevler ayrılığı). */
  pmd: {
    delivery: W, "d.my": W, "d.projects": W, "d.board": W, "d.backlog": W, "d.sprint": W,
    "d.gate": W, "d.gate.approve": W, "d.charts": W, "d.exec": W, "d.delete": W,
    documents: W, "k.docs": W, "k.new": W, "k.mail": R,
    announce: W, "a.list": W, "a.new": W, "a.del": W,
    training: R, "t.un": W, "t.done": W,
    reports: R, "r.list": R, "r.view": R, "r.dev": W, "r.usage": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
  pm: {
    delivery: W, "d.my": W, "d.projects": W, "d.team": W, "d.docs": W, "d.docview": R, "d.appr": R, "d.cr": W, "d.board": W, "d.backlog": W, "d.sprint": W, "d.gate": W,
    "d.charts": W, "d.exec": R,
    documents: R, "k.docs": R, announce: R, "a.list": R,
    training: R, "t.un": W, "t.done": W,
    reports: R, "r.list": R, "r.view": R, "r.dev": W, "r.usage": R,
    approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
  dev: {
    delivery: R, "d.my": W, "d.board": W, "d.backlog": R, "d.projects": R, "d.charts": R,
    documents: R, "k.docs": R, announce: R, "a.list": R,
    training: R, "t.un": W, "t.done": W, approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
  staff: {
    /* Proje ekibine (Product Owner, Business Owner, QA, Vendor, Analyst) atanan kişiye
       board/backlog/sprint (d.projects) ve kapı (d.gate) SALT OKUNUR açılır — bu karar
       role_key'den değil, ekip üyeliğinden gelir (bkz. middleware/auth.js:requireProjectScreen).
       Aşağıda "none" olması yanlış değil: genel erişim yok, proje bazlı istisna orada uygulanıyor. */
    documents: R, "k.docs": R, announce: R, "a.list": R,
    training: W, "t.un": W, "t.done": W, approvals: W, "p.in": W, "p.my": W, "p.done": W,
  },
};

const NOTIFS = [
  ["ann.submit", "Duyuru onaya gönderildi", { to_req: true, to_appr: true }],
  ["ann.approve", "Duyuru onaylandı ve yayınlandı", { to_req: true, to_insp: true, to_all: true }],
  ["ann.reject", "Duyuru reddedildi", { to_req: true, to_mgr: true }],
  ["ann.delreq", "Duyuru silme talebi açıldı", { to_req: true, to_appr: true }],
  ["ann.delete.done", "Duyuru kaldırıldı", { to_req: true, to_mgr: true, to_insp: true }],
  ["doc.submit", "Doküman Teftiş onayına gönderildi", { to_req: true, to_insp: true }],
  ["doc.approve", "Doküman onaylandı ve yayınlandı", { to_req: true, to_insp: true, to_all: true }],
  ["doc.reject", "Doküman reddedildi", { to_req: true, to_mgr: true, to_insp: true }],
  ["doc.delreq", "Doküman kaldırma talebi açıldı", { to_req: true, to_mgr: true, to_insp: true }],
  ["doc.deleted", "Doküman kaldırıldı", { to_req: true, to_mgr: true, to_insp: true }],
  ["read.remind", "Zorunlu okuma hatırlatması", { to_req: true }],
  ["read.overdue", "Zorunlu okuma süresi aşıldı", { to_req: true, to_mgr: true, to_insp: true }],
  ["report.submit", "Rapor yayın onayına gönderildi", { to_req: true, to_insp: true }],
  ["report.approve", "Rapor yayına alındı", { to_req: true, to_mgr: true, to_insp: true }],
  ["report.retire", "Rapor emekliye alındı", { to_req: true, to_insp: true }],
];

const UNITS = [
  ["KNL", "Kanal Yönetimi"], ["RSK", "Kurumsal Risk"],
  ["BT", "Bilgi Teknolojileri"], ["TFT", "Teftiş Kurulu"], ["UYM", "Uyum ve İç Kontrol"],
  ["OPR", "Operasyon ve Takas"], ["PRT", "Portföy Yönetimi"], ["ARC", "Aracılık Hizmetleri"],
];
const TITLES = [
  ["GMY", "Genel Müdür Yardımcısı", "gmy"], ["GDIR", "Grup Direktörü", "director"],
  ["PYD", "Proje Yönetim Direktörü", "director"], ["DIR", "Direktör", "director"],
  ["MDR", "Müdür", "manager"], ["KUZ", "Kıdemli Uzman", "specialist"], ["UZM", "Uzman", "specialist"],
];
const SHORTCUTS = [
  ["İK Portalı", "https://ik.tera.local"], ["Makas", "https://makas.tera.local"],
  ["eBA", "https://eba.tera.local"], ["TRA Portal", "https://tra.tera.local"],
  ["Connect", "https://connect.tera.local"], ["CRM", "https://crm.tera.local"],
];

async function seed() {
  for (const [key, label] of ROLES)
    await db.query("INSERT INTO roles (key,label) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label", [key, label]);

  for (const role of Object.keys(PERMS))
    for (const [screen, level] of Object.entries(PERMS[role]))
      await db.query(
        `INSERT INTO role_permissions (role_key, screen_key, level) VALUES ($1,$2,$3)
         ON CONFLICT (role_key, screen_key) DO UPDATE SET level=EXCLUDED.level`, [role, screen, level]);

  for (const [key, label, to] of NOTIFS)
    await db.query(
      `INSERT INTO notification_defs (event_key,label,to_req,to_mgr,to_appr,to_insp,to_all)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_key) DO NOTHING`,
      [key, label, !!to.to_req, !!to.to_mgr, !!to.to_appr, !!to.to_insp, !!to.to_all]);

  for (const [code, name] of UNITS)
    await db.query("INSERT INTO units (code,name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING", [code, name]);
  for (const [code, name, sen] of TITLES)
    await db.query("INSERT INTO titles (code,name,seniority) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING", [code, name, sen]);
  for (const [i, [name, url]] of SHORTCUTS.entries())
    await db.query("INSERT INTO shortcuts (name,url,sort) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [name, url, i]);

  /* Varsayılan olarak yalnızca Admin Panel ve Proje Yönetimi açıktır.
     Diğer modüller "kapali" gelir; kuruma göre Admin Panel > Ekran yönetimi'nden açılır.
     Var olan kurulumlarda mevcut durumlar korunur (ON CONFLICT DO NOTHING). */
  const OPEN_BY_DEFAULT = new Set([
    "admin", ...access.SCREENS.admin.map(([k]) => k),
    "delivery", ...access.SCREENS.delivery.map(([k]) => k),
    "shortcuts", ...access.SCREENS.shortcuts.map(([k]) => k),
  ]);
  const all = [...access.MODULES.map((m) => m.key),
               ...Object.values(access.SCREENS).flat().map(([k]) => k)];
  let opened = 0, closed = 0;
  for (const k of all) {
    const state = OPEN_BY_DEFAULT.has(k) ? "acik" : "kapali";
    if (state === "acik") opened++; else closed++;
    await db.query(
      "INSERT INTO screen_state (screen_key,state,changed_by) VALUES ($1,$2,'kurulum') ON CONFLICT (screen_key) DO NOTHING",
      [k, state]);
  }

  console.log(`Başlangıç verisi yüklendi: ${ROLES.length} rol, ${NOTIFS.length} bildirim tanımı, ${all.length} ekran.`);
  console.log(`Varsayılan durum: ${opened} ekran açık (Proje Yönetimi, Admin Panel, Kısayollar), ${closed} ekran kapalı.`);
  console.log("Diğer modülleri Admin Panel > Ekran yönetimi ekranından açabilirsiniz.");
}

if (require.main === module) {
  const { load } = require("../config");
  const cfg = load();
  require("../lib/audit").setKey(cfg);
  /* Başlangıç verisi de şema sahibiyle yüklenir (tanımlıysa). */
  db.init(cfg.MIGRATION_DB_USER
    ? { ...cfg, DB_USER: cfg.MIGRATION_DB_USER, DB_PASSWORD: cfg.MIGRATION_DB_PASSWORD || cfg.DB_PASSWORD }
    : cfg);
  seed().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
module.exports = { seed, ROLES, PERMS, NOTIFS, UNITS, TITLES };
