"use strict";
// Bu modul artik iki katmanlidir:
//  1) DEFAULT_ACCESS - ilk kurulumda seed edilen ve "varsayilana dondur" ile
//     geri donulen sabit matris (prototipteki ACC ile birebir).
//  2) role_access tablosu - Admin Panel > Ekran yetkileri (m.access) buradan
//     okur/yazar; gercek yetki kontrolu DE buradan yapilir (statik JS'ten degil).
// screen_availability tablosu ise rolden bagimsiz genel acik/bakimda/kapali
// anahtaridir (Admin Panel > Ekran yonetimi, m.avail).

const { query } = require("../db");

const DEFAULT_ACCESS = {
  admin: {
    announcements: "read", training: "read",
    "d.team": "read", "d.docs": "read", "d.docview": "read", "d.appr": "read", "d.cr": "read",
    "d.meeting": "read", "d.meetingview": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
    "m.users": "write", "m.units": "write", "m.dir": "write", "m.smtp": "write", "m.brand": "write", "m.mailtpl": "write", "m.settings": "write", "m.approvalrules": "write",
    "m.avail": "write", "m.access": "write",
  },
  pmdir: {
    announcements: "read", training: "read",
    "d.team": "write", "d.docs": "write", "d.docview": "write", "d.appr": "write", "d.cr": "write",
    "d.meeting": "write", "d.meetingview": "write", "d.gantt": "write", "d.board": "write", "d.gate": "write",
    "m.users": "read", "m.dir": "read", "m.smtp": "read", "m.brand": "read",
    "m.avail": "read", "m.access": "read",
  },
  // KURAL: Teftiş/İç Kontrol/IT İç Kontrol, kendi görev alanlarının (yukarıdaki
  // "write" ekranlar) DIŞINDA kalan HER ekranı da GÖREBİLMELİDİR (read) — yani
  // örn. Proje Yönetimi'ndeki tüm menüler bu roller için açıktır, yalnızca
  // değişiklik yapamazlar. Bu, admin/pmdir rollerinde zaten uygulanan aynı
  // "kendi alanı yaz, gerisini oku" modelidir.
  inspection: {
    announcements: "write", training: "write",
    "d.docs": "read", "d.docview": "read", "d.appr": "read",
    "d.meeting": "read", "d.meetingview": "read", "c.audit": "read",
    "d.team": "read", "d.cr": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
    "m.users": "read", "m.units": "read", "m.dir": "read", "m.smtp": "read", "m.brand": "read",
    "m.mailtpl": "read", "m.settings": "read", "m.approvalrules": "read", "m.avail": "read", "m.access": "read",
  },
  infosec: {
    announcements: "write", training: "read",
    "d.docs": "read", "d.docview": "read",
    "d.meeting": "read", "d.meetingview": "read",
    "d.team": "read", "d.appr": "read", "d.cr": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read", "c.audit": "read",
    "m.users": "read", "m.units": "read", "m.dir": "read", "m.smtp": "read", "m.brand": "read",
    "m.mailtpl": "read", "m.settings": "read", "m.approvalrules": "read", "m.avail": "read", "m.access": "read",
  },
  control: {
    announcements: "write", training: "read",
    "d.docs": "read", "d.docview": "read", "d.appr": "read",
    "d.meeting": "read", "d.meetingview": "read", "c.audit": "read",
    "d.team": "read", "d.cr": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
    "m.users": "read", "m.units": "read", "m.dir": "read", "m.smtp": "read", "m.brand": "read",
    "m.mailtpl": "read", "m.settings": "read", "m.approvalrules": "read", "m.avail": "read", "m.access": "read",
  },
  gmy: {
    announcements: "read", training: "read",
    "d.meeting": "read", "d.meetingview": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
  },
  opsdir: {
    announcements: "read", training: "read",
    "d.meeting": "read", "d.meetingview": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
  },
  pm: {
    announcements: "read", training: "read",
    "d.team": "write", "d.docs": "write", "d.docview": "write", "d.appr": "read", "d.cr": "write",
    "d.meeting": "write", "d.meetingview": "write", "d.gantt": "write", "d.board": "write", "d.gate": "write",
  },
  dev: {
    announcements: "read", training: "read",
    "d.docs": "read", "d.docview": "read", "d.cr": "read",
    "d.meeting": "read", "d.meetingview": "read", "d.gantt": "read", "d.board": "write", "d.gate": "read",
  },
  staff: {
    announcements: "read", training: "read",
    "d.docs": "read", "d.docview": "read",
    "d.meeting": "read", "d.meetingview": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
  },
  // CEO: organizasyonun tepesi. Genel görünürlük (okuma) geniştir; admin panel
  // yazma yetkisi YOKTUR (admin işlemleri zaten kendi yöneticisine gitmez çünkü
  // CEO'nun üstünde kimse yok — bu rol admin panelini hiç kullanmaz).
  ceo: {
    announcements: "read", training: "read",
    "d.team": "read", "d.docs": "read", "d.docview": "read", "d.appr": "read", "d.cr": "read",
    "d.meeting": "read", "d.meetingview": "read", "d.gantt": "read", "d.board": "read", "d.gate": "read",
    "c.audit": "read",
  },
};

const MEETING_ALWAYS_ROLES = ["inspection", "infosec", "control"];

let cache = null;
let cacheAt = 0;
async function loadAccess() {
  const now = Date.now();
  if (cache && now - cacheAt < 5000) return cache;
  const { rows } = await query("SELECT role, screen_key, level FROM role_access");
  const map = {};
  for (const r of rows) {
    map[r.role] = map[r.role] || {};
    map[r.role][r.screen_key] = r.level;
  }
  cache = map;
  cacheAt = now;
  return map;
}
function invalidateCache() {
  cache = null;
}

async function levelOf(role, screenKey) {
  const access = await loadAccess();
  return (access[role] || {})[screenKey] || "none";
}

async function canRead(role, screenKey) {
  const [level, avail] = await Promise.all([levelOf(role, screenKey), getAvailability(screenKey)]);
  if (avail === "kapali") return false;
  if (avail === "bakim" && role !== "admin") return false;
  return level !== "none";
}

async function canWrite(role, screenKey) {
  const [level, avail] = await Promise.all([levelOf(role, screenKey), getAvailability(screenKey)]);
  if (avail === "kapali") return false;
  if (avail === "bakim" && role !== "admin") return false;
  return level === "write";
}

// Proje yönetimi modülünün (d.* + üst modül anahtarı "delivery") yetki
// DEĞERLERİ değişmez — mevcut role_access kayıtları (ilk kurulumda
// DEFAULT_ACCESS'ten seed edilmiştir) gerçek erişim kontrolünde
// kullanılmaya devam eder; yalnızca bu değerlerin Admin Panel üzerinden
// DEĞİŞTİRİLMESİ engellenir. Böylece mevcut roller (CEO, Geliştirici,
// Personel vb.) için bugüne kadarki gerçek erişim davranışında hiçbir
// regresyon oluşmaz — yalnızca admin'in bunu Admin Panel'den değiştirme
// YOLU kapanır (server/src/routes/admin.js:isLockedAccessKey ile aynı kural).
const isProjectModuleKey = (key) => key === "delivery" || key.startsWith("d.");

async function setAccess(role, screenKey, level) {
  if (isProjectModuleKey(screenKey)) {
    throw new Error("Proje yönetimi modülünün yetkileri Admin Panel üzerinden değiştirilemez; sabittir.");
  }
  if (level === "none") {
    await query("DELETE FROM role_access WHERE role=$1 AND screen_key=$2", [role, screenKey]);
  } else {
    await query(
      "INSERT INTO role_access (role, screen_key, level) VALUES ($1,$2,$3) ON CONFLICT (role, screen_key) DO UPDATE SET level=$3",
      [role, screenKey, level]
    );
  }
  invalidateCache();
}

async function resetAccessToDefault() {
  await query("DELETE FROM role_access");
  for (const [role, screens] of Object.entries(DEFAULT_ACCESS)) {
    for (const [screenKey, level] of Object.entries(screens)) {
      await query("INSERT INTO role_access (role, screen_key, level) VALUES ($1,$2,$3)", [role, screenKey, level]);
    }
  }
  invalidateCache();
}

// Admin Panel > Ekran yetkileri (m.access) ekranının okuduğu harita: proje
// yönetimi modülü buradan TAMAMEN çıkarılır — DEĞERLERİ gerçek erişim
// kontrolünde aynen kullanılmaya devam etse de, bu ekranda hiç GÖRÜNMEZ ve
// dolayısıyla değiştirilemez.
async function getAllAccess() {
  const access = await loadAccess();
  const merged = {};
  for (const [role, screens] of Object.entries(access)) {
    merged[role] = {};
    for (const [key, level] of Object.entries(screens)) {
      if (!isProjectModuleKey(key)) merged[role][key] = level;
    }
  }
  return merged;
}

let availCache = null;
let availCacheAt = 0;
async function loadAvailability() {
  const now = Date.now();
  if (availCache && now - availCacheAt < 5000) return availCache;
  const { rows } = await query("SELECT screen_key, status FROM screen_availability");
  const map = {};
  rows.forEach((r) => { map[r.screen_key] = r.status; });
  availCache = map;
  availCacheAt = now;
  return map;
}
async function getAvailability(screenKey) {
  const map = await loadAvailability();
  return map[screenKey] || "acik";
}
async function setAvailability(screenKey, status) {
  if (!["acik", "bakim", "kapali"].includes(status)) throw new Error("Gecersiz durum.");
  await query(
    "INSERT INTO screen_availability (screen_key, status) VALUES ($1,$2) ON CONFLICT (screen_key) DO UPDATE SET status=$2",
    [screenKey, status]
  );
  availCache = null;
}
async function getAllAvailability() {
  return loadAvailability();
}

module.exports = {
  DEFAULT_ACCESS,
  MEETING_ALWAYS_ROLES,
  levelOf,
  canRead,
  canWrite,
  setAccess,
  resetAccessToDefault,
  getAllAccess,
  getAvailability,
  setAvailability,
  getAllAvailability,
};
