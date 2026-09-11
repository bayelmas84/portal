"use strict";
/* Testler gerçek Postgres yerine pg-mem üzerinde çalışır; SQL aynı SQL'dir. */
const fs = require("fs");
const path = require("path");
const { newDb } = require("pg-mem");
const request = require("supertest");

const ENV = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:8080",
  DB_PASSWORD: "test",
  LDAP_BIND_DN: "CN=svc,DC=tera,DC=local",
  LDAP_BIND_PASSWORD: "test",
  LDAP_URL: "ldaps://dc01.tera.local:636",
  CSRF_SECRET: "0123456789abcdef0123456789abcdef01",
  APP_ENCRYPTION_KEY: require("crypto").randomBytes(32).toString("base64"),
  UPLOAD_DIR: "/tmp/tera-portal-test-uploads",
  BI_BASE_URL: "https://prisma.tera.local",
  READING_SECONDS_PER_PAGE: "5",   // testlerde alt sınır, mantık aynıdır
  LOGIN_MAX_ATTEMPTS: "5",
  SESSION_IDLE_MIN: "30",
  SESSION_ABSOLUTE_MIN: "600",
};

/* Örnek kullanıcılar: parola doğrulaması sahte LDAP ile yapılır. */
const USERS = [
  ["elif.yalcin", "Elif Yalçın", "admin", "BT", "DIR", "deniz.okur"],
  ["kerem.aslan", "Kerem Aslan", "inspection", "TFT", "MDR", "deniz.okur"],
  ["burak.temel", "Burak Temel", "infosec", "BT", "MDR", "elif.yalcin"],
  ["gonul.aladag", "Gönül Aladağ", "control", "UYM", "MDR", "deniz.okur"],
  ["deniz.okur", "Deniz Okur", "gmy", "PRT", "GMY", null],
  ["meltem.aydin", "Meltem Aydın", "opsdir", "OPR", "DIR", "deniz.okur"],
  ["bayram.elmas", "Bayram Elmas", "pmdir", "BT", "PYD", null],
  ["tolga.firat", "Tolga Fırat", "pm", "BT", "MDR", "elif.yalcin"],
  ["mert.balkan", "Mert Balkan", "dev", "BT", "UZM", "tolga.firat"],
  ["nazli.han", "Nazlı Han", "staff", "OPR", "UZM", "meltem.aydin"],
  ["pasif.kisi", "Pasif Kişi", "staff", "OPR", "UZM", "meltem.aydin", false],
];
/* Test parolası çalışma anında üretilir; kaynakta sabit kimlik bilgisi bulunmaz. */
const PASSWORD = process.env.TEST_AUTH_SECRET || ("T-" + require("crypto").randomBytes(12).toString("base64url"));

async function boot() {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  const { load } = require("../server/src/config");
  const cfg = load();

  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({ name: "now", returns: require("pg-mem").DataType.timestamptz, implementation: () => new Date() });
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();

  const db = require("../server/src/lib/db");
  db.inject(pool);

  for (const f of ["001_init.sql", "003_mail_settings.sql", "004_bi_reports.sql", "006_projects.sql", "007_directory_settings.sql", "008_project_authority.sql", "009_brand.sql", "010_project_team.sql", "011_project_documents.sql"]) {
    await pool.query(fs.readFileSync(path.join(__dirname, "../server/migrations", f), "utf8"));
  }
  const { seed } = require("../server/src/lib/seed");
  await seed();
  /* Testler tek tek ekran açmakla uğraşmasın diye tümü açılır;
     varsayılanların doğruluğu tests/defaults.test.js içinde ayrıca sınanır. */
  if (!process.env.KEEP_DEFAULT_SCREEN_STATES)
    await pool.query("UPDATE screen_state SET state = 'acik'");

  for (const [u, name, role, unit, title, mgr, active = true] of USERS)
    await pool.query(
      `INSERT INTO users (username, display_name, role_key, unit_code, title_code, manager, active, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u, name, role, unit, title, mgr, active, `${u}@terayatirim.com.tr`]);

  /* Sahte LDAP: yalnızca doğru parolayı kabul eder, kullanıcı listesini bilmez. */
  const authenticate = async (username, password) =>
    password === PASSWORD ? { username, displayName: username, email: null } : null;

  require("../server/src/lib/audit").setKey(cfg);
  const { build } = require("../server/src/app");
  const app = build(cfg, { authenticate, logger: require("pino")({ level: "silent" }) });
  return { app, cfg, pool, db };
}

/* Oturum + CSRF taşıyan basit istemci */
function agentFor(app) {
  const agent = request.agent(app);
  let csrf = null;
  const withCsrf = (req) => (csrf ? req.set("x-csrf-token", csrf) : req);
  return {
    async login(username, password = PASSWORD) {
      const res = await agent.post("/api/auth/login").send({ username, password });
      const setCookie = res.headers["set-cookie"] || [];
      const c = setCookie.find((x) => x.startsWith("tp_csrf="));
      if (c) csrf = c.split(";")[0].split("=")[1];
      if (res.body && res.body.csrfToken) csrf = res.body.csrfToken;
      return res;
    },
    get: (url) => agent.get(url),
    post: (url) => withCsrf(agent.post(url)),
    put: (url) => withCsrf(agent.put(url)),
    del: (url) => withCsrf(agent.delete(url)),
    postNoCsrf: (url) => agent.post(url),
    raw: agent,
    get csrf() { return csrf; },
  };
}
module.exports = { boot, agentFor, USERS, PASSWORD, ENV };
