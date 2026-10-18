// Generic host bootstrap (specs/web-notebook.md §5). Reads content/app.json from the subject folder,
// picks the view named by the URL hash (or the last one used), loads that view's content files into
// its data, sets globalThis.LH_CONFIG and only then loads the kit bundle, which reads the config once
// at start. Switching views reloads the page so each part mounts from stored state. Every URL is
// relative to the page, so the same file serves "/" locally and "/study/<slug>/" behind the gateway.
(function () {
  var app = document.getElementById("app");
  var nav = document.getElementById("lh-host-nav");
  var local = window.LH_LOCAL || {};

  function fail(msg) {
    app.className = "lh-host-msg";
    app.textContent = msg;
  }
  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function getJson(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " HTTP " + r.status);
      return r.json();
    });
  }
  // A content file is JSON unless it is Markdown or plain text, which a part reads as a string.
  function getContent(path) {
    if (!/\.(md|txt)$/i.test(path)) return getJson(path);
    return fetch(path, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " HTTP " + r.status);
      return r.text();
    });
  }

  // Behind the gateway the page holds no token at all (GW-3): the gateway adds it on the server side.
  if (!local.token && !local.gated) {
    fail("host/local.config.js 가 없거나 token 이 비어 있습니다. local.config.example.js 를 복사해 .env 의 AI_SERVER_TOKEN 과 같은 값을 넣으세요.");
    return;
  }

  // A loading line beside #app until the part puts anything into it: a remote page may read state for
  // seconds before its first paint. Kept outside #app so no part has to know to clear it.
  var loading = document.createElement("div");
  loading.className = "lh-host-msg lh-host-loading";
  loading.textContent = "불러오는 중…";
  app.parentNode.insertBefore(loading, app);
  function doneLoading() { if (loading.parentNode) loading.parentNode.removeChild(loading); }
  if (window.MutationObserver) {
    new MutationObserver(function (_, obs) { if (app.childNodes.length) { doneLoading(); obs.disconnect(); } })
      .observe(app, { childList: true });
  }

  getJson("content/app.json")
    .then(function (cfg) {
      var views = Array.isArray(cfg.views) ? cfg.views : [];
      if (!views.length) throw new Error("content/app.json 에 views 가 없습니다.");
      var ns = cfg.namespace || "lh";
      var lastKey = "lh:" + ns + ":host:view";
      var wanted = window.location.hash.replace(/^#/, "") || recall(lastKey) || views[0].hash;
      var view = views.filter(function (v) { return v.hash === wanted; })[0] || views[0];
      remember(lastKey, view.hash);
      if (cfg.title) document.title = cfg.title;

      // Nav: brand, one link per view, theme toggle -- inside a panel that is inline on wide screens and a
      // popup behind a burger button at 860px and below (N-21; the CSS decides which).
      var burger = document.createElement("button");
      burger.type = "button";
      burger.className = "lh-host-burger";
      burger.setAttribute("aria-label", "메뉴");
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-controls", "lh-host-panel");
      burger.innerHTML = '<span aria-hidden="true">\u2630</span>';
      var panel = document.createElement("div");
      panel.className = "lh-host-panel";
      panel.id = "lh-host-panel";
      var scrim = document.createElement("div");
      scrim.className = "lh-host-scrim";
      scrim.hidden = true;
      nav.appendChild(burger);
      nav.appendChild(panel);
      nav.appendChild(scrim);
      function setOpen(open, refocus) {
        panel.classList.toggle("is-open", open);
        burger.setAttribute("aria-expanded", String(open));
        scrim.hidden = !open;
        if (!open && refocus) burger.focus();
      }
      burger.addEventListener("click", function () { setOpen(!panel.classList.contains("is-open"), false); });
      scrim.addEventListener("click", function () { setOpen(false, false); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && panel.classList.contains("is-open")) setOpen(false, panel.contains(document.activeElement));
      });
      nav.addEventListener("focusout", function (e) {
        if (panel.classList.contains("is-open") && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false, false);
      });
      if (window.matchMedia) {
        var wide = window.matchMedia("(min-width: 861px)");
        var onWide = function () { if (wide.matches) setOpen(false, false); };
        if (wide.addEventListener) wide.addEventListener("change", onWide); else if (wide.addListener) wide.addListener(onWide);
      }
      var brand = document.createElement("span");
      brand.className = "lh-host-brand";
      brand.textContent = cfg.title || "";
      panel.appendChild(brand);
      views.forEach(function (v) {
        var a = document.createElement("a");
        a.className = "lh-host-link";
        a.href = "#" + v.hash;
        a.textContent = v.label || v.hash;
        if (v.hash === view.hash) a.setAttribute("aria-current", "page");
        a.addEventListener("click", function () { setOpen(false, false); });
        panel.appendChild(a);
      });
      var theme = document.createElement("button");
      theme.type = "button";
      theme.className = "lh-host-theme";
      function isDark() {
        var t = document.documentElement.getAttribute("data-theme");
        if (t) return t === "dark";
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      }
      var themeIcon = document.createElement("span");
      themeIcon.setAttribute("aria-hidden", "true");
      var themeLabel = document.createElement("span");
      themeLabel.className = "lh-host-theme-label";
      theme.appendChild(themeIcon);
      theme.appendChild(themeLabel);
      function paintTheme() {
        themeIcon.textContent = isDark() ? "☀" : "☾";
        themeLabel.textContent = isDark() ? "라이트 모드" : "다크 모드";   // shown in the popup only
        theme.setAttribute("aria-label", isDark() ? "라이트 모드로 전환" : "다크 모드로 전환");
      }
      theme.addEventListener("click", function () {
        var next = isDark() ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        remember("lh:theme", next);
        paintTheme();
      });
      paintTheme();
      // The part's own tabs (N-21): the bundle publishes them as "lh:tabs"; on a narrow screen they live
      // in this popup (host.css hides the in-page bar), so they are reachable from anywhere on the page.
      var tabsBox = document.createElement("div");
      tabsBox.className = "lh-host-tabs";
      tabsBox.hidden = true;
      panel.appendChild(tabsBox);
      var where = document.createElement("div");
      where.className = "lh-host-where";
      where.setAttribute("aria-hidden", "true");
      document.body.insertBefore(where, document.body.firstChild);
      function paintTabs(state) {
        if (!state || !state.tabs || !state.tabs.length) return;
        document.documentElement.classList.add("lh-host-tabs-menu");
        tabsBox.hidden = false;
        tabsBox.innerHTML = "";
        var current = "";
        var flagged = false;
        state.tabs.forEach(function (t) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "lh-host-tab";
          if (t.on) { b.setAttribute("aria-current", "page"); current = t.label; }
          if (t.flagged) flagged = true;
          var name = document.createElement("span");
          name.textContent = t.label;
          b.appendChild(name);
          if (t.count) {
            var c = document.createElement("span");
            c.className = "lh-host-tab-count" + (t.flagged ? " lh-host-tab-count--due" : "");
            c.textContent = t.count;
            b.appendChild(c);
          }
          b.addEventListener("click", function () {
            setOpen(false, false);
            state.select(t.id);
            window.scrollTo(0, 0);
          });
          tabsBox.appendChild(b);
        });
        where.textContent = (view.label || view.hash) + (current ? " · " + current : "");
        burger.classList.toggle("lh-host-burger--due", flagged);
      }
      window.addEventListener("lh:tabs", function (e) { paintTabs(e.detail); });
      paintTabs(window.LH_TABS);
      panel.appendChild(theme);
      nav.hidden = false;
      window.addEventListener("hashchange", function () { window.location.reload(); });

      // Content files named by the view land in its data under their key; the key "*" merges the
      // file's top-level fields into data instead (e.g. an outline file holding areas + conceptOutline).
      var data = {};
      Object.keys(view.data || {}).forEach(function (k) { data[k] = view.data[k]; });
      var files = view.files || {};
      var keys = Object.keys(files);
      return Promise.all(keys.map(function (k) { return getContent("content/" + files[k]); })).then(function (loaded) {
        keys.forEach(function (k, i) {
          if (k === "*" && loaded[i] && typeof loaded[i] === "object") {
            Object.keys(loaded[i]).forEach(function (f) { data[f] = loaded[i][f]; });
          } else {
            data[k] = loaded[i];
          }
        });
        var base = local.serverUrl || "http://127.0.0.1:8765";
        var token = local.token || "";
        window.LH_CONFIG = {
          part: view.part,
          data: data,
          // The default model: the local config's, else app.json's (the gateway's config names none).
          ai: { baseUrl: base, token: token, model: local.model || cfg.model || undefined },
          state: { baseUrl: base, token: token, namespace: ns },
        };
        var s = document.createElement("script");
        s.type = "module";
        s.src = "kit/assets/index.js";
        document.body.appendChild(s);
      });
    })
    .catch(function (e) {
      fail("화면 설정을 불러오지 못했습니다: " + (e && e.message ? e.message : e));
    });
})();
