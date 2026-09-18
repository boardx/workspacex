---
name: maau-recursive-asset-report
description: 以 MAAU Canvas 为唯一输入，抽取结构化证据，确定性计算 M_C / γ_C / μ_C / β_C / Mcrit，输出固定 5 页的“AI 原生递归资产诊断报告”PDF（三档状态 / 动力学与临界点 / 实证卡片 / 退化压力测试 / 共性图谱）。
capability_id: WX-S022
version: 1.0.0
---

# AI 原生递归资产诊断报告（MAAU Canvas → PDF）

唯一输入是一份 MAAU Canvas（六区：Intent / User / Human-Agent / Workflow / Context / Validation）。
本 skill **只评价 MAAU 的递归资产结构**：资产有多少（M）、递归有多强（γ）、耗散有多高（μ）、
是否越过临界点（Mcrit）。不扩展到 TAM / ARR / CAC / 估值或公司整体商业评分；不引用外部案例。
所有数值都是 **Canvas-derived estimate**，不冒充生产实测。

规则单源：`references/model.md`（人类可读）与 `scripts/compute.cjs`（可执行）。输入格式：
`references/input-schema.md`。示例：`examples/sample-canvas.json`、`examples/sample-canvas-strong.json`。

## 流程（四步，顺序不可颠倒）

### 1. Preflight
读用户给的 Canvas（文本、附件解析结果或对话内容）。Workflow / Context / Validation
任一区块缺失或空白 → **停止**，不生成正式 M / γ / μ，只回复"需补充的画布信息"清单（缺哪一区、
该区要写什么：步骤/模块化/回路、数据/规则/工具/记忆、核验/纠错/回灌）。

### 2. 结构化抽取 → `/workspace/canvas-evidence.json`
按 `references/input-schema.md` 抽取。Canvas 来源可以是 `maau-canvas` skill 产出的 ```canvas 围栏
（`模板: maau`），六个分区与本 skill 六区一一对应：意图 Intent → `intent`、用户 User → `user`、
人与 Agent 分工 → `humanAgent`、工作流 Workflow → `workflow`、上下文 Context → `context`、
闭环验证 Validation → `validation`；也可以是用户贴的任何按这六区组织的文本。硬要求：
- 每个分值都带 `evidence.quote`（Canvas 原文截取，不改写）和 `region`。没有原文证据的项打 0。
- 资产只列"能回到下一轮继续使用"的；一次性交付物不进 `assets`。
- 闭环 L1–L5 只有"写回 + 下一轮调用"两个动作都出现才打 1；只有意图打 0.5。
- **不要**因为资产多、文字写得好而抬高 γ；γ 只由闭环证据触发（`compute.cjs` 还会机械封顶）。
用 `write_file` 把 JSON 写到 `/workspace/canvas-evidence.json`。

### 3. 确定性计算 + 渲染（一条命令）
```
node /skills/maau-recursive-asset-report/scripts/cli.cjs /workspace/canvas-evidence.json /workspace/maau-report.pdf --json /workspace/maau-diagnosis.json
```
- 退出码 3 = Preflight 失败，4 = 输入 JSON 不合规（stderr 逐条列出字段），回到第 2 步修 JSON，
  不要绕过校验、不要手改数值。
- 成功时 stdout 是一行 JSON（`state / gamma / M / mu / Mcrit / bytes / pages`）。
- 字体：脚本自动使用沙箱预装的 `/usr/share/fonts/workspacex/NotoSansSC-Common.otf`；报
  `No CJK font found` 时如实告诉用户环境缺中文字体，不要换库、不要 `npm install`。
- 脚本用预装的 `pdf-lib` + `@pdf-lib/fontkit`，不需要也不允许安装任何依赖。
- **不要**自己另写一份 PDF 脚本"美化"结果：5 页版式、图表、页脚提示都由 `render-report.cjs` 固定。

### 4. 核验后发布
- `read_file` 确认 `/workspace/maau-report.pdf` 以 `%PDF-` 开头且 stdout 报告 `pages: 5`。
- 如环境有 `pdftoppm`，可执行 `pdftoppm -png -r 60 /workspace/maau-report.pdf /workspace/maau-preview/page`
  逐页查看中文字形、裁切；没有查看能力就明确说"视觉检查未完成"，不要把字节存在包装成目视通过。
- 用 `wx_artifact_publish` 发布：`workspacePath: /workspace/maau-report.pdf`，`title: maau-report.pdf`，
  `mediaType: application/pdf`，一个稳定的 `idempotencyKey`。可同样发布 `/workspace/maau-diagnosis.json`
  （`application/json`）作为可追溯证据。`staged` 不等于用户已拿到文件，等正式 writeback 回执。

## 最终回复（不贴代码）
- 一句话判定：任务 Agent / 普通 MAAU / 强递归 MAAU，附 γ_C、M_C、μ_C（区间）、Mcrit（γ ≤ 1 时写"不成立"）。
- 主要短板（未闭合的闭环）与 Top 3 耗散源。
- 退化压力测试一句话：γ / μ 从多少变到多少、为什么。
- 明确标注"以上为 Canvas-derived 结构估计"。γ_C ≤ 1 时**绝不**写"已越过强递归相变阈值"。

## 本地使用（不经 chat）
仓库根目录：
```
pnpm maau:report <canvas-evidence.json> <out.pdf> [--font /path/to/NotoSansSC.otf] [--json diagnosis.json]
```
无 `--font` 时按 `$MAAU_REPORT_FONT` → `$SKILL_SANDBOX_CJK_FONT` → 沙箱预装路径解析；本机需自备一份
**单面**（非 .ttc）简体中文字体。也可分两步：`node scripts/compute.cjs in.json out.json` →
`node scripts/render-report.cjs out.json out.pdf --font ...`。

## 明确做不到的事
- 不能从没有 Workflow / Context / Validation 的 Canvas 里"估"出数值。
- 不能给出 λ、ρ、C、H 的实测值（V0.2 压缩为 K_C）。
- 不做多 Canvas 横向排名、不做商业估值。
