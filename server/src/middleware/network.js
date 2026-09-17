"use strict";
// Ağ seviyesinde erişim kısıtlaması: yalnızca kurumsal ağdaki (BYELMAS domain)
// cihazlardan erişime izin verir. ÖNEMLİ DÜRÜST NOT: bir web sunucusu,
// bir istemcinin gerçekten Windows AD domainine (byelmas.local) üye olup
// olmadığını doğrudan doğrulayamaz — bu, istemci tarafı entegre kimlik
// doğrulaması (Kerberos/NTLM, IIS/Nginx modülü) gerektirir ve bu ortamın
// kapsamı dışındadır. Burada uygulanan PRATİK EŞDEĞER: kurumsal ağın IP
// aralığı (VPN/şirket içi ağ) allowlist'e alınır; bu aralığın dışından gelen
// istekler reddedilir. NETWORK_ALLOWED_CIDRS boşsa (geliştirme/test) kontrol
// tamamen devre dışıdır.
const { config } = require("../config");

function ipToLong(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split("/");
  const bits = bitsStr === undefined ? 32 : parseInt(bitsStr, 10);
  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range);
  if (ipLong === null || rangeLong === null) return false;
  if (bits === 0) return true;
  const mask = (-1 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

function normalizeIp(ip) {
  if (!ip) return ip;
  // IPv6-mapped IPv4 adresleri (::ffff:10.0.0.5) için düz IPv4'e indirger.
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function networkAllowlist(req, res, next) {
  const cidrs = config.networkAllowedCidrs;
  if (!cidrs || !cidrs.length) return next(); // yapılandırılmamışsa kontrol yok (dev/test)
  if (req.path === "/api/healthz") return next(); // sağlık kontrolü her zaman erişilebilir olmalı
  const ip = normalizeIp(req.ip);
  const allowed = cidrs.some((c) => inCidr(ip, c));
  if (!allowed) {
    return res.status(403).json({ error: "Bu uygulamaya yalnızca kurumsal ağdan (BYELMAS) erişilebilir." });
  }
  next();
}

module.exports = { networkAllowlist, inCidr };
