# 契约束 `canvas` — 支撑材料①：领域模型与不变量

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 S3、不知道 PostgreSQL、不知道 fabric.js。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（**权威**，ADR-023 决策三）。
> 依据 UC：`07-canvas/uc-7-1` · `uc-7-2` · `uc-7-3` · `uc-7-4`（四份全读）
> 裁决：D-08（mermaid + fabric.js + 复用 `fabric-markdown`）· D-09（分粒度并发）· D-10（AI 默认落笔 + 角标 + 回滚）·
> D-11（「六成」作废 → 两条留白规则）· O-09（不改 key、加 `display_name`；源码并入 `packages/`）·
> O-10（归档语义）· O-32（结构化判定：完成度 / 缺料 / 落后 / 停滞 / 结构性 vs 便签级判定表）· O-01（快照保留期）· O-05 / O-36（Context Pack）
> 架构对齐：`docs/architecture/context-engine.md` 第 2.0 节（file-first）、知识平面（`claims` / `claim_evidence` / `ontology_*`）

> ⚠ **本束最大的风险不是接口形状，是「同一事实两处声明」**：模板 `key` / 分区定义表 /
> 12 类 mermaid 白名单 / 三套状态 enum，都同时被画布、大脑、报告、任务四个模块消费。
> 每一条在下文都指明了**唯一事实源**，第二份副本一律视为缺陷。

---

## 〇、F100 是个例外：它约束的不是 API 形状，是「第三方源码引入」

`F100`（`fabric-markdown` 源码并入 `packages/` + ADR 版本锁定）**没有对外 HTTP 形状可签**——
它交付的是一个**被本仓拥有的源码包**和一条**版本锁定的 ADR**。
把它写进 `domain.md` 而不是留给 `packages/contracts/src/canvas.ts`，理由与 ADR-023 决策二一致：
**zod 写得了 `key: enum(19)`，写不了「这 19 个 key 不可改，因为改了会让 164 个既有单测失效」。**

### 它的约束性质（可断言，见 I-24 ~ I-27）

| 约束 | 内容 | 为什么不是「实现细节」 |
|---|---|---|
| **并入形态** | 源码并入 `packages/`，**不是 npm 依赖**（O-09） | 需在库内加 `display_name` 列、按本项目 `agenda_segment` 语义扩展模板元数据；npm 依赖承接不了 |
| **版本锁定** | 库自身依赖 `mermaid ^11.16.0` 与 `fabric ^7.4.0` 的**主版本锁**写进 ADR | 库的逻辑结构取自 mermaid **已弃用**的 `getDiagramFromText`；主版本一跳整条数据链断，且**没有类型错误会提示** |
| **降级路径** | 必须保留**纯 SVG 解析降级路径** | 同上：这是上游弃用 API 的唯一逃生口 |
| **key 冻结** | 19 个内置模板 `key` **一个都不许改** | 164 个既有单测按 key 断言；且 key 是画布/大脑/报告/任务四模块共用的跨模块标识 |
| **上游回流** | ADR 必须写明上游改动怎么回流 | 源码并入 = 从此本仓是它的 owner，没有「等上游发版」这条路 |

⚠ **[待定 —— 需人类裁决]** ADR 编号未分配。签核时请指定它是新开一条 ADR 还是并入既有 ADR。
在 ADR 落地之前，`I-24 ~ I-27` 四条断言无处可锚。

---

## 一、实体与值对象

### `CanvasTemplate`（实体）—— 模板注册表条目，跨模块契约的载体

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `TemplateKey` | **程序契约，源码为唯一权威，不可改**（O-09）。绑定 / 实例固化 / ```` ```canvas ```` 围栏 / 契约测试 / 图谱回流一律用它 |
| `displayName` | `string` | **仅展示层**。19 个内置模板中 5 项与 `key` 不同（见下表），其余 14 项同值 |
| `version` | `TemplateVersion` | 形如 `v3`。发布新版本时旧版**自动归档** |
| `status` | `"draft" \| "trial" \| "published" \| "archived"` | 三段发布流程的状态位（草稿 / 试跑 / 发布 / 归档） |
| `builtin` | `boolean` | 19 个 A0 模板恒为 `true`；**内置不可删**，只能停用或改可见性 |
| `visibility` | `"org-wide" \| "team-only"` | 沿用 `uc-0-3` 的资源可见性字段，**不另起一套** |
| `underlyingType` | `"canvas" \| "mermaid"` | 底层类型 |
| `sections` | `SectionDef[]` | **分区定义表**——完成度分母、「落后」判定、留白规则①的唯一事实源 |
| `usageCount` | `int` | 「被 N 场使用」，**必须真实统计，不得估算** |

### `SectionDef`（值对象）—— 分区定义表的一行，本束最被复用的东西

| 字段 | 类型 | 说明 |
|---|---|---|
| `sectionId` | `string` | 对应 Markdown 中的一个 `##` 段落 |
| `title` | `string` | `##` 标题文本 |
| `required` | `boolean` | 「必填分区」——「落后」与「缺料」判定的输入（O-32） |
| `capacity` | `int \| null` | 可容纳格数。`null` = 无固定格数（见 I-16 的待定项） |

> **唯一事实源声明**：`sections` 只存在于模板注册表。
> 完成度分母、「落后」判定、留白规则①的容量，**全部读它**，任何模块不得另存一份分区清单。

### 19 个内置 A0 模板（`key` ↔ `displayName`，五处差异逐字）

`persona` · `pestel` · `swot` · **`empathy`→`empathy-map`** · `jtbd` · **`journey-map`→`user-journey`** ·
`value-proposition` · `adlib` · **`bmc`→`business-model`** · `mvp` · `freytag` · **`burger`→`burger-comm`** ·
`three-horizons` · `hmw` · `golden-circle` · `three-lenses` · `storyboard` · `ai-strategy` · **`ai-bmc`→`ai-business-model`**

> 权威是 `uc-7-1` R7 的双列表格 + `fabric-markdown` 源码的 `key:` 字段。**这里是引用，不是第二份副本**——
> 签核后落成 `packages/contracts/src/canvas.ts` 的 zod 单源，本文件不再复制字段值。

### `SegmentTemplateBinding` / `SegmentSkillBinding`（实体）—— 绑定在**议程环节**上

`agendaSegmentId` × `templateKey` × `boundTemplateVersion`（记录绑定时的版本号）。
skill 绑定同构：`agendaSegmentId` × `skillKey` × `runMode: "once" \| "always-on"`
（`[运行]` 与 `[已开]` 是两种 runMode 的呈现，**不可混用**）。

### `CanvasInstance`（实体）—— 现场为每个分组实例化的那一张

`instanceId` / `agendaSegmentId` / `groupId` / **`templateKey`** / **`templateVersion`**（固化，永不改写）/
`aiWriteMode: "direct" \| "suggest"`（**画布级**配置，不是全局）/ `sourceArtifactId`。

### `CanvasSourceDoc` / `LayoutSnapshot`（实体）—— file-first 的两份文件

- **`CanvasSourceDoc`**：mermaid / canvas 源码 `.md`，含 ```` ```canvas ```` 围栏与 `模板: <key>`。
  **它是画布的唯一权威内容**。每次保存产生一条新的不可变 `artifact_version`（SHA-256），原版本永不覆盖。
- **`LayoutSnapshot`**：便签坐标、分区尺寸、缩放等呈现状态。**派生文件**，带 `derivedFrom` 指回源码 `.md` 的版本，
  **不覆盖源码、不参与 Markdown 往返**。

> ⚠ 两者都登记为 `artifacts` + `artifact_versions`（artifact 束的模型），在 22-files 可见可下载。
> **本束不重新定义版本模型**，只声明画布必须落在它上面。

### `Sticky`（实体）—— 便签

`stickyId` / `text` / `color` / `sectionId`（**归属分区是便签自身的属性**，见判定表）/
`authorRef`（可为**临时身份**）/ `citation: Citation | null`。

### `Citation`（值对象）—— 引述三件套，缺一不可

`segmentId` + `anchor`（时间码）+ `quote`（原文）。三者**任一为空即整体视为无引述**。
必须落在**数据层**（模板文本可承载的结构或与 `stickyId` 关联的旁路表），确保 Markdown 往返不丢来源。

### `AiDraftRound`（实体）—— 轮次，回滚的粒度

`roundId` / `agentId`（**具体 agent 标识**，不是 `system` / `ai`）/ `baseVersionId` / `appliedVersionId` /
`contextPackId`（可重放）/ `warnings: WhitespaceWarning[]`。

### `ConflictRecord`（实体）—— 结构性冲突的裁决记录

`conflictId` / `canvasInstanceId` / `docSideVersionId` / `canvasSideVersionId` /
`outcome: "compare" \| "keep-doc" \| "keep-canvas"` / **`preservedVersionId`**（另一侧被保存成的版本，**永不为空**）。

### `GraphNodeProjection`（实体）—— 回流到知识平面的投影

映射到架构的 `claims` + `claim_evidence` + `ontology_objects` / `ontology_edges`：

| 画布侧三态 | `claims.status` |
|---|---|
| `已确认` | `accepted` |
| `冲突` | `contested` |
| `待确认` | `proposed` |

### 封闭枚举一览（新增成员**必须走 ADR**）

| 枚举 | 取值 | 出处 |
|---|---|---|
| mermaid 图表类型白名单 | 12 类：`flowchart` `journey` `mindmap` `quadrantChart` `timeline` `pie` `classDiagram` `erDiagram` `sequenceDiagram` `gitGraph` `gantt` `xychart` | uc-7-1 R7 |
| 模板状态 | `draft` `trial` `published` `archived` | uc-7-1 R3 |
| 组画布状态 | `进行中` `你在这组` `只读` `落后` | uc-7-3 R7 |
| 同步状态 | `已同步` `待同步` `画布领先` | uc-7-3 R7 |
| 节点三态 | `已确认` `冲突` `待确认` | uc-7-4 R1（[口径更正]：`已定` / `待决` 档案中不存在） |
| 冲突出口 | `并排比较` `保留文档` `保留画布` | uc-7-3 R7 |
| AI 写权限模式 | `direct`（直接落笔）`suggest`（提交建议待接受） | D-10 |
| 改动分类 | `sticky-level` `structural` | uc-7-3 R7 判定表 |

⚠ **要守的性质是「集合与契约一致 ∧ 未声明的值不能通过」，不是成员数**——
断言写成 `toHaveLength(12)` 会让一个经 ADR 评审的正当新增被自己的测试拦下（修订 E-4 的教训）。

---

## 二、不变量

> 判据：**任何时刻都为真，违反即数据损坏。** 写不成断言的是「规则」，已赶到 `usecases.md` 的前置条件里。
> 🔗 = **跨束**，不能在本束单独实现，须提到阶段一致性复核。

### 模板注册表与发布（F100 F101 F102）

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-1** | 模板 `key` 一经登记**永不改变**，且全局唯一（含组织自建模板不得与 19 个内置冲突） | 唯一索引 `(orgId, key)`；断言对 `key` 的 UPDATE 被拒；自建模板注册用内置 key 返回 `TEMPLATE_KEY_CONFLICT` |
| **I-2** | 内置模板集合 ≡ `uc-7-1` R7 的 19 个 `key`（集合相等），每条带 `displayName`，五处差异逐字一致，其余 14 条 `displayName == key` | 集合相等断言（缺一个或多一个都失败）+ 逐字断言五处差异 |
| **I-3** | 一切绑定 / 实例固化 / 围栏语法 / 图谱回流引用的是 `key`，**从不引用 `displayName`** | 改 `displayName` 后重读既有绑定与实例，`templateKey` 与解析结果逐字不变 |
| **I-4** | `CanvasInstance` 的 `(templateKey, templateVersion)` 写入后**永不改变**；模板发新版不改动任何已建实例 | 发布 `v2` 后重读 `v1` 建出的实例，结构与 `templateVersion` 仍为 `v1` |
| **I-5** | 已归档模板**不出现在绑定选择器**中（新增绑定被拒），但**存量绑定的实例化不被禁止**，且新实例 `templateVersion` = **归档时的版本** | 归档后：选择器列表不含它；对已绑定 `agenda_segment` 触发实例化返回成功且版本 = 归档时版本（O-10） |
| **I-6** | 同一 `agendaSegmentId` 的模板绑定数 **≤ 2** | 绑第三个返回 `SEGMENT_TEMPLATE_LIMIT`；DB 约束或事务内计数 |
| **I-7** | 内置模板**不可删除**（只能停用或改可见性） | 对 `builtin: true` 调删除端点返回 `BUILTIN_TEMPLATE_UNDELETABLE` |
| **I-8** | 白名单**只关渲染、不关书写**：被忽略的 mermaid 代码块在源码 `.md` 中**逐字节保留**，且 `ignoredSyntaxCount` = 被忽略代码块条数 | 关闭 `sequenceDiagram` → 提交含该类型文档 → 渲染结果不含该图对象、`ignoredSyntaxCount == 1`、**再次读取 Markdown 该块原样存在**；重开白名单同一文档正常渲染 |

### 三段数据链与 file-first（F103 F104）

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-9** | **坐标永不写回 Markdown**：导出的 mermaid / canvas 文本中不含任何坐标信息 | 大幅拖动全部节点后导出，断言文本与原文本**逻辑等价且无坐标字段**；⚠ **禁止断言坐标相等**——「重开后位置变了」不是失败判据（D-08 ②） |
| **I-10** | 每张便签**恰好**归属一个分区（几何归区是全函数）；落在所有分区框外的归**最近的框**，不存在无归属便签 | 遍历便签断言 `sectionId` 非空且 ∈ 模板 `sections`；框外便签断言归入几何最近框 |
| **I-11** | 便签换区后导出，它出现在**新分区**的 `##` 段落下且不再出现在旧分区下，**其余内容逐字不变** | round-trip 断言（Node 可跑，不依赖浏览器） |
| **I-12** | `LayoutSnapshot.derivedFrom` 指向一个存在的 `CanvasSourceDoc` 版本，且另存快照**不改变源码 `.md` 一个字节** | 另存快照后断言源码版本 SHA-256 不变；`derivedFrom` 外键有效 |
| **I-13** | 每张画布实例在对象存储中都有**源码 `.md` + 布局快照**两份**真实可下载**文件，且在 22-files 中可见 | 对两份文件 HEAD 断言 200 且 `size > 0`；22-files 列表可见、可下载（🔗 与 artifact / 22-files 束共用同一套 `acl_bindings`） |
| **I-14** | 每次保存产生**新的不可变 `artifact_version`**，旧版本 SHA-256 不变 | 再次保存后重算旧版本 SHA-256，断言相等 |

### 并发与冲突（F105）

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-15** | 改动分类是**全函数**且**在服务端**判定：判定表七行覆盖全部可能改动，前端不得自行归类 | 逐条跑判定表，在**服务端返回的分类字段**上断言（不看界面）；构造未列举改动断言返回明确分类而非 `undefined` |
| **I-16** | 冲突条出现的**充要条件**是「结构性改动 ∧ 两侧同时改」 | 单侧改分区 / 节点 / 连线 / 模板版本 / 图类型：同步生效、**无冲突条**；两侧同时改：**弹冲突条** |
| **I-17** | 冲突裁决三出口**任意一个**执行后，`preservedVersionId` 非空且指向一个**可读取**的版本 | 三个出口各跑一遍，每次断言 ① 采纳侧生效 ② 另一侧版本可读 ③ 冲突条消失。**任一出口丢弃另一侧即数据损坏** |
| **I-18** | 待裁决期间**不接受**新的结构性写入；便签级 LWW 写入**不受影响** | 待裁决态下结构性写返回 `CONFLICT_PENDING_ADJUDICATION`；便签级写返回成功 |
| **I-19** | 便签级 LWW 保留**被覆盖的那一次**改动历史 | 两人同改同一便签：最终值 = 最后写入者的值，且历史中能查到被覆盖的那次；全程无冲突条 |
| **I-20** | 「落后」**当且仅当**存在必填分区为空——**不与其他组横向比较** | A 组必填分区全有内容但只有 3 张便签 → **不是** `落后`；B 组 12 张便签但一个必填分区为空 → **是** `落后`；补齐后自动解除 |
| **I-21** | 完成度分母 ≡ 模板 `sections` 条数（**严格相等，不加权、不估算**）；「无来源 · 待补」不计入分子 | 断言分母与分区定义表条数相等；把某分区草稿全改为「无来源 · 待补」后断言分子不含它 |

### AI 起草、角标与回滚（F106）

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-22** | AI 落笔产生的每个对象，`author` 为**具体 agent 标识**，不得为 `system` / `ai` / 空 | 一轮落笔后遍历新增/修改对象断言 `author` 匹配 agent id 白名单 |
| **I-23** | 一条草稿以「已填」形态存在 **⟺** 它的 `citation` 三件套齐全；缺任一项**必须**为「无来源 · 待补」且不计入完成度分子 | 构造缺时间码 / 缺原文 / 缺 segmentId 三种残缺各断言一次 |
| **I-24** | 轮次回滚是**原子**的：回滚后源码 `.md` 内容与该轮落笔前版本**逐字节一致**，不留半撤销状态 | 回滚后逐字节比对；断言不存在「部分对象已撤销」的中间态；回滚事件入审计 |
| **I-25** | 留白两规则**只提示不阻断**：规则被突破时写入仍成功，响应体带 `warnings` | 同时突破两条规则调用写入：断言**接口成功返回 ∧ 内容真实写入 ∧ warnings 非空**（「有提示」与「未阻断」同时成立） |
| **I-26** | `suggest` 模式下 AI 内容**不进正文**，只进候选区 | 切到 `suggest` 后触发起草：正文逐字节不变，候选区 N 条；接受 1 条后正文只增加该条 |
| 🔗 **I-27** | AI 读画布内容的路径中**不存在**对画布表 / 向量库 / 对象存储的直连查询；每次起草留一条可重放的 `context_packs` 记录，便签 `citation` 的 `segmentId` + `anchor` 与该 Pack 的 item 一致 | 静态检查（无直连 import / SQL）+ 运行时断言；**跨束**：phase-00 `context-pack` |

### 回流知识图谱（F107）

| # | 不变量 | 怎么断言 |
|---|---|---|
| 🔗 **I-28** | **来源链不断**：每个进入图谱的节点至少有一条 `claim_evidence` 指向**可定位**的 Segment + anchor；**断链的节点不得存在于图谱中** | 遍历图谱节点断言四项（来自哪组 / 来源便签 id / 来源引述 / 来源转录片段 id）均非空且可解析到 22-files 的 `transcript.jsonl` 与音频时间码；**跨束**：09-kg / 22-files |
| **I-29** | **只有组长确认过的节点才写回组织大脑**——判定在**服务端**，不是前端按钮禁用 | 直接对未确认节点调用写回接口断言被拒 `NODE_NOT_CONFIRMED`（绕过界面）；确认后同一节点成功 |
| **I-30** | `contested`（冲突）状态下**支持与反驳边并存**，系统不得删除任一侧、不得自动择一 | 构造互斥结论后断言两侧边都在、`status == contested`、无自动择一；出口仅 `[上台讨论]` / `[标为不确定]` |
| **I-31** | 回流**只搬结构与来源，不搬坐标**：图谱节点集合 / 边集合与 `DiagramModel` 一一对应，且**不含任何坐标字段** | 结构 round-trip 断言（Node 可跑） |
| **I-32** | `agenda_segment` 绑定的 skill 是**白名单**：左栏只列出该环节已绑定的 skill，未绑定的 skill 运行接口被拒 | 环节 A 绑 3 条 / B 绑 1 条：列表接口各返回 3 / 1；对 B 调用未绑定 skill 的运行接口被拒 |

### F100 的四条（第三方源码引入的版本锁定与豁免）

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-33** | `fabric-markdown` 以**源码**存在于 `packages/` 下，仓库中**不存在**它的 npm 依赖形式 | 断言 `packages/<pkg>/src` 存在；扫描全仓 `package.json` 断言无 `fabric-markdown` 依赖项 |
| **I-34** | 该包的 `mermaid` 与 `fabric` 依赖为**主版本锁定**，且与 ADR 中记录的版本一致 | 解析 `package.json` 断言版本区间不跨主版本，且与 ADR 声明值相等 |
| **I-35** | **纯 SVG 解析降级路径存在且可被调用**（上游 `getDiagramFromText` 已弃用的逃生口） | 断言降级入口导出存在，且在主解析路径被 mock 成失败时仍返回可用结构 |
| **I-36** | 并入后**没有任何 `key` 被改动**：源码内 19 个 `key` 与契约测试的集合相等 | 集合相等断言（与 I-2 同一份事实源，**不得各写一份清单**） |

---

## 三、[待定 —— 需人类裁决]

> 这些是 UC 明确留白或自相矛盾的地方。**不写进不变量，因为现在断言不出来。**

| # | 缺什么 | 现状 | 需要人类给什么 |
|---|---|---|---|
| **D-a** | **无固定格数分区的留白规则①怎么断言** | `uc-7-2` R7 规则① 说「AI 生成的便签数必须小于该分区可容纳格数」，但对无固定格数的分区只写「至少保留一处可见的空白落位区」——**「一处可见的空白落位区」不是可断言的量** | 一个数值或结构性判据（例：`capacity == null` 时按「AI 便签数 < 该分区人工便签数 + AI 便签数」还是固定留 1 个空位对象？） |
| **D-b** | **「未试跑不得发布」是否阻断** | `uc-7-1` E1b：草稿行 `[发布][试跑]` **并列**，档案未见任何阻断态。V7 却把它写成校验失败态之一 | 裁决：阻断 / 不阻断。**不阻断的话 V7 的后半句要从验收里删掉**，否则写不出通过的测试 |
| **D-c** | **模板选择面板的分类维度** | 原「按阶段浏览：共情/定义/构思/原型/验证」五词**全档案 0 命中**，已删除；档案里唯一成体系的序列是议程环节链，不是模板分类 | 产品定义分类维度，或明确「不分类，只搜索 + 按可见性过滤」 |
| **D-d** | **模板 ↔ 9 个方法环节的对应表** | `uc-7-4` R3 首次提出（`03 用户画像 → persona` 等），**档案未直接给出**。V5b 的「方法环节格状态回填」依赖它 | 确认该对应表。⚠ 它一旦确认就是**第二处声明模板语义的地方**，必须与模板注册表同源（建议落成 `SectionDef` 同级的 `methodStage` 字段，而非另建一张映射表） |
| **D-e** | **AC1b「材料清单」的下发形态** | `uc-7-1` R6 标 [Backlog验收]，档案未见议程环节级材料清单的下发形态 | 形态定义，或明确降级为「本阶段不做」 |
| **D-f** | **蓝本 16 项中第 9 / 10 / 13 项配置面板** | 三个面板**未探明**（proto-05/06/08 未探明清单逐字写着「蓝本 16 项各配置面板」）——F102 的**实际配置入口在哪儿是推断的** | 补抽取原型后确认；在此之前 F102 的 UI 落点不成立 |
| **D-g** | **F100 的 ADR 编号** | 未分配（见本文第〇节） | 指定 ADR 编号或并入既有 ADR |

---

## 四、这个域不负责什么

- **权限判定**：两层交集鉴权、`acl_bindings`、RLS 属 `identity` 束（phase-00）。本束用例的前置条件只写
  「调用者在该项目该组有写权限」，**不重设计鉴权**。
- **版本与不可变原件**：`artifacts` / `artifact_versions` / SHA-256 / 保留期属 `artifact` 束。
  本束只声明「画布必须落在它上面」（I-13 / I-14）。
- **Context Pack 装配、相关度阈值 0.45、`omissions`**：属 `context-pack` 束。本束只声明 I-27（不得绕过）。
- **知识图谱与组织大脑的存储模型**：属 09-kg / 14-brain。本束只声明 I-28 ~ I-31 这几条**回流侧的性质**。
- **通知平面**：单点定义在 `.harness/instructions/` 的通知规范（O-33），本束**只引用不重复定义**。
- **性能类 AC**：O-34 的容量基线**无本项目实测依据**，确认前各 UC 不写性能类 AC。本束照此不写。
