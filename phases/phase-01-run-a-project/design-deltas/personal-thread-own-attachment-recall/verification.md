# 验收口径 · 个人线程可召回本线程自己上传的附件

规范以 [`contract.md`](./contract.md) 为准。以下是**签核后** F156 的验收改写口径（真栈反证，不伪造）。

## V1（硬边界·不放宽）——个人对话对 org/project 数据仍零召回
- 构造：个人线程（无项目）+ 同组织另有已索引的项目 segment。
- 在个人线程 run 一次，读该 run 的 `agent_run_context`。
- 断言：`cross_scope_retrieval_requests == 0`；history 里**没有任何** `project-retrieval` 来源的伪消息；
  别组/别项目/别人的附件与 segment 一个都不出现。
- 反证：把受限召回路径的范围锚点从「本线程」错误放宽到「本 org」，本断言当场红。

## V2（放宽的部分·仅本线程自有附件）——超窗口旧附件可召回
- 构造：个人线程里很早的轮次上传一份已抽取附件（`extraction_status='extracted'`，
  `extracted_excerpt` 有内容），之后堆足够多轮把该附件挤出 L1 近端窗口。
- 以「问那份附件内容」为输入 run 一次。
- 断言（桥已建成时）：该 run 召回了**本线程自己**的附件片段，来源标记 `own-attachment`，
  `own_thread_attachment_recall > 0`；且仍 `cross_scope_retrieval_requests == 0`。
- 断言（桥未建成时，第一版）：召回**降级为空**、`agent_run_context` 记降级、**run 不失败**，
  且 `cross_scope_retrieval_requests == 0` 仍成立。

## V3（来源可分辨）——F157 快照能分开两类
- 断言：`agent_run_context` 的召回来源字段能区分 `own-attachment` 与 `project-retrieval`；
  个人线程的快照里 `project-retrieval` 计数恒 0。
- 反证：把两类召回合并计成一个 `retrieval_requests` 总数，V1 的泄漏就测不出——本断言要求分列。

## V4（近端窗口内附件无需召回即可见·回归 F153）
- 构造：个人线程刚上传附件、就在近端窗口内问它。
- 断言：附件 `extracted_excerpt` 已由 F153 的 `withAttachmentNotice` 直接进 L1 上下文，
  **不经**任何召回路径即对模型可见（本 delta 不改这条既有行为）。

## V5（权限·仅创建者本线程）
- 构造：actor A 的个人线程附件；actor B 不可见 A 的个人线程（既有 F108）。
- 断言：受限召回路径只吃 `thread_id == 本线程 ∧ created_by == actor` 的附件；
  A 的附件绝不因任何路径出现在 B 的 run 上下文里。
