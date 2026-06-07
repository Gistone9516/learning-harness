/**
 * aws / plugin.js — PluginInstance 구현
 * 플러그인계약 §3 PluginInstance 전부 구현
 * aws 런타임규격 §6~§7 conform
 * ────────────────────────────────────────────────────────────
 * 동작 방식:
 *   - 과제 목록 사이드바 + 과제 뷰어 (멀티과제 네비게이션)
 *   - 과제 선택 → 해당 과제 prompt·service·checkpoints·cli_hint 표시
 *   - "검증" 클릭 → POST entry_url/grade { activity_id, checks }
 *   - 백엔드(grade.py) boto3 → LocalStack or 실제 AWS 계정 리소스 확인
 *   - 백엔드 미연결(헬스체크 실패) → graceful: 콘텐츠 열람 유지, 검증 버튼 비활성
 *
 * shell.js _registerPlugins 등록 규칙:
 *   plugin_id = "aws"
 *   globalKey  = "_AWS_PLUGIN"
 *   directKey  = "_AWS_PLUGIN"
 *   → window._AWS_PLUGIN = instance
 *
 * 진도 localStorage 키: clf:aws:progress  (플러그인계약 §5)
 * file:// 더블클릭 동작 (fetch는 entry_url 채점서버 전용, CDN 의존 없음)
 */
(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     설정 — entry_url (manifest 또는 localStorage 오버라이드)
  ───────────────────────────────────────────── */
  function _getEntryUrl() {
    try {
      var override = localStorage.getItem('clf:keys:aws-entry-url');
      if (override && override.trim()) return override.trim();
    } catch (e) {}
    if (window.MANIFEST_AWS && window.MANIFEST_AWS.entry_url) {
      return window.MANIFEST_AWS.entry_url;
    }
    return 'http://localhost:5001';
  }

  /* ─────────────────────────────────────────────
     진도 localStorage 헬퍼 (키: clf:aws:progress)
  ───────────────────────────────────────────── */
  var PROGRESS_KEY = 'clf:aws:progress';

  function _loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function _saveProgress(snap) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(snap)); } catch (e) {}
  }

  /* ─────────────────────────────────────────────
     플러그인 내부 상태
  ───────────────────────────────────────────── */
  var _state = {
    mounted:        false,
    host:           null,     // HTMLElement — #plugin-host
    ctx:            null,     // PluginContext
    activities:     [],       // 전체 ActivitySpec 배열
    currentIdx:     0,        // 현재 표시 중인 과제 인덱스
    backendOnline:  false,    // 헬스체크 결과
    progress:       null,     // PluginProgressSnapshot 메모리 캐시
    restored:       false     // onProgressRestored 호출 여부
  };

  /* ─────────────────────────────────────────────
     헬스체크 (런타임규격 §3-3, §5)
  ───────────────────────────────────────────── */
  function _healthCheck(entryUrl, onOnline, onOffline) {
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      onOffline('헬스체크 타임아웃 (3s)');
    }, 3000);

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', entryUrl + '/health', true);
      xhr.onload = function () {
        if (timedOut) return;
        clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var res = JSON.parse(xhr.responseText || '{}');
            if (res.status === 'ok') { onOnline(); return; }
          } catch (e) {}
          onOnline();
        } else {
          onOffline('health 응답 오류: HTTP ' + xhr.status);
        }
      };
      xhr.onerror = function () {
        if (timedOut) return;
        clearTimeout(timer);
        onOffline('네트워크 오류 — 백엔드 미실행 또는 CORS 차단');
      };
      xhr.send();
    } catch (e) {
      clearTimeout(timer);
      onOffline(e.message || '헬스체크 실패');
    }
  }

  /* ─────────────────────────────────────────────
     오프라인 배너 HTML (LocalStack 2026.03 인증 안내 포함)
  ───────────────────────────────────────────── */
  function _offlineBannerHTML(reason) {
    return '<div class="aws-offline-banner" style="' +
      'background:#fff8e1;border:1px solid #ffe082;border-radius:8px;' +
      'padding:14px 16px;margin-bottom:16px;font-size:0.88em;line-height:1.7;color:#5f4b00">' +
      '<strong>AWS 백엔드(grade.py)에 연결할 수 없습니다.</strong> ' +
      '(' + _esc(reason) + ')<br>' +
      '백엔드를 시작한 후 새로고침하세요.<br><br>' +
      '<strong>[옵션 A] LocalStack</strong> (2026.03 이후 LOCALSTACK_AUTH_TOKEN 필요):<br>' +
      '<code style="display:block;background:#fffde7;padding:5px 8px;border-radius:4px;font-size:0.85em;margin:4px 0 8px">' +
      'LOCALSTACK_AUTH_TOKEN=&lt;your-token&gt; docker run --rm -p 4566:4566 -e LOCALSTACK_AUTH_TOKEN localstack/localstack<br>' +
      '→ 토큰 발급: https://app.localstack.cloud/sign-in' +
      '</code>' +
      '<strong>[옵션 B] MiniStack</strong> (계정·토큰 불필요, MIT):<br>' +
      '<code style="display:block;background:#fffde7;padding:5px 8px;border-radius:4px;font-size:0.85em;margin:4px 0 8px">' +
      'docker run --rm -p 4566:4566 gresearch/ministack' +
      '</code>' +
      '<strong>grade.py</strong>: <code>python grade.py</code> (기본 포트 5001)' +
      '</div>';
  }

  /* ─────────────────────────────────────────────
     전체 레이아웃 빌드 (사이드바 + 뷰어)
  ───────────────────────────────────────────── */
  function _buildLayout(container, backendOnline, offlineReason) {
    var activities = _state.activities;

    container.innerHTML =
      '<div class="aws-root" style="display:flex;gap:0;min-height:320px;font-size:0.93em">' +
        '<div class="aws-sidebar" style="' +
          'width:200px;min-width:160px;flex-shrink:0;' +
          'border-right:1px solid var(--line2,#e0e0e0);' +
          'background:var(--surface2,#f6f8fa);overflow-y:auto;' +
          'padding:10px 0">' +
          '<div style="font-size:0.78em;font-weight:700;color:var(--ink3,#888);' +
            'padding:0 12px 8px;text-transform:uppercase;letter-spacing:0.05em">' +
            '과제 목록 (' + activities.length + ')' +
          '</div>' +
          _buildSidebarItems(activities) +
        '</div>' +
        '<div class="aws-viewer" style="flex:1;padding:16px 18px;overflow-y:auto;min-width:0">' +
          (backendOnline ? '' : _offlineBannerHTML(offlineReason || '')) +
          '<div class="aws-activity-content"></div>' +
        '</div>' +
      '</div>';

    // 사이드바 클릭 이벤트
    var sidebar = container.querySelector('.aws-sidebar');
    if (sidebar) {
      sidebar.addEventListener('click', function (e) {
        var item = e.target.closest('[data-act-idx]');
        if (!item) return;
        var idx = parseInt(item.getAttribute('data-act-idx'), 10);
        if (isNaN(idx)) return;
        _navigateTo(container, idx);
      });
    }
  }

  function _buildSidebarItems(activities) {
    var snap = _state.progress;
    var parts = [];
    activities.forEach(function (act, idx) {
      var verdict = null;
      if (snap && snap.activities && snap.activities[act.activity_id]) {
        verdict = snap.activities[act.activity_id].last_verdict;
      }
      var icon = '';
      if (verdict === 'correct')   icon = '<span style="color:var(--ok,#22863a);margin-right:4px">✓</span>';
      else if (verdict === 'incorrect') icon = '<span style="color:var(--hot,#d73a49);margin-right:4px">✗</span>';
      else icon = '<span style="color:var(--ink3,#bbb);margin-right:4px">○</span>';

      var isActive = (idx === _state.currentIdx);
      var service = (act.front && act.front.service) ? act.front.service : '';
      var task    = (act.front && act.front.task)    ? act.front.task    : act.activity_id;

      parts.push(
        '<div class="aws-sidebar-item" data-act-idx="' + idx + '" style="' +
          'padding:7px 12px;cursor:pointer;border-left:3px solid ' +
          (isActive ? 'var(--accent,#ff9900)' : 'transparent') + ';' +
          'background:' + (isActive ? 'var(--surface,#fff)' : 'transparent') + ';' +
          'transition:background 0.1s">' +
          icon +
          (service ? '<span style="font-size:0.75em;font-weight:700;color:#ff9900;margin-right:4px">' + _esc(service) + '</span>' : '') +
          '<span style="font-size:0.85em;color:var(--ink,#222)">' + _esc(task) + '</span>' +
        '</div>'
      );
    });
    return parts.join('');
  }

  function _navigateTo(container, idx) {
    _state.currentIdx = idx;
    // 사이드바 하이라이트 갱신
    var sidebar = container.querySelector('.aws-sidebar');
    if (sidebar) {
      sidebar.innerHTML = '<div style="font-size:0.78em;font-weight:700;color:var(--ink3,#888);' +
        'padding:0 12px 8px;text-transform:uppercase;letter-spacing:0.05em">' +
        '과제 목록 (' + _state.activities.length + ')' +
        '</div>' + _buildSidebarItems(_state.activities);
    }
    // 뷰어 갱신
    var viewer = container.querySelector('.aws-activity-content');
    if (viewer) {
      var activity = _state.activities[idx] || null;
      viewer.innerHTML = _buildActivityHTML(activity, _state.backendOnline);
      _bindActivityEvents(viewer, activity, _state.backendOnline);
      // 진도 복원
      if (activity) _applyRestoredProgress(viewer, activity);
    }
  }

  /* ─────────────────────────────────────────────
     단일 과제 HTML (런타임규격 §6-1)
  ───────────────────────────────────────────── */
  function _buildActivityHTML(activity, backendOnline) {
    var front       = (activity && activity.front) || {};
    var back        = (activity && activity.back)  || {};
    var actId       = (activity && activity.activity_id) || '';
    var prompt      = front.prompt      || '(과제 없음)';
    var service     = front.service     || '';
    var task        = front.task        || '';
    var checkpoints = front.checkpoints || [];
    var cliHint     = front.cli_hint    || '';
    var solution    = back.solution     || '';
    var explanation = back.explanation  || '';

    var parts = [];

    parts.push('<div class="aws-wrap" data-activity-id="' + _esc(actId) + '">');

    // 서비스 배지 + 과제 제목
    parts.push('<div class="aws-header" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">');
    if (service) {
      parts.push('<span style="background:#ff9900;color:#fff;font-weight:700;font-size:0.78em;' +
        'padding:3px 10px;border-radius:4px;letter-spacing:0.03em;white-space:nowrap">' +
        _esc(service) + '</span>');
    }
    if (task) {
      parts.push('<span style="font-weight:600;font-size:1em;color:var(--ink,#111)">' +
        _esc(task) + '</span>');
    }
    parts.push('</div>');

    // 과제 설명
    parts.push('<div class="aws-prompt" style="' +
      'background:var(--surface2,#f6f8fa);border:1px solid var(--line2,#ddd);' +
      'border-radius:8px;padding:14px 16px;margin-bottom:16px;' +
      'font-size:0.95em;line-height:1.7;color:var(--ink,#111)">' +
      _esc(prompt) + '</div>');

    // 체크리스트
    if (checkpoints.length) {
      parts.push('<div style="margin-bottom:16px">');
      parts.push('<div style="font-size:0.82em;font-weight:700;color:var(--ink3,#666);' +
        'margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em">달성 단계</div>');
      parts.push('<ol style="margin:0;padding-left:20px;line-height:1.8;font-size:0.92em;color:var(--ink,#111)">');
      checkpoints.forEach(function (cp) {
        parts.push('<li style="margin-bottom:4px">' + _esc(cp) + '</li>');
      });
      parts.push('</ol></div>');
    }

    // CLI 힌트 (토글)
    if (cliHint) {
      parts.push('<div class="aws-hint-section" style="margin-bottom:16px">');
      parts.push('<button type="button" class="aws-hint-btn" style="' +
        'font-size:0.85em;padding:5px 12px;border-radius:6px;' +
        'border:1px solid var(--line2,#ddd);background:var(--surface,#fff);' +
        'color:var(--ink3,#555);cursor:pointer">힌트 보기</button>');
      parts.push('<pre class="aws-hint-body" hidden style="' +
        'margin-top:8px;background:#1e1e2e;color:#cdd6f4;' +
        'border-radius:8px;padding:12px 14px;font-size:0.83em;' +
        'white-space:pre-wrap;overflow-x:auto;line-height:1.5">' +
        _esc(cliHint) + '</pre>');
      parts.push('</div>');
    }

    // 검증 버튼
    var btnDisabled = backendOnline ? '' : ' disabled';
    var btnStyle =
      'padding:9px 24px;border-radius:8px;border:none;font-weight:700;font-size:0.95em;cursor:pointer;' +
      (backendOnline
        ? 'background:#ff9900;color:#fff;'
        : 'background:var(--line2,#ddd);color:var(--ink3,#999);cursor:not-allowed;');
    parts.push('<div style="margin-bottom:12px">');
    parts.push('<button type="button" class="aws-grade-btn"' + btnDisabled +
      ' style="' + btnStyle + '">검증</button>');
    parts.push('</div>');

    // 검증 결과
    parts.push('<div class="aws-result" style="min-height:28px;margin-bottom:16px"></div>');

    // 풀이 보기
    if (solution || explanation) {
      parts.push('<div class="aws-solution-section" style="margin-top:8px">');
      parts.push('<button type="button" class="aws-solution-btn" style="' +
        'font-size:0.85em;padding:5px 12px;border-radius:6px;' +
        'border:1px solid var(--line2,#ddd);background:var(--surface,#fff);' +
        'color:var(--ink3,#555);cursor:pointer">풀이 보기</button>');
      parts.push('<div class="aws-solution-body" hidden style="margin-top:10px">');
      if (solution) {
        parts.push('<pre style="background:#1e1e2e;color:#cdd6f4;border-radius:8px;' +
          'padding:12px 14px;font-size:0.83em;white-space:pre-wrap;overflow-x:auto;line-height:1.5">' +
          _esc(solution) + '</pre>');
      }
      if (explanation) {
        parts.push('<div style="margin-top:10px;padding:12px 14px;' +
          'background:var(--surface2,#f6f8fa);border:1px solid var(--line2,#ddd);' +
          'border-radius:8px;font-size:0.9em;line-height:1.7;color:var(--ink,#111)">' +
          _esc(explanation) + '</div>');
      }
      parts.push('</div></div>');
    }

    parts.push('</div>'); // .aws-wrap
    return parts.join('\n');
  }

  /* ─────────────────────────────────────────────
     이벤트 바인딩 (힌트·풀이·검증 버튼)
  ───────────────────────────────────────────── */
  function _bindActivityEvents(viewerEl, activity, backendOnline) {
    var hintBtn  = viewerEl.querySelector('.aws-hint-btn');
    var hintBody = viewerEl.querySelector('.aws-hint-body');
    if (hintBtn && hintBody) {
      hintBtn.addEventListener('click', function () {
        var hidden = hintBody.hasAttribute('hidden');
        if (hidden) { hintBody.removeAttribute('hidden'); hintBtn.textContent = '힌트 숨기기'; }
        else        { hintBody.setAttribute('hidden', ''); hintBtn.textContent = '힌트 보기'; }
      });
    }

    var solBtn  = viewerEl.querySelector('.aws-solution-btn');
    var solBody = viewerEl.querySelector('.aws-solution-body');
    if (solBtn && solBody) {
      solBtn.addEventListener('click', function () {
        var hidden = solBody.hasAttribute('hidden');
        if (hidden) { solBody.removeAttribute('hidden'); solBtn.textContent = '풀이 숨기기'; }
        else        { solBody.setAttribute('hidden', ''); solBtn.textContent = '풀이 보기'; }
      });
    }

    var gradeBtn = viewerEl.querySelector('.aws-grade-btn');
    var resultEl = viewerEl.querySelector('.aws-result');
    if (gradeBtn) {
      if (!backendOnline) {
        gradeBtn.disabled = true;
        gradeBtn.title = '백엔드 연결 필요';
      } else {
        gradeBtn.addEventListener('click', function () {
          if (!activity) {
            _showResult(resultEl, null, '과제가 로드되지 않았습니다.');
            return;
          }
          gradeBtn.disabled = true;
          _showResult(resultEl, null, '검증 중...');

          score({ activity_id: activity.activity_id }).then(function (result) {
            gradeBtn.disabled = false;
            _showResult(resultEl, result, null);
            // 사이드바 아이콘 갱신
            _refreshSidebarItem(activity.activity_id);
            if (_state.ctx) {
              _state.ctx.emit({ type: 'activity-completed', result: result });
            }
          }).catch(function (e) {
            gradeBtn.disabled = false;
            _showResult(resultEl, null, '검증 오류: ' + e.message);
          });
        });
      }
    }
  }

  /** 채점 후 사이드바의 해당 항목 아이콘만 갱신 */
  function _refreshSidebarItem(activityId) {
    if (!_state.host) return;
    var sidebar = _state.host.querySelector('.aws-sidebar');
    if (!sidebar) return;
    var snap = _state.progress;
    _state.activities.forEach(function (act, idx) {
      if (act.activity_id !== activityId) return;
      var item = sidebar.querySelector('[data-act-idx="' + idx + '"]');
      if (!item) return;
      var verdict = (snap && snap.activities && snap.activities[activityId])
        ? snap.activities[activityId].last_verdict
        : null;
      var icon;
      if (verdict === 'correct')        icon = '<span style="color:var(--ok,#22863a);margin-right:4px">✓</span>';
      else if (verdict === 'incorrect') icon = '<span style="color:var(--hot,#d73a49);margin-right:4px">✗</span>';
      else                              icon = '<span style="color:var(--ink3,#bbb);margin-right:4px">○</span>';
      // 아이콘(첫 child)만 교체
      var firstChild = item.firstChild;
      if (firstChild) {
        var tmp = document.createElement('span');
        tmp.innerHTML = icon;
        item.replaceChild(tmp.firstChild, firstChild);
      }
    });
  }

  /* ─────────────────────────────────────────────
     검증 결과 렌더
  ───────────────────────────────────────────── */
  function _showResult(el, result, message) {
    if (!el) return;
    if (message) {
      el.innerHTML = '<span style="color:var(--ink3,#666);font-size:0.9em">' + _esc(message) + '</span>';
      return;
    }
    if (!result) return;

    var fb = result.feedback || {};
    if (result.verdict === 'pending') {
      el.innerHTML =
        '<div style="color:var(--ink3,#888);font-size:0.9em;padding:8px 0">' +
        'pending — ' + _esc(fb.error || 'backend-unreachable') + '</div>';
      return;
    }

    var isCorrect    = result.verdict === 'correct';
    var verdictColor = isCorrect ? 'var(--ok,#22863a)' : 'var(--hot,#d73a49)';
    var verdictLabel = isCorrect ? '통과' : '미통과';

    var html = '<div style="margin-top:4px">' +
      '<strong style="color:' + verdictColor + '">' + verdictLabel + '</strong>' +
      ' <span style="color:var(--ink3,#666);font-size:0.88em">(' +
      (fb.passed != null ? fb.passed : '?') + ' / ' + (fb.total != null ? fb.total : '?') + ' 체크 통과)</span>';

    if (fb.error) {
      html += '<div style="color:var(--hot,#d73a49);font-size:0.85em;margin-top:4px">오류: ' + _esc(fb.error) + '</div>';
    }

    var details = fb.details || [];
    if (details.length) {
      html += '<ul style="margin:8px 0 0 0;padding-left:18px;font-size:0.85em;line-height:1.7">';
      details.forEach(function (d) {
        var icon  = d.ok ? '✓' : '✗';
        var color = d.ok ? 'var(--ok,#22863a)' : 'var(--hot,#d73a49)';
        html += '<li style="color:' + color + '">' +
          '<strong>' + icon + '</strong> ' + _esc(d.message || (d.service + ':' + d.identifier)) +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    el.innerHTML = html;
  }

  /* ─────────────────────────────────────────────
     진도 캐시 업데이트
  ───────────────────────────────────────────── */
  function _updateProgress(activityId, result) {
    var snap = getProgressSnapshot();
    if (!snap.activities[activityId]) {
      snap.activities[activityId] = {
        cold_attempts: 0,
        cold_correct:  0,
        last_verdict:  null,
        plugin_extra:  { last_check_details: null }
      };
    }
    var entry = snap.activities[activityId];
    entry.cold_attempts++;
    if (result.verdict === 'correct') entry.cold_correct++;
    entry.last_verdict = result.verdict;
    entry.plugin_extra = {
      last_check_details: (result.feedback && result.feedback.details) || null
    };
    _state.progress = snap;
    _saveProgress(snap);
  }

  /* ─────────────────────────────────────────────
     진도 복원 UI 반영
  ───────────────────────────────────────────── */
  function _applyRestoredProgress(viewerEl, activity) {
    if (!_state.progress || !activity) return;
    var saved = _state.progress.activities && _state.progress.activities[activity.activity_id];
    if (!saved) return;
    var resultEl = viewerEl.querySelector('.aws-result');
    if (resultEl && saved.last_verdict && saved.last_verdict !== 'pending') {
      var details = (saved.plugin_extra && saved.plugin_extra.last_check_details) || [];
      _showResult(resultEl, {
        verdict:   saved.last_verdict,
        score_raw: saved.cold_attempts > 0 ? saved.cold_correct / saved.cold_attempts : 0,
        grader_id: 'external',
        feedback:  {
          passed:  details.filter(function (d) { return d.ok; }).length,
          total:   details.length,
          details: details
        }
      }, null);
    }
  }

  /* ─────────────────────────────────────────────
     HTML 이스케이프
  ───────────────────────────────────────────── */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ═══════════════════════════════════════════════
     PluginInstance 인터페이스 구현 (플러그인계약 §3)
  ═══════════════════════════════════════════════ */

  /* ─────────────────────────────────────────────
     mount(container, ctx) — 라이프사이클 시작
  ───────────────────────────────────────────── */
  function mount(container, ctx) {
    if (_state.mounted) unmount();

    _state.host       = container;
    _state.ctx        = ctx;
    _state.mounted    = true;
    _state.currentIdx = 0;

    // activities 취득 (window.ACTIVITIES['aws'])
    _state.activities = (window.ACTIVITIES && window.ACTIVITIES['aws']) || [];

    var entryUrl = _getEntryUrl();

    _healthCheck(entryUrl,
      function onOnline() {
        _state.backendOnline = true;
        _buildLayout(container, true, null);
        _navigateTo(container, _state.currentIdx);
      },
      function onOffline(reason) {
        _state.backendOnline = false;
        _buildLayout(container, false, reason);
        _navigateTo(container, _state.currentIdx);
      }
    );

    return Promise.resolve();
  }

  /* ─────────────────────────────────────────────
     unmount()
  ───────────────────────────────────────────── */
  function unmount() {
    if (_state.host) _state.host.innerHTML = '';
    _state.mounted       = false;
    _state.host          = null;
    _state.ctx           = null;
    _state.activities    = [];
    _state.backendOnline = false;
  }

  /* ─────────────────────────────────────────────
     score(userAnswer) — 채점 (플러그인계약 §3)
     런타임규격 §6-2
  ───────────────────────────────────────────── */
  function score(userAnswer) {
    // 현재 표시 과제 또는 userAnswer.activity_id로 찾기
    var activity = null;
    if (userAnswer && userAnswer.activity_id) {
      activity = _findActivity(userAnswer.activity_id);
    }
    if (!activity) activity = _state.activities[_state.currentIdx] || null;

    if (!_state.backendOnline) {
      return Promise.resolve({
        verdict:   'pending',
        score_raw: 0,
        grader_id: 'external',
        feedback:  { error: 'backend-unreachable', passed: 0, total: 0, details: [] }
      });
    }

    if (!activity) {
      return Promise.resolve({
        verdict:   'pending',
        score_raw: 0,
        grader_id: 'external',
        feedback:  { error: '과제 없음', passed: 0, total: 0, details: [] }
      });
    }

    var activityId = activity.activity_id;
    var checks     = (activity.grading && activity.grading.checks) || [];
    var entryUrl   = _getEntryUrl();

    return new Promise(function (resolve) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', entryUrl + '/grade', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 15000;

        xhr.onload = function () {
          var result;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var resp  = JSON.parse(xhr.responseText || '{}');
              var passed  = resp.passed || 0;
              var total   = resp.total  || checks.length;
              var details = resp.details || [];
              result = {
                verdict:   passed === total && total > 0 ? 'correct' : 'incorrect',
                score_raw: total > 0 ? passed / total : 0,
                grader_id: 'external',
                feedback:  { passed: passed, total: total, details: details }
              };
            } catch (e) {
              result = _pendingResult('grade 응답 파싱 실패: ' + e.message);
            }
          } else {
            result = _pendingResult('grade HTTP ' + xhr.status);
          }
          _updateProgress(activityId, result);
          if (_state.ctx) {
            _state.ctx.emit({ type: 'activity-completed', result: result });
          }
          resolve(result);
        };

        xhr.ontimeout = function () { resolve(_pendingResult('grade 요청 타임아웃')); };
        xhr.onerror   = function () { resolve(_pendingResult('네트워크 오류 — 백엔드 연결 끊김')); };
        xhr.send(JSON.stringify({ activity_id: activityId, checks: checks }));
      } catch (e) {
        resolve(_pendingResult(e.message || '요청 실패'));
      }
    });
  }

  function _pendingResult(errorMsg) {
    return {
      verdict:   'pending',
      score_raw: 0,
      grader_id: 'external',
      feedback:  { error: errorMsg, passed: 0, total: 0, details: [] }
    };
  }

  /* ─────────────────────────────────────────────
     getProgressSnapshot() — 런타임규격 §6-3
  ───────────────────────────────────────────── */
  function getProgressSnapshot() {
    if (!_state.progress) {
      _state.progress = {
        plugin_id:      'aws',
        schema_version: 1,
        activities:     {}
      };
    }
    return _state.progress;
  }

  /* ─────────────────────────────────────────────
     onProgressRestored(snapshot) — 플러그인계약 §3
  ───────────────────────────────────────────── */
  function onProgressRestored(snapshot) {
    if (!snapshot) return;
    _state.progress = snapshot;
    _state.restored = true;

    if (_state.mounted && _state.host) {
      // 사이드바 아이콘 전체 갱신
      var sidebar = _state.host.querySelector('.aws-sidebar');
      if (sidebar) {
        sidebar.innerHTML =
          '<div style="font-size:0.78em;font-weight:700;color:var(--ink3,#888);' +
          'padding:0 12px 8px;text-transform:uppercase;letter-spacing:0.05em">' +
          '과제 목록 (' + _state.activities.length + ')' +
          '</div>' + _buildSidebarItems(_state.activities);
      }
      // 현재 뷰어 진도 반영
      var viewer = _state.host.querySelector('.aws-activity-content');
      if (viewer && _state.activities[_state.currentIdx]) {
        _applyRestoredProgress(viewer, _state.activities[_state.currentIdx]);
      }
    }
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() — 플러그인계약 §3
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    var snap   = getProgressSnapshot();
    var acts   = snap.activities || {};
    var actIds = Object.keys(acts);
    if (!actIds.length) return null;

    var areaMap = {};
    actIds.forEach(function (id) {
      var a        = acts[id];
      var activity = _findActivity(id);
      if (!activity) return;
      var key = activity.tags.area + '||' + activity.tags.subarea;
      if (!areaMap[key]) {
        areaMap[key] = { area: activity.tags.area, subarea: activity.tags.subarea, correct: 0, total: 0 };
      }
      areaMap[key].total++;
      if (a.last_verdict === 'correct') areaMap[key].correct++;
    });

    var byArea = Object.keys(areaMap).map(function (k) {
      var r = areaMap[k];
      return { area: r.area, subarea: r.subarea, retrieval_rate: r.total ? r.correct / r.total : null };
    });

    var weakness = [];
    actIds.forEach(function (id) {
      var a = acts[id];
      if (!a.cold_attempts) return;
      var activity = _findActivity(id);
      if (!activity) return;
      var rate = (a.cold_attempts - a.cold_correct) / a.cold_attempts;
      if (rate > 0) weakness.push({ area: activity.tags.area, subarea: activity.tags.subarea, unit: activity.tags.unit, wrong_rate: rate });
    });
    weakness.sort(function (a, b) { return b.wrong_rate - a.wrong_rate; });

    var completion = byArea.map(function (r) {
      return { area: r.area, subarea: r.subarea, mastery_rate: r.retrieval_rate != null ? r.retrieval_rate : 0, box_dist: { box1: 0, box2: 0, box3: 0 } };
    });

    return {
      plugin_id:    'aws',
      by_area:      byArea,
      weakness:     weakness,
      pass_path:    [],
      completion:   completion,
      extra_widgets: []
    };
  }

  /* ─────────────────────────────────────────────
     내부 헬퍼
  ───────────────────────────────────────────── */
  function _findActivity(activityId) {
    var list = _state.activities;
    for (var i = 0; i < list.length; i++) {
      if (list[i].activity_id === activityId) return list[i];
    }
    return null;
  }

  /* ─────────────────────────────────────────────
     PluginInstance 객체 조립
  ───────────────────────────────────────────── */
  var _instance = {
    mount:               mount,
    unmount:             unmount,
    score:               score,
    getProgressSnapshot: getProgressSnapshot,
    onProgressRestored:  onProgressRestored,
    getDashboardContrib: getDashboardContrib
  };

  window._AWS_PLUGIN = _instance;

})();
