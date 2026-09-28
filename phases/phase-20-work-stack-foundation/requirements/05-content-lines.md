# 三条内容线落地（能力域 work-content）

> 元数据：估点 **62**（研究线 D002 + 研究类 Skill 包 + W001/W006/W009/W057/W060 与「调研到简报」e2e 16 · 产品线 D003/D011 + 产品类 Skill 包 + W027–W032/W002 与「问题到 PRD」e2e 18 · 销售线 D005 + 销售类 Skill 包 + W011–W016/W018 与「线索到合格」e2e（含 CRM 写入审批/拒绝/幂等重放）19 · Board 只读投影（Agent 参与者 + Workflow 运行卡）5 · 81 实体目录全量可见对账 + 全量回归 4；与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。
> 实现轮次：`docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md` 第 7 轮（研究线）、第 8 轮（产品线）、第 9 轮（销售线）、第 10 轮（Board 投影 + 81 实体全量回归；Agent 间转交归 `03-agent-role.md`，G5 基线评测归 `04-eval-gates.md`）。第 7/8/9 轮可在第 6 轮后并行。
> 依据：`docs/proposals/PROP-WORK-STACK-001.md` 修订 R1（需求权威 = `requirements/work-stack-v2`；组合图只认 `WORKFLOW-SKILL-MATRIX.md` 与 `DIGITALHUMAN-COMPOSITION-MATRIX.md`；只有评审 PASS 的实体进入实现）、ADR-116（Agent 即 DigitalHuman）、ADR-117（Skill 元数据走包模型 + `WorkSkillManifest`）、ADR-118（通用 Workflow Runtime；第 6 条 effect-gateway 执行前重查权限；第 9 条 Workflow 固定 Skill 版本）、ADR-119（G0–G5）、ADR-120（工具能力分类）；实体清单 `requirements/work-stack-v2/WORK-STACK-320-LIST.md`「第一阶段」节（81 个，全部 ✅ 通过）；各实体文档 `requirements/work-stack-v2/{digital-humans,workflows,skills}/<ID>-<slug>.md`。

## 现状核实（本文所有"已有"论断的出处）
- Skill 包：`skills/<pack>/<skill>/SKILL.md` + `references/` 目录形态已存在（例：`skills/standard-methods/interview-synthesis/{SKILL.md,LICENSE,references}`）；starter-pack 以 `skills/starter-packs/<packId>/<semver>.json` 分发（例 `skills/starter-packs/standard-methods/1.3.0.json`：`schemaVersion`、`packId`、`packVersion`、`skills[]{stableName,name,semanticVersion,manifest{capabilityId},files[]{path,mediaType,digest,contentBase64}}`）。现有 manifest 只有 `capabilityId`（`WX-S0xx`），**没有** v2 的 S 编号、依赖、工具能力分类、溯源、地区字段——这些由第 2 轮 `WorkSkillManifest` 补，本域只填值。
- 现有 10 个 starter-pack（`data-workflows`、`maau-diagnostics`、`standard-{audio,authoring,canvas,context,document,methods,visual,web}`）中**没有** research/product/sales 三条线的包。
- 组合图：`WORKFLOW-SKILL-MATRIX.md` 第 7/8/12/15/17–22/24/33–38/63/66 行给出本域 19 个 Workflow 的 Skill 集；`DIGITALHUMAN-COMPOSITION-MATRIX.md` 第 8/9/11/17 行给出 D002/D003/D005/D011 的 Workflow 白名单与 Skill 集（D011 另有 3 条 skillGap：Persona/Journey facilitation、HMW framing、Prototype planning）。注意 W013 引用 S009、W018 引用 S035/S036 等跨线 Skill；W017 在矩阵中存在但**不在**第一阶段清单，不实现。
- Workflow 落点：W011 §10 核实 receipt 样板 `apps/api/src/application/research/guided-workflow-receipt-ports.ts`、`packages/contracts/src/agent-runtime.ts` 第 87 行 `ToolSideEffect = ["只读","对外发送","写入外部"]`；并明确**不得**使用平台运营 CRM（`apps/api/src/interface/controllers/crm-contact.controller.ts` 受 `PlatformOperatorGuard` 保护、`apps/ops-console/src/crm-schema.ts`）。`crm.read`/`crm.write`/`notify.inapp`/`chat.post` 分类在基线中 proposed-unwired（依赖 ADR-120 落地）。
- Board：`apps/api/src/domain/board/card-projection.ts` 是对已按权限过滤的任务卡列表的纯函数投影（项目 4 列 / 全局 5 列）；`source-kind.ts` 的来源枚举单源于 `@repo/contracts` 的 `board.SOURCE_KINDS`，今天唯一写路径是手工建卡（`MANUAL_SOURCE_KIND`）。**没有** Agent 参与者或 Workflow 运行的来源类型。

## R1 概览
- **Use Case 名称**：把第一阶段 81 个已评审通过的实体（数字人 4 / Workflow 19 / Skill 58）作为可导入的 Skill 包、代码定义的 Workflow 与官方角色 Agent 交付到产品中，打通研究 / 产品 / 销售三条端到端旅程，并把 Agent 参与者与 Workflow 运行只读投影到 Board。
- **Actor**：
  - 组织成员（研究者、产品经理、设计师、销售代表）：向角色 Agent 发起 Workflow、在人工门审批/驳回、查看产出；
  - 组织管理员：导入三条线的 starter-pack 与官方角色包、授予 `crm.write`/`mail.send` 等能力分类；
  - 审批人（销售经理 / RevOps / 简报发布审阅人）：处理 G1/G2/G3 门；
  - 平台运营：维护 `skills/<pack>/` 源与 starter-pack 版本；
  - 系统 Actor：Workflow Runtime（第 3 轮）、effect-gateway（ADR-118 #6）、Eval Runner 与门脚本（第 6 轮）、Board 投影读模型。
- **目标**：每个实体按其实体文档（阶段表、产出 schema、终态、receipt、评测）实现，不另发明语义；三条旅程在回环模型 + 桩化外部工具上确定性可复现。
- **系统边界**：`skills/{work-research,work-product,work-sales,work-shared}/`（包名为提案名，以 feature 定稿为准）与对应 `skills/starter-packs/*/1.0.0.json`、Workflow 定义（`apps/api/src/.../workflow/definitions/`，依赖第 3 轮目录结构）、官方角色包内容（格式由 `03-agent-role.md` 定义，本域只填 4 份内容）、`evals/work-stack/<ID>/`、Board 投影读模型与只读 UI。不含：运行时/网关/Agent 字段/门脚本本体（01–04 域）、实时语音（ADR-121 独立轨道）、W017 及第二阶段实体。

## R2 前置条件 / 触发条件
- **前置条件**：
  - 第 2 轮 `WorkSkillManifest` + `skill_catalog_entries`、第 3–4 轮 Runtime/effect-gateway/HITL/触发器、第 5 轮 Agent 新字段与 starter-pack toolPolicy 放宽、第 6 轮 Eval Runner 与 G0–G4 门均已合入 main；
  - 目标实体的 `reviews/<ID>.review.md` 结论为 PASS（修订 R1 规则）；
  - 组织已导入对应线的 starter-pack 与官方角色包；发起人对输入资源（知识库、项目、CRM 账户）有读权限。
- **触发条件**：成员在对话中请角色 Agent 执行（Agent 从白名单选 Workflow）；成员在 Workflow 入口手动启动；实体文档声明的事件触发（如 W013 的 `recording_completed` / `calendar_event_ended`，W015 的每周计划触发）；审批人在门卡上点「批准 / 驳回 / 改选」。

## R3 主流程
**研究线（第 7 轮）**
1. 平台运营 → 把 D002 矩阵行的 10 个 Skill（S003、S063、S171、S169、S172、S170、S016、S020、S168、S167）及其 Workflow 依赖（S010、S012、S017、S157、S158、S160、S161、S164）按实体文档 §7 产出 schema 写成 `SKILL.md` + `references/`，frontmatter 带 v2 ID → 构建脚本产出 starter-pack JSON（每个文件 `digest` = sha256）→ 系统校验 manifest（第 2 轮 schema），失败即拒绝入包。
2. 开发者 → 按 W001/W006/W009/W057/W060 文档 §5 阶段表写代码定义图；每个 Workflow 版本固定其 Skill 的 `semanticVersion`（ADR-118 #9）→ Runtime 注册时校验：矩阵行中的每个 Skill ID 都已有 PASS 且已入目录的版本，否则注册失败。
3. 成员 → 对 D002 说「调研 X 并出简报」→ D002 从白名单选 W001 → Runtime 创建实例（固定 Agent 版本与 Skill 版本）→ 依次 S003 检索 → S063 研究综合 → S171 证据评审 → S020 简报 → S010 风险 → 到 G2 审阅门，SSE 推送各阶段状态。
4. 审阅人 → 在 G2 批准 → G3 分发（收件人类别为 `board/regulator/external_partner` 时双签，见 D002 文档第 82 行）→ effect-gateway 重查发布权限后执行发布 → 实例 `completed`，产出带证据引用的简报工件。
**产品线（第 8 轮）**
5. 同步骤 1–2，覆盖 D003 矩阵行 14 个 Skill 与 D011 矩阵行 9 个 Skill（并集去重）以及 W030/W031/W032/W002 额外依赖（S070、S142、S076、S157、S161、S074、S155、S006、S017、S007、S162）；D011 的 3 条 skillGap 以 `skillGaps` 显式登记在角色包，不造新 Skill。
6. 成员 → 对 D003 说「把这个问题写成 PRD」→ W029：S064 问题定义 → S065 机会地图 → S067 PRD → S068 优先级 → S162 指标 → 人工门批准 → PRD 工件发布；D011 可发起 W027/W028/W029/W031/W002（其白名单），不能发起 W030/W032。
**销售线（第 9 轮）**
7. 同步骤 1–2，覆盖 D005 矩阵行 14 个 Skill 与 W015/W016/W018 额外依赖（S035、S033、S010、S009）。
8. 销售代表 → 对 D005 提交线索源 → W011 按其 §5：admit（P1 以发起人身份读 3 个 ref）→ S024 intake → S021 逐公司扩充（并发 5）→ S022 分层 → S025 分诊 → S034 卫生 → G1 线索决定卡逐条批准 → P2 重查审批资格 → effect-gateway 每条 `crm.write` 前 P3 重查写权限 + 乐观并发（携带阶段读到的记录版本）→ 写入租户 CRM → P4 核实收件人读权限后 `notify.inapp` → `completed` 或 `completed_with_holds`。
9. W013：会后按其决策 5 在 G1 一次展示 S028 记录 + S023 三选一 + S029 变更集，批准绑定 `(recordDigest, framingDecision, changeSetDigest)`；新商机只写 `accountId/name/初始阶段/ownerId/sourceMeetingRef`，`amount/closeDate/stage` 进 `deferredProposals[]`；跟进邮件经独立 G2 + `mail.send` 发送，收件人只由服务端从日历外部参会人或商机联系人解析。
**收口（第 10 轮）**
10. 系统 → Board 投影读模型把「Workflow 运行」投成只读卡（来源类型新增值，经 `@repo/contracts` 的 `board.SOURCE_KINDS` 单源扩充）：标题 = Workflow 名 + 发起对象，状态映射 `requested/running→in_progress`、`awaiting_*→review`、`completed*→done`、失败终态→`done` 带失败徽标；卡上显示参与 Agent 头像（发起 Agent + 转交链）；点击跳实例详情。投影仍是纯函数、调用方先按权限过滤。
11. 运营 → 跑全量对账：81 个实体在目录中各可见 1 条、G 门状态非空、三条旅程 e2e 与 `./init.sh` 全绿。

## R4 备选流程与异常流程
- **备选流程**：
  - A1：成员直接从 Workflow 入口启动而不经对话 → 实例 `initiatorAgentVersionId` 为空，白名单校验跳过，但 Skill 版本仍固定；Board 卡不显示 Agent 头像，只显示发起人。
  - A2：Workflow 引用的 Skill 在拥有它的 Agent 上未挂载 → 照常运行（ADR-118 #9），不报错。
  - A3：W013 G1 审批人改选 S023 提议（新建 ↔ 并入已有商机）→ 重算变更集 digest，旧批准失效，需重新批准。
  - A4：研究线无可检索材料 → W001 产出「数据需求说明」而非结论（S003/S063 文档的空结果语义），实例以 `completed_with_holds` 结束，不编造结论。
  - A5：组织未授权 `crm.write` → W011 阶段 7 走 `written_manual`（其决策 6），产出人工核对清单，不报错。
- **异常流程**：
  - E1：Skill 包 manifest 缺 v2 ID / digest 不符 / 引用未 PASS 实体 → 构建脚本退出码非 0，列出实体 ID 与字段；不生成半个 pack。
  - E2：Workflow 注册时固定的 Skill 版本不在目录或门状态低于 G2 → 注册失败 `WORKFLOW_SKILL_PIN_UNRESOLVED`，该 Workflow 在目录显示「不可用」及原因，其它 Workflow 不受影响。
  - E3：D011 请求 W030（白名单外）→ 可见失败 `WORKFLOW_NOT_ALLOWLISTED`，提示可转交 D003（`03-agent-role.md`），不静默降级。
  - E4：CRM 写入时记录版本已变（乐观并发冲突）→ 该条 receipt 标 `conflict`，不覆盖；读回当前值并在决定卡上重新展示差异，要求重新批准；其它条继续。
  - E5：G1 批准后、写回前审批人资格或发起人读权限被撤销（P2/P3）→ 该条不写，标 `forbidden`，落事件；已写条目不回滚但在产出中列明。
  - E6：写入中途崩溃 → 恢复时对未 finalize 的 receipt 先读回 CRM 当前值再决定（W011 §8）；同一 receipt 重放不产生第二次写入（幂等重放 e2e 断言写入次数 = 1）。
  - E7：审批人驳回 G1 → 实例进入驳回终态，零副作用（effect 日志为空），Board 卡显示「已驳回」。
  - E8：G1 超过 `reviewDeadlineHours` → `review_expired`，不自动批准；`recording_completed`/`calendar_event_ended` 触发的 W013 实例在任何组织配置下都**没有**自动批准路径。
  - E9：录音同意不明（W013 决策 7）→ 原话证据可进入内部记录，但不得进入对外邮件、不得作 CRM 字段唯一证据；G2 邮件草稿中相关引用被剔除并提示。
  - E10：Board 查看者对某实例无读权限 → 该卡不出现在投影中（先过滤再投影），不显示占位卡或计数泄漏。
  - E11：某条线 e2e 所需外部工具（`web.search`、`crm.*`）不可用 → 评测用桩；产品运行时对应阶段返回类型化错误，按实体文档「单线索级错误不中断实例」处理。

## R5 权限与可见性
- 组织成员：可向本组织已发布的官方角色发起其白名单内 Workflow；可查看自己发起或被分享的实例与产出；Board 上只看到有读权限的运行卡。
- 审批人：只能审批实体文档规定资格范围内的门（W011：队列经理 / RevOps / 本人线索；W001 G3 外部收件人类别需两人）；不能审批自己发起且文档要求他人审批的门。
- 组织管理员：导入/停用 pack 与角色包、授予能力分类；**不能**绕过人工门，不能把 W013 事件触发实例配置为自动批准。
- 平台运营：维护 `skills/` 源与 pack 版本；**不能**读取租户实例、产出或租户 CRM 数据；不得把平台运营 CRM 用作租户 CRM。
- Agent（系统身份）：所有读写以发起人身份经 effect-gateway 执行，权限在每个效果点前重查；Agent 自身不持有超出发起人的权限。
- 访客 / 非本组织用户：看不到角色、Workflow、运行卡与产出。

## R6 后置条件 / 不包含
- **后置条件**：三条线的 pack 与 4 个官方角色可按组织导入；19 个 Workflow 注册可用并固定 Skill 版本；每个实例有完整 receipt/事件链；外部写入均有对应批准记录；Board 可只读看到运行与参与 Agent。
- **不包含**：W017 与第二阶段 239 个实体（未 PASS / 不在清单）；D011 的 3 条 skillGap 的新 Skill（只登记）；CRM 活动记录写入（W013 决策 6，交 `manualChecklist`）；新建「Opportunity Create」Skill（W013 §16 提议 3，只提议）；从 Board 编辑/拖动运行卡（投影只读）；实时语音数字人。

## R7 业务规则
- 实体语义以其 PASS 文档为准；实现发现文档错误时回写实体文档并重新评审，不在代码里悄悄改。
- 组合只认两张矩阵，代码/pack 中不得出现第二份组合表；lint 核对矩阵引用闭合。
- 没有证据不得产出结论；每个结论字段须带 `evidenceRefs`。
- 所有对外发送 / 外部写入须经人工门 + effect-gateway；批准绑定产出 digest，上游重算即失效。
- Board 投影是派生只读视图，不是第二事实源；实例状态只在 Runtime 表中。

## R8 界面线索
- 角色对话中的 Workflow 运行卡：阶段进度条（取阶段表 stage 名）、当前门、SSE 实时更新。
- 门卡：W011 线索决定卡（逐条批准/驳回/改层级，显示分层、分诊、卫生问题与证据）；W013 G1 三联卡（记录 / 三选一 / 字段级变更集，显示前值→新值）与 G2 邮件确认卡（收件人只读）；W001 G2/G3 简报审阅与分发卡（双签状态可见）；W029 PRD 审批卡。
- 冲突/拒绝态：E4 冲突差异视图、E5/E7 零副作用说明。
- Board：运行卡带 Workflow 图标、参与 Agent 头像叠放、状态徽标（进行中 / 待审批 / 完成 / 已驳回 / 失败），卡无拖拽手柄。
- 原型与签核见 `../contracts/` 对应契约束（`design-signoff.md` 保持 pending，待人类签核）。

## R9 数据与接口线索
- Pack 构建：`skills/<pack>/<skill>/` → `skills/starter-packs/<pack>/<semver>.json`，沿用现有 JSON 结构，`manifest` 扩为 `WorkSkillManifest`。
- Workflow 定义：每个 W 一个模块，导出 `{id, version, skillPins, stages, gates, effects}`；产出 schema 以 Zod 放 `packages/contracts`。
- Board：`board.SOURCE_KINDS` 新增 `workflow_run`（提案名）；读模型 `list-tasks` 合并运行卡时仍先权限过滤。

## R10 非功能
- 三条 e2e 在回环模型 + 桩工具下确定性，单条 ≤ 5 分钟；W011 扩充阶段并发上限 5（文档规定）。
- pack 构建可重复：同一源两次构建 digest 一致。

## R11 依赖与风险
- 依赖 ADR-120 分类落地（`crm.read/write`、`mail.send`、`notify.inapp`）；未落地则销售线只能走 `written_manual`。
- 58 个 Skill 的作者化量大，每条线按 Workflow 需要的 Skill 先行，余下在第 10 轮补齐并过 G5 基线。

## R12 AI Ready 验收线索
- V1：`pnpm harness` pack 构建命令对三条线各产出 1 个 JSON，重复构建 digest 不变；篡改任一 `SKILL.md` 后校验退出码非 0 并指名文件。
- V2：目录 API 返回第一阶段 58 个 Skill + 19 个 Workflow + 4 个角色 = 81 条，ID 集合与 `WORK-STACK-320-LIST.md` 第一阶段节逐一相等（脚本对账，缺一即红）；W017 不出现。
- V3：研究 e2e：D002 发起 W001 → 检索 → 证据评审 → 综合 → 简报 → G2 批准 → 发布；断言简报每条结论有 `evidenceRefs`，effect 日志恰好 1 次发布。
- V4：产品 e2e：D003 发起 W029 → PRD 工件经审批发布；D011 发起 W030 得到 `WORKFLOW_NOT_ALLOWLISTED`。
- V5：销售 e2e：W011 批准路径写入租户 CRM 桩恰好 N 条；驳回路径 CRM 写入 0 次；在写入第 1 条后杀进程再恢复，总写入次数仍为 N（幂等重放）；制造版本冲突断言该条 `conflict` 且未覆盖；G1 后撤销审批人资格断言该条 `forbidden`。
- V6：W013 事件触发实例在组织把 `crm.write` 设为非人工确认时仍停在 G1（无自动批准）；新商机载荷不含 `amount/closeDate/stage`。
- V7：Board：有读权限的成员看到运行卡与 Agent 头像，状态随实例变化；无权限成员的投影中该卡 ID 不存在；项目视图与全局视图卡 ID 集合相同（沿用 `card-projection.ts` 不变量）；运行卡不可拖动。
- V8：矩阵引用闭合 lint：每个 Workflow 定义的 `skillPins` 集合 = `WORKFLOW-SKILL-MATRIX.md` 对应行；每个角色包白名单 = `DIGITALHUMAN-COMPOSITION-MATRIX.md` 对应行。
- V9：`./init.sh` 与全量回归（含引导式研究既有 e2e）通过。
