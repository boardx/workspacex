# 原始需求 — ic-material-review-agent（Phase 16）

> 本文件夹是本阶段原始需求的家，**是输入不是权威**；权威永远是 `../feature_list.json`。

| 文件 | 内容 | 来源 |
|---|---|---|
| `00-overview.md` | 用户原话、HMW、目标用户与成功标准 | 人类交办 + HMW 问题定义卡 |
| `01-interaction-journey.md` | 端到端交互流程（时序图逐步拆解 + 两处人工确认关口） | 交互时序图附件 |
| `02-capability-mapping.md` | 每一步复用本仓哪条既有能力（工具/契约/模块） | 代码库现状勘探 |
| `03-review-standard-and-evidence.md` | 上会标准清单、缺失项判据、交叉验证规则、出处链要求 | 测试方案 PDF 第一部分 |
| `04-acceptance-tests.md` | A/B/C 三组验收用例与通过标准 | 测试方案 PDF 全文 |

## 流水线
1. 人类/agent 往本文件夹写原始需求 `*.md`。
2. 调 **requirement-author** 生成 `../feature_list.json`（带可执行 `verification`）。
3. 有界面 → 先走 **ui-prototyper**（`ui-preview/`），再按 `.harness/instructions/contract-design.md`
   按契约束做 `design-signoff.md`（① UI ② 用例 ③ API 契约，人类签核）。
