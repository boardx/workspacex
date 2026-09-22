# 输入格式：`canvas-evidence.json`（V0.5）

完整示例：`examples/sample-index.json`（Value Index 模式）、`examples/sample-usd.json`（美元区间模式）。
每个分值都要带 `evidence: { region, quote }`（画布原文截取，不改写；region ∈ intent | user | humanAgent | workflow | context | validation）。
没有原文证据的项打 0 / 标 `null`，不要为了"看起来好"补分。

```jsonc
{
  "maau": { "name": "必填", "summary": "", "archetype": "Tool|AI SaaS|Service as Software|Autonomous Service", "stage": "Idea|Prototype|Validation|Revenue|Scale", "domain": "Finance|Legal|Insurance|Consulting|Ops|...",
            "labelsEvidence": { "archetype": {"quote": ""}, "stage": {"quote": ""}, "domain": {"quote": ""} }, "date": "YYYY-MM-DD" },
  "canvas": { "intent": "", "user": "", "humanAgent": "", "workflow": "", "context": "", "validation": "" },   // workflow/context/validation 必须非空
  "assets": [ { "name": "", "type": "Agent|Workflow|Knowledge|Eval|Pattern", "E": 1, "R": 1, "I": 0.5, "V": 0.5, "evidence": { "region": "workflow", "quote": "" } } ],
  "loops": { "L1": {"score": 0.5, "evidence": {...}}, "L2": {...}, "L3": {...}, "L4": {...}, "L5": {...} },        // 0 | 0.5 | 1
  "dissipation": { "H": {"score": 0.4, "evidence": {...}}, "D": {...}, "K": {...}, "B": {...}, "F": {...} },       // 0..1
  "engine": { "lambda": {"score": 0.5, "evidence": {...}}, "rho": {...}, "C": {...}, "H": {...} },                 // 0..1
  "evidence": [
    { "id": "ev-1", "type": "observed", "level": "E1", "region": "user", "statement": "画布原文" },
    { "id": "ev-2", "type": "target", "region": "intent", "statement": "目标值……" },
    { "id": "ev-3", "type": "planned", "level": "E4", "horizon": "12m", "probability": 0.7, "region": "validation", "statement": "计划……" },
    { "id": "ev-4", "type": "assumption", "region": "context", "statement": "假设……" }
  ],
  "benchmark": { "benchmarkDate": "YYYY-MM-DD", "comparables": [
    { "name": "", "archetype": "", "stage": "", "domain": "", "similarities": "", "differences": "",
      "valueUsd": 5000000, "source": "", "sourceDate": "YYYY-MM-DD", "evidenceGrade": "A|B|C|D" },   // 查不到 → "valueUsd": null
  ] }
}
```

## 判分速查
| 字段 | 看哪些区 | 要点 |
|---|---|---|
| assets | Workflow + Context + Validation | Agent / 可复用 Step / 规则·知识 / 核验·回归 / 模板；一次性交付物不进 |
| loops | Validation + Workflow + Context + Human/Agent | "写回 + 下一轮调用"都出现才 1；只有意图 0.5 |
| dissipation | Human/Agent + Context + Workflow + Validation | 无版本/无刷新 → K 高；核心结论需人工重写 → H 高；纠错不写回 → F 高 |
| engine.lambda / rho | Workflow + Validation | 一次工作有多少被结构化沉淀；资产是否默认被再次调用 |
| engine.C / H | Context + Human/Agent | 模型/工具/上下文供给；专家参与、责任边界、反馈是否进系统 |
| evidence | 全部六区 | 已发生（observed）vs 目标（target）vs 计划（planned）vs 假设（assumption）；"当前需要手工抓取"是 observed 的问题证据 |
| benchmark | 外部（web_search 可用时） | 3–5 个可解释 Comparable；每条 source / sourceDate / evidenceGrade；未公开 → null |

## 输出：`venture-valuation.json`
`preflight`、`errors`、`recursive`（M/N/maturity/γ/μ/λ/ρ/C/H/Λ/Mcrit/…）、`ledger`（逐条去向 + EI_observed）、`benchmark`（mode/V_seed/comparables）、
`vNow`、`executionProbability`、`forecast.horizons[90d|12m][conservative|base|upside]`、`confidence`、`quadrant`、`milestones`、`snapshot`（P1 八个数字）、`provenance`、`sensitivity`、`disclosures`。
