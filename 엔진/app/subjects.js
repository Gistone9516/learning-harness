/* 과목 레지스트리 — 랜딩(index.html) + 동적로더(study.html) 공용.
   빌드된 과목만 등록(생성물/manifest.js 존재). labelPath = 과목 폴더명. */
window.SUBJECTS = {
  nlp:   { id: 'nlp',   label: '자연어처리',           glyph: '語', labelPath: '자연어처리',
           desc: '기말고사 — 개념 · 라이브러리 명령어 · 답안 실전' },
  comp1: { id: 'comp1', label: '컴퓨터활용능력 1급',  glyph: '컴', labelPath: '컴활1급',
           desc: '필기 · 실기 핵심 함수와 절차' },
  cad3dp:{ id: 'cad3dp', label: 'CAD · 3D 프린팅',    glyph: '3D', labelPath: 'cad3dp',
           desc: '개념 → 문제 → JSCAD 모델링 실습 (비전공자 입문)' },
  robot: { id: 'robot', label: '로봇 입문 (FK)',       glyph: '로', labelPath: 'robot',
           desc: '개념 → 문제 → 로봇팔 정기구학 실습' }
};
/* 랜딩 표시 순서 */
window.SUBJECTS_ORDER = ['nlp', 'comp1', 'cad3dp', 'robot'];
