# 契约束 `skills` — 支撑材料①：领域模型与不变量

> 洋葱最内层。**不依赖任何外层**：这里出现的东西不知道 HTTP、不知道 PostgreSQL、不知道 Next.js。
> 覆盖 feature：见 `design-signoff.md` frontmatter `covers:`（权威）——本文不复述。
> 依据 UC：`03-skill/uc-3-1` ~ `uc-3-6` 六份全部。
> 裁决：D-06（skill ＝ 声明式契约，phase-1 无沙箱）· O-11（四态状态机）· O-21（两种审核职能不合并）
> · O-37（满意度口径与最小样本量）· O-35（聚合用结构性判据，不用相似度打分）· D-30（引用指向不可变快照）
> · O-01（快照与绑定关系不受留存期约束）· D-32（晋升严格准入）· D-16（脱敏闸门）· D-39（待办负责人恒为人）
> · D-33（知识到期转待复核）· O-02（蓝本 ⊃ 工作流模板）· O-03（协同引导师 ＝ 引导师多实例）

---

## 一、实体与值对象

### `Skill`（实体）—— 逻辑对象，不含契约正文

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `orgId` | | `orgId` 是租户隔离键（RLS） |
| `name` / `duty` | `string` | 名称与一句话职责 |
| `status` | **四态枚举** | `草稿 \| 待审核 \| 已启用 \| 已停用`（O-11，**恰四个**） |
| `archived` | `boolean` | **仅当 `status = 已停用` 时有意义**；归档是已停用的终态子类，**不是第五个状态** |
| `source` | **来源标记枚举** | `CC \| 自建 \| 画布 \| 社区 \| 晋升生成`（五取值；`社区` 入口 phase-1 置灰） |
| `visibility` | `org-wide \| team-only` | `team-only` 时 `teamId` 非空 |
| `currentVersionId` | `SkillVersionId \| null` | 当前生效版本；`草稿` 态可为 null |
| `fileCount` | `int` | phase-2 多文件包预留；phase-1 恒为 1（**不得据此实现打包解析**） |

⚠ `source` **由系统按入口打标**，不是提交人可填字段（I-11）。
⚠ `status` 的四个取值是**封闭枚举**，新增必须走 ADR；`已发布` 一词全仓废弃（I-1）。

### `SkillVersion`（实体）—— **不可变版本快照**，本束的锚

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `skillId` / `versionNumber` | | 版本号在一个 skill 内单调唯一 |
| `contract` | `DeclarativeContract` | 三段契约（下） |
| `contentHash` | `string` | 契约正文的哈希，**发布后永不改变** |
| `state` | `草稿 \| 待审核 \| 生效 \| 已归档` | ⚠ 这是**版本状态**，与 `Skill.status` 是两个字段（见「两个状态字段」一节） |
| `modelRef` | `ModelId` | 只能取 20-model 中「测试通过并已启用」的模型 |
| `publishedBy` / `publishedAt` | | 发布人 = 审核人（不是提交人） |
| `gateResults` | `{ scan: SecurityScanResult, methodReview: ReviewRecord }` | 两道门禁的结论，**已启用必须两道齐全** |

### `DeclarativeContract`（值对象）—— D-06 的三段，缺一不可

1. `promptTemplate: string`（可带 `{{变量}}` 占位符）
2. `ioSchema: { input, output }`（可解析且自洽）
3. `dataScope: DataScopeDeclaration`

⚠ **phase-1 不含可执行代码、不做沙箱**。运行时只做「模板渲染 → 模型调用 → 输出按 schema 校验」，
且这次调用**既不进 LangGraph 图，也不进摄取流水线**（编排边界，UC-3.1 R10）。

### `DataScopeDeclaration`（值对象）

声明这个 skill 允许读到哪些数据。**声明本身不构成授权**：
有效数据范围 ＝ 声明范围 ∩ agent 工具白名单 ∩ MCP 授权范围 ∩ 当次任务权限包 ∩ **Context Pack 实际返回项**。

### `ReviewerFunction`（值对象）—— O-21 的两种职能，**不得合并**

| 取值 | 管什么 | 授予方式 |
|---|---|---|
| `methodology-reviewer` 方法论审核人 | skill 内容审核（UC-3.1/3.4/3.6）＋ 知识晋升审批（UC-3.5）——看**方法对不对** | 组织管理员指派，**组织级**职能授权，可跨团队 |
| `security-reviewer` 安全评审人 | MCP 放行、agent 越权申请——看**权限给不给** | 同上 |

可由同一自然人兼任两个职能，但**同一事项上只能行使其中一种**；
且**同一自然人在同一条晋升链上只能行使一次裁决**（做了晋升审批就不能再审它生成的 skill）。

### `SecurityScanResult` / `ReviewRecord` / `TrialRun`（值对象）

- `SecurityScanResult.verdict ∈ { pass, risk-pending-confirm, reject }`（三态，UC-3.1 R3）。
  `risk-pending-confirm` 的风险项逐条转给审核人，**确认理由必须留痕**（A3）。
- `ReviewRecord = { reviewerId, reviewerFunction, decision: approve|reject, reason, at }`。
- `TrialRun = { input, output, latencyMs, tokens, hitScopes, schemaOk }`；**schemaOk=false 不入库**（E2）。

### `SkillBinding`（实体）—— UC-3.2 的绑定条目

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `segmentId`（议程环节） | | 宿主属 templates 束 |
| `slotKind` | `skill \| canvas-template \| agent-output` | **混合槽的可区分建模**（I-16） |
| `skillId` / `versionId` | | `slotKind = skill` 时非空；**必须记到版本粒度** |
| `deliverRoles` | `Set<引导师\|组长\|组员\|全场共用>` | 「按角色下发」的实际形态 |
| `trigger` | `手动触发 \| 默认开启 \| 常驻` | 对应画布左栏 `[运行]` / `[已开]` / 无按钮 |
| `level` | `template \| instance` | 模板级默认值 vs 项目实例级覆盖 |

### `ProjectOrchestration`（实体）—— 项目实例编排表 ＋ 绑定快照

`{ projectId, sourceTemplateId, sourceTemplateVersion（如「来自后台 v2」）, segments[], bindings[], roleCells[] }`。
**实例级改动不回写模板本体**（I-18）；沉淀回组织只有 `[另存为组织模板]` 一条显式路径。

### `RoleCell`（值对象）→ `Todo`（跨束）

编排矩阵的一格 `{ segmentId, role, text }`。**每一个非空格恰生成一条待办**（I-17），
待办 `assignee` **恒为人**，agent 记在独立的 `executor` 字段（D-39）。
⚠ 待办对象本身属 11-board；本束只负责「生成并同步过去」这条边与失败可见性。

### `ThreadSkillMount`（实体）—— UC-3.3 的临时挂载

`{ threadId, skillId, versionId, mountedBy, mountedAt, removedAt?, origin: temporary }`。
作用域**恰为一条对话线程**（I-19）；与蓝本绑定**在来源上可区分**，否则复盘无法标出偏离。

### `MessageSkillAttribution`（值对象）—— UC-3.6 归因链

`消息 → agent → skill → skillVersion`。**append-only**：摘掉 skill 不回溯历史消息角标（I-20）。

### `MessageRating` / `ImprovementSuggestion` / `ImprovementProposal`

- `MessageRating = { messageId, verdict: up|down, reason?, raterId, at }`，**不公开署名**（D-40 同源）。
- `ImprovementSuggestion`（聚合项）：聚合键 ＝ **结构性判据**
  `(skillId, versionId, agentId, 人工归类标签)`（O-35，**不用相似度打分**）；
  带 `category ∈ { skill 契约可解, 实现层缺陷, 模型能力所限 }`、
  `thumbsDownCount` 与 `caseCount` **两个分别标注口径的计数**（原型 👎9 / 12 个案例）。
- `ImprovementProposal`：对 `vN` 的契约 diff，落为 `vN+1 · 草稿`；
  带 `aiDraftedAt` 与 `humanEdits[]` 两段留痕；`schemaBreaking: boolean`。

### `SatisfactionMetric`（值对象）—— O-37

`satisfaction = 👍 / (👍 + 👎)`（不含未评价、不加权）。
样本量低于最小样本量时**返回「样本不足」这一态，而不是百分比**（I-21）。
⚠ **最小样本量 10 与聚合浮现阈值 3 是「规则已定、数值待产品确认」**——
按本仓既有做法登记进 `packages/contracts/src/thresholds.ts` 的待定阈值表，
**不得在本束再写一份**（见「跨束交叉约束」④）。

### `PromotionLink`（值对象）—— UC-3.5 接收端

`{ skillId, knowledgeItemId, signedDecisionId, reviewConclusionId }`，**双向可达**。
「方法/Skill」是同一份资产的两个视图，**不得建两份互不关联的副本**（原型两处数字均为 86）。

---

## 二、两个状态字段（`Skill.status` vs `SkillVersion.state`）

O-11 断言的是 **`Skill.status` 的取值集合恰为四个**。版本另有自己的状态（草稿/待审核/生效/已归档），
因为「vN 生效、vN+1 在审」是必须能表达的状态（UC-3.4 分支 A 第 1 步）。
⚠ **两个字段不得互相推导也不得合并**：合并会让「skill 已启用但新版本在审」无法表达；
互相推导会让「已停用 skill 的历史版本仍可被进行中项目解析」丢失。
`已归档` 在 `Skill` 侧是 `status=已停用 ∧ archived=true` 的子类，在 `SkillVersion` 侧是 `state=已归档`
——**两处含义不同，命名相同是本束最容易被误实现的一处**，签核时请确认。

---

## 三、不变量

> 判据：**任何时刻都为真，违反即数据损坏。** 写不成断言的是「规则」，已赶到 `usecases.md` 的前置条件里。
> 🔗 ＝ **跨束不变量**，不能在本束单独实现，须提阶段一致性复核。

| # | 不变量 | 怎么断言 |
|---|---|---|
| **I-1** | `Skill.status` 的取值集合**恰为** `{草稿, 待审核, 已启用, 已停用}`；代码与数据中不存在 `已发布` 字面量 | 断言枚举成员集合与契约一致 **且未声明的值不能通过**（⚠ 不写 `toHaveLength(4)`，见 coding-standards 修订 E-4）；全仓 grep `已发布` 在 skill 域为 0 命中 |
| **I-2** | `SkillVersion` 一经发布，其 `contract` / `contentHash` **永不改变** | 对已发布版本的 UPDATE 被拒；改契约后重读旧版本，`contentHash` 不变 |
| **I-3** | `Skill.status = 已启用` ⇒ 其 `currentVersionId` 指向的版本**两道门禁结论齐全且均为通过** | 遍历已启用 skill，断言 `gateResults.scan.verdict ∈ {pass, risk-pending-confirm(已确认)}` ∧ `methodReview.decision = approve` |
| **I-4** | 任一 `ReviewRecord.reviewerId ≠ 该版本的 submitterId` | 构造自审自批，断言被拒 `SELF_REVIEW_FORBIDDEN`；扫描历史记录无违例行 |
| **I-5** | 一次裁决动作的 `reviewerFunction` 与事项类型匹配；同一自然人在同一条晋升链上只出现一次裁决 | 方法论审核人裁决工具白名单越权申请 → 拒；安全评审人 `[批准发布]` skill → 拒；同一人做了晋升审批后再审生成的 skill → 拒 |
| **I-6** | 一个 skill 在任一时刻**至多一个** `state = 生效` 的版本；`vN+1` 发布 ⇒ `vN.state = 已归档` | 唯一部分索引 `(skillId) where state='生效'`；发布后断言 `vN.state = 已归档` |
| **I-7** | 一个 skill 内 `versionNumber` **单调唯一**；并发发布只产生一个新版本号 | 唯一索引 `(skillId, versionNumber)`；并发一方成功、另一方 `SKILL_VERSION_CHANGED` |
| **I-8** | 任何记录「用了哪个 skill」的对象（绑定 / 临时挂载 / 消息归因 / 评价）其 `versionId` **非空** | 四张表 `versionId NOT NULL` ＋ 外键有效；扫描无只记 `skillId` 的行 |
| **I-9** | 项目实例绑定快照的 `versionId` **一经写入不因发新版而改变** | 项目 A 锁 v2 → 发布 v3 → 断言 A 解析出的契约正文仍是 v2 的 `contentHash` |
| **I-10** | `state = 已归档` 的版本**不可被新绑定/新挂载**，但**已有引用仍可解析** | 新绑定选池断言不含归档版本；对已有绑定断言仍能取到契约原文 |
| **I-11** | `Skill.source` 由系统按入口写入，**任何调用方无法写入或改写它** | 提交带 `source` 字段的请求，断言被忽略/拒 `SOURCE_TAG_IMMUTABLE`；改写 `晋升生成 → 自建` 被拒 |
| **I-12** | 版本发布时的 `dataScope` ⊆ **提交人当时的权限**（以提交人权限为上界） | 构造声明读原始转写但未获授权的提交，断言 `DATA_SCOPE_EXCEEDS_SUBMITTER`、**不进待审核队列** |
| **I-13** | 存在任何引用（含历史项目）的 skill，硬删**永久被拒**；`source = CC` 的内置 skill 任何情况下不可删 | 硬删端点断言返回引用清单并拒；对 CC skill 断言拒删、允许停用 |
| **I-14** | `visibility = team-only` 的 skill 对范围外用户**在四个入口都不返回其存在性** | 列表 / 搜索 / 蓝本绑定面板 / 对话加技能四处断言 0 命中，且直读返回 `SKILL_NOT_FOUND`（404 非 403） |
| **I-15** | `SkillBinding.slotKind` 是**封闭三值枚举**，三类内容不得序列化为同一个字符串 | 断言绑定行可按 `slotKind` 分别取出 skill / 画布模板 / agent 产物，且各自主键字段互斥非空 |
| **I-16** | 编排矩阵的每一个**非空**角色格 ↔ **恰一条**待办；待办 `assignee` 恒为人 | 计数断言 `count(非空格) = count(生成的待办)`；断言无 `assignee` 为 agent 的行（agent 只在 `executor`） |
| **I-17** | 项目实例级改动**不改变模板本体** | 改实例编排后断言模板的 `contentHash` / 绑定集合不变；`[另存为组织模板]` 产生**新**模板而非覆盖 |
| **I-18** | `ThreadSkillMount` 的作用域恰为一条 `threadId`：不影响同环节其它对话、不改蓝本与实例编排 | 在第 2 组挂载后断言第 1 组挂载列表不变、模板与实例编排 `contentHash` 不变 |
| **I-19** | 消息的 skill 归因**append-only**：摘除挂载不改写任何历史消息的角标 | 摘除后重读历史消息，断言其 `skillVersionId` 不变 |
| **I-20** | 无法归因到版本的评价**不计入任何 skill 的满意度** | 构造缺 `skillVersionId` 的评价，断言所有 skill 的分母不变、该评价出现在数据质量报表 |
| **I-21** | 样本量低于最小样本量时，满意度字段返回**「样本不足」这一态**，而非数字 | 造 9 条评价断言返回 `insufficient`；造第 10 条断言返回百分比（**数值来自阈值登记表，不硬编码**） |
| **I-22** | `source = 晋升生成` 的 skill 必有非空 `PromotionLink`，且从 skill 可追回**那个被签字的决策**、从知识条目可追回 skill | 双向遍历断言可达；断言 `signedDecisionId` 非空 |
| **I-23** | 自动生成（晋升 / 改进提案）的 skill 或版本，其初始状态**绝不为已启用/生效** | 生成后断言 `status = 待审核`；直调接口置为已启用被拒 `GATE_NOT_PASSED` 并写审计 |
| **I-24** | 每一次 skill 运行**留下一条 `context_packs` 记录**，且有效数据范围 = 声明范围 ∩ Context Pack 实际返回项 | 调用后断言存在对应 `context_packs` 行、可重放其 items/anchor/omissions；断言返回项外的数据未被读到 |
| 🔗 **I-25** | skill 运行时**不存在直连业务库 / 对象存储 / 向量库的代码路径**（只经 Context API） | 架构依赖规则测试（`lint-arch-deps` 同类）断言 skill 运行时模块的 import 图中无 DB/向量库客户端（**跨束**：context-pack / api-kernel） |
| 🔗 **I-26** | 绑定的 `segmentId` 必指向存在的议程环节；环节被删/模板被切时**没有绑定条目被静默丢弃** | 外键有效；切模板/删环节断言先返回「将丢失的绑定与分工」清单，未确认前**零写入**（**跨束**：templates） |
| 🔗 **I-27** | 所有 AI 产出（聚合建议文案、diff 提案、晋升转写稿）**带机器产出标记** | 断言这些对象的 `machineGenerated = true` 且界面渲染出标记（**跨束**：web-kernel 的七态与标记规范） |

### 为什么 I-3 与 I-23 是两条

I-3 是**状态一致性**：任何已启用 skill 都能倒查出两道门禁记录。
I-23 是**入口封堵**：自动生成路径不得跳过门禁。
只做 I-3 不做 I-23，会出现「先置为已启用、再补一条伪造的门禁记录」；
只做 I-23 不做 I-3，历史数据里已有的越权启用不会被任何断言发现。

---

## 四、这个域不负责什么

- **鉴权判定本身**：两层交集鉴权属 phase-00 `identity` 束。本束用例只写前置条件与拒绝码。
- **Context Pack 的装配**：属 `context-pack` 束。本束只要求「只经 Context API」与「留可重放记录」。
- **议程环节 / 工作流模板对象本身**：属 templates 束（O-02：蓝本 ⊃ 工作流模板）。本束定义绑定条目。
- **对话线程与消息对象**：属 chat 束。本束定义归因链与临时挂载条目。
- **待办的看板与流转**：属 11-board。本束只负责生成并同步这条边。
- **画布模板 / agent 产物**：属 canvas / agent 束。本束只保证同一个混合槽内三类**可区分**。
- **晋升队列与知识五态机**：属 14-brain（phase-3）。**本束只做接收端**（见 `usecases.md` UC-P1）。
- **软件反馈通道、灰度发布**：phase-1 只做分流与跳转；灰度列 phase-2。

---

## 五、待人类裁决（缺依据，不臆造）

| # | 待定 | 缺什么 |
|---|---|---|
| D-a | **审核 SLA 与超时行为** | 缺数值。UC-3.1 R10 建议 3 个工作日 + 超时升级给组织管理员，明写「数值无依据，需产品确认」。结构可先做：超时必须有可观测的升级动作，不得静默滞留 |
| D-b | **是否按领域细分审核人**（如财务类 skill 需财务口审核人） | 缺裁决。影响 `ReviewerFunction` 是否要带 `domain` 维度 |
| D-c | **安全扫描的规则集与「有风险项待确认」的判定阈值** | 缺安全负责人输入。结构可先做：三态结论 + 风险项逐条留痕 |
| D-d | **最小样本量 10 / 聚合浮现阈值 3 的最终数值** | 已有规则、数值待产品确认。**落点是阈值登记表，不是本束** |
| D-e | **蓝本绑定是否允许配置为自动跟随新版本** | 缺裁决。本文按「默认不跟随、显式升级」建模；若允许配置需加字段 |
| D-f | **版本号语义是否区分「兼容改动」与「破坏 schema 的改动」** | 缺裁决。影响 `schemaBreaking` 是否要阻断自动跟随 |
| D-g | **停用是否需要审核人签字** | 缺裁决。停用影响方法一致性，可能不宜由维护者单方决定 |
| D-h | **组长自加 skill 是否需引导师逐场开关** | 缺裁决。影响 `ThreadSkillMount` 的前置条件是角色常量还是项目级配置 |
| D-i | **单次对话临时挂载的数量上限** | 缺数值。对照 UC-3.2「超 6 个提示分散注意力」，但那是环节绑定的口径，不可直接搬 |
| D-j | **源知识到期转「待复核」时 skill 是否自动停用** | 缺裁决。本文按「标注不停用」建模（E5） |
| D-k | **一条方法知识能否生成多条 skill** | 缺裁决。影响 `PromotionLink` 是 1:1 还是 1:N |
| D-l | **skill 契约改进 与 agent 行为参数改进 的边界** | 缺裁决。原型的 `FC Facilitator·打断时机过早` 两边都能解释；决定 `[生成 skill 改进 PR]` 该不该出现 |
| D-m | **评价是否对本人可见 / 可撤销 / 可改** | 缺裁决。影响 `MessageRating` 是否需要幂等键与撤销事件 |
| D-n | **`[另存为组织模板]` 与 UC-2.3「提回蓝本」是两条路径**（O-02 连带结论） | 已有结论但落点在 templates 束；本束需确认不重复实现 |
