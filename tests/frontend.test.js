"use strict";
// Frontend regresyon testleri: index.html'i (tek dosyalık uygulama) jsdom ile
// yükleyip, demo modda (backend'e bağlanmadan) en kritik kullanıcı akışlarını
// doğrular. Amaç %100 kapsam değil — geliştirme boyunca defalarca elle
// doğrulanmış, regresyon riski en yüksek akışların kalıcı, otomatik bir
// güvenlik ağı olarak saklanmasıdır.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const HTML = fs.readFileSync(HTML_PATH, "utf8");

let server, baseUrl;

test.before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Her test kendi jsdom penceresini açar (testler arası state sızıntısını önler).
// window.fetch'i "no network" ile başarısız kılmak, uygulamanın checkLiveBackend()
// üzerinden otomatik olarak demo moda düşmesini sağlar.
async function openDemoApp() {
  const dom = await JSDOM.fromURL(baseUrl, { runScripts: "dangerously", resources: "usable" });
  const { window } = dom;
  window.fetch = async () => { throw new Error("no network (demo mod testi)"); };
  window.addEventListener("unhandledrejection", (e) => {
    throw (e.reason instanceof Error ? e.reason : new Error(String(e.reason)));
  });
  await sleep(400);
  return { dom, window, doc: window.document, app: window.document.getElementById("app") };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function click(app, window, selectorOrDataA, { prefix = false, wait = 250 } = {}) {
  const els = [...app.querySelectorAll("[data-a]")];
  const el = prefix
    ? els.find((e) => e.dataset.a.startsWith(selectorOrDataA))
    : els.find((e) => e.dataset.a === selectorOrDataA);
  if (!el) throw new Error("data-a bulunamadı: " + selectorOrDataA);
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(wait);
  return el;
}

function setVal(doc, id, value) {
  const el = doc.getElementById(id);
  if (!el) throw new Error("Element bulunamadı: #" + id);
  el.value = value;
}

test("demo mod: giriş ekranı yükleniyor ve demo kullanıcıyla oturum açılabiliyor", async () => {
  const { window, doc, app } = await openDemoApp();
  assert.ok(app.innerHTML.includes("Prototip hesapları") || doc.getElementById("lu"), "giriş ekranı görünmüyor");
  await click(app, window, "fill:10", { wait: 700 });
  assert.ok(app.innerHTML.includes("Project Management"), "giriş sonrası ana ekran/modüller görünmüyor");
});

test("modül navigasyonu: Project Management modülüne geçilebiliyor ve Backlog ekranı açılıyor", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });
  await click(app, window, "mod:delivery");
  await click(app, window, "scr:d.backlog", { wait: 300 });
  const projSel = doc.getElementById("projSelectDropdown");
  assert.ok(projSel, "proje seçim dropdown'ı yok");
  projSel.value = "0";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  assert.ok(app.querySelector("a[data-a^='issue:']"), "Backlog'da tıklanabilir issue key'i yok");
});

test("issue key'leri Backlog'da ve Sprint ekranında tıklanabilir (issueKeyLink kullanılıyor)", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });
  await click(app, window, "mod:delivery");
  await click(app, window, "scr:d.sprint", { wait: 300 });
  const projSel = doc.getElementById("projSelectDropdown");
  projSel.value = "0";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  const keyLinks = [...app.querySelectorAll("a[data-a^='issue:']")];
  assert.ok(keyLinks.length > 0, "Sprint ekranında tıklanabilir issue key'i bulunamadı");
  const firstKey = keyLinks[0].textContent;
  keyLinks[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes(firstKey) && app.querySelector("[data-a^='issueSetPri:']"), "key tıklanınca issue paneli açılmadı");
});

test("otomasyon kuralları: oluşturma, listede görünme, devre dışı bırakma, silme", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });
  await click(app, window, "mod:delivery");
  await click(app, window, "scr:d.backlog", { wait: 300 });
  const projSel = doc.getElementById("projSelectDropdown");
  projSel.value = "0";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);

  await click(app, window, "automationRulesOpen:", { prefix: true, wait: 300 });
  await click(app, window, "automationRuleNew", { wait: 300 });
  setVal(doc, "fAutoName", "Frontend test kuralı");
  await click(app, window, "automationRuleSave:", { prefix: true, wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend test kuralı"), "otomasyon kuralı listede görünmüyor");

  const toggleBtn = app.querySelector("[data-a^='automationRuleToggle:']");
  assert.ok(toggleBtn.className.includes("on"), "yeni kural varsayılan olarak etkin değil");
  toggleBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(200);
  const toggleAfter = app.querySelector("[data-a^='automationRuleToggle:']");
  assert.ok(!toggleAfter.className.includes("on"), "devre dışı bırakma çalışmadı");

  const delBtn = app.querySelector("[data-a^='automationRuleDelete:']");
  delBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(!app.innerHTML.includes("Frontend test kuralı"), "kural silindikten sonra hâlâ görünüyor");
});

test("kayıtlı filtreler: oluşturma, uygulama (proje+kriterler geri yüklenir), silme", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });
  await click(app, window, "mod:delivery");
  await click(app, window, "scr:d.allissues", { wait: 300 });
  const projSel = doc.getElementById("projSelectDropdown");
  projSel.value = "0";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);

  setVal(doc, "fAllIssuesStatus", "todo");
  await click(app, window, "allIssuesFilterApply", { wait: 300 });
  await click(app, window, "savedFilterSaveOpen:", { prefix: true, wait: 300 });
  setVal(doc, "fSavedFilterName", "Frontend test filtresi");
  await click(app, window, "savedFilterSave:", { prefix: true, wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend test filtresi"), "kayıtlı filtre listede görünmüyor");

  await click(app, window, "allIssuesFilterClear", { wait: 300 });
  await click(app, window, "savedFilterApply:", { prefix: true, wait: 300 });
  assert.equal(doc.getElementById("fAllIssuesStatus").value, "todo", "kayıtlı filtre uygulanınca durum geri yüklenmedi");

  const delBtn = app.querySelector("[data-a^='savedFilterDelete:']");
  delBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(!app.innerHTML.includes("Frontend test filtresi"), "filtre silindikten sonra hâlâ görünüyor");
});

test("kişisel to-do: ekleme, Done+Completion Date ile arşivlenme, arşivde görünme, filtreler", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });

  assert.ok(app.innerHTML.includes("Kişisel notlarım"), "to-do widget'ı ana sayfada yok");

  setVal(doc, "todoNewDescription", "Frontend test görevi");
  await click(app, window, "todoAdd", { wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend test görevi"), "yeni to-do eklenmedi");

  const toggleBtn = [...app.querySelectorAll("[data-a^='todoToggleDone:']")]
    .find((e) => e.closest("div").parentElement.innerHTML.includes("Frontend test görevi"));
  const todoId = toggleBtn.dataset.a.split(":")[1];
  toggleBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  const compInput = doc.getElementById("todoCompletion" + todoId);
  assert.ok(compInput, "Done işaretlenince completion date alanı açılmadı");

  compInput.value = "2026-01-01";
  compInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  assert.ok(!app.innerHTML.includes("Frontend test görevi"), "completion date girilince arşive gitmedi");

  await click(app, window, "todoArchiveOpen", { wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend test görevi"), "arşivde görünmüyor");

  const delBtn = [...app.querySelectorAll("[data-a^='todoDelete:']")][0];
  delBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes("Kaydı sil"), "silme onay diyaloğu açılmadı");
  await click(app, window, "todoDeleteCancel:", { prefix: true, wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend test görevi"), "'Hayır' sonrası kayıt yanlışlıkla silindi");
  assert.ok(app.innerHTML.includes("Arşivlenmiş notlar") && !app.innerHTML.includes("Kaydı sil"),
    "'Hayır' sonrası arşiv diyaloğuna geri dönülmedi");
});

test("kişisel to-do: durum ve tarih aralığı filtreleri doğru sonuç veriyor", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });

  assert.ok(app.innerHTML.includes("Sprint retro notlarını yaz"), "seed demo notu görünmüyor");
  assert.ok(app.innerHTML.includes("Bütçe toplantısı"), "seed demo notu görünmüyor");

  setVal(doc, "todoFilterStatus", "waiting");
  await click(app, window, "todoFilterApply", { wait: 300 });
  assert.ok(app.innerHTML.includes("Bütçe toplantısı"), "waiting filtresi doğru kalemi göstermiyor");
  assert.ok(!app.innerHTML.includes("Sprint retro notlarını yaz"), "waiting filtresi prog kalemini gizlemiyor");

  await click(app, window, "todoFilterClear", { wait: 300 });
  assert.ok(app.innerHTML.includes("Sprint retro notlarını yaz"), "Temizle sonrası kalem geri gelmedi");
});

test("kişisel to-do: gecikmiş (overdue) kayıt kırmızı çerçeveli gösteriliyor", async () => {
  const { window, doc, app } = await openDemoApp();
  await click(app, window, "fill:10", { wait: 700 });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  setVal(doc, "todoNewDescription", "Gecikmiş frontend test görevi");
  setVal(doc, "todoNewDueDate", yesterday.toISOString().slice(0, 10));
  await click(app, window, "todoAdd", { wait: 300 });

  const html = app.innerHTML;
  const idx = html.indexOf("Gecikmiş frontend test görevi");
  const rowStart = html.lastIndexOf('<div style="padding:8px 4px', idx);
  assert.ok(html.slice(rowStart, idx).includes("var(--er-fg)"), "gecikmiş kayıt kırmızı çerçeveli değil");
});
