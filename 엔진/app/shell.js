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
  var _activeMountOk = false;  // mount 성공 여부 추적
  var _mountSeq = 0;           // XHR 경쟁 방지용 마운트 시퀀스 번호

  /* ─────────────────────────────────────────────
     알림 배너 컨테이너 (app-level, plugin-host 외부)
  ───────────────────────────────────────────── */
  function _getOrCreateNotifArea() {
    var area = $('app-notif-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'app-notif-area';
      area.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;pointer-events:none';
      document.body.appendChild(area);
    }
    return area;
  }

  /* ─────────────────────────────────────────────
     진도 버스 (§5)
     키: clf:<plugin_id>:progress  ← 플러그인계약 §5 준수
  ───────────────────────────────────────────── */
  function savePluginProgress(pluginId, snapshot) {
    if (!snapshot) return;
    try {
      var key = 'clf:' + pluginId + ':progress';
      localStorage.setItem(key, JSON.stringify(snapshot));
    } catch (e) {
      var isQuota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || (e.code && e.code === 22));
      if (isQuota) {
        _showQuotaBanner(pluginId);
      }
      console.warn('[SHELL] savePluginProgress 실패', e);
    }
  }

  function _showQuotaBanner(pluginId) {
    var errArea = $('settings-error-area'), errMsg = $('settings-error-msg');
    if (errArea) {
      errArea.removeAttribute('hidden');
      if (errMsg) errMsg.textContent = ' [' + pluginId + '] 저장소가 꽉 찼습니다. 설정 화면에서 진도를 내보내기(백업) 후 일부를 삭제하세요.';
    }
    // app-level 알림 영역에 표시 (plugin-host 덮어쓰기에 영향 없음)
    var area = _getOrCreateNotifArea();
    if (!$('quota-warn')) {
      var w = document.createElement('div');
      w.id = 'quota-warn';
      w.style.cssText = 'padding:8px 12px;background:#fef3cd;border-bottom:1px solid #f0ad4e;font-size:13px;pointer-events:auto';
      var msg = document.createTextNode('저장소 용량 초과 — ');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'text-decoration:underline;background:none;border:none;cursor:pointer;font-size:13px';
      btn.textContent = '설정 화면';
      btn.addEventListener('click', function () { _setRoute('settings'); });
      var msg2 = document.createTextNode('에서 진도를 내보내기하세요.');
      w.appendChild(msg); w.appendChild(btn); w.appendChild(msg2);
      area.appendChild(w);
    }
  }

  function _clearQuotaBanner() {
    var w = $('quota-warn');
    if (w) w.remove();
  }

  function loadPluginProgress(pluginId) {
    try {
      var key = 'clf:' + pluginId + ':progress';
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* ─────────────────────────────────────────────
     D-day 모드 설정 (localStorage)
  ───────────────────────────────────────────── */
  function _getDDayMode() {
    try { return localStorage.getItem('clf:settings:dday') === 'true'; }
    catch (e) { return false; }
  }
  function _setDDayMode(val) {
    try { localStorage.setItem('clf:settings:dday', val ? 'true' : 'false'); }
    catch (e) {}
  }

  /* ─────────────────────────────────────────────
     PluginContext 팩토리 (§4 PluginContext)
     logger는 계약 외 추가 — 제거하고 플러그인이 직접 console 사용
  ───────────────────────────────────────────── */
  function _makeCtx(pluginId) {
    return {
      progressStore: loadPluginProgress(pluginId),
      emit: function (event) { _handlePluginEvent(pluginId, event); },
      settings: {
        subject: _subject,
        dDayMode: _getDDayMode()
      },
      getKey: function (keyId) {
        try { return localStorage.getItem('clf:keys:' + keyId) || null; }
        catch (e) { return null; }
      }
    };
  }

  /* ─────────────────────────────────────────────
     플러그인 이벤트 처리 (단방향 §4 PluginEvent)
  ───────────────────────────────────────────── */
  function _handlePluginEvent(pluginId, event) {
    if (!event || !event.type) return;

    if (event.type === 'activity-completed') {
      var inst = window.PLUGIN_REGISTRY[pluginId];
      if (inst && inst.getProgressSnapshot) {
        var snap = inst.getProgressSnapshot();
        if (snap) savePluginProgress(pluginId, snap);
      }
    }

    if (event.type === 'session-done') {
      console.log('[SHELL] session-done from', pluginId);
      _renderSessionSummary(pluginId, event);
    }

    if (event.type === 'navigation-request') {
      var target = event.target;
      if (event.conceptRef) _conceptTarget = event.conceptRef;
      if (target) _setRoute(target);
    }
  }

  /* ─────────────────────────────────────────────
     세션 완료 요약 (session-done 소비)
     오답 목록: card_id 대신 front.prompt/text 표시
  ───────────────────────────────────────────── */
  function _renderSessionSummary(pluginId, event) {
    var host = $('plugin-host');
    if (!host) return;

    // BUG-1: session-done 페이로드(total/correct/wrong) 우선 사용.
    // snap 누적 순회는 event 필드가 없을 때만 fallback.
    var total = 0, correct = 0;
    var wrongItems = [];

    if (event && event.total != null && event.correct != null && Array.isArray(event.wrong)) {
      // event payload 완비 — 직접 사용
      total = event.total;
      correct = event.correct;
      wrongItems = event.wrong;
    } else {
      // fallback: getProgressSnapshot 누적 순회 (event 미완비 시)
      var inst2 = window.PLUGIN_REGISTRY[pluginId];
      var snap = (inst2 && inst2.getProgressSnapshot) ? inst2.getProgressSnapshot() : null;
      if (snap && snap.activities) {
        Object.keys(snap.activities).forEach(function (aid) {
          var ap = snap.activities[aid];
          total++;
          if (ap.last_verdict === 'correct') correct++;
          else if (ap.last_verdict === 'incorrect') wrongItems.push(aid);
        });
      }
      // event 부분 override (있는 필드만)
      if (event && event.total != null) total = event.total;
      if (event && event.correct != null) correct = event.correct;
      if (event && Array.isArray(event.wrong)) wrongItems = event.wrong;
    }

    var pct = total > 0 ? Math.round(correct / total * 100) : 0;

    // card_id → front 텍스트 매핑 (window.DECKS 통해)
    function _frontText(cardId) {
      if (!window.DECKS) return cardId;
      var keys = Object.keys(window.DECKS);
      for (var di = 0; di < keys.length; di++) {
        var deck = window.DECKS[keys[di]];
        if (!deck || !deck.cards) continue;
        for (var ci = 0; ci < deck.cards.length; ci++) {
          var c = deck.cards[ci];
          if (c.card_id === cardId) {
            var f = c.front || {};
            return f.prompt || f.scenario || f.text || cardId;
          }
        }
      }
      return cardId;
    }

    var div = document.createElement('div');
    div.id = 'session-summary';
    div.style.cssText = 'padding:24px;max-width:480px;margin:24px auto;background:var(--surface,#fff);border:1px solid var(--line2,#e2e2e2);border-radius:8px;text-align:center';

    var title = document.createElement('div');
    title.style.cssText = 'font-size:22px;font-weight:600;margin-bottom:8px';
    title.textContent = '세션 완료';

    var stats = document.createElement('div');
    stats.style.cssText = 'font-size:15px;color:var(--ink3,#666)';
    stats.textContent = '총 ' + total + '문제 · 정답 ' + correct + '개 · 정답률 ' + pct + '%';

    div.appendChild(title);
    div.appendChild(stats);

    if (wrongItems.length) {
      var wrongWrap = document.createElement('div');
      wrongWrap.style.cssText = 'text-align:left;margin-top:12px';
      var wrongTitle = document.createElement('b');
      wrongTitle.style.fontSize = '13px';
      wrongTitle.textContent = '오답 목록';
      var ul = document.createElement('ul');
      ul.style.cssText = 'margin:4px 0 0 16px;font-size:13px';
      wrongItems.forEach(function (id) {
        var li = document.createElement('li');
        li.textContent = _frontText(id);
        ul.appendChild(li);
      });
      wrongWrap.appendChild(wrongTitle);
      wrongWrap.appendChild(ul);
      div.appendChild(wrongWrap);
    }

    var btnRow = document.createElement('div');
    btnRow.style.marginTop = '16px';

    var btnContinue = document.createElement('button');
    btnContinue.type = 'button';
    btnContinue.style.cssText = 'padding:8px 20px;border:1px solid var(--line2,#ccc);border-radius:4px;background:none;cursor:pointer;margin-right:8px';
    btnContinue.textContent = '계속 학습';
    btnContinue.addEventListener('click', function () {
      var el = $('session-summary'); if (el) el.remove();
      _setRoute('learn');
    });

    var btnDash = document.createElement('button');
    btnDash.type = 'button';
    btnDash.style.cssText = 'padding:8px 20px;border:1px solid var(--line2,#ccc);border-radius:4px;background:none;cursor:pointer;margin-right:8px';
    btnDash.textContent = '대시보드';
    btnDash.addEventListener('click', function () {
      var el = $('session-summary'); if (el) el.remove();
      _setRoute('dashboard');
    });

    btnRow.appendChild(btnContinue);
    btnRow.appendChild(btnDash);

    // 오답 재연습 버튼 (wrongItems가 있을 때)
    if (wrongItems.length) {
      var btnRetry = document.createElement('button');
      btnRetry.type = 'button';
      btnRetry.style.cssText = 'padding:8px 20px;border:1px solid var(--line2,#ccc);border-radius:4px;background:none;cursor:pointer';
      btnRetry.textContent = '오답만 다시 풀기';
      btnRetry.setAttribute('data-wrong-retry', JSON.stringify(wrongItems));
      btnRetry.addEventListener('click', function () {
        var el = $('session-summary'); if (el) el.remove();
        // 재세션 요청 — 플러그인에 wrong card_id 목록 전달
        var targetPid = _activePluginId || _getDefaultPluginId();
        var targetInst = window.PLUGIN_REGISTRY[targetPid];
        if (targetInst && typeof targetInst.startRetrySession === 'function') {
          targetInst.startRetrySession(wrongItems);
          _setRoute('learn');
        } else {
          console.warn('[SHELL] startRetrySession 미지원 — 오답 재연습 불가', targetPid);
          var el2 = document.createElement('p');
          el2.style.cssText = 'margin-top:8px;font-size:13px;color:var(--hot,#c0392b)';
          el2.textContent = '이 플러그인은 오답 재연습을 지원하지 않습니다.';
          btnRow.appendChild(el2);
          return;
        }
      });
      btnRow.appendChild(btnRetry);
    }

    div.appendChild(btnRow);

    var old = $('session-summary');
    if (old) old.remove();
    host.insertBefore(div, host.firstChild);
  }

  /* ─────────────────────────────────────────────
     플러그인 mount/unmount (§5, §8)
     - 동기 throw 처리
     - mount 실패 시 상태 리셋
     - infra !== static → _checkInfra 선행
  ───────────────────────────────────────────── */
  function _mountPlugin(pluginId) {
    // 이미 성공적으로 마운트된 경우만 skip
    if (_activePluginId === pluginId && _activePluginInstance && _activeMountOk) return;

    // XHR 경쟁 방지: 이 마운트 요청의 시퀀스 번호를 확보
    var seq = ++_mountSeq;

    if (_activePluginInstance && _activePluginInstance.unmount) {
      try { _activePluginInstance.unmount(); } catch (e) {}
    }
    _activePluginId = null;
    _activePluginInstance = null;
    _activeMountOk = false;

    var host = $('plugin-host');
    if (!host) {
      console.error('[SHELL] #plugin-host 없음');
      return;
    }

    var inst = window.PLUGIN_REGISTRY[pluginId];
    if (!inst) {
      host.innerHTML = '<div class="error-banner" style="margin:var(--space-6)">플러그인 [' + _esc(pluginId) + '] 미등록</div>';
      return;
    }

    // infra 분기: backend/hybrid이면 헬스체크 먼저
    var manifest = window.MANIFEST && window.MANIFEST[_subject];
    var pManifest = null;
    if (manifest && Array.isArray(manifest.plugins)) {
      for (var i = 0; i < manifest.plugins.length; i++) {
        if (manifest.plugins[i].plugin_id === pluginId) { pManifest = manifest.plugins[i]; break; }
      }
    }
    if (!pManifest) {
      // MANIFEST_* 전역에서 탐색
      var keys = Object.keys(window);
      for (var ki = 0; ki < keys.length; ki++) {
        var k = keys[ki];
        if (/^MANIFEST_[A-Z]/.test(k) && window[k] && window[k].plugin_id === pluginId) {
          pManifest = window[k]; break;
        }
      }
    }

    var infra = pManifest ? (pManifest.infra || 'static') : 'static';
    if (infra !== 'static') {
      // 헬스체크 후 마운트 (seq 캡처: onReady 호출 시점에 더 새로운 마운트가 시작됐으면 중단)
      _checkInfra(pManifest, function () {
        if (seq !== _mountSeq) return; // 경쟁 감지 — 이미 다른 플러그인 마운트 진행 중
        _doMount(pluginId, inst, host);
      }, function (reason) {
        if (seq !== _mountSeq) return;
        host.innerHTML = '<div class="error-banner" style="margin:var(--space-6)">[' + _esc(pluginId) + '] 백엔드 연결 실패: ' + _esc(reason) + '</div>';
      });
    } else {
      _doMount(pluginId, inst, host);
    }
  }

  function _doMount(pluginId, inst, host) {
    var ctx = _makeCtx(pluginId);
    var mountResult;
    try {
      mountResult = inst.mount(host, ctx);
      _activePluginId = pluginId;
      _activePluginInstance = inst;
      _activeMountOk = true;
    } catch (e) {
      console.error('[SHELL] mount 동기 실패', pluginId, e);
      host.innerHTML = '<div class="error-banner" style="margin:var(--space-6)">[' + _esc(pluginId) + '] 플러그인 로드 실패: ' + _esc(e.message || String(e)) + '</div>';
      // 상태 리셋 — 다음 시도 시 재마운트 허용
      _activePluginId = null;
      _activePluginInstance = null;
      _activeMountOk = false;
      return;
    }

    if (mountResult && typeof mountResult.then === 'function') {
      var mountSeqAtCall = _mountSeq; // 구형 reject가 신규 마운트 상태 덮어쓰기 방지
      mountResult.catch(function (e) {
        if (mountSeqAtCall !== _mountSeq) return; // 이미 다른 마운트가 진행 중 — 무시
        console.error('[SHELL] mount Promise 실패', pluginId, e);
        // F-03: 에러 배너 표시 + 활성 상태 리셋
        host.innerHTML = '<div class="error-banner" style="margin:var(--space-6)">[' + _esc(pluginId) + '] 플러그인 로드 실패: ' + _esc(e && (e.message || String(e))) + '</div>';
        _activePluginId = null;
        _activePluginInstance = null;
        _activeMountOk = false;
      });
    }
  }

  /* ─────────────────────────────────────────────
     대시보드 통합 (§5 getDashboardContrib 합산)
     현재 card-quiz 단일 플러그인 대응.
     복수 플러그인 시 contribs merge 확장 필요(TODO).
  ───────────────────────────────────────────── */
  function _renderDashboard() {
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
      // 빈 상태 메시지 표시 (플러그인 미마운트 또는 getDashboardContrib 미지원)
      var dHost = $('plugin-host') || document.querySelector('.dashboard-wrap');
      var emptyEl = $('dash-empty-state');
      if (!emptyEl && dHost) {
        emptyEl = document.createElement('p');
        emptyEl.id = 'dash-empty-state';
        emptyEl.className = 'text-muted';
        emptyEl.style.cssText = 'padding:32px;text-align:center';
        emptyEl.textContent = '아직 학습 데이터가 없습니다';
        dHost.appendChild(emptyEl);
      }
      return;
    }

    // 기존 빈 상태 메시지 제거
    var prevEmpty = $('dash-empty-state');
    if (prevEmpty) prevEmpty.remove();

    // 전체 contribs 실제 merge (§5 합산 준수)
    // by_area: 키 병합(area+subarea 기준, 중복 없이 수집)
    // weakness / pass_path / completion: concat 후 중복은 첫 등장 우선
    // extra_widgets: 전부 concat
    var merged = {
      plugin_id: contribs.map(function (c) { return c.plugin_id; }).join('+'),
      by_area: [],
      weakness: [],
      pass_path: [],
      completion: [],
      extra_widgets: []
    };

    var byAreaSeen = {};
    var weaknessSeen = {};
    var passPathSeen = {};
    var completionSeen = {};

    contribs.forEach(function (c) {
      // by_area — area+subarea 키 기준 병합(첫 등장 우선)
      (c.by_area || []).forEach(function (r) {
        var key = (r.area || '') + '|' + (r.subarea || '');
        if (!byAreaSeen[key]) { byAreaSeen[key] = true; merged.by_area.push(r); }
      });
      // weakness — area+subarea+unit 키 기준 concat(중복 없이)
      (c.weakness || []).forEach(function (w) {
        var key = (w.area || '') + '|' + (w.subarea || '') + '|' + (w.unit || '');
        if (!weaknessSeen[key]) { weaknessSeen[key] = true; merged.weakness.push(w); }
      });
      // pass_path — area+subarea 기준
      (c.pass_path || []).forEach(function (p) {
        var key = (p.area || '') + '|' + (p.subarea || '');
        if (!passPathSeen[key]) { passPathSeen[key] = true; merged.pass_path.push(p); }
      });
      // completion — area+subarea 기준
      (c.completion || []).forEach(function (cp) {
        var key = (cp.area || '') + '|' + (cp.subarea || '');
        if (!completionSeen[key]) { completionSeen[key] = true; merged.completion.push(cp); }
      });
      // extra_widgets — 전부 concat
      (c.extra_widgets || []).forEach(function (w) { merged.extra_widgets.push(w); });
    });

    _renderDashboardData(merged);
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

  /* 진단 데이터가 충분한지 판단 (cold_attempts 합산) */
  function _hasSufficientData(data) {
    if (!data) return false;
    var byArea = data.by_area || [];
    if (!byArea.length) return false;
    var hasData = byArea.some(function (r) { return r.retrieval_rate != null; });
    return hasData;
  }

  var STATUS_KO = { safe: '안전', watch: '주의', danger: '위험' };

  /** F-10: HTML escape (areaLabel 등 동적 값의 innerHTML 삽입 보호) */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * _sanitizeWidgetHtml — extra_widgets 삽입 전 경량 안전망 (shell-side).
   * 계약 §5에서 플러그인이 _esc 책임이나, 향후 서드파티 플러그인 대비 2차 방어선.
   * 제거 대상: <script> 블록, on* 이벤트 핸들러 속성, javascript: URL.
   * 허용: 일반 표시용 HTML 태그 (div/span/p/b/i/br/ul/li/table 등).
   */
  function _sanitizeWidgetHtml(html) {
    if (!html || typeof html !== 'string') return '';
    // DOMParser로 파싱 후 위험 노드/속성 제거
    var doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      // DOMParser 미지원 환경 — 문자열 정규식 fallback
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
        .replace(/javascript\s*:/gi, 'void:');
    }
    // <script> 요소 전체 제거
    var scripts = doc.body.querySelectorAll('script');
    for (var si = 0; si < scripts.length; si++) scripts[si].parentNode.removeChild(scripts[si]);
    // on* 이벤트 핸들러 속성 및 javascript: href/src 제거 (전체 노드 트리 순회)
    var allNodes = doc.body.querySelectorAll('*');
    for (var ni = 0; ni < allNodes.length; ni++) {
      var node = allNodes[ni];
      var attrs = Array.prototype.slice.call(node.attributes);
      for (var ai = 0; ai < attrs.length; ai++) {
        var attrName = attrs[ai].name.toLowerCase();
        var attrVal = attrs[ai].value;
        if (/^on/.test(attrName)) {
          node.removeAttribute(attrs[ai].name);
        } else if ((attrName === 'href' || attrName === 'src' || attrName === 'action') &&
                   /^\s*javascript\s*:/i.test(attrVal)) {
          node.removeAttribute(attrs[ai].name);
        }
      }
    }
    return doc.body.innerHTML;
  }

  function _renderDashboardData(data) {
    if (!data) return;

    // 데이터 부족 시 단일 안내 메시지 표시
    if (!_hasSufficientData(data)) {
      var dWrap = document.querySelector('.dashboard-wrap');
      if (dWrap) {
        var existingMsg = $('dash-nodata');
        if (!existingMsg) {
          var msg = document.createElement('p');
          msg.id = 'dash-nodata';
          msg.className = 'text-muted';
          msg.style.cssText = 'padding:32px;text-align:center';
          msg.textContent = '학습을 시작하면 진단 데이터가 쌓입니다.';
          dWrap.appendChild(msg);
        }
      }
      // 위젯 숨김
      qsa('[data-widget]').forEach(function (w) { w.setAttribute('hidden', ''); });
      return;
    }

    // 데이터 있으면 nodata 메시지 제거, 위젯 노출
    var nd = $('dash-nodata'); if (nd) nd.remove();
    qsa('[data-widget]').forEach(function (w) { w.removeAttribute('hidden'); });

    // 1. retrieval
    var rl = $('retrieval-list');
    if (rl) {
      rl.innerHTML = '';
      var byArea = data.by_area || [];
      if (!byArea.length) rl.innerHTML = '<p class="widget-empty">데이터 부족</p>';
      byArea.forEach(function (r) {
        var row = document.createElement('div'); row.className = 'area-row';
        if (r.retrieval_rate == null) {
          row.innerHTML = '<span class="area-row__label"><b>' + _esc(areaLabel(r.area, r.subarea)) + '</b></span><span class="area-row__val" style="color:var(--ink3)">데이터 부족</span>';
        } else {
          row.innerHTML = '<span class="area-row__label"><b>' + _esc(areaLabel(r.area, r.subarea)) + '</b></span>' +
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
        row.innerHTML = '<span class="area-row__label"><b>' + _esc(w.unit) + '</b><br><span style="font-size:var(--fs-xs);color:var(--ink3)">' + _esc(areaLabel(w.area, w.subarea)) + '</span></span>' +
          '<span class="area-gauge hot"><i style="width:' + pct(w.wrong_rate) + '%"></i></span>' +
          '<span class="area-row__val" style="color:var(--hot)">' + pct(w.wrong_rate) + '%</span>';
        wl.appendChild(row);
      });
    }

    // 3. pass-path (status 한국어화)
    var pl = $('pass-path-list');
    if (pl) {
      pl.innerHTML = '';
      var passpath = data.pass_path || [];
      if (!passpath.length) pl.innerHTML = '<p class="widget-empty">데이터 부족</p>';
      passpath.forEach(function (p) {
        var row = document.createElement('div'); row.className = 'area-row';
        var gaugeCls = p.status === 'danger' ? 'area-gauge hot' : p.status === 'watch' ? 'area-gauge warn' : 'area-gauge';
        var statusKo = STATUS_KO[p.status] || p.status;
        row.innerHTML = '<span class="area-row__label"><b>' + _esc(areaLabel(p.area, p.subarea)) + '</b> <span style="font-size:var(--fs-xs);color:var(--ink3)">목표 ' + _esc(String(p.target)) + '</span></span>' +
          '<span class="' + _esc(gaugeCls) + '"><i style="width:' + pct(p.progress) + '%"></i></span>' +
          '<span class="status-chip ' + _esc(p.status) + '">' + _esc(statusKo) + '</span>';
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
        wrap.innerHTML = '<div class="completion-row__head"><span class="lbl">' + _esc(areaLabel(c.area, c.subarea)) + '</span><span class="val">정복 ' + pct(c.mastery_rate) + '%</span></div>' +
          '<div class="stack-bar"><span class="box1" style="width:' + w1 + '%"></span><span class="box2" style="width:' + w2 + '%"></span><span class="box3" style="width:' + w3 + '%"></span></div>';
        cl.appendChild(wrap);
      });

      if (completion.length) {
        var avg = completion.reduce(function (s, c) { return s + clamp01(c.mastery_rate); }, 0) / completion.length;
        var ovBar = $('ov-bar'); var ovPct = $('ov-pct');
        if (ovBar) ovBar.style.width = pct(avg) + '%';
        if (ovPct) ovPct.textContent = pct(avg) + '%';
      }
    }

    // 5. extra_widgets — 플러그인이 선언한 커스텀 위젯 삽입
    var extraWidgets = data.extra_widgets || [];
    if (extraWidgets.length) {
      var ewArea = $('extra-widgets-area');
      if (!ewArea) {
        // 동적 생성 — dashboard-wrap 말미에 붙임
        ewArea = document.createElement('div');
        ewArea.id = 'extra-widgets-area';
        var dWrap2 = document.querySelector('.dashboard-wrap');
        if (dWrap2) dWrap2.appendChild(ewArea);
      }
      ewArea.innerHTML = '';
      extraWidgets.forEach(function (w) {
        var wDiv = document.createElement('div');
        wDiv.className = 'extra-widget';
        // 계약 §5: 플러그인이 _esc 1차 책임. 셸 2차 안전망으로 sanitize 통과.
        if (w && w.html) wDiv.innerHTML = _sanitizeWidgetHtml(w.html);
        ewArea.appendChild(wDiv);
      });
    }
  }

  /* ─────────────────────────────────────────────
     개념서 렌더 (기존 index.html 인라인 로직 이전)
  ───────────────────────────────────────────── */
  var _conceptCardData = null;
  var _conceptDeckId = null;  // nav-link 클릭 시 설정되는 타깃 deck

  function _renderConcept() {
    var body = $('concept-body');
    if (!body) return;

    var cards = null;

    // 지정된 deckId 우선
    var targetDeckId = _conceptDeckId;

    if (!targetDeckId) {
      // fallback: manifest 첫 번째 유효 deck
      var manifest = window.MANIFEST && window.MANIFEST[_subject];
      var deckIds = (manifest && manifest.decks) || [];
      for (var di = 0; di < deckIds.length; di++) {
        var d0 = deckIds[di];
        var did = (typeof d0 === 'string') ? d0 : (d0 && d0.deck_id);
        if (did) { targetDeckId = did; break; }
      }
    }

    if (targetDeckId) {
      if (!window.DECKS || !window.DECKS[targetDeckId]) {
        console.warn('[SHELL] _renderConcept: deck 없음 deck_id=' + targetDeckId);
      } else {
        cards = window.DECKS[targetDeckId].cards;
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

    // 현재 활성 필터 적용
    var activeLvFilter = _activeLv || 'all';

    cards.filter(function (c) { return c.enabled !== false; }).forEach(function (card) {
      var lv = levelOf(card);
      var sec = document.createElement('div'); sec.className = 'section-card';
      sec.id = 'concept-' + card.card_id;
      sec.setAttribute('data-level', String(lv));
      var freqCls = 'l' + lv, stars = lv === 3 ? '★★★' : lv === 2 ? '★★' : '★';
      var refId = (card.links && card.links.concept_ref) || card.card_id;
      var title = frontText(card) || card.card_id;
      var head = document.createElement('button'); head.type = 'button'; head.className = 'sec-head';
      head.innerHTML = '<span class="sec-id">' + _esc(refId) + '</span>' +
        '<span class="sec-title">' + _esc(title) + '</span>' +
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

    // 필터 적용
    _applyConceptFilter();
  }

  var _conceptTarget = null;

  /* ─────────────────────────────────────────────
     hash 라우터 (§5, file:// 호환)
     #<route>/<plugin_id>/<activity_id?>
     route ∈ learn | dashboard | settings | concept
     별칭: quiz→learn
  ───────────────────────────────────────────── */
  var ROUTES_SCREEN = ['learn', 'dashboard', 'settings', 'concept'];
  var ROUTE_ALIAS = { quiz: 'learn' };

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
    route = ROUTE_ALIAS[route] || route;
    if (ROUTES_SCREEN.indexOf(route) === -1) {
      console.warn('[SHELL] 알 수 없는 route:', route); route = 'learn';
    }
    var hash = '#' + route;
    if (pluginId) hash += '/' + pluginId;
    if (activityId) hash += '/' + activityId;
    window.location.hash = hash;
  }

  function _applyRoute(parsed) {
    // _setRoute에서 이미 별칭 해소 후 hash에 씀. 단 외부 직접 hash 설정 대비해 여기서도 처리.
    var route = ROUTE_ALIAS[parsed.route] || parsed.route;
    if (ROUTES_SCREEN.indexOf(route) === -1) route = 'learn';

    document.body.setAttribute('data-route', route === 'learn' ? 'quiz' : route);

    qsa('[data-screen]').forEach(function (sec) {
      var screenId = sec.getAttribute('data-screen');
      var active = false;
      if (route === 'learn' && screenId === 'quiz') active = true;
      else if (route === 'dashboard' && screenId === 'dashboard') active = true;
      else if (route === 'settings' && screenId === 'settings') active = true;
      else if (route === 'concept' && screenId === 'concept') active = true;
      if (active) sec.removeAttribute('hidden'); else sec.setAttribute('hidden', '');
    });

    qsa('[data-route-trigger]').forEach(function (b) {
      var trigger = b.getAttribute('data-route-trigger');
      var triggerResolved = ROUTE_ALIAS[trigger] || trigger;
      b.classList.toggle('active', triggerResolved === route);
    });

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
    return 'card-quiz';
  }

  function _onHashChange() {
    var parsed = _parseHash();
    _applyRoute(parsed);
  }
  window.addEventListener('hashchange', _onHashChange);

  /* ─────────────────────────────────────────────
     사이드바 네비 빌드 (§5, 데이터구동)
     deck 클릭 → _conceptDeckId 설정 → concept 이동
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
        '<span class="grp-name">' + _esc(a.label || a.subarea) + '</span>' +
        '<span class="grp-pct">' + areaDecks.length + '덱</span>' +
        '<svg class="grp-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 6 15 12 9 18"/></svg>';
      head.addEventListener('click', function () { grp.classList.toggle('open'); });
      var items = document.createElement('div'); items.className = 'nav-items';
      areaDecks.forEach(function (d) {
        // deck_id를 hash에 담아 딥링크 — addEventListener 없이 href 직접 사용
        var deckIdVal = (typeof d === 'string') ? d : (d.deck_id || '');
        var link = document.createElement('a'); link.className = 'nav-link';
        // 클릭 시: _conceptDeckId 설정 후 concept으로 이동
        link.href = 'javascript:void(0)';
        link.innerHTML = '<span class="nl-id">' + _esc(String(d.card_count || '')) + '</span><span>' + _esc(d.title || deckIdVal) + '</span>';
        link.addEventListener('click', function () {
          qsa('.nav-link').forEach(function (l) { l.classList.remove('active'); });
          link.classList.add('active');
          var sidebar = $('sidebar'); var scrim = $('scrim');
          if (sidebar) sidebar.classList.remove('open');
          if (scrim) scrim.classList.remove('show');
          _conceptDeckId = deckIdVal;
          _setRoute('concept');
        });
        items.appendChild(link);
      });
      grp.appendChild(head); grp.appendChild(items); nav.appendChild(grp);
    });

    // plugin 탭
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
      document.title = '학습 프레임워크 · ' + manifest.subject_label;
    }
  }

  /* ─────────────────────────────────────────────
     MANIFEST_* 전역 스캔 헬퍼 (DRY — _registerPlugins, _renderSettings 공용)
  ───────────────────────────────────────────── */
  function _collectExtraPluginManifests(seenIds) {
    var extras = [];
    var winKeys;
    try { winKeys = Object.keys(window); } catch (e) {
      // 보안 익스텐션 환경의 SecurityError — 전역 스캔 불가, 빈 배열 반환
      console.warn('[SHELL] _collectExtraPluginManifests: Object.keys(window) 실패', e);
      return extras;
    }
    winKeys.forEach(function (k) {
      if (/^MANIFEST_[A-Z]/.test(k)) {
        var m = window[k];
        if (m && m.plugin_id && !seenIds[m.plugin_id]) {
          extras.push(m);
          seenIds[m.plugin_id] = true;
        }
      }
    });
    return extras;
  }

  /* ─────────────────────────────────────────────
     설정 화면 렌더 (§6 BYO-key + export + D-day)
  ───────────────────────────────────────────── */
  function _renderByokSection(settingsWrap, pManifest) {
    if (!pManifest || !pManifest.byok || !Array.isArray(pManifest.byok.keys) || !pManifest.byok.keys.length) return;
    var section = document.createElement('div');
    section.className = 'settings-section';
    section.setAttribute('data-byok-section', pManifest.plugin_id);
    section.innerHTML = '<h2 class="settings-section__title">' + (pManifest.label || pManifest.plugin_id) + ' API 키</h2>';

    pManifest.byok.keys.forEach(function (keyDef) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:block;margin-bottom:var(--space-4,12px)';
      lbl.innerHTML = '<span class="text-muted" style="display:block;margin-bottom:4px">' + _esc(keyDef.label) + '</span>';
      var input = document.createElement('input');
      input.type = 'password';
      input.style.cssText = 'width:100%;box-sizing:border-box;font-size:var(--fs-md,14px);padding:9px 12px;border:1px solid var(--line2,#ddd);border-radius:var(--r,4px);background:var(--surface,#fff);color:var(--ink,#111)';
      input.placeholder = keyDef.help || '키를 입력하세요';
      var saved = '';
      try { saved = localStorage.getItem('clf:keys:' + keyDef.id) || ''; } catch (e) {}
      input.value = saved;
      input.addEventListener('change', function () {
        try { localStorage.setItem('clf:keys:' + keyDef.id, input.value); } catch (e) {}
      });
      lbl.appendChild(input);
      section.appendChild(lbl);
    });

    var firstSection = settingsWrap.querySelector('.settings-section');
    if (firstSection) settingsWrap.insertBefore(section, firstSection);
    else settingsWrap.appendChild(section);
  }

  function _renderSettings() {
    var manifest = window.MANIFEST && window.MANIFEST[_subject];
    var pluginsFromManifest = (manifest && manifest.plugins) || [];
    var seenIds = {};
    pluginsFromManifest.forEach(function (p) { seenIds[p.plugin_id] = true; });

    var extraManifests = _collectExtraPluginManifests(seenIds);
    var allPlugins = pluginsFromManifest.concat(extraManifests);

    var settingsWrap = document.querySelector('.settings-wrap');
    if (!settingsWrap) return;

    // BYO-key 섹션 재생성
    qsa('[data-byok-section]', settingsWrap).forEach(function (el) { el.remove(); });
    allPlugins.slice().reverse().forEach(function (pManifest) {
      _renderByokSection(settingsWrap, pManifest);
    });

    // D-day 모드 토글 (있으면 값 동기화, 없으면 생성)
    var ddaySection = $('settings-dday-section');
    if (!ddaySection) {
      ddaySection = document.createElement('div');
      ddaySection.className = 'settings-section';
      ddaySection.id = 'settings-dday-section';
      var ddayTitle = document.createElement('h2');
      ddayTitle.className = 'settings-section__title';
      ddayTitle.textContent = 'D-day 모드';
      var ddayDesc = document.createElement('p');
      ddayDesc.className = 'text-muted';
      ddayDesc.textContent = '시험 임박 시 모든 박스를 강제 소환합니다. 간격이 1일로 압축됩니다.';
      var ddayLabel = document.createElement('label');
      ddayLabel.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px';
      var ddayChk = document.createElement('input');
      ddayChk.type = 'checkbox';
      ddayChk.id = 'dday-toggle';
      ddayChk.checked = _getDDayMode();
      ddayChk.addEventListener('change', function () {
        _setDDayMode(ddayChk.checked);
      });
      var ddayLblText = document.createElement('span');
      ddayLblText.textContent = 'D-day 모드 활성화';
      ddayLabel.appendChild(ddayChk);
      ddayLabel.appendChild(ddayLblText);
      ddaySection.appendChild(ddayTitle);
      ddaySection.appendChild(ddayDesc);
      ddaySection.appendChild(ddayLabel);
      // settings-wrap 내 첫 번째 섹션 앞에 삽입
      var firstSec = settingsWrap.querySelector('.settings-section');
      if (firstSec) settingsWrap.insertBefore(ddaySection, firstSec);
      else settingsWrap.appendChild(ddaySection);
    } else {
      var chk = $('dday-toggle');
      if (chk) chk.checked = _getDDayMode();
    }
  }

  /* ─────────────────────────────────────────────
     읽기 진행바 (concept 화면 진입/이탈 시 등록/해제)
  ───────────────────────────────────────────── */
  var _scrollHandler = null;
  function _attachScrollBar() {
    if (_scrollHandler) return;
    _scrollHandler = function () {
      var h = document.documentElement;
      var sc = h.scrollTop / ((h.scrollHeight - h.clientHeight) || 1);
      var rb = $('read-bar');
      if (rb) rb.style.width = Math.max(0, Math.min(1, sc)) * 100 + '%';
    };
    window.addEventListener('scroll', _scrollHandler);
  }
  function _detachScrollBar() {
    if (_scrollHandler) {
      window.removeEventListener('scroll', _scrollHandler);
      _scrollHandler = null;
    }
    var rb = $('read-bar');
    if (rb) rb.style.width = '0%';
  }

  /* ─────────────────────────────────────────────
     검색 + 필터칩 (개념서 전용)
  ───────────────────────────────────────────── */
  var _activeLv = 'all', _searchQ = '';
  function _applyConceptFilter() {
    var conceptBody = $('concept-body');
    if (!conceptBody) return;
    qsa('.section-card', conceptBody).forEach(function (sec) {
      var lv = sec.getAttribute('data-level') || 'all';
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
    // 사이드바 드로어
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

    // route 전환 버튼
    qsa('[data-route-trigger]').forEach(function (b) {
      b.addEventListener('click', function () {
        _setRoute(b.getAttribute('data-route-trigger'));
      });
    });

    // concept 뒤로 버튼
    var backBtn = document.querySelector('[data-concept="back-to-quiz"]');
    if (backBtn) backBtn.addEventListener('click', function () {
      _detachScrollBar();
      _setRoute('learn');
    });

    // 필터칩 — concept 화면 내부 이동
    qsa('#freq-chips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        qsa('#freq-chips .chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        _activeLv = chip.getAttribute('data-lv');
        if (document.body.getAttribute('data-route') === 'concept') _applyConceptFilter();
      });
    });

    // 검색창 — concept 화면에서만 동작, 다른 화면에서 입력 시 화면 전환 없음
    var searchEl = $('search');
    if (searchEl) {
      searchEl.addEventListener('input', function (e) {
        _searchQ = e.target.value.toLowerCase().trim();
        // concept 화면이 아닐 때는 필터만 업데이트(화면 전환 없음)
        if (document.body.getAttribute('data-route') === 'concept') {
          _applyConceptFilter();
        }
      });
      // concept 화면에서만 검색창 활성화
      searchEl.addEventListener('focus', function () {
        var route = document.body.getAttribute('data-route');
        if (route !== 'concept') {
          searchEl.blur();
          _setRoute('concept');
        }
      });
    }

    // settings export
    var exportBtn = document.querySelector('[data-settings="export"]');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      try {
        var bundle = { subject: _subject, exported_at: new Date().toISOString(), plugins: {} };
        Object.keys(window.PLUGIN_REGISTRY).forEach(function (pid) {
          var inst = window.PLUGIN_REGISTRY[pid];
          if (inst && inst.getProgressSnapshot) {
            try { bundle.plugins[pid] = inst.getProgressSnapshot(); } catch (e2) {}
          }
        });
        var lsKeys = [];
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var lk = localStorage.key(i);
            if (lk && lk.indexOf('clf:') === 0 && lk.indexOf(':progress') !== -1) lsKeys.push(lk);
          }
        } catch (e3) {}
        lsKeys.forEach(function (lk) {
          var parts = lk.split(':');
          if (parts.length >= 3) {
            var pid2 = parts[1];
            if (!bundle.plugins[pid2]) {
              try { bundle.plugins[pid2] = JSON.parse(localStorage.getItem(lk) || 'null'); } catch (e4) {}
            }
          }
        });
        var json = JSON.stringify(bundle, null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url;
        a.download = 'clf-progress-all-' + _subject + '-' + new Date().toISOString().slice(0,10) + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        var exportResult = $('export-result');
        if (exportResult) exportResult.textContent = '내보내기 완료 (' + Object.keys(bundle.plugins).length + '개 플러그인).';
        _clearQuotaBanner();
      } catch (e) {
        var exportResult2 = $('export-result');
        if (exportResult2) exportResult2.textContent = '내보내기 실패: ' + e.message;
      }
    });

    // settings import
    var importBtn = document.querySelector('[data-settings="import"]');
    var importFile = $('import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', function () {
        var file = importFile.files && importFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onerror = function () {
          var r = $('export-result');
          if (r) r.textContent = '파일 읽기 오류';
        };
        reader.onload = function (evt) {
          var resultEl = $('export-result');
          try {
            var data = JSON.parse(evt.target.result);
            var plugins = data.plugins || data;
            var count = 0;
            if (typeof plugins === 'object' && plugins !== null) {
              Object.keys(plugins).forEach(function (pid) {
                var snap = plugins[pid];
                if (!snap) return;
                // PLUGIN_REGISTRY 인스턴스에 복원
                var inst = window.PLUGIN_REGISTRY[pid];
                if (inst && inst.onProgressRestored) {
                  try { inst.onProgressRestored(snap); } catch (e5) {}
                }
                // localStorage 직접 저장 (미마운트 플러그인 대비) — pid당 1회만 count
                try {
                  localStorage.setItem('clf:' + pid + ':progress', JSON.stringify(snap));
                  count++;
                } catch (e6) { _showQuotaBanner(pid); }
              });
            }
            if (resultEl) resultEl.textContent = '가져오기 완료 (대상: ' + Object.keys(plugins || {}).length + '개 플러그인).';
          } catch (e) {
            var r2 = $('export-result');
            if (r2) r2.textContent = '가져오기 실패: ' + e.message;
          }
          importFile.value = '';
        };
        reader.readAsText(file);
      });
    }

    // 뷰포트 모드
    function detectViewport() {
      var w = window.innerWidth;
      document.body.setAttribute('data-viewport-mode', w < 600 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');
    }
    detectViewport();
    window.addEventListener('resize', detectViewport);

    // concept 진입/이탈 시 readbar 탈부착
    window.addEventListener('hashchange', function () {
      var parsed = _parseHash();
      var route = ROUTE_ALIAS[parsed.route] || parsed.route;
      if (route === 'concept') { _attachScrollBar(); }
      else { _detachScrollBar(); }
    });
  }

  /* ─────────────────────────────────────────────
     플러그인 등록 (MANIFEST.plugins 순회)
     전역키 변환 단일 규칙: card-quiz → _CARD_QUIZ_PLUGIN
  ───────────────────────────────────────────── */
  function _registerPlugins(manifest) {
    if (manifest) {
      if (!Array.isArray(manifest.plugins)) manifest.plugins = [];
      var seenPids = {};
      manifest.plugins.forEach(function (p) { seenPids[p.plugin_id] = true; });
      var extras = _collectExtraPluginManifests(seenPids);
      extras.forEach(function (m) { manifest.plugins.push(m); });
    }

    var plugins = (manifest && manifest.plugins) || [];
    plugins.forEach(function (pManifest) {
      var pid = pManifest.plugin_id;
      // 명명규칙: card-quiz → _CARD_QUIZ_PLUGIN
      var globalKey = '_' + pid.replace(/-/g, '_').toUpperCase() + '_PLUGIN';
      var inst = window[globalKey];
      if (inst) {
        window.PLUGIN_REGISTRY[pid] = inst;
      } else {
        console.warn('[SHELL] 플러그인 인스턴스를 찾을 수 없음:', pid, '(window.' + globalKey + ')');
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

    _applyMeta(manifest);
    _buildNav(manifest);
    _registerPlugins(manifest);
    _bindShellEvents();

    var parsed = _parseHash();
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
