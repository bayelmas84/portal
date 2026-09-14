"use strict";
const crypto = require("crypto");
const { query } = require("../db");
const { config } = require("../config");

function randomId() {
  return crypto.randomBytes(32).toString("base64url");
}

async function createSession(username, pending2fa, mustSetup2fa) {
  const id = randomId();
  const csrfSecret = randomId();
  const now = Date.now();
  const idleExpiresAt = new Date(now + config.session.idleMinutes * 60000);
  const absoluteExpiresAt = new Date(now + config.session.absoluteMinutes * 60000);
  await query(
    `INSERT INTO sessions (id, username, csrf_secret, idle_expires_at, absolute_expires_at, pending_2fa, must_setup_2fa)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, username, csrfSecret, idleExpiresAt, absoluteExpiresAt, !!pending2fa, !!mustSetup2fa]
  );
  return { id, csrfSecret, idleExpiresAt, absoluteExpiresAt, pending2fa: !!pending2fa };
}

async function completeTwoFactorSetup(id) {
  await query("UPDATE sessions SET must_setup_2fa=false WHERE id=$1", [id]);
}

async function completeTwoFactor(id) {
  await query("UPDATE sessions SET pending_2fa=false WHERE id=$1", [id]);
}

async function getSession(id) {
  if (!id) return null;
  const { rows } = await query("SELECT * FROM sessions WHERE id = $1", [id]);
  const s = rows[0];
  if (!s) return null;
  const now = Date.now();
  if (now > new Date(s.idle_expires_at).getTime() || now > new Date(s.absolute_expires_at).getTime()) {
    await destroySession(id);
    return null;
  }
  // Kayan (sliding) boşta kalma süresi: her geçerli istek süreyi uzatır, mutlak sınırı aşamaz.
  const newIdle = new Date(Math.min(
    now + config.session.idleMinutes * 60000,
    new Date(s.absolute_expires_at).getTime()
  ));
  await query("UPDATE sessions SET last_seen_at = now(), idle_expires_at = $2 WHERE id = $1", [
    id,
    newIdle,
  ]);
  return s;
}

async function destroySession(id) {
  await query("DELETE FROM sessions WHERE id = $1", [id]);
}

async function destroyAllSessionsForUser(username) {
  await query("DELETE FROM sessions WHERE username = $1", [username]);
}

module.exports = { createSession, getSession, destroySession, destroyAllSessionsForUser, completeTwoFactor, completeTwoFactorSetup };
