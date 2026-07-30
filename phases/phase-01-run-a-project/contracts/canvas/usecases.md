# 契约束 `canvas` — 签核②：用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 S3、不知道 PostgreSQL、不知道 fabric.js。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（权威）。

⚠ **失败模式必须穷举**——「失败长什么样」是契约的一半，界面的异常态全靠它。
已建成的 `/projects/[id]/canvas` 是 **mock 壳**（`canvas-stage` 静态占位、便签/节点/连线是 mock，见 S-17），
它对自己永远自洽；**别把它的 happy path 当成契约**。

---

## 统一失败枚举 `CanvasError`

前端据此渲染 R8 要求的七态之一（加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功）。

| 码 | 场景 | 前端应显示 | 备注 |
|---|---|---|---|
| `NO_PROJECT_ROLE` | 项目层无角色 | 你在本项目没有对应角色 | 判定属 identity 束，此处透传 |
| `NOT_IN_GROUP` | 写别组画布 | 别组画布为只读 | uc-7-3 A2；**服务端拒绝**，不是工具条置灰 |
| `ROLE_INSUFFICIENT` | 角色不够 | 你的角色不能执行该动作 | 如组员不可裁决冲突、不可批量确认 |
| `TEMPLATE_NOT_FOUND` | 模板不存在 | 找不到该模板 | |
| `TEMPLATE_KEY_CONFLICT` | 自建模板 key 撞内置 | 该 key 已被内置模板占用 | I-1 |
| `TEMPLATE_ARCHIVED` | 用已归档模板**新增绑定** | 该模板已归档，不能新增绑定 | ⚠ O-10：**只挡新增绑定，不挡存量实例化** |
| `BUILTIN_TEMPLATE_UNDELETABLE` | 删内置模板 | 内置模板不可删除，可停用或改可见性 | I-7 |
| `SEGMENT_TEMPLATE_LIMIT` | 绑第三个模板 | 同一议程环节最多绑两个模板 | I-6；[Backlog] 上限 |
| `TEMPLATE_NOT_TRIALED` | 未试跑就发布 | 需先试跑一个项目 | ⚠ **[待定 D-b]**：档案未证实该阻断存在。裁决为「不阻断」时**此码删除** |
| `SKILL_NOT_BOUND` | 运行未绑定的 skill | 本环节未绑定该 skill | I-32 |
| `INSTANCE_NOT_FOUND` | 画布实例不存在 | 找不到该画布 | 越权读也返回它（不泄露存在性） |
| `VERSION_CHANGED` | 乐观并发失败 | 版本已变化，可刷新 / 对比 / 重新提交 | E3 / E4 |
| `CONFLICT_PENDING_ADJUDICATION` | 待裁决期间的结构性写 | 有未裁决的冲突，先在顶部冲突条里选一个出口 | I-18；便签级写**不受此限** |
| `CONFLICT_ALREADY_RESOLVED` | 重复裁决同一冲突 | 该冲突已被裁决 | 幂等：返回既有 `preservedVersionId`，不重复建版本 |
| `NODE_NOT_CONFIRMED` | 未确认节点写回大脑 | 只有组长确认过的节点才能写回组织大脑 | I-29；**服务端闸门** |
| `SOURCE_CHAIN_BROKEN` | 来源链断裂 | 该节点无法回溯到来源转录，已拒绝写回 | I-28 |
| `AI_ROUND_NOT_FOUND` | 回滚不存在的轮次 | 找不到该轮 AI 改动 | |
| `AI_ROUND_SUPERSEDED` | 回滚已被后续覆盖的轮次 | 该轮之后还有改动，不能直接回滚 | ⚠ 见下文「回滚的边界」 |
| `CONTEXT_PACK_UNAVAILABLE` | 起草取不到上下文 | 素材暂不可用，画布内容不变，可重试 | E2 / V10；**不得降级为直查** |
| `DEPENDENCY_UNAVAILABLE` | 存储 / 模型 / 实时通道不可用 | 依赖不可用，已保留当前输入与最后成功数据，可安全重试 | E2 / E3 |
| `REALTIME_DEGRADED` | 实时通道不可用（非致命） | 非实时（已降级为轮询）；未提交输入已保留 | ⚠ **不得伪装已同步**（V14） |
| `AUTHORIZATION_REVOKED` | 过程中权限被撤回 | 权限已变更，后续写入已终止；未提交输入留在本地草稿 | E4 |

⚠ 拒绝响应**不得泄露资源是否存在**：越权读别组画布与「真的不存在」都返回 `INSTANCE_NOT_FOUND`。

---

## 一、模板注册表与发布（F100 F101）

### `listTemplates` —— 后台模板库 / 绑定选择器共用

```
in:  { orgId, filter?: "all"|"published"|"draft"|"archived", forBinding?: boolean }
out: { templates: Array<{ key, displayName, version, status, builtin, visibility,
                          underlyingType, sections: SectionDef[], usageCount }> }
pre: 调用者在该组织有可见性范围内的读权限
err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE
```

⚠ `forBinding: true` 时**必须过滤掉 `draft` 与 `archived`**（I-5）——绑定选择器与后台列表**共用一个端口**，
是为了避免「后台一份过滤、绑定面板另一份过滤」的第二处声明。
⚠ `usageCount` 必须真实统计，**不得估算**。

### `publishTemplate` —— 三段发布流程的第三段

```
in:  { key, version, visibility: "org-wide"|"team-only" }
out: { key, version, status: "published", archivedVersions: TemplateVersion[] }
pre: 组织管理员；发布时必须指定可见性
err: TEMPLATE_NOT_FOUND | ROLE_INSUFFICIENT | TEMPLATE_NOT_TRIALED（⚠ 待定 D-b） | DEPENDENCY_UNAVAILABLE
```

发布新版本时**旧版自动归档**；**已建实例不被改动**（I-4）。

### `trialTemplate` / `archiveTemplate` / `restoreTemplate`

```
UC: trialTemplate —— 试跑（指定唯一一个项目）
  in:  { key, version, projectId }
  out: { key, version, status: "trial" }
  pre: 组织管理员；projectId 必须唯一（不接受多选）
  err: TEMPLATE_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE

UC: archiveTemplate —— 归档（O-10 语义）
  in:  { key, version, confirmed: boolean }
  out: { status: "archived", stillBoundSegmentCount: int }
  pre: 组织管理员；confirmed=false 时只做预检不写库（供确认框显示影响面）
  err: TEMPLATE_NOT_FOUND | ROLE_INSUFFICIENT | BUILTIN_TEMPLATE_UNDELETABLE | DEPENDENCY_UNAVAILABLE

UC: restoreTemplate —— [恢复]
  in:  { key, version }
  out: { status: "draft"|"published" }
  pre: 组织管理员
  err: TEMPLATE_NOT_FOUND | ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```

⚠ `archiveTemplate` 的 `stillBoundSegmentCount` **是契约的一部分**——归档确认框必须显示
「有 N 个 `agenda_segment` 仍绑定此模板」（O-10 ③）。返回 0 与不返回是两回事。
⚠ 归档**不禁止**存量绑定的实例化。若实现成「归档即禁止实例化」，
一场正在进行的工作坊切到该环节会直接失败——这是 O-10 唯一要防的事。

### `setMermaidWhitelist`

```
in:  { orgId, enabled: MermaidDiagramType[] }   // 12 类封闭枚举的子集
out: { enabled: MermaidDiagramType[] }
pre: 组织管理员
err: ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```

⚠ 白名单**只关渲染、不关书写**（I-8）。此端口**不得**提供「删除已写的被禁类型代码块」的能力——
那会违反「不丢内容」。

---

## 二、议程环节绑定与实例化（F102）

```
UC: bindTemplateToSegment
  in:  { agendaSegmentId, templateKey, templateVersion }
  out: { bindingId, templateKey, boundTemplateVersion }
  pre: 引导师；模板为 published 且在调用者可见性范围内
  err: TEMPLATE_NOT_FOUND | TEMPLATE_ARCHIVED | SEGMENT_TEMPLATE_LIMIT
     | ROLE_INSUFFICIENT | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE

UC: bindSkillToSegment
  in:  { agendaSegmentId, skillKey, runMode: "once"|"always-on" }
  out: { bindingId }
  pre: 引导师（组员不可自行加挂，uc-7-4 R7）
  err: ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE

UC: instantiateForSegment —— 现场切议程环节，为每个分组各出一张画布
  in:  { agendaSegmentId, groupIds: GroupId[], idempotencyKey }
  out: { instances: Array<{ instanceId, groupId, templateKey, templateVersion, sourceArtifactId }> }
  pre: 引导师触发或议程状态机自动触发；每组每绑定至多一张（幂等）
  err: ROLE_INSUFFICIENT | DEPENDENCY_UNAVAILABLE
```

⚠ **`instantiateForSegment` 不接受 `TEMPLATE_ARCHIVED`**——归档模板的存量绑定照常实例化（I-5 / O-10 ②）。
⚠ **幂等重放**：同一 `idempotencyKey` 重放返回**同一批** `instanceId`，不产生第二批画布。
现场网络抖动重试是常态，做不到幂等会给每组开出两张空画布。
⚠ **[待定 D-e]**：AC1 还要求「材料清单」一并下发，形态未定，本端口暂不含它。

---

## 三、三段互转、几何归区与布局快照（F103 F104）

```
UC: renderCanvas —— Markdown/mermaid → DiagramModel → fabric 对象
  in:  { instanceId, versionId? }
  out: { diagramModel, sections: SectionDef[], stickies: Sticky[],
         ignoredSyntaxCount: int, ignoredBlocks: Array<{ type, rawLineRange }> }
  pre: 调用者可读该画布（本组可写 / 别组只读）
  err: INSTANCE_NOT_FOUND | NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE

UC: getSource —— [源码] 视图
  in:  { instanceId, versionId? }
  out: { markdown: string, versionId, contentHash }
  pre: 同上
  err: INSTANCE_NOT_FOUND | NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE

UC: updateSource —— 源码可直接手改，改完解析回画布
  in:  { instanceId, markdown, expectedHeadVersion }
  out: { versionId, contentHash, diagramModel, ignoredSyntaxCount }
  pre: 调用者在本组有写权限；无未裁决的结构性冲突
  err: NOT_IN_GROUP | VERSION_CHANGED | CONFLICT_PENDING_ADJUDICATION
     | AUTHORIZATION_REVOKED | DEPENDENCY_UNAVAILABLE

UC: exportSource —— 画布对象 → Markdown（几何归区在此发生）
  in:  { instanceId, stickyPositions: Array<{ stickyId, x, y }> }
  out: { markdown, assignments: Array<{ stickyId, sectionId, nearestFallback: boolean }> }
  pre: 同 updateSource
  err: 同 updateSource
```

⚠ **`exportSource` 的输出里没有坐标**（I-9）。`stickyPositions` 只作为**归区判定的输入**存在，
判定完就被丢弃。任何把坐标塞进 `markdown` 的实现都违反 D-08 ②。
⚠ `nearestFallback: true` 表示该便签落在所有分区框外、按最近框归入——界面据此给**可撤销的归区提示**（E2d）。

```
UC: saveLayoutSnapshot —— [另存布局快照]
  in:  { instanceId, layout, derivedFromVersionId }
  out: { snapshotArtifactId, snapshotVersionId, derivedFrom: versionId }
  pre: 调用者在本组有写权限
  err: NOT_IN_GROUP | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE
```

⚠ 快照是**独立于文本的旁路数据**，只影响本次打开的初始排布，**不参与 Markdown 往返**（I-12）。
保留份数与保留期**读留存策略的「材料保留期」（默认 180 天），不硬编码**（O-01）；
被产出/决策引用的版本属不可删对象，不受保留期约束。

---

## 四、协作、并发与冲突裁决（F105）

```
UC: classifyChange —— 判定表（服务端唯一实现）
  in:  { instanceId, change: ChangeDescriptor }
  out: { classification: "sticky-level" | "structural" }
  pre: —
  err: INSTANCE_NOT_FOUND
```

⚠ 这是**全函数**：判定表七行覆盖全部改动类型（I-15）。前端不得自行归类；
返回 `undefined` / 抛异常都算违反不变量。
⚠ **归属分区变更（跨区移动）归便签级**——早期稿本两处口径打架，O-32 已按「改动作用的对象」裁定。

```
UC: applyStickyChange —— 便签级 LWW
  in:  { instanceId, stickyId, patch: { text?, color?, size?, position?, sectionId? }, clientTs }
  out: { stickyId, appliedTs, supersededRevisionId: RevisionId | null }
  pre: 调用者在本组有写权限
  err: NOT_IN_GROUP | INSTANCE_NOT_FOUND | AUTHORIZATION_REVOKED | DEPENDENCY_UNAVAILABLE
```

⚠ **不弹冲突条**，但 `supersededRevisionId` 必须能查到被覆盖的那次（I-19）。
⚠ **待裁决期间此端口照常可用**（I-18）——现场不能因为一条结构性冲突就全组停手。
⚠ 匿名成员也能贴，`authorRef` 用临时身份标记，且该标记在导出与审计中可追溯（V12）。

```
UC: applyStructuralChange
  in:  { instanceId, change: ChangeDescriptor, side: "doc"|"canvas", expectedHeadVersion }
  out: { versionId } | { conflictId, docSide: ChangeSummary, canvasSide: ChangeSummary }
  pre: 调用者在本组有写权限
  err: NOT_IN_GROUP | VERSION_CHANGED | CONFLICT_PENDING_ADJUDICATION
     | AUTHORIZATION_REVOKED | DEPENDENCY_UNAVAILABLE
```

⚠ **单侧改结构直接同步、不弹冲突条**；只有两侧同时改才产生 `conflictId`（I-16）。

```
UC: resolveConflict —— 三出口
  in:  { conflictId, outcome: "compare"|"keep-doc"|"keep-canvas" }
  out: { adoptedVersionId, preservedVersionId }        // preservedVersionId 永不为空
  pre: 引导师或组长（组员不可裁决）
  err: CONFLICT_ALREADY_RESOLVED | ROLE_INSUFFICIENT | INSTANCE_NOT_FOUND | DEPENDENCY_UNAVAILABLE
```

⚠ **`preservedVersionId` 非空是 D-09 的价值核心**（I-17）。三个出口任意一个丢弃另一侧即数据损坏。
⚠ `outcome: "compare"` 打开并排差异视图后**仍要再选一侧**——它是中间态，不是终态；
本端口对 `compare` 的返回是「差异视图已就绪」，冲突**不消失**。
⚠ **幂等重放**：重复裁决同一 `conflictId` 返回 `CONFLICT_ALREADY_RESOLVED` 并带既有 `preservedVersionId`，
**不重复建版本**。
⚠ **部分成功**：采纳侧写入与另一侧存版本必须在**同一事务**里；只成功一半 = 丢内容。

```
UC: listGroupCanvases —— 左栏「本环节各组画布」
  in:  { agendaSegmentId }
  out: { canvases: Array<{ instanceId, groupName, templateKey, stickyCount,
                           status: "进行中"|"你在这组"|"只读"|"落后",
                           stalled: boolean }> }
  pre: 调用者在该项目有读权限
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE

UC: listProjectCanvases —— 左栏「本项目画布」
  in:  { projectId }
  out: { canvases: Array<{ instanceId, name, structureSummary,
                           syncStatus: "已同步"|"待同步"|"画布领先" }> }
  pre: 调用者在该项目有读权限
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE

UC: computeCompleteness
  in:  { instanceId }
  out: { done: int, defined: int, missingRequiredSections: SectionId[] }
  pre: 调用者可读该画布
  err: INSTANCE_NOT_FOUND | NO_PROJECT_ROLE
```

⚠ `defined` **严格等于**模板 `sections` 条数（I-21）；`status: "落后"` **当且仅当**
`missingRequiredSections` 非空（I-20）——**不与其他组横向比较**。
⚠ `stalled` 阈值**默认 5 分钟、可配置**（O-32）；原型显示的「停滞 8 分钟」是示例值，不是阈值。

---

## 五、AI 起草、角标与轮次回滚（F106）

```
UC: draftFromContextPack —— 一轮 AI 起草
  in:  { instanceId, agentId, contextPackRequest: { groupId, taskType }, idempotencyKey }
  out: { roundId, contextPackId, applied: Sticky[] | suggested: Sticky[],
         warnings: WhitespaceWarning[], baseVersionId, appliedVersionId? }
  pre: 画布的 aiWriteMode 决定落 applied 还是 suggested；取材范围限本组
  err: CONTEXT_PACK_UNAVAILABLE | NOT_IN_GROUP | AUTHORIZATION_REVOKED | DEPENDENCY_UNAVAILABLE
```

⚠ **只经 Context API 取 Pack，不得直查** `segments` / 向量库 / 对象存储（I-27）。
⚠ **只取本组，不跨组混用**（A1 / V8）；拒绝「交给 AI 分析」的受访者片段**不进输入**（O-05，前置过滤，不是出口遮盖）。
⚠ **不阻断**：`warnings` 非空时接口仍**成功返回**且内容真实写入（I-25）。
⚠ **幂等重放**：同 `idempotencyKey` 重放返回同一 `roundId`，不产生第二轮落笔。
⚠ **部分成功**：一轮内若有便签写入失败，整轮回滚为「未落笔」——不接受「补了 2 张、第 3 张失败」的半成品。

```
UC: validateWhitespaceRules —— 留白两规则（纯函数，Node 可跑）
  in:  { markdown, sections: SectionDef[] }
  out: { warnings: Array<{ rule: "section-full"|"missing-citation",
                           sectionId?, stickyId?, message }> }
  pre: —
  err: —（纯函数，无失败模式）
```

⚠ 规则①「每个分区至少留一格空」对 `capacity == null` 的分区**目前断言不出来**（[待定 D-a]）。
⚠ 规则②缺引述的草稿标「无来源 · 待补」，**不计入完成度分子**（I-23）。

```
UC: rollbackAiRound —— 轮次级一键回滚
  in:  { roundId }
  out: { restoredVersionId, contentHash }
  pre: 调用者在本组有写权限
  err: AI_ROUND_NOT_FOUND | AI_ROUND_SUPERSEDED | ROLE_INSUFFICIENT
     | CONFLICT_PENDING_ADJUDICATION | DEPENDENCY_UNAVAILABLE
```

⚠ **原子性**（I-24）：回滚后源码与落笔前**逐字节一致**，不留半撤销状态。
底座是 file-first——回滚 = 指回前一个不可变版本，原版本永不覆盖。
⚠ **回滚的边界（本束替 UC 做的判断，请签核确认）**：UC 只写「一键回滚到该轮落笔前状态」，
**没说这轮之后有人工改动时怎么办**。本契约取 `AI_ROUND_SUPERSEDED`——
后续有他人写入时**拒绝直接回滚**，避免把别人的改动一起吞掉。
若产品要的是「强制回滚」，需要另一个显式端口与二次确认。

```
UC: setAiWriteMode —— 画布级（不是全局）
  in:  { instanceId, mode: "direct"|"suggest" }
  out: { instanceId, mode }
  pre: 引导师或组长
  err: ROLE_INSUFFICIENT | INSTANCE_NOT_FOUND | DEPENDENCY_UNAVAILABLE

UC: acceptSuggestion —— suggest 模式下逐条/批量接受
  in:  { instanceId, suggestionIds: string[] }
  out: { acceptedStickyIds: string[], versionId }
  pre: 调用者在本组有写权限
  err: NOT_IN_GROUP | VERSION_CHANGED | CONFLICT_PENDING_ADJUDICATION | DEPENDENCY_UNAVAILABLE
```

⚠ 模式变更**记审计**；`suggest` 下 AI 内容不进正文（I-26）。

---

## 六、回流知识图谱（F107）

```
UC: listSegmentSkills —— 左栏第三区（议程环节级白名单）
  in:  { agendaSegmentId }
  out: { skills: Array<{ skillKey, displayName, runMode: "once"|"always-on", lastRunAt? }> }
  pre: 调用者在该项目有读权限
  err: NO_PROJECT_ROLE | DEPENDENCY_UNAVAILABLE

UC: runSegmentSkill
  in:  { agendaSegmentId, instanceId, skillKey, idempotencyKey }
  out: { taskId, roundId? }
  pre: 该 skill 已绑定本议程环节
  err: SKILL_NOT_BOUND | CONTEXT_PACK_UNAVAILABLE | NOT_IN_GROUP
     | AUTHORIZATION_REVOKED | DEPENDENCY_UNAVAILABLE
```

⚠ 未绑定即拒绝（I-32），**不是前端不显示**。产出走 UC-7.2 的留白与引述规则、带 AVA 角标、可回滚。

```
UC: confirmNode —— 组长确认，节点进本组小树
  in:  { instanceId, nodeRef, status: "已确认"|"冲突"|"待确认" }
  out: { claimId, status: "accepted"|"contested"|"proposed", provenance }
  pre: 组长；节点来源链完整
  err: SOURCE_CHAIN_BROKEN | ROLE_INSUFFICIENT | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE

UC: mergeIntoPlenaryGraph —— 汇入全场图谱
  in:  { projectId, claimIds: ClaimId[] }
  out: { merged: int, contested: ClaimId[] }
  pre: 引导师
  err: ROLE_INSUFFICIENT | SOURCE_CHAIN_BROKEN | DEPENDENCY_UNAVAILABLE

UC: batchConfirmAndWriteBackToBrain —— [批量确认] → 写回组织大脑
  in:  { projectId, claimIds: ClaimId[], expectedRevision }
  out: { written: ClaimId[], rejected: Array<{ claimId, reason: CanvasError }> }
  pre: 引导师；每个 claim 必须已由组长确认
  err: NODE_NOT_CONFIRMED | SOURCE_CHAIN_BROKEN | ROLE_INSUFFICIENT
     | VERSION_CHANGED | DEPENDENCY_UNAVAILABLE

UC: getNodeProvenance —— 来源链反查
  in:  { claimId }
  out: { groupId, sourceStickyId, quote, segmentId, anchor, transcriptFileRef }
  pre: 调用者在该项目有读权限（观察者只见已发布且脱敏的聚合）
  err: NO_PROJECT_ROLE | SOURCE_CHAIN_BROKEN | DEPENDENCY_UNAVAILABLE
```

⚠ **`NODE_NOT_CONFIRMED` 是服务端闸门**（I-29）：直接调接口绕过界面也必须被拒。
「前端把按钮置灰」不构成这条约束的实现。
⚠ **部分成功是这里的常态**：`batchConfirmAndWriteBackToBrain` 返回 `written` + `rejected` 两个列表，
**不接受「整批失败」也不接受「静默跳过」**——被拒的每一条都要带原因，界面逐条显示。
⚠ **并发**（V9）：两名用户同时批量确认时不静默覆盖，靠 `expectedRevision` 乐观并发；
失败方收 `VERSION_CHANGED` 并可识别最终版本。
⚠ **互斥结论自动标 `冲突` 且不自动择一**（I-30）：`contested` 下支持与反驳边并存，出口仅
`[上台讨论]` / `[标为不确定]`——**本束不提供「系统择一」的端口**。
⚠ **[待定 D-d]**：V5b 要求回流后回填「方法环节格」状态，对应表未确认，本组端口暂不含它。

---

## 七、失败模式穷举自查（签核时请对着看）

| 类别 | 覆盖情况 |
|---|---|
| **并发** | `VERSION_CHANGED`（乐观并发）· 便签级 LWW + `supersededRevisionId` · `CONFLICT_PENDING_ADJUDICATION` · 批量确认的 `expectedRevision` |
| **越权** | `NO_PROJECT_ROLE` / `NOT_IN_GROUP` / `ROLE_INSUFFICIENT`；越权读返回 `INSTANCE_NOT_FOUND`（不泄露存在性）；判定全在服务端 |
| **依赖失败** | `CONTEXT_PACK_UNAVAILABLE` / `DEPENDENCY_UNAVAILABLE` / `REALTIME_DEGRADED`（降级轮询、**不得伪装已同步**） |
| **幂等重放** | `instantiateForSegment` / `draftFromContextPack` / `runSegmentSkill` 带 `idempotencyKey`；`resolveConflict` 重放返回既有结果 |
| **部分成功** | 一轮起草失败即整轮不落笔；冲突裁决两侧同事务；批量写回返回 `written` + `rejected` 两列表 |
| **超时** | 超 1 秒显示加载态、超 10 秒转可离开页面的后台任务（`runSegmentSkill` 返回 `taskId`）；⚠ 具体秒数不写成 AC（O-34 容量基线未经实测） |
| **撤回中** | `AUTHORIZATION_REVOKED`：立即终止后续写；已完成步骤按审计规则保留，未提交输入留本地草稿（E4） |
| **空态** | 模板库为空 / 环节未绑模板 / 本组无转录 / 无已确认节点 —— 一律返回空集合，**不生成示例数据**（V6 / V9 / V13 / V7） |

---

## 八、审计事件（本束必须写的六类 + 五类）

- 模板侧：**新建 / 试跑 / 发布 / 归档 / 恢复 / 白名单变更**（uc-7-1 V9，六类，可按操作者/时间/对象检索）
- 画布侧：**结构性冲突裁决 / 布局快照另存 / 便签删除**（uc-7-3 V15）
- AI 侧：**AI 落笔 / 回滚 / 写权限模式变更**（uc-7-2 V11，按操作者**或触发 agent** 检索）
- 回流侧：**节点确认 / 汇入全场 / 写回组织大脑**（uc-7-4 V10）
- **越权尝试也必须有安全审计记录**（四份 UC 一致要求）

⚠ 审计事件的**存储与查询面属跨束**（phase-00 artifact 束的 `provenance_events` 已有同名缺口）。
本束**不另造一个审计查询面**——见 `coverage.md` 缺口清单。
