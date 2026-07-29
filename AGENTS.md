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
- 由 `pnpm harness doctor` 机械检查（三条，见完成定义第 5、6 条）。

## 开工流程(每轮会话开始)
0. **先确认角色,角色决定 loop 策略,不可跳过**:人类要你当 main coordinator →
   先用 `coordinator` skill(挂 5 分钟 loop);当某模块的 module coordinator →
   先用 `module-coordinator` skill(挂 15 分钟 loop);都不是 → 你是 worker,
   loop 由 `agent-bootstrap.md` 第 3.5 步挂(15 分钟)。三条路径都跑
   `pnpm harness tick`,没有第四种"不挂 loop"的角色。
1. 读当前 sprint 的 `progress.md` 和 `session-handoff.md`。
2. 读当前 sprint 的 `active-features.json`(派生视图),找到唯一 `in_progress` 的 feature。
3. 只做那一个 feature。做完用验证命令证明,再收尾。

## 不可违反的硬约束
- **仓库即唯一事实来源**:你看不到的东西就不存在。所有上下文进仓库。
- **功能清单是权威**:`phases/<phase>/feature_list.json` 是该阶段唯一权威来源。
  sprint 的 `active-features.json` 是脚本派生的只读视图,**禁止手改**。
- **一次只做一个 feature**:每个 owner 同一时刻最多一个 `in_progress`。
  无 owner(`owner: null`)时退化为全局只能有一个(单 agent 兼容)。
  由 `assertSingleInProgress` 门控,见 ADR-001。
- **状态不能自己改**:你不能把 feature 直接标成 `passing`。只能跑
  `pnpm harness verify`,由验证脚本门控转移。`passing` 不可逆。
- **范围纪律**:只动当前 feature 涉及的代码,别顺手重构无关区域。
- **文件规模**:业务源文件原则上不超过 2000 行;接近上限时必须按领域职责拆分。超过 2000 行仅允许有明确豁免、拆分计划和验证证据,禁止继续在超限文件中堆功能。
- **UI 先行(仅 has_ui 阶段)**:UI 相关阶段的 `feature_list` 必须在真实 UI 经**人类**确认
  (`ui-signoff.md` status: confirmed)之后才定稿;`new-sprint` 对未确认的 UI 阶段直接拒绝。见 ADR-003。
- **设计签核**:feature 开工前,其所属**契约束**必须经人类签核
  (`design-signoff.md` status: confirmed),且该阶段的**一致性复核**已通过。见 ADR-020。
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

## 按需深入(渐进式披露,需要时才读)
- 参考技术架构（前端/后台/AI/DB/实时同步）→ `.harness/instructions/architecture.md`
- **契约先行的设计流程（洋葱架构 + API 契约单源 + UC 覆盖矩阵）** → `.harness/instructions/contract-design.md`（见 ADR-020）；组织本体/知识图谱 → `docs/architecture/knowledge-ontology.md`
- 智能体编排/工具/记忆约定 → `.harness/instructions/agentic-patterns.md`
- 多 agent 协调（主 agent + issue-label 状态机 + review 门禁）→ `.harness/instructions/multi-agent-coordination.md`（见 ADR-004）
- **新 agent 接入执行书（第一次进来照它走）** → `.harness/instructions/agent-bootstrap.md`；背后的规则清单 → `agent-onboarding-checklist.md`（见 ADR-005）
- **人类开发者带 agent 加入开发** → `.harness/instructions/human-developer-onboarding.md`（面向人类；enroll 步骤 + 启用 agent 的首条消息模板 + 三级 coordinator 层级 + 性能管理，见 ADR-010）
- Agent 组织模型（多级 coordinator + 子 agent 注册 + 3h 性能周期 + 防断链）→ ADR-010
- **模块活知识库（做某模块的活之前先读）** → `.agents/skills/mod-<模块名>/SKILL.md`（模块清单见 project/PROJECT.md；新模块复制 `mod-_template/`；经验回流规则见各文件末尾）
- 编码规范 → `.harness/instructions/coding-standards.md`
- UIUX 规范 → `.harness/instructions/uiux-standards.md`
- 端到端验证标准 → `.harness/instructions/testing-standards.md`
- 可观测性约定 → `.harness/instructions/observability.md`
- 阶段/局部规则 → 对应 `apps/*/AGENTS.md`、`phases/<phase>/AGENTS.md`
- 模板的思想与最佳实践（为什么是这样）→ `docs/CONCEPTS.md`
- 文档该放哪一层（标准/ADR/档案）→ `docs/README.md`；项目专属事实单点 → `.harness/instructions/project/PROJECT.md`
- **Claude Code + Codex 双工具支持**：规格只写一次（`.harness/agents/*.yaml`），`pnpm harness gen-subagents` 生成两种格式，行为不漂移（CI 门控）

## 需求录入流水线（新阶段开工前）
原始需求 → 智能体 → 权威功能清单：
1. `pnpm harness new-phase [--ui]` scaffold 出 `phases/<phase>/requirements/` 文件夹（`--ui` = 有界面的阶段）。
2. 把**原始需求**（大白话/用户故事）写进该文件夹，可按领域放多份 `*.md`（auth.md/teams.md/rooms.md…）。
3. **【仅 UI 阶段，has_ui】UI 先行确认关卡**（ADR-003）：先由 **ui-prototyper** 用真实组件
   （`apps/web` + mock 数据）把界面做出来 → **人类工程师**核对 → 把 `ui-signoff.md` 的 `status`
   改为 `confirmed`。未确认不得进入下一步（`new-sprint` 会拒绝）。
4. 调 **requirement-author** 智能体：读该文件夹全部 `*.md`（UI 阶段还读已确认 UI）→ 生成
   `feature_list.json`（带可执行 `verification`，锚定真实 `data-testid`）。
5. **设计签核关卡**（ADR-020，2026-07-28 新增）：**UC + UI 不足以确认整个设计**——
   后端契约会在画界面时被顺手创造出来却无人评审。故 feature 开工前还需签**契约束**，
   每束四件：① 领域模型与不变量 ② 用例接口 ③ API 契约 ④ UC 覆盖证明。
   两级粒度：**按能力域签契约束** + **阶段级一致性复核**（查各束交叉约束是否打架）。
   一个 feature 可开工 ⟺ 所属契约束已签 ∧ 阶段一致性复核通过。见
   `.harness/instructions/contract-design.md`。
`requirements/` 是输入,不是权威;权威永远是 `feature_list.json`。

## 常用 harness 命令
```bash
pnpm harness new-phase  --id 02 --name agent-runtime --goal "..."   # scaffold requirements/；加 --ui 走 UI 先行关卡
pnpm harness new-sprint --phase 02 --id 01 --goal "..." --features F01,F02
pnpm harness verify     --sprint 02/01
pnpm harness sync       --phase 02 --apply
pnpm harness doctor     --phase 02        # 审计链体检：passing 证据真实性 + 派生视图一致（ADR-012；pre-push 自动跑）
```
