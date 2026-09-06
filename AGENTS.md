# AGENTS.md — 根路由文件

> 这是 agent 每次开工读的第一个文件。它是**目录页,不是百科全书**。
> 详细规则都拆到 `.harness/instructions/` 和各级 scoped 的 AGENTS.md 里,按需加载。
> 硬上限 ~100 行。放不下的内容请拆出去,不要往这里堆。

## 项目是什么
- <一句话说明你的项目>（turbo + pnpm + TypeScript monorepo；本仓由 agentic-harness-template 生成）。
- 代码平面:`apps/`(运行时)、`packages/`(可复用能力)。
- 控制平面:`.harness/`(harness 大脑:指令/模板/状态/脚本)。
- 交付平面:`phases/`(阶段=项目 → sprint → feature)。

## 技术栈与版本
- 运行时:Node 见 `.nvmrc`;包管理:pnpm(见 `pnpm-workspace.yaml`)。
- 构建编排:turbo(见 `turbo.json`)。
- 语言:TypeScript,严格模式。

## 首次运行(每个新会话/新环境都先跑这个)
```bash
./init.sh           # 安装依赖 + 跑基础验证 + 打印启动命令
```
如果 `init.sh` 的验证失败,**停下来先修基础状态**,不要在坏的基础上叠新功能。

## 开发任务必须在 GitHub 上可见（不可绕过）
每一个 feature 的生命周期**必须**是：
```
feature 领进 sprint → harness sync --apply 建 issue → 分支 worker/<owner>-<phase>-<feature>
   → 实现（进展写在该 issue 的评论里，不是只写在本地）
   → harness verify 门控转 passing → PR 带 `Closes #<issue>` → 合入 main
```
- **不许**在没有 issue 的情况下开发。看不见的开发只有做的人知道在做什么。
- **不许**把多个 feature 塞进一个 PR 再一起合。一个 issue 一个 PR。
- **每次迭代都在对应 issue 上展开**：设计取舍、撞到的墙、反证结果，写成评论。
  写在本地 commit message 里的东西，别人要 clone 才看得到。
- **不许**没有 PR 就把 issue 关掉或标完成；**PR 绿了才算完**（2026-09-02 人类指令，#2539）。
  「绿」只有一个定义：`.harness/scripts/lib/pr-queue.ts` 的 `classifyChecks` 判定——本文件不复述任何 check 规则。
  PR 上有红就修到绿、review 意见逐条回应，不许留着红 PR 收尾；分诊规则见 `coordinator-sop.md` 的 PR 状态表。
- 由 `pnpm harness doctor` 机械检查（五条，见完成定义第 5、6、7 条；`sync --apply` 关 issue 同样要求实现已在 main，#1557）。
- **用户直接交办、不走本节 sprint/feature 流程的改动**（bug 修复、小功能点……）：验证
  跑绿后**自动创建 PR，不要停下来问**——这条覆盖 Claude Code 的默认行为；创建者对
  该 PR 负责到绿，不许创建完就撒手。规则与例外见
  `.harness/instructions/ad-hoc-fix-pr-sop.md`（2026-09-03 人类指令）。

## 开工流程(每轮会话开始)
0. **先确认角色,角色决定 loop 策略,不可跳过**:人类要你当 main coordinator →
   先用 `coordinator` skill(挂 5 分钟 loop);当某模块的 module coordinator →
   先用 `module-coordinator` skill(挂 15 分钟 loop);都不是 → 你是 worker,
   loop 由 `agent-bootstrap.md` 第 3.5 步挂(15 分钟)。三条路径都跑
   `pnpm harness tick`,没有第四种"不挂 loop"的角色。
0.5. **跑 `pnpm harness readiness` 看统一队列，从队列顶部取活**——它是"现在什么最该做"
   的唯一权威（ADR/issue #814）。不在队列上的活不占工时；确有理由做队列外的活，
   在对应 issue 里写一句为什么，不要默默做。判据与聚合规则见
   `.harness/instructions/core-loop-readiness-standard.md`。
1. 读当前 sprint 的 `progress.md` 和 `session-handoff.md`。
2. 读当前 sprint 的 `active-features.json`(派生视图),找到唯一 `in_progress` 的 feature。
3. 只做那一个 feature。做完用验证命令证明,再收尾。

## 不可违反的硬约束
- **仓库即唯一事实来源**:你看不到的东西就不存在。所有上下文进仓库。
- **功能清单是权威**:`phases/<phase>/feature_list.json` 是该阶段唯一权威来源。
  sprint 的 `active-features.json` 是脚本派生的只读视图,**禁止手改**。
  同目录 `feature_list.archive.json`(若存在)存放已 `harness archive-passing` 搬出的
  passing feature——只是搬家,不是第二份事实源;一律用 `lib/features.ts` 的
  `loadFeatureList`/`saveFeatureList` 读写,不要手改任意一个文件或直接 `readFileSync`。
- **一次只做一个 feature**:每个 owner 同一时刻最多一个 `in_progress`。
  无 owner(`owner: null`)时退化为全局只能有一个(单 agent 兼容)。
  由 `assertSingleInProgress` 门控,见 ADR-001。
- **状态不能自己改**:你不能把 feature 直接标成 `passing`。只能跑
  `pnpm harness verify`,由验证脚本门控转移。`passing` 不可逆。
- **范围纪律**:只动当前 feature 涉及的代码,别顺手重构无关区域。
- **文件规模**:业务源文件原则上不超过 2000 行;接近上限时必须按领域职责拆分。超过 2000 行仅允许有明确豁免、拆分计划和验证证据,禁止继续在超限文件中堆功能。
- **设计签核(三件、一处签)**:feature 开工前,其所属**契约束**必须经人类签核——
  束目录下**一份** `design-signoff.md`,三节对应 **① UI ② 用例 ③ API 契约**;
  且该阶段的**一致性复核**已通过。签核是**人的动作,agent 不许改 status**。
  **这是唯一的签核门**——phase 级 `ui-signoff.md` 已于 2026-07-30 停用(改它无效);
  `has_ui: true` 却没有 `contracts/` 的阶段**判失败**,不是放行。
  见 ADR-023(权威)、ADR-003 / ADR-020(决策档案);怎么做 →
  `.harness/instructions/contract-design.md`。
- **静态痕迹 ≠ 动态事实**（2026-08-09 一天内栽四次,见 `.harness/instructions/static-trace-vs-live-fact.md`）:
  worktree 存在 ≠ 拥有它的 agent 还活着;代码注释说"今天没有这条路径" ≠ 今天真没有;
  分支上有文件 ≠ main 上有;评分记了 SHA ≠ 那个 SHA 在 main 的血统里。
  **判断"现在是什么状况",要读会随状况改变的信号**(路由/契约实现、issue 与 PR 的当前状态、
  `merge-base --is-ancestor`、心跳),不要读一个写下来就不会再变的痕迹。
  痕迹写得越诚实越具体,读起来越像权威——这正是它骗人的方式。

  ⚠ **同一事实不得声明在两处**——本项目已五次因此漂移(设计 token / 字号档位 /
  丢弃原因枚举 / 撤回链 SLA / 估点)。凡出现第二份副本,一律收敛为单一事实源 + 机械门控。

## 完成定义(DON'T EDIT — 这是整个 harness 最关键的部分)
一个 feature 只有同时满足以下条件才算 `passing`:
1. `user_visible_behavior` 描述的行为真实可见、端到端可复现。
2. 该 feature 的每一条 `verification` 命令都执行成功(退出码 0)。
3. 证据已写入 `evidence`(命令输出 / 日志 / commit / 截图路径)。
4. 没有引入新的失败:`./init.sh` 的基础验证仍然通过。
5. **该 feature 在 GitHub 上有对应 issue，且该 issue 已由 PR 关闭**（2026-07-29 新增）。
6. **实现已合入 `main`** —— 标了 passing 但代码只停在分支上，它对别人不存在。
7. **关闭该 issue 的 PR 合入时 CI 全绿**（2026-09-02 人类指令，#2539）—— 「绿」= `lib/pr-queue.ts`
   的 `classifyChecks` 对**合入时刻**的 check 集合的判定（`lib/pr-green.ts` 重建），由 `doctor` 第 ⑤ 条判
   （`--strict` 下 FAIL，问不到 GitHub 也 FAIL；只判生效后关闭的 issue，不倒查存量）。
没有证据 = 没有完成。"代码写完了""看起来能跑"都不算完成。

⚠ **第 5、6 条是 2026-07-29 补的，因为规范早就有、门控一直没有。**
`sync-github.ts` 生成的 issue 正文里逐字写着「分支 `worker/…`，PR 关联本 issue
（`Closes #N`）」，而 8 个 feature 一路做到 passing、其中 5 个连 issue 都没有。
规范不是缺失的，是**没有脚本**——这正是本文件自己那条：
**没有脚本的规范条目视为未落地**。现在 `harness doctor` 三条检查把它变成会红的东西。

## 干净收尾(每轮会话结束前)
逐项过一遍 `.harness/rubrics/clean-state-checklist.md`,确保:
- 标准启动路径、标准验证路径仍可用。
- `progress.md` 已更新,`session-handoff.md` 已写。
- 功能清单真实反映 passing / 未验证边界(没有假 passing)。
- 没有半成品处于未记录状态;下一轮无需人工修复即可继续。
- **自己名下的 docker compose 栈已释放**（2026-08-08 实测事故：孤儿栈堆积→load 66→
  Docker daemon 崩溃）——检查方式与硬性要求见 `.harness/instructions/agent-resource-cleanup-sop.md`。

## 按需深入(渐进式披露,需要时才读)
- 参考技术架构（前端/后台/AI/DB/实时同步）→ `.harness/instructions/architecture.md`
- **契约先行的设计流程 + 签核执行书（洋葱架构 + API 契约单源 + UC 覆盖矩阵）** → `.harness/instructions/contract-design.md`（见 ADR-023 / ADR-020）；组织本体/知识图谱 → `docs/architecture/knowledge-ontology.md`
- **人类决策打包流程（签核决策收窄成 A/B/C/D + 单 PR 交付，减少人类手工 git 操作）** → `.harness/instructions/human-decision-packaging.md`（2026-08-13 起，每次开工先跑 `pnpm harness dashboard` 看等人类那节）
- 智能体编排/工具/记忆约定 → `.harness/instructions/agentic-patterns.md`
- 多 agent 协调（主 agent + issue-label 状态机 + review 门禁）→ `.harness/instructions/multi-agent-coordination.md`（见 ADR-004）；分层监控循环节奏 → `.harness/instructions/coordinator-sop.md`；**该 SOP 依赖的 `pnpm harness pr-queue` 需要本机 `gh` CLI——无 `gh` 的会话（如远程执行环境）改用** `.harness/instructions/pr-review-merge-sop.md` **的 MCP 工具速查**
- **新 agent 接入执行书（第一次进来照它走）** → `.harness/instructions/agent-bootstrap.md`；背后的规则清单 → `agent-onboarding-checklist.md`（见 ADR-005）
- **人类开发者带 agent 加入开发** → `.harness/instructions/human-developer-onboarding.md`（面向人类；enroll 步骤 + 启用 agent 的首条消息模板 + 三级 coordinator 层级 + 性能管理，见 ADR-010）
- **Agent 资源释放 SOP（不遵守系统会崩，2026-08-08 真实事故）** → `.harness/instructions/agent-resource-cleanup-sop.md`
- Agent 组织模型（多级 coordinator + 子 agent 注册 + 3h 性能周期 + 防断链）→ ADR-010
- **模块活知识库（做某模块的活之前先读）** → `.agents/skills/mod-<模块名>/SKILL.md`（模块清单见 project/PROJECT.md；新模块复制 `mod-_template/`；经验回流规则见各文件末尾）
- 编码规范 → `.harness/instructions/coding-standards.md`
- UIUX 规范 → `.harness/instructions/uiux-standards.md`
- 端到端验证标准 → `.harness/instructions/testing-standards.md`
- **真实模型 e2e（86 个 spec 全跑在回环模型上，真实模型链路的那一条另加 lane）** → `.harness/instructions/real-model-e2e.md`（issue #2802；devapp 手动触发 `real-model-chat-evidence` workflow，本地 `pnpm run e2e:real-model-smoke`）
- **开发模式（预设账号/角色，agent 跳过登录直接测）** → `.harness/instructions/dev-mode-testing.md`
- **静态痕迹 ≠ 动态事实（一天栽四次的复盘 + 该读什么信号）** → `.harness/instructions/static-trace-vs-live-fact.md`
- **部署验证标准（验证层级不许比用户低一层：镜像/容器/产物/产物可读，各有独立判据）** → `.harness/instructions/deployment-verification-standard.md`（2026-09-06 一天四层假绿的复盘）
- **新环境 bring-up 执行书（谁做什么 + 就绪核对 + 六个实测坑）** → `.harness/instructions/new-environment-bringup.md`
- **统一衡量标准 CLR（"还差多少到 10 分"的唯一答案 + 所有 agent 的取活口）** → `.harness/instructions/core-loop-readiness-standard.md`（issue #814；`pnpm harness readiness`）
- 可观测性约定 → `.harness/instructions/observability.md`
- 阶段/局部规则 → 对应 `apps/*/AGENTS.md`、`phases/<phase>/AGENTS.md`
- 模板的思想与最佳实践（为什么是这样）→ `docs/CONCEPTS.md`
- 文档该放哪一层（标准/ADR/档案）→ `docs/README.md`；项目专属事实单点 → `.harness/instructions/project/PROJECT.md`
- **Claude Code + Codex 双工具支持**：规格只写一次（`.harness/agents/*.yaml`），`pnpm harness gen-subagents` 生成两种格式，行为不漂移（CI 门控）

## 需求录入流水线（新阶段开工前）
原始需求 → 智能体 → 权威功能清单：
1. `pnpm harness new-phase [--ui]` scaffold 出 `phases/<phase>/requirements/` 文件夹（`--ui` = 有界面的阶段）。
2. 把**原始需求**（大白话/用户故事）写进该文件夹，可按领域放多份 `*.md`（auth.md/teams.md/rooms.md…）。
3. **UI 先行**（ADR-003）：有界面的阶段由 **ui-prototyper** 用真实组件（`apps/web` + mock）
   把界面做出来、截图存 `ui-preview/`——它是签核第 ① 件的材料，不再单独签一次。
4. 调 **requirement-author** 智能体：读该文件夹全部 `*.md`（UI 阶段还读已建成 UI）→ 生成
   `feature_list.json`（带可执行 `verification`，锚定真实 `data-testid`）。
5. **设计签核关卡**（ADR-023）：**UC + UI 不足以确认整个设计**——后端契约会在画界面时
   被顺手创造出来却无人评审。按能力域切**契约束**，人类在束级 `design-signoff.md`
   一次签三件（UI / 用例 / API 契约），再做**阶段一致性复核**（查各束交叉约束是否打架）。
   一个 feature 可开工 ⟺ 所属契约束已签 ∧ 阶段一致性复核通过。细则、支撑材料与
   逃生口见 `.harness/instructions/contract-design.md`。
`requirements/` 是输入,不是权威;权威永远是 `feature_list.json`。

## 常用 harness 命令
```bash
pnpm harness new-phase  --id 02 --name agent-runtime --goal "..."   # scaffold requirements/；加 --ui 走 UI 先行关卡
pnpm harness new-sprint --phase 02 --id 01 --goal "..." --features F01,F02
pnpm harness verify     --sprint 02/01
pnpm harness sync       --phase 02 --apply
pnpm harness doctor     --phase 02        # 审计链体检：passing 证据真实性 + 派生视图一致（ADR-012；pre-push 自动跑）
```
