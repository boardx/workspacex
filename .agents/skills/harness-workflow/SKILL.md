---
name: harness-workflow
description: >
  激活条件：用户提到 harness、新功能、开工流程、feature、sprint、phase、verify、passing、
  证据落盘、干净收尾、会话交接 等关键词时触发。
  提供完整的 harness engineering 工作流：开工→执行→验证→收尾。
---

# Harness Workflow Skill

## 何时使用

你正在这个 monorepo 中开发新功能时，始终按本 skill 的流程操作。

---

## 开工前置：角色判定与挂 loop（不可跳过，见 AGENTS.md「开工流程」Step 0）

先判断自己是 coordinator / module-coordinator / worker 三者之一，挂上对应 loop
（`pnpm harness tick` 三条路径都要跑，没有第四种"不挂 loop"的角色）——这一步在
AGENTS.md 里明确标了"不可跳过"，本节只覆盖它之后 Step 1-3 的命令化落地：

```bash
# Step 1: 初始化环境（依赖 + 基础验证）
./init.sh

# Step 2: 读当前 sprint 状态
cat phases/phase-<NN>-*/sprints/sprint-<MM>/progress.md
cat phases/phase-<NN>-*/sprints/sprint-<MM>/session-handoff.md

# Step 3: 找到唯一 in_progress 的 feature
cat phases/phase-<NN>-*/sprints/sprint-<MM>/active-features.json | jq '[.features[] | select(.status=="in_progress")]'
```

**规则：只做那一个 feature。没有 in_progress？先问用户要做哪个，再用 harness 开新 sprint。**

---

## 执行中的纪律

| 纪律 | 原因 |
|------|------|
| 只动当前 feature 涉及的代码 | 范围纪律 — 顺手重构 = 引入未经验证的改动 |
| 每次改完立刻局部验证 | 不要攒到最后一起 verify，失败难定位 |
| 不要手改 `active-features.json` | 它是脚本派生的只读视图 |
| 不要自己把 status 改成 passing | 只有 `pnpm harness verify` 能做这件事 |
| status/owner/evidence 字段**严禁出现在你手写的 diff 里** | PR #310/#311/#312 三连事故：diff 里手改 status = review 直接阻断 |
| 多 agent 并行时认领走 coord-service | `pnpm harness claim`（+ 需要唯一性时用 `module-lock-acquire`/`heartbeat`，见 ADR-009）；GitHub issue label 只是状态的只读投影，不是协调锁——"issue label 同时打 + lease 评论刷新"那套仪式已于 ADR-009（2026-07-08）退役，代码里也从没实现过双写 |

---

## 验证门控（唯一合法路径）

```bash
# 验证当前 sprint 的所有 feature
pnpm harness verify --sprint <NN>/<MM>

# 只验证一个 feature
pnpm harness verify --sprint <NN>/<MM> --feature F01
```

verify 会：
1. 逐条执行 `feature.verification` 中的命令
2. 运行 `pnpm -w run verify:base`（基础验证必须通过）
3. 把命令输出写入 `evidence/F<NN>.verify.log`
4. 全部通过后把 feature 升为 `passing`（不可逆）

---

## 干净收尾（每个会话结束前）

```bash
# 对照检查清单逐项过一遍
cat .harness/rubrics/clean-state-checklist.md
```

```bash
# 证据入库自查（L1，收尾前必跑）：evidence 必须真实在 git 树中
git ls-tree HEAD -- phases/**/evidence/
```
- 上述命令必须列出本轮引用的每个 evidence 文件且 blob 非空；
  被根 `.gitignore`（如 `*.log`）挡住 = 异常，**立即上报**，禁止写「本地留存」蒙混。

必须确认：
- `progress.md` 已更新（写本轮目标、完成项、下一步）
- `session-handoff.md` 已更新（具体到命令级别的下一步动作）
- 没有 feature 处于"代码写了但没 verify"的中间态
- `pnpm -w run verify:base` 仍然通过

---

## 常用命令速查

```bash
# 新建阶段
pnpm harness new-phase --id 03 --name "my-feature" --goal "..."

# 新建 sprint，把 feature 分配进去
pnpm harness new-sprint --phase 03 --id 01 --goal "..." --features F01,F02

# 验证
pnpm harness verify --sprint 03/01

# GitHub 同步（dry-run）
pnpm harness sync --phase 03
# 真正执行（需要 gh auth login）
pnpm harness sync --phase 03 --apply

# 查看总进度
cat .harness/state/PROGRESS.md
```

---

## 经验教训（从 Phase 01 沉淀）

> **陷阱 1**：`verify:base` 空跑成功  
> 子包的 `package.json` 里 scripts 是 `echo TODO`，turbo 跑了个寂寞。  
> **防护**：每个子包必须有真实的 `vitest run`/`tsc --noEmit`，不接受 echo 占位。

> **陷阱 2**：config 是假文档  
> `harness.config.yaml` 的配置没有接入运行时，改了 yaml 对行为零影响。  
> **防护**：所有可配置行为必须通过 `loadHarnessConfig()` 读取，不能硬编码。

> **陷阱 3**：passing 状态被手动篡改  
> 直接编辑 `feature_list.json` 把 status 改成 passing 绕过了验证门控。  
> **防护**：pre-commit hook 检测 passing 状态变更，要求必须有 evidence 文件。

> **陷阱 4**（PR #310/#311/#312 三连事故）：evidence 是「指向空气的引用」  
> feature_list 指向 `evidence/*.verify.log`，但文件被根 `.gitignore` 的 `*.log` 挡住没进仓库。  
> **防护**：收尾前 `git ls-tree HEAD -- phases/**/evidence/` 实测；reviewer 也会实测，不信声称。

> **陷阱 5**：fresh worktree 的 pre-push hook 失败（turbo not found）  
> 无 node_modules 的 worktree 直接 push 会被 pre-push 拦。  
> **防护**：纯文档/配置改动可 `git push --no-verify`（commit message 写明理由）；
> 代码改动必须先 `pnpm install` 并本地跑过验证再推。

---

## 能力清单（这个 skill 让你具备的可执行动作）

- 判断"现在该跑哪条 harness 命令"：开工三步 → 执行 → `verify` → 收尾，每一步对应
  一条本文件已给出的命令，不用去翻 `.harness/scripts/cli.ts` 现查。
- 识别"证据是不是真的"：不止看 `verify` 退出码，还要跑
  `git ls-tree HEAD -- phases/**/evidence/` 实测文件在不在 git 树里（陷阱 4）。
- 识别"这条 verify 命令是不是空跑"：子包 `package.json` 的脚本如果是
  `echo TODO` 之类占位符，`verify:base` 会假绿（陷阱 1），开工前扫一眼目标子包的
  `test`/`typecheck` 脚本内容。
- 分清"哪些命令允许自己跑、哪些只能门控产出"：`verify` 能把状态推成
  `passing`，但你不能手改 `status` 字段——这条界限之上还有一整条 harness 命令表
  （`doctor`/`sync`/`claim`/`sweep-*`/`dep-graph`/`graph`/`phase-readiness`/
  `pr-queue`/`tick`/`lock-*`/`module-lock-*`……），完整参数速查看
  `pnpm harness`（不带子命令）的输出或 `.harness/scripts/cli.ts` 的 usage 块，
  本文件不重复它们的参数细节，只讲你在日常开发循环里真正会用到的那几条。

---

## 架构知识：这个 skill 在 harness 工具链里的位置

```
requirement-author → feature_list.json（阶段权威）
        │
sprint-planner → new-sprint（把 feature 分配进 sprint，派生 active-features.json）
        │
   ★ 本 skill 覆盖的区间 ★
        │
   开发者/agent 实现 → verify（唯一门控，写 evidence + 翻 passing）
        │
        ├─→ github-projector → sync（单向投影到 GitHub）
        └─→ harness-auditor / doctor（审计链体检，ADR-012）
```

- **输入**：`phases/<phase>/sprints/<sprint>/progress.md`、`session-handoff.md`、
  `active-features.json`（只读派生视图）——这三个是本 skill 每次开工必读的状态面。
- **产出**：`evidence/F<NN>.verify.log`（`verify` 写入）、更新后的 `progress.md`/
  `session-handoff.md`（收尾时手写）。
- **下游消费者**：`pnpm harness doctor` 读 evidence 目录核验"passing 是否有真凭据"；
  `github-projector` 的 `sync` 读 `feature.status` 决定要不要关闭/打标 Issue；
  coordinator 的 `pnpm harness tick`/`cycle-report` 读 `PROGRESS.md`/lease 状态
  判断是否要重派。本 skill 自己不直接写这些下游文件，但它是它们数据的源头。

---

## 领域知识：为什么是"开工三步 + 单一验证门"这套设计

**本仓教训优先于外部参照**——上面五条"陷阱"都是真实事故复盘，是这套流程存在的
直接原因：没有第三步"只做一个 in_progress"，会撞见 PR #310/#311/#312 那种
status 被 diff 夹带手改的事故；没有 evidence 实测，会撞见 evidence 指向空气
（陷阱 4）。这套流程本质上是给"agent 自陈完成"加了一层不可绕过的机械验证，
逻辑等价于 CI 的"只信退出码，不信自然语言描述"。

**外部参照怎么支撑它**：
- monorepo 任务编排的通用实践（如 Turborepo）强调"任务必须有真实的输入输出，
  缓存正确性依赖任务内容不是空跑"——这与陷阱 1（`echo TODO` 假验证）是同一类
  问题的不同表现形式：**编排系统只能验证"命令跑没跑"，验证不了"命令有没有
  实际做事"，这道防线必须由任务作者自己保证**，本仓选择用文档纪律
  （"不接受 echo 占位"）而非工具强制，是因为跨语言子包的"真实验证"没有统一
  机器可判定标准。
- pre-commit/pre-push hook 的通用实践建议"钩子要快、要能跳过特殊场景"（如
  fresh checkout），本仓陷阱 5 的应对（纯文档改动允许 `--no-verify` + 说明理由）
  与这个思路一致：钩子该挡的是"未验证的代码改动"，不该挡"没有 node_modules
  但确实没碰代码"的场景，纪律写在 commit message 里保留可追溯性而不是放开口子。
- 参考来源：[Turborepo 最佳实践与流水线设计](https://blog.nashtechglobal.com/monorepo-setup-with-turborepo-the-complete-guide-to-consistent-code-quality/)、
  [Turborepo + Husky pre-push 性能实践](https://dev.to/pratiktalreja/keeping-branches-in-sync-in-a-monorepo-the-pre-push-hook-solution-3c0f)、
  [monorepo git hooks 设置模式](https://fab1o.medium.com/how-to-setup-git-hooks-in-monorepo-1aed1e1ac8c2)。

---

## 迭代 / 知识回流机制

- 撞到新陷阱（假绿、状态被绕过、evidence 造假的新花样）→ 在"经验教训"区
  **追加**一条新陷阱，编号递增，不改写旧条目；引用具体 PR/issue 号。
- 这是一条通用 SOP skill（不是模块知识库），不走 `mod-*` 的踩坑区格式，但同样
  遵守 append-only：旧陷阱描述过时了也不删，标注"已被 XX 机制取代"。
- 本 skill 的整体升级状态记录在 `.harness/state/skill-upgrade-backlog.md`
  （批次 C），该文件是"哪些 skill 已深度升级"的单一事实源，不要在别处复述进度。
