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
  // "input" event'i tetiklenmezse, uygulamanın genel oninput tabanlı
  // state-bağlama mekanizması (S.f[key]=e.target.value) hiç çalışmaz —
  // bir sonraki render()'da DOM yeniden kurulunca girilen değer sessizce
  // kaybolur. Gerçek bir tarayıcıda kullanıcı yazarken bu event zaten
  // tetiklenir; burada manuel olarak tetiklemek gerekiyor.
  el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true }));
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

async function clickPrefix(app, window, prefix, { wait = 250 } = {}) {
  const el = [...app.querySelectorAll("[data-a]")].find((e) => e.dataset.a.startsWith(prefix));
  if (!el) throw new Error("data-a prefix bulunamadı: " + prefix);
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(wait);
  return el;
}

test("özel alanlar (custom fields): tanımlama (pmdir), issue panelinde gösterim ve değer kaydetme", async () => {
  const { window, doc, app } = await openDemoApp();
  // d.projadmin ekranı yalnızca pmdir rolüne açıktır (bkz. ACCESS tablosu) —
  // demo verideki pmdir kullanıcısı adına göre bulunur (index sabit değildir).
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  assert.ok(bayramBtn, "pmdir demo kullanıcısı (Bayram Elmas) giriş ekranında bulunamadı");
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:delivery");
  await click(app, window, "scr:d.projadmin", { wait: 300 });
  const projSel = doc.getElementById("projSelectDropdown");
  projSel.value = "0";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);

  assert.ok(app.innerHTML.includes("Özel Alanlar"), "Project Admin ekranında 'Özel Alanlar' kartı yok");

  setVal(doc, "fCustomFieldName", "Frontend Test Alanı");
  await clickPrefix(app, window, "customFieldAdd:", { wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend Test Alanı"), "tanımlanan alan Project Admin listesinde görünmüyor");

  // Backlog'a git, bir issue aç, alanın orada da göründüğünü ve değer
  // girilip kaydedilebildiğini doğrula.
  await click(app, window, "scr:d.backlog", { wait: 300 });
  const projSel2 = doc.getElementById("projSelectDropdown");
  projSel2.value = "0";
  projSel2.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  const keyLink = app.querySelector("a[data-a^='issue:']");
  assert.ok(keyLink, "Backlog'da tıklanabilir issue key'i yok");
  keyLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);

  assert.ok(app.innerHTML.includes("Frontend Test Alanı"), "tanımlanan özel alan issue panelinde görünmüyor");
  const cfInput = [...doc.querySelectorAll("input")].find((el) => el.id.startsWith("fCF"));
  assert.ok(cfInput, "özel alan input'u issue panelinde bulunamadı");
  cfInput.value = "Test Değeri 123";
  await clickPrefix(app, window, "customValueSave:", { wait: 300 });
  assert.ok(app.innerHTML.includes("Kaydedildi"), "değer kaydedilince toast görünmedi");
  assert.ok(app.innerHTML.includes("Test Değeri 123"), "kaydedilen değer inputta kalıcı değil");
});

test("wiki: sayfa oluşturma, markdown render, düzenleme, versiyon geçmişi, silme onayı", async () => {
  const { window, doc, app } = await openDemoApp();
  // Wiki sayfalarını yalnızca pm/pmdir düzenleyebilir — Bayram Elmas (pmdir).
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  assert.ok(bayramBtn, "pmdir demo kullanıcısı bulunamadı");
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });
  assert.ok(app.innerHTML.includes("Genel Bilgi Tabanı"), "Genel wiki space'i görünmüyor");

  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  assert.ok(app.innerHTML.includes("üst düzey"), "yeni sayfa diyaloğu hedef space/konumu belirtmiyor");
  setVal(doc, "fWikiNewTitle", "Frontend Test Sayfası");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend Test Sayfası"), "yeni sayfa sidebar'da görünmüyor");
  assert.ok(doc.getElementById("fWikiContent"), "sayfa oluşturulunca düzenleme moduna geçilmedi");

  setVal(doc, "fWikiContent", "# Başlık\nBu **kalın** metin içerir.\n\n- Madde 1\n- Madde 2");
  await clickPrefix(app, window, "wikiSavePage:", { wait: 300 });
  assert.ok(app.innerHTML.includes("<h2"), "markdown başlığı render edilmedi");
  assert.ok(app.innerHTML.includes("<b>kalın</b>"), "markdown kalın metni render edilmedi");
  assert.ok(app.innerHTML.includes("<li>Madde 1</li>"), "markdown liste öğesi render edilmedi");

  // Alt sayfa oluşturma: mevcut sayfa görüntülenirken "+ Alt sayfa" butonu
  // ile açılan diyalog, hedef üst sayfayı açıkça belirtmeli.
  const childBtn = [...app.querySelectorAll("[data-a^='wikiNewPage:']")].find((e) => e.dataset.a !== "wikiNewPage:");
  assert.ok(childBtn, "'+ Alt sayfa' butonu bulunamadı");
  childBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes("ALTINA") && app.innerHTML.includes("Frontend Test Sayfası"),
    "alt sayfa diyaloğu hedef üst sayfayı belirtmiyor");
  setVal(doc, "fWikiNewTitle", "Alt Sayfa Testi");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  await click(app, window, "wikiEditCancel", { wait: 300 });
  assert.ok(app.innerHTML.includes("Alt Sayfa Testi"), "alt sayfa sidebar'da (hiyerarşi içinde) görünmüyor");

  // Breadcrumb: alt sayfaya gidince üst sayfanın adı yol olarak görünmeli.
  const childLink = [...app.querySelectorAll("[data-a^='wikiOpenPage:']")].find((e) => e.textContent.includes("Alt Sayfa Testi"));
  assert.ok(childLink, "alt sayfaya tıklanabilir link yok");
  childLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes(" / ") && app.innerHTML.includes("Frontend Test Sayfası"),
    "breadcrumb'da üst sayfa görünmüyor");

  await click(app, window, "wikiEditStart", { wait: 300 });
  setVal(doc, "fWikiContent", "Güncellenmiş içerik");
  await clickPrefix(app, window, "wikiSavePage:", { wait: 300 });
  await clickPrefix(app, window, "wikiVersionsOpen:", { wait: 300 });
  assert.ok(app.innerHTML.includes("Versiyon geçmişi"), "versiyon geçmişi diyaloğu açılmadı");
  await click(app, window, "dlgClose", { wait: 300 });

  // Silme onayı: Hayır -> sayfa korunur; Evet -> sayfa silinir.
  await clickPrefix(app, window, "wikiDeletePage:", { wait: 300 });
  assert.ok(app.innerHTML.includes("Sayfayı sil"), "silme onay diyaloğu açılmadı");
  await click(app, window, "dlgClose", { wait: 300 });
  assert.ok(app.innerHTML.includes("Güncellenmiş içerik") || app.innerHTML.includes("Alt Sayfa Testi"),
    "'Hayır' sonrası sayfa yanlışlıkla silindi");

  await clickPrefix(app, window, "wikiDeletePage:", { wait: 300 });
  await clickPrefix(app, window, "wikiDeletePageConfirmed:", { wait: 300 });
  assert.ok(!app.innerHTML.includes("Alt Sayfa Testi"), "'Evet' sonrası sayfa hâlâ görünüyor");
  assert.ok(app.innerHTML.includes("Frontend Test Sayfası"), "üst sayfa yanlışlıkla silinmemeli, sadece alt sayfa silinmeliydi");
});
test("wiki gelişmiş özellikler: serbest space oluşturma (Confluence tarzı sidebar), şablon galerisi (Boş dahil), yorumlar, sayfa yetkilendirmesi", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  assert.ok(bayramBtn, "pmdir demo kullanıcısı bulunamadı");
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });

  // Serbest (proje bağımsız) space oluşturma — sidebar'daki "Yeni alan
  // oluştur" satırından, sayfa içeriğinden DEĞİL.
  assert.ok(app.querySelector("[data-a='wikiNewSpaceOpen']"), "sidebar'da 'Yeni alan oluştur' satırı yok");
  await click(app, window, "wikiNewSpaceOpen", { wait: 300 });
  assert.ok(app.innerHTML.includes("Yeni alan (space) oluştur"), "yeni alan diyaloğu açılmadı");

  // Space oluşturma diyaloğunda da şablon galerisi olmalı (Boş ilk sırada).
  assert.ok(app.innerHTML.includes("İLK SAYFA İÇİN ŞABLON"), "space diyaloğunda şablon galerisi yok");
  assert.ok(app.querySelector("[data-a='wikiTemplatePick:']"), "'Boş' şablon kartı yok");
  assert.ok(app.querySelector("[data-a^='wikiTemplatePick:']"), "şablon kartları yok");

  setVal(doc, "fWikiNewSpaceName", "Frontend Test Alanı");
  await click(app, window, "wikiNewSpaceCreate", { wait: 500 });
  assert.ok(app.innerHTML.includes("Frontend Test Alanı"), "serbest alan oluşturulup seçilmedi (sidebar'da görünmüyor)");
  assert.ok(app.innerHTML.includes("Ana Sayfa"), "space oluşunca otomatik bir 'Ana Sayfa' oluşmadı");

  // Sidebar'daki akıllı "+" butonu: bir sayfa açıkken tıklanırsa ALT sayfa
  // oluşturur (üst düzey değil) — hedef üst sayfa diyalogda görünmeli.
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  assert.ok(app.innerHTML.includes("ALTINA") && app.innerHTML.includes("Ana Sayfa"),
    "alt sayfa diyaloğu hedef üst sayfayı (Ana Sayfa) belirtmiyor");

  // Şablon galerisi: Boş ilk sırada, temel-konu şablonları listede.
  assert.ok(app.innerHTML.includes("Boş (şablonsuz)"), "'Boş' seçeneği yok");
  assert.ok(app.innerHTML.includes("Proje Planı"), "'Proje Planı' şablonu yok");
  assert.ok(app.innerHTML.includes("Doküman Kontrol"), "'Doküman Kontrol Sayfası' şablonu yok");

  const planCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((e) => e.textContent.includes("Proje Planı"));
  assert.ok(planCard, "'Proje Planı' şablon kartı bulunamadı");
  planCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.ok(planCard.outerHTML.includes("var(--navy)") || app.innerHTML.includes("font-weight:600"),
    "seçilen şablon kartı seçili olarak vurgulanmıyor");

  setVal(doc, "fWikiNewTitle", "Şablonlu Test Sayfası");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  assert.ok(doc.getElementById("fWikiContent").value.includes("Kilometre Taşları"), "şablon içeriği textarea'ya yüklenmedi");
  await click(app, window, "wikiEditCancel", { wait: 300 });

  // Yorum ekleme.
  assert.ok(app.innerHTML.includes("YORUMLAR"), "yorumlar bölümü görünmüyor");
  const commentInput = [...doc.querySelectorAll("input")].find((el) => el.id.startsWith("fWikiCommentBody"));
  assert.ok(commentInput, "yorum input'u yok");
  commentInput.value = "@mert.balkan bakar mısın?";
  await clickPrefix(app, window, "wikiCommentAdd:", { wait: 300 });
  assert.ok(app.innerHTML.includes("bakar mısın"), "yorum eklenmedi");
  assert.ok(app.innerHTML.includes("Bayram Elmas"), "yorum yazarı görünmüyor");

  // Sayfa yetkilendirmesi.
  await clickPrefix(app, window, "wikiRestrictOpen:", { wait: 300 });
  assert.ok(app.innerHTML.includes("Sayfa yetkilendirmesi"), "yetkilendirme diyaloğu açılmadı");
  await click(app, window, "wikiRestrictToggleRole:pmdir", { wait: 300 });
  await clickPrefix(app, window, "wikiRestrictSave:", { wait: 300 });
  assert.ok(app.innerHTML.includes("kısıtlaması güncellendi"), "yetkilendirme kaydedilmedi");
});
test("wiki markdown: gerçek tablo render edilir ve proje şablonları galeride üstte sıralanır", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });

  // Sıralama: Boş ilk, ardından proje/PM odaklı şablonlar (Proje Analizi,
  // Retrospective...), genel şablonlar (Toplantı Notu vb.) en sonda.
  const cards = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")];
  assert.ok(cards[0].textContent.includes("Boş"), "ilk kart 'Boş' değil");
  assert.ok(cards[1].textContent.includes("Proje Analizi"), "ikinci kart 'Proje Analizi' değil");
  assert.ok(cards[2].textContent.includes("Retrospective"), "üçüncü kart 'Retrospective' değil");
  const toplantiIdx = cards.findIndex((c) => c.textContent.includes("Toplantı Notu"));
  assert.ok(toplantiIdx > 13, "'Toplantı Notu' (genel şablon) proje şablonlarından önce görünüyor");

  // Risk Kaydı şablonu markdown tablosu içerir — gerçek bir <table>
  // olarak render edilmeli, ham "| ... |" metni olarak DEĞİL.
  const riskCard = cards.find((c) => c.textContent.includes("Risk Kaydı"));
  assert.ok(riskCard, "'Risk Kaydı' şablon kartı bulunamadı");
  riskCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  setVal(doc, "fWikiNewTitle", "Tablo Testi");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  const saveBtn = [...app.querySelectorAll("[data-a^='wikiSavePage:']")][0];
  saveBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);

  const mainCard = [...app.querySelectorAll(".card")].find((c) => c.innerHTML.includes("Sahibi:"));
  assert.ok(mainCard.innerHTML.includes("<table"), "markdown tablosu gerçek <table> olarak render edilmedi");
  assert.ok(mainCard.innerHTML.includes("<th"), "tablo başlık hücreleri (<th>) render edilmedi");
});
test("wiki toplantı notu formu: proje seçilince otomatik ekip ekleme, manuel katılımcı, gündem, tarih/katılımcı zorunluluğu", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  assert.ok(bayramBtn, "pmdir demo kullanıcısı bulunamadı");
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });

  // "Toplantı Notu" seçilince düz metin editörü DEĞİL, yapılandırılmış
  // bir form (Proje Yönetimi'ndeki toplantı formunun aynısı) açılmalı.
  const meetingCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((c) => c.textContent.trim() === "Toplantı Notu");
  assert.ok(meetingCard, "'Toplantı Notu' şablon kartı bulunamadı");
  meetingCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  setVal(doc, "fWikiNewTitle", "Ekip Toplantısı Test");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  assert.ok(app.innerHTML.includes("Toplantı tarihi ve saati"), "yapılandırılmış toplantı formu açılmadı");
  assert.ok(app.innerHTML.includes("Proje (opsiyonel)"), "proje seçimi opsiyonel olarak işaretlenmemiş");

  // Tarih/katılımcı olmadan gönderim reddedilmeli.
  await click(app, window, "wikiMeetingSave", { wait: 1200 });
  assert.ok(app.innerHTML.includes("Tarih ve en az bir katılımcı zorunludur"), "zorunlu alan validasyonu çalışmıyor");

  // Proje seçilince o projenin AKTİF ekip üyeleri otomatik katılımcı olmalı.
  const projSel = doc.getElementById("fWikiMtgProject");
  projSel.value = "TRADE";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes("Tolga Fırat"), "proje seçilince ekip otomatik eklenmedi");

  setVal(doc, "fWikiMtgDate", "2026-09-20");

  // Gündem maddesi ekleme.
  setVal(doc, "fWikiMtgNewItem", "İlk madde");
  const assigneeSel = doc.getElementById("fWikiMtgNewItemAssignee");
  assigneeSel.value = "Tolga Fırat";
  assigneeSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await click(app, window, "wikiMtgAddItem", { wait: 300 });
  assert.ok(app.innerHTML.includes("İlk madde"), "gündem maddesi eklenmedi");

  await click(app, window, "wikiMeetingSave", { wait: 1200 });
  assert.ok(app.innerHTML.includes("backlog'una Task olarak düşürüldü") || app.innerHTML.includes("projesine düşürülmüş"),
    "kayıt sonrası beklenen bildirim görünmedi");
  assert.ok(app.innerHTML.includes("Ekip Toplantısı Test") && app.innerHTML.includes("İlk madde"),
    "oluşan wiki sayfasında toplantı bilgileri görünmüyor");
});

test("wiki toplantı notu formu: proje seçilmezse manuel katılımcı eklenir ve 'yalnızca burada kaldı' bildirimi çıkar", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  const meetingCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((c) => c.textContent.trim() === "Toplantı Notu");
  meetingCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  setVal(doc, "fWikiNewTitle", "Standalone Toplantı");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });

  // Proje SEÇMEDEN, manuel katılımcı ekle.
  const partSel = doc.getElementById("fWikiMtgPartSel");
  const bayramOpt = [...partSel.options].find((o) => o.value.includes("Bayram"));
  assert.ok(bayramOpt, "manuel katılımcı seçeneği bulunamadı");
  partSel.value = bayramOpt.value;
  partSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes(bayramOpt.value), "manuel katılımcı eklenmedi");

  setVal(doc, "fWikiMtgDate", "2026-09-20");
  await click(app, window, "wikiMeetingSave", { wait: 1200 });
  assert.ok(app.innerHTML.includes("yalnızca burada kaldı"), "proje seçilmeyince doğru bildirim gösterilmedi");
});
test("proje modülü toplantı formu: proje seçilince aktif ekip üyeleri otomatik katılımcı olarak eklenir", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:delivery");
  await click(app, window, "scr:d.meeting", { wait: 300 });
  await click(app, window, "mtAdd", { wait: 300 });
  assert.ok(doc.getElementById("fMtProjSel"), "toplantı formu (Project seçici) açılmadı");

  const projSel = doc.getElementById("fMtProjSel");
  projSel.value = "TRADE";
  projSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(300);
  assert.ok(app.innerHTML.includes("Tolga Fırat"), "proje seçilince TRADE ekip üyesi (Tolga Fırat) otomatik eklenmedi");
  assert.ok(app.innerHTML.includes("Mert Balkan"), "proje seçilince TRADE ekip üyesi (Mert Balkan) otomatik eklenmedi");
});
test("wiki oluşturma akışları (sayfa/space/toplantı) popup değil, ana içerikte inline açılır", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });

  // Yeni sayfa: popup/dialog overlay OLMAMALI, sidebar (.sub) hâlâ görünür kalmalı.
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  assert.ok(!app.querySelector(".dlgwrap"), "yeni sayfa formu popup olarak açıldı");
  assert.ok(app.innerHTML.includes("Yeni sayfa"), "yeni sayfa formu ana içerikte görünmüyor");
  assert.ok(app.innerHTML.includes("ALANLAR (SPACES)"), "sidebar arka planda kapanmış (popup değilmiş gibi davranmıyor)");

  await click(app, window, "wikiCreateCancel", { wait: 300 });
  assert.ok(!app.innerHTML.includes("ŞABLON"), "Vazgeç sonrası oluşturma formu kapanmadı");

  // Yeni alan (space): aynı şekilde inline.
  await click(app, window, "wikiNewSpaceOpen", { wait: 300 });
  assert.ok(!app.querySelector(".dlgwrap"), "yeni alan formu popup olarak açıldı");
  assert.ok(app.innerHTML.includes("Yeni alan (space) oluştur"), "yeni alan formu ana içerikte görünmüyor");
  await click(app, window, "wikiCreateCancel", { wait: 300 });

  // Toplantı Notu: aynı şekilde inline.
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  const meetingCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((c) => c.textContent.trim() === "Toplantı Notu");
  meetingCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  setVal(doc, "fWikiNewTitle", "Inline Toplantı Testi");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  assert.ok(!app.querySelector(".dlgwrap"), "toplantı formu popup olarak açıldı");
  assert.ok(app.innerHTML.includes("Toplantı tarihi ve saati"), "toplantı formu ana içerikte görünmüyor");
  assert.ok(app.innerHTML.includes("ALANLAR (SPACES)"), "sidebar toplantı formu açıkken kapanmış");
});
test("wiki düzeltmeleri: şablon seçilince başlık kaybolmaz, toplantı formu iki panelli düzende, şablon içerikleri gerçek tablo/blockquote render eder", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });

  // 1) Başlık girip sonra şablon seçince başlık KORUNMALI (regresyon testi).
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  setVal(doc, "fWikiNewTitle", "Kalıcı Başlık Testi");
  const planCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((c) => c.textContent.includes("Proje Planı"));
  planCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  assert.equal(doc.getElementById("fWikiNewTitle").value, "Kalıcı Başlık Testi", "şablon seçilince başlık kayboldu");
  await click(app, window, "wikiCreateCancel", { wait: 300 });

  // 2) Toplantı formu artık Proje Yönetimi'ndeki gibi İKİ panelli grid düzeninde.
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  const meetingCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((c) => c.textContent.trim() === "Toplantı Notu");
  meetingCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  setVal(doc, "fWikiNewTitle", "İki Panel Testi");
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  assert.ok(app.innerHTML.includes("Toplantı Notları"), "birleşik notlar+gündem paneli yok");
  assert.ok(app.innerHTML.includes("grid-template-columns:repeat(auto-fit,minmax(340px"), "iki panelli grid düzeni yok");
  assert.ok(app.innerHTML.includes("Proje (opsiyonel)"), "sağ panelde proje seçimi yok");
  await click(app, window, "wikiCreateCancel", { wait: 300 });

  // 3) Şablon içerikleri artık gerçek tablo + blockquote üretiyor (Risk Kaydı).
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  setVal(doc, "fWikiNewTitle", "Risk Kaydı Testi");
  const riskCard = [...app.querySelectorAll("[data-a^='wikiTemplatePick:']")].find((c) => c.textContent.includes("Risk Kaydı (Risk Register)"));
  riskCard.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  await click(app, window, "wikiNewPageCreate", { wait: 300 });
  const saveBtn = [...app.querySelectorAll("[data-a^='wikiSavePage:']")][0];
  saveBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  const mainCard = [...app.querySelectorAll(".card")].find((c) => c.innerHTML.includes("Sahibi:"));
  assert.ok(mainCard.innerHTML.includes("border-left:3px solid"), "blockquote (rehber notu) render edilmedi");
  assert.ok(mainCard.innerHTML.includes("<table"), "şablon tablosu render edilmedi");
  assert.ok(mainCard.innerHTML.includes("Yüksek Öncelikli Riskler"), "zengin şablon içeriği eksik görünüyor");
});
