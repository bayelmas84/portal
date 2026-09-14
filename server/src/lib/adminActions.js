"use strict";
// Admin panelindeki yazma işlemleri artık DOĞRUDAN burada uygulanmaz; önce
// admin.js bir onay talebi oluşturur (payload olarak bu modülün beklediği
// şekli saklar), yönetici onaylayınca announcements.js'deki decide ucu
// applyAdminAction'ı çağırır. Böylece "admin panelinde yapılan her işlem
// adminin yöneticisi tarafından onaylanmalı" kuralı tek bir yerden garanti edilir.
const { query } = require("../db");
const { encryptSecret } = require("./crypto");
const { saveSmtpSettings, setSmtpActive } = require("./mailer");
const { setAccess, resetAccessToDefault, setAvailability } = require("./permissions");

async function applyAdminAction(targetType, payload, actingUsername) {
  switch (targetType) {
    case "admin.user.create": {
      const { username, name, email, role, unit, title, managerUsername } = payload;
      await query(
        `INSERT INTO users (username,name,email,role,unit,title,manager_username)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [username, name, email, role, unit || null, title || null, managerUsername || null]
      );
      return;
    }
    case "admin.user.update": {
      const { username, name, email, role, unit, title, managerUsername, active } = payload;
      await query(
        `UPDATE users SET
           name=COALESCE($1,name), email=COALESCE($2,email), role=COALESCE($3,role),
           unit=COALESCE($4,unit), title=COALESCE($5,title),
           manager_username=COALESCE($6,manager_username), active=COALESCE($7,active)
         WHERE username=$8`,
        [name, email, role, unit, title, managerUsername, active, username]
      );
      return;
    }
    case "admin.directory": {
      const { url, baseDn, bindDn, bindPassword, userFilter, tls, defaultRole, active } = payload;
      const current = await query("SELECT bind_password_encrypted FROM directory_settings WHERE id=1");
      const passwordEncrypted = bindPassword ? encryptSecret(bindPassword) : current.rows[0].bind_password_encrypted;
      await query(
        `UPDATE directory_settings SET url=$1, base_dn=$2, bind_dn=$3, bind_password_encrypted=$4,
           user_filter=$5, tls=$6, default_role=$7, active=$8, updated_by=$9, updated_at=now() WHERE id=1`,
        [url.trim(), baseDn.trim(), bindDn.trim(), passwordEncrypted, userFilter.trim(), !!tls,
         defaultRole || "staff", !!active, actingUsername]
      );
      return;
    }
    case "admin.smtp": {
      const { host, port, fromAddr, username, password, tls } = payload;
      await saveSmtpSettings({ host, port: Number(port), fromAddr, username: username || "", password, tls: !!tls, updatedBy: actingUsername });
      return;
    }
    case "admin.smtp.active": {
      await setSmtpActive(!!payload.active, actingUsername);
      return;
    }
    case "admin.brand": {
      const allowed = ["company", "companyShort", "product", "slogan", "loginTitle", "loginHint", "footer", "accent"];
      const entries = Object.entries(payload || {}).filter(([k]) => allowed.includes(k));
      for (const [k, v] of entries) {
        await query(
          "INSERT INTO brand_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2",
          [k, String(v)]
        );
      }
      return;
    }
    case "admin.access": {
      const { role, screenKey, level } = payload;
      await setAccess(role, screenKey, level);
      return;
    }
    case "admin.access.reset": {
      await resetAccessToDefault();
      return;
    }
    case "admin.availability": {
      const { screenKey, status } = payload;
      await setAvailability(screenKey, status);
      return;
    }
    case "admin.availability.bulk": {
      const { targets } = payload;
      for (const [key, status] of Object.entries(targets || {})) {
        await setAvailability(key, status);
      }
      return;
    }
    default:
      throw new Error(`Bilinmeyen admin işlemi: ${targetType}`);
  }
}

module.exports = { applyAdminAction };
