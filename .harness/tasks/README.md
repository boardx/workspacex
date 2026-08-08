# `.harness/tasks/` —— TPL-TSK-001 Task Assignment 实例存放约定（H3A-030）

Proposal（`PROP-HARNESS-AGENT-001.md` §10.3）定义了 `TPL-TSK-001` 的字段形状，
但没有规定实例落在哪——本目录是 H3A-030 这个 PR 做出的**第一个真实存放约定**，
不是从 Proposal 原文抄来的既成事实，如实标注这一点，免得以后被误读成"早就有
这个目录"。

- 每个 Task Assignment 实例是一个 `.yaml` 文件，`template_id: TPL-MOD-001` 的
  frontmatter 直接就是文件全部内容（不像 Domain Skill 实例套在 `SKILL.md` 的
  frontmatter 里——Task Assignment 没有配套的 markdown 说明文档需要挂载）。
- Schema 校验：`.harness/scripts/lib/task-assignment-model.ts`
  （`validateTaskAssignment`）。
- 跨表 gate（scope 是否越权、assignee_role 是否真实存在、dependencies 是否
  形成环）：H3A-031/032，尚未落地，不在本目录建立时的范围内。

**今天这个目录是空的**——Epic E3 在这个 PR 之前完全未开工，没有任何真实
Task Assignment 产生过，这是仓库的真实状态，不是本 PR 的遗漏（同 H3A-012
Domain Skill schema 落地时 0 个真实实例的先例）。将来 H3A-031 起的
Root→Domain/Domain→Worker dispatch 协议真正开始下发任务时，才会有第一个
真实实例落在这里。
