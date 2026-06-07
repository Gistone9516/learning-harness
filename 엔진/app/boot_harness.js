/**
 * boot_harness.js — 플러그인 부트·등록 검증기 (Node.js, 브라우저 없이)
 * 플러그인계약 §7 부트순서 + window.PLUGIN_REGISTRY 등록 검증.
 *
 * 실행: node boot_harness.js
 */

'use strict';

const path = require('path');
const fs   = require('fs');

/* ═══════════════════════════════════════════════════════
   1. 최소 브라우저 Mock (global.window / document / localStorage)
═══════════════════════════════════════════════════════ */

// localStorage mock
const _lsStore = {};
const localStorageMock = {
  getItem:    (k)      => Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null,
  setItem:    (k, v)   => { _lsStore[k] = String(v); },
  removeItem: (k)      => { delete _lsStore[k]; },
  key:        (i)      => Object.keys(_lsStore)[i] || null,
  get length() { return Object.keys(_lsStore).length; }
};

// 최소 document mock
const _eventListeners = {};
const documentMock = {
  getElementById:      () => null,
  querySelector:       () => null,
  querySelectorAll:    () => [],
  createElement:       (tag) => ({
    tag, style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    addEventListener(){}, appendChild(){}, insertBefore(){},
    children: [], firstChild: null,
    get innerHTML(){ return ''; }, set innerHTML(v){},
    get textContent(){ return ''; }, set textContent(v){},
  }),
  createTextNode:      (t) => ({ nodeType: 3, textContent: t }),
  body: {
    setAttribute(){}, getAttribute(){ return null; },
    appendChild(){}, prepend(){},
    style: {}
  },
  title: '',
  head: { appendChild(){} },
  addEventListener(ev, fn){ (_eventListeners[ev] = _eventListeners[ev] || []).push(fn); },
  removeEventListener(){}
};

// window mock
global.window = {
  PLUGIN_REGISTRY: {},
  MANIFEST: null,
  ACTIVITIES: {},
  DECKS: {},
  SYNONYMS: {},
  SHELL: undefined,
  // CDN 전역 스텁 (브라우저 기능, 등록 단계엔 불필요)
  marked: undefined,
  renderMathInElement: undefined,
  CodeMirror: undefined,
  loadPyodide: undefined,
  // 이벤트 리스너
  addEventListener(ev, fn){ (_eventListeners['w_'+ev] = _eventListeners['w_'+ev] || []).push(fn); },
  removeEventListener(){},
  scrollTo(){},
  location: { hash: '', get hash(){ return ''; }, set hash(v){} },
  innerWidth: 1280,
};
global.document        = documentMock;
global.localStorage    = localStorageMock;
global.console         = console; // 실제 console 유지

// window 속성 get/set이 global에서도 동작하도록 Proxy (플러그인이 window.X = ... 할 때)
// 단순 패스스루: global에 직접 write하는 코드 대비
const _win = global.window;
// 플러그인이 window.MANIFEST_EXCEL = ... 처럼 쓰면 window 객체에 직접 가므로 OK.

/* ═══════════════════════════════════════════════════════
   2. 파일 경로 정의
═══════════════════════════════════════════════════════ */
const BASE = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(BASE, '..', '..', '과목', '컴활1급', '생성물');

const FILES = {
  // 생성물 (없으면 mock)
  synonyms:  path.join(GENERATED_DIR, 'synonyms.js'),
  manifest:  path.join(GENERATED_DIR, 'manifest.js'),
  decks:     path.join(GENERATED_DIR, 'decks', 'ss_unit1.js'),

  // 플러그인계약 §7 부트순서: 플러그인(manifest+plugin) → shell.js
  cq_manifest:  path.join(BASE, 'plugins', 'card-quiz',  'manifest.js'),
  cq_plugin:    path.join(BASE, 'plugins', 'card-quiz',  'plugin.js'),
  cod_manifest: path.join(BASE, 'plugins', 'coding',     'manifest.js'),
  cod_plugin:   path.join(BASE, 'plugins', 'coding',     'plugin.js'),
  xls_manifest: path.join(BASE, 'plugins', 'excel',      'manifest.js'),
  xls_plugin:   path.join(BASE, 'plugins', 'excel',      'plugin.js'),
  eng_manifest: path.join(BASE, 'plugins', 'english',    'manifest.js'),
  eng_plugin:   path.join(BASE, 'plugins', 'english',    'plugin.js'),
  aws_manifest: path.join(BASE, 'plugins', 'aws',        'manifest.js'),
  aws_plugin:   path.join(BASE, 'plugins', 'aws',        'plugin.js'),
  shell:        path.join(BASE, 'app', 'shell.js'),
};

/* ═══════════════════════════════════════════════════════
   3. 안전 eval 헬퍼
═══════════════════════════════════════════════════════ */
function safeEval(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.warn('[HARNESS] 파일 없음 (스킵):', label, filePath);
    return { ok: false, missing: true };
  }
  let code = fs.readFileSync(filePath, 'utf8');

  // ── mock 패치 1: new Blob([...], {...}) — Node에 없음
  if (typeof global.Blob === 'undefined') {
    global.Blob = function(parts, opts) { this._parts = parts; this.type = (opts||{}).type||''; };
  }
  // ── mock 패치 2: URL.createObjectURL / revokeObjectURL
  if (typeof global.URL === 'undefined') global.URL = {};
  if (!global.URL.createObjectURL) global.URL.createObjectURL = () => 'blob:mock';
  if (!global.URL.revokeObjectURL) global.URL.revokeObjectURL = () => {};
  // ── mock 패치 3: XMLHttpRequest (aws/english health check — 등록 후 호출이므로 여기선 stub만)
  if (typeof global.XMLHttpRequest === 'undefined') {
    global.XMLHttpRequest = function() {
      this.open = () => {}; this.send = () => {}; this.onload = null; this.onerror = null; this.status = 0;
    };
  }
  // ── mock 패치 4: Set (coding unit-filter — Node엔 있음, 확인용)
  // Node 기본 Set OK.

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('require', 'module', 'exports', code);
    const modObj = { exports: {} };
    fn(require, modObj, modObj.exports);
    return { ok: true };
  } catch (e) {
    console.error('[HARNESS] eval 실패:', label, '\n  ', e.message);
    return { ok: false, error: e.message };
  }
}

/* ═══════════════════════════════════════════════════════
   4. 생성물 mock (없을 때 MANIFEST / SYNONYMS 최소 초기화)
═══════════════════════════════════════════════════════ */
function ensureGeneratedMocks() {
  // window.MANIFEST가 없으면 최소 mock 생성
  if (!global.window.MANIFEST) {
    global.window.MANIFEST = {
      comp1: {
        subject_label: '컴활1급 (mock)',
        areas: [],
        decks: [],
        plugins: []
      }
    };
    console.log('[HARNESS] window.MANIFEST — 생성물 없음, mock 주입');
  }
  if (!global.window.SYNONYMS) global.window.SYNONYMS = {};
  if (!global.window.DECKS)    global.window.DECKS = {};
  if (!global.window.ACTIVITIES) global.window.ACTIVITIES = {};
}

/* ═══════════════════════════════════════════════════════
   5. app.js mock (window.APP stub — card-quiz plugin.js가 의존)
      app.js 자체는 엔진코어라 DOM 의존성이 깊음 → stub으로 대체
═══════════════════════════════════════════════════════ */
function stubAppCore() {
  global.window.APP = {
    init:              () => ({ session: {}, progressStore: { deck_namespace: 'mock', schema_version: 1, cards: {} }, deck: { cards: [] }, synonyms: {}, isEmpty: true }),
    score:             () => ({ verdict: 'correct', feedback: {}, grader_id: 'engine' }),
    getNextCard:       () => null,
    processAttempt:    () => {},
    saveProgress:      () => {},
    loadProgress:      (id) => ({ deck_namespace: id || 'mock', schema_version: 1, cards: {} }),
    getDashboardData:  () => ({ by_area: [], weakness: [], pass_path: [], completion: [] }),
    getManifest:       (s) => global.window.MANIFEST && global.window.MANIFEST[s],
  };
  global.window.__CLF__ = {
    loadDeck:     (id) => ({ namespace: id, cards: [] }),
    loadProgress: (id) => ({ deck_namespace: id, schema_version: 1, cards: {} }),
    buildQueue:   () => [],
    getNextCard:  () => null,
  };
  console.log('[HARNESS] window.APP / window.__CLF__ — stub 주입');
}

/* ═══════════════════════════════════════════════════════
   6. 부트 순서 실행 (플러그인계약 §7 그대로)
═══════════════════════════════════════════════════════ */
const bootLog = [];  // { step, label, ok, missing, error }

function step(label, filePath, fallback) {
  let result;
  if (fallback) {
    // 파일 없을 때 fallback 함수 실행
    if (!fs.existsSync(filePath)) {
      console.warn('[HARNESS] 파일 없음 → fallback 실행:', label);
      fallback();
      result = { ok: true, missing: true };
    } else {
      result = safeEval(filePath, label);
    }
  } else {
    result = safeEval(filePath, label);
  }
  bootLog.push({ label, ...result });
  return result.ok;
}

console.log('\n══════════════════════════════════════');
console.log(' 학습 프레임워크 부트·등록 검증 하니스');
console.log('══════════════════════════════════════\n');

// Step 0: 생성물 로드 (없으면 mock)
step('synonyms.js',  FILES.synonyms,  ensureGeneratedMocks);
step('manifest.js',  FILES.manifest,  ensureGeneratedMocks);
step('decks/ss_unit1.js', FILES.decks, () => {});  // deck 없으면 그냥 skip

// Step 1: app.js 엔진 코어 — stub 대체 (DOM 의존 우회)
// 실제 app.js는 브라우저 환경에서만 올바르게 동작.
// 하니스 검증 범위: 등록·인터페이스 계약만. DOM/mount/렌더 경로는 브라우저 E2E 테스트 필요.
stubAppCore();
bootLog.push({ label: 'app.js(stub)', ok: true });

// Step 2: 플러그인 manifest + plugin 순서대로 로드 (§7 SoT)
step('card-quiz/manifest.js', FILES.cq_manifest);
step('card-quiz/plugin.js',   FILES.cq_plugin);
step('coding/manifest.js',    FILES.cod_manifest);
step('coding/plugin.js',      FILES.cod_plugin);
step('excel/manifest.js',     FILES.xls_manifest);
step('excel/plugin.js',       FILES.xls_plugin);
step('english/manifest.js',   FILES.eng_manifest);
step('english/plugin.js',     FILES.eng_plugin);
step('aws/manifest.js',       FILES.aws_manifest);
step('aws/plugin.js',         FILES.aws_plugin);

// Step 3: shell.js 마지막 로드
step('shell.js', FILES.shell);

/* ═══════════════════════════════════════════════════════
   7. SHELL.init({subject:'comp1'}) 호출
═══════════════════════════════════════════════════════ */
console.log('\n── SHELL.init 호출 ──');
let initOk = false;
let initError = null;
try {
  if (global.window.SHELL && typeof global.window.SHELL.init === 'function') {
    global.window.SHELL.init({ subject: 'comp1' });
    initOk = true;
    console.log('[HARNESS] SHELL.init 완료');
  } else {
    initError = 'window.SHELL 또는 window.SHELL.init 없음';
    console.error('[HARNESS]', initError);
  }
} catch (e) {
  initError = e.message;
  console.error('[HARNESS] SHELL.init 예외:', e.message);
}

/* ═══════════════════════════════════════════════════════
   8. PLUGIN_REGISTRY 검증
═══════════════════════════════════════════════════════ */
const EXPECTED = ['card-quiz', 'coding', 'excel', 'english', 'aws'];
const REGISTRY = global.window.PLUGIN_REGISTRY || {};
const registered = Object.keys(REGISTRY);

console.log('\n── PLUGIN_REGISTRY ──');
EXPECTED.forEach(pid => {
  const inst = REGISTRY[pid];
  if (inst) {
    const hasMount  = typeof inst.mount  === 'function';
    const hasUnmount= typeof inst.unmount=== 'function';
    const hasScore  = typeof inst.score  === 'function';
    const hasSnap   = typeof inst.getProgressSnapshot === 'function';
    const icon = (hasMount && hasUnmount && hasScore && hasSnap) ? '✓' : '△';
    console.log(` ${icon} ${pid}  [mount:${hasMount} unmount:${hasUnmount} score:${hasScore} snap:${hasSnap}]`);
  } else {
    console.log(` ✗ ${pid}  — 미등록`);
  }
});

/* ═══════════════════════════════════════════════════════
   9. 부트 순서 정적 검사 (index.html script 태그)
═══════════════════════════════════════════════════════ */
console.log('\n── index.html 부트 순서 정적 검사 ──');
const indexHtmlPath = path.join(BASE, 'app', 'index.html');
let bootOrderOk = true;
const bootOrderIssues = [];

if (fs.existsSync(indexHtmlPath)) {
  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  // script src 태그만 순서대로 추출
  const scriptOrder = [];
  const re = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    scriptOrder.push(m[1]);
  }

  // §7 순서 검사: 생성물 → 플러그인 → shell.js
  // 기대 패턴: synonyms < manifest < decks < (app.js) < plugin manifests+plugins < shell.js
  const idxSynonyms   = scriptOrder.findIndex(s => s.includes('synonyms'));
  const idxManifest   = scriptOrder.findIndex(s => s.includes('생성물') && s.includes('manifest'));
  const idxApp        = scriptOrder.findIndex(s => s.endsWith('app.js'));
  const idxShell      = scriptOrder.findIndex(s => s.endsWith('shell.js'));
  const idxPlugins    = scriptOrder.map((s,i) => ({s,i})).filter(({s}) => s.includes('plugins/')).map(({i}) => i);
  const firstPlugin   = idxPlugins.length ? Math.min(...idxPlugins) : -1;
  const lastPlugin    = idxPlugins.length ? Math.max(...idxPlugins) : -1;

  console.log('  script 로드 순서 추출됨:', scriptOrder.length, '개');
  scriptOrder.forEach((s, i) => console.log(`  [${i}] ${s}`));

  // 검사 1: shell.js는 마지막
  if (idxShell === -1) {
    bootOrderIssues.push('shell.js script 태그 없음');
    bootOrderOk = false;
  } else if (idxShell < lastPlugin) {
    bootOrderIssues.push(`shell.js(idx=${idxShell})가 플러그인(last idx=${lastPlugin})보다 앞에 로드됨 — 순서 오류`);
    bootOrderOk = false;
  }

  // 검사 2: 생성물 manifest는 플러그인 manifest보다 앞
  if (idxManifest !== -1 && firstPlugin !== -1 && idxManifest > firstPlugin) {
    bootOrderIssues.push(`생성물 manifest(idx=${idxManifest})가 플러그인(first idx=${firstPlugin})보다 뒤 — 순서 오류`);
    bootOrderOk = false;
  }

  // 검사 3: app.js는 플러그인보다 앞
  if (idxApp !== -1 && firstPlugin !== -1 && idxApp > firstPlugin) {
    bootOrderIssues.push(`app.js(idx=${idxApp})가 플러그인(first idx=${firstPlugin})보다 뒤 — 순서 오류`);
    bootOrderOk = false;
  }

  // 검사 4: 각 플러그인 manifest → plugin 순서
  const plugins5 = ['card-quiz', 'coding', 'excel', 'english', 'aws'];
  plugins5.forEach(pid => {
    const iMani = scriptOrder.findIndex(s => s.includes(`${pid}/manifest`));
    const iPlug = scriptOrder.findIndex(s => s.includes(`${pid}/plugin`));
    if (iMani === -1) {
      bootOrderIssues.push(`${pid}/manifest.js script 태그 없음`);
      bootOrderOk = false;
    } else if (iPlug === -1) {
      bootOrderIssues.push(`${pid}/plugin.js script 태그 없음`);
      bootOrderOk = false;
    } else if (iMani > iPlug) {
      bootOrderIssues.push(`${pid}: manifest(idx=${iMani}) > plugin(idx=${iPlug}) — 순서 오류`);
      bootOrderOk = false;
    }
  });

  if (bootOrderIssues.length === 0) {
    console.log('  결과: OK — §7 부트 순서 준수');
  } else {
    bootOrderIssues.forEach(msg => console.warn('  WARN:', msg));
  }
} else {
  console.warn('  index.html 없음 — 정적 검사 스킵');
  bootOrderIssues.push('index.html 없음');
}

/* ═══════════════════════════════════════════════════════
   10. 전역명 검증 (§7 유일 전역명)
═══════════════════════════════════════════════════════ */
console.log('\n── 전역명 검증 (§7) ──');
const GLOBALS_REQUIRED = ['PLUGIN_REGISTRY', 'MANIFEST', 'ACTIVITIES', 'SHELL'];
const globalIssues = [];
GLOBALS_REQUIRED.forEach(g => {
  const val = global.window[g];
  if (val === undefined || val === null) {
    console.warn(`  ✗ window.${g} — 없음`);
    globalIssues.push(`window.${g} 미등록`);
  } else {
    console.log(`  ✓ window.${g}`);
  }
});
// SHELL.init 존재 여부
if (global.window.SHELL && typeof global.window.SHELL.init !== 'function') {
  globalIssues.push('window.SHELL.init 함수 없음');
}

/* ═══════════════════════════════════════════════════════
   11. 이슈 집계 + 최종 리포트
═══════════════════════════════════════════════════════ */
const issues = [];

// eval 실패 이슈
bootLog.forEach(({label, ok, missing, error}) => {
  if (!ok && !missing) {
    issues.push({ severity: 'critical', where: label, problem: `eval 실패: ${error}`, fixed: false });
  }
});

// SHELL.init 이슈
if (!initOk) {
  issues.push({ severity: 'critical', where: 'SHELL.init', problem: initError || 'SHELL.init 호출 실패', fixed: false });
}

// 미등록 플러그인 이슈
EXPECTED.forEach(pid => {
  if (!REGISTRY[pid]) {
    issues.push({ severity: 'critical', where: `PLUGIN_REGISTRY['${pid}']`, problem: '등록 실패 — window._*_PLUGIN 전역 없거나 MANIFEST.plugins 미참조', fixed: false });
  }
});

// 인터페이스 불완전 이슈
EXPECTED.forEach(pid => {
  const inst = REGISTRY[pid];
  if (!inst) return;
  const missing = [];
  ['mount','unmount','score','getProgressSnapshot','onProgressRestored'].forEach(m => {
    if (typeof inst[m] !== 'function') missing.push(m);
  });
  if (missing.length) {
    issues.push({ severity: 'warn', where: `PLUGIN_REGISTRY['${pid}']`, problem: `PluginInstance §3 메서드 누락: ${missing.join(', ')}`, fixed: false });
  }
});

// 부트 순서 이슈
bootOrderIssues.forEach(msg => {
  issues.push({ severity: 'warn', where: 'index.html', problem: msg, fixed: false });
});

// 전역명 이슈
globalIssues.forEach(msg => {
  issues.push({ severity: 'warn', where: 'window globals', problem: msg, fixed: false });
});

// 하니스 커버리지 한계 명시
issues.push({
  severity: 'info',
  where: 'harness scope',
  problem: 'DOM 의존 경로(mount/unmount/CSS 전환/렌더)는 하니스 미검증 — 브라우저 실환경 또는 E2E(Playwright/Puppeteer) 테스트 필요',
  fixed: false
});

const allRegistered = EXPECTED.every(pid => !!REGISTRY[pid]);

console.log('\n══════════════════════════════════════');
console.log(' 최종 결과');
console.log('══════════════════════════════════════');
console.log('등록 완료:', registered);
console.log('기대 목록:', EXPECTED);
console.log('부트 순서 OK:', bootOrderOk);
console.log('이슈 수:', issues.length);
console.log('signal:', allRegistered && !initError ? 'PASS' : 'FAIL');

// JSON 출력 (StructuredOutput 수집용)
const result = {
  registered,
  expected: EXPECTED,
  harness_file: path.resolve(__dirname, 'boot_harness.js'),
  boot_order_ok: bootOrderOk && bootOrderIssues.length === 0,
  issues,
  signal: allRegistered && initOk ? 'PASS' : 'FAIL'
};

console.log('\n[RESULT_JSON]', JSON.stringify(result, null, 2));
