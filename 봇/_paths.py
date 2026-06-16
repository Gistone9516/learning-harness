# -*- coding: utf-8 -*-
"""경로 헬퍼. 봇 패키지 내 모든 모듈이 엔진코어와 harness를 sys.path로 찾을 수 있게 한다.

call_once() 를 각 모듈 최상단에서 호출하거나, 진입점(main.py)에서 한 번만 호출하면 됨.
중복 호출은 safe(set 체크).
"""
from __future__ import annotations

import sys
import os

_registered = False

def setup() -> None:
    """엔진코어와 harness 카테고리 디렉터리를 sys.path에 추가."""
    global _registered
    if _registered:
        return
    _registered = True

    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)

    engine_core = os.path.join(root, "엔진코어")
    harness_automation = os.path.join(here, "harness", "automation")
    harness_output = os.path.join(here, "harness", "output")
    harness_interaction = os.path.join(here, "harness", "interaction")
    harness_channels = os.path.join(here, "harness", "channels")
    harness_live = os.path.join(here, "harness", "live")
    harness_meta = os.path.join(here, "harness", "meta")

    # 봇 루트를 가장 앞에 추가 (봇 레벨 errors.py가 엔진코어 errors.py보다 우선)
    if here not in sys.path:
        sys.path.insert(0, here)

    # 엔진코어와 harness 카테고리는 봇 루트 다음에 추가
    for p in [
        harness_meta,
        harness_live,
        harness_channels,
        harness_interaction,
        harness_output,
        harness_automation,
        engine_core,
    ]:
        if p not in sys.path:
            sys.path.append(p)
