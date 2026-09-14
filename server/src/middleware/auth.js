"use strict";
const crypto = require("crypto");
const db = require("../lib/db");
const access = require("../services/access");

/* Oturum sunucuda tutulur. Çerez yalnızca rastgele kimlik taşır; rol/yetki bilgisi taşımaz. */
async function createSession(username, req, cfg) {
  const id = crypto.randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions (id, username, ip, user_agent) VALUES ($1,$2,$3,$4)",
    [id, username, req.ip || null, String(req.get("user-agent") || "").slice(0, 200)]
  );
  return id;
}

function cookieOptions(cfg) {
  return {
    httpOnly: true,
    secure: cfg.NODE_ENV === "production",
    sameSite: "strict",
    /* Çerez yalnızca API isteklerine eklenir; statik dosya isteklerine gitmez. */
    path: "/api",
    maxAge: cfg.SESSION_ABSOLUTE_MIN * 60 * 1000,
  };
}

async function destroySession(id) {
  if (id) await db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
}

/* Her istekte: oturum geçerli mi, kullanıcı aktif mi, oturum zaman aşımına uğramış mı */
function attach(cfg) {
  return async function (req, res, next) {
    const sid = req.cookies ? req.cookies[cfg.SESSION_COOKIE] : null;
    if (!sid) return next();
    const row = await db.one(
      `SELECT s.id, s.username, s.created_at, s.last_seen_at, s.revoked_at,
              u.display_name, u.role_key, u.unit_code, u.title_code, u.manager, u.active, u.email
         FROM sessions s JOIN users u ON u.username = s.username
        WHERE s.id = $1`,
      [sid]
    );
    if (!row || row.revoked_at) return next();
    if (!row.active) { await destroySession(sid); return next(); }

    const now = Date.now();
    const idleMs = now - new Date(row.last_seen_at).getTime();
    const ageMs = now - new Date(row.created_at).getTime();
    if (idleMs > cfg.SESSION_IDLE_MIN * 60000 || ageMs > cfg.SESSION_ABSOLUTE_MIN * 60000) {
      await destroySession(sid);
      res.clearCookie(cfg.SESSION_COOKIE, cookieOptions(cfg));
      return next();
    }
    await db.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sid]);
    req.user = {
      username: row.username, display_name: row.display_name, role_key: row.role_key,
      unit_code: row.unit_code, title_code: row.title_code, manager: row.manager, email: row.email,
    };
    req.sessionId = sid;
    req.access = await access.context(req.user);
    next();
  };
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Oturum gerekli" });

/* Ekran bazlı yetki. Kapalı ekran 404, bakımdaki ekran 503 döner. */
function requireScreen(screenKey, mode = "read") {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Oturum gerekli" });
    const ctx = req.access;
    if (access.level(ctx, screenKey) === "none") return res.status(403).json({ error: "Yetkiniz yok" });
    const mod = access.moduleOfScreen(screenKey);
    const st = access.stateOf(ctx.states, screenKey);
    const modSt = mod ? access.stateOf(ctx.states, mod) : "acik";
    /* Kapalı bölüm gizli bir kaynak değildir: hata yerine ana sayfaya yönlendirilir. */
    if (st === "kapali" || modSt === "kapali")
      return res.status(409).json({
        error: "Bu bölüm şu anda kullanımda değil", state: "kapali", redirect: "home",
      });
    if (st === "bakim" || modSt === "bakim")
      return res.status(503).json({ error: "Bu bölüm bakımda", state: "bakim", redirect: "home" });
    if (mode === "write" && !access.canWrite(ctx, screenKey))
      return res.status(403).json({ error: "Bu işlem için yetkiniz yok" });
    next();
  };
}

const isInspection = (req) => req.user && req.user.role_key === "inspection";

/* Zorunlu okuma kilidi: süresi geçmiş okuması olan kullanıcı portalın kalanını kullanamaz.
   İzin verilen uçlar okumayı tamamlamaya yarayanlardır. */
const GATE_ALLOW = [
  /^\/training(\/|$)/, /^\/documents\/\d+$/, /^\/documents\/\d+\/file$/,
  /^\/documents\/\d+\/reading\/start$/, /^\/documents\/reading\/[a-f0-9]{32}\/(ping|ack)$/,
];
function readingGate() {
  return async function (req, res, next) {
    if (!req.user) return next();
    const overdue = await db.many(
      `SELECT doc_no FROM reading_assignments
        WHERE username = $1 AND completed_at IS NULL AND due_date < CURRENT_DATE`, [req.user.username]);
    if (!overdue.length) return next();
    if (GATE_ALLOW.some((re) => re.test(req.path))) return next();
    res.status(423).json({
      error: "Süresi geçmiş zorunlu okumanız var; tamamlanana kadar diğer bölümler kapalıdır",
      overdue: overdue.map((o) => o.doc_no),
    });
  };
}

module.exports = { createSession, destroySession, attach, requireAuth, requireScreen, cookieOptions, isInspection, readingGate };
