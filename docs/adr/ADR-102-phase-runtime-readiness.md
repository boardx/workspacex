# ADR-102: Phase runtime/E2E readiness is independent from feature passing

- 状态: Proposed
- 适用层：方法论（可移植）
- 日期: 2026-08-04 00:13:14

## 背景

Feature `passing` 回答的是「这一条 feature 的完成契约是否通过」。它不能回答运行时
是否真实接线、完整用户旅程是否通过、外部依赖是否可达，也不能替代 release readiness。
WorkSpaceX phase-01 已出现 144 条 feature 中 142 passing、2 in_progress 的状态；如果把
passing 数量或 roadmap `done` 当成产品可运行结论，就会让验证在未接线实现上空转。

现有 `verify` 必须保持语义不变，不能为了 phase 级结论重写历史 passing。新的状态还必须
能被 agent 与 CI 机械读取、显式转移、独立审计，并让伪造 ready 变成 doctor FAIL。

## 决策

每个 phase 拥有独立 `runtime-readiness.json`，schema v1 只有 `not_ready` / `ready`。
`new-phase` 初始化 `not_ready`；不从 feature 数量、roadmap status 或 progress 表派生。

只有 `pnpm harness phase-readiness --to ready` 能完成显式转移。门同时要求：

1. phase 非空且每条 feature 都已 `passing`；
2. runtime 与 E2E 两份结构化 evidence manifest 均为 exit 0；
3. evidence、其 artifacts 已提交且工作树无漂移；
4. manifest 固定同一 target commit，readiness 记录 evidence SHA-256 与操作者/时刻。

转回 `not_ready` 也必须通过同一命令并给出原因。`doctor` 复用同一判定：not_ready 明示
WARN 和 passing 计数；ready 若缺证据、证据漂移或 feature 回退则 FAIL。feature verify、
passing 不可逆规则与 feature_list 的 schema 均不改变。

## 后果

正面：feature 完成度与可运行/可发布结论不再混为一谈；#387 可以产出 evidence 后通过
稳定门控声明 readiness；doctor 能机械抓住 142/2 和「全 passing 但无 E2E」两类假阳性。

负面：每个 phase 多一份状态文件和两份受版本控制的 evidence；ready 转移通常发生在
evidence commit 之后，因此需要额外一次小提交。`not_ready` 是正常且可见的 WARN，不能
再用全绿 feature 数字代替发布判断。

## 备选方案

- 用 `roadmap.status: done` 表示 ready：否决。它没有 evidence、target commit 或转移门，
  且历史语义是计划进度。
- 增加 feature 状态 `runtime_ready`：否决。runtime/E2E 是 phase 级交叉行为，复制到每条
  feature 会制造 N 份事实并改变既有 passing 语义。
- `passing === total` 时自动 ready：否决。这正是本事故要阻止的推断，无法证明真实接线。
- 只写一份发布报告、不建 schema：否决。文本没有原子状态转移与 doctor 机械审计能力。
