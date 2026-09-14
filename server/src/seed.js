"use strict";
const { pool, query } = require("./db");
const { DEFAULT_ACCESS } = require("./lib/permissions");

const UNITS = [
  ["BT", "Bilgi Teknolojileri", "elif.yalcin"], ["TFT", "Teftiş Kurulu", "kerem.aslan"],
  ["UYM", "Uyum ve İç Kontrol", "gonul.aladag"], ["OPR", "Operasyon ve Takas", "meltem.aydin"],
  ["PRT", "Portföy Yönetimi", "deniz.okur"], ["KNL", "Kanal Yönetimi", "deniz.okur"],
  ["RSK", "Kurumsal Risk", "leyla.varol"],
];
const TITLES = [
  ["CEO", "Genel Müdür"], ["GMY", "Genel Müdür Yardımcısı"], ["GDIR", "Grup Direktörü"],
  ["PYD", "Proje Yönetim Direktörü"],
  ["DIR", "Direktör"], ["MDR", "Müdür"], ["UZM", "Uzman"], ["SYS", "Sistem Hesabı"],
];
const USERS = [
  ["belmas", "Belmas (Sistem Hesabı)", "belmas", null, "SYS", null, "#4A4A4A"],
  ["ahmet.tera", "Ahmet Tera", "ceo", "PRT", "CEO", null, "#0B1F48"],
  ["melis.suri", "Melis Suri", "staff", "KNL", "MDR", "deniz.okur", "#8A5A2B"],
  ["leyla.varol", "Leyla Varol", "control", "RSK", "GDIR", "ahmet.tera", "#5B2E8C"],
  ["elif.yalcin", "Elif Yalçın", "admin", "BT", "DIR", "deniz.okur", "#A3121C"],
  ["kerem.aslan", "Kerem Aslan", "inspection", "TFT", "MDR", "deniz.okur", "#7A1F3D"],
  ["seda.tunc", "Seda Tunç", "inspection", "TFT", "UZM", "kerem.aslan", "#5A1F3D"],
  ["burak.temel", "Burak Temel", "infosec", "BT", "MDR", "elif.yalcin", "#0178BA"],
  ["gonul.aladag", "Gönül Aladağ", "control", "UYM", "MDR", "deniz.okur", "#8E0D4D"],
  ["deniz.okur", "Deniz Okur", "gmy", "PRT", "GMY", "ahmet.tera", "#4B3B8F"],
  ["meltem.aydin", "Meltem Aydın", "opsdir", "OPR", "DIR", "deniz.okur", "#854F0B"],
  ["tolga.firat", "Tolga Fırat", "pm", "BT", "MDR", "elif.yalcin", "#0B1F48"],
  ["mert.balkan", "Mert Balkan", "dev", "BT", "UZM", "tolga.firat", "#33405C"],
  ["bayram.elmas", "Bayram Elmas", "pmdir", "BT", "PYD", "deniz.okur", "#0F6E56"],
  ["nazli.han", "Nazlı Han", "staff", "OPR", "UZM", "meltem.aydin", "#5F6B85"],
];

async function seed() {
  for (const [code, name] of UNITS) {
    await query("INSERT INTO units (code,name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING", [code, name]);
  }
  for (const [code, name] of TITLES) {
    await query("INSERT INTO titles (code,name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING", [code, name]);
  }
  for (const [username, name, role, unit, title] of USERS) {
    await query(
      `INSERT INTO users (username,name,email,role,unit,title,color)
       VALUES ($1,$2,$3,$4,$5,$6,'#0B1F48') ON CONFLICT (username) DO NOTHING`,
      [username, name, username.replace(".", ".") + "@terayatirim.com.tr", role, unit, title]
    );
  }
  // Yönetici ilişkisi ikinci geçişte (tüm kullanıcılar var olduktan sonra) kurulur.
  for (const [username, , , , , manager] of USERS) {
    if (manager) {
      await query("UPDATE users SET manager_username=$1 WHERE username=$2", [manager, username]);
    }
  }
  // Birim yöneticileri de kullanıcılar oluştuktan SONRA (FK ve NOT NULL için) bağlanır.
  for (const [code, , managerUsername] of UNITS) {
    await query("UPDATE units SET manager_username=$1 WHERE code=$2", [managerUsername, code]);
  }

  for (const [role, screens] of Object.entries(DEFAULT_ACCESS)) {
    for (const [screenKey, level] of Object.entries(screens)) {
      await query(
        "INSERT INTO role_access (role, screen_key, level) VALUES ($1,$2,$3) ON CONFLICT (role, screen_key) DO UPDATE SET level=$3",
        [role, screenKey, level]
      );
    }
  }

  await query(
    `INSERT INTO projects (k, name, method, lead_username, unit_name, start_date, target_date, created_by)
     VALUES ('TRADE','Mobil işlem platformu','Scrum','tolga.firat','Bilgi Teknolojileri','2026-08-01','2026-09-20','tolga.firat')
     ON CONFLICT (k) DO NOTHING`
  );
  await query(
    `INSERT INTO projects (k, name, method, lead_username, unit_name, start_date, target_date, created_by)
     VALUES ('CORE','Portföy sistemi göçü','Waterfall','tolga.firat','Bilgi Teknolojileri','2026-06-15','2026-09-15','tolga.firat')
     ON CONFLICT (k) DO NOTHING`
  );
  await query(
    `INSERT INTO projects (k, name, method, lead_username, unit_name, start_date, target_date, created_by)
     VALUES ('OPS','Platform operasyonları','Kanban','tolga.firat','Operasyon ve Takas','2026-07-01','2026-10-01','tolga.firat')
     ON CONFLICT (k) DO NOTHING`
  );

  console.log("[seed] tamamlandı: " + USERS.length + " kullanıcı, " + Object.keys(DEFAULT_ACCESS).length + " rol için erişim matrisi.");
}

if (require.main === module) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exitCode = 1; return pool.end(); });
}

module.exports = { seed };
