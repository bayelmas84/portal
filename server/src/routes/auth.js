"use strict";
const express = require("express");
const { query } = require("../db");
const { config } = require("../config");
const { requireAuth } = require("../middleware/auth");
const { createSession, destroySession, completeTwoFactor, completeTwoFactorSetup } = require("../auth/session");
const { verifyAgainstDirectory } = require("../auth/ldap");
const { audit } = require("../lib/audit");
const { encryptSecret, decryptSecret } = require("../lib/crypto");
const { generateSecret, verifyToken, otpauthUri } = require("../lib/totp");
const { sendMail } = require("../lib/mailer");

const router = express.Router();

function setSessionCookie(res, session) {
  res.cookie(config.session.cookieName, session.id, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    expires: session.absoluteExpiresAt,
  });
}

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Kullanıcı adı gerekli." });
    }
    const uname = username.trim().toLowerCase();
    const { rows } = await query("SELECT * FROM users WHERE username=$1 AND active", [uname]);
    const user = rows[0];
    if (!user) {
      await audit(`Başarısız giriş denemesi: ${uname}`, uname, false);
      return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
    }

    if (config.authMode === "ldap") {
      if (!password) return res.status(400).json({ error: "Parola gerekli." });
      let ok;
      try {
        ok = await verifyAgainstDirectory(uname, password);
      } catch (e) {
        return res.status(503).json({ error: "Dizin sunucusuna ulaşılamadı: " + e.message });
      }
      if (!ok) {
        await audit(`Başarısız giriş denemesi: ${uname}`, uname, false);
        return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
      }
    }
    // authMode === 'mock': yalnızca geliştirme/test — kullanıcı adı yeterli.
    // config.js, NODE_ENV=production'da AUTH_MODE!=ldap olduğunda uyarı basar.

    if (user.totp_enabled) {
      const session = await createSession(uname, true, false);
      setSessionCookie(res, session);
      await audit(`Giriş (1/2 — şifre doğrulandı, 2FA kodu bekleniyor): ${uname}`, uname, true);
      return res.json({ needsTwoFactor: true, method: user.totp_method });
    }

    // KURAL (kullanıcı isteği): admin ve Teftiş için 2FA ZORUNLUDUR. Henüz
    // kurulmadıysa oturum "kurulum bekliyor" durumunda açılır — kullanıcı
    // 2FA'yı etkinleştirene kadar başka hiçbir işlem yapamaz.
    const policyRow = await query("SELECT required FROM two_factor_policy WHERE role=$1", [user.role]);
    const mandatory = !!(policyRow.rows[0] && policyRow.rows[0].required);
    if (mandatory) {
      const session = await createSession(uname, false, true);
      setSessionCookie(res, session);
      await audit(`Giriş — 2FA kurulumu zorunlu, henüz yapılmamış: ${uname}`, uname, true);
      return res.json({ mustSetupTwoFactor: true });
    }

    const session = await createSession(uname, false, false);
    setSessionCookie(res, session);
    await audit(`Giriş yapıldı: ${uname}`, uname, true);
    res.json({
      user: {
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        unit: user.unit,
        title: user.title,
        color: user.color,
        managerUsername: user.manager_username,
      },
      csrfToken: session.csrfSecret,
    });
  } catch (e) {
    next(e);
  }
});

// 2FA'nın alternatif yöntemi: authenticator app yerine, bekleyen oturuma bağlı
// olarak kullanıcının kayıtlı e-postasına 6 haneli, 5 dakika geçerli tek
// kullanımlık bir kod gönderir.
router.post("/2fa/send-email-code", async (req, res, next) => {
  try {
    if (!req.session || !req.session.pending_2fa) {
      return res.status(400).json({ error: "Doğrulanacak bekleyen bir 2FA oturumu yok." });
    }
    const { rows } = await query("SELECT username, email FROM users WHERE username=$1", [req.session.username]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await query(
      "UPDATE sessions SET email_otp_code=$1, email_otp_expires_at=now() + interval '5 minutes' WHERE id=$2",
      [code, req.session.id]
    );
    const sent = await sendMail(user.email, "Tera Portal — giriş doğrulama kodu",
      `Merhaba, giriş doğrulama kodunuz: ${code}\nBu kod 5 dakika geçerlidir. Bu isteği siz yapmadıysanız şifrenizi değiştirin.`);
    await audit(`2FA e-posta kodu gönderildi: ${user.username} (${sent ? "başarılı" : "SMTP kapalı"})`, user.username, sent);
    res.json({ ok: true, sent });
  } catch (e) { next(e); }
});

// 2. adım: şifre doğrulandıktan sonra bekleyen oturuma karşı 6 haneli TOTP
// kodunu doğrular. req.user burada HENÜZ set değildir (attachUser, pending_2fa
// oturumları için req.user=null yapar) — bu yüzden req.session üzerinden gideriz.
router.post("/2fa/verify", async (req, res, next) => {
  try {
    if (!req.session || !req.session.pending_2fa) {
      return res.status(400).json({ error: "Doğrulanacak bekleyen bir 2FA oturumu yok." });
    }
    const { code } = req.body || {};
    const { rows } = await query("SELECT * FROM users WHERE username=$1 AND active", [req.session.username]);
    const user = rows[0];
    if (!user || !user.totp_enabled) {
      return res.status(409).json({ error: "Bu hesapta 2FA etkin değil." });
    }
    // Kod, ya authenticator app'ten (TOTP) ya da e-postaya gönderilen tek
    // kullanımlık koddan (varsa ve süresi geçmemişse) gelebilir.
    let ok = false;
    if (user.totp_secret_encrypted && verifyToken(decryptSecret(user.totp_secret_encrypted), code)) ok = true;
    if (!ok && req.session.email_otp_code && req.session.email_otp_code === String(code || "") &&
        req.session.email_otp_expires_at && new Date(req.session.email_otp_expires_at) > new Date()) {
      ok = true;
      await query("UPDATE sessions SET email_otp_code=NULL, email_otp_expires_at=NULL WHERE id=$1", [req.session.id]);
    }
    if (!ok) {
      await audit(`2FA kodu hatalı: ${user.username}`, user.username, false);
      return res.status(401).json({ error: "Kod hatalı veya süresi geçmiş." });
    }
    await completeTwoFactor(req.session.id);
    await audit(`Giriş tamamlandı (2/2 — 2FA doğrulandı): ${user.username}`, user.username, true);
    res.json({
      user: {
        username: user.username, name: user.name, email: user.email, role: user.role,
        unit: user.unit, title: user.title, color: user.color, managerUsername: user.manager_username,
      },
      csrfToken: req.session.csrf_secret,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const sid = req.cookies[config.session.cookieName];
    if (sid) await destroySession(sid);
    res.clearCookie(config.session.cookieName, { path: "/" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Oturum açık değil." });
  res.json({ user: req.user, csrfToken: req.session.csrf_secret });
});

// Kendi rolünüzün ekran yetki haritası: arayüzün hangi düğmeleri göstereceğine
// karar verebilmesi için gerekir (m.access ile ilgisi yok, m.access yetkisi
// gerektirmez — herkes yalnızca KENDİ rolünün haritasını görür).
// ------------------------------- 2FA kurulumu --------------------------------
// Herkes kendi hesabı için açabilir/kapatabilir (admin onayı GEREKMEZ — kendi
// güvenliğinizi güçlendirmek bir admin işlemi değildir). Adım 1: setup (secret
// üret, henüz aktifleştirme), Adım 2: enable (ilk kodu doğrulayıp aktifleştir).
router.post("/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    const secret = generateSecret();
    await query("UPDATE users SET totp_secret_encrypted=$1, totp_enabled=false WHERE username=$2",
      [encryptSecret(secret), req.user.username]);
    res.json({ secret, otpauthUri: otpauthUri(secret, req.user.username, "Tera Portal") });
  } catch (e) { next(e); }
});

router.post("/2fa/enable", requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    const { rows } = await query("SELECT totp_secret_encrypted FROM users WHERE username=$1", [req.user.username]);
    const enc = rows[0] && rows[0].totp_secret_encrypted;
    if (!enc) return res.status(409).json({ error: "Önce /2fa/setup ile bir secret üretin." });
    if (!verifyToken(decryptSecret(enc), code)) return res.status(401).json({ error: "Kod hatalı veya süresi geçmiş." });
    await query("UPDATE users SET totp_enabled=true WHERE username=$1", [req.user.username]);
    await audit(`2FA etkinleştirildi: ${req.user.username}`, req.user.username, true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// KOLAY YOL (kullanıcı isteği: "authenticator zor iş"): e-posta ile 2FA
// etkinleştirme — TOTP secreti/QR gerekmez. requireAuth burada must_setup_2fa
// durumundaki kullanıcılar için de çalışır (attachUser onlar için de
// req.user'ı set eder; blockIfMustSetup2FA bu path'lere özellikle izin verir).
router.post("/2fa/enable-email/request", requireAuth, async (req, res, next) => {
  try {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await query("UPDATE sessions SET email_otp_code=$1, email_otp_expires_at=now() + interval '5 minutes' WHERE id=$2",
      [code, req.session.id]);
    const sent = await sendMail(req.user.email, "Tera Portal — 2FA etkinleştirme kodu",
      `Merhaba, 2FA etkinleştirme kodunuz: ${code}\nBu kod 5 dakika geçerlidir.`);
    res.json({ ok: true, sent });
  } catch (e) { next(e); }
});

router.post("/2fa/enable-email/confirm", requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (!req.session.email_otp_code || req.session.email_otp_code !== String(code || "") ||
        !req.session.email_otp_expires_at || new Date(req.session.email_otp_expires_at) <= new Date()) {
      return res.status(401).json({ error: "Kod hatalı veya süresi geçmiş." });
    }
    await query("UPDATE sessions SET email_otp_code=NULL, email_otp_expires_at=NULL WHERE id=$1", [req.session.id]);
    await query("UPDATE users SET totp_enabled=true, totp_method='email' WHERE username=$1", [req.user.username]);
    const wasSetupRequired = req.mustSetupTwoFactor;
    if (wasSetupRequired) await completeTwoFactorSetup(req.session.id);
    await audit(`2FA etkinleştirildi (e-posta): ${req.user.username}`, req.user.username, true);
    if (wasSetupRequired) {
      // Zorunlu kurulum tamamlandı: normal oturuma geçiş için csrfToken da döner.
      return res.json({ ok: true, user: req.user, csrfToken: req.session.csrf_secret });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/2fa/disable", requireAuth, async (req, res, next) => {
  try {
    const policyRow = await query("SELECT required FROM two_factor_policy WHERE role=$1", [req.user.role]);
    if (policyRow.rows[0] && policyRow.rows[0].required) {
      return res.status(403).json({ error: "Rolünüz için 2FA zorunludur, devre dışı bırakılamaz." });
    }
    await query("UPDATE users SET totp_enabled=false, totp_secret_encrypted=NULL WHERE username=$1", [req.user.username]);
    await audit(`2FA devre dışı bırakıldı: ${req.user.username}`, req.user.username, true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/2fa/status", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT totp_enabled, totp_method FROM users WHERE username=$1", [req.user.username]);
    const policy = await query("SELECT required FROM two_factor_policy WHERE role=$1", [req.user.role]);
    res.json({
      enabled: !!(rows[0] && rows[0].totp_enabled),
      method: rows[0] ? rows[0].totp_method : "email",
      required: !!(policy.rows[0] && policy.rows[0].required),
      recommended: !!(policy.rows[0] && policy.rows[0].required),
    });
  } catch (e) { next(e); }
});

router.get("/my-access", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Oturum açık değil." });
    const { rows } = await query("SELECT screen_key, level FROM role_access WHERE role=$1", [req.user.role]);
    const map = {};
    rows.forEach((r) => { map[r.screen_key] = r.level; });
    res.json({ role: req.user.role, access: map });
  } catch (e) { next(e); }
});

module.exports = router;
