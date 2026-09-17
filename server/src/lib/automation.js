"use strict";
// Otomasyon motoru: "tetikleyici -> koşul(lar) -> eylem(ler)" kurallarını
// çalıştırır. issue oluşturma/güncelleme endpoint'leri, kendi işlemlerini
// tamamladıktan SONRA (yanıt zaten döndükten sonra, kullanıcıyı bekletmeden)
// runAutomation()'ı çağırır.
//
// Sonsuz döngü koruması: bir kuralın eylemi issue'yu değiştirirse (ör.
// set_status), bu değişiklik YENİ bir tetikleyici sayılır ve zincirleme
// olarak tekrar runAutomation() çağrılır — ama depth MAX_CASCADE_DEPTH'i
// geçtiğinde zincir durdurulur, A'nın B'yi B'nin A'yı sonsuza dek
// tetiklemesi mümkün değildir.
const { query } = require("../db");
const { sendMail } = require("./mailer");
const { getEmailPrefs } = require("./notify");

const MAX_CASCADE_DEPTH = 3;

const FIELD_MAP = {
  type: "issue_type",
  priority: "priority",
  status: "status",
  assignee: "assignee_username",
};

function matchesCondition(issue, cond) {
  const col = FIELD_MAP[cond.field];
  if (!col) return true; // bilinmeyen alan: koşulu yok say (kural bloklanmasın)
  const val = issue[col];
  if (cond.op === "eq") return String(val || "") === String(cond.value || "");
  if (cond.op === "empty") return val === null || val === undefined || val === "";
  if (cond.op === "not_empty") return !(val === null || val === undefined || val === "");
  return true;
}

async function fetchIssue(projectK, issueKey) {
  const { rows } = await query(
    "SELECT * FROM project_issues WHERE project_k=$1 AND issue_key=$2",
    [projectK, issueKey]
  );
  return rows[0] || null;
}

async function fetchRules(projectK, triggerType, toValue) {
  const { rows } = await query(
    "SELECT * FROM automation_rules WHERE project_k=$1 AND trigger_type=$2 AND enabled=true ORDER BY id",
    [projectK, triggerType]
  );
  // trigger_value tanımlıysa yalnızca o hedefe geçişte tetiklenir; NULL/boşsa
  // her geçişte tetiklenir.
  return rows.filter((r) => !r.trigger_value || r.trigger_value === toValue);
}

async function logFired(rule, projectK, issueKey, summary) {
  await query(
    `INSERT INTO automation_log (rule_id, project_k, issue_key, rule_name, summary)
     VALUES ($1,$2,$3,$4,$5)`,
    [rule.id, projectK, issueKey, rule.name, summary]
  );
}

async function notifyUsername(username, projectK, issueKey, message, actorUsername) {
  const u = await query("SELECT email FROM users WHERE username=$1 AND active", [username]);
  if (!u.rowCount) return;
  await query(
    `INSERT INTO in_app_notifications (recipient_username, kind, project_k, issue_key, title, actor_username)
     VALUES ($1,'automation',$2,$3,$4,$5)`,
    [username, projectK, issueKey, message, actorUsername || null]
  );
  try {
    const prefs = await getEmailPrefs(username);
    if (prefs.assignment) {
      await sendMail(u.rows[0].email, `${issueKey} — otomasyon`, message);
    }
  } catch (e) { /* mail hatası otomasyonu durdurmaz */ }
}

async function executeAction(action, rule, projectK, issueKey, actorUsername) {
  const issue = await fetchIssue(projectK, issueKey);
  if (!issue) return null;
  if (action.type === "set_priority") {
    if (!["Highest", "High", "Medium", "Low"].includes(action.value)) return null;
    await query("UPDATE project_issues SET priority=$1, updated_at=now() WHERE project_k=$2 AND issue_key=$3",
      [action.value, projectK, issueKey]);
    await logFired(rule, projectK, issueKey, `Öncelik "${action.value}" olarak ayarlandı`);
    return { cascadeTrigger: "priority_changed", toValue: action.value };
  }
  if (action.type === "set_status") {
    if (!["backlog", "todo", "prog", "review", "test", "done"].includes(action.value)) return null;
    await query("UPDATE project_issues SET status=$1, updated_at=now() WHERE project_k=$2 AND issue_key=$3",
      [action.value, projectK, issueKey]);
    await logFired(rule, projectK, issueKey, `Durum "${action.value}" olarak ayarlandı`);
    return { cascadeTrigger: "status_changed", toValue: action.value };
  }
  if (action.type === "set_assignee") {
    const uname = action.value === "__unassign__" ? null : action.value;
    if (uname) {
      const inTeam = await query("SELECT 1 FROM project_team WHERE project_k=$1 AND username=$2", [projectK, uname]);
      if (!inTeam.rowCount) return null;
    }
    await query("UPDATE project_issues SET assignee_username=$1, updated_at=now() WHERE project_k=$2 AND issue_key=$3",
      [uname, projectK, issueKey]);
    await logFired(rule, projectK, issueKey, uname ? `Atanan kişi "${uname}" olarak ayarlandı` : "Atama kaldırıldı");
    if (uname) await notifyUsername(uname, projectK, issueKey, `${issueKey} otomasyon kuralı "${rule.name}" tarafından size atandı.`, actorUsername);
    return null;
  }
  if (action.type === "notify_assignee") {
    if (!issue.assignee_username) return null;
    await notifyUsername(issue.assignee_username, projectK, issueKey, action.message || `${issueKey}: "${rule.name}" kuralı tetiklendi.`, actorUsername);
    await logFired(rule, projectK, issueKey, `Atanan kişiye (${issue.assignee_username}) bildirim gönderildi`);
    return null;
  }
  if (action.type === "notify_watchers") {
    const watchers = await query("SELECT username FROM project_issue_watchers WHERE project_k=$1 AND issue_key=$2", [projectK, issueKey]);
    for (const w of watchers.rows) {
      await notifyUsername(w.username, projectK, issueKey, action.message || `${issueKey}: "${rule.name}" kuralı tetiklendi.`, actorUsername);
    }
    await logFired(rule, projectK, issueKey, `${watchers.rowCount} izleyiciye bildirim gönderildi`);
    return null;
  }
  if (action.type === "add_comment") {
    const body = `[Otomasyon: ${rule.name}] ${action.message || ""}`.trim();
    await query(
      "INSERT INTO project_issue_comments (project_k, issue_key, author_username, body) VALUES ($1,$2,$3,$4)",
      [projectK, issueKey, actorUsername, body]
    );
    await logFired(rule, projectK, issueKey, "Otomatik yorum eklendi");
    return null;
  }
  return null;
}

async function runAutomation(projectK, triggerType, issueKey, context, actorUsername, depth) {
  depth = depth || 0;
  if (depth >= MAX_CASCADE_DEPTH) return;
  const rules = await fetchRules(projectK, triggerType, (context || {}).toValue);
  if (!rules.length) return;
  for (const rule of rules) {
    const issue = await fetchIssue(projectK, issueKey);
    if (!issue) continue;
    const conditions = rule.conditions_json || [];
    const allMatch = conditions.every((c) => matchesCondition(issue, c));
    if (!allMatch) continue;
    for (const action of (rule.actions_json || [])) {
      let cascade = null;
      try {
        cascade = await executeAction(action, rule, projectK, issueKey, actorUsername);
      } catch (e) {
        await logFired(rule, projectK, issueKey, `Eylem başarısız oldu: ${e.message}`);
        continue;
      }
      if (cascade) {
        await runAutomation(projectK, cascade.cascadeTrigger, issueKey, { toValue: cascade.toValue }, actorUsername, depth + 1);
      }
    }
  }
}

module.exports = { runAutomation };
