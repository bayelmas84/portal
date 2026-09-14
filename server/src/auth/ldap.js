"use strict";
// GÜVENLİK NOTU: Her istemciye connectTimeout/timeout verilir — bu olmadan,
// AD sunucusu yanıt vermediğinde (ağ sorunu, yanlış firewall kuralı, sunucu
// çökmüş) bir bind() isteği SONSUZA KADAR askıda kalabilir; bu da HTTP
// isteğini (ve dolayısıyla o worker'ı) süresiz kilitler — kendiliğinden bir
// DoS riskidir. 5sn bağlantı + 8sn genel işlem süresi, yavaş ama çalışan bir
// AD için yeterli, donmuş bir bağlantı için ise makul bir üst sınırdır.
const { Client } = require("ldapts");
const { query } = require("../db");
const { decryptSecret } = require("../lib/crypto");

async function getDirectorySettings() {
  const { rows } = await query("SELECT * FROM directory_settings WHERE id = 1");
  return rows[0];
}

/**
 * Kullanıcı adı + parolayı gerçek Active Directory'ye karşı doğrular.
 * Parola portalda hiçbir zaman saklanmaz; yalnızca bu bağlantı sırasında kullanılır.
 * Başarılıysa true, değilse false döner (sebep dışarı sızdırılmaz —
 * "kullanıcı adı veya parola hatalı" mesajı route katmanında tektip verilir).
 */
async function verifyAgainstDirectory(username, password) {
  const dir = await getDirectorySettings();
  if (!dir.active || !dir.url) {
    throw new Error("Dizin (AD) ayarları tanımlı/etkin değil.");
  }
  const client = new Client({ url: dir.url, tlsOptions: { rejectUnauthorized: !!dir.tls }, connectTimeout: 5000, timeout: 8000 });
  const bindPassword = decryptSecret(dir.bind_password_encrypted);
  try {
    await client.bind(dir.bind_dn, bindPassword);
    const filter = dir.user_filter.replace("{username}", username);
    const { searchEntries } = await client.search(dir.base_dn, {
      scope: "sub",
      filter,
      attributes: ["dn"],
    });
    if (!searchEntries.length) return false;
    const userDn = searchEntries[0].dn;
    await client.unbind();
    // Kullanıcının kendi parolasıyla ikinci bir bağlantı denenir (asıl doğrulama budur).
    const userClient = new Client({ url: dir.url, tlsOptions: { rejectUnauthorized: !!dir.tls }, connectTimeout: 5000, timeout: 8000 });
    try {
      await userClient.bind(userDn, password);
      return true;
    } finally {
      await userClient.unbind().catch(() => {});
    }
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function testDirectoryConnection() {
  const dir = await getDirectorySettings();
  if (!dir.url || !dir.bind_dn) {
    return { ok: false, msg: "Önce sunucu ve servis hesabı bilgilerini kaydedin." };
  }
  const client = new Client({ url: dir.url, tlsOptions: { rejectUnauthorized: !!dir.tls }, connectTimeout: 5000, timeout: 8000 });
  try {
    const bindPassword = decryptSecret(dir.bind_password_encrypted);
    await client.bind(dir.bind_dn, bindPassword);
    return { ok: true, msg: "Servis hesabı bağlandı." };
  } catch (e) {
    return { ok: false, msg: e.message };
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = { getDirectorySettings, verifyAgainstDirectory, testDirectoryConnection };
