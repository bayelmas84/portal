"use strict";
/* Active Directory doğrulaması. Parola hiçbir yerde saklanmaz, loglanmaz.
   Doğrulama: servis hesabıyla kullanıcı aranır, ardından kullanıcının kendi DN'i ile bind denenir. */
const { Client } = require("ldapts");

function escapeFilter(v) {
  return String(v).replace(/[\\*()\0/]/g, (c) =>
    ({ "\\": "\\5c", "*": "\\2a", "(": "\\28", ")": "\\29", "\0": "\\00", "/": "\\2f" }[c])
  );
}

/* eff: dirconfig.effective() çıktısı — ayarlar veritabanından veya .env'den gelir. */
async function authenticate(username, password, eff, ClientImpl = Client) {
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(username || "")) throw new Error("Geçersiz kullanıcı adı");
  if (!password || password.length < 1) throw new Error("Parola boş olamaz");
  if (!eff || !eff.url || !eff.bindDn) throw new Error("Dizin ayarları tanımlı değil");
  const opts = {
    url: eff.url,
    timeout: 5000,
    connectTimeout: 5000,
    tlsOptions: { rejectUnauthorized: eff.rejectUnauthorized !== false },
  };
  const svc = new ClientImpl(opts);
  let dn = null, attrs = {};
  try {
    await svc.bind(eff.bindDn, eff.bindPassword);
    const filter = String(eff.userFilter).replace("{username}", escapeFilter(username));
    const { searchEntries } = await svc.search(eff.baseDn, {
      scope: "sub", filter, attributes: ["dn", "displayName", "mail", "manager", "userAccountControl"],
    });
    if (!searchEntries.length) return null;
    dn = searchEntries[0].dn;
    attrs = searchEntries[0];
  } finally {
    await svc.unbind().catch(() => {});
  }
  const asUser = new ClientImpl(opts);
  try {
    await asUser.bind(dn, password);           // parola yalnızca burada kullanılır
  } catch (_) {
    return null;                                // hatalı parola: ayrıntı sızdırılmaz
  } finally {
    await asUser.unbind().catch(() => {});
  }
  return {
    username: username.toLowerCase(),
    displayName: attrs.displayName || username,
    email: attrs.mail || null,
    managerDn: attrs.manager || null,
  };
}
/* Yalnızca servis hesabıyla bağlanıp arama yapar; kullanıcı parolası kullanılmaz. */
async function verify(eff, ClientImpl = Client) {
  if (!eff || !eff.url || !eff.bindDn) return { ok: false, error: "Dizin ayarları tanımlı değil" };
  const svc = new ClientImpl({
    url: eff.url, timeout: 5000, connectTimeout: 5000,
    tlsOptions: { rejectUnauthorized: eff.rejectUnauthorized !== false },
  });
  try {
    await svc.bind(eff.bindDn, eff.bindPassword);
    const { searchEntries } = await svc.search(eff.baseDn, { scope: "base", filter: "(objectClass=*)", attributes: ["dn"] });
    return { ok: true, url: eff.url, baseDn: eff.baseDn, entries: searchEntries.length };
  } catch (e) {
    return { ok: false, error: e.message, url: eff.url };
  } finally { await svc.unbind().catch(() => {}); }
}

/* Belirli bir kullanıcının dizinde bulunup bulunmadığını sınar (parola sorulmaz). */
async function lookup(username, eff, ClientImpl = Client) {
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(username || "")) return { ok: false, error: "Geçersiz kullanıcı adı" };
  if (!eff || !eff.url || !eff.bindDn) return { ok: false, error: "Dizin ayarları tanımlı değil" };
  const svc = new ClientImpl({
    url: eff.url, timeout: 5000, connectTimeout: 5000,
    tlsOptions: { rejectUnauthorized: eff.rejectUnauthorized !== false },
  });
  try {
    await svc.bind(eff.bindDn, eff.bindPassword);
    const filter = String(eff.userFilter).replace("{username}", escapeFilter(username));
    const { searchEntries } = await svc.search(eff.baseDn, {
      scope: "sub", filter, attributes: ["dn", "displayName", "mail", "title", "department"] });
    if (!searchEntries.length) return { ok: false, error: "Kullanıcı dizinde bulunamadı" };
    const e = searchEntries[0];
    return { ok: true, dn: String(e.dn), displayName: e.displayName || null, mail: e.mail || null,
             title: e.title || null, department: e.department || null };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { await svc.unbind().catch(() => {}); }
}

module.exports = { authenticate, escapeFilter, verify, lookup };
