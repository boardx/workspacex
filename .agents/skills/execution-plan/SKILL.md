---
name: execution-plan
description: >
  激活条件：人类给 AI 布置目标 / 任务 / 需求时（"帮我做…""实现…""修一下…""目标是…"），
  以及用户提到 执行计划、计划图、流程图、mermaid、进度可视化、进度颜色、卡在哪、做到哪了 等关键词时触发。
  让任何 AI 在动手前先复述理解并给出 Mermaid 流程图执行计划，用颜色表示每一步进度
  （灰未开始 / 黄已开始 / 绿已完成 / 紫已测试 / 红被堵塞），并在 harness 开工→执行→验证→收尾全程更新。
---

# Execution Plan Skill —— 目标理解 + 着色流程图计划

> **规范原文（状态语义、推进规则、写法约定、在 harness 各环节放哪、通用提示词）只在
> `.harness/instructions/execution-plan-visualization.md` 一处。** 本 skill 是执行书：
> 告诉你按什么顺序做、用哪条命令；不复述规范、不带色值（`pnpm run lint:execution-plan`
> 会核对这一点）。

## 何时使用

**每一次**人类交给你一个目标——不论是对话里一句话、一个 sprint feature、一个 issue、还是
coordinator 的派工——在做任何实际改动之前。例外只有纯问答（"这个函数干嘛的？"）：没有
执行步骤，就没有计划可画。

## SOP（六步）

1. **复述理解**：按规范「接到目标」一行写出四项：目标 / 完成判据 / 不做什么 / 假设与待确认。
   完成判据要能落成可执行命令——sprint feature 直接用它的 `verification`（见
   [feature-implementer] 第 2 步），直接交办的改动用受影响包的 typecheck / lint / test。
2. **有会改变计划的疑问 → 先问，停在这一步**。只是细节偏好的，按合理默认走，写进「假设」。
3. **画计划**：从模板复制，不要从零写：
   ```bash
   # sprint feature：计划文件入库
   mkdir -p phases/<phase>/sprints/<sprint>/plans
   cp .harness/templates/execution-plan.template.md phases/<phase>/sprints/<sprint>/plans/<feature-id>.plan.md
   ```
   直接交办 / 对话目标不必建文件，把模板里的图改好贴出来即可（放在哪按规范「嵌入 harness 过程」表）。
   改节点标签与连线，**保留**五行 classDef 与「每节点一行 class」的写法；`G` 与第一步标黄。
4. **执行中改色**——每次状态变化都改，用脚本不手改：
   ```bash
   node .harness/scripts/execution-plan.mjs set <计划> S2 doing
   node .harness/scripts/execution-plan.mjs set <计划> S2 done
   node .harness/scripts/execution-plan.mjs set <计划> S3 blocked --note "<卡在哪 / 需要谁做什么>"
   ```
   变红当场告诉人类（issue 评论 / 对话），不攒到收尾。
5. **验证后才变紫**：验证命令退出码 0 之后
   ```bash
   node .harness/scripts/execution-plan.mjs set <计划> S4 tested --note "<命令> → <evidence 路径>"
   ```
   sprint feature 的验证就是 `pnpm harness verify`（见 [harness-workflow]「验证门控」）；
   它失败 ⇒ 退回黄或转红，不许留在绿。
6. **收尾**：
   ```bash
   node .harness/scripts/execution-plan.mjs check   <计划>   # 格式 / 红有原因 / 紫有证据
   node .harness/scripts/execution-plan.mjs summary <计划>   # 贴进 progress.md、session-handoff.md、issue
   ```
   把最终着色图贴到 issue（或 PR 描述 / 对话回复）。还有灰、黄、红的节点，就在交接里写清为什么。

## 能力清单

- 把一句模糊的目标转成「目标 / 完成判据 / 不做什么 / 假设」四项，并判断哪些疑问必须先问人。
- 把目标拆成 5–12 个可推进的节点，验证步骤单独成节点，可并行的画成分叉。
- 用 `execution-plan.mjs set` 只改一行完成状态切换，`--note` 同时写下堵塞原因或证据。
- 用 `execution-plan.mjs summary` 生成一行各色计数 + 红色原因清单，直接贴给人类。
- 用 `execution-plan.mjs check` 在提交前自查计划文件；它也在 `verify:harness:raw` 里跑。

## 架构知识：这张图在 harness 里的位置

```
人类目标 ──▶ [execution-plan] 复述理解 + 着色计划（本 skill）
               │  sprint feature：phases/<phase>/sprints/<sprint>/plans/<id>.plan.md + issue 评论
               │  直接交办：issue 评论 / PR 描述；对话目标：回复里
               ▼
   harness-workflow / feature-implementer 执行 ──▶ 每步改色（黄 → 绿 / 红）
               ▼
   pnpm harness verify / 验证命令 ──▶ 紫（带证据）
               ▼
   session-closer 收尾 ──▶ summary 写入 progress.md / session-handoff.md
```

- **权威关系**：feature 的状态权威仍是 `feature_list.json` + `pnpm harness verify`；计划图是
  **投影**，不是第二份状态源——全紫不等于 passing，但标 passing 时计划应当全紫。
- **单一事实源**：色值在 `.harness/scripts/execution-plan.mjs` 的 `PLAN_STATUSES`；模板
  `.harness/templates/execution-plan.template.md` 与规范里通用提示词的副本都由 lint 逐字核对。

## 领域知识：为什么这样设计

- **紫与绿分开**是本仓最重要的一刀：AI 最常见的虚报是把「代码写完」报成「做好了」。
  「完成」与「有证据地测过」在图上是两种颜色，人类不用读日志就能看出哪些只是自称完成。
- **红必须带原因**：只标红等于把排查成本转嫁给人类；「需要谁做什么」让人类能直接行动。
- **颜色只信动态信号**（`.harness/instructions/static-trace-vs-live-fact.md`）：「我记得跑过」
  不是紫色的依据，这一轮真实跑出的退出码才是。
- **用 Mermaid**：GitHub issue / PR / Markdown 原生渲染，纯文本可 diff、可被脚本改写；不引入
  任何新工具。

## 迭代 / 知识回流

- 撞到新的「计划与事实不一致」形态（画紫但没测、红了没人知道……）→ 先看能否补进
  `execution-plan.mjs` 的判定并加反证测试；只能靠纪律的，补进规范文件，不写在这里。
- 调整颜色、状态或写法约定 → 只改脚本的 `PLAN_STATUSES` 与规范，跑 `pnpm run lint:execution-plan`
  让所有副本一起对齐。
