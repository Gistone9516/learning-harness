# -*- coding: utf-8 -*-
# nlp-study 콘텐츠 빌드: 읽기 md 2편 + 실전(노트북 코드셀 → starter_code, 50문 md → questions verbatim)
# → 생성물/activities.js (window.ACTIVITIES['nlp-study']) + 생성물/manifest.js
import json, re, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))   # 과목/자연어처리
EXAM = os.path.join(BASE, "26-1 기말고사")
OUT = os.path.join(BASE, "생성물")

def jsstr_safe(js):
    # </script> 조기종료·행분리자 방지 (생성규칙 §2.3)
    return js.replace("</", "<\\/").replace(" ", "\\u2028").replace(" ", "\\u2029")

def read(p):
    return open(p, encoding="utf-8").read()

def extract_code_cells(ipynb_path):
    nb = json.loads(read(ipynb_path))
    parts = []
    for c in nb.get("cells", []):
        if c.get("cell_type") == "code":
            src = c.get("source", [])
            txt = "".join(src) if isinstance(src, list) else str(src)
            if txt.strip():
                parts.append(txt.rstrip())
    return "\n\n".join(parts)

def parse_questions(md_path):
    md = read(md_path)
    chunks = re.split(r'(?m)^### Q(\d+)\.', md)
    qs = []
    def grab(label, body):
        m = re.search(r'\*\*' + label + r'\*\*\s*:\s*(.*?)(?=\n\*\*(?:문제|모범답안|핵심키워드)\*\*|\n###|\Z)', body, re.S)
        return m.group(1).strip() if m else ''
    for i in range(1, len(chunks), 2):
        num = int(chunks[i]); body = chunks[i + 1]
        q = grab('문제', body)
        ans = grab('모범답안', body)
        kw = grab('핵심키워드', body)
        answer = ans + (("\n\n**핵심키워드:** " + kw) if kw else "")
        qs.append({"no": num, "q": q, "answer": answer})
    return qs

def reading(fname, title):
    p = os.path.join(OUT, fname)
    if os.path.isfile(p):
        return read(p)
    print("WARN reading 누락:", fname)
    return "# " + title + "\n\n(읽기 노트 준비 중)"

def main():
    try:
        os.makedirs(OUT, exist_ok=True)
        acts = []
        # 1) 읽기
        acts.append({"kind": "reading", "id": "concept", "title": "1) 개념",
                     "md": reading("_reading_concept.md", "개념")})
        acts.append({"kind": "reading", "id": "command", "title": "2) 라이브러리 명령어",
                     "md": reading("_reading_command.md", "라이브러리 명령어")})
        # 2) 실전
        jobs = [
            ("exam-71", "3) 실전 — 7.1 LDA·벡터화",
             "7.1. seoul-120-LDA (문제).ipynb", "기말 예상문제 7.1 LDA·벡터화 (50문).md", "_answers_71.json"),
            ("exam-72", "3) 실전 — 7.2 RNN·딥러닝",
             "7.2. seoul-120-baseline-rnn (문제).ipynb", "기말 예상문제 7.2 RNN·딥러닝 (50문).md", "_answers_72.json"),
        ]
        for aid, title, ipynb, qmd, ansjson in jobs:
            code = extract_code_cells(os.path.join(EXAM, ipynb))
            qs = parse_questions(os.path.join(EXAM, qmd))
            if not code.strip():
                print("FAIL: code 비어있음", ipynb); sys.exit(1)
            if len(qs) < 40:
                print("FAIL: 문제 수 비정상", qmd, len(qs)); sys.exit(1)
            # 압축 답안(간단명료) 병합 — 있으면 모범답안을 압축본으로 교체
            cpath = os.path.join(OUT, ansjson)
            cond = {}
            if os.path.isfile(cpath):
                try: cond = json.loads(read(cpath))
                except Exception as e: print("WARN 압축답안 파싱 실패", ansjson, e)
            replaced = 0
            for item in qs:
                key = str(item["no"])
                if key in cond and str(cond[key]).strip():
                    item["answer"] = cond[key]; replaced += 1
            acts.append({"kind": "exam", "id": aid, "title": title,
                         "starter_code": code, "questions": qs})
            print("OK exam %s: code %d자, 문제 %d개, 압축답안 %d개" % (aid, len(code), len(qs), replaced))

        # activities.js
        payload = json.dumps(acts, ensure_ascii=False)
        actjs = '(window.ACTIVITIES = window.ACTIVITIES || {})["nlp-study"] = ' + jsstr_safe(payload) + ';\n'
        with open(os.path.join(OUT, "activities.js"), "w", encoding="utf-8") as f:
            f.write(actjs)

        # manifest.js (decks 없음, nlp-study 단일 플러그인 — 로더는 decks:[] 통과)
        manifest = {
            "schema": 1, "subject_id": "nlp", "subject_label": "자연어처리",
            "generated_at": "1970-01-01T00:00:00Z", "generator_version": "nlp-study-1.0.0",
            "areas": [{"area": "written", "subarea": "computer", "label": "학습", "target": None}],
            "decks": [],
            "plugins": [{"plugin_id": "nlp-study", "label": "자연어처리 학습", "version": "1.0.0",
                         "infra": "static", "capabilities": ["quiz"], "scoring_mode": "self",
                         "activity_type": "nlp-study", "progress_schema_version": 1}],
            "config_ref": "config/규칙.json",
            "counts": {"activities": len(acts)}
        }
        mjs = '(window.MANIFEST = window.MANIFEST || {})["nlp"] = ' + jsstr_safe(json.dumps(manifest, ensure_ascii=False)) + ';\n'
        with open(os.path.join(OUT, "manifest.js"), "w", encoding="utf-8") as f:
            f.write(mjs)

        # synonyms.js (로더가 base+synonyms.js 로드 — 빈 등록으로 충분)
        with open(os.path.join(OUT, "synonyms.js"), "w", encoding="utf-8") as f:
            f.write('(window.SYNONYMS = window.SYNONYMS || {})["nlp"] = {};\n')

        print("BUILD OK activities=%d → %s" % (len(acts), os.path.join(OUT, "activities.js")))
    except SystemExit:
        raise
    except Exception as e:
        print("BUILD FAIL:", repr(e)); sys.exit(1)

if __name__ == "__main__":
    main()
