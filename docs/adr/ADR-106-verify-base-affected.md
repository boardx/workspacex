# ADR-106: 分级验证策略：拆分 `verify:base`、按风险分档、affected 优先

- 状态: Accepted（2026-08-15，coord-main 裁决：同意两批拆法，明确同意第二批的前置条件——
  不得在解决 #1068/#1090 连接预算根因前恢复并行、不得精简 turbo.json 的
  `globalPassThroughEnv` 规则。执行拆为独立 issue，一个 issue 一个 PR，逐条过 CI）
- 适用层：方法论（可移植）
- 日期: 2026-08-15

## 背景

人类提出一份效率优化建议（P0/P1/P2 共 12 项 + 文档收敛），核心诊断：`verify:base`
是所有验证路径（`harness verify` 门控每个 feature、pre-push 部分场景、init.sh）
共用的唯一权威命令，但它本身是一条串联链，且门控逻辑不区分改动风险，导致小改动
也要付全仓验证的时间成本。

**实测核对（逐条对着当前仓库真实文件核实，不是照抄建议）：**

- [package.json:14](../../package.json) `verify:base:raw` 确认是单条链式命令：19 个
  `lint:*-doctor` + `pnpm exec vitest --config .harness/vitest.config.ts` +
  `turbo run typecheck lint --continue` + `turbo run test --continue --concurrency=1`。
- [.harness/scripts/verify.ts:120-122](../../.harness/scripts/verify.ts) 确认
  `require_base_pass` 是全局布尔值（[harness.config.yaml](../../.harness/config/harness.config.yaml)），
  每个 feature 门控通过后都要重跑一遍完整 `verify:base`，没有风险分级。
- `init.sh` 的 `VERIFY_CMD` 就是完整 `verify:base:raw`，每次新 worktree 初始化
  都会跑一遍全量。
- CI（[.github/workflows/harness-verify.yml](../../.github/workflows/harness-verify.yml)）
  目前只有 `verify` + `fullstack-smoke` 两个 job，未按文件改动范围/风险拆分并行。
- pre-push hook（`init.sh` 生成）**已经**是 `turbo run ... --affected` 的轻量门控，
  不是从零实现；但解析不到与 `origin/main` 的 merge-base 时会显式回退到完整
  `verify:base`（`init.sh:104` 附近），这条回退路径本身就是建议里点名的"二十多分钟
  静默全仓验证"。

**建议原文未覆盖到、但会直接冲突的两处真实事故（这是本 ADR 存在的主要理由——
如果只按原始建议执行会复现已经修复过的问题）：**

1. **`apps/api/vitest.config.ts` 的 `maxWorkers: 1` 不是历史遗留疏忽，是
   2026-08-12（本 ADR 起草前 3 天）刚落地的事故修复**，注释直接写明续 #1068/#1090。
   背景是数据库测试共享连接预算、并行度调大后出现"看起来像 flaky、实际是连接数
   撞车"的假象（同类教训见issue #583「并行度准入——分母是 CPU 核不是栈数」）。
   建议 P2 item 9 提议"纯单元测试恢复合理并行"如果不先解决数据库连接预算 /
   隔离粒度这个根因，会原样复现刚修好的事故。
2. **`turbo.json` 顶部有一段专门记录的事故注释（"F20" bug）**：`WORKSPACEX_DB`
   这类环境变量过 turbo 任务边界会被 turbo 2.x 的严格 env 模式吃掉，导致两个并发
   worker 连到同一个共享库、互相污染 fixture，且"读起来像 flaky，从不像撞车"——
   与本仓沉淀的教训"共享测试库会污染对照实验"是同一类问题。建议 P1 item 7
   （编译缓存跨 worktree 复用）方向合理（typecheck/lint/build 缓存本身不碰数据库、
   风险较低），但实现时必须显式保留现有 `globalPassThroughEnv` 的 env-hash 规则，
   不能把这条已经用真实事故换来的隔离边界一并"优化掉"。

## 决策

**采纳建议的分级验证方向，但拆成两批，且第二批显式要求先处理上述两个事故边界，
不整批一次性实施：**

### 第一批（可以较快推进，风险可控）
1. 拆分验证命令：`verify:quick`（定向测试 + affected typecheck/lint/build）/
   `verify:harness`（只验证 `.harness` 控制平面）/ `verify:release`（全仓编译 +
   全仓测试 + 必要 E2E）——对应建议 P0 item 1。
2. `harness.config.yaml` 的 `require_base_pass: true` 布尔值改为按风险分档的
   `verification.profiles`（small/standard/high_risk），高风险判据至少覆盖数据库
   schema、鉴权/权限、跨束契约三类改动——对应 P0 item 3。`verify.ts` 按 feature
   风险选 profile，不再对每个 feature 都跑完整 `verify:base`——对应 P0 item 2。
3. 同一 SHA 验证结果复用（P0 item 4）：记录 commit SHA + 验证类型 + 命令 + 退出码
   + 完成时间 + 关键输入指纹，`harness verify`/pre-push/CI 遇到相同 SHA+配置直接
   复用，源码变化时指纹必须失效——这条本身就是"评价一致性"的机械门控,需要专门的
   反证用例（人为改一行代码后确认指纹立刻失效，不能只测"没改"的路径）。
4. `init.sh` 默认跑法改为依赖准备 + 生成物检查 + 快速健康检查，新增 `--full` 才跑
   完整验证（P1 item 5）；pre-push 的 merge-base 回退路径改为"先 fetch 一次，
   仍解析不到就报环境错误"，不再静默退化成全仓验证（P1 item 6，修正现状而非
   从零实现）。
5. CI 按 P1 item 8 拆分为并行 job（控制平面 doctor / 全仓 typecheck-lint-build /
   affected 单测 / 风险命中才跑的数据库集成测试 / 风险命中才跑的 E2E），全仓
   typecheck-lint-build 作为唯一强制合并前置条件。
6. 给每个验证阶段加耗时统计（P1 item 12），先有数据再决定要不要动 P2。

### 第二批（必须先解决根因，才能动手，不与第一批同批次实施）
7. **turbo 缓存跨 worktree 复用**（P1 item 7）：只对 `typecheck`/`lint`/`build`
   三个不触碰数据库的任务开放跨 worktree 缓存；`test` 任务维持现状（数据库/端口/
   隔离 ID 仍然参与 hash，缓存不跨 worktree 复用）；`globalPassThroughEnv` 的
   `WORKSPACEX_DB` 等 env 变量清单原样保留，不得在这次改动中被"顺手精简"。
8. **API 单元测试与数据库测试拆分并行**（P2 item 9）：不接受"直接调大
   `maxWorkers`"。先决条件是给数据库测试一个明确的连接预算隔离机制（专属库/
   显式事务边界，而不是共享一个测试库靠代码约定不冲突），有了隔离机制之后才能
   把纯单元测试的并行度从共享的 `maxWorkers: 1` 里解耦出来。这条要单独立 issue，
   引用 #1068/#1090 的事故记录作为反证基线（新方案必须先在这两个事故场景下
   跑绿，再谈合并）。
9. `.harness/vitest.config.ts` 的 `fileParallelism: false` 拆分（P2 item 10）、
   资源准入改机器级（P2 item 11）——方向认可，但同样要先确认不会撞上
   `stack-admission.ts` 现有的"排队不拒绝"设计里已经处理过的边界情况（僵尸栈
   识别、跨 worktree 共享准入闸），实现前需要一次专门的现状复核。

### 文档收敛
执行任一项之前，先把 `AGENTS.md`、`coding-standards.md`、
`clean-state-checklist.md`、`progress.template.md` 里"提交前必须跑
`verify:base`"的表述收敛为指向本 ADR + 新的 `verification.profiles` 单一权威源，
避免又一次"同一事实声明在两处"的漂移（本仓已有 5 次同类事故记录在案）。

## 后果

**正面：**
- 第一批完成后，人类估计等待时间可降低约 50%~70%（全仓重复验证是当前最大头）；
  第二批完成后，普通任务预计能到 2~4 倍提速，但这个数字依赖第二批的根因修复，
  不能提前当作已兑现的收益写进任何汇报。
- `verify.ts` 从"一刀切跑最贵的验证"变成"验证强度匹配改动风险"，符合门控应该
  精确打击、不该无差别加税的原则。
- 耗时统计（item 12）让"同步门禁膨胀"从隐性变成可 p50/p95 追踪的显性指标。

**负面 / 需注意：**
- 这是对硬门禁的改动，`require_base_pass` 从全局布尔变成分档配置，风险判据
  写错会导致高风险改动被误判为 small profile、漏过必要验证——判据本身需要
  单独的反证测试（用已知真实高风险 PR 反跑一遍，确认能被正确分类）。
- 验证配置从"一个命令"变成"profile + 风险判据 + SHA 复用凭证"三层，配置面
  变大，理解成本上升，需要在 `coding-standards.md` 里补一份"如何判断我的改动
  是哪个 profile"的速查表，否则会变成新的隐性知识。
- 第二批（数据库测试并行、机器级资源准入）如果绕开先决条件直接实施，会**原样
  复现** #1068/#1090（连接预算撞车）和 F20（turbo env passthrough 丢失、共享库
  互相污染）两个已经真实发生过的事故——这是本 ADR 与原始建议最大的分歧点，
  必须作为硬约束保留，不能在执行阶段被"为了赶进度"绕过。
- `init.sh` 默认弱化为快速检查后，"环境根本没装对"这类问题可能延后到真正跑
  `--full` 或 CI 时才暴露，需要在快速健康检查里至少覆盖"关键依赖是否装了"
  这一级，不能只剩语法检查。

**对架构平面的影响：**
- `harness.config.yaml` 的 schema 要新增 `verification.profiles` 结构，是
  一次面向所有 agent 的协议变更，需要在 `.harness/instructions/coding-standards.md`
  同步说明，避免出现"文档还在讲旧的 `require_base_pass` 布尔值"这类本仓已经
  出现过多次的漂移（参见同批次的 [ADR-017 落地经验](ADR-017-coord-gateway-repohub-cutover.md)：
  协议载体迁移后，所有引用点必须一次性核对完，不能只改代码不改文档）。

## 备选方案（考虑过，否决）

- **原样全盘采纳建议的 12 项，一次性实施**：否决。会在没有先解决根因的情况下
  重新打开 #1068/#1090 和 F20 两个已修复的事故窗口，且 12 项硬门禁改动一次性
  合并会让出问题时无法定位是哪一项改动导致的回归。
- **维持现状不动**：否决。`verify:base` 单条链式命令 + 全局布尔 `require_base_pass`
  确认会造成建议描述的重复全仓验证开销，是真实的效率问题，不是感知偏差。
- **只做 CI 并行拆分（P1 item 8），不动本地 pre-push/init.sh**：否决。CI 和本地
  命令目前共用同一套 `verify:base`/`verify:base:raw` 脚本，只拆 CI 端会让本地
  和 CI 出现两套不同的验证语义，违反"同一事实不得声明在两处"的仓库纪律。
