# `.harness/events/` —— TPL-EVT-001 Workflow Event 实例存放约定（H3A-033）

Proposal（`PROP-HARNESS-AGENT-001.md` §10.4）定义了 `TPL-EVT-001` 的字段形状，
但没有规定实例落在哪——本目录是 H3A-033 这个 PR 做出的**第一个真实存放约定**，
不是从 Proposal 原文抄来的既成事实，如实标注这一点，免得以后被误读成"早就有
这个目录"（同 `.harness/tasks/README.md` 建立 Task Assignment 存放约定时的
先例）。

- 每个 Workflow Event 实例是一个 `.yaml` 文件，`template_id: TPL-EVT-001` 的
  frontmatter 直接就是文件全部内容。
- 四类 `kind`：`task_assignment` / `progress` / `blocker` / `task_result`
  （Proposal line 205 原文列出的四类；只有 `progress` 有逐字示例，另外三类
  的字段是合理推断，如实标注见
  `.harness/scripts/lib/workflow-event-model.ts` 文件头部注释）。
- Schema 校验：`.harness/scripts/lib/workflow-event-model.ts`
  （`validateWorkflowEvent`）。
- Event stable ID 重复 / append-only（历史覆写）校验：
  `.harness/scripts/lib/workflow-event-append-only-gate.ts`
  （`checkDuplicateInstanceIds` / `checkAppendOnly`，H3A-034；git IO 在
  `workflow-event-doctor.ts`）。
- **本目录故意不做的事**（分给后续条目）：
  - 12 行短文本 renderer——H3A-035，尚未落地。
  - `task_id` 指向的 Task Assignment 是否真实存在——跨表 gate，尚未落地。

**今天这个目录是空的**——Epic E3 才刚起步（H3A-030 TPL-TSK-001 是这个 Epic
第一个落地的条目），没有任何真实 Workflow Event 产生过，这是仓库的真实状态，
不是本 PR 的遗漏（同 `.harness/tasks/` 落地时 0 个真实 Task Assignment 实例
的先例）。将来 Specialist Worker 真正开始上报 Progress/Blocker/Task Result
时，才会有第一个真实实例落在这里。
