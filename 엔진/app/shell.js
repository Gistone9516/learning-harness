/**
 * shell.js — 공통셸 (Common Shell)
 * 플러그인계약 §5~7 그대로.
 * ────────────────────────────────────────────────────────────
 * 책임:
 *   - window.PLUGIN_REGISTRY  플러그인 등록소
 *   - hash 라우터             #<route>/<plugin_id>/<activity_id?>
 *                              route ∈ learn | dashboard | settings
 *                              (기존 quiz|dashboard|concept|settings 호환 별칭 포함)
 *   - 활성 플러그인 mount/unmount (plugin-host 컨테이너)
 *   - 진도버스                 activity-completed → savePluginProgress
 *   - 대시보드 통합            getDashboardContrib 합산
 *   - 키설정                  clf:keys:* localStorage
 *   - 사이드바 네비 빌드       MANIFEST[subject].areas / .decks
 *   - BYO-key UI 자동 생성    manifest.byok 선언 기반
 * ────────────────────────────────────────────────────────────
 * 부트 진입점: index.html이 [CDN → 생성물 → 플러그인 → shell.js] 로드 후
 *              window.SHELL.init({subject}) 호출.
 * ────────────────────────────────────────────────────────────
 * 불변:
 *   app.js / 엔진코어 수정 0
 *   DOM 훅 보존
 *   file:// 더블클릭 동작 (fetch 금지)
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     전역 레지스트리
  ───────────────────────────────────────────── */
  window.PLUGIN_REGISTRY = window.PLUGIN_REGISTRY || {};

  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 현재 활성 상태 */
  var _subject = 'comp1';
  var _activePluginId = null;
  var _activePluginInstance = null;

  /* ─────────────────────────────────────────────
     진도 버스 (§5)
  ───────────────────────────────────────────── */
  function savePluginProgress(pluginId, snapshot) {
    if (!snapshot) return;
    try {
      var key = 'clf:' + pluginId + ':shell-progress';
      localStorage.setItem(key, JSON.stringify(snapshot));
    } catch (e) {
      console.warn('[SHELL] savePluginProgress 실패', e);
    }
  }

  function loadPluginProgress(pluginId) {
    try {
      var key = 'clf:' + pluginId + ':shell-progress';
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* ─────────────────────────────────────────────
     PluginContext 팩토리 (§4 PluginContext)
  ───────────────────────────────────────────── */
  function _makeCtx(pluginId) {
    return {
      progressStore: loadPluginProgress(pluginId),
      emit: function (event) { _handlePluginEvent(pluginId, event); },
      settings: {
        subject: _subject,
        dDayMode: false
      },
      getKey: function (keyId) {
        try { return localStorage.getItem('clf:keys:' + keyId) || null; }
        catch (e) { return null; }
      },
      logger: {
        log: function () { var a = Array.prototype.slice.call(arguments); console.log.apply(console, ['[' + pluginId + ']'].concat(a)); },
        warn: function () { var a = Array.prototype.slice.call(arguments); console.warn.apply(console, ['[' + pluginId + ']'].concat(a)); },
        error: function () { var a = Array.prototype.slice.call(arguments); console.error.apply(console, ['[' + pluginId + ']'].concat(a)); }
      }
    };
  }

  /* ─────────────────────────────────────────────
     플러그인 이벤트 처리 (단방향 §4 PluginEvent)
  ───────────────────────────────────────────── */
  function _handlePluginEvent(pluginId, event) {
    if (!event || !event.type) return;

    if (event.type === 'activity-completed') {
      // 진도 스냅샷 저장
      var inst = window.PLUGIN_REGISTRY[pluginId];
      if (inst && inst.getProgressSnapshot) {
        var snap = inst.getProgressSnapshot();
        if (snap) savePluginProgress(pluginId, snap);
      }
    }

    if (event.type === 'session-done') {
      console.log('[SHELL] session-done from', pluginId);
    }

    if (event.type === 'navigation-request') {
      var target = event.target;
      // 딥링크 ref 수신 (concept 화면 딥링크용)
      if (event.conceptRef) _conceptTarget = event.conceptRef;
      // route 별칭 처리 (concept → concept 화면은 기존 셸이 처리)
      if (target) _setRoute(target);
    }
  }

  /* ─────────────────────────────────────────────
     플러그인 mount/unmount (§5)
  ───────────────────────────────────────────── */
  function _mountPlugin(pluginId) {
    if (_activePluginId === pluginId && _activePluginInstance) return;

    // 이전 플러그인 unmount
    if (_activePluginInstance && _activePluginInstance.unmount) {
      try { _activePluginInstance.unmount(); } catch (e) {}
    }
    _activePluginId = null;
    _activePluginInstance = null;

    var host = $('plugin-host');
    if (!host) {
      console.error('[SHELL] #plugin-host 없음');
      return;
    }

    var inst = window.PLUGIN_REGISTRY[pluginId];
    if (!inst) {
      host.innerHTML = '<div class="error-banner" style="margin:var(--space-6)">플러그인 [' + pluginId + '] 미등록</div>';
      return;
    }

    var ctx = _makeCtx(pluginId);
    var mountResult = inst.mount(host, ctx);
    _activePluginId = pluginId;
    _activePluginInstance = inst;

    // mount가 Promise 반환하는 경우 오류 처리
    if (mountResult && typeof mountResult.then === 'function') {
      mountResult.catch(function (e) {
        console.error('[SHELL] mount 실패', pluginId, e);
      });
    }
  }

  /* ─────────────────────────────────────────────
     대시보드 통합 (§5 getDashboardContrib 합산)
  ───────────────────────────────────────────── */
  function _renderDashboard() {
    // 등록된 모든 플러그인의 getDashboardContrib 합산
    var contribs = [];
    Object.keys(window.PLUGIN_REGISTRY).forEach(function (pid) {
      var inst = window.PLUGIN_REGISTRY[pid];
      if (inst && inst.getDashboardContrib) {
        try {
          var c = inst.getDashboardContrib();
          if (c) contribs.push(c);
        } catch (e) {}
      }
    });

    if (contribs.length === 0) {
      // card-quiz가 아직 마운트 안 된 경우 — APP 직접 집계 fallback
      _renderDashboardFallback();
      return;
    }

    // 첫 번째 contrib 기준 (현재 card-quiz 단일 플러그인)
    var merged = contribs[0];
    _renderDashboardData(merged);
  }

  function _renderDashboardFallback() {
    // 기존 index.html 인라인 방식과 동일: APP.getDashboardData 직접 호출
    // APP_STATE가 없으므로 card-quiz plugin을 통해 데이터 취득
    var inst = window.PLUGIN_REGISTRY['card-quiz'];
    if (inst && inst.getDashboardContrib) {
      try {
        var c = inst.getDashboardContrib();
        if (c) { _renderDashboardData(c); return; }
      } catch (e) {}
    }
    console.warn('[SHELL] 대시보드 데이터 없음');
  }

  function clamp01(x) { return Math.max(0, Math.min(1, typeof x === 'number' ? x : 0)); }
  function pct(x) { return Math.round(clamp01(x) * 100); }

  function areaLabel(area, sub) {
    var m = window.MANIFEST && window.MANIFEST[_subject];
    if (m && m.areas) {
      var hit = m.areas.filter(function (z) { return z.area === area && z.subarea === sub; })[0];
      if (hit) return hit.label;
    }
    return area + ' · ' + sub;
  }

  function _renderDashboardData(data) {
    if (!data) return;

    // 1. retrieval
    var rl = $('retrieval-list');
    if (rl) {
      rl.innerHTML = '';
      var byArea = data.by_area || [];
      if (!byArea.length) rl.innerHTML = '<p class="widget-empty">데이터 부족</p>';
      byArea.forEach(function (r) {
        var row = document.createElement('div'); row.className = 'area-row';
        if (r.retrieval_rate == null) {
          row.innerHTML = '<span class="area-row__label"><b>' + areaLabel(r.area, r.subarea) + '</b></span><span class="area-row__val" style="color:var(--ink3)">데이터 부족</span>';
        } else {
          row.innerHTML = '<span class="area-row__label"><b>' + areaLabel(r.area, r.subarea) + '</b></span>' +
            '<span class="area-gauge"><i style="width:' + pct(r.retrieval_rate) + '%"></i></span>' +
            '<span class="area-row__val">' + pct(r.retrieval_rate) + '%</span>';
        }
        rl.appendChild(row);
      });
    }

    // 2. weakness
    var wl = $('weakness-list');
    if (wl) {
      wl.innerHTML = '';
      var weakness = data.weakness || [];
      if (!weakness.length) wl.innerHTML = '<p class="widget-empty">아직 오답 데이터가 없습니다</p>';
      weakness.slice(0, 5).forEach(function (w) {
        var row = document.createElement('div'); row.className = 'area-row';
        row.innerHTML = '<span class="area-row__label"><b>' + w.unit + '</b><br><span style="font-size:var(--fs-xs);color:var(--ink3)">' + areaLabel(w.area, w.subarea) + '</span></span>' +
          '<span class="area-gauge hot"><i style="width:' + pct(w.wrong_rate) + '%"></i></span>' +
          '<span class="area-row__val" style="color:var(--hot)">' + pct(w.wrong_rate) + '%</span>';
        wl.appendChild(row);
      });
    }

    // 3. pass-path
    var pl = $('pass-path-list');
    if (pl) {
      pl.innerHTML = '';
      var passpath = data.pass_path || [];
      if (!passpath.length) pl.innerHTML = '<p class="widget-empty">데이터 부족</p>';
      passpath.forEach(function (p) {
        var row = document.createElement('div'); row.className = 'area-row';
        var gaugeCls = p.status === 'danger' ? 'area-gauge hot' : p.status === 'watch' ? 'area-gauge warn' : 'area-gauge';
        row.innerHTML = '<span class="area-row__label"><b>' + areaLabel(p.area, p.subarea) + '</b> <span style="font-size:var(--fs-xs);color:var(--ink3)">목표 ' + p.target + '</span></span>' +
          '<span class="' + gaugeCls + '"><i style="width:' + pct(p.progress) + '%"></i></span>' +
          '<span class="status-chip ' + p.status + '">' + p.status + '</span>';
        pl.appendChild(row);
      });
    }

    // 4. completion
    var cl = $('completion-list');
    if (cl) {
      cl.innerHTML = '';
      var completion = data.completion || [];
      if (!completion.length) cl.innerHTML = '<p class="widget-empty">데이터 부족</p>';
      completion.forEach(function (c) {
        var bd = c.box_dist || { box1: 0, box2: 0, box3: 0 };
        var tot = (bd.box1 || 0) + (bd.box2 || 0) + (bd.box3 || 0);
        var w1 = tot ? bd.box1 / tot * 100 : 0, w2 = tot ? bd.box2 / tot * 100 : 0, w3 = tot ? bd.box3 / tot * 100 : 0;
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="completion-row__head"><span class="lbl">' + areaLabel(c.area, c.subarea) + '</span><span class="val">정복 ' + pct(c.mastery_rate) + '%</span></div>' +
          '<div class="stack-bar"><span class="box1" style="width:' + w1 + '%"></span><span class="box2" style="width:' + w2 + '%"></span><span class="box3" style="width:' + w3 + '%"></span></div>';
        cl.appendChild(wrap);
      });

      // 사이드바 전체 진도
      if (completion.length) {
        var avg = completion.reduce(function (s, c) { return s + clamp01(c.mastery_rate); }, 0) / completion.length;
        var ovBar = $('ov-bar'); var ovPct = $('ov-pct');
        if (ovBar) ovBar.style.width = pct(avg) + '%';
        if (ovPct) ovPct.textContent = pct(avg) + '%';
      }
    }
  }

  /* ─────────────────────────────────────────────
     개념서 렌더 (기존 index.html 인라인 로직 이전)
  ───────────────────────────────────────────── */
  var _conceptCardData = null;  // plugin에서 받아온 deck.cards

  function _renderConcept() {
    var body = $('concept-body');
    if (!body) return;

    // card-quiz 플러그인에서 deck.cards 가져오기
    var inst = window.PLUGIN_REGISTRY['card-quiz'];
    var cards = null;
    if (inst && inst._getDeckCards) {
      cards = inst._getDeckCards();
    }
    // fallback: plugin.js가 _state를 직접 노출하지 않으므로
    // 전역 DECKS에서 첫 deck 사용
    if (!cards) {
      var manifest = window.MANIFEST && window.MANIFEST[_subject];
      var deckIds = (manifest && manifest.decks) || [];
      var d0 = deckIds[0];
      var deckId = (typeof d0 === 'string') ? d0 : (d0 && d0.deck_id);
      if (deckId && window.DECKS && window.DECKS[deckId]) {
        cards = window.DECKS[deckId].cards;
      }
    }

    if (!cards || !cards.length) {
      body.innerHTML = '<p class="text-muted">개념서 미연결 — 표시할 내용이 없습니다.</p>';
      return;
    }

    body.innerHTML = '';
    var TYPE_LABEL_LOCAL = { func: '함수', proc: '절차', recall_seq: '순서', cloze: '빈칸', judge: '판단' };

    function levelOf(card) {
      var w = (card.tags && typeof card.tags.weight === 'number') ? card.tags.weight : 5;
      return w >= 8 ? 3 : w >= 5 ? 2 : 1;
    }
    function frontText(card) {
      var f = card.front || {};
      if (card.type === 'cloze') return '';
      return f.prompt || f.scenario || f.text || (Array.isArray(f.options) ? f.options.join(' / ') : '') || '(문항)';
    }
    function renderMarkdownLocal(el, mdText) {
      if (!mdText) { el.innerHTML = ''; return; }
      var html;
      try { html = (window.marked ? window.marked.parse(mdText) : mdText.replace(/</g, '&lt;')); }
      catch (e) { html = mdText.replace(/</g, '&lt;'); }
      el.innerHTML = html;
      var tableWraps = Array.prototype.slice.call(el.querySelectorAll('table'));
      tableWraps.forEach(function (t) {
        if (t.parentElement && t.parentElement.classList.contains('table-wrap')) return;
        var w = document.createElement('div'); w.className = 'table-wrap';
        t.parentNode.insertBefore(w, t); w.appendChild(t);
      });
      try {
        if (window.renderMathInElement) window.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }
          ], throwOnError: false
        });
      } catch (e) {}
    }

    cards.filter(function (c) { return c.enabled !== false; }).forEach(function (card) {
      var lv = levelOf(card);
      var sec = document.createElement('div'); sec.className = 'section-card';
      sec.id = 'concept-' + card.card_id;
      var freqCls = 'l' + lv, stars = lv === 3 ? '★★★' : lv === 2 ? '★★' : '★';
      var refId = (card.links && card.links.concept_ref) || card.card_id;
      var title = frontText(card) || card.card_id;
      var head = document.createElement('div'); head.className = 'sec-head';
      head.innerHTML = '<span class="sec-id">' + refId + '</span>' +
        '<span class="sec-title">' + title + '</span>' +
        '<span class="freq ' + freqCls + '"><span class="s">' + stars + '</span></span>' +
        '<svg class="sec-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>';
      head.addEventListener('click', function () { sec.classList.toggle('open'); });
      var bodyEl = document.createElement('div'); bodyEl.className = 'sec-body';
      var prose = document.createElement('div'); prose.className = 'prose';
      renderMarkdownLocal(prose, (card.back && card.back.detail) || '(상세 없음)');
      bodyEl.appendChild(prose);
      sec.appendChild(head); sec.appendChild(bodyEl);
      body.appendChild(sec);
    });

    // 딥링크 타깃 열기
    if (_conceptTarget) {
      var match = cards.filter(function (c) { return c.links && c.links.concept_ref === _conceptTarget; })[0];
      var open = match ? $('concept-' + match.card_id) : null;
      if (open) { open.classList.add('open'); open.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      _conceptTarget = null;
    }
  }

  var _conceptTarget = null;

  /* ─────────────────────────────────────────────
     hash 라우터 (§5, file:// 호환)
     #<route>/<plugin_id>/<activity_id?>
     route ∈ learn | dashboard | settings
     별칭: quiz→learn, concept→concept
  ───────────────────────────────────────────── */
  var ROUTES_SCREEN = ['learn', 'dashboard', 'settings', 'concept'];
  var ROUTE_ALIAS = { quiz: 'learn' };  // 기존 data-route-trigger="quiz" 호환

  function _parseHash() {
    var hash = window.location.hash.replace(/^#/, '') || '';
    var parts = hash.split('/');
    return {
      route: parts[0] || 'learn',
      pluginId: parts[1] || null,
      activityId: parts[2] || null
    };
  }

  function _setRoute(route, pluginId, activityId) {
    // 별칭 해소
    route = ROUTE_ALIAS[route] || route;
    if (ROUTES_SCREEN.indexOf(route) === -1) {
      console.warn('[SHELL] 알 수 없는 route:', route); route = 'learn';
    }

    var hash = '#' + route;
    if (pluginId) hash += '/' + pluginId;
    if (activityId) hash += '/' + activityId;
    window.location.hash = hash;
    // hashchange 이벤트가 _onHashChange를 트리거 → 실제 전환
  }

  function _applyRoute(parsed) {
    var route = ROUTE_ALIAS[parsed.route] || parsed.route;
    if (ROUTES_SCREEN.indexOf(route) === -1) route = 'learn';

    // data-route 속성 (기존 CSS 훅 보존)
    document.body.setAttribute('data-route', route === 'learn' ? 'quiz' : route);

    // data-screen 전환 (기존 CSS hidden 방식 재사용)
    // 셸이 직접 관리하는 섹션들
    qsa('[data-screen]').forEach(function (sec) {
      var screenId = sec.getAttribute('data-screen');
      // learn → quiz 화면(plugin-host), dashboard, settings, concept
      var active = false;
      if (route === 'learn' && screenId === 'quiz') active = true;
      else if (route === 'dashboard' && screenId === 'dashboard') active = true;
      else if (route === 'settings' && screenId === 'settings') active = true;
      else if (route === 'concept' && screenId === 'concept') active = true;
      if (active) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', '');
    });

    // 네비 버튼 active 상태
    qsa('[data-route-trigger]').forEach(function (b) {
      var trigger = b.getAttribute('data-route-trigger');
      var triggerResolved = ROUTE_ALIAS[trigger] || trigger;
      b.classList.toggle('active', triggerResolved === route);
    });

    // route별 처리
    if (route === 'learn') {
      var targetPlugin = parsed.pluginId || _getDefaultPluginId();
      if (targetPlugin) _mountPlugin(targetPlugin);
    } else if (route === 'dashboard') {
      _renderDashboard();
    } else if (route === 'concept') {
      _renderConcept();
    } else if (route === 'settings') {
      _renderSettings();
    }

    window.scrollTo(0, 0);
  }

  function _getDefaultPluginId() {
    var manifest = window.MANIFEST && window.MANIFEST[_subject];
    var plugins = manifest && manifest.plugins;
    if (plugins && plugins.length) return plugins[0].plugin_id;
    return 'card-quiz'; // 최후 fallback
  }

  function _onHashChange() {
    var parsed = _parseHash();
    _applyRoute(parsed);
  }
  window.addEventListener('hashchange', _onHashChange);

  /* ─────────────────────────────────────────────
     사이드바 네비 빌드 (§5, 데이터구동)
  ───────────────────────────────────────────── */
  function _buildNav(manifest) {
    var nav = $('nav'); if (!nav) return;
    nav.innerHTML = '';
    var areas = (manifest && manifest.areas) || [];
    var decks = (manifest && manifest.decks) || [];
    areas.forEach(function (a, i) {
      var areaDecks = decks.filter(function (d) { return d.area === a.area && d.subarea === a.subarea; });
      if (areaDecks.length === 0) return;
      var grp = document.createElement('div'); grp.className = 'nav-group' + (i === 0 ? ' open' : '');
      var head = document.createElement('button'); head.className = 'nav-grp-head'; head.type = 'button';
      head.innerHTML = '<span class="grp-no">' + (i + 1) + '</span>' +
        '<span class="grp-name">' + (a.label || a.subarea) + '</span>' +
        '<span class="grp-pct">' + areaDecks.length + '덱</span>' +
        '<svg class="grp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>';
      head.addEventListener('click', function () { grp.classList.toggle('open'); });
      var items = document.createElement('div'); items.className = 'nav-items';
      areaDecks.forEach(function (d) {
        var link = document.createElement('a'); link.className = 'nav-link'; link.href = '#';
        link.innerHTML = '<span class="nl-id">' + (d.card_count || '') + '</span><span>' + (d.title || d.deck_id) + '</span>';
        link.addEventListener('click', function (e) {
          e.preventDefault();
          qsa('.nav-link').forEach(function (l) { l.classList.remove('active'); });
          link.classList.add('active');
          // 사이드바 닫기 (모바일)
          var sidebar = $('sidebar'); var scrim = $('scrim');
          if (sidebar) sidebar.classList.remove('open');
          if (scrim) scrim.classList.remove('show');
          _setRoute('concept');
        });
        items.appendChild(link);
      });
      grp.appendChild(head); grp.appendChild(items); nav.appendChild(grp);
    });

    // plugin 탭 (§5 네비, plugin_id별 탭)
    var plugins = (manifest && manifest.plugins) || [];
    if (plugins.length > 1) {
      var pluginSection = document.createElement('div'); pluginSection.className = 'nav-group open';
      var pluginHead = document.createElement('div'); pluginHead.className = 'nav-grp-head';
      pluginHead.innerHTML = '<span class="grp-name" style="font-size:var(--fs-xs);color:var(--ink3)">실습환경</span>';
      var pluginItems = document.createElement('div'); pluginItems.className = 'nav-items';
      pluginSection.style.display = 'block';
      plugins.forEach(function (p) {
        var link = document.createElement('a'); link.className = 'nav-link'; link.href = '#learn/' + p.plugin_id;
        link.textContent = p.label || p.plugin_id;
        pluginItems.appendChild(link);
      });
      pluginSection.appendChild(pluginHead); pluginSection.appendChild(pluginItems);
      nav.insertBefore(pluginSection, nav.firstChild);
    }
  }

  /* ─────────────────────────────────────────────
     브랜드/히어로 메타
  ───────────────────────────────────────────── */
  function _applyMeta(manifest) {
    if (!manifest) return;
    if (manifest.subject_label) {
      var bn = $('brand-name'); if (bn) bn.textContent = manifest.subject_label;
      var bg = $('brand-glyph'); if (bg) bg.textContent = manifest.subject_label.charAt(0);
      var ah = document.querySelector('.app-header__logo');
      if (ah) ah.textContent = manifest.subject_label;
      // title 업데이트
      document.title = '학습 프레임워크 · ' + manifest.subject_label;
    }
  }

  /* ─────────────────────────────────────────────
     설정 화면 렌더 (§6 BYO-key + 기존 export)
  ───────────────────────────────────────────── */
  function _renderSettings() {
    var manifest = window.MANIFEST && window.MANIFEST[_subject];
    var plugins = (manifest && manifest.plugins) || [];

    // BYO-key 섹션 자동 생성
    var settingsWrap = document.querySelector('.settings-wrap');
    if (!settingsWrap) return;

    // 기존 byok 섹션 제거 후 재생성
    qsa('[data-byok-section]', settingsWrap).forEach(function (el) { el.remove(); });

    plugins.forEach(function (pManifest) {
      if (!pManifest.byok || !Array.isArray(pManifest.byok.keys) || !pManifest.byok.keys.length) return;
      var section = document.createElement('div');
      section.className = 'settings-section';
      section.setAttribute('data-byok-section', pManifest.plugin_id);
      section.innerHTML = '<h2 class="settings-section__title">' + (pManifest.label || pManifest.plugin_id) + ' API 키</h2>';

      pManifest.byok.keys.forEach(function (keyDef) {
        var label = document.createElement('label');
        label.style.cssText = 'display:block;margin-bottom:var(--space-4)';
        label.innerHTML = '<span class="text-muted" style="display:block;margin-bottom:4px">' + keyDef.label + '</span>';
        var input = document.createElement('input');
        input.type = 'password';
        input.style.cssText = 'width:100%;font-size:var(--fs-md);padding:9px 12px;border:1px solid var(--line2);border-radius:var(--r);background:var(--surface);color:var(--ink)';
        input.placeholder = keyDef.help || '키를 입력하세요';
        // 기존 저장값 로드
        var saved = '';
        try { saved = localStorage.getItem('clf:keys:' + keyDef.id) || ''; } catch (e) {}
        input.value = saved;
        input.addEventListener('change', function () {
          try { localStorage.setItem('clf:keys:' + keyDef.id, input.value); } catch (e) {}
        });
        label.appendChild(input);
        section.appendChild(label);
      });

      // 첫 번째 settings-section 앞에 삽입
      var firstSection = settingsWrap.querySelector('.settings-section');
      if (firstSection) settingsWrap.insertBefore(section, firstSection);
      else settingsWrap.appendChild(section);
    });
  }

  /* ─────────────────────────────────────────────
     읽기 진행바
  ───────────────────────────────────────────── */
  window.addEventListener('scroll', function () {
    if (document.body.getAttribute('data-route') !== 'concept') return;
    var h = document.documentElement;
    var sc = h.scrollTop / ((h.scrollHeight - h.clientHeight) || 1);
    var rb = $('read-bar');
    if (rb) rb.style.width = Math.max(0, Math.min(1, sc)) * 100 + '%';
  });

  /* ─────────────────────────────────────────────
     검색 + 필터칩 (개념서)
  ───────────────────────────────────────────── */
  var _activeLv = 'all', _searchQ = '';
  function _applyConceptFilter() {
    var conceptBody = $('concept-body');
    if (!conceptBody) return;
    qsa('.section-card', conceptBody).forEach(function (sec) {
      // levelOf 재계산: sec.id = 'concept-' + card_id
      var dataLvEl = sec.querySelector('[data-level]');
      var lv = dataLvEl ? dataLvEl.getAttribute('data-level') : 'all';
      var lvOk = _activeLv === 'all' || lv === _activeLv;
      var txt = sec.textContent.toLowerCase();
      var qOk = !_searchQ || txt.indexOf(_searchQ) !== -1;
      sec.style.display = (lvOk && qOk) ? '' : 'none';
    });
  }

  /* ─────────────────────────────────────────────
     인라인 이벤트 바인딩 (셸 소유 UI)
  ───────────────────────────────────────────── */
  function _bindShellEvents() {
    // 사이드바 드로어 (모바일)
    var sidebar = $('sidebar'), scrim = $('scrim');
    function closeDrawer() {
      if (sidebar) sidebar.classList.remove('open');
      if (scrim) scrim.classList.remove('show');
    }
    var menuBtn = $('menu-btn');
    if (menuBtn) menuBtn.addEventListener('click', function () {
      if (sidebar) sidebar.classList.toggle('open');
      if (scrim) scrim.classList.toggle('show');
    });
    if (scrim) scrim.addEventListener('click', closeDrawer);

    // route 전환 버튼 (data-route-trigger)
    qsa('[data-route-trigger]').forEach(function (b) {
      b.addEventListener('click', function () {
        _setRoute(b.getAttribute('data-route-trigger'));
      });
    });

    // concept 뒤로 버튼
    var backBtn = document.querySelector('[data-concept="back-to-quiz"]');
    if (backBtn) backBtn.addEventListener('click', function () { _setRoute('learn'); });

    // 검색 + 필터칩
    qsa('#freq-chips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        qsa('#freq-chips .chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        _activeLv = chip.getAttribute('data-lv');
        if (document.body.getAttribute('data-route') === 'concept') _applyConceptFilter();
      });
    });
    var searchEl = $('search');
    if (searchEl) searchEl.addEventListener('input', function (e) {
      _searchQ = e.target.value.toLowerCase().trim();
      if (document.body.getAttribute('data-route') !== 'concept') _setRoute('concept');
      _applyConceptFilter();
    });

    // settings export
    var exportBtn = document.querySelector('[data-settings="export"]');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      try {
        // card-quiz plugin에서 progressStore 가져오기
        var inst = window.PLUGIN_REGISTRY['card-quiz'];
        var snap = inst && inst.getProgressSnapshot ? inst.getProgressSnapshot() : {};
        var json = JSON.stringify(snap || {}, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url;
        a.download = 'clf-progress-' + _subject + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        var exportResult = $('export-result');
        if (exportResult) exportResult.textContent = '내보내기 완료.';
      } catch (e) {
        var exportResult2 = $('export-result');
        if (exportResult2) exportResult2.textContent = '내보내기 실패: ' + e.message;
      }
    });

    // 뷰포트 모드
    function detectViewport() {
      var w = window.innerWidth;
      document.body.setAttribute('data-viewport-mode', w < 600 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');
    }
    detectViewport();
    window.addEventListener('resize', detectViewport);
  }

  /* ─────────────────────────────────────────────
     플러그인 등록 (MANIFEST.plugins 순회)
  ───────────────────────────────────────────── */
  function _registerPlugins(manifest) {
    var plugins = (manifest && manifest.plugins) || [];
    plugins.forEach(function (pManifest) {
      var pid = pManifest.plugin_id;
      // 플러그인 파일이 전역에 등록해 둔 인스턴스를 PLUGIN_REGISTRY에 넣음
      // 명명 규칙: window._<camelCase(plugin_id)>_PLUGIN
      // card-quiz → window._CARD_QUIZ_PLUGIN
      var globalKey = '_' + pid.replace(/-([a-z])/g, function (_, c) { return '_' + c.toUpperCase(); }).toUpperCase() + '_PLUGIN';
      var inst = window[globalKey];
      if (!inst) {
        // fallback: window._CARD_QUIZ_PLUGIN 등 직접 체크
        var directKey = '_' + pid.replace(/-/g, '_').toUpperCase() + '_PLUGIN';
        inst = window[directKey];
      }
      if (inst) {
        window.PLUGIN_REGISTRY[pid] = inst;
      } else {
        console.warn('[SHELL] 플러그인 인스턴스를 찾을 수 없음:', pid, '(window.' + globalKey + ' 또는 window._' + pid.replace(/-/g, '_').toUpperCase() + '_PLUGIN)');
      }
    });
  }

  /* ─────────────────────────────────────────────
     infra 분기 (§8 static/backend/hybrid)
  ───────────────────────────────────────────── */
  function _checkInfra(pManifest, onReady, onFallback) {
    if (!pManifest || pManifest.infra === 'static') {
      onReady();
      return;
    }
    // backend / hybrid: entry_url /health 3s 타임아웃
    var entryUrl = pManifest.entry_url;
    if (!entryUrl) { onFallback('entry_url 미설정'); return; }
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true; onFallback('헬스체크 타임아웃');
    }, 3000);
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', entryUrl + '/health', true);
      xhr.onload = function () {
        if (timedOut) return; clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) onReady();
        else onFallback('health 응답 오류: ' + xhr.status);
      };
      xhr.onerror = function () {
        if (timedOut) return; clearTimeout(timer); onFallback('네트워크 오류');
      };
      xhr.send();
    } catch (e) {
      clearTimeout(timer); onFallback(e.message);
    }
  }

  /* ─────────────────────────────────────────────
     window.SHELL.init({subject}) — 부트 진입점
  ───────────────────────────────────────────── */
  function init(opts) {
    opts = opts || {};
    _subject = opts.subject || 'comp1';

    var manifest = (window.MANIFEST && window.MANIFEST[_subject]) || null;

    // 메타 / 네비 적용
    _applyMeta(manifest);
    _buildNav(manifest);

    // 플러그인 등록
    _registerPlugins(manifest);

    // 셸 이벤트 바인딩
    _bindShellEvents();

    // 초기 라우트 복원
    var parsed = _parseHash();
    // hash 없으면 기본 learn 라우트
    if (!parsed.route || parsed.route === '') {
      parsed.route = 'learn';
    }
    _applyRoute(parsed);
  }

  /* ─────────────────────────────────────────────
     공개 인터페이스
  ───────────────────────────────────────────── */
  window.SHELL = {
    init: init,
    setRoute: _setRoute,
    mountPlugin: _mountPlugin,
    getDashboard: _renderDashboard,
    savePluginProgress: savePluginProgress,
    loadPluginProgress: loadPluginProgress,
    PLUGIN_REGISTRY: window.PLUGIN_REGISTRY
  };

})();
