---
name: maau-venture-valuation
description: 以一张 MAAU Canvas 为唯一输入，输出「AI 原生递归资产与估值预测」8 页 PDF：递归资产诊断（M/γ/μ）、证据账本（Observed/Target/Planned/Assumption）、Benchmark 锚定的 V_seed、当前 Reference Value、90 天/12 个月 Conservative/Base/Upside 情景预测与价值解锁路线图。用户说「估值诊断」「递归资产报告」「价值预测」「MAAU 估值」时使用。
capability_id: WX-S022
version: 2.0.0
---

# AI 原生递归资产与估值预测（MAAU Canvas → 8 页 PDF）

唯一输入是一张 MAAU Canvas（六区：Intent / User / Human-Agent / Workflow / Context / Validation）。
LLM 只做**语义抽取、分类、Comparable 解释**；**所有数字**（M / γ / μ / EI / V_seed / V_now /
P_execution / V_90d / V_12m）由 `scripts/calc.cjs` 确定性生成；8 页版式由 `scripts/render.cjs` 固定。
输出措辞永远是 Reference Value / Scenario Forecast / Benchmark Range，不是审计、公允价值或融资定价意见。

## 效率硬规则（两次 devapp 实测超时的直接教训）

- **总共只做 3–4 次工具调用**：`write_file`（证据 JSON）→ `execute`（一条命令）→ `wx_artifact_publish`（PDF，可再发 JSON）。
- **不要写 todo / 分步计划**；抽取 + 计算 + 渲染不是三个步骤，是"写一个 JSON、跑一条命令"。
- **画布是截图/图片时**：它已经作为视觉输入给了你，**直接看图抽取**；**绝不** `ls` / `read_file` `/inputs/` 下的图片，
  也不要 `wx_document_parse` 图片（一次失败就会卡死整轮）。
- **画布是 Workspace X 画布对象时**：`wx_canvas_read({canvasId})` 一次拿到源文，直接抽取。
- **不要读 references**，除非某个字段的判分口径拿不准；本文件下方的速查已够用。不要另写 PDF 脚本"美化"。

## 流程

### 1. Preflight（不调工具）
Workflow / Context / Validation 任一缺失或空白 → 不出金额。直接回复"结构缺口报告"：缺哪一区、
该区要写什么（步骤/自动化/人工节点；数据/规则/工具/记忆；核验/纠错/回灌/复盘）。

### 2. 抽取 → `write_file /workspace/canvas-evidence.json`
完整字段见 `references/input-schema.md`；示例 `examples/sample-index.json`（无可用 Benchmark → Value Index）、
`examples/sample-usd.json`（有 3 个 A/B/C 级 Comparable → 美元区间）。速查：

| 块 | 内容 | 口径 |
|---|---|---|
| `maau` | name / summary / **archetype**（Tool · AI SaaS · Service as Software · Autonomous Service）/ **stage**（Idea · Prototype · Validation · Revenue · Scale）/ domain，各带 `labelsEvidence.*.quote` | 标签只由画布原文触发 |
| `canvas` | 六区原文（可摘要） | Preflight 依据 |
| `assets[]` | 可复用资产：Agent / Workflow / Knowledge / Eval / Pattern，四维 E R I V ∈ {0, 0.5, 1} + 原文 quote | 一次性交付物不进 |
| `loops` | L1–L5 闭环 ∈ {0, 0.5, 1}，score>0 必须有 quote | 只有"写回 + 下一轮调用"都出现才 1 |
| `dissipation` | H D K B F ∈ [0,1] + quote | 越高越耗散 |
| `engine` | λ 沉淀率 / ρ 复用率 / C 系统能力 / H 人机协作 ∈ [0,1] + quote | 进 Λ = λρ·C^α·H^β |
| `evidence[]` | 每条画布语句：`type` ∈ observed / target / planned / assumption；observed 与 planned 带 `level` E1–E6；planned 带 `horizon` 90d / 12m（可选 `probability`） | **目标与计划绝不标 observed**；"已有客户连续使用 30 天"才是 observed |
| `benchmark` | `benchmarkDate` + `comparables[]`（name / archetype / stage / domain / similarities / differences / valueUsd 或 null / source / sourceDate / evidenceGrade A–D） | 见下 |

**证据等级**：E1 明确问题/高质量访谈 · E2 原型被真实使用 · E3 首个付费/正式采用 · E4 连续使用/生产验证 · E5 续约/扩单/ROI · E6 可重复渠道/跨客户复制。
**Benchmark**：优先同业务模式 + 同阶段 + 同领域，不足时放宽到同业务模式 + 同阶段，保留 3–5 个可解释 Comparable。
有 `web_search` 时可用它找公开融资/估值信号，每条必须带 `source`、`sourceDate`、`evidenceGrade`
（A 审计/监管/正式公告；B 公司官网/创始人披露；C 第三方数据库/媒体估算；D 推断/无法核实）。
**查不到就 `valueUsd: null`（Not publicly disclosed），绝不猜；不从融资额推估值。** 没有 ≥2 个 A/B/C 级价值信号时
计算器自动输出 Value Index（起点 100），这是正常结果不是失败。

### 3. 一条命令
```
node /skills/maau-venture-valuation/scripts/cli.cjs /workspace/canvas-evidence.json /workspace/venture-valuation.pdf --json /workspace/venture-valuation.json
```
- 退出码 3 = Preflight 失败（stderr 给缺口）；4 = JSON 不合规（stderr 逐条列字段）→ 改 JSON 重跑，不要手改数字。
- 成功时 stdout 一行 JSON：state / quadrant / confidence / valueMode / M / γ / μ / EI / V_seed / V_now / V_90d / V_12m。
- 字体自动用沙箱预装的 `/usr/share/fonts/workspacex/NotoSansSC-Common.otf`；报 `No CJK font found` 就如实说环境缺字体，不要换库、不要安装。

### 4. 发布
`wx_artifact_publish`：`workspacePath: /workspace/venture-valuation.pdf`，`title: venture-valuation.pdf`，`mediaType: application/pdf`，
稳定 `idempotencyKey`；可同样发布 `/workspace/venture-valuation.json`（`application/json`）作为可追溯证据。
`staged` 不等于用户已拿到，等正式回执。不需要再 `read_file` 核验 PDF——cli 的 stdout 已经报告页数与字节数。

## 最终回复（不贴代码，≤ 10 行）
- 一句话：Task Agent / 普通 MAAU / 强递归 MAAU；四象限；Forecast Confidence。
- 8 个数字：M、γ、μ、EI_observed、V_seed、V_now（区间）、V_90d、V_12m（Base，并给 Conservative/Upside）。
- 当前有哪些 Observed 证据、哪些只是 Target/Planned；接下来 3–5 个"必须成真的事实"；哪条失败哪段回撤。
- 明确标注：Reference Value / Scenario Forecast；Value Index 模式时说明原因（缺可用 Benchmark）。

## 本地使用
仓库根：`pnpm maau:report <canvas-evidence.json> <out.pdf> [--font /path/NotoSansSC.otf] [--json out.json]`。
无 `--font` 时按 `$MAAU_REPORT_FONT` → `$SKILL_SANDBOX_CJK_FONT` → 沙箱预装路径解析；本机要一份**单面**（非 .ttc）简体中文字体。

## 明确不做
- 不把 M/γ/μ 直接相乘成美元；不把 Target 当 Fact；不用单一 Comparable 定 V_seed；不把 Upside 当最可能结果。
- 不做多 Canvas 排名，不出法定/融资估值意见。
