# 人类决策打包流程 —— 收窄成选择题 + 单 PR 交付（2026-08-13 起）

> 这份文件解决一个反复发生的真实摩擦（2026-08-13 一次性攒了 5 处签核暴露出来）：
> coordinator 发现一批需要人类判断的签核点，用开放式问题去问（"你觉得该怎么办？"），
> 人类要读大段上下文才能回答；回完，coordinator 又甩给人类一串裸 shell 命令去手工
> push/merge。**人类要花的力气本该是 agent 的活。**
>
> 本文件是执行书，不是新裁决——不改 ADR-023 的信任边界（status 只能由人类改），
> 只优化"人类怎么被问、怎么落地"这两步的**摩擦**。

## 规则一：所有需要人类判断的点必须收窄成 A/B（/C/D）

禁止用开放问题问人类。每个决策点在问出去之前，coordinator 自己先做这件事：

1. 把开放问题收窄成 **2–4 个候选方案**（硬上限 4；超过 4 说明这个决策该拆成多条问）；
2. 每个候选给一句「支持理由」+ 一句「代价」，不写废话铺垫——人类要能不点开任何链接
   就做出选择；
3. 涉及多个独立决策点时统一编号（① ② ③…），人类的回复应该能压缩成
   一行「1 A，2 A/A/A，3 A」这种格式全部走完。

`AskUserQuestion` 工具是首选载体（结构化选项、不需要人类手打字母）；纯聊天场景下
用明确的编号+字母格式也可以，但选项本身**必须**先被收窄，不能甩一个开放问题过去
让人类自己在选项之外发挥。

## 规则二：回答收到后，coordinator 独立完成全部机械操作，只把"审阅入口"留给人类

1. **隔离 worktree**：为每个需要改 `status`/决策字段的文件，在 scratchpad 下开一个
   独立 worktree（不碰主工作树、不碰其它 agent 正在用的分支），写入人类刚给出的决策：
   `status: confirmed` + `confirmed_by` + `confirmed_at` + `confirmed_via`
   （`confirmed_via` 逐字转写人类给出的选择依据，不得替人类编造或过度归纳）。
2. **push 这个 `signoff/<id>` 分支** —— 实测（2026-08-13）：这一步会被工具权限层的
   auto-mode classifier 挡住（"Blocked by classifier"），这是 ADR-023 决策五
   在工具层的额外实现，**coordinator 不应重试绕过**，直接把这一条 push 命令原样
   交给人类跑一次（一条命令，不是一串）。
   - 纯文档改动（frontmatter + 结论段落）如果落在刚建的 scratch worktree 里，
     pre-push hook 会因为没装 `node_modules` 在 `tsx not found` 上假红——hook 自己
     写明了这种场景的官方出口是 `git push --no-verify`；这个跳过对纯文档改动是安全的，
     **不能**用来跳过真实失败的检查（比如任何触碰了 `.ts`/`.tsx` 源码的改动）。
3. **`gh pr create --base <该签核所属的活分支> --head signoff/<id>`** —— 这一步不需要
   push，是纯 API 调用，coordinator 自己可以做（分支已经在 origin 上了）。
   - base 通常是等待签核的那个 worker/design 分支；如果签核文件本来就活在 main 上
     （某些跨阶段 delta），base 直接指 main。
   - PR 标题统一前缀「chore(signoff): 」，正文列出对应的决策编号/字母，方便人类
     review 时对照。
4. **只把 PR 链接发给人类** —— 不给任何 shell 命令。`.github/CODEOWNERS` 已经把
   `design-signoff.md` / `design-coherence.md` / `ui-signoff.md` 三类文件归属人类
   review；人类在这个小 PR 上点 Review → Approve → Merge，就是"我看过"这件事的
   机械证据，全程不需要理解或执行任何 git 操作。
   ⚠ **CODEOWNERS 实际生效前提是仓库 Settings → Branches 里勾了「Require review
   from Code Owners」**——这份文件写这条时未逐一核实该开关状态；如果人类还没开，
   这一步目前只是**约定层面**的保护（本流程仍然要求走 PR review 这个动作），
   建议人类找时间确认一下这个仓库设置，把它从"约定"变成"机械"。
5. **coordinator 不自己合并这类"签核回填"PR**，即便 CI 全绿——即使技术上权限允许，
   这类 PR 存在的唯一目的就是让人类做一次可追溯的 review 动作，coordinator 代劳
   等于把这道门废掉。（这条与 coordinator 平时合并普通 feature PR 的职责不冲突：
   feature PR 本身该不该合是另一件事，是"这个签核 PR 要不要被打开来看一眼"是本文件
   管的事。）

## 规则三：每次会话重启后，先检查有没有等待中的签核决策

- `pnpm harness dashboard` 的「等人类（签核/Accept 面）」一节列出全部 pending 签核——
  这是权威来源，新会话开工前先跑一遍。
- 对每一条，按规则一收窄成 A/B（/C/D）列出来问人类，**不要假设人类还记得上一轮
  聊了什么**——跨会话上下文可能已丢失，每个决策点要能独立成立、独立可读，
  贴出文件路径（可点击）+ 候选方案 + 各自的支持理由/代价。

## 已知的技术细节（踩过的坑，2026-08-13 实测）

- 新建的 scratchpad worktree 没有 `node_modules`，pre-push hook 里
  `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm turbo run typecheck lint test --affected`
  会报 `tsx not found` 并假红——这是环境问题不是真实门控，hook 自己也写了
  「跳过（不推荐）：`git push --no-verify`」作为这种场景的官方出口。
- **push 会被挡，普通读操作（`git log`/`git status`）不会**——如果连读操作都被挡，
  先确认是不是命令本身写错了，不要立刻归因于"权限层又发作了"。
- `gh pr merge --delete-branch` 在分支被某个 worktree 占用时会报
  `cannot delete branch ... used by worktree`——**合并本身通常已经成功**，
  用 `gh pr view <n> --json state,mergedAt` 单独确认，不要把这条 stderr 误判成合并失败。
- 遇到 `fullstack-smoke` 单次失败但改动与前端/后端代码零重叠（比如本流程这种纯文档
  改动）时，先用 `gh pr diff <n> --name-only` 核对文件重叠面，再决定是不是可以直接
  `gh run rerun <run-id> --failed`——不要不核对就假设是 flake，也不要每次假红都去改
  测试本身。

## 与 `contract-design.md` 第四节的关系

`contract-design.md` 第四节「签核流程」定义了签核**内容**上人类要做什么
（逐节确认三件、`status` 改 `confirmed`）；本文件定义的是**交互摩擦**上
coordinator 该怎么把这件事打包到人类面前——两者不重复，前者是"审什么"，
后者是"怎么问、怎么落地"。
