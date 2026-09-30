---
name: status-reporting
version: 1.0.0
capability_id: WX-WORK-S143
metadata:
  work:
    stableId: S143
    domain: "Operations"
    riskClass: low
    dependencies:
      required:
        - "board.read"
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "operations/skills/status-report/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S143
    inputSchema: {"type":"object","properties":{"mode":{"enum":["project","portfolio-week","decision-follow-through","action-tracking","snapshot-only"]},"workstreams":{"type":"array","items":{"type":"object","properties":{"workstreamId":{"type":"string"},"kind":{"enum":["project","decision-execution","postmortem-actions","plan"]},"title":{"type":"string"}},"required":["workstreamId","kind","title"]}},"baselineRef":{"type":"string"},"items":{"type":"array","items":{"type":"object","properties":{"taskId":{"type":"string"},"workstreamId":{"type":"string"},"title":{"type":"string"},"status":{"enum":["inbox","todo","in_progress","review","done"]},"dueAt":{"anyOf":[{"type":"string"},{"type":"null"}]},"weight":{"type":"number"},"completedAt":{"anyOf":[{"type":"string"},{"type":"null"}]},"blockedBy":{"type":"array","items":{"type":"string"}},"riskLevel":{"anyOf":[{"enum":["R1","R2","R3"]},{"type":"null"}]},"originRefs":{"type":"array","items":{"type":"string"}}},"required":["taskId","workstreamId","status"]}},"approvedChanges":{"type":"array","items":{"type":"object","properties":{"changeId":{"type":"string"},"workstreamId":{"type":"string"},"effect":{"enum":["scope-add","scope-remove","date-move","effort-change"]},"approvedAt":{"type":"string"}},"required":["changeId","workstreamId","effect","approvedAt"]}},"actuals":{"type":"object","properties":{"effortByWorkstream":{"type":"array","items":{"type":"object","properties":{"workstreamId":{"type":"string"},"actual":{"type":"number"},"unit":{"enum":["person-days","currency"]},"sourceRef":{"type":"string"}},"required":["workstreamId","actual","unit","sourceRef"]}}},"required":[]},"s010Ref":{"type":"string"},"s144Ref":{"type":"string"},"rulesConfig":{"type":"object","properties":{"scheduleYellowDays":{"type":"number"},"scheduleRedDays":{"type":"number"},"effortYellowPct":{"type":"number"},"effortRedPct":{"type":"number"},"staleAfterDays":{"type":"number"}},"required":[]},"periodStart":{"type":"string"},"periodEnd":{"type":"string"},"asOf":{"type":"string"},"locale":{"enum":["zh-CN","en-US"]},"timeZone":{"type":"string"},"workCalendarRef":{"type":"string"}},"required":["mode","workstreams","items","periodStart","periodEnd","asOf","locale","timeZone"]}
    outputSchema: {"type":"object","properties":{"mode":{"type":"string"},"period":{"type":"object","properties":{"start":{"type":"string"},"end":{"type":"string"}},"required":["start","end"]},"workstreams":{"type":"array","items":{"type":"object","properties":{"workstreamId":{"type":"string"},"baselineVersion":{"anyOf":[{"type":"string"},{"type":"null"}]},"dimensions":{"type":"object","properties":{"schedule":{"type":"object","properties":{"status":{"enum":["green","yellow","red","unknown","needs-human-judgment"]},"ruleId":{"type":"string"},"reasonCode":{"enum":["critical-path-slip","unapproved-scope-growth","effort-overrun","high-risk-open","dependency-blocked","no-baseline","stale-data"]},"facts":{"type":"object","additionalProperties":{"anyOf":[{"type":"number"},{"type":"string"},{"type":"null"}]}}},"required":["status","ruleId"]},"scope":{"type":"object","properties":{"status":{"enum":["green","yellow","red","unknown","needs-human-judgment"]},"ruleId":{"type":"string"},"reasonCode":{"enum":["critical-path-slip","unapproved-scope-growth","effort-overrun","high-risk-open","dependency-blocked","no-baseline","stale-data"]},"facts":{"type":"object","additionalProperties":{"anyOf":[{"type":"number"},{"type":"string"},{"type":"null"}]}}},"required":["status","ruleId"]},"effort":{"type":"object","properties":{"status":{"enum":["green","yellow","red","unknown","needs-human-judgment"]},"ruleId":{"type":"string"},"reasonCode":{"enum":["critical-path-slip","unapproved-scope-growth","effort-overrun","high-risk-open","dependency-blocked","no-baseline","stale-data"]},"facts":{"type":"object","additionalProperties":{"anyOf":[{"type":"number"},{"type":"string"},{"type":"null"}]}}},"required":["status","ruleId"]},"risk":{"type":"object","properties":{"status":{"enum":["green","yellow","red","unknown","needs-human-judgment"]},"ruleId":{"type":"string"},"reasonCode":{"enum":["critical-path-slip","unapproved-scope-growth","effort-overrun","high-risk-open","dependency-blocked","no-baseline","stale-data"]},"facts":{"type":"object","additionalProperties":{"anyOf":[{"type":"number"},{"type":"string"},{"type":"null"}]}}},"required":["status","ruleId"]}},"required":["schedule","scope","effort","risk"]},"overall":{"type":"object","properties":{"status":{"enum":["green","yellow","red","unknown","needs-human-judgment"]},"basis":{"enum":["worst-visible-dimension"]},"unassessedDimensions":{"type":"array","items":{"enum":["schedule","scope","effort","risk"]}}},"required":["status","basis","unassessedDimensions"]},"milestones":{"type":"array","items":{"type":"object","properties":{"milestoneId":{"type":"string"},"baselineDate":{"type":"string"},"forecastRange":{"type":"object","properties":{"low":{"type":"string"},"high":{"type":"string"}},"required":["low","high"]},"slipDays":{"type":"number"},"critical":{"type":"boolean"},"done":{"type":"boolean"}},"required":["milestoneId","baselineDate","critical","done"]}},"scopeDelta":{"type":"object","properties":{"added":{"type":"number"},"removed":{"type":"number"},"changed":{"type":"number"},"unapprovedAdditions":{"type":"number"}},"required":["added","removed","changed","unapprovedAdditions"]},"forecastCompletion":{"type":"object","properties":{"low":{"type":"string"},"high":{"type":"string"},"basis":{"enum":["remaining-work-over-throughput","milestone-chain","insufficient-data"]}},"required":["basis"]},"completedThisPeriod":{"type":"array","items":{"type":"string"}},"plannedNextPeriod":{"type":"array","items":{"type":"string"}},"decisionsNeeded":{"type":"array","items":{"type":"object","properties":{"ref":{"type":"string"},"owner":{"type":"string"},"why":{"type":"string"}},"required":["ref","owner","why"]}}},"required":["workstreamId","baselineVersion","dimensions","overall","milestones","scopeDelta","forecastCompletion","completedThisPeriod","plannedNextPeriod","decisionsNeeded"]}},"stale":{"type":"array","items":{"type":"object","properties":{"workstreamId":{"type":"string"},"lastUpdateAt":{"type":"string"}},"required":["workstreamId","lastUpdateAt"]}},"proposals":{"type":"array","items":{"type":"object","properties":{"kind":{"enum":["request-change-request","flag-baseline-rebase","notify-owner"]},"workstreamId":{"type":"string"},"payload":{"type":"object"},"evidenceRef":{"type":"string"}},"required":["kind","workstreamId","payload","evidenceRef"]}},"limitations":{"type":"array","items":{"type":"string"}}},"required":["mode","period","workstreams","stale","proposals","limitations"]}
---

# 基线偏差状态汇报（S143）

> Work Skill · v2 实体编号 S143 · 领域 Operations · 策略 A2
> 依据 `requirements/work-stack-v2/skills/S143-status-reporting.md`（单一事实源；语义有疑义时以该文档为准）。评审状态：待独立评审（`reviews/S143.review.md` 尚未出具）。

## 这个 Skill 解决什么问题

对一条**有基线的工作流**（项目、决策的执行、复盘改进行动集、入职计划），回答：相对**经人确认的基线**，进度、范围、投入、风险各偏离多少；按规则给每个维度定色与原因码；预计完成日期的区间；本期完成、下期计划、需要谁做什么决定。产出 `BaselineStatusReport`。与 S007（对象快照 + 受众裁剪）分工：S143 以结构化基线为锚做**可复算的偏差计算**，共用 S007 的状态词表（`green | yellow | red | unknown | needs-human-judgment`），不重新定义。

## 方法要点

- 锁定基线：`baselineRef` 必须是人确认的基线版本；没有基线只能 `snapshot-only`（不定色、不算 slipDays），或在要求定色时报 `STATUS_BASELINE_MISSING`。
- 进度偏差：里程碑 `slipDays = forecastDate − baselineDate`，预测是区间；关键路径滑动标 `critical`；完成率按计划权重（无权重则等权并声明），不按任务个数。
- 范围偏差：以基线范围清单为准，计 added/removed/changed；未经批准的新增计入 `unapprovedAdditions`（范围蔓延信号）。
- 投入偏差：计划 vs 实际（有来源才算，否则 `not-visible`）；不以「完成率 × 预算」推算实际花费。
- 风险与容量：只读同一运行内 S010 `riskLevel` 分布与 S144 超配标记，计数与引用，不重评。
- 规则定色：阈值取自 `rulesConfig`（缺失 → `needs-human-judgment/thresholds-missing`）；原因码为封闭枚举；整体色 = 各可见维度最差者，并列出 `unassessedDimensions`。
- 完成预测永远是区间；历史吞吐样本 < 4 个周期时 `basis=insufficient-data` 且不给区间。`decisionsNeeded[]` 每条指向具体阻塞与具名角色。

## 硬规则（实体文档「决策」一节的执行形态）

- 没有人确认的基线，就没有偏差（决策 1）；`approvedChanges` 只接受治理记录或 S145 已批准状态，调用方声明的「已批准」不被接受。
- 整体色取各可见维度最差者（决策 2）；存在 `unapprovedAdditions>0` 时整体不得为 green，范围蔓延封顶黄色（决策 3）。
- 阈值无默认值（决策 5）；`forecastCompletion` 与 `milestones[].forecastRange` 永远是区间，不含单点（决策 4）。
- `s010Ref` / `s144Ref` 只接受同一运行内引用，否则 `STATUS_REF_FOREIGN`；卡片标题等文本不参与定色（F7）。

## 边界（不做什么）

- 不写执行摘要/战略叙事（S020）、不做目标对账与复盘归因（S155）、不评风险等级（S010）
- 不改卡、不改计划、不发送：只输出 `proposals[]`，副作用为只读

## 输入 / 输出契约

`metadata.work.inputSchema` / `outputSchema` 是可被 G2 门编译的 JSON Schema，只表达结构、枚举与必填项；跨字段不变量与错误码的权威定义在实体文档：
- 输入契约：`requirements/work-stack-v2/skills/S143-status-reporting.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S143-status-reporting.md` 「输出契约」一节（含不变量与错误码：STATUS_BASELINE_MISSING、STATUS_REF_FOREIGN、STATUS_TOO_MANY_WORKSTREAMS、STATUS_INPUT_INVALID）

## 依赖（能力分类，ADR-120）

- required：board.read
- optional：无
- 「基线」无领域对象、实际投入无来源、吞吐历史可查询性 UNVERIFIED（实体文档 §8）；首版基线只能由 S154 产物（人确认后）在 Workflow 运行内持有。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`operations/skills/status-report/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- EVM / Earned Schedule 公开方法学仅为概念参考，不复制标准文本

## 使用本 Skill 的 Workflow 与角色

W003 Decision-to-Execution（末位，`decision-follow-through`）、W053 Weekly PMO Review（首位，`portfolio-week`）、W056 Incident-to-Postmortem（`action-tracking`）；W049/W050/W043 亦含 S143（模式留给 HR/Legal 线）；D007 直调；D012、D015、D016、D019、D024、D027、D029、D037、D055、D057 行业/教练角色直调（均未作者化）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md`；本文件不复述矩阵。

## 图变更提议（留给人裁决，本包不落地）

- **S143 与 S007 的关系待评审裁决**：(a) 保留 S143，限定为「基线偏差计算」，W053/W056/W003 使用 S143；(b) 在 S007 新增 `updateKind: "baseline-variance"` 并删除 S143。本包按现图作者化，不假定，矩阵不动。
- W053 首位 S143、次位 S142：S143 读 S142 变更结果还是看板当前态，取决于 W053 阶段设计。
