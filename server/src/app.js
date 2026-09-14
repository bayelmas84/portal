"use strict";
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { config } = require("./config");
const { securityHeaders, apiLimiter, loginLimiter, notFound, errorHandler } = require("./middleware/security");
const { attachUser, requireCsrf } = require("./middleware/auth");

function createApp() {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use("/api", apiLimiter);
  app.use("/api/auth/login", loginLimiter);
  app.use(requireCsrf);

  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/announcements", require("./routes/announcements"));
  app.use("/api/training", require("./routes/training"));
  app.use("/api/projects", require("./routes/projects"));
  app.use("/api/admin", require("./routes/admin"));
  app.use("/api/audit", require("./routes/audit"));

  app.get("/api/healthz", (req, res) => res.json({ ok: true }));

  // Arayüz (index.html) aynı origin'den servis edilir; böylece göreli /api/...
  // çağrıları ayrıca CORS/ayrı origin ayarı gerektirmeden çalışır (bkz. KURULUM.md).
  app.use(express.static(path.join(__dirname, "..", ".."), { index: "index.html" }));

  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
