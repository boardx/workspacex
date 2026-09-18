# 输入格式：`canvas-evidence.json`

模型把 MAAU Canvas 原文抽取成这份 JSON；之后一切数值由 `scripts/compute.cjs` 确定性算出。
**每个分值都要带 `evidence: { region, quote }`**——`quote` 是 Canvas 原文（可截取，不改写），
`region` ∈ `intent | user | humanAgent | workflow | context | validation`。没有原文证据的项打 0，
不要为了"看起来好"补分。完整示例：`examples/sample-canvas.json`（普通 MAAU，γ 被封顶）、
`examples/sample-canvas-strong.json`（强递归，含 Mcrit）。

```jsonc
{
  "project": { "name": "必填", "canvasVersion": "可选", "author": "可选", "date": "可选 YYYY-MM-DD" },
  "canvas": {                       // 六区原文（可摘要，但 workflow/context/validation 必须非空）
    "intent": "", "user": "", "humanAgent": "", "workflow": "", "context": "", "validation": ""
  },
  "assets": [                       // 可复用递归资产；一次性交付物不要列
    { "name": "评级 Agent", "type": "Agent|Workflow|Knowledge|Eval|Pattern",
      "E": 1, "R": 1, "I": 1, "V": 0.5,             // 每维 0 | 0.5 | 1
      "evidence": { "region": "workflow", "quote": "评级 Agent 初评" } }
  ],
  "loops": {                        // 五条闭环，score 0 | 0.5 | 1；score > 0 必须有 quote
    "L1": { "score": 1, "evidence": { "region": "validation", "quote": "..." } },   // Validation → Workflow
    "L2": { "score": 1, "evidence": { "region": "validation", "quote": "..." } },   // Validation → Context
    "L3": { "score": 1, "evidence": { "region": "humanAgent", "quote": "..." } },   // Output → Asset
    "L4": { "score": 0.5, "evidence": { "region": "context", "quote": "..." } },    // Asset → New Asset
    "L5": { "score": 1, "evidence": { "region": "humanAgent", "quote": "..." } }    // Human Feedback → Agent
  },
  "dissipation": {                  // 五个耗散源，score 0..1（越高越耗散），必须有 quote
    "H": { "score": 0.2, "evidence": { "region": "humanAgent", "quote": "..." } },  // 人工依赖
    "D": { "score": 0.4, "evidence": { "region": "context", "quote": "..." } },     // 数据依赖
    "K": { "score": 0.1, "evidence": { "region": "context", "quote": "..." } },     // 知识过期
    "B": { "score": 0.2, "evidence": { "region": "workflow", "quote": "..." } },    // 流程脆弱
    "F": { "score": 0.2, "evidence": { "region": "validation", "quote": "..." } }   // 反馈薄弱
  },
  "friction": {                     // β 输入，0..1
    "coreStepHumanDependency": { "score": 0.2, "evidence": { "region": "humanAgent", "quote": "..." } },
    "approvalGateDensity":     { "score": 0.2, "evidence": { "region": "humanAgent", "quote": "..." } },
    "agentAutonomy":           { "score": 0.8, "evidence": { "region": "humanAgent", "quote": "..." } }
  },
  "growth": {                       // K_C 输入，0..1
    "contextSupply":           { "score": 0.8, "evidence": { "region": "context", "quote": "..." } },
    "agentWorkflowMaturity":   { "score": 0.7, "evidence": { "region": "workflow", "quote": "..." } },
    "outputToAssetConversion": { "score": 0.6, "evidence": { "region": "validation", "quote": "..." } }
  },
  "protection": "可选：Canvas 里写明的闭环保护方式（如：专家只抽检异常；主流程允许 Agent 自主执行与写回）"
}
```

## 抽取口径速查

| 目标 | 看哪些区 | 判分要点 |
|---|---|---|
| assets | Workflow + Context + Validation | 名词级识别：Agent / 可复用 Step / 规则·口径·知识 / 核验·错误分类·回归 / 模板·范式 |
| loops | Validation + Workflow + Context + Human/Agent | 只认"写回 + 下一轮调用"两个动作都出现的闭环为 1；只有意图为 0.5 |
| dissipation | Human/Agent + Context + Workflow + Validation | 没版本/无刷新 → K 高；核心结论需人工重写 → H 高；纠错不写回 → F 高 |
| friction | Human/Agent + Workflow | 审批闸门越多、Agent 每次都需授权 → gateDensity / humanDependency 高、autonomy 低 |
| growth | Context + Workflow + Validation | 数据/规则/工具/记忆供给充分、模块化、输出能沉淀为资产 → 高 |

## 输出：`diagnosis.json`

`compute.cjs` 输出含 `preflight`、`errors`、`assets`、`loops`、`dissipation`、`current`
（γ/β/μ/K/M/Mcrit/position/muTop3/conclusion）、`stress`、`target`、`evidenceIndex`。
`preflight.ok = false` 时只有 `missingRegions` 与提示，没有数值。
