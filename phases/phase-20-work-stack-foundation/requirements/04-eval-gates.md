# Work Stack 评测与发布门（能力域 work-eval）

> 元数据：估点 **30**（套件格式契约 + S003 首个套件 6 · `pnpm harness eval --entity` 回环运行器与报告 7 · `lint-work-stack-gates` G0–G4 门脚本 + 反证测试 7 · 门状态回写 `skill_catalog_entries` + 目录门状态展示 4 · G5 对比基线批量评测与 verified 通道联动 6；与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。
> 实现轮次：`docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md` 第 6 轮（验收：S003 评测可跑并出分；门状态显示在目录；门脚本反证测试通过）与第 10 轮（58 个 Skill 的 G5 基线评测、全量回归）。
> 依据：ADR-119（评测与发布门，权威）、ADR-117（门状态回写的目录表与 `evalSuiteId`）、ADR-118 #9（Workflow 固定 Skill 版本——评测对象是版本）、ADR-120（G3 权限检查所用能力分类）、ADR-116（实体来源 `requirements/work-stack-v2/`）、`docs/proposals/PROP-WORK-STACK-001.md` §4.4 与修订 R1、实体文档 `requirements/work-stack-v2/skills/S003-enterprise-search.md` §11（首个套件样例）、`workflows/W001-research-to-brief.md`、`digital-humans/D002-research-knowledge-analyst.md` §8.2（角色旅程评测）。

## 现状核实（本文所有"已有"论断的出处）
- `evals/` 下只有 `ic-review/`（protocol/rubric/rounds）与 `skill-selection/`（`score.mjs` + `rubric.json` + `scores/*.jsonl`，是**入选评审**不是行为评测）；不存在 `evals/work-stack/`——S003 §11、W001、D002 §8.2 均把各自套件标为 **proposed-unwired**。
- `.harness/scripts/cli.ts` 的命令分发里**没有** `eval` 子命令；根 `package.json` 只有若干 `eval:*` Playwright 脚本（`eval:chat-ux`、`eval:plan-execute` 等），都是聊天体验评测，不是按实体的 suite。
- 已有同名前缀的门脚本只有 `.harness/scripts/lint-work-stack-graph.mjs`（+ `.test.ts`），**不存在** `lint-work-stack-gates.mjs`。
- Skill 试跑结果恒为未执行：`packages/contracts/src/standard-skill-draft.ts` 把 `validationReport.fixtureExecution` 定为 `z.literal('not_run')`，`apps/api/src/application/agent-run/skill-draft.ts` 固定写入该值——ADR-119「背景」所述缺口属实。
- 真实模型链路只有 `real-model-e2e` lane（`.harness/instructions/real-model-e2e.md`，`pnpm run e2e:real-model-smoke`）；86 个全栈 spec 跑确定性回环模型。本域的确定性 case 走回环，真实模型只走该 lane。
- `skill_catalog_entries` 表由 `01-skill-catalog.md`（第 2 轮）新建，本域只**追加**门状态列/子表并消费它，不改其通道语义。
- 路径口径冲突：ADR-119 #1 写 `evals/work-stack/<ID>/`，PROP §4.4 写 `evals/work-stack/<entity>/<id>/`。以 ADR-119 为准（stableId 全局唯一：S/W/D 前缀已区分实体类型），PROP 的两级写法在实现 issue 中登记为待收敛的第二份副本。
- ADR-119 定义 G0–G6；本阶段只落 G0–G5，G6（生产遥测 + owner + 回滚）不在范围（见 R6）。

## R1 概览
- **Use Case 名称**：为每个 Work Stack 实体维护评测套件，跑出可复现分数，并用 G0–G5 门机械判定其能否从 candidate 进入 verified。
- **Actor**：实体实现者 / worker agent（写 cases、grader、跑 eval）、CI（跑门脚本与回环评测）、平台运营（在官方平台组织上触发 G5 与 verified 转移）、组织管理员与成员（在目录里**只读**门状态）、Agent 装配流程（系统 Actor，只允许绑定 verified Skill）。
- **目标**：让 58 个 Skill、19 个 Workflow、4 个 Agent 的质量主张可由脚本复算；「模板化但看起来完整」的实体过不了 G5，不能被官方 Agent 绑定（ADR-119 后果）。
- **系统边界**：`evals/work-stack/<ID>/`（数据与 grader）、`.harness/scripts/`（`eval` 子命令、`lint-work-stack-gates.mjs`）、`packages/contracts`（套件/报告/门状态 Zod）、`apps/api` catalog 模块（门状态写入与读取）、`apps/web` `/skill?screen=work-catalog` 详情抽屉门状态区。不含 Workflow Runtime 本体（第 3 轮）、真实模型 lane 的基础设施、G6。

## R2 前置与触发
- **前置条件**：实体文档评审 PASS（修订 R1）；Skill 已按 `01-skill-catalog.md` 以含 `metadata.work.evalSuiteId` 的包导入；评测 Workflow 时其运行时已可在回环模型上执行（第 3 轮）；G5 需被测实体 G0–G4 已全过。
- **触发条件**：
  - 开发者/agent 执行 `pnpm harness eval --entity S003 [--baseline] [--version <semver>] [--report json]`；
  - CI 在改动 `evals/work-stack/**`、`skills/**` 含 `metadata.work` 的 SKILL.md、或门脚本本身时跑 `pnpm run lint:work-stack-gates`；
  - 平台运营执行 `pnpm harness eval --entity <ID> --baseline --write-back` 或批量 `--all-skills`（第 10 轮）；
  - 成员打开目录详情抽屉读门状态。

## R3 主流程
1. 实现者在 `evals/work-stack/<ID>/` 建套件：`suite.json`（stableId、目标版本范围、被测工具集、基线定义）、`cases.jsonl`（每行 id / 夹具引用 / 输入 / 期望断言，如 S003 E1–E10）、`fixtures/`（合成组织数据，禁止真实数据）、`grader.ts`（规则 grader 优先；需要 LLM 评审时声明 `llmJudge` 并附 `calibration/` 人工标注样本）。
2. 套件格式由 `packages/contracts` 的 `WorkEvalSuite` / `WorkEvalCase` Zod 校验；`suite.json.stableId` 必须等于目录名，且等于对应 manifest 的 `evalSuiteId` 所指。
3. 开发者执行 `pnpm harness eval --entity S003` → 运行器解析套件 → 用回环模型 + 夹具工具桩逐 case 运行被测实体的**固定版本**（ADR-118 #9：Skill 按 content_digest 定位版本；Workflow 按其 pinned 版本集）→ grader 逐 case 给 `pass|fail|error` 与失败原因 → 写 `evals/work-stack/S003/reports/<runId>.json`（含被测版本 digest、夹具 digest、grader 版本、逐 case 结果）并打印汇总，任一 `fail|error` 退出码非 0。
4. 加 `--baseline` → 运行器用「无该 Skill 的通用 Agent + 相同工具集」（S003 即只持 `wx_knowledge_search`/`wx_knowledge_read`）跑同一 cases，报告并列 subject 与 baseline 结果。
5. CI 执行 `pnpm run lint:work-stack-gates`（`node .harness/scripts/lint-work-stack-gates.mjs [--entity <ID>]`）→ 对每个有 `metadata.work` 的实体依次判：
   - **G0 身份**：stableId 唯一、与实体文档文件名/清单 `WORK-STACK-320-LIST.md` 一致、manifest 可解析；
   - **G1 溯源/许可**：每条 provenance 有 repo/path/commit/license，`copied=true` 必有 notice，许可证不在禁用清单（如 fair-code 默认只作参考）；
   - **G2 schema**：`inputSchema`/`outputSchema` 是合法 JSON Schema，套件每个 case 的输入满足 inputSchema、期望输出样例满足 outputSchema；
   - **G3 权限/注入**：`dependencies` 只用 ADR-120 已登记能力分类；套件必须至少含一条权限拒绝 case 与一条提示注入 case，且最近一次报告中二者 pass；
   - **G4 功能**：存在针对当前版本 digest 的最新报告，全部确定性 case pass。
   输出逐实体逐门 `pass|fail|not_applicable` + 原因；任一官方实体 G0–G4 fail 退出码非 0。
6. 门脚本产出 `WorkGateStatus`（stableId、版本 digest、G0–G5 各门结果、证据报告路径、判定时间、脚本版本）；带 `--write-back` 时经 `POST /admin/skills/catalog/:skillId/gate-status`（平台运营凭据）写入该 Skill 当前版本的门状态记录，旧版本记录保留。
7. G0–G4 全过的 Skill 目录通道保持/置为 `candidate`（PROP §5 第 4 条）；G5 判定：subject 在确定性 case 上通过数**严格大于**基线，且实体文档指定的必过 case 全过（S003 为 E2/E3/E6）→ G5 pass。
8. G5 pass 后，`PATCH /admin/skills/catalog/:skillId` 的 `candidate → verified` 转移改为以门状态记录为准（取代 01 文档 R3 第 9 步临时的 `gateEvidenceRef`）；G5 未过则 409。
9. 第 10 轮：`pnpm harness eval --all-skills --baseline --write-back` 对 58 个第一阶段 Skill 批量跑，产出汇总报告（每实体 subject/baseline 通过数、G5 结论），结果写回目录。
10. 成员在目录详情抽屉看到门状态区：G0–G5 逐门徽章、判定时间、对应版本、subject vs baseline 通过数；未跑过显示「未评测」。
11. Agent 装配（第 5 轮）绑定官方 Skill 时读取门状态：非 verified 拒绝绑定（ADR-119 #4）。

## R4 备选与异常
- **备选流程**
  - A1：Workflow（W001…）与 Agent（D002…）套件同格式：Workflow case 驱动整条图（回环模型 + effect-gateway 桩），Agent 套件为 `journeys/` 角色旅程（D002 §8.2）；二者本阶段跑 G0/G2/G4，G5 只对 Skill 强制。
  - A2：`--case E2` 只跑单条，报告标 `partial=true`，不能作为 G4/G5 证据。
  - A3：需要 LLM 评审的 case 在回环运行时由 grader 的规则分支判；真实模型评审只在 `real-model-e2e` lane 手动触发，结果单独标 `lane=real-model`，不参与 G4/G5 的确定性判定。
  - A4：实体版本升级 → 旧版本门状态保留，新版本门状态初始为「未评测」，目录显示当前生效版本的门状态；已 pin 旧版本的 Workflow 不受影响。
- **异常流程**
  - E1：`evals/work-stack/<ID>/` 不存在或 `suite.json` Zod 校验失败 → `eval` 退出非 0，打印文件与字段路径；门脚本该实体 G4 = fail（原因「无套件」），**不得**视为 not_applicable。
  - E2：夹具引用缺失 / case 输入不满足 inputSchema → 该 case 为 `error`，G2 fail，报告保留其他 case 结果。
  - E3：grader 抛异常或超时（单 case 默认 60s）→ 该 case `error`，整体非 0；不得把 error 计作 pass。
  - E4：报告对应的版本 digest ≠ 当前版本 digest（改了 Skill 没重跑）→ G4 fail，原因「报告过期」。
  - E5：基线不存在（`suite.json` 未定义 baseline）或基线跑失败 → G5 = fail（原因「无基线」），不能标 verified；W001 当前即此状态。
  - E6：subject 通过数 ≤ 基线，或必过 case 有一条失败 → G5 fail，通道维持 candidate，报告列出差值与失败 case。
  - E7：套件缺权限拒绝 case 或注入 case → G3 fail（「覆盖不足」），即使其余 case 全过。
  - E8：`llmJudge` 未附校准样本或校准一致率低于 `suite.json` 声明阈值 → 该 grader 不可用于 G4/G5，门判 fail。
  - E9：`--write-back` 时 API 不可达或凭据不足（403）→ 本地报告照常生成，命令非 0 并提示未回写；目录保持旧门状态，不写半截。
  - E10：门脚本自身回归：反证测试（`lint-work-stack-gates.test.ts`）用坏 fixture（缺 license、未登记分类、过期报告、subject=baseline）必须各自被判 fail；若判 pass 则 CI 红。
  - E11：夹具含疑似真实个人数据（邮箱/手机号正则命中且不在合成白名单）→ `eval` 拒绝运行。

## R5 权限与可见性
- 实现者 / worker agent：可在仓库内增改 `evals/work-stack/**`、本地跑 `eval` 与门脚本；**不能**回写目录门状态，不能改通道。
- CI：只读跑门脚本与回环评测，不持有回写凭据。
- 平台运营（platform-admin）：可 `--write-back` 官方平台组织目录的门状态、执行 `candidate → verified`；不能改其他组织目录行的门状态。
- 组织管理员：只读本组织目录各条目门状态；本组织自建 Work Skill 的门状态本阶段只读显示「未评测」，不能自行回写（组织级 eval 不在本阶段）。
- 组织成员：只读门状态徽章与 subject/baseline 通过数；**不能**查看报告中的夹具原文与 grader 细节（仅平台运营与仓库可见）。
- 匿名/跨组织：不可访问任何门状态（RLS 按 org_id）。
- 任何角色都**不能**手工直接改门状态字段——只接受门脚本产出的 `WorkGateStatus` 结构（带报告引用与脚本版本）。

## R6 后置条件 / 不包含
- **后置条件**：每个第一阶段实体有 `evals/work-stack/<ID>/` 套件；58 个 Skill 各有一份针对当前版本的 subject+baseline 报告；目录中每个 Skill 当前版本有 G0–G5 门状态记录；只有 G5 pass 的 Skill 为 verified。
- **不包含**：
  - G6 生产门（遥测 + owner + 回滚）——需上线数据，放 Phase 1 之后；
  - 组织自建 Skill 的评测回写与组织内 eval UI；
  - 真实模型 lane 基础设施改造（沿用现有 lane，只加 project）；
  - 实时语音相关评测（ADR-121，范围外）；
  - 评测结果趋势图/大盘。

## R7 业务规则
- 门判定只能由脚本产出；无报告 = 未通过，不存在「默认通过」。
- 评测对象永远是**具体版本**（content digest），门状态随版本走。
- G5 必须严格优于无 Skill 基线且必过 case 全过；持平即失败。
- 确定性门（G2–G5）只用回环模型结果；真实模型结果只做观测证据。
- 夹具只能是合成数据。
- 通道阈值等数值只在 `suite.json` / 门脚本常量一处声明（AGENTS「同一事实不得声明在两处」）；目录与 UI 只读显示。

## R8 界面线索
- 前端入口：`/skill?screen=work-catalog` 详情抽屉中 01 文档已预留的「评测套件与门状态」区，本域填实：G0–G5 六枚徽章（pass/fail/未评测，悬停显示原因与判定时间）、评测版本 semantic_label、subject vs baseline 通过数（如 `9/10 vs 6/10`）、evalSuiteId。
- 列表行新增门状态缩略（如「G4✓ G5✗」），通道筛选 verified 与 G5 联动显示。
- 管理员（平台运营）可见「标为 verified」按钮，仅当 G5 pass 时可点，否则灰显并提示原因。
- 状态：未评测空态、报告过期（E4）黄色提示、回写失败时保持旧数据不报整页错。
- 线框：待 UI 先行阶段产出；开工前须随契约束 `work-eval` 的 `design-signoff.md` 第 ① 节经人类签核（ADR-023）。

## R9 非功能约束
- 性能/规模：单实体回环评测 ≤ 3 分钟；58 个 Skill 批量 subject+baseline 在 CI 单 job ≤ 60 分钟（可按实体并行）；门脚本全量静态检查（G0–G3）≤ 30 秒。
- 安全/隐私/合规：夹具合成数据（E11）；回写接口仅 platform-admin；报告不入目录 API 原文。
- 兼容与降级：不改现有 `eval:*` Playwright 脚本与 `evals/skill-selection`、`evals/ic-review`；门状态缺失时目录显示「未评测」，不影响目录其余功能。

## R10 已知约束 / 依赖
- 依赖：`01-skill-catalog.md`（manifest、`skill_catalog_entries`、通道写接口）、`02-workflow-runtime.md`（Workflow 回环执行，A1）、ADR-120 能力分类登记（G3）、现有回环模型提供方与 `real-model-e2e` lane。
- 技术：新子命令挂在 `.harness/scripts/cli.ts` 分发表；门脚本为 `.mjs` + vitest 反证测试（参照 `lint-work-stack-graph.mjs` 的写法）；Zod 契约放 `packages/contracts`；新迁移只追加门状态表/列。

## R11 切分提示
- EV01a 套件格式契约 + S003 套件（6）→ EV01b `harness eval --entity` 运行器与报告（7）→ EV02a `lint-work-stack-gates` G0–G4 + 反证测试（7）→ EV02b 门状态回写 + 目录展示（4，依赖 UI 签核）→ EV03 G5 基线批量 + verified 联动（6，第 10 轮）。
- EV01a 先行；EV02a 的 G0–G3 静态部分可与 EV01b 并行；EV03 依赖 58 个 Skill 套件由第 7–9 轮各条线补齐。

## R12 AI Ready 验收线索
- 成功态：`pnpm harness eval --entity S003` 退出 0，`evals/work-stack/S003/reports/<runId>.json` 含版本 digest 与 E1–E10 逐条 pass；`--baseline` 报告并列基线结果。
- 门脚本：`pnpm run lint:work-stack-gates --entity S003` 打印 G0–G4 全 pass；反证测试中缺 license（G1）、未登记分类（G3）、缺注入 case（E7）、过期报告（E4）、无套件（E1）各判 fail 且退出非 0。
- E2/E3：坏夹具 case 为 error、grader 抛异常为 error，整体非 0，不计 pass。
- G5：subject 通过数 > baseline 且 E2/E3/E6 全过 → G5 pass，`PATCH … channel=verified` 成功；构造 subject=baseline（E6）或无基线（E5）→ G5 fail，`PATCH` 返回 409。
- 回写：平台运营 `--write-back` 后 `GET /skills/catalog/:skillId` 含当前版本 G0–G5 门状态；非平台运营回写 403，目录门状态不变（E9）；新版本导入后门状态为「未评测」且旧版本记录仍可查（A4）。
- 权限：成员能读徽章但拿不到夹具原文；跨组织读取门状态被 RLS 拒绝。
- 装配：非 verified Skill 被官方 Agent 绑定时被拒。
- 第 10 轮：`--all-skills --baseline` 汇总报告覆盖 58 个 Skill，目录中 verified 数 = 报告中 G5 pass 数。
