---
name: github-projector
description: >
  激活条件：用户提到 GitHub 同步、投影、issue、milestone、sync、把进度发到 GitHub、
  对外可见 等关键词时触发。
  包装 harness sync，确认单向投影结果，判断何时该同步。
---

# GitHub Projector Skill

## 何时使用

需要把仓库内的 feature 状态投影到 GitHub（Milestone / Issue / label）时。

> 核心铁律：**单向投影。文件是唯一事实来源，GitHub 只读、可重建。**
> 绝不从 GitHub 往回改 feature 状态。
> ⚠ 注：认领/心跳/协调唯一性的权威已于 ADR-009（2026-07-08）迁至 coord-service（D1），
> 本 skill 涉及的仅是 `status:*` label 这类只读投影，不是协调锁——不要把这里的
> "GitHub 是权威"理解成"issue/label 也是协调认领的权威"，两者是分开的两件事。

---

## 投影映射

| 仓库内 | → GitHub |
|--------|----------|
| phase | Milestone |
| sprint | label `sprint:<phase>-<sprint>` |
| feature | Issue（标题 `[F0X] 标题`，body 含 verification 勾选项） |
| feature.owner | Issue assignee（owner 为 null 则不设） |
| feature.status | label / 关闭动作（按 `github-sync.yaml` 的 status_actions） |

---

## label 纪律（不得制造漂移，见 ADR-004）

- **`status:*` 是互斥生命周期 label**，流转必须与
  [multi-agent-coordination.md](.harness/instructions/multi-agent-coordination.md) 的
  状态机一致（`feature_list.json` 的 `passing` ⇔ `status:merged`）。
  投影只能写规范 label 集合，禁止发明新 label 或复活已废弃的裸 label
  （`in-progress`/`blocked`/`passing`）。
- **`review:*-ok` / `review:changes` 是 reviewer verdict，只能由 coordinator
  编排的 reviewer agent 产出。** 本 skill 的同步动作**绝不**打/摘任何 `review:*` label；
  worker 更不得自打 `review:*-ok`（实战事故：双 coordinator 并行导致两轮 review
  结论冲突，假绿险些放行）。发现 verdict label 与可核验事实（如 evidence 是否在
  git 树中）冲突时，以事实为准并升级给 coordinator，不要用投影"修正"它。

---

## 何时同步（判断）

- ✅ 一个 sprint 的 feature 集合/归属变化后 → 同步，让对外视图跟上。
- ✅ feature 升 `passing` 后 → 同步，关闭对应 Issue。
- ❌ 实现进行到一半、状态没变 → 不必同步，避免噪音。
- 默认只对**当前/近期 sprint** 开 Issue（由 `issue_policy.near_term_window` 控制），
  不要一次性把所有历史 sprint 都投影出去。

---

## 落地命令

```bash
# 先 dry-run，看清楚要执行哪些 gh 操作（不实际改 GitHub）
pnpm harness sync --phase <NN>

# 确认无误后真正执行（需先 gh auth login）
pnpm harness sync --phase <NN> --apply
```

**始终先 dry-run 再 --apply。** 看清楚计划里的每条 gh 命令，确认投影方向对、
assignee 对、不会误关 Issue，再执行。投影是单向的，但误操作仍可能在 GitHub 侧
造成需要手工清理的噪音。

---

## 能力清单（这个 skill 让你具备的可执行动作）

- 判断"这次改动值不值得同步"（见上方"何时同步"表），不是每次 feature_list.json
  变化都要触发一次 GitHub 写操作。
- 读懂 `pnpm harness sync --phase <NN>` 的 dry-run 输出，逐条核对 gh 命令的
  意图（新建 issue / 打 label / 关闭 issue / 设 assignee），不盲目信任"看起来对"。
- 识别 owner 不会被投影为 assignee 的场景：`owner_github_map` 没显式映射的
  harness owner（例如 agent 身份 `main-agent`）不会被设成 assignee，这不是 bug，
  是 `.harness/config/github-sync.yaml` 里刻意的防呆（避免拿 agent 身份当
  GitHub 登录名传给 API 触发 422）。
- 识别"投影应该幂等但没做到"的信号：`sync-github.ts` 用 issue body 里的 marker
  （phase+feature 标记）优先匹配已存在的 issue，marker 匹配不到才退化到按标题
  搜索——如果发现同一 feature 对应了多个 issue，是幂等匹配失效的信号，先查
  marker 有没有被人手动改动过，不要直接删 issue 了事。

---

## 架构知识：这个 skill 在 harness 工具链里的位置

```
feature_list.json（阶段权威，sprint-planner/verify 写入）
        │
   ★ 本 skill 覆盖的区间 ★
        │
pnpm harness sync --phase NN [--apply]
        │  读取 .harness/config/github-sync.yaml（mapping / labels / status_actions /
        │  issue_policy / owner_github_map）
        ▼
GitHub（Milestone=phase, label=sprint, Issue=feature）—— 只读投影，不回写仓库
```

- **输入**：`feature_list.json`（status/owner/area/sprint/priority/title/
  verification）+ `.harness/config/github-sync.yaml`（映射规则，唯一可配置面）。
- **产出**：GitHub 侧的 Milestone/Issue/label 状态。**没有任何仓库内文件被
  这个命令写回**——这是"单向投影"的字面含义，不是比喻。
- **下游消费者**：人类/其它协作者通过 GitHub 界面看进度；`review:*` label 由
  reviewer agent（coordinator 编排）产出，与本 skill 的同步动作是两条独立的
  写入路径，互不覆盖（详见下方"label 纪律"，这条边界本身就是过去的事故防线）。
- **谁调用它**：sprint-planner 排完 sprint、verify 把 feature 推成 passing 之后，
  是两个最常见的触发点；harness-workflow 的收尾清单里也会提醒检查是否需要同步。

---

## 领域知识：为什么是"单向投影"而不是双向同步

**单向投影 = CQRS 里"写模型只有一个、读模型可重建"的直接应用**：
`feature_list.json` 扮演事件溯源系统里"权威事实源"（近似于 write model /
event store）的角色，GitHub Issue/label 是从这个源**派生**出的 read model
投影。CQRS/事件溯源的经典准则是"投影必须可从源头完整重建、且投影处理必须
幂等，因为写入可能因重试而重复"——这两条本仓都能对上号：

- **可重建**：`sync-github.ts` 每次运行都从 `feature_list.json` 当前状态重新
  计算目标 label 集合，不依赖增量 diff，这与"projector 应能整体重放重建"的
  实践一致。**但本仓不是严格意义上的事件流投影**——它没有事件日志，每次都是
  对"当前快照"重新计算，不是"重放历史事件序列"；这是简化版单向投影，不是
  完整 CQRS。看到"单向投影"这个词不要类比成完整的 event sourcing 架构，本仓
  只借了它"源头单一、下游可重建、不回写"这条核心约束。
- **幂等靠 marker，不是靠增量游标**：真正的 event-sourced projector 通常维护
  一个消费游标（checkpoint）保证"处理到哪了"；本仓没有游标，用 issue body 里
  嵌入的 marker 字符串做"这个 feature 是否已经建过 issue"的幂等判定。这个
  设计选择是真实事故逼出来的——**2026-07-29 实测**：`gh issue create` 是先建
  issue 再设 assignee 两步操作，assignee 设置失败时 issue 已经建出来了，旧代码
  在这种情况下无条件重试，直接把 F18 建成了 `#2` 和 `#3` 两条重复 issue。marker
  匹配优先、标题匹配兜底的两层查找，就是这次事故后加固的幂等保护。
- **只读投影的另一层理由是权限边界**：GitHub 侧的状态（尤其 `review:*` label）
  可能被 reviewer agent 或人类手动改动，如果 sync 是双向的，一次误操作的
  GitHub 侧改动就会污染仓库内的权威状态；单向投影从架构上排除了这种污染路径，
  这与"label 纪律"里"绝不用投影修正 verdict label"是同一条防线的两个层面。

- 参考来源：[CQRS + Event Sourcing 实践](https://hosseinnejati.medium.com/cqrs-event-sourcing-together-how-they-work-in-practice-a3e9193a0e54)、
  [projection 幂等性与自治性最佳实践（cqrs-best-practices）](https://github.com/slashdotdash/cqrs-best-practices)、
  [Transactional Outbox 模式与外部系统集成](https://mia-platform.eu/blog/understanding-event-sourcing-and-cqrs-pattern/)。

---

## 迭代 / 知识回流机制

- 撞到新的"投影产生噪音/重复/漂移"事故 → 在"领域知识"这段追加一条真实案例
  （已有 F18 重复 issue 一条），不要只在 commit message 里描述，事故是这个
  skill 存在的证据链。
- `github-sync.yaml` 的字段含义变化（新增 mapping/label/status_action）时，
  同步更新"投影映射"表和"落地命令"，但**不要**把 yaml 里的具体值复制粘贴进
  本文件长期维护——本文件只描述"有哪些可配置维度"，具体值以 yaml 为准，这是
  避免第二份事实副本的边界线。
- 升级状态记录在 `.harness/state/skill-upgrade-backlog.md`（批次 C）。
