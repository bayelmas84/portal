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
const { hashPassword } = require("./password");
const { destroyAllSessionsForUser } = require("../auth/session");

async function applyAdminAction(targetType, payload, actingUsername) {
  switch (targetType) {
    case "admin.user.create": {
      const { username, name, email, role, unit, title, initialPassword } = payload;
      // KURAL: yönetici asla istemciden gelen değerle atanmaz — birim seçiliyse
      // GERÇEK birim yöneticisi backend tarafından zorla atanır (birimin
      // yöneticisini değiştirmenin tek yolu birim tanımını güncellemektir).
      let managerUsername = null;
      if (unit) {
        const u = await query("SELECT manager_username FROM units WHERE code=$1", [unit]);
        managerUsername = u.rows[0] ? u.rows[0].manager_username : null;
      }
      const passwordHash = initialPassword ? await hashPassword(initialPassword) : null;
      await query(
        `INSERT INTO users (username,name,email,role,unit,title,manager_username,password_hash,must_change_password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [username, name, email, role, unit || null, title || null, managerUsername, passwordHash]
      );
      return;
    }
    case "admin.user.reset_password": {
      const { username, newPassword } = payload;
      const passwordHash = await hashPassword(newPassword);
      await query("UPDATE users SET password_hash=$1, must_change_password=true WHERE username=$2",
        [passwordHash, username]);
      // Olası ele geçirilmiş/unutulmuş hesabın mevcut oturumlarını da keser.
      await destroyAllSessionsForUser(username);
      return;
    }
    case "admin.user.update": {
      const { username, name, email, role, unit, title, active } = payload;
      const before = await query("SELECT unit, active, manager_username FROM users WHERE username=$1", [username]);
      const wasInactive = before.rows[0] && before.rows[0].active === false;
      const effectiveUnit = unit !== undefined && unit !== null ? unit : (before.rows[0] ? before.rows[0].unit : null);
      let managerUsername; // undefined ise COALESCE mevcut değeri korur
      if (unit !== undefined && unit !== null) {
        // Birim değişti: yeni birimin GERÇEK yöneticisi atanır (kendisi o birimin
        // yöneticisiyse kendine yönetici atanmaz).
        const u = await query("SELECT manager_username FROM units WHERE code=$1", [unit]);
        const unitManager = u.rows[0] ? u.rows[0].manager_username : null;
        managerUsername = unitManager === username ? null : unitManager;
      } else if (active === true && wasInactive && effectiveUnit) {
        // KURAL: pasif kullanıcı yeniden aktif edildiğinde yöneticisi, pasif
        // kaldığı süre boyunca değişmiş olabilecek birim yöneticisine senkronize edilir.
        const u = await query("SELECT manager_username FROM units WHERE code=$1", [effectiveUnit]);
        const unitManager = u.rows[0] ? u.rows[0].manager_username : null;
        managerUsername = unitManager === username ? null : unitManager;
      }
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
    case "admin.unit.create": {
      const { code, name, managerUsername } = payload;
      await query("INSERT INTO units (code,name,manager_username) VALUES ($1,$2,$3)", [code, name.trim(), managerUsername]);
      return;
    }
    case "admin.unit.update": {
      const { code, name, managerUsername, active } = payload;
      const before = await query("SELECT manager_username FROM units WHERE code=$1", [code]);
      const oldManager = before.rows[0] && before.rows[0].manager_username;
      await query(
        `UPDATE units SET name=COALESCE($1,name), manager_username=COALESCE($2,manager_username),
           active=COALESCE($3,active) WHERE code=$4`,
        [name, managerUsername, active, code]
      );
      // KURAL: birimin yöneticisi değiştiğinde, o birimdeki TÜM aktif çalışanların
      // yöneticisi de yeni yöneticiye güncellenir (yeni yöneticinin kendisi hariç —
      // birinin kendi kendisinin yöneticisi olması anlamsız olur).
      if (managerUsername && managerUsername !== oldManager) {
        await query(
          "UPDATE users SET manager_username=$1 WHERE unit=$2 AND active=true AND username != $1",
          [managerUsername, code]
        );
      }
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
      const { host, port, fromAddr, fromName, username, password, tls } = payload;
      await saveSmtpSettings({ host, port: Number(port), fromAddr, fromName, username: username || "", password, tls: !!tls, updatedBy: actingUsername });
      return;
    }
    case "admin.smtp.active": {
      await setSmtpActive(!!payload.active, actingUsername);
      return;
    }
    case "admin.approval_rule": {
      const { category, approverRole, criticalities, active } = payload;
      const sets = [];
      const values = [category];
      if (approverRole !== undefined) { values.push(approverRole); sets.push(`approver_role=$${values.length}`); }
      if (criticalities !== undefined) { values.push(criticalities); sets.push(`criticalities=$${values.length}`); }
      if (active !== undefined) { values.push(active); sets.push(`active=$${values.length}`); }
      values.push(actingUsername);
      sets.push(`updated_by=$${values.length}`, "updated_at=now()");
      await query(`UPDATE approval_rules SET ${sets.join(", ")} WHERE category=$1`, values);
      return;
    }
    case "admin.approval_rule_create": {
      const { category, approverRole, criticalities } = payload;
      await query(
        "INSERT INTO approval_rules (category, approver_role, criticalities, active, updated_by, updated_at) VALUES ($1,$2,$3,true,$4,now())",
        [category, approverRole, criticalities, actingUsername]
      );
      return;
    }
    case "admin.settings": {
      for (const [k, v] of Object.entries(payload)) {
        await query(
          "INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()",
          [k, String(v), actingUsername]
        );
      }
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
