"use strict";
/* Proje metrikleri. Tüm hesaplar sunucuda yapılır; istemci hazır sayı alır.
   Yönetici özet raporu ünvan bazlı kısıtlıdır (Direktör, Grup Direktörü, GMY). */
const db = require("./db");

/* Yönetici özetini görebilecek ünvanlar. Rol değil ünvan bakılır: bir kişi
   Proje Yöneticisi rolünde olup Direktör ünvanında olabilir. */
const EXEC_TITLES = ["DIR", "GDIR", "GMY", "PYD"];
/* Faz kapısı onay yetkisi olan ünvan: Proje Yönetim Direktörü. */
const GATE_AUTHORITY_TITLES = ["PYD"];
const isGateAuthority = (user) => GATE_AUTHORITY_TITLES.includes(String(user.title_code || "").toUpperCase());
const isExec = (user) => EXEC_TITLES.includes(String(user.title_code || "").toUpperCase());

const DONE = "done";
const isoDay = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

/* Bir projenin tamamlanma ve sağlık göstergeleri */
async function projectMetrics(projectId) {
  const totals = await db.one(
    `SELECT COUNT(*)::int AS items,
            COALESCE(SUM(points),0)::int AS points,
            COUNT(CASE WHEN state = 'done' THEN 1 END)::int AS done_items,
            COALESCE(SUM(CASE WHEN state = 'done' THEN points ELSE 0 END),0)::int AS done_points,
            COUNT(CASE WHEN type = 'Bug' AND state <> 'done' THEN 1 END)::int AS open_bugs,
            COUNT(CASE WHEN state = 'prog' THEN 1 END)::int AS in_progress
       FROM project_items WHERE project_id = $1`, [projectId]);
  const p = await db.one(
    `SELECT code, name, method, lead, status, health, start_date, target_date FROM projects WHERE id = $1`,
    [projectId]);
  const pct = totals.points > 0 ? Math.round((totals.done_points / totals.points) * 100)
            : totals.items > 0 ? Math.round((totals.done_items / totals.items) * 100) : 0;

  /* Takvim ilerlemesi: hedefe göre geçen sürenin yüzdesi. İş ilerlemesinden
     belirgin şekilde geriyse proje gecikme sinyali verir. */
  let timePct = null, daysLeft = null;
  if (p && p.start_date && p.target_date) {
    const start = new Date(p.start_date).getTime();
    const target = new Date(p.target_date).getTime();
    const now = Date.now();
    timePct = target > start ? Math.min(100, Math.max(0, Math.round(((now - start) / (target - start)) * 100))) : null;
    daysLeft = Math.round((target - now) / 86400000);
  }
  /* Sapma yüzde olarak: (iş % − takvim %) / takvim %.
     0 = takvimle aynı, negatif = geride, pozitif = önde. */
  const drift = timePct === null ? null : (timePct > 0 ? Math.round(((pct - timePct) / timePct) * 100) : 0);
  return { ...p, ...totals, completion: pct, timeProgress: timePct, daysLeft, drift,
           openPoints: totals.points - totals.done_points, openItems: totals.items - totals.done_items };
}

/* Aktif sprintin burndown serisi: ideal çizgi ve gerçek kalan iş */
async function burndown(projectId) {
  const sprint = await db.one(
    `SELECT id, name, goal, start_date, end_date, committed_points
       FROM sprints WHERE project_id = $1 AND active = TRUE
       ORDER BY start_date DESC LIMIT 1`, [projectId]);
  if (!sprint) return { sprint: null, series: [] };

  const snaps = await db.many(
    "SELECT day, remaining, completed FROM burndown_snapshots WHERE sprint_id = $1 ORDER BY day ASC",
    [sprint.id]);

  const start = new Date(sprint.start_date), end = new Date(sprint.end_date);
  const totalDays = Math.max(1, Math.round((end - start) / 86400000));
  const committed = sprint.committed_points || 0;
  const series = [];
  for (let i = 0; i <= totalDays; i++) {
    const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    /* Sürücü Date nesnesi de dönebilir; karşılaştırma ISO biçimine indirgenir. */
    const snap = snaps.find((s) => isoDay(s.day) === day);
    series.push({
      day,
      ideal: Math.round(committed - (committed / totalDays) * i),
      remaining: snap ? snap.remaining : null,
      completed: snap ? snap.completed : null,
    });
  }
  return { sprint, series, committed };
}

/* Tamamlanan sprintlerin hız (velocity) geçmişi */
const velocity = (projectId) =>
  db.many(
    `SELECT s.id, s.name, s.committed_points,
            COALESCE(SUM(CASE WHEN i.state = 'done' THEN i.points ELSE 0 END),0)::int AS completed_points
       FROM sprints s LEFT JOIN project_items i ON i.sprint_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id, s.name, s.committed_points, s.start_date
      ORDER BY s.start_date ASC`, [projectId]);

/* İş kalemlerinin durum ve tip dağılımı (Jira'daki pasta/sütun grafiklerin verisi) */
async function distribution(projectId) {
  const byState = await db.many(
    `SELECT state, COUNT(*)::int AS items, COALESCE(SUM(points),0)::int AS points
       FROM project_items WHERE project_id = $1 GROUP BY state`, [projectId]);
  const byType = await db.many(
    `SELECT type, COUNT(*)::int AS items,
            COUNT(CASE WHEN state = 'done' THEN 1 END)::int AS done
       FROM project_items WHERE project_id = $1 GROUP BY type`, [projectId]);
  const byAssignee = await db.many(
    `SELECT COALESCE(i.assignee,'(atanmadı)') AS assignee, u.display_name,
            COUNT(*)::int AS items,
            COUNT(CASE WHEN i.state <> 'done' THEN 1 END)::int AS open_items,
            COALESCE(SUM(CASE WHEN i.state <> 'done' THEN i.points ELSE 0 END),0)::int AS open_points
       FROM project_items i LEFT JOIN users u ON u.username = i.assignee
      WHERE i.project_id = $1
      GROUP BY i.assignee, u.display_name ORDER BY open_points DESC`, [projectId]);
  return { byState, byType, byAssignee };
}

/* Yönetici özeti: tüm projelerin tek tabloda karşılaştırması + toplu göstergeler */
async function executiveSummary() {
  const projects = await db.many(
    `SELECT p.id, p.code, p.name, p.method, p.status, p.health, p.lead, p.target_date,
            u.display_name AS lead_name, un.name AS unit_name
       FROM projects p
       JOIN users u ON u.username = p.lead
       LEFT JOIN units un ON un.code = p.unit_code
      ORDER BY p.code`);
  const rows = [];
  for (const p of projects) rows.push({ ...p, ...(await projectMetrics(p.id)) });

  const active = rows.filter((r) => r.status === "devam");
  const totals = {
    projects: rows.length,
    active: active.length,
    completed: rows.filter((r) => r.status === "tamamlandi").length,
    delayed: rows.filter((r) => r.health === "gecikme").length,
    atRisk: rows.filter((r) => r.health === "risk").length,
    openBugs: rows.reduce((a, r) => a + r.open_bugs, 0),
    points: rows.reduce((a, r) => a + r.points, 0),
    donePoints: rows.reduce((a, r) => a + r.done_points, 0),
  };
  totals.completion = totals.points > 0 ? Math.round((totals.donePoints / totals.points) * 100) : 0;

  /* Dikkat gerektirenler: takvim ilerlemesinin 15 puandan fazla gerisinde kalanlar */
  /* Dikkat eşiği: takvimin %20'sinden fazla gerisinde kalanlar */
  const attention = rows
    .filter((r) => r.status === "devam" && r.drift !== null && r.drift <= -20)
    .map((r) => ({ code: r.code, name: r.name, completion: r.completion, timeProgress: r.timeProgress, drift: r.drift,
                   daysLeft: r.daysLeft, lead: r.lead_name }));

  const byUnit = {};
  for (const r of rows) {
    const k = r.unit_name || "Birim atanmadı";
    byUnit[k] = byUnit[k] || { unit: k, projects: 0, points: 0, donePoints: 0 };
    byUnit[k].projects++; byUnit[k].points += r.points; byUnit[k].donePoints += r.done_points;
  }
  return {
    totals,
    projects: rows.map((r) => ({
      code: r.code, name: r.name, method: r.method, status: r.status, health: r.health,
      lead: r.lead_name, unit: r.unit_name, completion: r.completion, timeProgress: r.timeProgress,
      drift: r.drift, daysLeft: r.daysLeft, items: r.items, doneItems: r.done_items,
      points: r.points, donePoints: r.done_points, openBugs: r.open_bugs,
    })),
    attention,
    byUnit: Object.values(byUnit).map((u) => ({
      ...u, completion: u.points > 0 ? Math.round((u.donePoints / u.points) * 100) : 0,
    })),
  };
}

/* Günlük burndown anlık görüntüsü (zamanlanmış görev çağırır) */
async function snapshotBurndown() {
  const sprints = await db.many("SELECT id FROM sprints WHERE active = TRUE");
  const today = new Date().toISOString().slice(0, 10);
  for (const s of sprints) {
    const t = await db.one(
      `SELECT COALESCE(SUM(CASE WHEN state <> 'done' THEN points ELSE 0 END),0)::int AS remaining,
              COALESCE(SUM(CASE WHEN state = 'done' THEN points ELSE 0 END),0)::int AS completed
         FROM project_items WHERE sprint_id = $1`, [s.id]);
    await db.query(
      `INSERT INTO burndown_snapshots (sprint_id, day, remaining, completed) VALUES ($1,$2,$3,$4)
       ON CONFLICT (sprint_id, day) DO UPDATE SET remaining = EXCLUDED.remaining, completed = EXCLUDED.completed`,
      [s.id, today, t.remaining, t.completed]);
  }
  return { sprints: sprints.length, day: today };
}

module.exports = { EXEC_TITLES, GATE_AUTHORITY_TITLES, isExec, isGateAuthority, projectMetrics, burndown, velocity, distribution, executiveSummary, snapshotBurndown, DONE };
