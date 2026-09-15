"use strict";
const express = require("express");
const { query } = require("../db");
const { config } = require("../config");
const { createSession, destroySession, completePasswordChange, destroyAllSessionsForUser } = require("../auth/session");
const { verifyAgainstDirectory } = require("../auth/ldap");
const { audit } = require("../lib/audit");
const { verifyPassword, validatePasswordPolicy, hashPassword } = require("../lib/password");
const { requireAuth } = require("../middleware/auth");

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

// directory_settings.active=true ise AD/LDAP, değilse (veya satır yoksa)
// .env'deki AUTH_MODE'a düşülür — Admin Panel > Dizin Ayarları'ndaki "AD
// kullan" anahtarı buradan okunur, DB'den dinamik; sunucu yeniden
// başlatılmasına gerek yoktur.
async function getEffectiveAuthMode() {
  try {
    const { rows } = await query("SELECT active FROM directory_settings WHERE id=1");
    if (rows.length) return rows[0].active ? "ldap" : "local";
  } catch (e) { /* tablo yoksa (eski migration) .env'e düş */ }
  return config.authMode === "ldap" ? "ldap" : "local";
}

// GÜVENLİK: Timing attack / kullanıcı numaralandırma (CWE-208). Argon2
// doğrulaması bilinçli olarak yavaştır (~100ms+); kullanıcı bulunamadığında bu
// adım hiç çalıştırılmazsa, yanıt süresi farkı bir saldırganın hangi kullanıcı
// adlarının sistemde var olduğunu ölçmesine izin verir. Kullanıcı yokken de
// AYNI SÜREYİ harcayan sahte bir doğrulama çalıştırılarak süre eşitlenir.
const DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$Y7HmGGGvJqz9F5H2xJ3vXQ5Y5W5X5V5T5S5R5Q5P5O";

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Kullanıcı adı gerekli." });
    }
    if (!password) {
      return res.status(400).json({ error: "Parola gerekli." });
    }
    const uname = username.trim().toLowerCase();
    const { rows } = await query("SELECT * FROM users WHERE username=$1 AND active", [uname]);
    const user = rows[0];
    if (!user) {
      await verifyPassword(DUMMY_HASH, password); // süre eşitleme — yukarıdaki not
      await audit(`Başarısız giriş denemesi: ${uname}`, uname, false);
      return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
    }

    const authMode = await getEffectiveAuthMode();
    if (authMode === "ldap") {
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
    } else {
      // AD kapalı: kendi (yerel) parola sistemimiz devrede — kimse şifresiz
      // giremez. Admin, kullanıcıyı oluştururken bir ilk giriş şifresi belirler;
      // parola hash'i yoksa (örn. eski/bozuk kayıt) giriş reddedilir.
      const ok = await verifyPassword(user.password_hash, password);
      if (!ok) {
        await audit(`Başarısız giriş denemesi: ${uname}`, uname, false);
        return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
      }
    }

    // must_change_password yalnızca yerel modda anlamlıdır (AD'de parola
    // politikası AD'nin kendi sorumluluğundadır).
    const forceChange = authMode === "local" && user.must_change_password;
    const session = await createSession(uname, forceChange);
    setSessionCookie(res, session);
    if (forceChange) {
      await audit(`Giriş (1/2 — parola değişikliği zorunlu): ${uname}`, uname, true);
      return res.json({ mustChangePassword: true, csrfToken: session.csrfSecret });
    }
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

// Zorunlu (ilk giriş / admin sıfırlaması sonrası) VEYA gönüllü (kullanıcı
// kendi isteğiyle) parola değişikliği — aynı uç, req.forcePasswordChange
// bayrağına göre eski parola kontrolünü atlar ya da zorunlu kılar. Kasıtlı
// olarak "şifremi unuttum" (self-service, e-posta ile sıfırlama) akışı
// YOKTUR — bunun yerine admin "şifreyi sıfırla" eylemini kullanır.
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Yeni şifre ile tekrarı eşleşmiyor." });
    }
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });

    const { rows } = await query("SELECT password_hash FROM users WHERE username=$1", [req.user.username]);
    const currentHash = rows[0] && rows[0].password_hash;

    if (!req.forcePasswordChange) {
      // Gönüllü değişiklik: mevcut şifre doğrulanmalı.
      const ok = await verifyPassword(currentHash, currentPassword);
      if (!ok) return res.status(401).json({ error: "Mevcut şifre hatalı." });
    }
    // Zorunlu değişiklikte (ilk giriş / admin sıfırlaması) mevcut şifre zaten
    // az önce login sırasında doğrulandı — tekrar istenmez.

    const newHash = await hashPassword(newPassword);
    await query("UPDATE users SET password_hash=$1, must_change_password=false WHERE username=$2",
      [newHash, req.user.username]);

    if (req.forcePasswordChange) {
      await completePasswordChange(req.session.id);
      await audit(`Giriş tamamlandı (2/2 — parola değiştirildi): ${req.user.username}`, req.user.username, true);
      return res.json({ ok: true, user: req.user, csrfToken: req.session.csrf_secret });
    }
    await audit(`Şifre değiştirildi: ${req.user.username}`, req.user.username, true);
    res.json({ ok: true });
  } catch (e) { next(e); }
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

// Kullanıcının kendi tüm oturumlarını (bu cihaz dahil) sonlandırması: hesabının
// ele geçirildiğinden şüphelenirse veya başka bir cihazda açık unuttuysa
// kullanabileceği self-service bir güvenlik eylemi — admin onayı gerekmez,
// yalnızca kendi hesabını etkiler.
router.post("/logout-all-sessions", requireAuth, async (req, res, next) => {
  try {
    await destroyAllSessionsForUser(req.user.username);
    await audit(`Tüm oturumlardan çıkış yapıldı: ${req.user.username}`, req.user.username, true);
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
