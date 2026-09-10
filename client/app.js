"use strict";

/* Tera Yatırım kurumsal logosu — veri URI, dış bağlantı yok (CSP uyumlu) */
/* Marka ve ekran metinleri tek yerden gelir. Sunucu /api/brand ucundan değer döndürürse
   o kullanılır; dönmezse aşağıdaki varsayılanlar geçerlidir. Kodda sabit metin bırakılmaz. */
const BRAND_DEFAULTS = {
  company: "Tera Yatırım Menkul Değerler A.Ş.",
  companyShort: "Tera Yatırım",
  product: "Tera Bir",
  productMark: "BİR",
  slogan: "Her şey bir arada, tek bir yerde.",
  loginTitle: "Oturum açın",
  loginHint: "Kurum hesabınızla devam edin.",
  footer: "© " + new Date().getFullYear() + " Tera Yatırım Menkul Değerler A.Ş.",
  signature: "powered by bayelmas",
  accent: "#B8894A",
};
let BRAND = { ...BRAND_DEFAULTS };

const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAARgAAABBCAYAAAAKeLsHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAABHMSURBVHhe7d17XMzZ/wfwV5ddErnksq7xdUsoyWW0KrmkULkbKrKUwkZW2yrFLlHWXfiihAo/WiGxK/dY5S63aKl2c8lduqHv1++PbT7zOWfmM42aj61v5/l4zGM773PmMzOf/cx7zjmf8/nQ+vjx40cwDMOIQJsOMAzDaApLMAzDiIYlGIZhRMMSDMMwomEJhmEY0bAEwzCMaFiCYRhGNCzBMAwjGpZgGIYRDUswDMOIhiUYhmFEwxIMwzCiYQmGYRjRsATDMIxoWIJhGEY0LMEwDCMalmAYhhENSzAMw4hGq6K3zExOSaNDorCSmNIhBdk5uUi9fBu30rNw4Wo6nj5/jdxnL1FYWIzGDeujcaN6sP3aHOOG28KkY2v66YIq+hkN6ujDsIEBGtQzQC29GnT1J7uVnoWHT56joKAI+YVFKCgoRn5hEXS0tWHYoC4MGxigZbNGMDVpSz9VLco+rzr7X5n0jD/x7MVrOiy4Pf5rNzKsB+P2rYh6vuycXPyZk0uHK0T2vuj3rc77FaKnVwOG9evCsH4dGNTRp6sVVOS1y9pnZVG2Tah4D2WpcIKp3dqBDokiP+sIHeL8dvIi4hOTEX84GQWFxXS1UkMG9sbk8UPgMKAXXaVAk5/RqEUTWElM0d20PXqaG8O8a3u6iYLcZ69w/uItnDp3Db+euICcx8/oJkrVNdBH315dYdq5LfxmSvHlF7p0E6Vupmdi+MT5ePL0JReb6joUqxfPJNqVpaj4HRxdA5By6TYX+9F/Mr7zHku0kzl17hqGuczjykMG9saeiIVEGz4Hqb/gF6K8ZMdZyKoYLF0Ty8WP7A5T+JLRbdQx0NoCE0YNwFhnW7qKQ29X2Wsnp6TBQepPxABg2KA+2L0lmA6r5fiZK3CeGEiHgTK+f6pU6SHSlbQM2DjPwqjJwYiJS1I7uQDA4WOpGDNlAcZOXYj0jD/patFk5+QiJi4Jc4I3wMrRBz4Ba/Eg6xHdDCg90Ia5zEPbnhPgOj0EEbGJaicXAHiTV4DEYylYuiYWg8f44VDSebqJUl2M2yA0yJOIRcQkYs+Bk0SsLMFhUURymTjWTjC5AMDildFE+fCxVBw5foGIVXXHzlzGN7OWwdrJB5eu36WrK+xQ0nmc/v06HVbL7v0n6FCFVdkezJnz1+ExZzkePn5OxMujUwcjRK8PEOxaiv0Z7fr1wL5ti+gwBo2Zi/MXb9HhClk63wPfTh1Jh5VavDIaoWt3cmWDOvo4d2gd2hg1JdopE/vLMUz7bgVXlliYIH77ItSpXYtoJ3PgyFm4eIfQYZW9mJi4JGT/RQ6RtLS0wD+k+T0BK4kp+vbuypWVCfR1BdTsRdBt5s1yIeplHue+wP2sRwq9LcMGBti8Yi4G2/Yk4vR2lb22UA8GAKQj+iNilR8dVulmeiYk9tO5sra2Fv77X/l+pL9/6qqSCeZQ0nlMmf0zCgqKiDYV0amDEfZvX4zmTRvSVZ/lM86b5cId3DL9nGeL8isXvT4AI4Za0WGlJngtxsFfz3Fl+/69ELf1R6IN7fbdLDi6BiD32SsAQP16dRC/fRF6mHWkm3Ish8xE2u37AIBBNj2QdPoSV7c38ke1hrI0+kuobB8LUedLrk4bvuycXMxfGon4xGQu9q/WzZB2KpJop8526c9mJTElEtjpA2tgYdaBK5clcEkE1mz+hSt/+YUu3n8o4crlTTBVboj05OlL+M5fX2ZyadG0ERzt+mDmlBHobWECfX09ugnhzr1sbIjaT4c/m/DIeLzNLyRiH0rk/4M1KTwyng4JCg3yRIe2LbnyrycuYPmG/yPa0IJCt3LJBQDCgjxVJpeImEQuuQDANxMcYGNpxpWjdh3m/q7KjFo0UUjuD7Ie4egpeTItLzpxxsQlEWVVnj5/jV37jnNlG0sz6OjoEG3KS71ZPxWEuoV8ZU2EqdqGlpYWUY6MPYzHuS+IGJ+71B7e7s7obEyeJfpQUoLL1+9hXUQ8Dhw5S9TJbIw6gDFO/dCtSzu6SpCVxBQBs4XfPwBcunYXl67fE3xdAHibX4i1W/YRBwr/F4RPV1cHnTu2RmfjNujYriWaf9UQzZs2xIWr6biVnonzF2/jr0dP6adxUq/cwdUbGWpNMLdq3hihQZ4Y6R7ExRYu24ZuXdphoLUF0Ralw6rfTl7kyn4zpJgwaiDRhu/1m3wi4Zl3bQ/HwZYofveem0uQzcWUpxdTGRm3I4fiGQ/+gl2/HkSsPAbb9uT2fczeJHi7OxE/DkJ27TuOp8/lZ62mTXLCpev3iDblVeEEQ2dOZc6m3lAYf/Kpsw2U9l627f6VDnNUdYG/0NWFxMIEEgsT+ASsxdadil2+9x9KEJdw+pMSDNQ4hSertx3ui4vX0ulqQe/f/51gdHS0YWPZDY52fWDdxwwd2yk/aGSvk/e2AHsOnMLs+eF0E87VG3+olWBQOke0JNADASFbuFjgkgiYd2kPwwYGXCzh6O/EnI2T/ddY4DeJKyuzIeoA/sh8yJWnuAwBAIxx6oeNUQdw4erf+ytq1+H/mQRDa9ZEcVheHn4zpFyCKSp+h5i4JPzk/w3dTAG/92Jh1gFOgy3hpa2ZwY1mtvKZqOq99Pu6G3y9xtBhpVT9ovLHx5omlBiENPvKEJtWfIf7F3fiYHQIPNyGqbUNgzr6mOo6VGXP8H6W/EutDh+PkZg41o4r30rPQlCofO4g5/EzBIdGcWXj9q0QFkyeiaI9evICkbGJXLlpE0O4S+25shvv9f6XzihdpubVjFp+RZTLS9LDBNZ95EPL6D1Jgt8XmV37juNmeiZX9pzoCJT+qGmCZrbymZw4e5UOcXKfvYKjawCsnXzQx2EGegyaBjPbqejc1x0dJG5o3V2K5qaj0cRkBIZI/RWGXjLZObkqe1vlcfFaOtZu+aXMcXFXk38R5SO7w+AyaiAaNqhLxIW8fJWHW+lZSE5JQ3JKGqz7CPes+F1idYUGeaKXuTFX3rHnKLZEHwIABIdGIeNBDlB6BiIsaBpaNmvMtVUmMjaRmKvxcnci6iePdyB6WVV9LubqjQz4BKwl5lycHfqiu6l6PUl1eE36O0EAwLMXrxG9V/Uxxz813amDEVxKf3x1NTQHU6USDD0JynfnXjZSL9/GlbQM3LjzAOkZf+J+5kNk5+Ti0ZPneP7yDd7kFaCgsBjvP5QQpzJpr97k0yFBySlpqN3aQeXDdrgvAkIi6KcS2hg1hdNgSzpMeP7yDZJT0hAeGY/vFmyAi3cIBoycg8593dGgvSNamY9Db3tvOEj9uYeQp8/lX2x1GdTRx5L5HqjNmzAPCNmCkFUxxBqZsKBpGGDdnSsr8zj3BSJj5QlDS0sL34xXPFs3mRer7L2YM+fTELIqRuljvOdPsHL0IYbmnToYIWiOG7GNinKy/xp9enbmytF7jyJf4ITI8TNXcPzMFa7M3//VsgeTl1dAh0TxJk/9BKMp0uH96RDn+Jkr8JizHK27S+Eg9ccPizZj0/YEHDhyFqlX7iA7J1dwQliIbH7nU0ksTIhFeEXF74lJfA+3YfCe7MyVhWzanoDnL99wZS93J9SvV4dog9IzSkYtmnDlytyLWbomVvCRcJRc5Ojs0Ffl2quKmDRuMPd3ZvZjRO85StTL8HsvRi2aYNokeQ+yeiYYFT0YTcp7+3leB6W9gohVfoKT03MXboTzxEBiIu6f5i61x8wpI+gwbCzNEBY8jQ4rePbiNSJ3konCq3Tsr8zsaaO5vw8fS8XB334n6qsKk46t8f1MKc4cXIvYjYGiJBcAcB09iFgWEL1XMcHcTM8kjqmJ4wZDW1s+baBTHSd5895+nh7M608YIpWXrq4Oxg23xf4diyEdobz34jV3Jf697SAdrhRCgzyJngUArPhxulrXO63dsg+vXr/lyiOGWqFtm+ZEGz4Pt2HQr1WTK2/ekUDUVxb/Xj4HR3aHcQ96kv3bqSMQPHeSRudchEziTZan3X6Anb8cI+r5yaWRYT148XovqK49GGXrLmSWL/RGftYRjTyEehOa0MW4DZYEeiDz0i5Erv6emDTli4lLKnNSGKUHh3nXdnAabAnvyc5YEuiBHeHzuIO8Zzfl29eEVlSCUecX+dXrt4iIkZ85AgBv6uBWxsdjFPf3qXPXEEt9YSoD2YWsskegryuRTLz9ViEz+zHxHLG4jR2ETh2MuPKuePlwiF5YN3GsHeoakFd5a2qhXdVKMDbCCWbe4i2Ck1lispKYqvzVojkOtoSPx0il8w18+w6doUMcu349ELXWH39d24PMy7uQnLAOOzcF4ecFXvDxGImRw6xhJTFFbX29T1p38zksC9+tMFlvN9ZPYWKcftCLNStrL4a2bIEXUZ7q+zNRFouujg5cRw/iyifPXuXOXvEX1unr62GK61CunQzrwVA+lJRg+KT5CgdvWd7k5eO3kxfhNXclard2KNcpavpXa7SjDd2Es3RNLEJWxdBhBaqWjy9f6I0xTv1UJqm02/fhybvYsDJ4m1+IrdTcS3ldvn6v0g4f+SQWJvCbIeXKqVfuIDhsK9FGE5SdFXUZPRDNvjLkyrJhEr/34jZmEFo1V1xOUC17MMbtW6FnN+FrWlIu3UYX68lYsXEP4hJO4/qt+ygseoeCwmI8efoSGQ9ycPn6PSQc/R3+P23CgJFz0MZiPHe7B03ZsMwXZp2Fb/akbpIRoir5PHryAuu3xsNB6o8797Lp6n/UktWxxC01mjYxJJKzOg++TVWkF7PAbxK6GLfhyis37kXisRSijRgaNqgLl1HyXkxcwmnExCVxC+u0tLQwWaq4NADVdZIXAMIWeKn85X7xMg8LwqLg/m0ovh46E407DUcTkxFo18sF5v09YOM8C+M9F2H91v1IvXLnk0/vqqOWXg1sWOar8u51FUkycxduhMR+OtxmLMEPizbjh0Wb4TZjCST209FB4gr/nzbjzWc6pa+uouL33KI8mYzUGGJ4qc6jNW/Va8aDHKyL2Edss7L6eSE5VPKau5K4oZdYXEYPJI7Dn8PlF6pOHGuncM2ejK5uNezBAEAvc2NsWOZLhysds85ty3yfS9fEYnag8uuFyrqdws30TMQnJiM8Mh7hkfGIT0wmlnxXNiGrolH87j1XnjxefpbjU6wPm02UV2+KI8qVlZXEFLM85RPVr16/ha+Ka8U0pV2b5sSlMfxLRPiXYtCqbQ8GABzt+mDVohl0uNIZ7WiDgNmqz0hFxCYSN2aSGTlEdYJRx/iRAxSGFf+EDyUlCI+QXzGto6ONdUtnEW3UZWNpRtznJPfZK6zYuIdoU1mFBExFR96V1AlHz5d56wtNcBmteO3dGKd+kFiY0GFOtZzk5fNwG4bw0FmQ9BDeSZ+qu2l7NDKsR4crJGC2i8pJX5Te/W3eYvmVyijtwUx1UZzdV4dezRpYFjwNW1bOpav+ESErY1Dyn/9wZW/3slf6qkI/P4x3BXdlt4xaiLhw2TacSJYv1xdDz27GCscg/8JVZbSre4JB6YrSY3ErsCN8HgbZlP9+GgOtLbB1zfc4c3CtWms5PlVZk74AsC5in8KczOqQmdi8Yq7CgjYhX+jqYtxwWyTELMH0b4bT1f+Ijx8/Ej2Mxg3rV/i9SUf0h10/+W0mC4veEbeJqMwGWHdXuJTCN2i96JenuI6RT/YOG9QHtn3NiXqapoZIFb5lpjrKOvWrqW78H5kPcfVGBi5du4vklDTcTM+Enl5N6NX4ErX0aqBmzRql//0SHdu2hFXp3f3LuimPqvev7j8T8Ta/ENdu/kGHCULbyi8oKr1p1V2c/v06Tp69iroG+qhnUBt1DfRR16A2Jo61g33/XgoT4Kr+aY+K7nd628q2p2zfKWv3qeh/2gMC2+W/vrJ6IfT2hZ5b3u2r2i9ivbasvdBxxqfueyjLZ0kwDMNUT5rpBzEMwyjBEgzDMKJhCYZhGNGwBMMwjGhYgmEYRjQswTAMIxqWYBiGEQ1LMAzDiIYlGIZhRMMSDMMwomEJhmEY0bAEwzCMaFiCYRhGNCzBMAwjGpZgGIYRDUswDMOIhiUYhmFEwxIMwzCiYQmGYRjRsATDMIxoWIJhGEY0/w8aH/NXz5X1iwAAAABJRU5ErkJggg==";
/* Tera Portal istemcisi.
   Kural: yetki kararı burada verilmez. Menü ve veri sunucudan gelir; bu dosya yalnızca gösterir.
   Sunucu her isteği yeniden denetler, istemci kısıtları kullanıcı kolaylığı içindir. */
(function () {
  const app = document.getElementById("app");
  const S = {
    view: "login", user: null, modules: [], settings: {}, mod: null, scr: null,
    data: {}, dlg: null, form: {}, toast: null, dark: matchMedia("(prefers-color-scheme: dark)").matches,
    reading: null, detail: null, quiz: null, quizResult: null, overdue: [], drill: null, showPw: false, execFilter: null, execUnit: null,
  };
  let csrfToken = null;

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", credentials: "same-origin", headers: {} };
    if (opts.body instanceof FormData) init.body = opts.body;
    else if (opts.body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
    if (init.method !== "GET") init.headers["x-csrf-token"] = csrfToken || readCookie("tp_csrf");
    const res = await fetch("/api" + path, init);
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (res.status === 401 && S.view !== "login") { S.view = "login"; render(); throw new Error("Oturum sona erdi"); }
    /* Kapalı veya bakımdaki bölüm: hata göstermek yerine ana sayfaya dönülür. */
    if (body && body.redirect === "home") {
      S.view = "home"; S.detail = null; S.reading = null; S.quiz = null;
      await loadMe();
      toast(body.error || "Bu bölüm şu anda kullanımda değil.", true);
      render();
      const e = new Error(body.error || "kapalı bölüm"); e.handled = true; throw e;
    }
    if (!res.ok) {
      const msg = (body && (body.error + (body.fields ? ": " + body.fields.map((f) => f.alan).join(", ") : ""))) || "İstek başarısız";
      const err = new Error(msg); err.status = res.status; err.body = body; throw err;
    }
    return body;
  }
  const readCookie = (n) => (document.cookie.split("; ").find((c) => c.startsWith(n + "=")) || "").split("=")[1] || null;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let toastTimer;
  function toast(msg, bad) {
    S.toast = { msg, bad }; render();
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { S.toast = null; render(); }, 3500);
  }
  const pill = (t, c) => `<span class="pl ${c || ""}">${esc(t)}</span>`;
  const head = (t, s, extra) => `<div class="hd"><div style="flex:1"><h2>${esc(t)}</h2>${s ? `<p>${esc(s)}</p>` : ""}</div>${extra || ""}</div>`;
  const table = (cols, rows) => `<div style="border:1px solid var(--bd);border-radius:12px;overflow:auto">
    <table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const scrOf = (key) => { for (const m of S.modules) { const s = (m.screens || []).find((x) => x.key === key); if (s) return s; } return null; };
  const canWrite = (key) => { const s = scrOf(key); return !!s && s.level === "write"; };

  /* ---------------- oturum ---------------- */
  /* Marka ayarları sunucudan gelir; uç yoksa varsayılanlar kullanılır. */
  async function loadBrand() {
    try {
      const b = await api("/brand");
      if (b && b.brand) BRAND = { ...BRAND_DEFAULTS, ...b.brand };
    } catch (e) { /* uç yok veya erişilemedi: varsayılanlar geçerli */ }
  }

  async function loadMe() {
    const me = await api("/me");
    csrfToken = me.csrfToken || csrfToken;
    S.user = me.user; S.modules = me.modules; S.settings = me.settings;
    S.overdue = me.overdueReadings || [];
    if (!S.mod || !S.modules.some((m) => m.key === S.mod)) {
      S.mod = S.modules[0] && S.modules[0].key;
      S.scr = S.modules[0] && S.modules[0].screens[0] && S.modules[0].screens[0].key;
    }
  }

  async function loadScreen() {
    S.data = {};
    try {
      if (S.scr === "a.list") {
        S.data.items = (await api("/announcements")).items;
        const p = await api("/announcements/popup");
        S.data.popup = p.item || null;
      } else if (S.scr === "k.docs") S.data.items = (await api("/documents")).items;
      else if (S.scr === "k.queue") S.data.items = (await api("/documents/queue")).items;
      else if (S.scr === "p.in") S.data.items = (await api("/approvals/inbox")).items;
      else if (S.scr === "p.my") S.data.items = (await api("/approvals/mine")).items;
      else if (S.scr === "p.done") S.data.items = (await api("/approvals/decided")).items;
      else if (S.scr === "s.all") S.data.items = (await api("/shortcuts")).items;
      else if (S.scr === "m.users") S.data.items = (await api("/admin/users")).items;
      else if (S.scr === "m.access") S.data = await api("/admin/permissions");
      else if (S.scr === "m.avail") S.data = await api("/admin/screens");
      else if (S.scr === "m.notif") S.data.items = (await api("/admin/notifications")).items;
      else if (S.scr === "m.mail") S.data = await api("/admin/mail");
      else if (S.scr === "r.list") S.data.items = (await api("/reports")).items;
      else if (S.scr === "r.dev") S.data.items = (await api("/reports/drafts")).items;
      else if (S.scr === "r.usage") S.data.items = (await api("/reports/usage")).items;
      else if (S.scr === "m.dir") S.data = await api("/admin/directory");
      else if (S.scr === "d.projects") S.data.items = (await api("/projects")).items;
      else if (S.scr === "d.my") S.data.items = (await api("/projects/mine")).items;
      else if (S.scr === "d.charts") {
        const list = (await api("/projects")).items;
        S.data.projects = list;
        if (!S.proj && list.length) S.proj = list[0].code;
        const sel = list.find((x) => x.code === S.proj) || list[0];
        S.data.selected = sel;
        if (sel) {
          S.data.charts = await api(`/projects/${sel.id}/charts`);
          S.data.items = (await api(`/projects/${sel.id}`)).items;   /* drill-down için */
        }
      }
      else if (S.scr === "d.exec") { try { S.data.exec = await api("/projects/reports/executive"); }
        catch (e) { S.data.execError = e.message; } }
      else if (S.scr === "m.short") S.data.items = (await api("/admin/shortcuts")).items;
      else if (S.scr === "t.un") S.data = await api("/training/pending");
      else if (S.scr === "t.done") S.data.items = (await api("/training/completed")).items;
      else if (S.scr === "c.read") S.data = await api("/compliance/reading");
      else if (S.scr === "c.rem") S.data.items = (await api("/compliance/reminders")).items;
      else if (S.scr === "c.audit") S.data = await api("/compliance/audit");
    } catch (e) {
      S.data.error = e.status === 503 ? "Bu bölüm bakımda." : e.status === 423 ? null : e.message;
    }
  }

  /* ---------------- ekranlar ---------------- */
  function loginView() {
    /* Giriş ekranı: kurumsal kimlik ve sakin bir görsel dil.
       Uygulamanın içeriğine dair hiçbir bilgi verilmez. */
    return `<div class="login">
      <div class="login-art" aria-hidden="true">
        <svg viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#123061"/><stop offset="55%" stop-color="#0B1F48"/>
              <stop offset="100%" stop-color="#06102a"/></linearGradient>
            <linearGradient id="gold" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#B8894A" stop-opacity=".85"/>
              <stop offset="100%" stop-color="#E7C98F" stop-opacity=".25"/></linearGradient>
          </defs>
          <rect width="600" height="800" fill="url(#lg)"/>
          <g opacity=".13" stroke="#9FB0CE" stroke-width="1" fill="none">
            ${Array.from({ length: 13 }, (_, i) => `<line x1="0" y1="${i * 64}" x2="600" y2="${i * 64 - 220}"/>`).join("")}
          </g>
          <g opacity=".55">
            ${[[70, 640, 46], [140, 600, 86], [210, 655, 62], [280, 560, 122], [350, 610, 96], [420, 500, 168], [490, 545, 132]]
              .map(([x, y, h]) => `<rect x="${x}" y="${y - h}" width="34" height="${h}" rx="5" fill="url(#gold)"/>`).join("")}
          </g>
          <path d="M70 618 L140 566 L210 604 L280 458 L350 512 L420 352 L490 424"
                fill="none" stroke="#E7C98F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>
          ${[[70, 618], [140, 566], [210, 604], [280, 458], [350, 512], [420, 352], [490, 424]]
            .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="#fff" opacity=".92"/>`).join("")}
          <circle cx="480" cy="150" r="150" fill="#ffffff" opacity=".04"/>
          <circle cx="120" cy="240" r="86" fill="#ffffff" opacity=".03"/>
        </svg>
        <div class="login-art-text">
          <div class="brand">
            <img class="brand-logo on-dark" src="${LOGO}" alt="${esc(BRAND.companyShort)}" height="26">
            <span class="brand-sub">${esc(BRAND.productMark)}</span>
          </div>
          <h1>${esc(BRAND.slogan).replace(",", ",<br>")}</h1>
          <p>${esc(BRAND.company)}</p>
        </div>
      </div>

      <div class="login-form">
        <form id="loginForm" autocomplete="on">
          <div class="brand brand-mobile">
            <img class="brand-logo" src="${LOGO}" alt="${esc(BRAND.companyShort)}" height="26">
            <span class="brand-sub" style="color:var(--gold)">${esc(BRAND.productMark)}</span>
          </div>
          <h2>${esc(BRAND.loginTitle)}</h2>
          <p class="login-hint">${esc(BRAND.loginHint)}</p>

          <label class="field">
            <span>Kullanıcı adı</span>
            <span class="input-wrap">
              <span class="prefix">TERA\</span>
              <input id="u" name="username" autocomplete="username" autocapitalize="none"
                     spellcheck="false" required placeholder="ad.soyad">
            </span>
          </label>

          <label class="field">
            <span>Parola</span>
            <span class="input-wrap">
              <input id="p" name="password" type="password" autocomplete="current-password" required placeholder="••••••••••">
              <button type="button" class="reveal" data-a="togglePw" aria-label="Parolayı göster">${S.showPw ? "gizle" : "göster"}</button>
            </span>
          </label>

          ${S.loginError ? `<div class="login-error" role="alert">${esc(S.loginError)}</div>` : ""}

          <button class="b g login-submit" type="submit">Giriş yap</button>
        </form>
        <div class="login-legal m">${esc(BRAND.footer)}<span class="sig">${esc(BRAND.signature)}</span></div>
      </div>
    </div>`;
  }

  function annView() {
    const items = S.data.items || [];
    const live = items.filter((a) => a.status === "yayinda");
    const waiting = items.filter((a) => a.status !== "yayinda");
    const row = (a) => `<div class="card" style="margin-bottom:10px">
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        <span style="font-size:13px;flex:1">${esc(a.title)}</span>
        ${pill(a.category, a.category === "Yasal" ? "er" : "")}${pill(a.criticality)}
        ${a.status !== "yayinda" ? pill(a.status === "onayda" ? "onay bekliyor" : "reddedildi", "wr") : ""}
        ${a.pending_delete ? pill("silme onayında", "wr") : ""}
        ${a.is_read ? pill("okundu", "ok") : ""}</div>
      <div style="font-size:12px;color:var(--t2);margin-top:7px">${esc(String(a.body).slice(0, 140))}…</div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <span class="m" style="color:var(--tm);flex:1">${esc(a.created_by_name || a.created_by)} · geçerlilik ${esc(String(a.valid_until).slice(0, 10))}</span>
        <button class="b s p" data-a="annOpen:${a.id}">Duyuruya git</button></div></div>`;
    return head("Duyurular", "Onay bekleyen duyuru yalnızca girene ve Teftiş'e görünür",
      canWrite("a.list") ? `<button class="b p" data-a="annNew">Duyuru gir</button>` : "")
      + (waiting.length ? `<div class="lbl">Onay bekleyenler (${waiting.length})</div>${waiting.map(row).join("")}` : "")
      + `<div class="lbl" style="margin-top:12px">Yayında (${live.length})</div>`
      + (live.map(row).join("") || `<p style="color:var(--tm);font-size:12px">Kayıt yok.</p>`);
  }

  function annDetail() {
    const a = S.detail;
    return head(a.title, `${a.category} · ${a.criticality} · geçerlilik ${String(a.valid_until).slice(0, 10)}`,
      `<button class="b" data-a="back">Kapat</button>`)
      + `<div class="card" style="max-width:680px;white-space:pre-wrap;line-height:1.8">${esc(a.body)}</div>
      <div style="display:flex;gap:9px;margin-top:14px;flex-wrap:wrap">
        ${a.status === "yayinda" && !a.is_read ? `<button class="b g" data-a="annRead:${a.id}">Okudum</button>` : ""}
        ${a.status === "yayinda" && a.is_read ? pill("okundu", "ok") : ""}
        <span style="flex:1"></span>
        ${a.status !== "yayinda" && a.created_by === S.user.username ? `<button class="b" data-a="annEdit:${a.id}">Düzenle</button>` : ""}
        ${a.status === "yayinda" && canWrite("a.list") && !a.pending_delete ? `<button class="b d" data-a="annDel:${a.id}">Duyuruyu sil</button>` : ""}
      </div>`;
  }

  function docsView() {
    const items = S.data.items || [];
    return head("Dokümanlar", "Onay bekleyen doküman yalnızca yükleyene ve Teftiş'e görünür",
      canWrite("k.docs") || scrOf("k.queue") ? `<button class="b p" data-a="docNew">Doküman ekle</button>` : "")
      + table(["Numara", "Doküman", "Sürüm", "Kategori", "Durum", ""], items.map((d) => `<tr>
        <td class="m" style="color:var(--ta)">${esc(d.doc_no)}</td><td>${esc(d.title)}</td>
        <td class="m">${esc(d.version)}</td><td>${pill(d.category, d.category === "Yasal" ? "er" : "")}</td>
        <td>${d.status === "yayinda" ? pill("yayında", "ok") : pill(d.status === "onayda" ? "onay bekliyor" : "reddedildi", "wr")}
            ${d.pending_delete ? pill("kaldırma onayında", "wr") : ""}</td>
        <td style="text-align:right;white-space:nowrap">
          ${d.status === "yayinda" && !d.acked ? `<button class="b s p" data-a="docRead:${d.id}">Oku</button>` :
            `<button class="b s p" data-a="docDetail:${d.id}">Detay</button>`}
        </td></tr>`).join("") || `<tr><td colspan="6" style="color:var(--tm)">Kayıt yok.</td></tr>`);
  }

  function queueView() {
    const items = S.data.items || [];
    return head("Teftiş kuyruğu", "Detaya girip dosyayı inceleyin; onay ve ret orada verilir")
      + table(["Numara", "Doküman", "Kategori", "Yükleyen", ""], items.map((d) => `<tr>
        <td class="m" style="color:var(--ta)">${esc(d.doc_no)}</td><td>${esc(d.title)}</td>
        <td>${pill(d.category, d.category === "Yasal" ? "er" : "")}</td>
        <td style="color:var(--t2)">${esc(d.uploaded_by)}</td>
        <td style="text-align:right"><button class="b s p" data-a="docDetail:${d.id}">Detay</button></td></tr>`).join("")
        || `<tr><td colspan="5" style="color:var(--tm)">Kuyruk boş.</td></tr>`);
  }

  function docDetail() {
    const d = S.detail, pending = d.status !== "yayinda";
    const mine = d.uploaded_by === S.user.username;
    const insp = !!scrOf("k.queue");
    return head(`${d.doc_no} — ${d.title}`, pending ? "Onay bekliyor · bu ekranda süre saymaz" : "Yayında olan doküman",
      `<button class="b" data-a="back">Kapat</button>`)
      + `<div class="card" style="padding:10px 12px;margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${pill(d.category, d.category === "Yasal" ? "er" : "")}
        ${pending ? pill(d.status === "onayda" ? "onay bekliyor" : "reddedildi", "wr") : pill("yayında", "ok")}
        <span class="m" style="color:var(--tm)">sürüm v${esc(d.version)} · ${esc(d.page_count)} sayfa · yükleyen ${esc(d.uploaded_by)} · ${esc(d.file_name)}</span></div>
      ${d.reject_reason ? `<div class="card er" style="margin-bottom:12px">Önceki ret gerekçesi: ${esc(d.reject_reason)}</div>` : ""}
      <iframe title="${esc(d.title)}" src="/api/documents/${d.id}/file" style="width:100%;height:min(64vh,600px);border:1px solid var(--bd);border-radius:12px;background:#fff"></iframe>
      <div style="display:flex;gap:9px;margin-top:14px;flex-wrap:wrap;align-items:center">
        <a class="b s" href="/api/documents/${d.id}/file" target="_blank" rel="noopener" style="text-decoration:none">Yeni sekmede aç</a>
        <span style="flex:1"></span>
        ${pending && insp ? `<button class="b d" data-a="docReject:${d.id}">Reddet</button>
          <button class="b g" data-a="docApprove:${d.id}">Onayla ve yayınla</button>` : ""}
        ${!pending && mine && !d.pending_delete ? `<button class="b d" data-a="docDelReq:${d.id}">Kaldırma talebi</button>` : ""}
        ${!pending && !d.acked ? `<button class="b p" data-a="docRead:${d.id}">Oku</button>` : ""}
      </div>`;
  }

  /* Okuma ekranı: süreyi sunucu sayar, istemci yalnızca düzenli ping atar. */
  function readerView() {
    const r = S.reading;
    const done = (r.pageSeconds[r.page] || 0) >= r.required;
    const left = Math.max(0, r.required - (r.pageSeconds[r.page] || 0));
    const missing = [];
    for (let p = 0; p < r.pageCount; p++) if ((r.pageSeconds[p] || 0) < r.required) missing.push(p + 1);
    return `<div style="display:flex;flex-direction:column;gap:0">
      <div class="card" style="border-radius:12px 12px 0 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="m" style="color:var(--ta)">${esc(r.doc.doc_no)}</span>
        <span style="font-size:13px;flex:1">${esc(r.doc.title)}</span>
        ${Array.from({ length: r.pageCount }, (_, i) =>
          `<button class="b s ${i === r.page ? "p" : ""}" data-a="readPage:${i}">${(r.pageSeconds[i] || 0) >= r.required && i !== r.page ? "✓" : i + 1}</button>`).join("")}
      </div>
      <div class="${done ? "ok" : "wr"}" style="padding:10px 14px;display:flex;gap:12px;align-items:center;border-left:1px solid var(--bd);border-right:1px solid var(--bd)">
        <span class="m" style="font-size:20px;min-width:34px;text-align:center">${done ? "✓" : left}</span>
        <span style="font-size:12px;flex:1">${done ? "Bu sayfa tamamlandı." : `Bu sayfada kalan süre — sunucu sayar, ${r.required} saniye dolmadan onay açılmaz.`}</span>
      </div>
      <iframe title="${esc(r.doc.title)}" src="/api/documents/${r.doc.id}/file#page=${r.page + 1}"
        style="width:100%;height:min(56vh,520px);border:1px solid var(--bd);border-top:none;background:#fff"></iframe>
      <div class="card" style="border-radius:0 0 12px 12px;display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        ${missing.length ? `<span class="m" style="color:var(--tm)">eksik sayfa: ${missing.join(", ")}</span>` : pill("tüm sayfalar tamam", "ok")}
        <span style="flex:1"></span>
        <button class="b" data-a="readClose">Kapat</button>
        ${r.page > 0 ? `<button class="b" data-a="readPage:${r.page - 1}">‹ Önceki</button>` : ""}
        ${r.page < r.pageCount - 1 ? `<button class="b ${done ? "p" : ""}" ${done ? "" : "disabled"} data-a="readPage:${r.page + 1}">Sonraki ›</button>`
          : `<button class="b ${missing.length ? "" : "g"}" ${missing.length ? "disabled" : ""} data-a="readAck">Okudum, onaylıyorum</button>`}
      </div></div>`;
  }

  function approvalsView(title, note, items, kind) {
    return head(title, note) + table(["Talep", "Konu", kind === "in" ? "Talep eden" : "Onaya düşen", "Durum", ""],
      (items || []).map((r) => `<tr>
        <td>${esc(r.kind)}<div class="m" style="color:var(--tm)">#${r.id}</div></td>
        <td>${esc(r.subject)}</td>
        <td style="color:var(--t2)">${esc(kind === "in" ? r.requested_by : r.approver)}</td>
        <td>${pill(r.status, r.status === "bekliyor" ? "wr" : r.status === "onaylandi" ? "ok" : "er")}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="b s p" data-a="reqOpen:${r.id}">Detay</button>
          ${kind === "my" && r.status === "bekliyor" ? ` <button class="b s d" data-a="reqWithdraw:${r.id}">Geri çek</button>` : ""}
        </td></tr>`).join("") || `<tr><td colspan="5" style="color:var(--tm)">Kayıt yok.</td></tr>`);
  }

  function reqDetail() {
    const r = S.detail;
    const isApprover = r.approver === S.user.username && r.status === "bekliyor";
    return head(r.kind, `Talep #${r.id}`, `<button class="b" data-a="back">Kapat</button>`)
      + `<div class="card" style="max-width:640px">
        ${[["Konu", r.subject], ["Kategori", r.category || "—"], ["Talep eden", r.requested_by],
           ["Onaya düşen", r.approver], ["Gerekçe", r.reason],
           r.decided_by ? ["Karar", `${r.decided_by} · ${String(r.decided_at).slice(0, 16).replace("T", " ")}`] : null,
           r.decision_reason ? ["Ret gerekçesi", r.decision_reason] : null].filter(Boolean)
          .map((x) => `<div style="display:flex;gap:11px;margin-bottom:9px">
            <span class="lbl" style="width:96px;margin:0;flex-shrink:0">${esc(x[0])}</span>
            <span style="flex:1;font-size:12.5px">${esc(x[1])}</span></div>`).join("")}</div>
      <p style="font-size:11.5px;color:var(--tm);margin-top:10px">Bu ekranda talep içeriği değiştirilemez.</p>
      ${isApprover ? `<div style="display:flex;gap:9px;margin-top:12px">
        <button class="b d" data-a="reqReject:${r.id}">Reddet</button>
        <button class="b p" data-a="reqApprove:${r.id}">Onayla</button></div>` : ""}
      ${r.requested_by === S.user.username && r.status === "bekliyor"
        ? `<div style="margin-top:12px"><button class="b d" data-a="reqWithdraw:${r.id}">Geri çek</button></div>` : ""}`;
  }

  function adminUsers() {
    return head("Kullanıcılar", `${(S.data.items || []).length} kayıt`)
      + table(["Ad", "Kullanıcı", "Birim", "Ünvan", "Rol", "Yönetici", "Durum"],
        (S.data.items || []).map((u) => `<tr class="${u.active ? "" : "dim"}">
          <td>${esc(u.display_name)}</td><td class="m" style="color:var(--tm)">${esc(u.username)}</td>
          <td style="color:var(--t2)">${esc(u.unit_name || "—")}</td><td>${esc(u.title_name || "—")}</td>
          <td>${pill(u.role_key)}</td><td style="color:var(--t2)">${esc(u.manager || "—")}</td>
          <td>${u.active ? pill("aktif", "ok") : pill("pasif", "er")}</td></tr>`).join(""));
  }

  function adminAccess() {
    const roles = S.data.roles || [], perms = S.data.perms || [], modules = S.data.modules || [], screens = S.data.screens || {};
    const lv = (role, key) => (perms.find((p) => p.role_key === role && p.screen_key === key) || {}).level || "none";
    let rows = "";
    modules.forEach((m) => {
      [[m.key, m.label]].concat((screens[m.key] || []).map((s) => [s[0], s[1]])).forEach(([key, label]) => {
        rows += `<tr><td>${esc(label)}<div class="m" style="color:var(--tm)">${esc(key)}</div></td>` +
          roles.map((r) => {
            const v = lv(r.key, key), own = r.key === (S.data.myRole || "");
            return `<td style="text-align:center"><button class="b s ${v === "write" ? "ok" : ""}"
              data-a="permCycle:${r.key}:${key}:${v}">${v === "write" ? "W" : v === "read" ? "R" : "—"}</button></td>`;
          }).join("") + "</tr>";
      });
    });
    return head("Ekran yetkileri", "Hücreye tıklayınca — · R · W arasında geçer; kendi rolünüz kilitlidir")
      + table(["Ekran"].concat(roles.map((r) => r.label)), rows);
  }

  function adminScreens() {
    const st = S.data.states || {}, modules = S.data.modules || [], screens = S.data.screens || {};
    const label = { acik: "açık", bakim: "bakımda", kapali: "kapalı" };
    let rows = "";
    modules.forEach((m) => {
      [[m.key, m.label, true]].concat((screens[m.key] || []).map((s) => [s[0], s[1], false])).forEach(([key, lbl, isMod]) => {
        const cur = st[key] || "acik";
        rows += `<tr><td style="${isMod ? "font-weight:600" : "padding-left:22px;color:var(--t2)"}">${esc(lbl)}
          <div class="m" style="color:var(--tm)">${esc(key)}</div></td>
          <td>${pill(label[cur], cur === "acik" ? "ok" : cur === "bakim" ? "wr" : "er")}</td>
          <td style="text-align:right;white-space:nowrap">
            ${["acik", "bakim", "kapali"].map((x) => `<button class="b s ${cur === x ? "p" : ""}" data-a="screenSet:${key}:${x}">${label[x]}</button>`).join(" ")}
          </td></tr>`;
      });
    });
    return head("Ekran yönetimi", "Rollerden bağımsız açma, bakıma alma ve kapatma")
      + `<div class="card wr" style="margin-bottom:12px;font-size:12px;line-height:1.6">
        Kapalı bölüm hiç kimseye görünmez; bakımdaki bölüm menüde kalır ama açıldığında bakım bilgisi verilir.
        Admin Panel ve bu ekran kapatılamaz.</div>` + table(["Modül / ekran", "Durum", ""], rows);
  }

  function adminNotif() {
    const cols = [["to_req", "Talep sahibi"], ["to_mgr", "Yöneticisi"], ["to_appr", "Onaycı"], ["to_insp", "Teftiş ekibi"], ["to_all", "Tüm personel"]];
    return head("Bildirim tanımları", "Hangi olayda kimin e-posta alacağı")
      + table(["Olay"].concat(cols.map((c) => c[1])), (S.data.items || []).map((n) => `<tr>
        <td>${esc(n.label)}<div class="m" style="color:var(--tm)">${esc(n.event_key)}</div></td>
        ${cols.map((c) => `<td style="text-align:center">
          <button class="b s ${n[c[0]] ? "ok" : ""}" data-a="notifSet:${n.event_key}:${c[0]}:${n[c[0]] ? 0 : 1}">${n[c[0]] ? "açık" : "kapalı"}</button></td>`).join("")}
      </tr>`).join(""));
  }


  /* Süresi geçmiş okuma varsa portalın kalanı kapanır; yalnızca bu ekran gösterilir. */
  function lockView() {
    return `<div style="padding:26px 28px;background:linear-gradient(150deg,#3d0f14,#5a1620 60%,#2b0a10);color:#fff">
      <div style="display:flex;align-items:center;gap:13px;flex-wrap:wrap">
        <div style="flex:1;min-width:190px"><div style="font-size:18px">Portal erişimi kısıtlı</div>
          <div class="m" style="color:#F0C4C4;margin-top:3px">${esc(S.user.displayName)}</div></div>
        <button class="b s" data-a="logout" style="background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.28)">Çıkış</button></div>
      <p style="font-size:12.5px;color:#F0C4C4;line-height:1.7;max-width:560px">
        Okuma süresi geçmiş <b>${S.overdue.length} zorunlu dokümanınız</b> var. Bunları okuyup kavrama sınavını
        geçene kadar portalın diğer bölümlerine erişemezsiniz.</p></div>
      <div style="padding:20px 24px">
        <div class="lbl">Tamamlanması gereken okumalar</div>
        ${(S.data.items || []).map((d) => `<div class="card" style="margin-bottom:9px">
          <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap">
            <span class="m" style="color:var(--ta)">${esc(d.doc_no)}</span>
            <span style="flex:1;font-size:13px">${esc(d.title || "")}</span>
            ${pill("son tarih " + String(d.due_date).slice(0, 10), "er")}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:9px">
            <span class="m" style="color:var(--tm);flex:1">${esc(d.page_count)} sayfa · sayfa başına ${esc(S.settings.secondsPerPage)} sn</span>
            <button class="b d s" data-a="docRead:${d.doc_id}">Şimdi oku</button></div></div>`).join("")
          || `<p style="color:var(--tm);font-size:12px">Liste yükleniyor…</p>`}</div>`;
  }

  function trainingView() {
    const items = S.data.items || [];
    return head("Okunmamış dokümanlar", `Her sayfada en az ${S.settings.secondsPerPage} saniye · sonunda kavrama sınavı`)
      + table(["Numara", "Doküman", "Sayfa", "Son tarih", "Deneme", ""], items.map((d) => `<tr>
        <td class="m" style="color:var(--ta)">${esc(d.doc_no)}</td><td>${esc(d.title)}</td>
        <td class="m" style="text-align:center">${esc(d.page_count)}</td>
        <td>${pill(String(d.due_date).slice(0, 10), new Date(d.due_date) < new Date() ? "er" : "wr")}</td>
        <td class="m">${esc(d.attempts)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="b s p" data-a="docRead:${d.doc_id}">Oku</button>
          <button class="b s g" data-a="quizStart:${d.doc_no}">Sınava gir</button></td></tr>`).join("")
        || `<tr><td colspan="6" style="color:var(--tm)">Bekleyen zorunlu okumanız yok.</td></tr>`);
  }

  function trainingDoneView() {
    return head("Tamamlananlar", "Okuma tarihi, deneme sayısı ve sınav puanı")
      + table(["Numara", "Doküman", "Tarih", "Deneme", "Puan"], (S.data.items || []).map((d) => `<tr>
        <td class="m" style="color:var(--ta)">${esc(d.doc_no)}</td><td>${esc(d.title || "")}</td>
        <td class="m" style="color:var(--t2)">${String(d.completed_at).slice(0, 16).replace("T", " ")}</td>
        <td class="m">${esc(d.attempts)}</td><td>${pill(d.score + "/100", "ok")}</td></tr>`).join("")
        || `<tr><td colspan="5" style="color:var(--tm)">Kayıt yok.</td></tr>`);
  }

  function quizView() {
    if (S.quizResult) {
      const r = S.quizResult;
      return `<div style="max-width:560px"><div class="card ${r.passed ? "ok" : "er"}">
        <div style="font-size:15px">${r.passed ? `Sınavı ${r.score}/100 ile geçtiniz.` : `Puanınız ${r.score}/100 — geçme puanı ${r.passScore}.`}</div>
        <p style="font-size:12.5px;line-height:1.65;margin:9px 0 0">${r.passed
          ? "Okuma tamamlandı ve kayda geçti."
          : "Dokümanı baştan okuyup sınava yeniden girmeniz gerekiyor. Doğru yanıtlar gösterilmez."}</p></div>
        <div style="margin-top:13px"><button class="b p" data-a="quizExit">Tamam</button></div></div>`;
    }
    const q = S.quiz, answered = Object.keys(q.answers).length;
    return head(`Kavrama sınavı — ${q.docNo}`, `${q.questions.length} soru · geçme puanı ${q.passScore}/100 · ağırlıklı puanlama`,
      pill(`${answered} / ${q.questions.length} yanıtlandı`))
      + q.questions.map((item, i) => `<div class="card" style="margin-bottom:10px;max-width:620px">
        <div style="display:flex;gap:9px"><span class="m" style="color:var(--tm)">${i + 1}.</span>
          <span style="flex:1;font-size:13px">${esc(item.question)}</span>${pill("ağırlık " + item.weight)}</div>
        <div style="margin-top:10px">${item.options.map((o, j) => `<div class="card" style="padding:9px 11px;margin-bottom:6px;cursor:pointer;
          ${q.answers[item.id] === j ? "border-color:var(--navy);background:var(--ba)" : ""}" data-a="quizAnswer:${item.id}:${j}">
          <span style="font-size:12.5px">${esc(o)}</span></div>`).join("")}</div></div>`).join("")
      + `<div style="display:flex;gap:9px;justify-content:flex-end;max-width:620px">
        <button class="b" data-a="quizExit">Vazgeç</button>
        <button class="b ${answered === q.questions.length ? "g" : ""}" ${answered === q.questions.length ? "" : "disabled"} data-a="quizSubmit">Sınavı gönder</button></div>`;
  }

  function complianceReadView() {
    const items = S.data.items || [];
    return head("Okuma raporu", `${esc(S.data.docNo || "")} · ${items.length} kişi`,
      (S.data.docs || []).map((d) => `<button class="b s ${d === S.data.docNo ? "p" : ""}" data-a="compDoc:${d}">${esc(d)}</button>`).join(" "))
      + table(["Personel", "Yönetici", "Son tarih", "Deneme", "Puan", "Durum"], items.map((x) => `<tr>
        <td>${esc(x.display_name)}</td><td style="color:var(--t2)">${esc(x.manager || "—")}</td>
        <td class="m">${String(x.due_date).slice(0, 10)}</td><td class="m">${esc(x.attempts)}</td>
        <td class="m">${x.score == null ? "—" : x.score}</td>
        <td>${x.completed_at ? pill("tamamlandı", "ok") : x.overdue ? pill("süresi geçti", "er") : pill("bekliyor", "wr")}</td>
      </tr>`).join("") || `<tr><td colspan="6" style="color:var(--tm)">Kayıt yok.</td></tr>`);
  }

  function complianceRemView() {
    return head("Hatırlatma planı", "Uygulama arka planda gönderir; kullanıcılara gösterilmez",
      canWrite("c.rem") ? `<button class="b" data-a="remRun">Şimdi çalıştır</button>` : "")
      + table(["Personel", "Yönetici", "Doküman", "Son tarih", "Kalan gün", "Yükseltme"],
        (S.data.items || []).map((x) => `<tr>
          <td>${esc(x.display_name)}</td><td style="color:var(--t2)">${esc(x.manager || "—")}</td>
          <td class="m" style="color:var(--ta)">${esc(x.doc_no)}</td>
          <td class="m">${String(x.due_date).slice(0, 10)}</td>
          <td>${Number(x.days_left) < 0 ? pill("süresi geçti", "er") : pill(x.days_left + " gün", Number(x.days_left) <= 3 ? "wr" : "")}</td>
          <td class="m" style="color:var(--tm)">${x.escalated_at ? String(x.escalated_at).slice(0, 10) : "—"}</td>
        </tr>`).join("") || `<tr><td colspan="6" style="color:var(--tm)">Bekleyen okuma yok.</td></tr>`);
  }

  function auditView() {
    const v = S.data.verify;
    return head("Denetim kaydı", "Hash zinciri doğrulaması · son 200 kayıt")
      + `<div class="card ${v && v.ok ? "ok" : "er"}" style="margin-bottom:12px">
        ${v ? (v.ok ? `Zincir bütün — ${v.count} kayıt doğrulandı.` : `Zincir bozuk: ${esc(v.reason || "hash uyuşmazlığı")}`) : "—"}</div>`
      + table(["Zaman", "Kişi", "Olay", "Sonuç"], (S.data.items || []).map((a) => `<tr>
        <td class="m" style="color:var(--tm)">${String(a.at).slice(0, 16).replace("T", " ")}</td>
        <td>${esc(a.actor)}</td><td>${esc(a.event)}</td>
        <td>${a.ok ? pill("tamam", "ok") : pill("dikkat", "er")}</td></tr>`).join(""));
  }


  /* E-posta ayarları: parola hiçbir zaman ekrana geri gelmez, yalnızca tanımlı olduğu belirtilir. */
  function mailView() {
    const s = S.data.settings || {}, q = S.data.queue || {};
    const eff = s.effective || {};
    const encLabel = { none: "şifreleme yok (25)", starttls: "STARTTLS (587)", tls: "TLS (465)" };
    return head("E-posta ayarları", "Bildirim gönderimi için SMTP bilgileri",
      `<span class="pl ${s.active ? "ok" : "wr"}">${s.active ? "etkin" : "devre dışı"}</span>`)
      + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <form id="mailForm" class="card">
          <label class="lbl" style="display:block">SMTP sunucusu</label>
          <input name="host" placeholder="smtp.tera.local" value="${esc(s.host || "")}">
          <div style="display:flex;gap:9px;margin-top:12px">
            <div style="flex:1"><label class="lbl" style="display:block">Port</label>
              <input name="port" type="number" min="1" max="65535" value="${esc(s.port || 587)}"></div>
            <div style="flex:1.3"><label class="lbl" style="display:block">Şifreleme</label>
              <select name="encryption">${["starttls", "tls", "none"].map((e) =>
                `<option value="${e}" ${s.encryption === e ? "selected" : ""}>${encLabel[e]}</option>`).join("")}</select></div>
          </div>
          <label class="lbl" style="display:block;margin-top:12px">Kimlik doğrulama kullanıcısı</label>
          <input name="authUser" placeholder="boş bırakılırsa kimlik doğrulama yapılmaz" value="${esc(s.authUser || "")}">
          <label class="lbl" style="display:block;margin-top:12px">Parola</label>
          <input name="password" type="password" autocomplete="new-password"
                 placeholder="${s.passwordSet ? "kayıtlı — değiştirmek için yazın" : "parola"}">
          <p class="m" style="color:var(--tm);margin:6px 0 0">
            ${s.passwordSet ? "Parola kayıtlı ve şifreli saklanıyor. Boş bırakırsanız korunur." : "Parola henüz tanımlı değil."}
            Silmek için tek boşluk yazıp kaydedin.</p>
          <label class="lbl" style="display:block;margin-top:12px">Gönderen adresi</label>
          <input name="fromAddress" placeholder="portal@terayatirim.com.tr" value="${esc(s.fromAddress || "")}">
          <label class="lbl" style="display:block;margin-top:12px">Yanıt adresi (isteğe bağlı)</label>
          <input name="replyTo" value="${esc(s.replyTo || "")}">
          <label class="lbl" style="display:block;margin-top:12px">E-posta alan adı</label>
          <input name="mailDomain" placeholder="terayatirim.com.tr" value="${esc(s.mailDomain || "")}">
          <p class="m" style="color:var(--tm);margin:6px 0 0">Kullanıcının adresi kayıtlı değilse ad.soyad@alanadı biçiminde üretilir.</p>
          <label class="lbl" style="display:block;margin-top:12px">Teftiş ekibi grup adresi</label>
          <input name="groupInspection" value="${esc(s.groupInspection || "")}">
          <label class="lbl" style="display:block;margin-top:12px">Tüm personel grup adresi</label>
          <input name="groupAll" value="${esc(s.groupAll || "")}">
          <label style="display:flex;gap:9px;align-items:center;margin-top:14px;font-size:12.5px">
            <input type="checkbox" name="active" style="width:auto" ${s.active ? "checked" : ""}>
            Bu ayarları kullan (kapalıysa sunucu yapılandırmasına düşer)</label>
          <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:15px;flex-wrap:wrap">
            <button type="button" class="b" data-a="mailVerify">Bağlantıyı sına</button>
            <button type="button" class="b" data-a="mailTest">Deneme e-postası gönder</button>
            <button type="submit" class="b g">Kaydet</button></div>
        </form>
        <div>
          <div class="card" style="margin-bottom:11px">
            <div class="lbl">Geçerli yapılandırma</div>
            ${[["Kaynak", eff.source || "tanımsız"], ["Sunucu", eff.host || "—"], ["Port", eff.port || "—"],
               ["Gönderen", eff.from || "—"], ["Alan adı", eff.mailDomain || "—"],
               ["Teftiş grubu", eff.groupInspection || "—"], ["Tüm personel", eff.groupAll || "—"]]
              .map((x) => `<div style="display:flex;gap:11px;margin-bottom:7px">
                <span class="lbl" style="width:110px;margin:0;flex-shrink:0">${esc(x[0])}</span>
                <span style="flex:1;font-size:12.5px">${esc(x[1])}</span></div>`).join("")}
          </div>
          <div class="card ${s.lastTestOk === true ? "ok" : s.lastTestOk === false ? "er" : ""}" style="margin-bottom:11px">
            <div class="lbl">Son deneme</div>
            ${s.lastTestAt
              ? `<div style="font-size:12.5px">${String(s.lastTestAt).slice(0, 16).replace("T", " ")} —
                  ${s.lastTestOk ? "başarılı" : "başarısız"}</div>
                 ${s.lastTestError ? `<p class="m" style="margin:7px 0 0;line-height:1.6">${esc(s.lastTestError)}</p>` : ""}`
              : `<div style="font-size:12.5px;color:var(--tm)">Henüz deneme yapılmadı.</div>`}
          </div>
          <div class="card">
            <div class="lbl">Gönderim kuyruğu</div>
            <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
              <div><div class="m" style="font-size:20px">${esc(q.pending || 0)}</div>
                <div class="m" style="color:var(--tm)">bekleyen</div></div>
              <div><div class="m" style="font-size:20px;color:${(q.failed || 0) ? "var(--er-fg)" : "inherit"}">${esc(q.failed || 0)}</div>
                <div class="m" style="color:var(--tm)">hatalı</div></div>
              <span style="flex:1"></span>
              <button class="b s p" data-a="mailFlush">Kuyruğu şimdi gönder</button></div>
            <p class="m" style="color:var(--tm);margin:9px 0 0">Kuyruk normalde beş dakikada bir zamanlanmış görevle boşaltılır.</p>
          </div>
          ${s.updatedBy ? `<p class="m" style="color:var(--tm);margin-top:10px">Son değişiklik: ${esc(s.updatedBy)} ·
            ${String(s.updatedAt).slice(0, 16).replace("T", " ")}</p>` : ""}
        </div></div>`;
  }


  /* Raporlar: motor ayrı BI servisinde çalışır, portal katalog ve yaşam döngüsünü yönetir. */
  const REP_STATE = { gelistirme: ["geliştirme", "wr"], onayda: ["onay bekliyor", "wr"], yayinda: ["yayında", "ok"], emekli: ["emekli", "er"] };

  function reportListView() {
    const items = S.data.items || [];
    const live = items.filter((x) => x.status === "yayinda");
    const other = items.filter((x) => x.status !== "yayinda");
    const row = (x) => `<tr>
      <td class="m" style="color:var(--ta)">${esc(x.code)}</td>
      <td>${esc(x.name)}${x.description ? `<div class="m" style="color:var(--tm)">${esc(String(x.description).slice(0, 90))}</div>` : ""}</td>
      <td>${pill(x.area)}</td><td class="m">${esc(x.frequency)}</td>
      <td>${pill(...(REP_STATE[x.status] || [x.status, ""]))}</td>
      <td class="m" style="color:var(--t2)">${esc(x.owner)}</td>
      <td style="text-align:right">${x.status === "yayinda"
        ? `<button class="b s p" data-a="repOpen:${x.id}">Raporu aç</button>`
        : pill("yayında değil")}</td></tr>`;
    return head("Rapor kataloğu", "Raporlar BI servisinde açılır; yetki ve kayıt portalda tutulur")
      + `<div class="lbl">Yayında (${live.length})</div>`
      + table(["Kod", "Rapor", "Alan", "Sıklık", "Durum", "Sahibi", ""], live.map(row).join("")
        || `<tr><td colspan="7" style="color:var(--tm)">Yayında rapor yok.</td></tr>`)
      + (other.length ? `<div class="lbl" style="margin-top:14px">Yayında olmayanlar (${other.length})</div>
        <p class="m" style="color:var(--tm);margin:-4px 0 9px">Yalnızca sahibine, yöneticisine ve Teftiş'e görünür.</p>
        ${table(["Kod", "Rapor", "Alan", "Sıklık", "Durum", "Sahibi", ""], other.map(row).join(""))}` : "");
  }

  function reportDevView() {
    const items = S.data.items || [];
    return head("Rapor geliştirme", "Taslak oluştur, düzenle ve yayın onayına gönder",
      canWrite("r.dev") ? `<button class="b p" data-a="repNew">Yeni rapor</button>` : "")
      + table(["Kod", "Rapor", "BI yolu", "Durum", "Ret gerekçesi", ""], items.map((x) => `<tr>
        <td class="m" style="color:var(--ta)">${esc(x.code)}</td><td>${esc(x.name)}</td>
        <td class="m" style="color:var(--tm)">${esc(x.bi_path)}</td>
        <td>${pill(...(REP_STATE[x.status] || [x.status, ""]))}</td>
        <td class="m" style="color:var(--er-fg)">${esc(x.reject_reason || "")}</td>
        <td style="text-align:right;white-space:nowrap">
          ${x.owner === S.user.username && x.status !== "yayinda" ? `
            <button class="b s" data-a="repEdit:${x.id}">Düzenle</button>
            ${x.status === "gelistirme" ? `<button class="b s g" data-a="repPublish:${x.id}">Yayın onayına gönder</button>` : ""}
            <button class="b s d" data-a="repDelete:${x.id}">Sil</button>` : pill("izleme")}
        </td></tr>`).join("") || `<tr><td colspan="6" style="color:var(--tm)">Taslak rapor yok.</td></tr>`)
      + `<p style="font-size:11.5px;color:var(--tm);margin-top:12px">Yayın onayı Teftiş'tedir. Onaylanan rapor sürümü artar ve katalogda görünür.</p>`;
  }

  function reportUsageView() {
    return head("Kullanım raporu", "Hangi rapor kaç kez ve kaç kişi tarafından açıldı")
      + table(["Kod", "Rapor", "Durum", "Açılış", "Kullanıcı", "Son açılış"],
        (S.data.items || []).map((x) => `<tr>
          <td class="m" style="color:var(--ta)">${esc(x.code)}</td><td>${esc(x.name)}</td>
          <td>${pill(...(REP_STATE[x.status] || [x.status, ""]))}</td>
          <td class="m">${esc(x.opens)}</td><td class="m">${esc(x.users)}</td>
          <td class="m" style="color:var(--tm)">${x.last_open ? String(x.last_open).slice(0, 16).replace("T", " ") : "—"}</td>
        </tr>`).join("") || `<tr><td colspan="6" style="color:var(--tm)">Kayıt yok.</td></tr>`);
  }


  /* Delivery screens use English labels, matching Jira terminology. */
  const HEALTH = { planinda: ["On track", "ok"], risk: ["At risk", "wr"], gecikme: ["Delayed", "er"] };
  const STATE_EN = { backlog: "Backlog", todo: "To Do", prog: "In Progress", review: "In Review", test: "In Testing", done: "Done" };
  const progressBar = (pct, color) => `<div style="height:8px;background:var(--s1);border-radius:20px;overflow:hidden">
    <div style="height:8px;width:${Math.max(0, Math.min(100, pct))}%;background:${color || "var(--navy)"}"></div></div>`;

  function myWorkView() {
    const items = S.data.items || [];
    const byProject = {};
    items.forEach((i) => { (byProject[i.project_code] = byProject[i.project_code] || []).push(i); });
    return head("My Work", `${items.length} open items assigned to you`)
      + (Object.keys(byProject).length ? Object.keys(byProject).map((code) => `
        <div style="margin-bottom:15px">
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
            <span class="m" style="color:var(--ta)">${esc(code)}</span>
            <span style="font-size:13px;flex:1">${esc(byProject[code][0].project_name)}</span></div>
          ${table(["Type", "Key", "Summary", "Status", "Priority", "SP"], byProject[code].map((i) => `<tr>
            <td class="m">${esc(i.type)}</td><td class="m" style="color:var(--ta)">${esc(i.item_key)}</td>
            <td>${esc(i.title)}</td><td>${pill(STATE_EN[i.state] || i.state)}</td>
            <td class="m">${esc(i.priority)}</td><td class="m">${esc(i.points)}</td></tr>`).join(""))}
        </div>`).join("")
        : `<div class="card ok"><span style="font-size:12px">No open items assigned to you.</span></div>`);
  }

  function projectsView() {
    const items = S.data.items || [];
    return head("Projects", `${items.length} projects`)
      + table(["Code", "Project", "Method", "Lead", "Progress", "Items", "Open bugs", "Health", ""],
        items.map((p) => `<tr>
          <td class="m" style="color:var(--ta)">${esc(p.code)}</td><td>${esc(p.name)}</td>
          <td>${pill(p.method)}</td><td style="color:var(--t2)">${esc(p.lead)}</td>
          <td style="min-width:140px">${progressBar(p.completion, p.drift !== null && p.drift <= -15 ? "#a3121c" : "var(--navy)")}
            <span class="m" style="color:var(--tm)">${p.completion}% · ${p.done_points}/${p.points} SP${p.timeProgress !== null ? ` · time ${p.timeProgress}%` : ""}</span></td>
          <td class="m">${p.done_items}/${p.items}</td><td class="m">${p.open_bugs}</td>
          <td>${pill(...(HEALTH[p.health] || [p.health, ""]))}</td>
          <td style="text-align:right">${scrOf("d.charts") ? `<button class="b s p" data-a="projCharts:${esc(p.code)}">Charts</button>` : ""}</td>
        </tr>`).join("") || `<tr><td colspan="9" style="color:var(--tm)">No projects yet.</td></tr>`);
  }

  /* Burndown chart: ideal line vs actual remaining work, drawn from server snapshots. */
  function burndownSvg(bd) {
    if (!bd || !bd.sprint) return `<div class="card"><span style="font-size:12px;color:var(--tm)">No active sprint — burndown is available for Scrum projects only.</span></div>`;
    const series = bd.series || [], committed = bd.committed || 1;
    const W = 520, H = 190, pad = 32, n = Math.max(1, series.length - 1);
    const x = (i) => pad + i * (W - pad * 2) / n;
    const y = (v) => H - pad - (v / committed) * (H - pad * 2);
    const idealPath = `M ${x(0)} ${y(series[0] ? series[0].ideal : committed)} L ${x(n)} ${y(0)}`;
    const real = series.filter((p) => p.remaining !== null);
    const realPath = real.length ? "M " + real.map((p) => `${x(series.indexOf(p))} ${y(p.remaining)}`).join(" L ") : "";
    return `<div class="card">
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:13px">Burndown — ${esc(bd.sprint.name)}</span><span style="flex:1"></span>
        ${pill(`committed ${committed} SP`)}${real.length ? pill(`remaining ${real[real.length - 1].remaining} SP`, "ok") : ""}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Sprint burndown chart">
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--bd)"/>
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="var(--bd)"/>
        <path d="${idealPath}" stroke="var(--tm)" stroke-dasharray="5 4" fill="none" stroke-width="1.5"/>
        ${realPath ? `<path d="${realPath}" stroke="#0B1F48" fill="none" stroke-width="2.5"/>` : ""}
        ${real.map((p) => `<circle cx="${x(series.indexOf(p))}" cy="${y(p.remaining)}" r="3" fill="#B8894A"/>`).join("")}
      </svg>
      <div style="display:flex;gap:14px;font-size:11px;color:var(--t2)">
        <span style="color:var(--tm)">— — ideal</span><span style="color:var(--navy)">—— actual remaining</span></div>
      ${real.length ? "" : `<p class="m" style="color:var(--tm);margin:8px 0 0">No snapshots yet — the nightly burndown job writes them.</p>`}</div>`;
  }

  function velocitySvg(v) {
    if (!v || !v.length) return "";
    const max = Math.max(...v.flatMap((x) => [x.committed_points, x.completed_points, 1]));
    return `<div class="card"><div style="font-size:13px;margin-bottom:11px">Velocity</div>
      <div style="display:flex;gap:16px;align-items:flex-end">
        ${v.map((x) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px">
          <div style="display:flex;gap:4px;align-items:flex-end;height:100px">
            <div title="committed ${x.committed_points} SP" style="width:16px;height:${x.committed_points / max * 100}%;background:var(--bds);border-radius:4px 4px 0 0"></div>
            <div title="completed ${x.completed_points} SP" style="width:16px;height:${x.completed_points / max * 100}%;background:#0B1F48;border-radius:4px 4px 0 0"></div></div>
          <span class="m" style="color:var(--tm)">${esc(String(x.name).replace("Sprint ", "S"))}</span></div>`).join("")}</div>
      <div style="display:flex;gap:14px;font-size:11px;color:var(--t2);margin-top:8px">
        <span>▪ committed</span><span style="color:var(--navy)">▪ completed</span></div></div>`;
  }

  function distributionCards(d) {
    if (!d) return "";
    const maxState = Math.max(1, ...d.byState.map((x) => x.items));
    return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">
      <div class="card"><div style="font-size:13px;margin-bottom:11px">Status distribution</div>
        ${d.byState.map((x) => `<div style="display:flex;gap:9px;align-items:center;margin-bottom:7px;cursor:pointer"
          data-a="drillState:${esc(x.state)}" title="Click to list these issues">
          <span style="width:82px;font-size:11.5px;color:var(--t2)">${STATE_EN[x.state] || x.state}</span>
          <span style="flex:1">${progressBar(x.items / maxState * 100, x.state === "done" ? "#3B6D11" : "var(--navy)")}</span>
          <span class="m" style="width:20px;text-align:right">${x.items}</span></div>`).join("")}</div>
      <div class="card"><div style="font-size:13px;margin-bottom:11px">Issue types</div>
        ${d.byType.map((x) => `<div style="display:flex;gap:9px;align-items:center;margin-bottom:7px;cursor:pointer"
          data-a="drillType:${esc(x.type)}" title="Click to list these issues">
          <span style="width:52px;font-size:11.5px">${esc(x.type)}</span>
          <span style="flex:1">${progressBar(x.items ? x.done / x.items * 100 : 0)}</span>
          <span class="m" style="width:46px;text-align:right">${x.done}/${x.items}</span></div>`).join("")}</div>
      <div class="card"><div style="font-size:13px;margin-bottom:11px">Open work by assignee</div>
        ${d.byAssignee.filter((x) => x.open_items > 0).map((x) => `<div style="display:flex;gap:9px;align-items:center;margin-bottom:7px;cursor:pointer"
          data-a="drillWho:${encodeURIComponent(x.assignee)}" title="Click to list open work">
          <span style="width:96px;font-size:11.5px;color:var(--t2)">${esc(x.display_name || x.assignee)}</span>
          <span style="flex:1">${progressBar(x.open_points * 6, "#B8894A")}</span>
          <span class="m" style="width:46px;text-align:right">${x.open_points} SP</span></div>`).join("")
          || `<span style="font-size:12px;color:var(--tm)">No open work.</span>`}</div></div>`;
  }


  /* Drill-down: clicking a tile or chart row lists the underlying issues. */
  const DRILL_TITLE = { all: "All issues", open: "Open work", bugs: "Open bugs",
    late: "Open work — behind schedule", state: "Status", type: "Type", assignee: "Assignee" };
  function drillPanel() {
    const d = S.drill;
    if (!d) return "";
    const items = (S.data.items || []).filter((i) => {
      if (d.kind === "all") return true;
      if (d.kind === "open") return i.state !== "done";
      if (d.kind === "bugs") return i.type === "Bug" && i.state !== "done";
      if (d.kind === "late") return i.state !== "done";
      if (d.kind === "state") return i.state === d.value;
      if (d.kind === "type") return i.type === d.value;
      if (d.kind === "assignee") return i.state !== "done" && (i.assignee || "(unassigned)") === d.value;
      return false;
    });
    const title = d.value ? `${DRILL_TITLE[d.kind]}: ${d.kind === "state" ? (STATE_EN[d.value] || d.value) : d.value}`
                          : (DRILL_TITLE[d.kind] || "Items");
    return `<div class="card" style="margin-bottom:13px;border-color:var(--ta)">
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:13px">${esc(title)}</span>${pill(items.length + " items")}
        ${pill(items.reduce((a, i) => a + (i.points || 0), 0) + " SP")}<span style="flex:1"></span>
        <button class="b s" data-a="drillClose">Close</button></div>
      ${items.length ? table(["Type", "Key", "Summary", "Status", "Priority", "SP", "Assignee"],
        items.map((i) => `<tr><td class="m">${esc(i.type)}</td>
          <td class="m" style="color:var(--ta)">${esc(i.item_key)}</td><td>${esc(i.title)}</td>
          <td>${pill(STATE_EN[i.state] || i.state)}</td><td class="m">${esc(i.priority)}</td>
          <td class="m">${esc(i.points)}</td><td style="color:var(--t2)">${esc(i.assignee || "—")}</td></tr>`).join(""))
        : `<span style="font-size:12px;color:var(--tm)">No items match this selection.</span>`}</div>`;
  }

  function chartsView() {
    const list = S.data.projects || [], sel = S.data.selected, c = S.data.charts;
    if (!sel) return head("Project charts", "No projects yet.");
    const m = (c && c.metrics) || sel;
    return head("Project charts", `${sel.code} — ${sel.name}`,
      `<div style="display:flex;gap:7px;flex-wrap:wrap">${list.map((p) =>
        `<button class="b s ${p.code === sel.code ? "p" : ""}" data-a="projCharts:${esc(p.code)}">${esc(p.code)}</button>`).join("")}</div>`)
      + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:13px">
        ${[["Progress", m.completion + "%", "open"], ["Story points", `${m.done_points} / ${m.points}`, "open"],
           ["Issues", `${m.done_items} / ${m.items}`, "all"], ["Open bugs", m.open_bugs, "bugs"],
           ["Time elapsed", m.timeProgress === null ? "—" : m.timeProgress + "%", null],
           ["Drift %", m.drift === null ? "—" : (m.drift > 0 ? "+" : "") + m.drift + "%", "late"]]
          .map((x) => `<div class="card" ${x[2] ? `data-a="drill:${x[2]}" style="cursor:pointer" title="Click to drill down"` : ""}>
            <div class="lbl">${x[0]}${x[2] ? ` <span style="color:var(--ta)">→</span>` : ""}</div>
            <div class="m" style="font-size:19px;${x[0] === "Drift %" && m.drift !== null && m.drift < 0 ? "color:var(--er-fg)" : ""}">${x[1]}</div></div>`).join("")}</div>
      ${m.drift !== null && m.drift <= -20 ? `<div class="card er" style="margin-bottom:13px;font-size:12px;line-height:1.6;cursor:pointer" data-a="drill:late">
        Delivery is ${Math.abs(m.drift)}% behind the elapsed schedule (${m.completion}% done vs ${m.timeProgress}% elapsed).
        Click to list the open work.</div>` : ""}
      ${drillPanel()}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:13px">
        ${burndownSvg(c && c.burndown)}${velocitySvg(c && c.velocity)}</div>
      <p style="font-size:11.5px;color:var(--tm);margin:-4px 0 13px">Drift % = (delivery % − elapsed %) ÷ elapsed %.
        Click any tile or chart row to drill down into the underlying issues.</p>
      ${distributionCards(c && c.distribution)}`;
  }

  function execView() {
    if (S.data.execError) return head("Executive summary", "Restricted report")
      + `<div class="card er" style="max-width:560px"><div style="font-size:14px">Access restricted</div>
        <p style="font-size:12.5px;line-height:1.65;margin:8px 0 0">${esc(S.data.execError)}</p></div>`;
    const e = S.data.exec;
    if (!e) return head("Executive summary", "Loading…");
    /* Tiles filter the comparison table below — one click, no double-click needed. */
    const ef = S.execFilter, eu = S.execUnit;
    const FLABEL = { delayed: "Delayed projects", risk: "Projects at risk", bugs: "Projects with open bugs",
      attention: "Projects behind schedule", ontrack: "Projects on track", active: "Active projects" };
    const shown = e.projects.filter((p) => {
      if (eu) return (p.unit || "Unassigned unit") === eu;
      if (!ef) return true;
      if (ef === "delayed") return p.health === "gecikme";
      if (ef === "risk") return p.health === "risk";
      if (ef === "ontrack") return p.health === "planinda";
      if (ef === "bugs") return p.openBugs > 0;
      if (ef === "active") return p.status === "devam";
      if (ef === "attention") return p.drift !== null && p.drift <= -20;
      return true;
    });
    return head("Executive summary", `${e.totals.projects} projects · portfolio view`, pill("restricted", "wr"))
      + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:14px">
        ${[["Projects", e.totals.projects, null], ["Active", e.totals.active, "active"],
           ["Portfolio progress", e.totals.completion + "%", null],
           ["Story points", `${e.totals.donePoints} / ${e.totals.points}`, null],
           ["Delayed", e.totals.delayed, "delayed"], ["At risk", e.totals.atRisk, "risk"],
           ["Open bugs", e.totals.openBugs, "bugs"]]
          .map((x) => `<div class="card" ${x[2] ? `data-a="execFilter:${x[2]}" style="cursor:pointer;${ef === x[2] ? "border-color:var(--ta)" : ""}" title="Click to filter the table below"` : ""}>
            <div class="lbl">${x[0]}${x[2] ? ` <span style="color:var(--ta)">→</span>` : ""}</div>
            <div class="m" style="font-size:20px">${x[1]}</div></div>`).join("")}</div>
      ${(ef || eu) ? `<div class="card" style="margin-bottom:12px;border-color:var(--ta);display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12.5px">${eu ? "Unit: " + esc(eu) : FLABEL[ef]}</span>
        ${pill(`${shown.length} of ${e.projects.length}`)}<span style="flex:1"></span>
        <button class="b s" data-a="execFilter:">Clear filter</button></div>` : ""}
      ${e.attention.length ? `<div class="card wr" style="margin-bottom:14px">
        <div style="font-size:13px">Needs attention (${e.attention.length})</div>
        ${e.attention.map((a) => `<div style="display:flex;gap:9px;align-items:center;margin-top:9px;flex-wrap:wrap">
          <span class="m" style="color:var(--ta);width:60px">${esc(a.code)}</span>
          <span style="flex:1;font-size:12.5px">${esc(a.name)}</span>
          <span class="m">delivery ${a.completion}% · elapsed ${a.timeProgress}% · drift ${a.drift}%</span>
          <span class="m" style="color:var(--t2)">${esc(a.lead)}</span>
          <button class="b s" data-a="projCharts:${esc(a.code)}">Charts</button></div>`).join("")}</div>` : ""}
      <div class="lbl">Project comparison</div>
      ${table(["Code", "Project", "Method", "Lead", "Unit", "Progress", "Drift %", "Bugs", "Health", ""],
        shown.map((p) => `<tr><td class="m" style="color:var(--ta)">${esc(p.code)}</td><td>${esc(p.name)}</td>
          <td>${pill(p.method)}</td><td style="color:var(--t2)">${esc(p.lead)}</td>
          <td style="color:var(--t2)">${esc(p.unit || "—")}</td>
          <td style="min-width:130px">${progressBar(p.completion, p.drift !== null && p.drift <= -15 ? "#a3121c" : "var(--navy)")}
            <span class="m" style="color:var(--tm)">${p.completion}%</span></td>
          <td class="m" style="color:${p.drift !== null && p.drift < 0 ? "var(--er-fg)" : "var(--t1)"}">${p.drift === null ? "—" : (p.drift > 0 ? "+" : "") + p.drift}</td>
          <td class="m">${p.openBugs}</td>
          <td>${pill(...(HEALTH[p.health] || [p.health, ""]))}</td>
          <td style="text-align:right"><button class="b s p" data-a="projCharts:${esc(p.code)}">Charts</button></td></tr>`).join("")
        || `<tr><td colspan="10" style="color:var(--tm)">No projects match this filter.</td></tr>`)}
      <div class="lbl" style="margin-top:14px">By unit</div>
      ${table(["Unit", "Projects", "Story points", "Progress"], e.byUnit.map((u) => `<tr style="cursor:pointer"
        data-a="execUnit:${encodeURIComponent(u.unit)}" title="Click to filter by unit">
        <td>${esc(u.unit)}</td><td class="m">${u.projects}</td><td class="m">${u.donePoints} / ${u.points}</td>
        <td style="min-width:130px">${progressBar(u.completion)}<span class="m" style="color:var(--tm)">${u.completion}%</span></td>
      </tr>`).join(""))}
      <p style="font-size:11.5px;color:var(--tm);margin-top:12px">Every view of this report is written to the audit log.</p>`;
  }

  /* Dizin (AD) ayarları — servis hesabı parolası ekrana geri gelmez. */
  function directoryView() {
    const d = S.data.settings || {}, roles = S.data.roles || [];
    const eff = d.effective || {};
    return head("Dizin (AD) ayarları", "Kullanıcı girişleri bu bağlantı üzerinden doğrulanır",
      `<span class="pl ${d.active ? "ok" : "wr"}">${d.active ? "etkin" : "devre dışı"}</span>`)
      + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <form id="dirForm" class="card">
          <label class="lbl" style="display:block">Sunucu adresi</label>
          <input name="url" placeholder="ldaps://dc01.tera.local:636" value="${esc(d.url || "")}">
          <p class="m" style="color:var(--tm);margin:6px 0 0">Üretimde yalnızca ldaps:// kabul edilir.</p>
          <label class="lbl" style="display:block;margin-top:12px">Base DN</label>
          <input name="baseDn" placeholder="DC=tera,DC=local" value="${esc(d.baseDn || "")}">
          <label class="lbl" style="display:block;margin-top:12px">Servis hesabı DN</label>
          <input name="bindDn" placeholder="CN=svc-portal,OU=Servis,DC=tera,DC=local" value="${esc(d.bindDn || "")}">
          <label class="lbl" style="display:block;margin-top:12px">Servis hesabı parolası</label>
          <input name="bindPassword" type="password" autocomplete="new-password"
                 placeholder="${d.passwordSet ? "kayıtlı — değiştirmek için yazın" : "parola"}">
          <p class="m" style="color:var(--tm);margin:6px 0 0">
            ${d.passwordSet ? "Parola şifreli saklanıyor; boş bırakırsanız korunur." : "Parola henüz tanımlı değil."}</p>
          <label class="lbl" style="display:block;margin-top:12px">Kullanıcı filtresi</label>
          <input name="userFilter" value="${esc(d.userFilter || "")}">
          <p class="m" style="color:var(--tm);margin:6px 0 0">{username} yer tutucusu zorunludur.</p>
          <label class="lbl" style="display:block;margin-top:12px">Yeni kullanıcılar için varsayılan rol</label>
          <select name="defaultRole">${roles.map((r) =>
            `<option value="${esc(r.key)}" ${d.defaultRole === r.key ? "selected" : ""}>${esc(r.label)}</option>`).join("")}</select>
          <label style="display:flex;gap:9px;align-items:center;margin-top:13px;font-size:12.5px">
            <input type="checkbox" name="tlsVerify" style="width:auto" ${d.tlsVerify !== false ? "checked" : ""}>
            TLS sertifikasını doğrula (üretimde kapatılamaz)</label>
          <label style="display:flex;gap:9px;align-items:center;margin-top:9px;font-size:12.5px">
            <input type="checkbox" name="active" style="width:auto" ${d.active ? "checked" : ""}>
            Bu ayarları kullan (kapalıysa sunucu yapılandırmasına düşer)</label>
          <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:15px;flex-wrap:wrap">
            <button type="button" class="b" data-a="dirVerify">Bağlantıyı sına</button>
            <button type="button" class="b" data-a="dirLookup">Kullanıcı sorgula</button>
            <button type="submit" class="b g">Kaydet</button></div>
        </form>
        <div>
          <div class="card" style="margin-bottom:11px">
            <div class="lbl">Geçerli yapılandırma</div>
            ${[["Kaynak", eff.source || "tanımsız"], ["Sunucu", eff.url || "—"], ["Base DN", eff.baseDn || "—"],
               ["Servis hesabı", eff.bindDn || "—"], ["TLS doğrulama", eff.tlsVerify === false ? "kapalı" : "açık"]]
              .map((x) => `<div style="display:flex;gap:11px;margin-bottom:7px">
                <span class="lbl" style="width:110px;margin:0;flex-shrink:0">${esc(x[0])}</span>
                <span style="flex:1;font-size:12.5px">${esc(x[1])}</span></div>`).join("")}
          </div>
          <div class="card ${d.lastTestOk === true ? "ok" : d.lastTestOk === false ? "er" : ""}">
            <div class="lbl">Son deneme</div>
            ${d.lastTestAt
              ? `<div style="font-size:12.5px">${String(d.lastTestAt).slice(0, 16).replace("T", " ")} —
                  ${d.lastTestOk ? "başarılı" : "başarısız"}${d.lastTestUser ? ` (${esc(d.lastTestUser)})` : ""}</div>
                 ${d.lastTestError ? `<p class="m" style="margin:7px 0 0;line-height:1.6">${esc(d.lastTestError)}</p>` : ""}`
              : `<div style="font-size:12.5px;color:var(--tm)">Henüz deneme yapılmadı.</div>`}
          </div>
          <div class="card wr" style="margin-top:11px;font-size:12px;line-height:1.6">
            Portal parola saklamaz. Giriş sırasında kullanıcının parolası yalnızca dizin sunucusuna
            iletilir. Kullanıcının portalda tanımlı ve aktif olması da gerekir.</div>
          ${d.updatedBy ? `<p class="m" style="color:var(--tm);margin-top:10px">Son değişiklik: ${esc(d.updatedBy)} ·
            ${String(d.updatedAt).slice(0, 16).replace("T", " ")}</p>` : ""}
        </div></div>`;
  }

  function screenBody() {
    if (S.reading) return readerView();
    if (S.quiz || S.quizResult) return quizView();
    if (S.detail) return S.detail._type === "ann" ? annDetail() : S.detail._type === "doc" ? docDetail() : reqDetail();
    if (S.data.error) return `<div class="card wr">${esc(S.data.error)}</div>`;
    switch (S.scr) {
      case "a.list": return annView();
      case "k.docs": return docsView();
      case "k.queue": return queueView();
      case "p.in": return approvalsView("Onayımda bekleyenler", "Onay ve ret talebin detayındadır", S.data.items, "in");
      case "p.my": return approvalsView("Onay beklediklerim", "Düzeltme yoktur; geri çekip yeniden girin", S.data.items, "my");
      case "p.done": return approvalsView("Onayladıklarım", "Karar verdiğiniz talepler", S.data.items, "done");
      case "s.all": return head("Kısayollar", "Uygulamalar yeni sekmede açılır")
        + `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
          ${(S.data.items || []).map((s) => `<div class="card"><div style="display:flex;gap:9px;align-items:center">
            <span style="flex:1;font-size:13px">${esc(s.name)}</span>
            <a class="b s p" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Git</a></div>
            <div class="m" style="color:var(--tm);margin-top:8px">${esc(s.url)}</div></div>`).join("")}</div>`;
      case "t.un": return trainingView();
      case "t.done": return trainingDoneView();
      case "c.read": return complianceReadView();
      case "c.rem": return complianceRemView();
      case "m.users": return adminUsers();
      case "m.access": return adminAccess();
      case "m.avail": return adminScreens();
      case "m.notif": return adminNotif();
      case "m.mail": return mailView();
      case "r.list": return reportListView();
      case "r.dev": return reportDevView();
      case "r.usage": return reportUsageView();
      case "m.dir": return directoryView();
      case "d.my": return myWorkView();
      case "d.projects": return projectsView();
      case "d.charts": return chartsView();
      case "d.exec": return execView();
      case "c.audit": return auditView();
      default: {
        const s = scrOf(S.scr);
        return head(s ? s.label : "Ekran", "Bu ekran bu sürümde sunucu tarafında hazırlanıyor.");
      }
    }
  }

  function render() {
    document.documentElement.className = S.dark ? "dark" : "";
    if (S.view === "login") { app.innerHTML = loginView(); bindLogin(); return; }
    if (S.overdue.length && !S.reading && !S.quiz && !S.quizResult) {
      app.innerHTML = lockView() + (S.toast ? `<div class="toast ${S.toast.bad ? "er" : "ok"}">${esc(S.toast.msg)}</div>` : "");
      return;
    }
    const mod = S.modules.find((m) => m.key === S.mod);
    const pendingCount = (S.data.inboxCount || 0);
    app.innerHTML = `<div class="shell">
      <nav class="nv" aria-label="Modüller">
        ${S.modules.map((m) => `<button class="rail ${S.mod === m.key ? "on" : ""}" data-a="mod:${m.key}" title="${esc(m.label)}">
          ${m.label.slice(0, 2)}${m.key === "approvals" && pendingCount ? `<span class="badge">${pendingCount}</span>` : ""}</button>`).join("")}
        <div style="flex:1"></div>
        <button class="rail" data-a="theme" title="Tema">${S.dark ? "☀" : "☾"}</button>
        <button class="rail" data-a="logout" title="Çıkış">⎋</button></nav>
      <div class="sub">
        <div style="padding:6px 9px 12px;font-size:13px">${esc(mod ? mod.label : "")}</div>
        ${(mod ? mod.screens : []).map((s) => `<div class="si ${S.scr === s.key ? "on" : ""}" data-a="scr:${s.key}">
          <span style="flex:1">${esc(s.label)}</span>${s.state === "bakim" ? pill("bakım", "wr") : ""}</div>`).join("")}
      </div>
      <div class="main">
        <div class="scrbar">${(mod ? mod.screens : []).map((s) => `<div class="si ${S.scr === s.key ? "on" : ""}" data-a="scr:${s.key}">${esc(s.label)}</div>`).join("")}</div>
        <div class="top"><span style="font-size:11.5px;color:var(--tm)">${esc(mod ? mod.label : "")}</span>
          <span style="flex:1"></span>
          <span class="m" style="color:var(--tm)">${esc(S.user.displayName)}</span></div>
        <div class="body">${screenBody()}</div>
      </div></div>
      ${S.dlg ? dialogView() : ""}
      ${S.toast ? `<div class="toast ${S.toast.bad ? "er" : "ok"}">${esc(S.toast.msg)}</div>` : ""}`;
    bindForms();
  }

  function dialogView() {
    const d = S.dlg, f = S.form;
    if (d.type === "ann") {
      const crit = f.category === "Yasal" ? ["Kritik", "Yüksek"] : ["Yüksek", "Orta", "Düşük"];
      return `<div class="ov"><div class="dlg"><form id="dlgForm">
        <div style="font-size:15px">${d.id ? "Duyuruyu düzenle" : "Yeni duyuru"}</div>
        <div class="card wr" style="margin-top:10px;font-size:12px">Duyuru doğrudan yayınlanmaz; Yasal → Teftiş, Genel → yöneticiniz onayına gider.</div>
        <label class="lbl" style="display:block;margin-top:12px">Başlık</label><input name="title" required minlength="5" value="${esc(f.title || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Metin</label><textarea name="body" required minlength="11">${esc(f.body || "")}</textarea>
        <label class="lbl" style="display:block;margin-top:12px">Kategori</label>
        <div style="display:flex;gap:7px">${["Yasal", "Genel"].map((c) => `<button type="button" class="b ${f.category === c ? "p" : ""}" data-a="formSet:category:${c}">${c}</button>`).join("")}</div>
        <label class="lbl" style="display:block;margin-top:12px">Kritiklik</label>
        <div style="display:flex;gap:7px;flex-wrap:wrap">${crit.map((c) => `<button type="button" class="b ${f.criticality === c ? "p" : ""}" data-a="formSet:criticality:${c}">${c}</button>`).join("")}</div>
        <label class="lbl" style="display:block;margin-top:12px">Geçerlilik bitiş</label><input type="date" name="validUntil" required value="${esc(f.validUntil || "")}">
        <label style="display:flex;gap:9px;align-items:center;margin-top:12px;font-size:12px">
          <input type="checkbox" name="popup" style="width:auto" ${f.popup ? "checked" : ""}> Girişte pop-up göster</label>
        <div style="display:flex;justify-content:flex-end;gap:9px;margin-top:15px">
          <button type="button" class="b" data-a="dlgClose">Vazgeç</button>
          <button type="submit" class="b g">Onaya gönder</button></div></form></div></div>`;
    }
    if (d.type === "doc") {
      return `<div class="ov"><div class="dlg"><form id="dlgForm" enctype="multipart/form-data">
        <div style="font-size:15px">Doküman ekle</div>
        <p style="font-size:12px;color:var(--t2)">Yalnızca PDF. Yükleme Teftiş onayına gider.</p>
        <label class="lbl" style="display:block;margin-top:12px">Doküman no</label><input name="docNo" required pattern="[A-Z0-9-]{4,32}" value="${esc(f.docNo || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Başlık</label><input name="title" required minlength="5" value="${esc(f.title || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Kategori</label>
        <div style="display:flex;gap:7px">${["Yasal", "Genel"].map((c) => `<button type="button" class="b ${f.category === c ? "p" : ""}" data-a="formSet:category:${c}">${c}</button>`).join("")}</div>
        <label class="lbl" style="display:block;margin-top:12px">Sayfa sayısı</label><input type="number" name="pageCount" min="1" max="500" value="${esc(f.pageCount || 1)}">
        <label class="lbl" style="display:block;margin-top:12px">PDF dosya</label><input type="file" name="file" accept="application/pdf" required>
        <div style="display:flex;justify-content:flex-end;gap:9px;margin-top:15px">
          <button type="button" class="b" data-a="dlgClose">Vazgeç</button>
          <button type="submit" class="b g">Yükle ve onaya gönder</button></div></form></div></div>`;
    }
    if (d.type === "report") {
      return `<div class="ov"><div class="dlg"><form id="dlgForm">
        <div style="font-size:15px">${d.id ? "Raporu düzenle" : "Yeni rapor"}</div>
        <p style="font-size:12px;color:var(--t2)">Rapor BI servisinde geliştirilir; buraya katalog bilgisi girilir.</p>
        <label class="lbl" style="display:block;margin-top:12px">Kod</label>
        <input name="code" required placeholder="RPT-014" value="${esc(f.code || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Rapor adı</label>
        <input name="name" required minlength="5" value="${esc(f.name || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Alan</label>
        <input name="area" required placeholder="Aracılık" value="${esc(f.area || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Sıklık</label>
        <select name="frequency">${["anlık", "günlük", "haftalık", "aylık", "üç aylık"].map((x) =>
          `<option value="${x}" ${f.frequency === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <label class="lbl" style="display:block;margin-top:12px">BI yolu</label>
        <input name="biPath" required placeholder="araclik/gunluk-islem-hacmi" value="${esc(f.biPath || "")}">
        <label class="lbl" style="display:block;margin-top:12px">Açıklama</label>
        <textarea name="description">${esc(f.description || "")}</textarea>
        <label class="lbl" style="display:block;margin-top:12px">Erişebilecek roller (boş: yetkisi olan tüm roller)</label>
        <input name="allowedRoles" placeholder="gmy, inspection" value="${esc((f.allowedRoles || []).join(", "))}">
        <div style="display:flex;justify-content:flex-end;gap:9px;margin-top:15px">
          <button type="button" class="b" data-a="dlgClose">Vazgeç</button>
          <button type="submit" class="b g">Kaydet</button></div></form></div></div>`;
    }
    if (d.type === "reason") {
      return `<div class="ov"><div class="dlg"><form id="dlgForm">
        <div style="font-size:15px">${esc(d.title)}</div>
        <p style="font-size:12px;color:var(--t2);line-height:1.6">${esc(d.note || "")}</p>
        <label class="lbl" style="display:block;margin-top:12px">Gerekçe (en az 10 karakter)</label>
        <textarea name="reason" required minlength="10"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:9px;margin-top:15px">
          <button type="button" class="b" data-a="dlgClose">Vazgeç</button>
          <button type="submit" class="b d">${esc(d.confirmLabel || "Gönder")}</button></div></form></div></div>`;
    }
    return "";
  }

  /* ---------------- olaylar ---------------- */
  function bindLogin() {
    const form = document.getElementById("loginForm");
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        const res = await api("/auth/login", { method: "POST", body: { username: fd.get("username"), password: fd.get("password") } });
        csrfToken = res.csrfToken || csrfToken;
        S.loginError = null; S.view = "app";
        await loadMe(); await loadScreen(); await refreshCounts(); render();
      } catch (err) {
        S.loginError = err.status === 429 ? "Çok fazla deneme. Bir süre sonra tekrar deneyin." : "Kullanıcı adı veya parola hatalı.";
        render();
      }
    };
  }

  function bindForms() {
    const dirForm = document.getElementById("dirForm");
    if (dirForm) {
      dirForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(dirForm);
        const body = {
          url: (fd.get("url") || "").trim(),
          baseDn: (fd.get("baseDn") || "").trim(),
          bindDn: (fd.get("bindDn") || "").trim(),
          userFilter: (fd.get("userFilter") || "").trim(),
          defaultRole: fd.get("defaultRole"),
          tlsVerify: !!fd.get("tlsVerify"),
          autoCreateUsers: false,
          active: !!fd.get("active"),
        };
        const pass = fd.get("bindPassword");
        if (pass && pass.trim().length) body.bindPassword = pass;
        else if (pass === " ") body.bindPassword = "";
        try {
          await api("/admin/directory", { method: "PUT", body });
          toast("Dizin ayarları kaydedildi.");
          await loadScreen(); render();
        } catch (err) { if (!err.handled) toast(err.message, true); }
      };
    }
    const mailForm = document.getElementById("mailForm");
    if (mailForm) {
      mailForm.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(mailForm);
        const body = {
          host: (fd.get("host") || "").trim(),
          port: Number(fd.get("port")),
          encryption: fd.get("encryption"),
          authUser: (fd.get("authUser") || "").trim(),
          fromAddress: (fd.get("fromAddress") || "").trim(),
          replyTo: (fd.get("replyTo") || "").trim(),
          mailDomain: (fd.get("mailDomain") || "").trim(),
          groupInspection: (fd.get("groupInspection") || "").trim(),
          groupAll: (fd.get("groupAll") || "").trim(),
          active: !!fd.get("active"),
        };
        const pass = fd.get("password");
        /* Boş bırakılırsa gönderilmez (kayıtlı parola korunur); tek boşluk silme anlamındadır. */
        if (pass && pass.trim().length) body.password = pass;
        else if (pass === " ") body.password = "";
        try {
          await api("/admin/mail", { method: "PUT", body });
          toast("E-posta ayarları kaydedildi.");
          await loadScreen(); render();
        } catch (err) { toast(err.message, true); }
      };
    }
    const form = document.getElementById("dlgForm");
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        if (S.dlg.type === "ann") {
          const body = {
            title: fd.get("title"), body: fd.get("body"),
            category: S.form.category || "Genel", criticality: S.form.criticality || "Orta",
            validUntil: fd.get("validUntil"), popup: !!fd.get("popup"),
          };
          if (S.dlg.id) await api(`/announcements/${S.dlg.id}`, { method: "PUT", body });
          else { const r = await api("/announcements", { method: "POST", body }); toast(`Duyuru ${r.approver} onayına gönderildi.`); }
        } else if (S.dlg.type === "doc") {
          fd.set("category", S.form.category || "Genel");
          await api("/documents", { method: "POST", body: fd });
          toast("Doküman Teftiş onayına gönderildi.");
        } else if (S.dlg.type === "report") {
          const body = {
            code: (fd.get("code") || "").trim().toUpperCase(),
            name: fd.get("name"), area: fd.get("area"), frequency: fd.get("frequency"),
            biPath: (fd.get("biPath") || "").trim(),
            description: fd.get("description") || "",
            allowedRoles: String(fd.get("allowedRoles") || "").split(",").map((x) => x.trim()).filter(Boolean),
          };
          if (S.dlg.id) await api(`/reports/${S.dlg.id}`, { method: "PUT", body });
          else await api("/reports", { method: "POST", body });
          toast("Rapor kaydedildi.");
        } else if (S.dlg.type === "reason") {
          await S.dlg.submit(fd.get("reason"));
        }
        S.dlg = null; S.form = {}; S.detail = null;
        await loadScreen(); await refreshCounts(); render();
      } catch (err) { toast(err.message, true); }
    };
  }

  async function refreshCounts() {
    try { S.data.inboxCount = (await api("/approvals/inbox")).items.length; } catch (_) { S.data.inboxCount = 0; }
  }

  app.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-a]");
    if (!el) return;
    const [k, ...p] = el.dataset.a.split(":");
    try {
      if (k === "theme") { S.dark = !S.dark; return render(); }
      if (k === "togglePw") {
        const el = document.getElementById("p");
        if (el) { const keep = el.value; S.showPw = !S.showPw; el.type = S.showPw ? "text" : "password";
          el.value = keep;
          const btn = document.querySelector('[data-a="togglePw"]');
          if (btn) btn.textContent = S.showPw ? "gizle" : "göster"; }
        return;
      }
      if (k === "logout") { await api("/auth/logout", { method: "POST" }); S.view = "login"; S.user = null; return render(); }
      if (k === "mod") {
        const m = S.modules.find((x) => x.key === p[0]);
        S.mod = m.key; S.scr = m.screens[0] && m.screens[0].key; S.detail = null; S.reading = null;
        await loadScreen(); return render();
      }
      if (k === "scr") {
        const sc = scrOf(p[0]);
        if (sc && sc.state && sc.state !== "acik") {
          toast(sc.state === "bakim" ? "Bu ekran bakımda." : "Bu ekran kullanımda değil.", true);
          S.view = "home"; return render();
        }
        S.scr = p[0]; S.detail = null; S.reading = null; await loadScreen(); return render();
      }
      if (k === "back") { S.detail = null; await loadScreen(); return render(); }

      if (k === "annNew") { S.form = { category: "Genel", criticality: "Orta" }; S.dlg = { type: "ann" }; return render(); }
      if (k === "annEdit") {
        const a = (S.data.items || []).find((x) => String(x.id) === p[0]) || S.detail;
        S.form = { title: a.title, body: a.body, category: a.category, criticality: a.criticality, validUntil: String(a.valid_until).slice(0, 10), popup: a.popup };
        S.dlg = { type: "ann", id: a.id }; return render();
      }
      if (k === "annOpen") {
        const a = (S.data.items || []).find((x) => String(x.id) === p[0]);
        S.detail = Object.assign({ _type: "ann" }, a); return render();
      }
      if (k === "annRead") { await api(`/announcements/${p[0]}/read`, { method: "POST" }); toast("Duyuru okundu olarak işaretlendi."); S.detail = null; await loadScreen(); return render(); }
      if (k === "annDel") {
        S.dlg = { type: "reason", title: "Duyuruyu sil", confirmLabel: "Onaya gönder",
          note: "Silme doğrudan yapılmaz; talep onaya düşer ve onaylanana kadar duyuru yayında kalır.",
          submit: async (reason) => { await api(`/announcements/${p[0]}/delete-request`, { method: "POST", body: { reason } }); toast("Silme talebi onaya gönderildi."); } };
        return render();
      }

      if (k === "docNew") { S.form = { category: "Genel", pageCount: 1 }; S.dlg = { type: "doc" }; return render(); }
      if (k === "docDetail") { const d = await api(`/documents/${p[0]}`); S.detail = Object.assign({ _type: "doc" }, d.item); return render(); }
      if (k === "docApprove") {
        const reqs = (await api("/approvals/inbox")).items.find((r) => r.target_type === "document" && r.target_id === String(p[0]) && r.kind === "doc.publish");
        if (!reqs) return toast("Bu doküman için onayınızda talep yok.", true);
        await api(`/approvals/${reqs.id}/approve`, { method: "POST" });
        toast("Doküman yayına alındı."); S.detail = null; await loadScreen(); await refreshCounts(); return render();
      }
      if (k === "docReject") {
        const reqs = (await api("/approvals/inbox")).items.find((r) => r.target_type === "document" && r.target_id === String(p[0]) && r.kind === "doc.publish");
        if (!reqs) return toast("Bu doküman için onayınızda talep yok.", true);
        S.dlg = { type: "reason", title: "Dokümanı reddet", confirmLabel: "Reddet ve kaydet",
          note: "Gerekçe yükleyen kişiye e-posta ile bildirilir.",
          submit: async (reason) => { await api(`/approvals/${reqs.id}/reject`, { method: "POST", body: { reason } }); toast("Doküman reddedildi."); } };
        return render();
      }
      if (k === "docDelReq") {
        S.dlg = { type: "reason", title: "Kaldırma talebi", confirmLabel: "Onaya gönder",
          note: "Talep Teftiş onayına düşer; onaylanana kadar doküman yayında kalır.",
          submit: async (reason) => { await api(`/documents/${p[0]}/delete-request`, { method: "POST", body: { reason } }); toast("Kaldırma talebi gönderildi."); } };
        return render();
      }
      if (k === "docRead") {
        const d = await api(`/documents/${p[0]}`);
        const st = await api(`/documents/${p[0]}/reading/start`, { method: "POST" });
        S.reading = { doc: d.item, sessionId: st.sessionId, required: st.secondsPerPage, pageCount: st.pageCount, page: 0, pageSeconds: {} };
        startPing(); return render();
      }
      if (k === "readPage") { S.reading.page = Number(p[0]); return render(); }
      if (k === "readClose") { stopPing(); S.reading = null; await loadScreen(); return render(); }
      if (k === "readAck") {
        try {
          await api(`/documents/reading/${S.reading.sessionId}/ack`, { method: "POST" });
          const docNo = S.reading.doc.doc_no;
          stopPing(); S.reading = null;
          /* Zorunlu okumaysa doğrudan sınava geçilir. */
          try {
            const q = await api(`/training/${docNo}/quiz`);
            S.quiz = { docNo, questions: q.questions, passScore: q.passScore, answers: {} };
            toast("Okuma onaylandı. Kavrama sınavı açıldı.");
          } catch (_) { toast("Okuma onaylandı ve kayda geçti."); }
          await loadMe(); await loadScreen(); return render();
        } catch (err) {
          return toast(err.body && err.body.missingPages ? `Eksik sayfa: ${err.body.missingPages.join(", ")}` : err.message, true);
        }
      }

      if (k === "quizStart") {
        try {
          const q = await api(`/training/${p[0]}/quiz`);
          S.quiz = { docNo: p[0], questions: q.questions, passScore: q.passScore, answers: {} };
          S.quizResult = null; return render();
        } catch (err) { return toast(err.status === 422 ? "Önce dokümanı okuyup onaylamanız gerekiyor." : err.message, true); }
      }
      if (k === "quizAnswer") { S.quiz.answers[p[0]] = Number(p[1]); return render(); }
      if (k === "quizSubmit") {
        const res = await api(`/training/${S.quiz.docNo}/quiz`, { method: "POST", body: { answers: S.quiz.answers } });
        S.quizResult = res; S.quiz = null;
        await loadMe(); return render();
      }
      if (k === "quizExit") {
        S.quiz = null; S.quizResult = null; S.scr = "t.un";
        await loadMe(); await loadScreen(); return render();
      }
      if (k === "compDoc") { S.data = await api(`/compliance/reading?docNo=${encodeURIComponent(p[0])}`); return render(); }
      if (k === "remRun") {
        const r = await api("/compliance/reminders/run", { method: "POST" });
        toast(`Hatırlatma çalıştı: ${r.reminded} bildirim, ${r.escalated} süre aşımı.`);
        await loadScreen(); return render();
      }
      if (k === "repNew") { S.form = { frequency: "günlük", allowedRoles: [] }; S.dlg = { type: "report" }; return render(); }
      if (k === "repEdit") {
        const x = (S.data.items || []).find((i) => String(i.id) === p[0]);
        S.form = { code: x.code, name: x.name, area: x.area, frequency: x.frequency, biPath: x.bi_path,
          description: x.description, allowedRoles: Array.isArray(x.allowed_roles) ? x.allowed_roles : [] };
        S.dlg = { type: "report", id: x.id }; return render();
      }
      if (k === "repDelete") {
        S.dlg = { type: "reason", title: "Raporu sil", confirmLabel: "Sil",
          note: "Yayına girmemiş rapor doğrudan silinir; bekleyen yayın talebi varsa geri çekilir.",
          submit: async () => { await api(`/reports/${p[0]}`, { method: "DELETE" }); toast("Rapor silindi."); } };
        return render();
      }
      if (k === "repPublish") {
        S.dlg = { type: "reason", title: "Yayın onayına gönder", confirmLabel: "Onaya gönder",
          note: "Talep Teftiş onayına düşer. Onaylanana kadar rapor katalogda yayında görünmez.",
          submit: async (reason) => {
            const r = await api(`/reports/${p[0]}/publish-request`, { method: "POST", body: { reason } });
            toast(`Yayın talebi ${r.approver} onayına gönderildi.`);
          } };
        return render();
      }
      if (k === "repOpen") {
        const r = await api(`/reports/${p[0]}/open`, { method: "POST" });
        if (!r.url) return toast("BI adresi tanımlı değil; sistem yöneticisine bildirin.", true);
        /* Kimlik devri anahtarı BI servisine iletilir; rapor yeni sekmede açılır. */
        const url = r.url + (r.url.includes("?") ? "&" : "?") + "sso=" + encodeURIComponent(r.token);
        window.open(url, "_blank", "noopener,noreferrer");
        toast("Rapor BI servisinde yeni sekmede açılıyor.");
        return;
      }
      if (k === "reqOpen") { const r = await api(`/approvals/${p[0]}`); S.detail = Object.assign({ _type: "req" }, r.item); return render(); }
      if (k === "reqApprove") {
        await api(`/approvals/${p[0]}/approve`, { method: "POST" });
        toast("Talep onaylandı."); S.detail = null; await loadScreen(); await refreshCounts(); return render();
      }
      if (k === "reqReject") {
        S.dlg = { type: "reason", title: "Talebi reddet", confirmLabel: "Reddet ve kaydet",
          note: "Gerekçe talep sahibine bildirilir ve denetim kaydına yazılır.",
          submit: async (reason) => { await api(`/approvals/${p[0]}/reject`, { method: "POST", body: { reason } }); toast("Talep reddedildi."); S.detail = null; } };
        return render();
      }
      if (k === "reqWithdraw") {
        await api(`/approvals/${p[0]}/withdraw`, { method: "POST" });
        toast("Talep geri çekildi."); S.detail = null; await loadScreen(); return render();
      }

      if (k === "permCycle") {
        const next = { none: "read", read: "write", write: "none" }[p[2]];
        await api("/admin/permissions", { method: "PUT", body: { roleKey: p[0], screenKey: p[1], level: next } });
        await loadScreen(); return render();
      }
      if (k === "screenSet") {
        await api("/admin/screens", { method: "PUT", body: { key: p[0], state: p[1] } });
        await loadMe(); await loadScreen(); return render();
      }
      if (k === "dirVerify") {
        try {
          const r = await api("/admin/directory/verify", { method: "POST" });
          toast(`Dizin bağlantısı kuruldu: ${r.url}`);
        } catch (err) { toast("Bağlantı kurulamadı: " + ((err.body && err.body.error) || err.message), true); }
        await loadScreen(); return render();
      }
      if (k === "dirLookup") {
        const username = window.prompt("Dizinde sorgulanacak kullanıcı adı:");
        if (!username) return;
        try {
          const r = await api("/admin/directory/lookup", { method: "POST", body: { username } });
          toast(`Bulundu: ${r.displayName || username}${r.title ? " · " + r.title : ""}`);
        } catch (err) { toast("Bulunamadı: " + ((err.body && err.body.error) || err.message), true); }
        await loadScreen(); return render();
      }
      if (k === "execFilter") { S.execFilter = p[0] || null; S.execUnit = null; return render(); }
      if (k === "execUnit") { S.execUnit = decodeURIComponent(p[0] || ""); S.execFilter = null; return render(); }
      if (k === "drill") { S.drill = { kind: p[0] }; return render(); }
      if (k === "drillState") { S.drill = { kind: "state", value: p[0] }; return render(); }
      if (k === "drillType") { S.drill = { kind: "type", value: p[0] }; return render(); }
      if (k === "drillWho") { S.drill = { kind: "assignee", value: decodeURIComponent(p[0]) }; return render(); }
      if (k === "drillClose") { S.drill = null; return render(); }
      if (k === "projCharts") {
        S.drill = null;
        S.proj = p[0]; S.mod = "delivery"; S.scr = "d.charts";
        await loadScreen(); return render();
      }
      if (k === "mailVerify") {
        try {
          const r = await api("/admin/mail/verify", { method: "POST" });
          toast(`Bağlantı kuruldu: ${r.host}:${r.port} (${r.encryption})`);
        } catch (err) { toast("Bağlantı kurulamadı: " + (err.body && err.body.error ? err.body.error : err.message), true); }
        await loadScreen(); return render();
      }
      if (k === "mailTest") {
        try {
          const r = await api("/admin/mail/test", { method: "POST" });
          toast(`Deneme e-postası gönderildi: ${r.recipient}`);
        } catch (err) { toast("Deneme gönderilemedi: " + (err.body && err.body.error ? err.body.error : err.message), true); }
        await loadScreen(); return render();
      }
      if (k === "mailFlush") {
        const r = await api("/admin/mail/flush", { method: "POST" });
        toast(`Gönderilen ${r.sent}, hatalı ${r.failed}, kuyrukta ${r.pending}.`, r.failed > 0);
        await loadScreen(); return render();
      }
      if (k === "notifSet") {
        await api("/admin/notifications", { method: "PUT", body: { eventKey: p[0], field: p[1], value: p[2] === "1" } });
        await loadScreen(); return render();
      }
      if (k === "formSet") { S.form[p[0]] = p[1]; if (p[0] === "category") S.form.criticality = null; return render(); }
      if (k === "dlgClose") { S.dlg = null; S.form = {}; return render(); }
    } catch (err) { if (!err.handled) toast(err.message, true); }
  });

  /* Okuma süresi: istemci 5 saniyede bir ping atar, sunucu gerçek farkı ekler. */
  let pingTimer = null;
  function startPing() {
    stopPing();
    pingTimer = setInterval(async () => {
      if (!S.reading || document.hidden) return;   // sekme arka plandayken süre işlemez
      try {
        const r = await api(`/documents/reading/${S.reading.sessionId}/ping`, { method: "POST", body: { page: S.reading.page } });
        S.reading.pageSeconds = r.pageSeconds; render();
      } catch (_) { stopPing(); }
    }, 5000);
  }
  function stopPing() { if (pingTimer) clearInterval(pingTimer); pingTimer = null; }

  /* ---------------- açılış ---------------- */
  (async function boot() {
    try {
      await loadMe(); S.view = "app";
      await loadScreen(); await refreshCounts();
    } catch (_) { S.view = "login"; }
    render();
  })();
})();
