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

  // GÜVENLİK: Yalnızca index.html servis edilir — TÜM proje kök dizinini
  // (express.static ile) açmak backend kaynak kodunu, package.json'ı ve
  // benzeri dosyaları HTTP üzerinden okunabilir hale getirirdi (test edildi
  // ve doğrulandı: eski haliyle /server/src/config.js 200 ile dönüyordu).
  // Arayüz tamamen index.html içine gömülü olduğu için başka statik dosya yok.
  const indexPath = path.join(__dirname, "..", "..", "index.html");
  app.get("/", (req, res) => res.sendFile(indexPath));

  app.use("/api", notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
