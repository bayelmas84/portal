"use strict";
/* Veri erişimi. Kural: SQL metnine hiçbir kullanıcı girdisi eklenmez; yalnızca $1,$2 parametreleri kullanılır. */
const { Pool } = require("pg");

let pool = null;
let injected = null; // testlerde pg-mem enjekte edilir

function init(cfg) {
  if (injected) return injected;
  pool = new Pool({
    host: cfg.DB_HOST, port: cfg.DB_PORT, database: cfg.DB_NAME,
    user: cfg.DB_USER, password: cfg.DB_PASSWORD,
    ssl: cfg.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
    application_name: "tera-portal",
  });
  return pool;
}
function inject(fake) { injected = fake; }
function client() {
  const c = injected || pool;
  if (!c) throw new Error("Veritabanı başlatılmadı");
  return c;
}
async function query(text, params = []) {
  if (/\$\{|--|;\s*\w/.test(text) && !/^\s*(--|\/\*)/.test(text)) {
    // birleştirilmiş sorgu veya satır içi yorum şüphesi
    if (text.split(";").filter((s) => s.trim()).length > 1)
      throw new Error("Birden fazla ifade içeren sorgu reddedildi");
  }
  return client().query(text, params);
}
const one = async (t, p) => (await query(t, p)).rows[0] || null;
const many = async (t, p) => (await query(t, p)).rows;
async function tx(fn) {
  const c = injected ? injected : await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch (_) {}
    throw e;
  } finally {
    if (!injected && c.release) c.release();
  }
}
module.exports = { init, inject, query, one, many, tx, client };
