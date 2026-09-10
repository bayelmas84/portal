"use strict";
/* Bildirim alıcıları koda gömülmez; notification_defs tablosundan okunur (Admin Panel > Bildirim tanımları). */
const db = require("../lib/db");
const audit = require("../lib/audit");

const slug = (name) =>
  String(name || "").toLocaleLowerCase("tr")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
    .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

const mailconfig = require("../lib/mailconfig");

async function emailOf(username, cfg, eff) {
  const u = await db.one("SELECT email, display_name FROM users WHERE username = $1", [username]);
  if (u && u.email) return u.email;
  const domain = (eff && eff.mailDomain) || cfg.MAIL_DOMAIN;
  return `${slug(username || (u && u.display_name))}@${domain}`;
}

async function send(eventKey, { subject, body, requester, approver }, cfg, actor = "sistem") {
  const def = await db.one("SELECT * FROM notification_defs WHERE event_key = $1", [eventKey]);
  if (!def) return [];
  const eff = await mailconfig.effective(cfg);   /* grup adresleri Admin Panel'den gelir */
  const list = [];
  if (def.to_req && requester) list.push(await emailOf(requester, cfg, eff));
  if (def.to_mgr && requester) {
    const u = await db.one("SELECT manager FROM users WHERE username = $1", [requester]);
    if (u && u.manager) list.push(await emailOf(u.manager, cfg, eff));
  }
  if (def.to_appr && approver) list.push(await emailOf(approver, cfg, eff));
  if (def.to_insp) list.push(eff.groupInspection);
  if (def.to_all) list.push(eff.groupAll);
  const uniq = [...new Set(list.filter(Boolean))];
  for (const to of uniq) {
    await db.query(
      "INSERT INTO mail_outbox (recipient, subject, body, event_key) VALUES ($1,$2,$3,$4)",
      [to, subject, body || subject, eventKey]
    );
  }
  await audit.record("bildirim." + eventKey, actor, {
    ok: uniq.length > 0,
    detail: { alicilar: uniq, konu: subject },
  });
  return uniq;
}
module.exports = { send, emailOf, slug };
