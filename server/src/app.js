"use strict";
const express = require("express");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const path = require("path");
const pinoHttp = require("pino-http");
const pino = require("pino");
const { z } = require("zod");

const db = require("./lib/db");
const audit = require("./lib/audit");
const access = require("./services/access");
const ldap = require("./services/ldap");
const sec = require("./middleware/security");
const authmw = require("./middleware/auth");
const errors = require("./middleware/errors");

function build(cfg, deps = {}) {
  audit.setKey(cfg);   /* denetim zinciri imza anahtarı */
  const logger = deps.logger || pino({
    level: cfg.NODE_ENV === "production" ? "info" : "debug",
    redact: {
      paths: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-csrf-token']",
              "req.remoteAddress", "req.remotePort", "*.password", "*.parola", "*.authPass", "*.auth_pass_enc"],
      remove: true,
    },
  });
  const dirconfig = require("./lib/dirconfig");
  const authenticate = deps.authenticate
    || (async (u, p) => ldap.authenticate(u, p, await dirconfig.effective(cfg)));

  const app = express();
  app.disable("x-powered-by");
  if (cfg.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));
  app.use(compression());
  app.use(...sec.headers(cfg));
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));
  app.use(cookieParser());

  const csrf = sec.csrf(cfg);
  app.use(csrf.issue);
  app.use(authmw.attach(cfg));

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  /* ---------------- kimlik ---------------- */
  const api = express.Router();
  api.use(sec.apiLimiter());

  api.post("/auth/login", sec.loginLimiter(cfg), async (req, res, next) => {
    try {
      const v = z.object({
        username: z.string().trim().min(2).max(64),
        password: z.string().min(1).max(256),
      }).parse(req.body);
      const username = v.username.toLowerCase().replace(/^tera\\/i, "");
      const started = Date.now();
      /* Yanıt süresi sabitlenir: hesabın var olup olmadığı süre farkından anlaşılmasın. */
      const settle = async () => {
        const wait = 400 - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      };

      const dbUser = await db.one("SELECT * FROM users WHERE username=$1", [username]);

      /* Hesap bazlı kilit: art arda hatalı denemede hesap geçici olarak kilitlenir. */
      if (dbUser && dbUser.locked_until && new Date(dbUser.locked_until) > new Date()) {
        await audit.record("giris.kilitli_hesap", username, { ok: false, detail: { ip: req.ip } });
        await settle();
        return res.status(429).json({ error: "Hesap geçici olarak kilitli. Bir süre sonra yeniden deneyin." });
      }

      let result = null;
      try { result = await authenticate(username, v.password); }
      catch (e) { logger.warn({ err: e.message }, "dizin doğrulaması başarısız"); }

      const success = !!(result && dbUser && dbUser.active);
      await db.query("INSERT INTO login_attempts (username, ip, ok) VALUES ($1,$2,$3)",
        [username, req.ip || "", success]);

      /* Hesap yok / pasif / parola hatalı — hepsinde aynı mesaj, aynı süre. */
      if (!success) {
        if (dbUser) {
          const recent = await db.one(
            `SELECT COUNT(*)::int AS n FROM login_attempts
              WHERE username = $1 AND ok = FALSE AND at > now() - INTERVAL '15 minutes'`, [username]);
          if (recent && recent.n >= cfg.LOGIN_MAX_ATTEMPTS) {
            await db.query("UPDATE users SET locked_until = now() + INTERVAL '15 minutes' WHERE username = $1", [username]);
            await audit.record("giris.hesap_kilitlendi", username, { ok: false, detail: { deneme: recent.n } });
          }
        }
        await audit.record("giris.basarisiz", username, { ok: false, detail: { ip: req.ip } });
        await settle();
        return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı" });
      }
      await db.query("UPDATE users SET locked_until = NULL WHERE username = $1", [username]);
      const sid = await authmw.createSession(username, req, cfg);
      res.cookie(cfg.SESSION_COOKIE, sid, authmw.cookieOptions(cfg));
      await audit.record("giris.basarili", username, { detail: { ip: req.ip } });
      res.json({ ok: true, csrfToken: req.csrfToken });
    } catch (e) { next(e); }
  });

  api.post("/auth/logout", csrf.verify, authmw.requireAuth, async (req, res) => {
    await authmw.destroySession(req.sessionId);
    res.clearCookie(cfg.SESSION_COOKIE, authmw.cookieOptions(cfg));
    /* Tarayıcıdaki oturum kalıntıları da temizlenir. */
    res.setHeader("Clear-Site-Data", '"cache", "cookies", "storage"');
    await audit.record("cikis", req.user.username, {});
    res.json({ ok: true });
  });

  /* Menü sunucudan gelir: yetkisi olmayan veya kapalı ekran istemciye hiç gönderilmez. */
  api.get("/me", authmw.requireAuth, async (req, res) => {
    const ctx = req.access;
    const modules = access.MODULES
      .filter((m) => access.visible(ctx, m.key))
      .map((m) => ({
        key: m.key, label: m.label, state: access.stateOf(ctx.states, m.key),
        screens: (access.SCREENS[m.key] || [])
          .filter(([k]) => access.visible(ctx, k))
          .map(([k, label]) => ({ key: k, label, level: access.level(ctx, k), state: access.stateOf(ctx.states, k) })),
      }));
    res.json({
      user: {
        username: req.user.username, displayName: req.user.display_name,
        unit: req.user.unit_code, title: req.user.title_code, manager: req.user.manager,
      },
      modules,
      csrfToken: req.csrfToken,
      settings: { secondsPerPage: cfg.READING_SECONDS_PER_PAGE, passScore: cfg.QUIZ_PASS_SCORE },
      overdueReadings: await require("./lib/training").overdueOf(req.user.username),
    });
  });

  api.use(csrf.verify);
  api.use(authmw.requireAuth);
  api.use(sec.writeLimiter());
  /* Süresi geçmiş zorunlu okuması olan kullanıcı yalnızca okuma ve sınav uçlarını kullanabilir. */
  api.use(authmw.readingGate(cfg));

  api.use("/announcements", require("./routes/announcements")(cfg));
  api.use("/documents", require("./routes/documents")(cfg));
  api.use("/training", require("./routes/training")(cfg));
  /* Marka ve metinler: okuma oturum açmış herkese, yazma yalnızca Admin'e. */
  api.get("/brand", authmw.requireAuth, async (req, res, next) => {
    try {
      const r = await db.one("SELECT * FROM brand_settings WHERE id = 1");
      const brand = {};
      if (r) {
        const map = { company: "company", company_short: "companyShort", product: "product",
          product_mark: "productMark", slogan: "slogan", login_title: "loginTitle",
          login_hint: "loginHint", footer: "footer", signature: "signature", accent: "accent" };
        for (const [col, key] of Object.entries(map)) if (r[col]) brand[key] = r[col];
      }
      res.json({ brand });
    } catch (e) { next(e); }
  });

  api.use("/projects", require("./routes/projects")(cfg));
  api.use("/gates", require("./routes/gates")(cfg));
  api.use("/reports", require("./routes/reports")(cfg));
  api.use("/approvals", require("./routes/approvals")(cfg));
  api.use("/compliance", require("./routes/compliance")(cfg));
  api.use("/admin", require("./routes/admin")(cfg));

  api.get("/shortcuts", async (req, res) => {
    res.json({ items: await db.many("SELECT id, name, url FROM shortcuts WHERE active ORDER BY sort, id") });
  });

  app.use("/api", api);

  /* İstemci dosyaları — dizin listeleme kapalı, yalnızca statik varlıklar */
  app.use(express.static(path.join(__dirname, "../../client"), {
    index: "index.html", dotfiles: "deny", redirect: false, maxAge: "5m",
  }));

  app.use(errors.notFound);
  app.use(errors.handler(logger));
  return app;
}
module.exports = { build };
