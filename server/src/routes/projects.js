"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { query, withTransaction } = require("../db");
const { requireRead, requireWrite, requireAuth } = require("../middleware/auth");
const { canWrite, MEETING_ALWAYS_ROLES } = require("../lib/permissions");
const { audit } = require("../lib/audit");
const { sendMail } = require("../lib/mailer");
const { config } = require("../config");

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Yalnızca PDF kabul edilir."));
    cb(null, true);
  },
});

// Konu (issue) eklerinde kabul edilen dosya türleri: MIME tipi -> uzantı.
// Gercek dosya icerigi asagida validateIssueAttachmentMagic ile MIME beyanindan
// bagimsiz olarak dogrulanir (Content-Type istemci beyanidir, guvenilmez).
const ISSUE_ATTACH_ALLOWED = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/png": "png",
  "image/jpeg": "jpg",
};
function validateIssueAttachmentMagic(buffer, mimetype) {
  if (!buffer || buffer.length < 8) return false;
  const hex4 = buffer.slice(0, 4).toString("hex");
  switch (mimetype) {
    case "application/pdf":
      return buffer.slice(0, 5).toString("latin1") === "%PDF-";
    case "image/png":
      return buffer.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
    case "image/jpeg":
      return buffer.slice(0, 3).toString("hex") === "ffd8ff";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      // .docx/.xlsx aslında bir ZIP arşividir (PK imzasıyla başlar).
      return buffer.slice(0, 2).toString("latin1") === "PK";
    case "application/msword":
    case "application/vnd.ms-excel":
      // Eski OLE bileşik dosya biçimi (.doc/.xls).
      return hex4 === "d0cf11e0";
    default:
      return false;
  }
}
const uploadIssueDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ISSUE_ATTACH_ALLOWED[file.mimetype]) return cb(new Error("Desteklenmeyen dosya türü."));
    cb(null, true);
  },
});
function uploadIssueAttachment(req, res, next) {
  uploadIssueDoc.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Dosya yüklenemedi." });
    next();
  });
}

const DOC_TYPE_ORDER = ["Proje Kartı", "BRD", "FRD", "UAT", "Go Live", "Risk ve Uyumluluk", "Kapanış"];
const APPROVAL_STEPS = [
  { no: 1, name: "Ürün Sahibi" },
  { no: 2, name: "İş Birimi Sahibi" },
  { no: 3, name: "Ürün Sahibi'nin yöneticisi" },
  { no: 4, name: "İş Birimi Sahibi'nin yöneticisi" },
  { no: 5, name: "Teftiş" },
  { no: 6, name: "Kurumsal Risk Grup Direktörü" },
];

async function ensureMandatoryTeam(projectK) {
  // Teftiş ve Kurumsal Risk her projede zorunlu üyedir.
  const insp = await query("SELECT username FROM users WHERE role='inspection' AND active LIMIT 1");
  const risk = await query("SELECT username FROM users WHERE role='control' AND active LIMIT 1");
  for (const [row, roleLabel] of [[insp.rows[0], "Internal Audit"], [risk.rows[0], "Risk"]]) {
    if (row) {
      await query(
        `INSERT INTO project_team (project_k, username, project_role, mandatory)
         VALUES ($1,$2,$3,true) ON CONFLICT (project_k, username) DO NOTHING`,
        [projectK, row.username, roleLabel]
      );
    }
  }
}

router.get("/", requireRead("d.team"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM projects ORDER BY k");
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Yeni proje: proje kodu benzersiz olmalı; oluşturan otomatik olarak lider olur
// ve ekibe eklenir (zorunlu üyeler ensureMandatoryTeam ile ayrıca garanti edilir).
router.post("/", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { k, name, method, unitName, startDate, targetDate } = req.body || {};
    if (!k || !/^[A-Z][A-Z0-9]{1,9}$/.test(k)) {
      return res.status(400).json({ error: "Proje kodu 2-10 karakter, büyük harf ve rakamlardan oluşmalı." });
    }
    if (!name || !name.trim()) return res.status(400).json({ error: "Proje adı zorunlu." });
    if (!["Scrum", "Kanban", "Waterfall"].includes(method)) return res.status(400).json({ error: "Geçersiz metodoloji." });

    const result = await withTransaction(async (client) => {
      const proj = await client.query(
        `INSERT INTO projects (k, name, method, lead_username, unit_name, start_date, target_date, created_by, sprint_name, sprint_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [k, name.trim(), method, req.user.username, unitName || null, startDate || null, targetDate || null,
         req.user.username, method === "Scrum" ? "Sprint 1" : null, method === "Scrum" ? 1 : 0]
      );
      await client.query(
        `INSERT INTO project_team (project_k, username, project_role, mandatory) VALUES ($1,$2,'Product Owner',false)`,
        [k, req.user.username]
      );
      return proj.rows[0];
    });
    await ensureMandatoryTeam(k);
    await audit(`Proje oluşturuldu: ${k} — ${name.trim()}`, req.user.username);
    res.status(201).json({ item: result });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Bu proje kodu zaten kullanılıyor." });
    next(e);
  }
});

// Serbest metin etiketler: boşluk kırpılır, boşlar atılır, en fazla 10 etiket,
// her biri en fazla 30 karakter (Jira "labels" alanına benzer, aşırı veriden korunur).
function sanitizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    const s = String(raw || "").trim().slice(0, 30);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 10) break;
  }
  return out;
}

// ------------------------------- Konular (issue tracker) -------------------------------
const ISSUE_PARENT_OF = { Epic: null, Story: "Epic", Task: "Story", Bug: "Story" };

// Konu oluşturmanın çekirdek adımı (sıra numarası + INSERT). Hem normal
// POST /:k/issues uç noktası hem de toplantı notlarından otomatik
// Epic/Task üretimi bu ortak fonksiyonu kullanır — anahtar üretim mantığı
// tek yerde kalır.
async function insertIssueRow(client, projectK, opts) {
  let issueKey;
  if (opts.keyPrefix) {
    issueKey = await nextKeyForPrefix(client, projectK, opts.keyPrefix);
  } else {
    const seq = await client.query(
      "SELECT count(*)::int AS n FROM project_issues WHERE project_k=$1", [projectK]
    );
    issueKey = `${projectK}-${seq.rows[0].n + 1}`;
  }
  // createdAt verilirse (örn. toplantı tarihinden otomatik Task açılışı) hem
  // created_at hem updated_at o tarihe sabitlenir — aksi halde updated_at'in
  // created_at'ten "önce" görünmesi gibi tutarsız bir görüntü oluşurdu.
  // Verilmezse ikisi de gerçek an (now()) olur.
  const createdAt = opts.createdAt || new Date();
  const ins = await client.query(
    `INSERT INTO project_issues (project_k, issue_key, issue_type, title, description, status, priority, story_points,
       assignee_username, parent_key, created_by, labels, due_date, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
    [projectK, issueKey, opts.issueType, opts.title.trim(), (opts.description || "").trim(),
     opts.status || "backlog", opts.priority || "Medium", Number(opts.storyPoints) || 0,
     opts.assigneeUsername || null, opts.parentKey || null, opts.createdBy,
     sanitizeLabels(opts.labels), opts.dueDate || null, createdAt]
  );
  return ins.rows[0];
}

// Bir toplantının "konusu"ndan (başlık / proje adı / diğer-konu metni) sabit
// bir anahtar öneki türetir: yalnızca harfler tutulur, ilk kelime alınır,
// Türkçe yerel ayarla büyük harfe çevrilir. Örn: "Mobil işlem platformu" ya
// da "MOBİL1" -> "MOBİL". Anlamlı bir önek çıkaramazsa null döner (bu durumda
// çağıran taraf jenerik "TOPLANTI-N" şemasına düşer).
function deriveSubjectPrefix(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  const firstWord = s.split(/[\s\-_/,.]+/)[0] || "";
  const lettersOnly = firstWord.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "");
  if (!lettersOnly) return null;
  return lettersOnly.toLocaleUpperCase("tr-TR").slice(0, 12);
}

// Belirli bir önekle (örn. "MOBİL") başlayan konular arasında en yüksek sıra
// numarasını bulup bir sonrakini üretir — proje geneli değil, YALNIZCA o
// önek için süreklidir; böylece aynı konudaki ardışık toplantılar (bugün,
// gelecek hafta, ...) aynı sayaçtan devam eder.
async function nextKeyForPrefix(client, projectK, prefix) {
  const { rows } = await client.query(
    "SELECT issue_key FROM project_issues WHERE project_k=$1 AND issue_key LIKE $2",
    [projectK, prefix + "%"]
  );
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d+)$");
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.issue_key);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return prefix + (max + 1);
}

// "MOBİL1" -> "MOBİL 1": bir konu anahtarını, henüz özel bir başlık
// verilmemiş toplantılarda okunabilir bir başlık olarak kullanmak için
// harf/rakam arasına boşluk ekler.
function formatKeyAsLabel(issueKey) {
  return issueKey.replace(/([A-Za-zÇĞİÖŞÜçğıöşü]+)(\d+)$/, "$1 $2");
}

const FLOW_LABELS = { backlog: "Backlog", todo: "To Do", prog: "In Progress", review: "In Review", test: "In Testing", done: "Done" };

async function logIssueHistory(runner, username, projectK, issueKey, message) {
  // runner: query() (havuzdan bağımsız istek) ya da client.query.bind(client)
  // (aktif transaction içinde) — transaction içindeyken global query() kullanmak,
  // henüz COMMIT edilmemiş satırlara FK ihlali ile başarısız olurdu.
  await runner(
    "INSERT INTO project_issue_history (project_k, issue_key, username, message) VALUES ($1,$2,$3,$4)",
    [projectK, issueKey, username, message]
  );
  await audit(message, username);
}

// Bir PUT /:k/issues/:issueKey isteğinin eski satırla karşılaştırıldığında
// gerçekte neyi değiştirdiğini insan-okur biçimde özetler; hiçbir alan
// gerçekten değişmediyse boş dizi döner (gereksiz history kaydı oluşmaz).
function describeIssueChanges(old, patch) {
  const parts = [];
  if (patch.status !== undefined && patch.status !== old.status) {
    parts.push(`Durum: ${FLOW_LABELS[old.status] || old.status} → ${FLOW_LABELS[patch.status] || patch.status}`);
  }
  if (patch.assigneeUsername !== undefined && (patch.assigneeUsername || null) !== (old.assignee_username || null)) {
    parts.push(`Atanan kişi: ${old.assignee_username || "(boş)"} → ${patch.assigneeUsername || "(boş)"}`);
  }
  if (patch.priority !== undefined && patch.priority !== old.priority) {
    parts.push(`Öncelik: ${old.priority} → ${patch.priority}`);
  }
  if (patch.storyPoints !== undefined && (Number(patch.storyPoints) || 0) !== old.story_points) {
    parts.push(`Story point: ${old.story_points} → ${Number(patch.storyPoints) || 0}`);
  }
  if (patch.title !== undefined && patch.title.trim() !== old.title) {
    parts.push(`Başlık güncellendi`);
  }
  if (patch.dueDate !== undefined) {
    const oldDue = old.due_date ? new Date(old.due_date).toISOString().slice(0, 10) : null;
    const newDue = patch.dueDate || null;
    if (oldDue !== newDue) parts.push(`Bitiş tarihi: ${oldDue || "(yok)"} → ${newDue || "(yok)"}`);
  }
  if (patch.labels !== undefined) {
    const newLabels = sanitizeLabels(patch.labels);
    const oldLabels = old.labels || [];
    if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
      parts.push(`Etiketler: [${oldLabels.join(", ")}] → [${newLabels.join(", ")}]`);
    }
  }
  return parts;
}

router.get("/:k/issues", requireRead("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pi.*, u.name AS assignee_name FROM project_issues pi
       LEFT JOIN users u ON u.username = pi.assignee_username
       WHERE pi.project_k=$1 ORDER BY pi.created_at`,
      [req.params.k]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/:k/issues", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { issueType, title, description, priority, storyPoints, assigneeUsername, parentKey, status, labels, dueDate } = req.body || {};
    if (!["Epic", "Story", "Task", "Bug"].includes(issueType)) return res.status(400).json({ error: "Geçersiz konu tipi." });
    if (!title || !title.trim()) return res.status(400).json({ error: "Başlık zorunlu." });
    const needParent = ISSUE_PARENT_OF[issueType];
    if (needParent) {
      if (!parentKey) return res.status(400).json({ error: `${issueType} için önce bir ${needParent} seçilmelidir.` });
      const par = await query("SELECT issue_type FROM project_issues WHERE project_k=$1 AND issue_key=$2", [req.params.k, parentKey]);
      if (!par.rowCount || par.rows[0].issue_type !== needParent) {
        return res.status(400).json({ error: `Üst konu geçerli bir ${needParent} olmalıdır.` });
      }
    }
    // Atanacak kişi yalnızca bu projenin ekibinden olabilir.
    if (assigneeUsername) {
      const inTeam = await query(
        "SELECT 1 FROM project_team WHERE project_k=$1 AND username=$2",
        [req.params.k, assigneeUsername]
      );
      if (!inTeam.rowCount) return res.status(400).json({ error: "Atanacak kişi bu projenin ekibinde değil." });
    }
    const proj = await query("SELECT k FROM projects WHERE k=$1", [req.params.k]);
    if (!proj.rowCount) return res.status(404).json({ error: "Proje bulunamadı." });

    const result = await withTransaction((client) => insertIssueRow(client, req.params.k, {
      issueType, title, description, priority, storyPoints, assigneeUsername,
      parentKey: needParent ? parentKey : null, status, labels, dueDate, createdBy: req.user.username,
    }));
    await logIssueHistory(query, req.user.username, req.params.k, result.issue_key, `Konu oluşturuldu: ${title.trim()}`);
    res.status(201).json({ item: result });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Bu konu anahtarı zaten var, tekrar deneyin." });
    next(e);
  }
});

router.put("/:k/issues/:issueKey", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM project_issues WHERE project_k=$1 AND issue_key=$2", [req.params.k, req.params.issueKey]);
    const issue = rows[0];
    if (!issue) return res.status(404).json({ error: "Konu bulunamadı." });
    const { status, assigneeUsername, priority, storyPoints, title, description, inSprint, labels, dueDate } = req.body || {};
    if (status && !["backlog", "todo", "prog", "review", "test", "done"].includes(status)) {
      return res.status(400).json({ error: "Geçersiz durum." });
    }
    if (assigneeUsername) {
      const inTeam = await query(
        "SELECT 1 FROM project_team WHERE project_k=$1 AND username=$2",
        [req.params.k, assigneeUsername]
      );
      if (!inTeam.rowCount) return res.status(400).json({ error: "Atanacak kişi bu projenin ekibinde değil." });
    }
    if (status === "done" && issue.status !== "done") {
      // 1) Doğrudan alt kayıtları (Epic->Story/Task/Bug, Story->Task/Bug)
      //    henüz DONE değilse üst kayıt kapatılamaz.
      const openChildren = await query(
        "SELECT issue_key FROM project_issues WHERE project_k=$1 AND parent_key=$2 AND status<>'done'",
        [req.params.k, req.params.issueKey]
      );
      if (openChildren.rowCount) {
        return res.status(400).json({
          error: `${openChildren.rowCount} alt kayıt henüz tamamlanmadığı için bu konu kapatılamaz: ${openChildren.rows.map((r) => r.issue_key).join(", ")}`,
        });
      }
      // 2) Bu konuyu "blocks" eden (yani bu konunun "blocked by" ilişkisinde
      //    olduğu) başka bir konu henüz DONE değilse kapatılamaz.
      const blockers = await query(
        `SELECT l.source_key, pi.status FROM project_issue_links l
           JOIN project_issues pi ON pi.project_k=l.project_k AND pi.issue_key=l.source_key
          WHERE l.project_k=$1 AND l.link_type='blocks' AND l.target_key=$2 AND pi.status<>'done'`,
        [req.params.k, req.params.issueKey]
      );
      if (blockers.rowCount) {
        return res.status(400).json({
          error: `Bu konu ${blockers.rows.map((r) => r.source_key).join(", ")} tarafından bloklandığı için kapatılamaz.`,
        });
      }
    }
    const fields = [];
    const values = [];
    let i = 1;
    if (status !== undefined) { fields.push(`status=$${i++}`); values.push(status); }
    if (assigneeUsername !== undefined) { fields.push(`assignee_username=$${i++}`); values.push(assigneeUsername || null); }
    if (priority !== undefined) { fields.push(`priority=$${i++}`); values.push(priority); }
    if (storyPoints !== undefined) { fields.push(`story_points=$${i++}`); values.push(Number(storyPoints) || 0); }
    if (title !== undefined) { fields.push(`title=$${i++}`); values.push(title.trim()); }
    if (description !== undefined) { fields.push(`description=$${i++}`); values.push(description.trim()); }
    if (labels !== undefined) { fields.push(`labels=$${i++}`); values.push(sanitizeLabels(labels)); }
    if (dueDate !== undefined) { fields.push(`due_date=$${i++}`); values.push(dueDate || null); }
    if (inSprint !== undefined) { fields.push(`in_sprint=$${i++}`); values.push(!!inSprint); }
    if (!fields.length) return res.status(400).json({ error: "Güncellenecek alan yok." });
    const changes = describeIssueChanges(issue, { status, assigneeUsername, priority, storyPoints, title, dueDate, labels });
    fields.push(`updated_at=now()`);
    values.push(req.params.k, req.params.issueKey);
    await query(
      `UPDATE project_issues SET ${fields.join(", ")} WHERE project_k=$${i++} AND issue_key=$${i}`,
      values
    );
    if (changes.length) {
      await logIssueHistory(query, req.user.username, req.params.k, req.params.issueKey, changes.join("; "));
    }
    // Bu konu bir toplantı maddesinden açılmış bir Task ise (TOPLANTI
    // projesinde, linked_issue_key ile eşleşen bir meeting_item varsa),
    // durumu buradan senkronize edilir: Task DONE olunca ilgili toplantı
    // maddesi de tamamlandı sayılır; DONE'dan geri alınırsa madde tekrar
    // açılır. Böylece Board/Backlog'dan yapılan değişiklik toplantı
    // notuna da yansır, kullanıcı iki yerde ayrı ayrı işaretlemek
    // zorunda kalmaz.
    if (req.params.k === MEETING_PROJECT_K && status !== undefined && status !== issue.status) {
      if (status === "done") {
        await query(
          "UPDATE meeting_items SET status='done' WHERE linked_issue_key=$1 AND status NOT IN ('done','cancelled')",
          [req.params.issueKey]
        );
      } else if (issue.status === "done") {
        await query(
          "UPDATE meeting_items SET status='open' WHERE linked_issue_key=$1 AND status='done'",
          [req.params.issueKey]
        );
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --------------------------- Konu ekleri (dokümanlar) ---------------------------
router.get("/:k/issues/:issueKey/attachments", requireRead("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, file_name, mime_type, size_bytes, uploaded_by, uploaded_at
       FROM project_issue_attachments WHERE project_k=$1 AND issue_key=$2 ORDER BY uploaded_at`,
      [req.params.k, req.params.issueKey]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/:k/issues/:issueKey/attachments", requireWrite("d.board"), uploadIssueAttachment, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Dosya zorunlu." });
    const issue = await query(
      "SELECT issue_key FROM project_issues WHERE project_k=$1 AND issue_key=$2",
      [req.params.k, req.params.issueKey]
    );
    if (!issue.rowCount) return res.status(404).json({ error: "Konu bulunamadı." });
    // GÜVENLİK: Content-Type istemci beyanıdır — dosyanın gerçek imzası ayrıca doğrulanır.
    if (!validateIssueAttachmentMagic(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: "Dosya içeriği beyan edilen türle eşleşmiyor." });
    }
    const ext = ISSUE_ATTACH_ALLOWED[req.file.mimetype];
    const storedName = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, storedName), req.file.buffer);
    const { rows } = await query(
      `INSERT INTO project_issue_attachments
         (project_k, issue_key, file_name, stored_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, file_name, mime_type, size_bytes, uploaded_by, uploaded_at`,
      [req.params.k, req.params.issueKey, req.file.originalname, storedName, req.file.mimetype, req.file.size, req.user.username]
    );
    await logIssueHistory(query, req.user.username, req.params.k, req.params.issueKey, `Doküman eklendi: ${req.file.originalname}`);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

// Dosyanın kendisi: path traversal'a karşı yalnızca diskteki rastgele üretilmiş ad kullanılır.
router.get("/:k/issues/:issueKey/attachments/:id/file", requireRead("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM project_issue_attachments WHERE id=$1 AND project_k=$2 AND issue_key=$3",
      [req.params.id, req.params.k, req.params.issueKey]
    );
    const att = rows[0];
    if (!att) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (!/^[a-f0-9]{32}\.[a-z0-9]+$/.test(att.stored_name)) return res.status(400).json({ error: "Geçersiz dosya kaydı." });
    const abs = path.resolve(config.uploadDir, att.stored_name);
    if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) return res.status(400).json({ error: "Geçersiz yol." });
    res.setHeader("Content-Type", att.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${att.file_name.replace(/[^\w.\-]/g, "_")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(abs);
  } catch (e) { next(e); }
});

router.delete("/:k/issues/:issueKey/attachments/:id", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "DELETE FROM project_issue_attachments WHERE id=$1 AND project_k=$2 AND issue_key=$3 RETURNING file_name, stored_name",
      [req.params.id, req.params.k, req.params.issueKey]
    );
    if (!rows.length) return res.status(404).json({ error: "Doküman bulunamadı." });
    try { fs.unlinkSync(path.join(config.uploadDir, rows[0].stored_name)); } catch (_) { /* dosya zaten yoksa yok say */ }
    await logIssueHistory(query, req.user.username, req.params.k, req.params.issueKey, `Doküman kaldırıldı: ${rows[0].file_name}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ----------------------------- Konu ilişkilendirmeleri (links) -----------------------------
// Ters yön etiketleri: blocks<->is blocked by, clones<->is cloned by,
// duplicates<->is duplicated by, relates simetriktir.
const LINK_INVERSE = { blocks: "is blocked by", clones: "is cloned by", duplicates: "is duplicated by", relates: "relates to" };
const LINK_FORWARD_LABEL = { blocks: "blocks", clones: "clones", duplicates: "duplicates", relates: "relates to" };

router.get("/:k/issues/:issueKey/links", requireRead("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pil.*, pi.title AS other_title, pi.issue_type AS other_type, pi.status AS other_status
       FROM project_issue_links pil
       JOIN project_issues pi ON pi.project_k=pil.project_k
         AND pi.issue_key = (CASE WHEN pil.source_key=$2 THEN pil.target_key ELSE pil.source_key END)
       WHERE pil.project_k=$1 AND (pil.source_key=$2 OR pil.target_key=$2)
       ORDER BY pil.created_at`,
      [req.params.k, req.params.issueKey]
    );
    const items = rows.map((r) => ({
      id: r.id,
      label: r.source_key === req.params.issueKey ? LINK_FORWARD_LABEL[r.link_type] : LINK_INVERSE[r.link_type],
      otherKey: r.source_key === req.params.issueKey ? r.target_key : r.source_key,
      otherTitle: r.other_title,
      otherType: r.other_type,
      otherStatus: r.other_status,
    }));
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/:k/issues/:issueKey/links", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { linkType, targetKey } = req.body || {};
    if (!["blocks", "clones", "duplicates", "relates"].includes(linkType)) {
      return res.status(400).json({ error: "Geçersiz ilişki türü." });
    }
    if (!targetKey || targetKey === req.params.issueKey) {
      return res.status(400).json({ error: "Geçerli bir hedef konu seçilmelidir." });
    }
    const [src, tgt] = await Promise.all([
      query("SELECT 1 FROM project_issues WHERE project_k=$1 AND issue_key=$2", [req.params.k, req.params.issueKey]),
      query("SELECT 1 FROM project_issues WHERE project_k=$1 AND issue_key=$2", [req.params.k, targetKey]),
    ]);
    if (!src.rowCount) return res.status(404).json({ error: "Kaynak konu bulunamadı." });
    if (!tgt.rowCount) return res.status(404).json({ error: "Hedef konu bulunamadı." });
    const { rows } = await query(
      `INSERT INTO project_issue_links (project_k, link_type, source_key, target_key, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.params.k, linkType, req.params.issueKey, targetKey, req.user.username]
    );
    await logIssueHistory(query, req.user.username, req.params.k, req.params.issueKey,
      `İlişki eklendi: ${LINK_FORWARD_LABEL[linkType]} ${targetKey}`);
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Bu ilişki zaten mevcut." });
    next(e);
  }
});

router.delete("/:k/issues/:issueKey/links/:linkId", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM project_issue_links WHERE id=$1 AND project_k=$2
         AND (source_key=$3 OR target_key=$3) RETURNING id, link_type, source_key, target_key`,
      [req.params.linkId, req.params.k, req.params.issueKey]
    );
    if (!rows.length) return res.status(404).json({ error: "İlişki bulunamadı." });
    const other = rows[0].source_key === req.params.issueKey ? rows[0].target_key : rows[0].source_key;
    await logIssueHistory(query, req.user.username, req.params.k, req.params.issueKey,
      `İlişki kaldırıldı: ${LINK_FORWARD_LABEL[rows[0].link_type]} ${other}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------- Konu geçmişi (history) -------------------------------
router.get("/:k/issues/:issueKey/history", requireRead("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pih.*, u.name AS user_name FROM project_issue_history pih
       LEFT JOIN users u ON u.username = pih.username
       WHERE pih.project_k=$1 AND pih.issue_key=$2 ORDER BY pih.created_at DESC`,
      [req.params.k, req.params.issueKey]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// ------------------------------------- Sprint -------------------------------------
router.put("/:k/sprint", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { sprintGoal, sprintEndsAt } = req.body || {};
    await query(
      "UPDATE projects SET sprint_goal=$1, sprint_ends_at=$2 WHERE k=$3",
      [sprintGoal || null, sprintEndsAt || null, req.params.k]
    );
    await audit(`Sprint bilgisi güncellendi: ${req.params.k}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Backlog'daki bir konuyu güncel sprint'e alır/çıkarır.
router.post("/:k/sprint/items", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { issueKey, inSprint } = req.body || {};
    // Sprinte alınan bir backlog maddesi "todo"ya geçer; sprintten çıkarılan bir madde
    // (tamamlanmamışsa) backlog'a döner. Zaten "done" olan bir maddenin durumu bozulmaz.
    await query(
      `UPDATE project_issues SET in_sprint=$1,
         status = CASE WHEN $1 AND status='backlog' THEN 'todo'
                       WHEN NOT $1 AND status != 'done' THEN 'backlog'
                       ELSE status END
       WHERE project_k=$2 AND issue_key=$3`,
      [!!inSprint, req.params.k, issueKey]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Sprint'i kapatır. İki soruyu YANITLAR olarak alır (arayüzde önceden sorulmuş olmalı):
//  - carryOver: tamamlanmamış açık maddeler yeni sprinte mi (true) yoksa backlog'a mı (false) aktarılsın
//  - openNew: sprint kapanırken hemen yeni bir sprint açılsın mı
// Kural: bir sprint hâlâ açıkken ve bitiş gününe gelinmemişken kapatılamaz/ikinci sprint açılamaz;
// bitiş gününde (veya bitiş tarihi geçmişse) kapatmaya izin verilir. Bitiş tarihi hiç
// girilmemişse (sprintEndsAt boş bırakılmışsa) kısıtlama uygulanmaz.
function isSprintClosable(project) {
  if (!project.sprint_name) return { ok: false, reason: "Açık bir sprint yok." };
  if (project.sprint_ends_at) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ends = new Date(project.sprint_ends_at); ends.setHours(0, 0, 0, 0);
    if (today < ends) {
      return { ok: false, reason: `Sprint henüz bitmedi (bitiş: ${project.sprint_ends_at.toISOString ? project.sprint_ends_at.toISOString().slice(0,10) : project.sprint_ends_at}); ancak son gününde kapatılabilir.` };
    }
  }
  return { ok: true };
}

router.post("/:k/sprint/close", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { keepInSprintKeys, openNew, newSprintGoal, newSprintEndsAt } = req.body || {};
    if (!Array.isArray(keepInSprintKeys)) return res.status(400).json({ error: "keepInSprintKeys bir dizi olmalı." });
    const proj = await query("SELECT * FROM projects WHERE k=$1", [req.params.k]);
    if (!proj.rowCount) return res.status(404).json({ error: "Proje bulunamadı." });
    const check = isSprintClosable(proj.rows[0]);
    if (!check.ok) return res.status(409).json({ error: check.reason });

    const nextNumber = (proj.rows[0].sprint_number || 0) + 1;
    const keepSet = new Set(keepInSprintKeys);

    const result = await withTransaction(async (client) => {
      // Kapanan sprintteki TÜM maddeler (rapor için önce ölçülür).
      const items = await client.query(
        "SELECT issue_key, status, story_points FROM project_issues WHERE project_k=$1 AND in_sprint=true",
        [req.params.k]
      );
      const committedPoints = items.rows.reduce((a, i) => a + i.story_points, 0);
      const doneRows = items.rows.filter((i) => i.status === "done");
      const donePoints = doneRows.reduce((a, i) => a + i.story_points, 0);
      const openRows = items.rows.filter((i) => i.status !== "done");
      const carriedOverCount = openRows.filter((i) => keepSet.has(i.issue_key)).length;

      // Tamamlanmamış ve işaretlenmemiş (backlog'a gönderilecek) maddeler.
      const toBacklog = openRows.filter((i) => !keepSet.has(i.issue_key)).map((i) => i.issue_key);
      if (toBacklog.length) {
        await client.query(
          `UPDATE project_issues SET in_sprint=false, status='backlog' WHERE project_k=$1 AND issue_key = ANY($2::text[])`,
          [req.params.k, toBacklog]
        );
      }
      // İşaretlenen açık maddeler in_sprint=true kalır (yeni sprintin otomatik parçası olurlar).
      // Tamamlanmış maddeler her durumda sprintten çıkar.
      await client.query(
        `UPDATE project_issues SET in_sprint=false WHERE project_k=$1 AND in_sprint=true AND status='done'`,
        [req.params.k]
      );

      await client.query(
        `INSERT INTO sprint_history (project_k, sprint_number, sprint_name, sprint_goal, committed_points,
           done_points, item_count, done_count, carried_over_count, closed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.params.k, proj.rows[0].sprint_number, proj.rows[0].sprint_name, proj.rows[0].sprint_goal,
         committedPoints, donePoints, items.rowCount, doneRows.length, carriedOverCount, req.user.username]
      );

      if (openNew) {
        await client.query(
          `UPDATE projects SET sprint_number=$1, sprint_name=$2, sprint_goal=$3, sprint_ends_at=$4 WHERE k=$5`,
          [nextNumber, `Sprint ${nextNumber}`, newSprintGoal || null, newSprintEndsAt || null, req.params.k]
        );
      } else {
        await client.query(
          `UPDATE projects SET sprint_name=NULL, sprint_goal=NULL, sprint_ends_at=NULL WHERE k=$1`,
          [req.params.k]
        );
      }
      return { carriedOverCount, toBacklogCount: toBacklog.length };
    });
    await audit(
      `Sprint kapatıldı: ${req.params.k} (${result.carriedOverCount} madde yeni sprinte aktarıldı, ${result.toBacklogCount} madde backlog'a alındı${openNew ? `, yeni sprint açıldı: Sprint ${nextNumber}` : ", yeni sprint açılmadı"})`,
      req.user.username
    );
    res.json({ ok: true, sprintNumber: openNew ? nextNumber : null });
  } catch (e) { next(e); }
});

// Kapanmış sprintlerin özeti (velocity raporu için).
router.get("/:k/sprint-history", requireRead("d.board"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM sprint_history WHERE project_k=$1 ORDER BY sprint_number", [req.params.k]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Aktif sprint yokken (kapatılırken "yeni sprint açma" denildiyse veya daha önce hiç
// başlatılmadıysa) yeni bir sprint başlatır. Aktif bir sprint varsa ve bitiş gününe
// gelinmediyse reddedilir (aynı anda ikinci bir sprint açılamaz).
router.post("/:k/sprint/start", requireWrite("d.board"), async (req, res, next) => {
  try {
    const { sprintGoal, sprintEndsAt } = req.body || {};
    const proj = await query("SELECT * FROM projects WHERE k=$1", [req.params.k]);
    if (!proj.rowCount) return res.status(404).json({ error: "Proje bulunamadı." });
    if (proj.rows[0].sprint_name) {
      const check = isSprintClosable(proj.rows[0]);
      if (!check.ok) return res.status(409).json({ error: "Açık bir sprint varken (son gününe gelinmeden) ikinci bir sprint açılamaz." });
    }
    const nextNumber = (proj.rows[0].sprint_number || 0) + 1;
    await query(
      `UPDATE projects SET sprint_number=$1, sprint_name=$2, sprint_goal=$3, sprint_ends_at=$4 WHERE k=$5`,
      [nextNumber, `Sprint ${nextNumber}`, sprintGoal || null, sprintEndsAt || null, req.params.k]
    );
    await audit(`Sprint başlatıldı: ${req.params.k} — Sprint ${nextNumber}`, req.user.username);
    res.json({ ok: true, sprintNumber: nextNumber });
  } catch (e) { next(e); }
});

// ---------------------------------- Stage gate ----------------------------------
router.put("/:k/gate", requireWrite("d.gate"), async (req, res, next) => {
  try {
    const { gateName, criteria, required } = req.body || {};
    if (!Array.isArray(criteria)) return res.status(400).json({ error: "Kriter listesi geçersiz." });
    await query(
      "UPDATE projects SET gate_name=$1, gate_criteria=$2, gate_required=$3, gate_signoffs='[]'::jsonb WHERE k=$4",
      [gateName || null, JSON.stringify(criteria.map((c) => ({ text: String(c.text || c).trim(), done: false }))),
       Math.max(1, parseInt(required, 10) || 1), req.params.k]
    );
    await audit(`Stage gate tanımlandı: ${req.params.k} — ${gateName}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/:k/gate/criteria/:idx/toggle", requireWrite("d.board"), async (req, res, next) => {
  try {
    const proj = await query("SELECT gate_criteria FROM projects WHERE k=$1", [req.params.k]);
    if (!proj.rowCount) return res.status(404).json({ error: "Proje bulunamadı." });
    const criteria = proj.rows[0].gate_criteria || [];
    const idx = parseInt(req.params.idx, 10);
    if (!criteria[idx]) return res.status(404).json({ error: "Kriter bulunamadı." });
    criteria[idx].done = !criteria[idx].done;
    await query("UPDATE projects SET gate_criteria=$1 WHERE k=$2", [JSON.stringify(criteria), req.params.k]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/:k/gate/sign", requireWrite("d.gate"), async (req, res, next) => {
  try {
    const proj = await query("SELECT gate_signoffs FROM projects WHERE k=$1", [req.params.k]);
    if (!proj.rowCount) return res.status(404).json({ error: "Proje bulunamadı." });
    const signoffs = proj.rows[0].gate_signoffs || [];
    if (signoffs.some((s) => s.username === req.user.username)) {
      return res.status(409).json({ error: "Bu kapıyı zaten imzaladınız." });
    }
    signoffs.push({ username: req.user.username, name: req.user.name, title: req.user.title, at: new Date().toISOString() });
    await query("UPDATE projects SET gate_signoffs=$1 WHERE k=$2", [JSON.stringify(signoffs), req.params.k]);
    await audit(`Stage gate imzalandı: ${req.params.k}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------------------------- Ekip ----------------------------------
// Ekip listesi kimin PO/BO/onaycı olduğunu belirlemek için proje yönetimi dışındaki
// ekranlarda da (ör. doküman onay zinciri) gerekir; bu bilgi hassas değildir,
// bu yüzden d.team yazma yetkisi olmayan herkes de görebilir (yalnızca oturum açık olmalı).
router.get("/:k/team", requireAuth, async (req, res, next) => {
  try {
    await ensureMandatoryTeam(req.params.k);
    const { rows } = await query(
      `SELECT pt.*, u.name, u.title, u.unit FROM project_team pt
       JOIN users u ON u.username = pt.username WHERE pt.project_k=$1 ORDER BY pt.mandatory, u.name`,
      [req.params.k]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/:k/team", requireWrite("d.team"), async (req, res, next) => {
  try {
    const { username, projectRole } = req.body || {};
    if (!username || !projectRole) return res.status(400).json({ error: "Kişi ve proje rolü zorunlu." });
    await query(
      `INSERT INTO project_team (project_k, username, project_role) VALUES ($1,$2,$3)
       ON CONFLICT (project_k, username) DO UPDATE SET project_role=$3`,
      [req.params.k, username, projectRole]
    );
    await audit(`Proje ekibine eklendi: ${username} (${projectRole}) — ${req.params.k}`, req.user.username);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:k/team/:username", requireWrite("d.team"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT mandatory FROM project_team WHERE project_k=$1 AND username=$2",
      [req.params.k, req.params.username]
    );
    if (!rows.length) return res.status(404).json({ error: "Üye bulunamadı." });
    if (rows[0].mandatory) return res.status(409).json({ error: "Zorunlu üye çıkarılamaz." });
    await query("DELETE FROM project_team WHERE project_k=$1 AND username=$2", [req.params.k, req.params.username]);
    await audit(`Proje ekibinden çıkarıldı: ${req.params.username} — ${req.params.k}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------- Dokümanlar --------------------------------
function nextStepFor(pr) {
  const idx = DOC_TYPE_ORDER.indexOf(pr.doc_type);
  return idx;
}

router.get("/:k/documents", requireRead("d.docs"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM project_documents WHERE project_k=$1 ORDER BY uploaded_at",
      [req.params.k]
    );
    const out = [];
    for (const d of rows) {
      const appr = await query(
        `SELECT pda.step_no, pda.step_name, pda.approver_username, pda.is_proxy, pda.approved_at, u.name, u.title
         FROM project_document_approvals pda JOIN users u ON u.username=pda.approver_username
         WHERE pda.document_id=$1 ORDER BY pda.step_no`,
        [d.id]
      );
      out.push({ ...d, approvals: appr.rows });
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

function uploadPdf(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Dosya yüklenemedi." });
    next();
  });
}

router.post("/:k/documents", requireWrite("d.docs"), uploadPdf, async (req, res, next) => {
  try {
    const { docType, title } = req.body || {};
    if (!req.file) return res.status(400).json({ error: "PDF dosyası zorunlu." });
    if (!DOC_TYPE_ORDER.includes(docType)) return res.status(400).json({ error: "Geçersiz doküman tipi." });
    const idx = DOC_TYPE_ORDER.indexOf(docType);
    if (idx > 0) {
      const prevType = DOC_TYPE_ORDER[idx - 1];
      const prev = await query(
        "SELECT status FROM project_documents WHERE project_k=$1 AND doc_type=$2",
        [req.params.k, prevType]
      );
      if (!prev.rowCount || prev.rows[0].status !== "onaylandi") {
        return res.status(409).json({ error: `${prevType} tamamen onaylanmadan ${docType} yüklenemez.` });
      }
    }
    const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    // GÜVENLİK: Content-Type güvenilmez (istemci beyanı) — gerçek dosya
    // içeriğinin PDF imzasıyla (%PDF-) başladığı doğrulanır.
    if (req.file.buffer.length < 5 || req.file.buffer.slice(0, 5).toString("latin1") !== "%PDF-") {
      return res.status(400).json({ error: "Dosya içeriği geçerli bir PDF değil." });
    }
    const storedName = `${crypto.randomBytes(16).toString("hex")}.pdf`;
    const fullPath = path.join(config.uploadDir, storedName);
    fs.writeFileSync(fullPath, req.file.buffer);

    const { rows } = await query(
      `INSERT INTO project_documents (project_k, doc_type, title, file_name, file_path, file_sha256, page_count, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (project_k, doc_type) DO UPDATE SET
         title=$3, file_name=$4, file_path=$5, file_sha256=$6, page_count=$7, uploaded_by=$8,
         status='onay_akisinda', current_step=1, uploaded_at=now(), reject_reason=NULL
       RETURNING id, project_k, doc_type, title, file_name, status, current_step, uploaded_by, uploaded_at`,
      [req.params.k, docType, title || req.file.originalname, req.file.originalname, storedName, sha256, 1, req.user.username]
    );
    await query("DELETE FROM project_document_approvals WHERE document_id=$1", [rows[0].id]);
    await audit(`Proje dokümanı yüklendi: ${docType} — ${req.params.k} (${sha256.slice(0, 12)}…)`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) {
    if (e.message === "Yalnızca PDF kabul edilir.") return res.status(400).json({ error: e.message });
    next(e);
  }
});

// Dosyanın kendisi: yalnızca ilgili projeye erişimi olanlar indirebilir; dosya
// adı path traversal'a karşı önce diskteki gerçek (rastgele üretilmiş) ada
// çevrilir, kullanıcıdan gelen değer asla doğrudan dosya yoluna eklenmez.
router.get("/:k/documents/:docId/file", requireRead("d.docview"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM project_documents WHERE id=$1 AND project_k=$2", [
      req.params.docId, req.params.k,
    ]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (!/^[a-f0-9]{32}\.pdf$/.test(doc.file_path)) return res.status(400).json({ error: "Geçersiz dosya kaydı." });
    const abs = path.resolve(config.uploadDir, doc.file_path);
    if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) return res.status(400).json({ error: "Geçersiz yol." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.doc_type.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(abs);
  } catch (e) { next(e); }
});

async function resolveApprover(stepNo, projectK) {
  const team = await query("SELECT username, project_role FROM project_team WHERE project_k=$1", [projectK]);
  const byRole = (role) => (team.rows.find((t) => t.project_role === role) || {}).username;
  if (stepNo === 1) return byRole("Product Owner");
  if (stepNo === 2) return byRole("Business Owner");
  if (stepNo === 3 || stepNo === 4) {
    const base = stepNo === 3 ? byRole("Product Owner") : byRole("Business Owner");
    if (!base) return null;
    const u = await query("SELECT manager_username FROM users WHERE username=$1", [base]);
    return u.rows[0] ? u.rows[0].manager_username : null;
  }
  if (stepNo === 5) return byRole("Internal Audit");
  if (stepNo === 6) {
    const u = await query("SELECT username FROM users WHERE role='control' AND title='GDIR' AND active LIMIT 1");
    return u.rows[0] ? u.rows[0].username : null;
  }
  return null;
}

router.post("/:k/documents/:docId/approve", requireRead("d.docview"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM project_documents WHERE id=$1 AND project_k=$2", [
      req.params.docId, req.params.k,
    ]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (doc.status !== "onay_akisinda") return res.status(409).json({ error: "Bu doküman onay akışında değil." });

    const step = APPROVAL_STEPS.find((s) => s.no === doc.current_step);
    const expected = await resolveApprover(step.no, req.params.k);
    let isProxy = false;
    let approver = req.user.username;
    if (expected && expected !== req.user.username) {
      return res.status(403).json({ error: "Bu adımı yalnızca beklenen kişi onaylayabilir." });
    }
    if (!expected) {
      // Beklenen kişi çözülemiyorsa yalnızca Proje Yönetim Direktörü vekaleten onaylar.
      if (req.user.role !== "pmdir") return res.status(409).json({ error: "Bu adımda kimse atanmamış; yalnızca Proje Yönetim Direktörü vekaleten onaylayabilir." });
      isProxy = true;
    }

    const result = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO project_document_approvals (document_id, step_no, step_name, approver_username, is_proxy)
         VALUES ($1,$2,$3,$4,$5)`,
        [doc.id, step.no, step.name, approver, isProxy]
      );
      const finished = step.no === 6;
      await client.query(
        `UPDATE project_documents SET current_step=$1, status=$2 WHERE id=$3`,
        [finished ? 6 : step.no + 1, finished ? "onaylandi" : "onay_akisinda", doc.id]
      );
      return { finished };
    });
    await audit(`Doküman onay adımı ${step.no} (${step.name}) tamamlandı${isProxy ? " (vekaleten)" : ""} — ${doc.doc_type}/${req.params.k}`, req.user.username);
    res.json({ step: step.no, finished: result.finished });
  } catch (e) { next(e); }
});

router.post("/:k/documents/:docId/reject", requireRead("d.docview"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 5) return res.status(400).json({ error: "Ret gerekçesi en az 5 karakter olmalı." });
    const { rows } = await query("SELECT * FROM project_documents WHERE id=$1 AND project_k=$2", [req.params.docId, req.params.k]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (doc.status !== "onay_akisinda") return res.status(409).json({ error: "Bu doküman onay akışında değil." });
    await query("UPDATE project_documents SET status='reddedildi', reject_reason=$1 WHERE id=$2", [reason.trim(), doc.id]);
    await audit(`Proje dokümanı reddedildi: ${doc.doc_type} — ${req.params.k} (${reason.trim()})`, req.user.username, false);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --------------------------- Değişiklik talepleri ---------------------------
router.get("/:k/change-requests", requireRead("d.cr"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM change_requests WHERE project_k=$1 ORDER BY created_at DESC", [req.params.k]);
    const out = [];
    for (const cr of rows) {
      const appr = await query(
        `SELECT cra.username, cra.capacity, cra.approved_at, u.name, u.title
         FROM change_request_approvals cra JOIN users u ON u.username=cra.username
         WHERE cra.change_request_id=$1 ORDER BY cra.approved_at`,
        [cr.id]
      );
      out.push({ ...cr, approvals: appr.rows });
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

router.post("/:k/change-requests", requireWrite("d.cr"), async (req, res, next) => {
  try {
    const { title, reason, impact } = req.body || {};
    if (!title || title.trim().length < 5) return res.status(400).json({ error: "Başlık en az 5 karakter olmalı." });
    const count = await query("SELECT COUNT(*)::int AS n FROM change_requests WHERE project_k=$1", [req.params.k]);
    const no = `CR-${String(count.rows[0].n + 1).padStart(3, "0")}`;
    const { rows } = await query(
      `INSERT INTO change_requests (project_k, no, title, reason, impact, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.k, no, title.trim(), reason || "", impact || "", req.user.username]
    );
    await audit(`Değişiklik talebi oluşturuldu: ${no} — ${req.params.k}`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/:k/change-requests/:id/approve", requireRead("d.cr"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM change_requests WHERE id=$1 AND project_k=$2", [req.params.id, req.params.k]);
    const cr = rows[0];
    if (!cr) return res.status(404).json({ error: "Değişiklik talebi bulunamadı." });
    if (cr.status !== "onayda") return res.status(409).json({ error: "Bu talep onay bekleyen durumda değil." });
    if (cr.created_by === req.user.username) return res.status(409).json({ error: "Kendi talebinizi onaylayamazsınız." });

    // Sunucu, istemcinin bildirdiği sıfatı (manager/team) körü körüne kabul
    // etmez: talebi açanın yöneticisi mi, yoksa proje ekibinde mi olduğunu
    // kendisi doğrular (Proje Yönetim Direktörü her iki sıfatla da onaylayabilir).
    const creator = await query("SELECT manager_username FROM users WHERE username=$1", [cr.created_by]);
    const isManager = req.user.role === "pmdir" || (creator.rows[0] && creator.rows[0].manager_username === req.user.username);
    const team = await query("SELECT 1 FROM project_team WHERE project_k=$1 AND username=$2", [req.params.k, req.user.username]);
    const isTeam = req.user.role === "pmdir" || team.rowCount > 0;

    const existing = await query("SELECT DISTINCT capacity FROM change_request_approvals WHERE change_request_id=$1", [cr.id]);
    const have = existing.rows.map((r) => r.capacity);
    const needManager = !have.includes("manager");
    const needTeam = !have.includes("team");
    let capacity = null;
    if (needManager && isManager) capacity = "manager";
    else if (needTeam && isTeam) capacity = "team";
    if (!capacity) {
      return res.status(403).json({
        error: needManager
          ? "Bu talebi açan kişinin yöneticisi henüz onaylamadı; önce o onaylamalı."
          : "Proje ekibinden birinin onayı gerekiyor; bu sıfatla onay veremezsiniz.",
      });
    }

    await query(
      `INSERT INTO change_request_approvals (change_request_id, username, capacity) VALUES ($1,$2,$3)`,
      [cr.id, req.user.username, capacity]
    );
    const approvals = await query("SELECT DISTINCT capacity FROM change_request_approvals WHERE change_request_id=$1", [cr.id]);
    const capacities = approvals.rows.map((r) => r.capacity);
    const fullyApproved = capacities.includes("manager") && capacities.includes("team");
    if (fullyApproved) {
      await query("UPDATE change_requests SET status='onaylandi' WHERE id=$1", [cr.id]);
    }
    await audit(`Değişiklik talebi onayı (${capacity}): ${cr.no}${fullyApproved ? " — tam onaylandı" : ""}`, req.user.username);
    res.json({ ok: true, capacity, fullyApproved });
  } catch (e) { next(e); }
});

router.post("/:k/change-requests/:id/reject", requireRead("d.cr"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM change_requests WHERE id=$1 AND project_k=$2", [req.params.id, req.params.k]);
    const cr = rows[0];
    if (!cr) return res.status(404).json({ error: "Değişiklik talebi bulunamadı." });
    if (cr.created_by === req.user.username) return res.status(409).json({ error: "Kendi talebinizi reddedemezsiniz." });
    await query("UPDATE change_requests SET status='reddedildi' WHERE id=$1", [cr.id]);
    await audit(`Değişiklik talebi reddedildi: ${cr.no}`, req.user.username, false);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------ Toplantı notları ----------------------------
// Her toplantı gündem maddesi otomatik olarak "Toplantı" adlı sabit bir proje
// altında, o toplantıya özel bir Epic'in altına Task olarak açılır. Böylece
// toplantıda alınan aksiyonlar proje yönetimi modülünde de (atanan kişinin
// "İşlerim" ekranı dahil) izlenebilir hale gelir.
const MEETING_PROJECT_K = "TOPLANTI";
const MEETING_PROJECT_NAME = "Toplantı";

async function ensureMeetingProject(client, creatorUsername) {
  const existing = await client.query("SELECT k FROM projects WHERE k=$1", [MEETING_PROJECT_K]);
  if (existing.rowCount) return;
  await client.query(
    `INSERT INTO projects (k, name, method, lead_username, created_by)
     VALUES ($1,$2,'Kanban',$3,$3)`,
    [MEETING_PROJECT_K, MEETING_PROJECT_NAME, creatorUsername]
  );
  await client.query(
    `INSERT INTO project_team (project_k, username, project_role, mandatory)
     VALUES ($1,$2,'Product Owner',false) ON CONFLICT DO NOTHING`,
    [MEETING_PROJECT_K, creatorUsername]
  );
}

// Toplantı maddesi ataması yapılacak kişi, "Toplantı" projesinin ekibinde
// değilse otomatik eklenir — aksi halde konu oluşturmadaki "atanacak kişi
// ekipte olmalı" kuralı toplantı katılımcıları için de zorlanmış olur ve
// hiçbir katılımcıya görev atanamazdı.
async function ensureMeetingTeamMember(client, username) {
  await client.query(
    `INSERT INTO project_team (project_k, username, project_role, mandatory)
     VALUES ($1,$2,'Katılımcı',false) ON CONFLICT DO NOTHING`,
    [MEETING_PROJECT_K, username]
  );
}

function canSeeMeeting(role, username, participants, createdByWrite) {
  if (MEETING_ALWAYS_ROLES.includes(role)) return true;
  if (createdByWrite) return true; // pm/pmdir tüm notları görür
  return participants.includes(username);
}

router.get("/meetings", requireRead("d.meeting"), async (req, res, next) => {
  try {
    const projFilter = req.query.project || "ALL";
    // Kapsamdaki her periyodik SERİ (proje/konu + periyodiklik) için en son
    // oluşumu bulup bugüne kadar otomatik ilerlet — kullanıcı hiçbir şeye
    // tıklamadan, sonraki toplantının tarihi geldiğinde kendiliğinden açılır
    // ve hâlâ açık maddeler oraya taşınır.
    const seriesRows = await query(
      `SELECT DISTINCT ON (project_k, project_other_subject, recurrence) *
       FROM meetings WHERE recurrence IS NOT NULL AND ($1='ALL' OR project_k=$1)
       ORDER BY project_k, project_other_subject, recurrence, meeting_date DESC`,
      [projFilter]
    );
    for (const s of seriesRows.rows) {
      await withTransaction((client) => autoAdvanceSeries(client, s));
    }

    const { rows: meetings } = await query(
      `SELECT * FROM meetings WHERE ($1='ALL' OR project_k=$1) ORDER BY meeting_date DESC, id DESC`,
      [projFilter]
    );
    const canWriteMeetings = await canWrite(req.user.role, "d.meeting");
    const out = [];
    for (const m of meetings) {
      const parts = await query("SELECT username FROM meeting_participants WHERE meeting_id=$1", [m.id]);
      const participantNames = parts.rows.map((p) => p.username);
      if (!canSeeMeeting(req.user.role, req.user.username, participantNames, canWriteMeetings)) continue;
      const items = await query("SELECT * FROM meeting_items WHERE meeting_id=$1", [m.id]);
      out.push({ ...m, participants: participantNames, items: items.rows });
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

router.post("/meetings", requireWrite("d.meeting"), async (req, res, next) => {
  try {
    const { projectK, otherSubject, title, date, time, notes, participants, items, recurrence } = req.body || {};
    if (!projectK && !otherSubject) return res.status(400).json({ error: "Proje veya toplantı konusu (Diğer) zorunlu." });
    if (!date) return res.status(400).json({ error: "Tarih zorunlu." });
    if (!Array.isArray(participants) || !participants.length) return res.status(400).json({ error: "En az bir katılımcı gerekli." });
    if (recurrence && !["weekly", "monthly", "quarterly"].includes(recurrence)) {
      return res.status(400).json({ error: "Geçersiz periyodiklik." });
    }
    // Her gündem maddesi mutlaka bir kişiye atanmalıdır (bitiş tarihi opsiyoneldir).
    for (const it of items || []) {
      if (!it.text || !it.text.trim()) return res.status(400).json({ error: "Gündem maddesi metni boş olamaz." });
      if (!it.assigneeUsername) {
        return res.status(400).json({ error: `"${it.text}" maddesi için bir sorumlu (assignee) seçilmelidir.` });
      }
    }

    // Konu anahtarı öneki: başlık varsa ondan, yoksa gerçek projenin adından,
    // o da yoksa "Diğer" konu metninden türetilir (örn. "Mobil işlem
    // platformu" -> "MOBİL"). Böylece aynı konudaki ardışık toplantıların
    // Epic+Task'ları (bugün, gelecek hafta, ...) aynı önek+sayaçtan devam eder.
    let subjectSource = (title || "").trim();
    if (!subjectSource && projectK) {
      const projRow = await query("SELECT name FROM projects WHERE k=$1", [projectK]);
      subjectSource = projRow.rows[0] ? projRow.rows[0].name : "";
    }
    if (!subjectSource) subjectSource = otherSubject || "";
    const subjectPrefix = deriveSubjectPrefix(subjectSource);
    const explicitTitle = (title || "").trim() || otherSubject || null;

    const meeting = await withTransaction(async (client) => {
      let epicKey = null;
      let meetingTitle = explicitTitle;
      if ((items || []).length) {
        await ensureMeetingProject(client, req.user.username);
        const uniqueAssignees = [...new Set(items.map((it) => it.assigneeUsername))];
        for (const u of uniqueAssignees) await ensureMeetingTeamMember(client, u);
        // Özel bir başlık/konu verilmemişse, toplantının görünen adı da
        // Epic'in anahtarından türetilir ("MOBİL1" -> "MOBİL 1") — Meeting
        // Notes listesi ile Backlog'daki Epic başlığı böylece birebir eşleşir.
        if (!meetingTitle && subjectPrefix) {
          const previewKey = await nextKeyForPrefix(client, MEETING_PROJECT_K, subjectPrefix);
          meetingTitle = formatKeyAsLabel(previewKey);
        }
        if (!meetingTitle) meetingTitle = "Toplantı Notu";
        const epic = await insertIssueRow(client, MEETING_PROJECT_K, {
          issueType: "Epic",
          title: meetingTitle,
          description: notes || "",
          createdBy: req.user.username,
          createdAt: date, // Task'lar gibi Epic de toplantı tarihiyle açılmış görünür
          keyPrefix: subjectPrefix, // Epic de Task'larla AYNI konu sayacından ilk numarayı alır
        });
        epicKey = epic.issue_key;
        await logIssueHistory(client.query.bind(client), req.user.username, MEETING_PROJECT_K, epicKey, `Konu oluşturuldu (toplantı notu): ${epic.title}`);
      }
      if (!meetingTitle) meetingTitle = "Toplantı Notu";

      const m = await client.query(
        `INSERT INTO meetings (project_k, project_other_subject, title, meeting_date, meeting_time, notes, created_by, recurrence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [projectK || null, projectK ? null : otherSubject, meetingTitle, date, time || null, notes || null, req.user.username, recurrence || null]
      );
      for (const p of participants) {
        await client.query("INSERT INTO meeting_participants (meeting_id, username) VALUES ($1,$2)", [m.rows[0].id, p]);
      }

      for (const it of items || []) {
        let linkedIssueKey = null;
        let carriedFromMeetingId = null;
        if (it.carriedQueueId) {
          // Taşınan madde: yeni bir Task AÇILMAZ, önceki toplantıda zaten
          // oluşturulmuş Task'ın anahtarı yeniden kullanılır.
          const cq = await client.query(
            "SELECT linked_issue_key, from_meeting_id FROM meeting_carry_queue WHERE id=$1 AND project_k=$2",
            [it.carriedQueueId, projectK]
          );
          linkedIssueKey = cq.rows[0] ? cq.rows[0].linked_issue_key : null;
          carriedFromMeetingId = cq.rows[0] ? cq.rows[0].from_meeting_id : null;
          await client.query("DELETE FROM meeting_carry_queue WHERE id=$1", [it.carriedQueueId]);
        } else if (epicKey) {
          const task = await insertIssueRow(client, MEETING_PROJECT_K, {
            issueType: "Task",
            title: it.text,
            parentKey: epicKey,
            assigneeUsername: it.assigneeUsername,
            dueDate: it.dueDate || null,
            status: "backlog", // Jira "board"a değil doğrudan backlog'a düşer
            createdBy: req.user.username,
            createdAt: date, // "Created" alanı, notun girildiği an değil TOPLANTI tarihini gösterir
            keyPrefix: subjectPrefix, // "MOBİL1, MOBİL2, ..." gibi konuya özel sürekli sayaç
          });
          linkedIssueKey = task.issue_key;
          await logIssueHistory(client.query.bind(client), req.user.username, MEETING_PROJECT_K, linkedIssueKey, `Konu oluşturuldu (toplantı notu): ${task.title}`);
        }
        await client.query(
          `INSERT INTO meeting_items (meeting_id, text, status, carried_from_meeting_id, assignee_username, due_date, linked_issue_key)
           VALUES ($1,$2,'open',$3,$4,$5,$6)`,
          [m.rows[0].id, it.text, carriedFromMeetingId, it.assigneeUsername, it.dueDate || null, linkedIssueKey]
        );
      }
      return m.rows[0];
    });

    const users = await query("SELECT username, email FROM users WHERE username = ANY($1)", [participants]);
    let sentCount = 0;
    for (const u of users.rows) {
      const ok = await sendMail(u.email, `${meeting.title} — toplantı notu paylaşıldı`, "Toplantı notu portalda yayınlandı.");
      if (ok) sentCount += 1;
    }
    await audit(`Toplantı notu oluşturuldu: ${meeting.title} · bildirim: ${sentCount}/${users.rowCount}`, req.user.username);
    res.status(201).json({ item: meeting, mailSent: sentCount, mailTotal: users.rowCount });
  } catch (e) { next(e); }
});

// Periyodik toplantılarda "sonraki oluşum" tarihini hesaplar: haftalık ->
// +7 gün (aynı haftanın günü), aylık -> +1 ay (aynı gün), üç aylık -> +3 ay.
function computeNextMeetingDate(dateStr, recurrence) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (recurrence === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  return d.toISOString().slice(0, 10);
}

// Periyodik bir toplantı serisini BUGÜNE kadar otomatik ilerletir: sonraki
// oluşumun tarihi gelmiş/geçmişse (ve henüz oluşturulmamışsa) o toplantı
// otomatik açılır, önceki oluşumda hâlâ AÇIK olan TÜM maddeler (kullanıcı
// hiçbir şeye tıklamadan) oraya taşınır — yeni Task AÇILMAZ, mevcut Task'ın
// anahtarı olduğu gibi korunur. Birden fazla oluşum kaçırılmışsa (örn. uygulama
// haftalarca açılmadıysa) zincirleme olarak hepsi sırayla oluşturulur.
async function autoAdvanceSeries(client, meeting) {
  if (!meeting.recurrence) return;
  const today = new Date().toISOString().slice(0, 10);
  let current = meeting;
  let guard = 0;
  while (guard++ < 52) {
    const dateStr = current.meeting_date instanceof Date ? current.meeting_date.toISOString().slice(0, 10) : String(current.meeting_date).slice(0, 10);
    const nextDate = computeNextMeetingDate(dateStr, current.recurrence);
    if (nextDate > today) break; // sırası henüz gelmedi

    const existing = await client.query(
      `SELECT * FROM meetings WHERE project_k IS NOT DISTINCT FROM $1 AND project_other_subject IS NOT DISTINCT FROM $2
         AND recurrence=$3 AND meeting_date=$4`,
      [current.project_k, current.project_other_subject, current.recurrence, nextDate]
    );
    if (existing.rowCount) {
      current = existing.rows[0];
      continue;
    }

    const parts = await client.query("SELECT username FROM meeting_participants WHERE meeting_id=$1", [current.id]);
    const ins = await client.query(
      `INSERT INTO meetings (project_k, project_other_subject, title, meeting_date, meeting_time, notes, created_by, recurrence)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7) RETURNING *`,
      [current.project_k, current.project_other_subject, current.title, nextDate, current.meeting_time, current.created_by, current.recurrence]
    );
    const nextMeeting = ins.rows[0];
    for (const p of parts.rows) {
      await client.query("INSERT INTO meeting_participants (meeting_id, username) VALUES ($1,$2)", [nextMeeting.id, p.username]);
    }
    const openItems = await client.query("SELECT * FROM meeting_items WHERE meeting_id=$1 AND status='open'", [current.id]);
    for (const it of openItems.rows) {
      await client.query(
        `INSERT INTO meeting_items (meeting_id, text, status, assignee_username, due_date, linked_issue_key, carried_from_meeting_id)
         VALUES ($1,$2,'open',$3,$4,$5,$6)`,
        [nextMeeting.id, it.text, it.assignee_username, it.due_date, it.linked_issue_key, current.id]
      );
      await client.query("UPDATE meeting_items SET status='carried' WHERE id=$1", [it.id]);
    }
    current = nextMeeting;
  }
}

router.post("/meetings/:id/items/:itemId/status", requireWrite("d.meeting"), async (req, res, next) => {
  try {
    const { status } = req.body || {}; // 'open' | 'done' | 'cancelled' — 'carried' artık yalnızca otomatik/dahili bir durumdur
    if (!["open", "done", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Geçersiz durum." });
    }
    const item = await query("SELECT * FROM meeting_items WHERE id=$1 AND meeting_id=$2", [req.params.itemId, req.params.id]);
    if (!item.rowCount) return res.status(404).json({ error: "Madde bulunamadı." });

    await query("UPDATE meeting_items SET status=$1 WHERE id=$2", [status, req.params.itemId]);
    await audit(`Toplantı maddesi durumu değişti: #${req.params.itemId} -> ${status}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/:k/meetings/carry-queue", requireRead("d.meeting"), async (req, res, next) => {
  try {
    // linked_issue_key varsa, ilgili Task'ın güncel assignee/due_date'i de
    // döndürülür — yeni toplantı formunda bu madde otomatik eklenirken
    // sorumlu/tarih önceden doldurulabilsin diye.
    const { rows } = await query(
      `SELECT cq.*, pi.assignee_username AS linked_assignee_username, pi.due_date AS linked_due_date,
         pi.status AS linked_status
       FROM meeting_carry_queue cq
       LEFT JOIN project_issues pi ON pi.project_k=$2 AND pi.issue_key=cq.linked_issue_key
       WHERE cq.project_k=$1 ORDER BY cq.created_at`,
      [req.params.k, MEETING_PROJECT_K]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// ---------------------------------- Gantt -----------------------------------
router.get("/:k/gantt", requireRead("d.gantt"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM gantt_tasks WHERE project_k=$1 ORDER BY start_date", [req.params.k]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/:k/gantt", requireWrite("d.gantt"), async (req, res, next) => {
  try {
    const { name, startDate, endDate, progress } = req.body || {};
    if (!name || !startDate || !endDate) return res.status(400).json({ error: "Görev adı, başlangıç ve bitiş tarihi zorunlu." });
    const { rows } = await query(
      `INSERT INTO gantt_tasks (project_k, name, start_date, end_date, progress, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.k, name, startDate, endDate, progress || 0, req.user.username]
    );
    await audit(`Gantt görevi eklendi: ${name} — ${req.params.k}`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:k/gantt/:id", requireWrite("d.gantt"), async (req, res, next) => {
  try {
    await query("DELETE FROM gantt_tasks WHERE id=$1 AND project_k=$2", [req.params.id, req.params.k]);
    await audit(`Gantt görevi silindi: #${req.params.id} — ${req.params.k}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
