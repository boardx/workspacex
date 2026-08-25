"""黄金压测场景的共用夹具（DA-09，issue #2051）。

这里只放需要依赖注入的夹具；假模型等构件在同目录的 `_scripted.py`，各 TC 文件
直接 `from _scripted import ...`（pytest 会把 `tests/golden/` 前置进 sys.path）。

- `evidence`——把每个 TC 的实测产物落盘成 JSON。rubric 的「物理证据闭环」要求评分行
   必须附证据；跑完 `pytest tests/golden` 就有一份可直接归档进
   `.harness/state/deepagent-eval/<date>-<sha>/` 的目录，不需要评分者再手工誊抄。
   落点：`DEEP_AGENT_GOLDEN_EVIDENCE_DIR`，未设时是
   `apps/deep-agent-service/.golden-evidence/<utc>/`（已 gitignore）。

⚠ 这些夹具用假模型，是**引擎行为**的证据，不是模型质量的证据。哪一条 TC 的哪一部分
需要真模型/真服务，逐条写在 `README.md` 的自动化分级表里——不把跑不了的伪装成能跑。
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from _scripted import SERVICE_ROOT, EvidenceWriter


@pytest.fixture(scope="session")
def evidence_root() -> Path:
    override = (os.environ.get("DEEP_AGENT_GOLDEN_EVIDENCE_DIR") or "").strip()
    if override:
        return Path(override)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return SERVICE_ROOT / ".golden-evidence" / stamp


@pytest.fixture(scope="session")
def evidence(evidence_root: Path) -> EvidenceWriter:
    return EvidenceWriter(evidence_root)


@pytest.fixture
def org_skills_config() -> dict[str, Any]:
    """`build_tools` 的两个工具从 `RunnableConfig["configurable"]["org_skills"]` 读技能表
    （tools.py 的架构决定：技能是每轮运行的数据，不是建图时烘进去的）。TC-1 用它给
    子代理一个真实可查的技能库。"""
    return {
        "configurable": {
            "org_skills": [
                {
                    "stable_name": "market-scan",
                    "name": "市场扫描",
                    "content": "你是市场扫描分析师，输出竞品与定价概览。",
                },
                {
                    "stable_name": "risk-review",
                    "name": "风险复核",
                    "content": "你是风险复核员，指出方案里的合规与执行风险。",
                },
            ]
        }
    }
