"use strict";
/* Hash zincirli denetim kaydı: her satır bir öncekinin hash'ini içerir.
   Satır değiştirilir veya silinirse zincir doğrulaması bozulur. */
const crypto = require("crypto");
const db = require("./db");

const GENESIS = "0".repeat(64);

/* Zincir anahtarla imzalanır (HMAC-SHA256, APP_ENCRYPTION_KEY).
   Anahtarı bilmeyen biri satırı değiştirip zinciri yeniden hesaplayamaz. */
let KEY = null;
function setKey(cfg) {
  KEY = cfg && cfg.APP_ENCRYPTION_KEY ? Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64") : null;
}
const digest = (row) => {
  const payload = [row.prev_hash, row.event, row.actor, String(row.ok),
                   JSON.stringify(row.detail || null), row.at].join("|");
  return KEY
    ? crypto.createHmac("sha256", KEY).update(payload).digest("hex")
    : crypto.createHash("sha256").update(payload).digest("hex");
};

async function record(event, actor, { ok = true, detail = null } = {}) {
  const last = await db.one("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
  const at = new Date().toISOString();
  const base = { prev_hash: last ? last.hash : GENESIS, event, actor, ok, detail, at };
  const hash = digest(base);
  await db.query(
    `INSERT INTO audit_log (event, actor, ok, detail, at, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [event, actor, ok, detail ? JSON.stringify(detail) : null, at, base.prev_hash, hash]
  );
  /* Zincir başlığı ayrı tabloda: log satırları silinse bile sayaç ve son hash uyuşmaz. */
  const cp = await db.one("SELECT entry_count FROM audit_checkpoint WHERE id = 1");
  if (cp) await db.query("UPDATE audit_checkpoint SET last_hash=$1, entry_count=entry_count+1, updated_at=now() WHERE id=1", [hash]);
  else await db.query("INSERT INTO audit_checkpoint (id,last_hash,entry_count) VALUES (1,$1,1)", [hash]);
  return hash;
}

async function verify() {
  const rows = await db.many("SELECT * FROM audit_log ORDER BY id ASC");
  const cp = await db.one("SELECT last_hash, entry_count FROM audit_checkpoint WHERE id = 1");
  if (cp && Number(cp.entry_count) !== rows.length)
    return { ok: false, reason: "satır sayısı uyuşmuyor", expected: Number(cp.entry_count), count: rows.length };
  if (cp && rows.length && rows[rows.length - 1].hash !== cp.last_hash)
    return { ok: false, reason: "son hash uyuşmuyor", count: rows.length };
  let prev = GENESIS;
  for (const r of rows) {
    const at = r.at instanceof Date ? r.at.toISOString() : r.at;
    const detail = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
    const expect = digest({ prev_hash: prev, event: r.event, actor: r.actor, ok: r.ok, detail, at });
    if (r.prev_hash !== prev || r.hash !== expect)
      return { ok: false, brokenAt: Number(r.id), count: rows.length };
    prev = r.hash;
  }
  return { ok: true, count: rows.length };
}
module.exports = { record, verify, setKey, GENESIS };
