# 契约束 `canvas` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：F100 F101 F102 F103 F104 F105 F106 F107（26 点）
> ⚠ **上面这一行是派生视图，不是权威。** 束↔feature 映射的权威是
> `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三）。改覆盖范围改那里。
>
> 验收线索来源：四份 UC 的 R12，合计 **57 条**
> （`uc-7-1` 13 · `uc-7-2` 14 · `uc-7-3` 19 · `uc-7-4` 11）

## 怎么读这张表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由（`grep` 核实过，见 `ui.md`）；
填不出来的写 `—（API 层验收）` 或注明「屏未建」，**但不能空着**。

⚠ **R12 里 V 编号不连续、且大量带后缀**（`V3b` / `V2b` / `V4b` / `V5b` / `V6b` / `V8b` / `V8c` / `V16`）。
机械门控的正则只吃 `^- V\d+` 这种写法，抓不到加粗行与带字母后缀的编号——
本表**按 UC 原文逐条列全**，不按门控能抓到的那一部分列。

---

## 一、uc-7-1 R12（13 条：V0 V1 V2 V3 V3b V10 V11 V4 V5 V6 V7 V8 V9）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V0** | 注册表返回 19 个 A0 模板，key 集合相等，五处 display_name 差异逐字，绑定与实例固化用 key 不用 display_name | `listTemplates` → 集合相等断言；I-2 / I-3 / I-36 | ⚠ 后台「画布模板」屏未建 —— API 层验收 | ✅ 契约可断言 |
| V1 | AC1：现场切议程环节，每组自动拿到对应模板与材料清单 | `instantiateForSegment` → 每组一张实例，template_key/version 与绑定一致 | `/projects/[id]/canvas` `canvas-left-panel` `canvas-group-<id>` | ⚠ **缺口 5**（材料清单形态未定） |
| **V2** | 19 个模板各跑 Markdown → DiagramModel → Markdown，结果等价 | `renderCanvas` + `exportSource` 的纯函数层（Node 可跑） | —（API 层验收，刻意不依赖浏览器） | ✅ |
| **V3** | 发布 v2 后 v1 建出的实例仍是 v1；v1 归档后不在绑定可选列表但已有实例仍可打开编辑 | `publishTemplate` / `listTemplates(forBinding:true)` / I-4 | ⚠ 后台「画布模板」屏未建 —— API 层验收 | ⚠ **缺口 1** |
| **V3b** | 归档语义四条：选择器查不到 / 存量绑定仍能实例化且版本=归档时版本 / 返回仍绑定数 N / 恢复后重现 | `archiveTemplate` → `stillBoundSegmentCount`；`instantiateForSegment` 不拒归档；`restoreTemplate` | ⚠ 归档确认框未建（后台屏未建）—— API 层验收 | ⚠ **缺口 1** |
| **V10** | file-first：源码 .md 与布局快照两份文件、22-files 可见可下载、derived_from 指向源码版本、再存新版本旧 SHA 不变 | `saveLayoutSnapshot` + artifact 束的 `artifact_versions`；I-12 ~ I-14 | `/projects/[id]/files`（22-files，属 artifact 束） | ⚠ **缺口 2**（跨束） |
| **V11** | Context API：无直连查询、每次 AI 调用留可重放 context_packs、item anchor 指向源码位置 | `draftFromContextPack` → `contextPackId`；静态检查 + 运行时断言；I-27 | —（API 层验收 + 静态检查） | ⚠ **缺口 3**（跨束） |
| **V4** | 关闭 sequenceDiagram 后渲染结果不含该图、ignored_syntax_count=1、Markdown 中该块原样存在、重开白名单能渲染 | `setMermaidWhitelist` / `renderCanvas` → `ignoredSyntaxCount`；I-8 | `canvas-source-view`（⚠ 顶部「有 N 条语法被忽略」提示条**未建**） | ⚠ **缺口 4** |
| V5 | 六角色遍历；标为「仅某组」的模板对非该组成员不可见 | `listTemplates` 的可见性过滤（沿用 uc-0-3 字段） | `?as=facilitator/groupLead/member/observer` 角色预览轴 | ✅ |
| V6 | 模板库为空、议程环节未绑模板时显示真实空态，不生成示例模板 | `listTemplates` → `[]`；`listSegmentSkills` → `[]` | `?state=empty`（七态预览轴，108 格矩阵已覆盖） | ✅ |
| V7 | 绑第三个模板被拒；未试跑的模板调发布接口被拒 | `bindTemplateToSegment` → `SEGMENT_TEMPLATE_LIMIT`；`publishTemplate` → `TEMPLATE_NOT_TRIALED` | `?state=invalid` | ⚠ **缺口 6**（后半句待裁决 D-b） |
| V8 | 模拟网络/外部依赖失败，输入与最近成功数据保留，错误可解释可重试 | 全端口 → `DEPENDENCY_UNAVAILABLE` | `?state=dep-failed` | ✅ |
| V9 | 模板新建/试跑/发布/归档/恢复/白名单变更六类可检索；越权尝试也有安全审计 | 六类审计事件写入（查询面见缺口 7） | ⚠ 审计检索屏未建（`/admin` 活动流属 identity 束） | ⚠ **缺口 7**（跨束） |

---

## 二、uc-7-2 R12（14 条：V1 V2 V3 V2b V4 V4b V5b V5 V6 V7 V8 V9 V10 V11）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | 规则①：填满的分区各返回一条「分区已满」提示；合规文本返回空提示列表 | `validateWhitespaceRules`（纯函数，Node 可跑） | —（API 层验收；画布内提示条未建，见缺口 4） | ⚠ **缺口 8**（capacity=null 待定 D-a） |
| **V2** | 规则②：无引述草稿标「无来源 · 待补」，不计入已填格数 | `validateWhitespaceRules` + `computeCompleteness`；I-23 | —（「无来源 · 待补」样式未建） | ⚠ **缺口 4** |
| **V3** | 两条规则均被突破时写入接口**成功返回**且内容真实写入，响应体带 warnings | `draftFromContextPack` → `warnings` 非空 + 写入成功；I-25 | `canvas-ai-changes` `canvas-ai-change-list` | ✅ 断言「有提示」与「未阻断」同时成立 |
| **V2b** | 完成度分母与模板分区定义表条数严格相等；必需分区全「无来源」判为缺料且不计入分子；不使用跨组统计比较 | `computeCompleteness` → `done` / `defined` / `missingRequiredSections`；I-21 | ⚠ 左栏 `canvas-group-<id>` 目前只渲染便签数与状态，**完成度未渲染** | ⚠ **缺口 4** |
| V4 | AC1：任取一张 AI 便签，返回转录片段 id、时间码与原文；按时间码可回听 | `renderCanvas` → `stickies[].citation`；`getNodeProvenance` | `canvas-selected`（⚠ 引述三件套与回听入口未渲染） | ⚠ **缺口 4** |
| **V4b** | 起草路径只经 Context API：可重放 pack、segmentId+anchor 一致、100% 可定位、拒绝分析的片段不在 pack 中 | `draftFromContextPack` → `contextPackId`；O-05 前置过滤；I-27 | —（API 层验收） | ⚠ **缺口 3**（跨束） |
| **V5b** | 一轮落笔后新增一个源码 .md 版本（新 SHA），前一版本未被覆盖；回滚即指向前一版本；两版本都可下载 | `rollbackAiRound` → `restoredVersionId`；I-14 / I-24 | `/projects/[id]/files`（22-files） | ⚠ **缺口 2**（跨束） |
| **V5** | 一轮落笔后 author 为具体 agent（不是 system/ai）；回滚后画布逐字节一致；回滚事件可检索 | `draftFromContextPack` → `agentId`；`rollbackAiRound`；I-22 / I-24 | `canvas-ai-changes` `canvas-ai-rollback` `canvas-ai-rollback-confirm` `canvas-ai-rollback-cancel` | ✅ |
| **V6** | 切到「提交建议待接受」后触发起草：正文不变、候选区 N 条；接受 1 条后正文只增加该条 | `setAiWriteMode` + `acceptSuggestion`；I-26 | `canvas-ai-mode-toggle` | ✅ |
| V7 | 五种身份遍历；返回数据与可执行动作严格符合 R5 | 全端口的服务端权限判定 | `?as=` 角色预览轴 | ✅ |
| V8 | 为第 2 组触发起草，产出的引述全部指向第 2 组片段，无其他组来源 | `draftFromContextPack` 的取材范围限本组 | —（API 层验收） | ✅ |
| V9 | 本组尚无转录与材料时显示真实空态，**不生成任何便签** | `draftFromContextPack` → 空集；不产生 round | `?state=empty` | ✅ |
| V10 | 模拟转录服务/模型不可用，画布已有内容不变，错误可解释可重试 | `CONTEXT_PACK_UNAVAILABLE` / `DEPENDENCY_UNAVAILABLE` | `?state=dep-failed` | ✅ |
| V11 | AI 落笔、回滚、写权限模式变更可按操作者或触发 agent、时间、对象检索 | 三类审计事件（查询面见缺口 7） | ⚠ 审计检索屏未建 | ⚠ **缺口 7**（跨束） |

---

## 三、uc-7-3 R12（19 条：V1 V2 V3 V4 V5 V6 V7 V6b V8 V8b V8c V16 V9 V10 V11 V12 V13 V14 V15）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | AC2：便签 X 从 `## 优势` 拖到 `## 威胁` 框内，导出后出现在新段落、不再出现在旧段落，其余逐字不变 | `exportSource` → `assignments`；I-11 | `canvas-stage` `canvas-rule-geometry` | ✅ 纯函数层可跑 |
| **V2** | AC2：便签 Y 落在所有分区框外、几何最近 `## 机会`，导出归入该分区 | `exportSource` → `nearestFallback: true`；I-10 | `canvas-rule-geometry`（⚠ 可撤销的归区提示未建，E2d） | ⚠ **缺口 4** |
| **V3** | 13 种 mermaid 图各跑 mermaid 文本 → DiagramModel → mermaid 文本，逻辑结构等价 | `renderCanvas` 的纯函数层 | —（API 层验收） | ✅ |
| **V4** | 大幅拖动全部节点后导出，文本逻辑等价且不含任何坐标；再次渲染坐标由自动布局决定，**不得断言坐标相等** | `exportSource`；I-9 | `canvas-rule-nocoord`（右栏 warning 边框 + 禁止图标，S-17） | ✅ |
| **V5** | 另存布局快照后重开，节点回到快照位置；同时断言快照未改变 Markdown 一个字节 | `saveLayoutSnapshot` → `derivedFrom`；I-12 | `canvas-save-layout` `canvas-layout-snapshots`（⚠ 行为未渲染，原型待补） | ⚠ **缺口 4** |
| **V6** | AC3：制造结构性冲突后顶部冲突条出现并列出两侧改动；三出口各跑一遍，每次采纳侧生效、另一侧存在可读版本、冲突条消失 | `applyStructuralChange` → `conflictId`；`resolveConflict` → `preservedVersionId`；I-17 | `canvas-conflict-bar` `canvas-conflict-compare` `canvas-conflict-keep-doc` `canvas-conflict-keep-canvas` `canvas-conflict-result` | ✅ 界面已建（`?conflict=on` 触发，S-18） |
| **V7** | 两名组员同时改同一便签：最终值为最后写入者的值，改动历史查得到被覆盖那次，全程不出现冲突条 | `applyStickyChange` → `supersededRevisionId`；I-19 | `canvas-stage`（无冲突条即为通过） | ✅ |
| **V6b** | 判定表逐条：单侧改结构同步不弹条；两侧同改弹条；便签跨区移动走 LWW；判定在服务端返回的分类字段上断言 | `classifyChange` → `classification`；I-15 / I-16 | —（API 层验收，**刻意不看界面**） | ✅ |
| **V8** | AC4：组画布列表每张返回四态之一，项目画布列表返回三态之一，取值超枚举即失败 | `listGroupCanvases` / `listProjectCanvases` | `canvas-group-<id>` `canvas-project-canvas-<id>` `canvas-sync-status` | ✅ |
| **V8b** | A 组必填分区全有内容但只有 3 便签 → 不是「落后」；B 组 12 便签但一个必填分区为空 → 是「落后」；补齐后自动解除 | `computeCompleteness` → `missingRequiredSections`；I-20 | `canvas-group-<id>` 的状态徽标 | ✅ 反证式断言（证明判据不是便签数横向比较） |
| **V8c** | 静默超默认 5 分钟标「停滞」，阈值可配；完成度分母与分区定义表条数严格相等 | `listGroupCanvases` → `stalled`；`computeCompleteness`；I-21 | ⚠ 「停滞」徽标与完成度均**未渲染** | ⚠ **缺口 4** |
| **V16** | 保存后源码 .md 与布局快照两份文件在 22-files 可见可下载；derived_from 指向源码版本；再存新版本旧 SHA 不变 | `saveLayoutSnapshot` + artifact 束版本模型；I-13 / I-14 | `/projects/[id]/files`（22-files） | ⚠ **缺口 2**（跨束） |
| **V9** | 白名单关闭某类型时接口返回 ignored_syntax_count=N，`[源码]` 视图仍能读到被忽略原文 | `renderCanvas` → `ignoredSyntaxCount` / `ignoredBlocks`；I-8 | `canvas-source-view` `canvas-tool-source`（⚠ 顶部提示条未建） | ⚠ **缺口 4** |
| V10 | AC1：画布节点与证据卡能一键回流成果沉淀，回流后带来源画布、版本、操作者 | `mergeIntoPlenaryGraph` / `confirmNode` → `provenance` | ⚠ **画布 → 图谱的回流入口整个未建**（两端已建，中间没有） | ⚠ **缺口 9** |
| V11 | 五种身份遍历；别组画布对组员为只读且写接口全部拒绝；观察者不可见原始内容 | `NOT_IN_GROUP`（服务端拒绝，不是工具条置灰） | `canvas-readonly-notice` + `?as=` | ✅ |
| V12 | 匿名成员贴的便签带临时身份标记，且该标记在导出与审计中可追溯 | `applyStickyChange` → `authorRef`（临时身份） | `canvas-selected`（⚠ 临时身份标记未渲染） | ⚠ **缺口 4** |
| V13 | 新建画布只显示模板骨架与空分区，**不生成任何示例便签** | `renderCanvas` → 空 `stickies` | `?state=empty` `canvas-stage` | ⚠ 当前 stage 是 mock 壳、便签是假数据（S-17） |
| V14 | 实时通道不可用时降级为轮询并显示「非实时」，本地未提交输入保留，**不得伪装已同步** | `REALTIME_DEGRADED` | `canvas-sync-status` + `?state=dep-failed` | ✅ |
| V15 | 结构性冲突裁决、布局快照另存、便签删除三类可按操作者/时间/对象检索；越权尝试也有安全审计 | 三类审计事件（查询面见缺口 7） | ⚠ 审计检索屏未建 | ⚠ **缺口 7**（跨束） |

---

## 四、uc-7-4 R12（11 条：V1 V2 V3 V4 V5 V5b V6 V7 V8 V9 V10）

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| **V1** | AC1：任取全场图谱节点，返回来自哪组 + 来源便签 id + 来源引述 + 来源转录片段 id，四项均非空；断链节点不得存在于图谱 | `getNodeProvenance`；I-28 | ⚠ **全场图谱/事实关系屏未建**（`/brain` 是组织大脑，不是它） | ⚠ **缺口 9** |
| **V2** | flowchart 画布的 DiagramModel 回流成图谱后，节点集合与边集合一一对应且不含任何坐标字段 | `mergeIntoPlenaryGraph`；I-31 | —（API 层验收，Node 可跑） | ✅ |
| **V3** | AC2：环节 A 绑三类 skill 返回 3 条、环节 B 只绑一条返回 1 条；对 B 调用未绑定 skill 的运行接口被拒 | `listSegmentSkills` / `runSegmentSkill` → `SKILL_NOT_BOUND`；I-32 | `canvas-skill-<id>` `canvas-skill-<id>-run` `canvas-skill-<id>-on` | ✅ |
| **V4** | AI 起草但组长未确认的节点调回流接口被拒；确认后同一节点回流成功 | `batchConfirmAndWriteBackToBrain` → `NODE_NOT_CONFIRMED`；I-29 | ⚠ `[批量确认]` 属原型待补，屏未建 | ⚠ **缺口 9** |
| **V5** | 构造两组互斥结论 → 自动标「冲突」且不自动择一，出口为上台讨论 / 标为不确定 | `confirmNode` → `contested`；I-30 | ⚠ 事实关系屏未建 | ⚠ **缺口 9** |
| **V5b** | journey-map 画布回流后，推演流水线中该场景的方法环节 04 格由「正在讨论」变「已完成」，总进度分母保持 4×9=36 | ⚠ 无端口 —— 模板↔方法环节对应表未确认 | ⚠ 推演流水线屏未建 | ⚠ **缺口 10**（待定 D-d） |
| V6 | 五种身份遍历；组员只见本组小树，观察者只见已发布且脱敏的聚合 | `getNodeProvenance` 的脱敏与范围过滤 | `?as=` | ⚠ 本组小树屏**未探明且未建** |
| V7 | 无已确认节点时图谱显示真实空态与下一步，不生成伪节点 | `mergeIntoPlenaryGraph` → 空集 | `?state=empty`（屏未建） | ⚠ **缺口 9** |
| V8 | 模拟图谱/组织大脑服务失败，画布内容与确认状态不变，错误可解释可重试 | `DEPENDENCY_UNAVAILABLE`；写回失败不改画布 | `?state=dep-failed` | ✅ |
| V9 | 两名用户同时批量确认时不静默覆盖，可识别最终版本 | `batchConfirmAndWriteBackToBrain` → `expectedRevision` / `VERSION_CHANGED` | ⚠ 屏未建 | ⚠ **缺口 9** |
| V10 | 节点确认、汇入全场、写回组织大脑三类可按操作者/时间/对象/结果检索；越权尝试也有安全审计 | 三类审计事件（查询面见缺口 7） | ⚠ 审计检索屏未建 | ⚠ **缺口 7**（跨束） |

---

## 五、缺口清单（这一件的真正价值所在）

> 这 10 条是**这一轮设计的产出，不是失败**。契约束的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **后台「画布模板」屏整个未建**。V0 / V3 / V3b 的三段发布流程、归档确认框（含「有 N 个议程环节仍绑定」）、12 类白名单开关区**都没有界面**。`/admin` 下 7 个模块无一是它 | 界面缺口 | F101 需 UI 产出。⚠ 归档确认框的 `stillBoundSegmentCount` 是 O-10 ③ 的显式要求，不是可选装饰——没有它，人不知道归档会影响谁 |
| **2** | **file-first 的两份文件跨到 artifact / 22-files 束**。V10 / V5b / V16 全靠 `artifact_versions` 与 22-files 的可见可下载 | 跨束 | 提**阶段一致性复核**：画布的源码 `.md` 与布局快照必须登记为 `artifacts` + `artifact_versions`，**沿用同一套 `acl_bindings`**——文件浏览器不是权限旁路。与 phase-00 `artifact` 束的 I-5（file-first）是同一条性质 |
| **3** | **Context API 是跨束硬约束，本束只能声明不能实现**。V11 / V4b 要求「无直连查询 + 可重放 pack + 100% 可定位」 | 跨束 | 提一致性复核：起草 / skill 运行 / 图谱下游消费**共用同一个 Context API**，相关度阈值 0.45 与 `omissions` 由 `context-pack` 束单点定义（O-36）。⚠ 若本束自建一份「取素材」的查询，就是第六次「同一事实两处声明」 |
| **4** | **已建成画布屏缺一整层「规则的可见形态」**。留白提示条 / `[清一格]` / 「无来源 · 待补」样式 / 完成度 / 「停滞」徽标 / 「有 N 条语法被忽略」提示条 / 归区可撤销提示 / 临时身份标记 —— **全部无 testid、全部未渲染** | 界面缺口 | 这些不是装饰：**它们是 D-11 两条留白规则与 O-32 四条结构化判定的唯一可见形态**。UC 里写了、界面里没有 ⇒ 规则等于不存在。需 ui-prototyper 补 |
| **5** | **AC1b「材料清单」形态未定**。V1 的后半句「与材料清单」在档案里没有下发形态 | 需裁决 | 见 `domain.md` [待定 D-e]。裁决前 V1 只能验前半句（每组拿到画布），**验收要写清这一点，不能假装全验了** |
| **6** | **「未试跑不得发布」是否阻断未裁决**。V7 把它写成校验失败态，而档案里草稿行 `[发布][试跑]` 并列、无任何阻断 | 需裁决 | 见 [待定 D-b]。裁决为「不阻断」时 `TEMPLATE_NOT_TRIALED` 错误码删除、V7 后半句从验收里删。⚠ **现在这条测试写不出来**——两种实现都能自称通过 |
| **7** | **审计查询面跨束且已有同名缺口**。本束要写 15 类审计事件（模板 6 + 画布 3 + AI 3 + 回流 3），但「按操作者/时间/对象检索」的查询面在 phase-00 `artifact` 束缺口①、`identity` 束缺口①里是同一件事 | 跨束 | 提一致性复核：**统一一个 provenance / 审计查询面**。各束各造一个就是第七次漂移。17-gov 全链路审计是它的下游消费者 |
| **8** | **留白规则①对无固定格数分区断言不出来**。V1 的「每个分区至少留一格空」依赖 `capacity`，而 UC 对 `capacity == null` 只写了「至少保留一处可见的空白落位区」 | 需裁决（含结构判据） | 见 [待定 D-a]。⚠ 这与 D-11 把「六成」改成结构化规则是**同一个毛病的残留**——一条规则里还留着一个不可复现的说法 |
| **9** | **画布 → 图谱的回流整条链没有界面**。事实关系屏、本组小树屏、推演流水线屏、`[批量确认]` 勾选清单**都未建**；uc-7-4 的 11 条 R12 里 7 条的前端消费点填不出来 | 界面缺口 + 跨束 | F107 是 P1（迭代 5 收尾）。⚠ 但 **I-29「只有组长确认才写回大脑」是服务端闸门**，它的验收**不依赖界面**，可先行；界面缺失不是延后这条断言的理由 |
| **10** | **模板 ↔ 9 个方法环节对应表是本文首次提出的**。V5b 的整条验收挂在它上面 | 需裁决 | 见 [待定 D-d]。⚠ 确认时请把它**落进模板注册表**（如 `SectionDef` 同级的 `methodStage`），**不要另建一张映射表**——那会立刻成为第二处声明模板语义的地方 |

---

## 六、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `listTemplates` | uc-7-1 V0 V3 V5 V6 | ✅ |
| `publishTemplate` | uc-7-1 V3 V7 V9 | ✅ |
| `trialTemplate` | uc-7-1 R3 三段发布 · V9 | ✅ |
| `archiveTemplate` | uc-7-1 V3 V3b V9 | ✅ |
| `restoreTemplate` | uc-7-1 V3b ④ · V9 | ✅ |
| `setMermaidWhitelist` | uc-7-1 V4 V9 · uc-7-3 V9 | ✅ |
| `bindTemplateToSegment` | uc-7-1 V1 V3b ① V7 | ✅ |
| `bindSkillToSegment` | uc-7-4 V3（绑定动作在 uc-7-1 R3 步骤 7） | ✅ |
| `instantiateForSegment` | uc-7-1 V1 V3 V3b ② | ✅ |
| `renderCanvas` | uc-7-1 V2 V4 · uc-7-3 V3 V9 V13 | ✅ |
| `getSource` | uc-7-3 R3 步骤 4 · V9（`[源码]` 视图） | ✅ |
| `updateSource` | uc-7-3 R3 步骤 4（源码可直接手改） | ✅ |
| `exportSource` | uc-7-3 V1 V2 V4 · uc-7-1 V2 | ✅ |
| `saveLayoutSnapshot` | uc-7-3 V5 V16 · uc-7-1 V10 | ✅ |
| `classifyChange` | uc-7-3 V6b | ✅ |
| `applyStickyChange` | uc-7-3 V7 V12 | ✅ |
| `applyStructuralChange` | uc-7-3 V6 V6b | ✅ |
| `resolveConflict` | uc-7-3 V6 V15 | ✅ |
| `listGroupCanvases` | uc-7-3 V8 V8b V8c | ✅ |
| `listProjectCanvases` | uc-7-3 V8 | ✅ |
| `computeCompleteness` | uc-7-2 V2b · uc-7-3 V8b V8c | ✅ |
| `draftFromContextPack` | uc-7-2 V3 V4b V5 V8 V9 V10 | ✅ |
| `validateWhitespaceRules` | uc-7-2 V1 V2 | ✅ |
| `rollbackAiRound` | uc-7-2 V5 V5b V11 | ✅ |
| `setAiWriteMode` | uc-7-2 V6 V11 | ✅ |
| `acceptSuggestion` | uc-7-2 V6 | ✅ |
| `listSegmentSkills` | uc-7-4 V3 · uc-7-1 V6（空态） | ✅ |
| `runSegmentSkill` | uc-7-4 V3 | ✅ |
| `confirmNode` | uc-7-4 V4 V5 V10 | ✅ |
| `mergeIntoPlenaryGraph` | uc-7-4 V2 V7 V10 · uc-7-3 V10 | ✅ |
| `batchConfirmAndWriteBackToBrain` | uc-7-4 V4 V9 V10 | ✅ |
| `getNodeProvenance` | uc-7-4 V1 V6 · uc-7-2 V4 | ✅ |

**32 个操作全部有 UC 要求，无孤儿接口。**

⚠ **反向的另一半**：有一条 UC 要求**没有对应端口**——uc-7-4 V5b 的「方法环节格状态回填」。
它不是「接口多余」，是「接口不够」，已列为缺口 10。这正是双向检查要抓的东西。

---

## 七、签核时请重点看这三处

1. **缺口 4 是本束最大的洞，而它长得不像洞。** 已建成的画布屏四道门控全绿、七态矩阵 108 格全覆盖，
   但 D-11 的两条留白规则、O-32 的四条结构化判定（完成度 / 缺料 / 落后 / 停滞）
   **在界面上一个都看不见**。规则写在 UC 里、断言写在 Node 单测里、界面上没有它的形态 ⇒
   现场的人不会知道规则存在。请确认这一层是否随 F105/F106 一起交付。
2. **缺口 6 与 8 是「现在写不出测试」的两条。** 它们不是难，是**依据不足**：
   一条待裁决（未试跑能否发布），一条缺结构判据（无固定格数分区怎么留白）。
   在裁决之前，任何自称通过的实现都可能是空转的。
3. **缺口 2 / 3 / 7 都是跨束的，且都与 phase-00 已有的缺口是同一件事**
   （file-first、Context API、审计查询面）。它们不该在本束解决，
   而应在**阶段一致性复核**统一设计——本仓已五次因「同一事实两处声明」漂移。
