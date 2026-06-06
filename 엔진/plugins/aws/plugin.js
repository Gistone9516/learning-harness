/**
 * aws / plugin.js — PluginInstance 구현
 * 플러그인계약 §3 PluginInstance 전부 구현
 * aws 런타임규격 §6~§7 conform
 * ────────────────────────────────────────────────────────────
 * 동작 방식:
 *   - 과제 제시(prompt·service·checkpoints·cli_hint) + "검증" 버튼
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
    // 사용자가 localStorage로 오버라이드 가능: clf:keys:aws-entry-url
    try {
      var override = localStorage.getItem('clf:keys:aws-entry-url');
      if (override && override.trim()) return override.trim();
    } catch (e) {}
    // manifest 기본값
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
    mounted:       false,
    host:          null,     // HTMLElement — #plugin-host
    ctx:           null,     // PluginContext
    activity:      null,     // 현재 ActivitySpec (cloud-task)
    backendOnline: false,    // 헬스체크 결과
    progress:      null,     // PluginProgressSnapshot 메모리 캐시
    restored:      false     // onProgressRestored 호출 여부
  };

  /* ─────────────────────────────────────────────
     헬스체크 (런타임규격 §3-3, §5)
     GET entry_url/health, 3s 타임아웃
     → onOnline() or onOffline(reason)
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
          // status 필드 없어도 2xx면 온라인으로 처리
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
     mount() — 정상 UI 렌더링 (런타임규격 §6-1)
  ───────────────────────────────────────────── */
  function _mountOnline(container, activity) {
    container.innerHTML = _buildHTML(activity, true);
    _bindMountEvents(container, activity, true);
  }

  /* ─────────────────────────────────────────────
     mountOfflineFallback (런타임규격 §5)
     콘텐츠 열람 유지, 검증 버튼 비활성
  ───────────────────────────────────────────── */
  function _mountOfflineFallback(container, activity, reason) {
    container.innerHTML = _buildHTML(activity, false);
    // 오프라인 안내 배너 삽입
    var wrap = container.querySelector('.aws-wrap');
    if (wrap) {
      var banner = document.createElement('div');
      banner.className = 'aws-offline-banner';
      banner.style.cssText =
        'background:#fff8e1;border:1px solid #ffe082;border-radius:8px;' +
        'padding:14px 16px;margin-bottom:16px;font-size:0.9em;line-height:1.6;color:#5f4b00';
      banner.innerHTML =
        '<strong>AWS 백엔드(grade.py)에 연결할 수 없습니다.</strong><br>' +
        '(' + _esc(reason) + ')<br><br>' +
        'LocalStack Docker 또는 실제 AWS 백엔드를 시작한 후 새로고침하세요.<br>' +
        '<code style="display:block;margin-top:6px;background:#fffde7;padding:6px 8px;border-radius:4px;font-size:0.85em">' +
        '# LocalStack<br>' +
        'docker run --rm -p 4566:4566 localstack/localstack<br><br>' +
        '# grade.py (기본 포트 5001)<br>' +
        'python grade.py' +
        '</code>';
      wrap.insertBefore(banner, wrap.firstChild);
    }
    _bindMountEvents(container, activity, false);
  }

  /* ─────────────────────────────────────────────
     이벤트 바인딩 (힌트 토글·풀이 토글·검증 버튼)
  ───────────────────────────────────────────── */
  function _bindMountEvents(container, activity, backendOnline) {
    // 힌트 보기 토글
    var hintBtn = container.querySelector('.aws-hint-btn');
    var hintBody = container.querySelector('.aws-hint-body');
    if (hintBtn && hintBody) {
      hintBtn.addEventListener('click', function () {
        var hidden = hintBody.hasAttribute('hidden');
        if (hidden) {
          hintBody.removeAttribute('hidden');
          hintBtn.textContent = '힌트 숨기기';
        } else {
          hintBody.setAttribute('hidden', '');
          hintBtn.textContent = '힌트 보기';
        }
      });
    }

    // 풀이 보기 토글
    var solBtn = container.querySelector('.aws-solution-btn');
    var solBody = container.querySelector('.aws-solution-body');
    if (solBtn && solBody) {
      solBtn.addEventListener('click', function () {
        var hidden = solBody.hasAttribute('hidden');
        if (hidden) {
          solBody.removeAttribute('hidden');
          solBtn.textContent = '풀이 숨기기';
        } else {
          solBody.setAttribute('hidden', '');
          solBtn.textContent = '풀이 보기';
        }
      });
    }

    // 검증 버튼
    var gradeBtn = container.querySelector('.aws-grade-btn');
    var resultEl = container.querySelector('.aws-result');
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
            // 진도 자동 저장 (emit → shell이 getProgressSnapshot 호출)
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

  /* ─────────────────────────────────────────────
     HTML 골격 생성 (런타임규격 §6-1)
  ───────────────────────────────────────────── */
  function _buildHTML(activity, backendOnline) {
    var front        = (activity && activity.front) || {};
    var back         = (activity && activity.back) || {};
    var actId        = (activity && activity.activity_id) || '';
    var prompt       = front.prompt       || '(과제 없음)';
    var service      = front.service      || '';
    var task         = front.task         || '';
    var checkpoints  = front.checkpoints  || [];
    var cliHint      = front.cli_hint     || '';
    var solution     = back.solution      || '';
    var explanation  = back.explanation   || '';

    var parts = [];

    parts.push('<div class="aws-wrap" data-activity-id="' + _esc(actId) + '">');

    /* 서비스 배지 + 과제 제목 */
    parts.push('<div class="aws-header" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">');
    if (service) {
      parts.push('<span class="aws-service-badge" style="' +
        'background:#ff9900;color:#fff;font-weight:700;font-size:0.78em;' +
        'padding:3px 10px;border-radius:4px;letter-spacing:0.03em;white-space:nowrap">' +
        _esc(service) + '</span>');
    }
    if (task) {
      parts.push('<span class="aws-task-label" style="font-weight:600;font-size:1em;color:var(--ink,#111)">' +
        _esc(task) + '</span>');
    }
    parts.push('</div>');

    /* 과제 설명 */
    parts.push('<div class="aws-prompt" style="' +
      'background:var(--surface2,#f6f8fa);border:1px solid var(--line2,#ddd);' +
      'border-radius:8px;padding:14px 16px;margin-bottom:16px;' +
      'font-size:0.95em;line-height:1.7;color:var(--ink,#111)">' +
      _esc(prompt) +
      '</div>');

    /* 체크리스트 (학습자 진행 트래킹 — 채점과 무관) */
    if (checkpoints.length) {
      parts.push('<div class="aws-checkpoints" style="margin-bottom:16px">');
      parts.push('<div style="font-size:0.85em;font-weight:600;color:var(--ink3,#666);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em">달성 단계</div>');
      parts.push('<ol style="margin:0;padding-left:20px;line-height:1.8;font-size:0.92em;color:var(--ink,#111)">');
      checkpoints.forEach(function (cp) {
        parts.push('<li style="margin-bottom:4px">' + _esc(cp) + '</li>');
      });
      parts.push('</ol>');
      parts.push('</div>');
    }

    /* CLI 힌트 (토글) */
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

    /* 검증 버튼 */
    var btnDisabledAttr = backendOnline ? '' : ' disabled';
    var btnStyle =
      'padding:9px 24px;border-radius:8px;border:none;font-weight:700;font-size:0.95em;cursor:pointer;' +
      (backendOnline
        ? 'background:#ff9900;color:#fff;'
        : 'background:var(--line2,#ddd);color:var(--ink3,#999);cursor:not-allowed;');
    parts.push('<div class="aws-actions" style="margin-bottom:12px">');
    parts.push('<button type="button" class="aws-grade-btn"' + btnDisabledAttr +
      ' style="' + btnStyle + '">검증</button>');
    parts.push('</div>');

    /* 검증 결과 */
    parts.push('<div class="aws-result" style="min-height:28px;margin-bottom:16px"></div>');

    /* 풀이 보기 (back.solution / back.explanation) */
    if (solution || explanation) {
      parts.push('<div class="aws-solution-section" style="margin-top:8px">');
      parts.push('<button type="button" class="aws-solution-btn" style="' +
        'font-size:0.85em;padding:5px 12px;border-radius:6px;' +
        'border:1px solid var(--line2,#ddd);background:var(--surface,#fff);' +
        'color:var(--ink3,#555);cursor:pointer">풀이 보기</button>');
      parts.push('<div class="aws-solution-body" hidden style="margin-top:10px">');
      if (solution) {
        parts.push('<pre style="' +
          'background:#1e1e2e;color:#cdd6f4;border-radius:8px;' +
          'padding:12px 14px;font-size:0.83em;white-space:pre-wrap;overflow-x:auto;line-height:1.5">' +
          _esc(solution) + '</pre>');
      }
      if (explanation) {
        parts.push('<div style="' +
          'margin-top:10px;padding:12px 14px;background:var(--surface2,#f6f8fa);' +
          'border:1px solid var(--line2,#ddd);border-radius:8px;' +
          'font-size:0.9em;line-height:1.7;color:var(--ink,#111)">' +
          _esc(explanation) + '</div>');
      }
      parts.push('</div>'); // .aws-solution-body
      parts.push('</div>'); // .aws-solution-section
    }

    parts.push('</div>'); // .aws-wrap
    return parts.join('\n');
  }

  /* ─────────────────────────────────────────────
     검증 결과 렌더 (채점 결과 표시)
  ───────────────────────────────────────────── */
  function _showResult(el, result, message) {
    if (!el) return;
    if (message) {
      el.innerHTML = '<span style="color:var(--ink3,#666);font-size:0.9em">' + _esc(message) + '</span>';
      return;
    }
    if (!result) return;

    var fb = result.feedback || {};
    var isPending = result.verdict === 'pending';

    if (isPending) {
      el.innerHTML =
        '<div style="color:var(--ink3,#888);font-size:0.9em;padding:8px 0">' +
        'pending — ' + _esc(fb.error || 'backend-unreachable') + '</div>';
      return;
    }

    var isCorrect = result.verdict === 'correct';
    var verdictColor = isCorrect ? 'var(--ok,#22863a)' : 'var(--hot,#d73a49)';
    var verdictLabel = isCorrect ? '통과' : '미통과';

    var html = '<div style="margin-top:4px">' +
      '<strong style="color:' + verdictColor + '">' + verdictLabel + '</strong>' +
      ' <span style="color:var(--ink3,#666);font-size:0.88em">(' +
      (fb.passed != null ? fb.passed : '?') + ' / ' + (fb.total != null ? fb.total : '?') + ' 체크 통과)</span>';

    if (fb.error) {
      html += '<div style="color:var(--hot,#d73a49);font-size:0.85em;margin-top:4px">오류: ' + _esc(fb.error) + '</div>';
    }

    // 개별 check 결과
    var details = fb.details || [];
    if (details.length) {
      html += '<ul style="margin:8px 0 0 0;padding-left:18px;font-size:0.85em;line-height:1.7">';
      details.forEach(function (d) {
        var icon = d.ok ? '✓' : '✗';
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
        cold_attempts:    0,
        cold_correct:     0,
        last_verdict:     null,
        plugin_extra:     { last_check_details: null }
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
     런타임규격 §6-1
  ───────────────────────────────────────────── */
  function mount(container, ctx) {
    if (_state.mounted) unmount();

    _state.host     = container;
    _state.ctx      = ctx;
    _state.mounted  = true;

    // activities 취득 (window.ACTIVITIES['aws'])
    var activities = (window.ACTIVITIES && window.ACTIVITIES['aws']) || [];
    _state.activity = activities[0] || null;

    var entryUrl = _getEntryUrl();

    // 헬스체크 → 결과에 따라 정상 or fallback 렌더
    _healthCheck(entryUrl,
      function onOnline() {
        _state.backendOnline = true;
        _mountOnline(container, _state.activity);
        // 진도 복원 반영 (onProgressRestored가 mount 전 호출된 경우)
        if (_state.restored) {
          _applyRestoredProgress(container);
        }
      },
      function onOffline(reason) {
        _state.backendOnline = false;
        _mountOfflineFallback(container, _state.activity, reason);
        if (_state.restored) {
          _applyRestoredProgress(container);
        }
      }
    );

    return Promise.resolve();
  }

  /** 진도 복원 시 마지막 체크 결과 UI 반영 */
  function _applyRestoredProgress(container) {
    if (!_state.progress || !_state.activity) return;
    var actId = _state.activity.activity_id;
    var saved = _state.progress.activities && _state.progress.activities[actId];
    if (!saved) return;

    var resultEl = container.querySelector('.aws-result');
    if (resultEl && saved.last_verdict && saved.last_verdict !== 'pending') {
      var details = (saved.plugin_extra && saved.plugin_extra.last_check_details) || [];
      var fakeResult = {
        verdict:   saved.last_verdict,
        score_raw: saved.cold_attempts > 0 ? saved.cold_correct / saved.cold_attempts : 0,
        grader_id: 'external',
        feedback:  {
          passed:  details.filter(function (d) { return d.ok; }).length,
          total:   details.length,
          details: details
        }
      };
      _showResult(resultEl, fakeResult, null);
    }
  }

  /* ─────────────────────────────────────────────
     unmount()
  ───────────────────────────────────────────── */
  function unmount() {
    if (_state.host) _state.host.innerHTML = '';
    _state.mounted       = false;
    _state.host          = null;
    _state.ctx           = null;
    _state.activity      = null;
    _state.backendOnline = false;
  }

  /* ─────────────────────────────────────────────
     score(userAnswer) — 채점 (플러그인계약 §3)
     런타임규격 §6-2
     userAnswer: { activity_id: string }  (사용자 입력 없음 — 리소스 상태가 정답)
     반환: Promise<ScoreResult>
  ───────────────────────────────────────────── */
  function score(userAnswer) {
    var activity = _state.activity;

    // 백엔드 미연결 → pending 즉시 반환 (런타임규격 §5 §6-2)
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

    var activityId = (userAnswer && userAnswer.activity_id) || activity.activity_id;
    var checks     = (activity.grading && activity.grading.checks) || [];
    var entryUrl   = _getEntryUrl();

    return new Promise(function (resolve) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', entryUrl + '/grade', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 15000; // 15초 타임아웃 (boto3 API 호출 포함)

        xhr.onload = function () {
          var result;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              var resp = JSON.parse(xhr.responseText || '{}');
              // grade.py 응답 → ScoreResult 변환 (런타임규격 §4)
              var passed = resp.passed || 0;
              var total  = resp.total  || checks.length;
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
          // emit activity-completed (런타임규격 §6-2)
          if (_state.ctx) {
            _state.ctx.emit({ type: 'activity-completed', result: result });
          }
          resolve(result);
        };

        xhr.ontimeout = function () {
          var r = _pendingResult('grade 요청 타임아웃');
          resolve(r);
        };
        xhr.onerror = function () {
          var r = _pendingResult('네트워크 오류 — 백엔드 연결 끊김');
          resolve(r);
        };

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

    // 이미 마운트된 상태에서 복원 호출된 경우 UI 갱신
    if (_state.mounted && _state.host) {
      _applyRestoredProgress(_state.host);
    }
  }

  /* ─────────────────────────────────────────────
     getDashboardContrib() — 플러그인계약 §3 선택구현
     null 반환 시 셸 기본집계 사용
  ───────────────────────────────────────────── */
  function getDashboardContrib() {
    var snap = getProgressSnapshot();
    var acts = snap.activities || {};
    var actIds = Object.keys(acts);
    if (!actIds.length) return null;

    var areaMap = {};
    actIds.forEach(function (id) {
      var a = acts[id];
      var activity = _findActivity(id);
      if (!activity) return;
      var key = activity.tags.area + '||' + activity.tags.subarea;
      if (!areaMap[key]) {
        areaMap[key] = {
          area:    activity.tags.area,
          subarea: activity.tags.subarea,
          correct: 0,
          total:   0
        };
      }
      areaMap[key].total++;
      if (a.last_verdict === 'correct') areaMap[key].correct++;
    });

    var byArea = Object.keys(areaMap).map(function (k) {
      var r = areaMap[k];
      return {
        area:           r.area,
        subarea:        r.subarea,
        retrieval_rate: r.total ? r.correct / r.total : null
      };
    });

    var weakness = [];
    actIds.forEach(function (id) {
      var a = acts[id];
      if (!a.cold_attempts) return;
      var activity = _findActivity(id);
      if (!activity) return;
      var rate = (a.cold_attempts - a.cold_correct) / a.cold_attempts;
      if (rate > 0) {
        weakness.push({
          area:       activity.tags.area,
          subarea:    activity.tags.subarea,
          unit:       activity.tags.unit,
          wrong_rate: rate
        });
      }
    });
    weakness.sort(function (a, b) { return b.wrong_rate - a.wrong_rate; });

    var completion = byArea.map(function (r) {
      return {
        area:         r.area,
        subarea:      r.subarea,
        mastery_rate: r.retrieval_rate != null ? r.retrieval_rate : 0,
        box_dist:     { box1: 0, box2: 0, box3: 0 } // Leitner 없음
      };
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
    var list = (window.ACTIVITIES && window.ACTIVITIES['aws']) || [];
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

  /* ─────────────────────────────────────────────
     shell.js 등록 규칙 준수 (_registerPlugins 참조)
     plugin_id = "aws"
     globalKey  = "_AWS_PLUGIN"
     directKey  = "_AWS_PLUGIN"  (동일)
  ───────────────────────────────────────────── */
  window._AWS_PLUGIN = _instance;

})();
