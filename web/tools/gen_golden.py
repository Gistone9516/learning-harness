# Generate golden grading vectors from the canonical Python engine (engine/scoring.py).
# The TS grader port (web/src/grade) is parity-tested against these. Run after engine changes:
#   python web/tools/gen_golden.py
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]  # web/tools/ -> repo root
sys.path.insert(0, str(ROOT / "engine"))

from models import ScoreInput, AnswerSpec  # noqa: E402
from scoring import score  # noqa: E402


def spec(d):
    return AnswerSpec(
        normalize=d.get("normalize", []),
        accepted=d.get("accepted"),
        required_keywords=d.get("required_keywords"),
        blanks=d.get("blanks"),
        sequence=d.get("sequence"),
    )


CASES = [
    {"name": "exact_match", "mode": "exact", "user": "0도",
     "spec": {"normalize": ["nfkc", "trim", "collapse_space", "lower"], "accepted": ["0도", "영도"]}},
    {"name": "exact_nomatch", "mode": "exact", "user": "5",
     "spec": {"normalize": ["nfkc", "trim", "collapse_space", "lower"], "accepted": ["0도", "영도"]}},
    {"name": "exact_nfkc_fullwidth", "mode": "exact", "user": "ＡＢＣ",
     "spec": {"normalize": ["nfkc", "lower"], "accepted": ["abc"]}},
    {"name": "exact_lower_ascii", "mode": "exact", "user": "Hello",
     "spec": {"normalize": ["lower"], "accepted": ["hello"]}},
    {"name": "exact_collapse_space", "mode": "exact", "user": "a   b",
     "spec": {"normalize": ["collapse_space"], "accepted": ["a b"]}},
    {"name": "exact_strip_all_space", "mode": "exact", "user": "a b c",
     "spec": {"normalize": ["strip_all_space"], "accepted": ["abc"]}},
    {"name": "exact_synonym", "mode": "exact", "user": "vlookup", "synonyms": {"vlookup": "조회"},
     "spec": {"normalize": ["lower"], "accepted": ["조회"]}},
    {"name": "exact_unify_arg_sep", "mode": "exact", "user": "SUM(A1;A2)",
     "spec": {"normalize": ["lower", "unify_arg_sep"], "accepted": ["sum(a1,a2)"]}},
    {"name": "exact_unify_cell_dollar", "mode": "exact", "user": "$A$1",
     "spec": {"normalize": ["lower", "unify_cell_dollar"], "accepted": ["a1"]}},
    {"name": "exact_strip_trailing_paren", "mode": "exact", "user": "함수 (설명)",
     "spec": {"normalize": ["strip_trailing_paren"], "accepted": ["함수"]}},
    {"name": "exact_fullwidth_to_halfwidth", "mode": "exact", "user": "ＳＵＭ",
     "spec": {"normalize": ["fullwidth_to_halfwidth", "lower"], "accepted": ["sum"]}},
    {"name": "seq_match", "mode": "exact", "user": ["a", "b", "c"],
     "spec": {"normalize": ["lower"], "sequence": ["A", "B", "C"]}},
    {"name": "seq_len_mismatch", "mode": "exact", "user": ["a", "b"],
     "spec": {"normalize": ["lower"], "sequence": ["A", "B", "C"]}},
    {"name": "seq_order_wrong", "mode": "exact", "user": ["b", "a", "c"],
     "spec": {"normalize": [], "sequence": ["a", "b", "c"]}},
    {"name": "keyword_all_hit", "mode": "keyword", "user": "물을 적신다 비누로 20초 문지른다",
     "spec": {"normalize": ["lower"], "required_keywords": [["물", "적신다"], ["비누", "20초"]]}},
    {"name": "keyword_missed", "mode": "keyword", "user": "물만 있다",
     "spec": {"normalize": ["lower"], "required_keywords": [["물"], ["비누"]]}},
    {"name": "cloze_all", "mode": "cloze", "user": ["3", "71"],
     "spec": {"normalize": ["lower"], "blanks": [["3", "세"], ["71", "칠십일"]]}},
    {"name": "cloze_one_wrong", "mode": "cloze", "user": ["3", "99"],
     "spec": {"normalize": ["lower"], "blanks": [["3", "세"], ["71", "칠십일"]]}},
    {"name": "self_correct", "mode": "self", "user": "correct", "spec": {"normalize": []}},
    {"name": "self_incorrect", "mode": "self", "user": "incorrect", "spec": {"normalize": []}},
]


def main():
    out = []
    for c in CASES:
        inp = ScoreInput(mode=c["mode"], user_answer=c["user"], answer_spec=spec(c["spec"]),
                         synonyms=c.get("synonyms"))
        r = score(inp)
        out.append({
            "name": c["name"],
            "input": {
                "mode": c["mode"],
                "user_answer": c["user"],
                "answer_spec": c["spec"],
                "synonyms": c.get("synonyms"),
            },
            "expected": {
                "verdict": r.verdict,
                "matched": r.matched,
                "missed": r.missed,
                "normalized_user": r.normalized_user,
            },
        })
    dst = ROOT / "web" / "src" / "grade" / "golden.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(out)} vectors -> {dst}")


if __name__ == "__main__":
    main()
