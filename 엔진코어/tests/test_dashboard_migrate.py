# -*- coding: utf-8 -*-
"""대시보드·마이그레이션 테스트 — 엔진계약 §7.

pytest 스타일(assert). now는 고정 상수로 주입. 콘솔 출력 없음.
"""
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from models import (
    BOX_MIN,
    BOX_MAX,
    SCHEMA_VERSION,
    AnswerSpec,
    CardDef,
    CardProgress,
    DeckData,
    ProgressStore,
)
from errors import SchemaVersionError
from dashboard import get_dashboard_data
from migrate import migrate, new_card_progress

# 고정 기준 시각 (결정성 보장)
NOW = 1_000_000_000_000


# ── 테스트용 헬퍼 ─────────────────────────────────────────────────────────────

def make_card(
    card_id: str,
    unit: str = "unit-a",
    area: str | None = "area1",
    subarea: str | None = "sub1",
    enabled: bool = True,
    weight: int = 5,
) -> CardDef:
    tags: dict = {"weight": weight}
    if area is not None:
        tags["area"] = area
    if subarea is not None:
        tags["subarea"] = subarea
    return CardDef(
        card_id=card_id,
        schema_version=1,
        subject="테스트과목",
        unit=unit,
        type="func",
        grade_mode="exact",
        front={},
        back={},
        answer_spec=AnswerSpec(normalize=["nfkc", "trim"], accepted=["정답"]),
        tags=tags,
        links={},
        enabled=enabled,
    )


def make_progress(
    card_id: str,
    cold_attempts: int = 0,
    cold_correct: int = 0,
    box: int = BOX_MIN,
    graduated: bool = False,
) -> CardProgress:
    return CardProgress(
        card_id=card_id,
        box=box,
        due_at=0,
        graduated=graduated,
        cold_attempts=cold_attempts,
        cold_correct=cold_correct,
        last_attempt_at=None,
        last_verdict=None,
    )


def make_store(
    cards: dict[str, CardProgress] | None = None,
    namespace: str = "test",
) -> ProgressStore:
    return ProgressStore(
        schema_version=SCHEMA_VERSION,
        deck_namespace=namespace,
        cards=cards or {},
    )


# ── by_area 테스트 ────────────────────────────────────────────────────────────

class TestByArea:
    def test_no_attempts_returns_none(self):
        """cold_attempts==0 이면 retrieval_rate=None."""
        deck = DeckData(namespace="t", cards=[make_card("c1")])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.by_area) == 1
        entry = result.by_area[0]
        assert entry.retrieval_rate is None

    def test_retrieval_rate_calculated(self):
        """cold_correct/cold_attempts."""
        deck = DeckData(namespace="t", cards=[make_card("c1"), make_card("c2")])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=4, cold_correct=3),
            "c2": make_progress("c2", cold_attempts=2, cold_correct=2),
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.by_area) == 1
        entry = result.by_area[0]
        # (3+2)/(4+2) = 5/6
        assert abs(entry.retrieval_rate - 5 / 6) < 1e-9

    def test_multiple_subareas(self):
        """여러 (area, subarea) 그룹을 각각 집계."""
        c1 = make_card("c1", area="a1", subarea="s1")
        c2 = make_card("c2", area="a1", subarea="s2")
        deck = DeckData(namespace="t", cards=[c1, c2])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=2, cold_correct=1),
            "c2": make_progress("c2", cold_attempts=4, cold_correct=4),
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.by_area) == 2
        by_key = {(e.area, e.subarea): e for e in result.by_area}
        assert abs(by_key[("a1", "s1")].retrieval_rate - 0.5) < 1e-9
        assert abs(by_key[("a1", "s2")].retrieval_rate - 1.0) < 1e-9

    def test_card_without_area_excluded(self):
        """area 없는 카드는 by_area 제외."""
        c_no_area = make_card("c-no", area=None, subarea="s1")
        deck = DeckData(namespace="t", cards=[c_no_area])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert result.by_area == []

    def test_card_without_subarea_excluded(self):
        """subarea 없는 카드는 by_area 제외."""
        c_no_sub = make_card("c-nosub", area="a1", subarea=None)
        deck = DeckData(namespace="t", cards=[c_no_sub])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert result.by_area == []

    def test_disabled_cards_excluded(self):
        """enabled=False 카드는 집계 제외."""
        c_on = make_card("c-on")
        c_off = make_card("c-off", enabled=False)
        deck = DeckData(namespace="t", cards=[c_on, c_off])
        store = make_store({
            "c-on": make_progress("c-on", cold_attempts=2, cold_correct=1),
            "c-off": make_progress("c-off", cold_attempts=10, cold_correct=10),
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.by_area) == 1
        assert abs(result.by_area[0].retrieval_rate - 0.5) < 1e-9

    def test_sorted_by_area_subarea(self):
        """결과는 (area, subarea) ASC 순 정렬."""
        cards = [
            make_card("c1", area="b", subarea="z"),
            make_card("c2", area="a", subarea="m"),
            make_card("c3", area="a", subarea="a"),
        ]
        deck = DeckData(namespace="t", cards=cards)
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        keys = [(e.area, e.subarea) for e in result.by_area]
        assert keys == [("a", "a"), ("a", "m"), ("b", "z")]


# ── weakness 테스트 ───────────────────────────────────────────────────────────

class TestWeakness:
    def test_cold0_excluded(self):
        """cold_attempts==0 단원은 weakness 제외."""
        deck = DeckData(namespace="t", cards=[make_card("c1")])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert result.weakness == []

    def test_wrong_rate_desc(self):
        """wrong_rate 내림차순 정렬."""
        c1 = make_card("c1", unit="unit-b")
        c2 = make_card("c2", unit="unit-a")
        deck = DeckData(namespace="t", cards=[c1, c2])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=4, cold_correct=1),   # wrong_rate=0.75
            "c2": make_progress("c2", cold_attempts=2, cold_correct=0),   # wrong_rate=1.0
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.weakness) == 2
        assert result.weakness[0].unit == "unit-a"   # wrong_rate=1.0 먼저
        assert result.weakness[1].unit == "unit-b"   # wrong_rate=0.75

    def test_tie_break_unit_asc(self):
        """wrong_rate 동점이면 unit ASC."""
        c1 = make_card("c1", unit="z-unit")
        c2 = make_card("c2", unit="a-unit")
        deck = DeckData(namespace="t", cards=[c1, c2])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=2, cold_correct=0),   # wrong_rate=1.0
            "c2": make_progress("c2", cold_attempts=2, cold_correct=0),   # wrong_rate=1.0
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.weakness) == 2
        assert result.weakness[0].unit == "a-unit"
        assert result.weakness[1].unit == "z-unit"

    def test_no_area_subarea_excluded(self):
        """area/subarea 없으면 weakness 제외."""
        c_bare = make_card("c-bare", area=None, subarea=None)
        deck = DeckData(namespace="t", cards=[c_bare])
        store = make_store({
            "c-bare": make_progress("c-bare", cold_attempts=3, cold_correct=0),
        })
        result = get_dashboard_data(deck, store, NOW)
        assert result.weakness == []

    def test_wrong_rate_value(self):
        """wrong_rate = (cold_attempts - cold_correct) / cold_attempts."""
        c1 = make_card("c1")
        deck = DeckData(namespace="t", cards=[c1])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=5, cold_correct=2),
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.weakness) == 1
        assert abs(result.weakness[0].wrong_rate - 3 / 5) < 1e-9

    def test_cross_unit_grouping(self):
        """같은 unit의 여러 카드는 합산."""
        c1 = make_card("c1", unit="u1")
        c2 = make_card("c2", unit="u1")
        deck = DeckData(namespace="t", cards=[c1, c2])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=2, cold_correct=1),
            "c2": make_progress("c2", cold_attempts=4, cold_correct=2),
        })
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.weakness) == 1
        # wrong = (1 + 2) / (2 + 4) = 3/6 = 0.5
        assert abs(result.weakness[0].wrong_rate - 0.5) < 1e-9


# ── pass_path 테스트 ──────────────────────────────────────────────────────────

class TestPassPath:
    def test_no_pass_targets_returns_empty(self):
        """pass_targets 미주입이면 pass_path=[]."""
        deck = DeckData(namespace="t", cards=[make_card("c1")])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert result.pass_path == []

    def test_subarea_not_in_pass_targets_excluded(self):
        """pass_targets에 해당 subarea 키 없으면 그 그룹 제외."""
        c1 = make_card("c1", subarea="sub-x")
        deck = DeckData(namespace="t", cards=[c1])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW, pass_targets={"other-sub": 80})
        assert result.pass_path == []

    def test_pass_targets_injected(self):
        """pass_targets 주입 시 target 필드 반영."""
        c1 = make_card("c1", subarea="sub1")
        deck = DeckData(namespace="t", cards=[c1])
        store = make_store({"c1": make_progress("c1", cold_attempts=1, cold_correct=1)})
        result = get_dashboard_data(deck, store, NOW, pass_targets={"sub1": 80})
        assert len(result.pass_path) == 1
        assert result.pass_path[0].target == 80

    def test_progress_equals_coverage_times_mastery(self):
        """progress = coverage * mastery."""
        c1 = make_card("c1")
        c2 = make_card("c2")
        c3 = make_card("c3")
        deck = DeckData(namespace="t", cards=[c1, c2, c3])
        store = make_store({
            "c1": make_progress("c1", cold_attempts=1, cold_correct=1),   # covered, mastered
            "c2": make_progress("c2", cold_attempts=1, cold_correct=0),   # covered, not mastered
            # c3: 미학습
        })
        result = get_dashboard_data(deck, store, NOW, pass_targets={"sub1": 60})
        assert len(result.pass_path) == 1
        entry = result.pass_path[0]
        # coverage = 2/3(covered/total), mastery = 1/2(mastered/covered), progress = 1/3(mastered/total)
        assert abs(entry.coverage - 2 / 3) < 1e-9
        assert abs(entry.mastery - 1 / 2) < 1e-9
        assert abs(entry.progress - 1 / 3) < 1e-9
        assert abs(entry.progress - entry.coverage * entry.mastery) < 1e-9

    def test_status_safe(self):
        """progress >= target/100 이면 safe."""
        c1 = make_card("c1")
        deck = DeckData(namespace="t", cards=[c1])
        store = make_store({"c1": make_progress("c1", cold_attempts=1, cold_correct=1)})
        result = get_dashboard_data(deck, store, NOW, pass_targets={"sub1": 80})
        # coverage=1.0, mastery=1.0, progress=1.0 >= 0.8
        assert result.pass_path[0].status == "safe"

    def test_status_watch(self):
        """0.7*t <= progress < t 이면 watch."""
        # target=80 => t=0.8, 0.7*t=0.56
        # coverage=0.75, mastery=1.0 -> progress=0.75 (0.56<=0.75<0.8)
        cards = [make_card(f"c{i}") for i in range(4)]
        deck = DeckData(namespace="t", cards=cards)
        store = make_store({
            "c0": make_progress("c0", cold_attempts=1, cold_correct=1),
            "c1": make_progress("c1", cold_attempts=1, cold_correct=1),
            "c2": make_progress("c2", cold_attempts=1, cold_correct=1),
            # c3: 미학습
        })
        result = get_dashboard_data(deck, store, NOW, pass_targets={"sub1": 100})
        # target=100 => t=1.0, coverage=3/4=0.75, mastery=3/3=1.0 (분모=3, covered만)
        # 실제로는 mastery = mastered / total(4) = 3/4 = 0.75
        # progress = 0.75 * 0.75 = 0.5625, 0.7*1.0=0.7 -> danger? 아니면 watch?
        # 다른 설정으로 테스트
        result2 = get_dashboard_data(deck, store, NOW, pass_targets={"sub1": 80})
        # t=0.8, progress=0.75*0.75=0.5625 < 0.56? -> 0.5625 >= 0.56 -> watch
        entry = result2.pass_path[0]
        assert entry.status == "watch"

    def test_status_danger(self):
        """progress < 0.7*t 이면 danger."""
        cards = [make_card(f"c{i}") for i in range(10)]
        deck = DeckData(namespace="t", cards=cards)
        store = make_store({
            "c0": make_progress("c0", cold_attempts=1, cold_correct=1),
        })
        result = get_dashboard_data(deck, store, NOW, pass_targets={"sub1": 100})
        # t=1.0, coverage=1/10=0.1, mastery=1/10=0.1, progress=0.01 < 0.7
        entry = result.pass_path[0]
        assert entry.status == "danger"


# ── completion 테스트 ─────────────────────────────────────────────────────────

class TestCompletion:
    def test_unlearned_counts_as_box1(self):
        """미학습 카드(cold_attempts==0, box=BOX_MIN=1)는 box1로 집계."""
        deck = DeckData(namespace="t", cards=[make_card("c1")])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert len(result.completion) == 1
        entry = result.completion[0]
        assert entry.box_dist["box1"] == 1
        assert entry.box_dist["box2"] == 0
        assert entry.box_dist["box3"] == 0

    def test_graduated_counts_as_box3(self):
        """graduated 카드는 box=BOX_MAX=3 으로 집계."""
        c1 = make_card("c1")
        deck = DeckData(namespace="t", cards=[c1])
        store = make_store({
            "c1": make_progress("c1", box=BOX_MAX, graduated=True),
        })
        result = get_dashboard_data(deck, store, NOW)
        entry = result.completion[0]
        assert entry.box_dist["box3"] == 1

    def test_mastery_rate(self):
        """mastery_rate = box3 카드 수 / 전체 카드 수."""
        cards = [make_card(f"c{i}") for i in range(4)]
        deck = DeckData(namespace="t", cards=cards)
        store = make_store({
            "c0": make_progress("c0", box=3, graduated=True),
            "c1": make_progress("c1", box=3, graduated=True),
        })
        result = get_dashboard_data(deck, store, NOW)
        entry = result.completion[0]
        assert entry.box_dist["box3"] == 2
        assert abs(entry.mastery_rate - 0.5) < 1e-9

    def test_mixed_boxes(self):
        """box1·box2·box3 혼합."""
        c1 = make_card("c1")
        c2 = make_card("c2")
        c3 = make_card("c3")
        deck = DeckData(namespace="t", cards=[c1, c2, c3])
        store = make_store({
            "c1": make_progress("c1", box=1),
            "c2": make_progress("c2", box=2),
            "c3": make_progress("c3", box=3, graduated=True),
        })
        result = get_dashboard_data(deck, store, NOW)
        entry = result.completion[0]
        assert entry.box_dist == {"box1": 1, "box2": 1, "box3": 1}
        assert abs(entry.mastery_rate - 1 / 3) < 1e-9

    def test_card_without_area_excluded(self):
        """area 없는 카드는 completion 제외."""
        c_bare = make_card("c-bare", area=None)
        deck = DeckData(namespace="t", cards=[c_bare])
        store = make_store()
        result = get_dashboard_data(deck, store, NOW)
        assert result.completion == []


# ── migrate 테스트 ────────────────────────────────────────────────────────────

class TestMigrate:
    def test_v0_to_v1_schema_version_injected(self):
        """schema_version 부재(v0) -> v1로 변환, schema_version=1 주입."""
        raw = {
            "deck_namespace": "test",
            "cards": {},
        }
        store = migrate(raw)
        assert store.schema_version == SCHEMA_VERSION

    def test_v0_to_v1_card_fields_filled(self):
        """v0 카드 데이터 누락 필드 기본값 채움."""
        raw = {
            "deck_namespace": "test",
            "cards": {
                "card-a": {"card_id": "card-a", "box": 2, "due_at": 9999},
            },
        }
        store = migrate(raw)
        cp = store.cards["card-a"]
        assert cp.box == 2
        assert cp.due_at == 9999
        assert cp.graduated is False
        assert cp.cold_attempts == 0
        assert cp.cold_correct == 0
        assert cp.last_attempt_at is None
        assert cp.last_verdict is None

    def test_v1_identity(self):
        """schema_version=1 그대로 -> 동일하게 반환."""
        raw = {
            "schema_version": 1,
            "deck_namespace": "test",
            "cards": {
                "card-b": {
                    "card_id": "card-b",
                    "box": 3,
                    "due_at": 12345,
                    "graduated": True,
                    "cold_attempts": 5,
                    "cold_correct": 4,
                    "last_attempt_at": 999,
                    "last_verdict": "correct",
                },
            },
        }
        store = migrate(raw)
        assert store.schema_version == 1
        cp = store.cards["card-b"]
        assert cp.box == 3
        assert cp.graduated is True
        assert cp.cold_attempts == 5
        assert cp.cold_correct == 4
        assert cp.last_attempt_at == 999
        assert cp.last_verdict == "correct"

    def test_near_identity_no_schema_version(self):
        """schema_version 없는 v0 카드가 v4와 동일 필드명(near-identity) -> 값 보존."""
        raw = {
            "deck_namespace": "myns",
            "cards": {
                "card-c": {
                    "card_id": "card-c",
                    "box": 2,
                    "due_at": 50000,
                    "graduated": False,
                    "cold_attempts": 3,
                    "cold_correct": 2,
                    "last_attempt_at": 40000,
                    "last_verdict": "incorrect",
                },
            },
        }
        store = migrate(raw)
        cp = store.cards["card-c"]
        assert cp.box == 2
        assert cp.cold_attempts == 3
        assert cp.cold_correct == 2
        assert cp.last_verdict == "incorrect"

    def test_missing_fields_filled_with_defaults(self):
        """v0 카드에서 일부 필드 누락 시 기본값 적용."""
        raw = {
            "deck_namespace": "ns",
            "cards": {
                "card-d": {},  # 아무 필드도 없음
            },
        }
        store = migrate(raw)
        cp = store.cards["card-d"]
        assert cp.box == BOX_MIN
        assert cp.due_at == 0
        assert cp.graduated is False
        assert cp.cold_attempts == 0
        assert cp.cold_correct == 0
        assert cp.last_attempt_at is None
        assert cp.last_verdict is None

    def test_future_version_raises_schema_version_error(self):
        """schema_version > SCHEMA_VERSION -> SchemaVersionError."""
        raw = {
            "schema_version": SCHEMA_VERSION + 1,
            "deck_namespace": "ns",
            "cards": {},
        }
        with pytest.raises(SchemaVersionError):
            migrate(raw)

    def test_empty_cards(self):
        """cards 없는 스토어도 정상 처리."""
        raw = {"deck_namespace": "empty"}
        store = migrate(raw)
        assert store.cards == {}
        assert store.deck_namespace == "empty"

    def test_migrate_pure_no_mutation(self):
        """migrate는 원본 dict를 변경하지 않는다(순수)."""
        raw = {
            "deck_namespace": "ns",
            "cards": {
                "c1": {"box": 1},
            },
        }
        raw_copy = {"deck_namespace": "ns", "cards": {"c1": {"box": 1}}}
        migrate(raw)
        assert raw == raw_copy


class TestNewCardProgress:
    def test_defaults(self):
        """기본값 CardProgress 반환."""
        cp = new_card_progress("my-card")
        assert cp.card_id == "my-card"
        assert cp.box == BOX_MIN
        assert cp.due_at == 0
        assert cp.graduated is False
        assert cp.cold_attempts == 0
        assert cp.cold_correct == 0
        assert cp.last_attempt_at is None
        assert cp.last_verdict is None

    def test_different_ids_independent(self):
        """다른 card_id는 독립적인 객체."""
        cp1 = new_card_progress("a")
        cp2 = new_card_progress("b")
        assert cp1.card_id == "a"
        assert cp2.card_id == "b"
        assert cp1 is not cp2
