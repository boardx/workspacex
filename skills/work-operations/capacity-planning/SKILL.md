---
name: capacity-planning
version: 1.0.0
capability_id: WX-WORK-S144
metadata:
  work:
    stableId: S144
    domain: "Operations"
    riskClass: medium
    dependencies:
      required:
        - "board.read"
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "operations/skills/capacity-plan/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S144
    inputSchema: {"type":"object","properties":{"mode":{"enum":["fit-check","portfolio-load","what-if"]},"window":{"type":"object","properties":{"start":{"type":"string"},"end":{"type":"string"}},"required":["start","end"]},"scope":{"type":"object","properties":{"teamIds":{"type":"array","items":{"type":"string"}},"roleKeys":{"type":"array","items":{"type":"string"}},"individualDetail":{"type":"boolean"}},"required":[]},"people":{"type":"array","items":{"type":"object","properties":{"personRef":{"type":"string"},"roleKey":{"type":"string"},"contractedHoursPerWeek":{"type":"number"},"allocationPct":{"type":"number"},"leave":{"type":"array","items":{"type":"object","properties":{"start":{"type":"string"},"end":{"type":"string"},"hours":{"type":"number"}},"required":["start","end"]}}},"required":["personRef","roleKey","contractedHoursPerWeek"]}},"focusFactorByRole":{"type":"object","additionalProperties":{"type":"number"}},"targetUtilizationByRole":{"type":"object","additionalProperties":{"type":"number"}},"existingItems":{"type":"array","items":{"type":"object","properties":{"taskId":{"type":"string"},"roleKey":{"type":"string"},"plannedStart":{"type":"string"},"plannedEnd":{"type":"string"},"estimate":{"anyOf":[{"type":"object","properties":{"lowHours":{"type":"number"},"highHours":{"type":"number"},"basis":{"type":"string"}},"required":["lowHours","highHours","basis"]},{"type":"null"}]},"projectId":{"type":"string"}},"required":["taskId"]}},"newRequest":{"type":"object","properties":{"requestRef":{"type":"string"},"items":{"type":"array","items":{"type":"object","properties":{"stepId":{"type":"string"},"roleKey":{"type":"string"},"estimate":{"type":"object","properties":{"lowHours":{"type":"number"},"highHours":{"type":"number"},"basis":{"type":"string"}},"required":["lowHours","highHours","basis"]},"earliestStart":{"type":"string"},"dueBy":{"type":"string"}},"required":["stepId","roleKey","estimate"]}}},"required":["requestRef","items"]},"dependencies":{"type":"array","items":{"type":"object","properties":{"from":{"type":"string"},"to":{"type":"string"}},"required":["from","to"]}},"instructionText":{"type":"string"},"workCalendarRef":{"type":"string"},"timeZone":{"type":"string"},"locale":{"enum":["zh-CN","en-US"]}},"required":["mode","window","scope","people","existingItems","timeZone","locale"]}
    outputSchema: {"type":"object","properties":{"mode":{"type":"string"},"window":{"type":"object","properties":{"start":{"type":"string"},"end":{"type":"string"}},"required":["start","end"]},"config":{"type":"object","properties":{"focusFactorSource":{"enum":["org-config","user-stated","missing"]},"targetUtilizationSource":{"enum":["org-config","missing"]}},"required":["focusFactorSource","targetUtilizationSource"]},"byRoleWeek":{"type":"array","items":{"type":"object","properties":{"roleKey":{"type":"string"},"week":{"type":"string"},"supplyHours":{"type":"number"},"demandHours":{"type":"object","properties":{"low":{"type":"number"},"high":{"type":"number"}},"required":["low","high"]},"utilization":{"type":"object","properties":{"low":{"type":"number"},"high":{"type":"number"}},"required":["low","high"]},"status":{"enum":["ok","tight","over","unknown"]}},"required":["roleKey","week","supplyHours","demandHours","utilization","status"]}},"bottlenecks":{"type":"array","items":{"type":"object","properties":{"roleKey":{"type":"string"},"weeks":{"type":"array","items":{"type":"string"}},"affectedRefs":{"type":"array","items":{"type":"string"}}},"required":["roleKey","weeks","affectedRefs"]}},"unestimatedItems":{"type":"array","items":{"type":"string"}},"confidence":{"enum":["normal","reduced-missing-estimates","reduced-missing-focus-factor"]},"scenarios":{"type":"array","items":{"type":"object","properties":{"name":{"enum":["baseline","with-request"]},"fit":{"enum":["fits","fits-with-tradeoffs","does-not-fit","cannot-assess"]},"peakUtilization":{"type":"object","properties":{"low":{"type":"number"},"high":{"type":"number"}},"required":["low","high"]}},"required":["name","fit"]}},"tradeoffOptions":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["defer-start","descope","borrow-capacity","extend-date","reduce-wip","add-temporary-capacity"]},"detail":{"type":"string"},"effect":{"type":"object","properties":{"roleKey":{"type":"string"},"utilizationDelta":{"type":"number"}},"required":["roleKey","utilizationDelta"]},"needsApprovalBy":{"type":"string"}},"required":["kind","detail","effect","needsApprovalBy"]}},"individualDetail":{"type":"array","items":{"type":"object","properties":{"personRef":{"type":"string"},"utilization":{"type":"object","properties":{"low":{"type":"number"},"high":{"type":"number"}},"required":["low","high"]}},"required":["personRef","utilization"]}},"limitations":{"type":"array","items":{"type":"string"}}},"required":["mode","window","config","byRoleWeek","bottlenecks","unestimatedItems","confidence","scenarios","tradeoffOptions","limitations"]}
---

# 容量规划（S144）

> Work Skill · v2 实体编号 S144 · 领域 Operations · 策略 A2
> 依据 `requirements/work-stack-v2/skills/S144-capacity-planning.md`（单一事实源；语义有疑义时以该文档为准）。评审状态：待独立评审（`reviews/S144.review.md` 尚未出具）。

## 这个 Skill 解决什么问题

未来一个窗口（≤ 26 周）内，某团队能做多少事、已承诺多少、新需求装得下吗、哪个角色是瓶颈、要装下需要牺牲什么。S144 把**供给**（人 × 可用工时 × 有效投入率 − 假期/节假日）与**需求**（S142 看板工项的估算区间 + 新请求）在角色/技能粒度上对账，输出 `CapacityPlan`：各角色-周利用率区间、超配窗口、瓶颈、装载场景与取舍选项。

## 方法要点

- 供给 = Σ(合同工时 × 可用率 − 假期 − 节假日) × 有效投入率；有效投入率与目标利用率**必须由组织配置或用户明示**，缺失 → `focus-factor-missing` 并降置信度，不猜。
- 需求来自 S142 工项估算区间 + 新请求工项；无估算的工项进 `unestimatedItems`，**不用平均值顶替**，并降低置信度；利用率输出为 `[low, high]` 区间。
- 状态：`over` 仅当**低端**估算也超目标；只有高端超为 `tight`；无目标配置为 `unknown`。
- 瓶颈：连续 ≥ 2 周 `over` 的角色及其影响的项目/里程碑引用（依赖由 S154 提供，缺失不推断下游）。
- 场景：`baseline`（已承诺）与 `with-request`，`fit ∈ {fits, fits-with-tradeoffs, does-not-fit, cannot-assess}`；无估算或无供给数据时 `cannot-assess`。
- 取舍选项（提议非决定）：defer-start / descope / borrow-capacity / extend-date / reduce-wip / add-temporary-capacity，各带量化影响与批准角色。

## 硬规则（实体文档「决策」一节的执行形态）

- 利用率永远是区间（决策 1）；`fit=fits` 要求基线与请求场景下均无 `over` 且 `confidence=normal`。
- S144 不分配个人（决策 2）：不输出分配到个人的任务；遇到「把 A 的任务调给 B」只给角色层面的 borrow-capacity 选项。
- 默认聚合输出；`individualDetail` 仅在 `scope.individualDetail=true` 且调用者为该团队管理者时提供，否则降级为聚合并在 `limitations` 说明（决策 4、§7）。
- CN 加班不计入供给（`overtimeHours` 单列）；缺 `workCalendarRef` 时 `limitations` 标 `calendar-missing`。`fit` 由数值算出，请求文本不参与（F7）。

## 边界（不做什么）

- 不排任务到个人、不自动改派
- 不做项目计划与估算（S154 产出估算区间，S141 给投入上限）
- 不做招聘/编制规划（W051、S137–S140）；不做冲刺承诺与速率（S070）
- 员工个人数据最小化：`personRef` 仅为引用，不含姓名

## 输入 / 输出契约

`metadata.work.inputSchema` / `outputSchema` 是可被 G2 门编译的 JSON Schema，只表达结构、枚举与必填项；跨字段不变量与错误码的权威定义在实体文档：
- 输入契约：`requirements/work-stack-v2/skills/S144-capacity-planning.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S144-capacity-planning.md` 「输出契约」一节（含不变量与错误码：CAPACITY_WINDOW_TOO_LONG、CAPACITY_SCOPE_FORBIDDEN、CAPACITY_INPUT_INVALID）

## 依赖（能力分类，ADR-120）

- required：board.read
- optional：无
- 工项估算无承载字段（首版来自 S154 输出与请求人陈述，须在 Workflow 运行内持有）；人员/排班/请假数据在外部 HRIS（无集成）；目标利用率与有效投入率配置无存放处（实体文档 §8，全部 proposed-unwired）。riskClass=medium（含员工个人数据）。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`operations/skills/capacity-plan/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- PMBOK 资源管理、Little's Law / 在制品限制等公开容量管理方法学，仅为概念参考

## 使用本 Skill 的 Workflow 与角色

W052 Request-to-Project（第 4 个，`fit-check`）、W053 Weekly PMO Review（第 3 个，`portfolio-load`）；D007 直调 `what-if`；D012、D019、D020、D024、D027、D028、D029、D035、D037、D057 行业专家直调（均未作者化）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md`；本文件不复述矩阵。

## 图变更提议（留给人裁决，本包不落地）

- S144 在 W052 中位于 S142 之后：若 S142 写入在人工门之后，S144 需读取「提议的卡」而非已写卡（输入用 `newRequest.items` 兼容两种），由 W052 作者决定。
- 与 S070 Sprint Planning 容量概念重叠：敏捷团队用速率，S144 用工时，同一团队不应两套并用，留给 D015 作者化时澄清。
