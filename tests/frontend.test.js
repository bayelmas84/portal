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
  assert.ok(app.innerHTML.includes("›") && app.innerHTML.includes("Frontend Test Sayfası"),
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
test("wiki gelişmiş özellikler: serbest space oluşturma, şablon seçici (Boş dahil), yorumlar, sayfa yetkilendirmesi", async () => {
  const { window, doc, app } = await openDemoApp();
  const bayramBtn = [...app.querySelectorAll("[data-a^='fill:']")].find((e) => e.textContent.includes("Bayram Elmas"));
  assert.ok(bayramBtn, "pmdir demo kullanıcısı bulunamadı");
  bayramBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(700);

  await click(app, window, "mod:wiki");
  await click(app, window, "scr:w.pages", { wait: 300 });

  // Serbest (proje bağımsız) space oluşturma.
  assert.ok(app.querySelector("[data-a='wikiNewSpaceOpen']"), "'+ Yeni alan' butonu yok");
  await click(app, window, "wikiNewSpaceOpen", { wait: 300 });
  assert.ok(app.innerHTML.includes("Yeni alan (space) oluştur"), "yeni alan diyaloğu açılmadı");
  setVal(doc, "fWikiNewSpaceName", "Frontend Test Alanı");
  await click(app, window, "wikiNewSpaceCreate", { wait: 300 });
  assert.ok(app.innerHTML.includes("Frontend Test Alanı"), "serbest alan oluşturulup seçilmedi");

  // Şablon seçici: Boş ilk sırada, temel-konu şablonları listede.
  await clickPrefix(app, window, "wikiNewPage:", { wait: 300 });
  const templateSel = doc.getElementById("fWikiNewTemplate");
  assert.ok(templateSel, "şablon dropdown'ı yok");
  assert.ok(templateSel.options[0].textContent.includes("Boş"), "ilk seçenek 'Boş' değil");
  assert.ok([...templateSel.options].some((o) => o.textContent.includes("Proje Planı")), "'Proje Planı' şablonu yok");
  assert.ok([...templateSel.options].some((o) => o.textContent.includes("Doküman Kontrol")), "'Doküman Kontrol Sayfası' şablonu yok");

  const planOpt = [...templateSel.options].find((o) => o.textContent.includes("Proje Planı"));
  templateSel.value = planOpt.value;
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
