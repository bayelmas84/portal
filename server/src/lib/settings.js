"use strict";
const { query } = require("../db");
const { config } = require("../config");

const FALLBACKS = {
  reading_seconds_per_page: config.readingSecondsPerPage,
  quiz_pass_score: config.quizPassScore,
  training_default_due_days: 14,
  sprint_default_days: 14,
  story_point_scale: "1,2,3,5,8,13,21",
};

/** Sayısal bir uygulama ayarını DB'den okur; yoksa .env/varsayılana düşer. */
async function getSetting(key) {
  try {
    const { rows } = await query("SELECT value FROM app_settings WHERE key=$1", [key]);
    if (rows[0]) return rows[0].value;
  } catch (e) { /* tablo henüz yoksa (eski migration) sessizce varsayılana düş */ }
  return FALLBACKS[key];
}

async function getNumberSetting(key) {
  const v = await getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : FALLBACKS[key];
}

module.exports = { getSetting, getNumberSetting };
