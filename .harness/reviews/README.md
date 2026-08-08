# `.harness/reviews/` —— TPL-RVW-001 Review Decision 实例存放约定（H3A-036）

Proposal（`PROP-HARNESS-AGENT-001.md` §10.5）定义了 `TPL-RVW-001` 的字段形状，
但没有规定实例落在哪——本目录是 H3A-036 这个 PR 做出的**第一个真实存放约定**，
不是从 Proposal 原文抄来的既成事实，如实标注这一点，免得以后被误读成"早就有
这个目录"（同 `.harness/tasks/README.md`、`.harness/events/README.md` 建立
存放约定时的先例）。

- 每个 Review Decision 实例是一个 `.yaml` 文件，`template_id: TPL-RVW-001` 的
  frontmatter 直接就是文件全部内容。
- Schema 校验：`.harness/scripts/lib/review-decision-model.ts`
  （`validateReviewDecision`）。
- `reviewer === producer`（同一 actor 自产自签）在 schema 校验层面直接判
  FAIL——这是这份实例自己的字段级约束，跟 H3A-027
  `checkProducerVerifierSeparation`（`role-authorization.ts`，角色注册表层面
  的静态一致性检查：`registry.yaml` 的 `agents:`/`reviewers:` 是否有身份重叠）
  互补而不重复，见 `review-decision-model.ts` 文件头部注释的完整分工说明。
- **本目录故意不做的事**（分给后续条目，或本来就不是本目录的事）：
  - `exact_sha` 是否等于当前受审对象的真实 exact SHA（"revision 是否
    stale"）——运行态语义，需要查询当前 Git HEAD/受审 PR head，本目录只检查
    字段非空字符串存在。
  - `evidence_refs` 指向的路径是否真实可读——同上，运行态语义。
  - `reviewer` lease 是否有效——需要查询 lease 系统当前状态，运行态语义。
  - `task_id` 指向的 Task Assignment（`.harness/tasks/`）是否真实存在——跨表
    gate，尚未落地（同 `.harness/tasks/`/`.harness/events/` 对各自跨表 gate
    的先例）。

**今天这个目录是空的**——Epic E3 才刚起步（H3A-030/033 是这个 Epic 目前落地
的条目），没有任何真实 Review Decision 产生过，这是仓库的真实状态，不是本 PR
的遗漏（同 `.harness/tasks/`、`.harness/events/` 落地时 0 个真实实例的先例）。
将来独立 Verifier 真正开始对 exact SHA 出具审查决定时，才会有第一个真实实例
落在这里。
