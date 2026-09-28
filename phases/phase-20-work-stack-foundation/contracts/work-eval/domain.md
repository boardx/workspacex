# 契约束 `work-eval` — 领域模型与不变量（支撑材料）

## 一、现状核实（出处见 `requirements/04-eval-gates.md`「现状核实」，本束已复核）

- `evals/` 仅有 `ic-review/`、`skill-selection/`；无 `evals/work-stack/`。
- `.harness/scripts/cli.ts` 无 `eval` 子命令；已有 `lint-work-stack-graph.mjs`，无 `lint-work-stack-gates.mjs`。
- `packages/contracts/src/standard-skill-draft.ts` 的 `fixtureExecution` 恒为 `'not_run'`（ADR-119 背景）。
- `packages/contracts/src/work-skill-meta.ts` 已定义 `WorkSkillGateId`（G0–G6）与详情中的 `gates` 占位
  （`state: not_run|passed|failed`）；本束以 `WorkGateView` 填实，占位形状需在实现时收敛（见 coverage Q2）。
- 平台运营身份已有仓储 `apps/api/src/infrastructure/system/pg-platform-admin-repository.ts`，回写鉴权复用之。

## 二、概念

- **WorkEvalSuite**（仓库文件，值对象）：`evals/work-stack/<ID>/{suite.json,cases.jsonl,fixtures/,grader.ts,calibration/?}`。
- **WorkEvalReport**（仓库文件，不可变）：一次运行对一个固定版本 digest 的结果；subject/baseline 并列。
- **WorkGateStatus**（门脚本唯一产出）：某版本 digest 的 G0–G5 判定 + 证据路径 + 脚本版本。
- **SkillGateRecord**（新表 `skill_gate_records`，追加迁移）：`org_id, skill_id, skill_version_id, status jsonb, decided_at,
  written_by`；唯一键 `(skill_version_id)`；属于 `skill_catalog_entries` 的可变侧，不进 `skill_versions.manifest`。
- **WorkGateView**（派生读模型）：当前版本记录 + stale 判定 + 调用者权限。

## 三、不变量

| # | 不变量 | 出处 |
|---|---|---|
| I-1 | 每实体一套件，路径 `evals/work-stack/<ID>/`，`suite.stableId` = 目录名 = manifest `evalSuiteId` | ADR-119 #1，R3.2 |
| I-2 | 评测对象是具体版本（content digest）；门状态随版本走，新版本初始未评测，旧记录保留 | ADR-118 #9，R7，A4 |
| I-3 | 确定性门 G2–G5 只用 lane=loopback、非 partial 报告；真实模型只作观测 | ADR-119 #2，R7，A2/A3 |
| I-4 | error 永不计 pass；无报告/无套件 = fail，不存在默认通过 | R7，E1/E3 |
| I-5 | 门顺序 G0→G5；G5 以 G0–G4 全过为前提 | ADR-119 #3 |
| I-6 | G5：subject 通过数严格大于基线且必过 case 全过；持平即失败；无基线即失败 | ADR-119 #4，E5/E6 |
| I-7 | G3：依赖仅用 ADR-120 已登记分类；套件含权限拒绝与注入 case 且最近报告二者 pass | ADR-119 #3，ADR-120，E7 |
| I-8 | 只有 G5 pass 的 Skill 可 `candidate→verified`；只有 verified 可被官方 Agent 绑定 | ADR-119 #4 |
| I-9 | 门状态只接受 `WorkGateStatus` 结构回写；任何角色不能手改门字段 | R5 |
| I-10 | 回写仅平台运营、仅官方平台组织目录；原子写，失败不留半截 | R5，E9 |
| I-11 | 成员只读徽章与通过数，不见夹具/grader/报告路径；RLS 按 org_id | R5 |
| I-12 | 夹具只含合成数据；疑似真实个人数据拒绝运行 | R7，E11 |
| I-13 | 阈值（超时、校准一致率、必过 case）只在 `suite.json`/门脚本常量一处声明 | R7，AGENTS 单一事实源 |
| I-14 | Agent 即 DigitalHuman：Agent 套件挂在 D 编号下、评测 agent_versions，不引入 DigitalHuman 实体 | ADR-116 |
| I-15 | 本阶段不判 G6；实时语音评测不在范围 | ADR-119 #3，ADR-121，R6 |

## 四、洋葱落点

| 层 | 落点 |
|---|---|
| 契约 | `packages/contracts/src/work-eval.ts` |
| 领域 | `decideG5`、`suiteCoverageGaps`（契约内纯函数）；门判定规则在 `lint-work-stack-gates.mjs` |
| 应用 | `apps/api/src/application/skill/` 下 write-back / get-gate-status / verified 门检查用例 |
| 基础设施 | 追加迁移 `skill_gate_records`（RLS org_id）；pg 仓储 |
| 接口 | catalog 控制器两个新路由；`.harness/scripts/cli.ts` 挂 `eval` 子命令 |
| UI | `apps/web` work-catalog 详情抽屉 `work-skill-gates` 区 |
