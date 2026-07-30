# 契约束 `files` — 领域模型与不变量（支撑材料）

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 S3、不知道 PostgreSQL。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（**权威**，ADR-023 决策三）。
> 依据 UC：`22-files/uc-22-1` · `uc-22-2` · `uc-22-3` · `uc-22-4`（四份全读）
> 架构对齐：`docs/architecture/context-engine.md` 第 2.0 节（file-first 五条）、第三节（摄取九态 + 幂等键 + prompt injection）、第五节（RLS / 权限沿链路传播 / 交集取最严）、第七节（首批门槛 ③④）
> 裁决：D-15（两级 SLA）· O-01（留存五参数）· D-19（证据已撤回）· D-08（mermaid 权威）· O-17（机密标记材料级）· O-39（PII 五类最小集）· D-03a（`agenda_segment_id`）· D-25（生成内容不进决策依据）· D-13（UC-17.2 最小切片前置）

---

## 零、本束**继承**自 phase-00 `artifact` 束的不变量（不在此重复声明）

⚠ 本仓最高发缺陷是「同一事实声明在两处」（已发生五次）。下表的 14 条不变量的**唯一权威**是
`phases/phase-00-shared-kernel/contracts/artifact/domain.md`。本束**引用**它们，
**不复制、不改写**；本束只声明「phase-01 在它之上**新增**或**收紧**了什么」。

| phase-00 编号 | 一句话 | 本束与它的关系 |
|---|---|---|
| I-1 / I-2 | 版本行不可改 / S3 对象写一次 | **纯继承**。UC-22.2 R7「原件写入后永不覆盖」= 它，不另立一条 |
| I-3 / I-4 | `contentHash` ≡ 字节 SHA-256 / PG 只存指针 | **继承**。本束 N-2 只加「浏览器投影不得产生幽灵节点」这一收紧 |
| I-5 | 每个版本在对象存储有真实可下载文件 | **继承**。UC-22.1 V2 是它的遍历式断言 |
| I-6 | 派生物独立、不覆盖原件 | **收紧**：本束 N-15 追加「`derived_from` 指向 version_id 且 generator 元数据非空」 |
| I-7 | 每个 Segment ≥1 个可解析 Anchor | **收紧**：本束 N-11 追加各模态的**必须保留字段**与文件粒度 |
| I-8 / I-10 / I-11 | pinned 冻结 / 版本号单调唯一 / 快照不可降级不可删 | **继承**。⚠ I-11 与本束删除传播的边界见 N-22（phase-00 缺口 6 的落点） |
| I-9 | `provenance_events` append-only | **继承**。本束的四类审计事件（上传/下载/导出/删除）写同一张表 |
| I-12 | draft 仅创建者可见，404 非 403 | **收紧**：本束 N-25 把「404 非 403」升级为**逐字节同响应**（状态码/体/头） |
| 🔗 I-13 | scope 沿数据链路传播、只收紧不放宽 | **具体化**：本束 N-14 给出物化侧的判定（取全部来源的最严结果） |
| 🔗 I-14 | 下游引用只能指向 pinned | **继承**。本束不重新设计引用门控 |

---

## 一、实体与值对象（本束新增的部分）

### `FileNode`（投影，不是新存储）

⚠ **文件浏览器是 `artifacts / artifact_versions` 的投影，不是另一套存储**（架构 2.0.3）。
`FileNode` 是读模型，**不得**为它单建一张目录表——建了就必然与证据平面漂移。

| 字段 | 类型 | 说明 |
|---|---|---|
| `artifactId` / `currentVersionId` | | 指向 phase-00 的实体 |
| `sourceType` | **八值枚举**（见 N-3） | 一等字段，**不从 MIME 推断** |
| `agendaSegmentId` | `AgendaSegmentId \| null` | D-03a 唯一环节字段；null 落「未归入环节」节点 |
| `uploader` | `{ type: "human"\|"agent", actorId, agentRunId? }` | agent 必须显示为 agent（N-5） |
| `visibilityScope` | 全场 / 本组 / 私有 / 仅某团队 | 判定属 identity 束，本束只投影 |
| `confidential` | `boolean` | O-17：材料级、上传时人工勾选、默认继承项目级 |
| `ingestionState` | 九态之一 | 非 `READY` 的行必须显式可见 |
| `integrity` | `"ok" \| "failed"` | SHA-256 校验态 |
| `synthesized` | `boolean` | 生成内容醒目标记（继承 phase-00） |

### `IngestionRun` 的**界面契约**部分（本束新增）

phase-00 定义了九态与幂等键。本束新增**每一态的界面出口**是契约的一部分：

```
UiState = { state, label: NonEmptyString, exits: Exit[] }
```
非终态的 `exits` 为空数组 = 缺陷（N-8）。没有出口的中间态是黑洞，用户只会反复重传。

### `MaterializationSpec`（值对象）—— 七类来源的**固定文件清单**

`sourceType → 必须产出的文件名集合`，见 `uc-22-3` R3 第 2 步的七行表。
七个固定文件名：`responses.csv` `schema.json` `messages.jsonl` `transcript.jsonl`
`notes.md` `citations.json` `provenance.json`。**这是契约，改名走迁移**（N-23）。

### `DeletionTask`（实体）—— 两级 SLA 的载体

| 字段 | 说明 |
|---|---|
| `scope` | 撤回项 → 级联子集的裁剪（部分撤回，A3）。⚠ 映射表**[待定]**，见缺口 |
| `logicalInvalidatedAt` | 逻辑失效完成时刻，SLA ≤300s（D-15） |
| `physicalDeletedAt` / `receiptId` | 物理删除 ≤30 天并出回执 |
| `cascadeResults` | 六类各自的成功/失败；任一失败 ⇒ `partial-failed` |
| `status` | `queued \| logically-invalidated \| partial-failed \| completed \| revoked` |

⚠ **`partial-failed` 是本束最危险的态**：半完成的删除比不删更危险（UC-22.4 E3）。

### `RetentionPolicy`（值对象）—— O-01 五参数

材料保留期 180d / 留痕保留期 180d / 删除宽限期 30d / 知识有效期 6·12·24 月 / 审计保留期 1095d。
**各有默认值、项目级可覆盖（D-14）、一处配置多处消费、不得硬编码**（N-20）。

### `DeletionReceipt`（值对象）

至少含：对象标识、哈希、删除时间、执行者、覆盖范围、**已出域内容清单**。
⚠ 格式与是否需可验证签名属 **O-39 未定项**，**[待定 —— 需人类裁决]**。

---

## 二、不变量

> 判据：**任何时刻都为真，违反即数据损坏**，且**能写成断言**。
> 编号 `N-n`（New，phase-01 新增），刻意与 phase-00 的 `I-n` 区分，避免两套编号互相冒充。
> 🔗 = 跨束，不能在本束单独实现，须提**阶段一致性复核**。

| # | 不变量 | 怎么断言 |
|---|---|---|
| 🔗 **N-1** | 同一 principal、同一时刻，**文件浏览器可见集合 ≡ Context API 检索可见集合** | 四种角色各取 `listProjectArtifacts` 的 `artifactId` 集合与 `searchContext` 返回的 `artifactVersionId` 去重后所属 artifact 集合，断言四组**逐一相等**（V1·22-1） |
| **N-2** | 浏览器返回的每个可见节点都**必有**可下载对象——不存在只有元数据的幽灵节点 | 遍历列表全部节点调 download，断言零个失败（V2·22-1）。这是 phase-00 I-5 在投影层的收紧 |
| **N-3** | `sourceType` 枚举**封闭**，新增必须走 ADR；且 `sourceType` **不由 MIME 推断**（它是一等字段） | 断言 DB CHECK / zod enum 与唯一词表逐值相等；断言无从 MIME 推断 `sourceType` 的代码路径。⚠ **词表本身有两套且对不上，见第二·五节 T-11 —— 在裁决前这条断言写不出「等于什么」** |
| **N-4** | artifact 相关表中**不存在** `design_facet_id` 与 `method_stage_id` 列；环节字段恒为 `agenda_segment_id`（D-03a） | 查 information_schema 断言两列不存在（V8·22-2、V12·22-3） |
| **N-5** | `uploader.type == "agent"` ⟺ `agentRunId` 非空 | 全表扫描断言不存在 `type=="human"` 且 `agentRunId` 非空的行，反之亦然（V10·22-1） |
| **N-6** | 幂等键 `(contentHash, pipelineVersion, parserVersion)` 相同 ⇒ **不产生第二组 Segment** | 同文件连传两次，断言 segments 行数差值 == 0；`artifact_versions` 不新增；`provenance_events` +1（V1·22-2） |
| **N-7** | `ingestionState ≥ STORED` ⇒ 原件可下载；`ingestionState != READY` ⇒ **不进检索召回**。两个标记**独立** | 卡在 EXTRACTED 失败态时断言 download 200 且 `searchContext` 零命中（V3·22-2） |
| **N-8** | 任一**非终态**的 `UiState.exits.length ≥ 1` 且 `label` 非空 | 遍历九态断言无空 `exits`（V2·22-2） |
| **N-9** | 恶意扫描不通过 ⇒ **正式区无该对象** ∧ **留痕记录存在且不可下载** | EICAR 上传后断言正式区 HEAD 404、留痕行存在含哈希与扫描结论、其 download 被拒（V4·22-2） |
| **N-10** | 每个已物化 `sourceRef` 的**文件名集合 == `MaterializationSpec` 该行的集合**（不多不少） | 七类各造一个，断言集合相等且缺文件数为 0（V1·22-3） |
| **N-11** | 文件粒度：一个会话 ⇒ **恰 1 个** `messages.jsonl`；一场访谈/工作坊 ⇒ 恰 1 组文件。**Segment 仍精确到消息** | 50 条消息断言文件数 == 1、行数 == 50、segments == 50 且 `anchor.messageId` 唯一非空（V2·22-3） |
| **N-12** | `sourceType == "generated"` ⇒ `synthesized == true` ∧ `provenance.json` **七键齐全**（prompt/model/model_version/run_id/context_pack_id/generated_at/triggered_by）；否则**不得进 `READY`** | 扫描全部 generated 断言缺溯源数为 0；人为构造缺 `model` 的生成事件断言停在 `REVIEW_PENDING`（V6·22-3） |
| 🔗 **N-13** | `evidencePolicy == "primary-only"` 的检索结果中 `synthesized` 项数**恒为 0**，且该判定**在服务端**（客户端伪造值无效） | 篡改请求体的 `evidencePolicy` 后断言服务端仍按最严执行（V5·22-3）。跨束：判定面属 context-pack |
| 🔗 **N-14** | 物化产物的可见性 = 其业务对象与**全部引用来源**可见性的**最严结果**（只收紧不放宽）；无法判定时 **fail-closed** | 对话引用机密材料后断言其 `messages.jsonl` 敏感级 ≥ 该材料（V7·22-3）。这是 phase-00 🔗I-13 的物化侧具体化 |
| **N-15** | 每个 `DerivedRepresentation` 的 `derivedFrom` 指向**具体 `artifactVersionId`**（非 `artifactId`），且 `generatorModel` / `generatorVersion` 非空 | 外键类型断言 + 全表断言两字段无 NULL（V3·22-4） |
| **N-16** | 删除完成后：列表**不含**它 ∧ 其**每一个**版本与**每一个**派生物的 download 返回 404，且与「不存在」**同响应** | 删除后逐版本、逐派生物调 download 断言 404 且响应与随机 id 逐字节相同（V4·22-4） |
| **N-17** | 六类级联**全部**成功才可 `completed`；任一失败 ⇒ `partial-failed` ∧ **无回执** | 注入图边失效故障，断言状态 `partial-failed`、回执不存在、告警产生（V7·22-4） |
| **N-18** | `logicalInvalidatedAt − requestedAt ≤ 300s`；`receiptId` 非空 ⟺ 物理删除已完成 | 打点断言 ≤300 秒；宽限期调 0 后断言对象 key（含全部历史版本与删除标记）不存在且回执生成（V6·22-4） |
| **N-19** | `legalHold == true` ⇒ **不进待删除队列** ∧ 人工删除被拒 ∧ **不出回执**（含虚假回执） | 施加 hold 后把保留期到期时间调到过去，断言未入队；删除请求被拒；解除后再扫描入队（V8·22-4） |
| **N-20** | O-01 五参数**从配置读取**，留存判定逻辑中不出现硬编码字面量 | `grep -r "180"` 断言不出现在留存判定路径；项目级改 30 后断言第 31 天入队而其它项目仍 180（V11·22-4） |
| **N-21** | 对象存储开启版本化时，物理删除必须清除**所有历史版本与删除标记** | 删除后 `list-object-versions` 断言该 key 零条目（V6·22-4）。⚠ 与 phase-00 I-2（object-lock）**互相矛盾的部署面**，见缺口 5 |
| **N-22** | 被删对象的**固定快照仍存在**，但其引用项被标「证据已撤回」——**不是静默 404、不是空白** | 删除被快照引用的 artifact，断言快照行仍在且引用项 `status == "evidence-withdrawn"`（V12·22-4）。**这是 phase-00 I-11「快照不可删」与合规删除共存的唯一形态**，即 phase-00 缺口 6 的契约桩 |
| **N-23** | 目录结构与文件名是契约：改名后**旧路径引用仍可解析**（重定向或别名命中），且变更被记录 | 改名后断言旧引用不 404 且命中别名；断言 `renamed` 事件存在（V11·22-1） |
| **N-24** | 下载 URL **短时效 ∧ 绑定 principal ∧ 一次性**；第二次使用被拒 | 同一 URL 二次调用断言被拒；换 principal 调用断言被拒；过期后断言被拒 |
| **N-25** | 无权访问的 `artifactId` 与不存在的 `artifactId` 的响应**状态码/响应体/响应头逐字节相同** | 两次请求 diff 断言完全一致（V6·22-1）。收紧 phase-00 I-12 的「404 非 403」 |

### 依据不足、写不成断言的（**[待定 —— 需人类裁决]**）

| # | 缺什么 | 影响哪条断言 |
|---|---|---|
| **T-1** | **单文件 / 单次批量 / 解压后总量 / 嵌套层数 / 条目数** 五个上限数值（uc-22-2 R10） | E1 与 V5 的断言写不出「上限值」这一半。UI 原型用了 2 GB / 20 份 / 3 层**占位**，不是裁决 |
| **T-2** | **文件类型白名单**，尤其 `.html` / `.svg` 是否允许（uc-22-2 R10） | 直接决定预览渲染的安全设计（内联 vs 隔离域名 attachment），N-2/N-24 的边界随之变 |
| **T-3** | **五个物化时限**（问卷 60s / 对话去抖 5min + 终版 60s / 画布 30s / 研究 5min / 音频 5min，均为 `[设计]` 提议） | AC2「物化是同步契约」写不出断言 ⇒ V3·22-3 无法执行 ⇒ file-first 与「事后导出」的分界线失守 |
| **T-4** | **能否删除单个中间版本**（uc-22-4 R10 🔴） | 若可删，N-16 与证据链完整性冲突（v2 被 Claim 引用则该 Claim 悬空）。倾向「不可删单版本」，但需合规+产品共同拍板 |
| **T-5** | **宽限期内删除是否可撤销**（A5） | `revoked` 是否为合法状态。与对受访者的「已删除」承诺可能直接冲突 |
| **T-6** | **观察者是否有下载权**；**含机密标记文件的搜索命中片段是否展示**（uc-22-1 R10 🔴 两条） | 前者定义客户交付边界；后者是 O-17 材料级粒度的直接后果（展示则片段脱离本地模型路由；不展示则搜索对机密材料失效） |
| **T-7** | **删除回执的格式、送达方式、是否需可验证签名**；**法定留存清单**（O-39 ①②③，明标「必须等外部输入」） | `DeletionReceipt` 的形状定不下来；N-19「不出虚假回执」的正面形态无法验收 |
| **T-8** | **撤回项 → 级联子集的映射表**（部分撤回 A3：撤回「AI 分析」不删录音） | `DeletionTask.scope` 的枚举与裁剪规则；V10·22-4 无法穷举 |
| **T-9** | **`REVIEW_PENDING` 的审核人角色**（负责人 / 合规 / 两者皆可）；**组员能否勾选机密标记** | 与 phase-00 缺口 7 同源。本束已给出**结构性判据**（机密 ∨ PII 五类 ∨ 解析质量低 ⇒ 必入 `REVIEW_PENDING`，不得静默入库），**阈值与审核人仍缺** |
| **T-10** | **批量导出的规模上限、导出包有效期、是否需二次审批** | E2 的断言与 `EXPORT_LIMIT_EXCEEDED` 的触发点 |
| 🔴 **T-11** | **来源类型词表有两套且对不上** —— 哪套是权威、`workshop`/`canvas` 是否进契约 | N-3 整条。**这不是「还没定」，是「已经定了两遍且不一样」**，详见下一节 |

---

## 二·五、🔴 `sourceType` 词表分歧（**必须由人类裁决**）

> 证据来自并行的 files UI 原型 agent（commit `8e8282a`）与本轮契约核对，**两侧独立发现同一件事**。
> 磁盘上现存**两份**来源类型定义，且**不是同一份的两种写法**——值的名字和个数都不同。

**两份定义的位置（都在仓库里，都在被消费）**：
- `packages/contracts/src/artifact.ts` 的 `ArtifactSource` —— **7 值**（phase-00 契约，zod 单一事实源）
- `apps/web/lib/mock/files.ts` 的 `SourceType` + `SOURCE_META` —— **8 值**（已建成界面的左树八节点直接由它渲染）
- 四份 UC（`uc-22-1` R3 第 2 步 / `uc-22-3` R3 第 2 步）写的也是 **8 值**那套

### 逐值对照（8 × 7）

| # | mock / UC（8 值） | 契约 `ArtifactSource`（7 值） | 关系 |
|---|---|---|---|
| 1 | `file` | `upload` | ⚠ **同义异名** |
| 2 | `survey` | `survey` | ✅ 一致 |
| 3 | `interview` | `interview` | ✅ 一致 |
| 4 | `conversation` | `conversation` | ✅ 一致 |
| 5 | `research` | `research-run` | ⚠ **同义异名** |
| 6 | `generated` | `ai-generated` | ⚠ **同义异名** |
| 7 | `workshop` | **（无）** | 🔴 **契约缺失值** |
| 8 | `canvas` | **（无）** | 🔴 **契约缺失值** |
| — | **（无）** | `prototype-run` | 🔴 **UC 侧无对应**，归属未定 |

- **3 对同义异名**：`file↔upload` · `research↔research-run` · `generated↔ai-generated`
- **2 个契约缺失值**：`workshop`、`canvas` —— 而**已建成界面已经把它们当一等来源画进左树**，
  UC-22.3 的七类物化清单也逐行给了它们的固定文件（工作坊 → 音频 + `transcript.jsonl` + 白板照片；
  画布 → mermaid 源码 `.md` + 布局快照，D-08）。**它们不是可有可无的边角值。**
- **1 个反向孤儿**：`prototype-run` 在四份 UC 的八类里没有位置，是并入 `canvas`、并入 `generated`、
  还是保留为第九类，**未定**。

### 为什么这一条被单独拎出来

CLAUDE.md 逐字写着「**同一事实不得声明在两处**——本项目已五次因此漂移」。
这是**同一个字段的第二份定义**，且**已经漂了**（不是「将来可能漂」）。
更早一步的证据：`uc-22-1` R10 的跨模块契约那条也逐字要求
「来源类型八值枚举必须与 12-survey / 06-itv / 05-rec / 08-chat / 07-canvas / 研究 Studio 的产出侧
**同一份定义，不得各建各的**」——要求早就写了，**没有脚本，于是没落地**。

### 裁决前的纪律（**这一条是给实现者的，不是建议**）

🔴 **在人类裁决前，不得创建 `packages/contracts/src/files.ts` 的 `sourceType` 枚举。**
现在写下去就是**第三份副本**，而收敛三份比收敛两份贵得多。

裁决须回答三件事，缺一不可：
1. **哪套词表是权威**（7 值那套改名扩容，还是 8 值那套取代它）；
2. **`workshop` / `canvas` 进不进契约**（不进的话它们归并到哪个既有值，且左树七个系统节点怎么改）；
3. **`prototype-run` 归到哪里**。

裁决落地后的形态应是**单一 `ArtifactSource`**，
`apps/web/lib/mock/files.ts` **import 它**而不是自己再声明一份（mock 必须从契约生成，不许手写）。

### 同类的第二处（同一形状，今天还没漂）

`apps/web/lib/mock/files.ts` 的 `IngestState` 是摄取九态（+`REVIEW_PENDING`）的**本地副本**，
未从契约 `IngestionStatus` import。**今天两边值完全一致**，字段名此前已按一致性复核 B-6 对齐
（`status` 不叫 `state`），但**枚举清单本身仍是第二份——改一处即漂**。
建议与 T-11 一并收敛，同一次动作。

---

## 三、这个域不负责什么

- **权限判定**：两层交集鉴权 + RLS 属 `identity` 束。本束**不自定义任何权限语义**（uc-22-1 R10 逐字要求），
  只做投影与 fail-closed。⚠ 但 **N-1 横跨 files + identity + context-pack 三束**，须一致性复核统一设计。
- **原件/版本/快照的不可变性**：属 phase-00 `artifact` 束（I-1…I-11），本束继承。
- **Context Pack 装配与 `evidencePolicy` 判定面**：属 `context-pack` 束。本束只保证 N-12 的标记正确。
- **各业务模块自身的功能**：问卷设计 / 访谈进行 / 画布编辑属 12-survey / 06-itv / 07-canvas。
  ⚠ 但它们**不得自建入库路径**，必须复用本束摄取链路——否则幂等键与权限传播会有多套实现。
- **六类级联中第 ⑤⑥ 类的实现**：`ontology_edges` 属 09-kg、报告段落标记属 10-report/13-deliv。
  本束只提供 F47 的**契约先行桩**与调用契约。
- **受访者侧撤回界面与四项独立同意**：属 17-gov/UC-17.2 与 06-itv。本束是它的项目侧落点。
