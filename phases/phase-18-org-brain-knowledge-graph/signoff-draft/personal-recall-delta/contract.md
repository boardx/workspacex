# design delta · 个人对话召回边界放宽到「本人个人空间里已确认的记忆」

> 目标位置：签核 PR 里移到 `phases/phase-01-run-a-project/design-deltas/personal-thread-recall-personal-memory/`。
> base_bundle：phase-01 `chat-context-engine`（已签）。先行 delta：`personal-thread-own-attachment-recall`（已签）。
> 人类同意：phase-18 S0-3（2026-09-24「都同意」）。

## 改什么

已签口径：个人对话**只能**召回本线程自己的附件，跨范围召回恒为 0。
放宽为：另外**可以**召回**同一用户**个人空间（L1）中的记忆（phase-18 uc-18-4）。

## 不放宽的部分（硬边界）

- 别人的会话、别人的个人空间、任何项目或组织数据：召回恒为 0（`cross_scope_retrieval_requests == 0` 的定义改为「不含本人 L1」，其余不变）。
- 会话里的其他成员提问时，读不到会话所有者的 L1（phase-18 I-14）。

## 验收

- V1：同一用户新个人会话召回到 L1 记忆，来源标 `personal-memory`；
- V2：另一用户、同组织项目数据仍为 0；
- V3：反证——把 L1 作用域错误放宽到「本 org」，V2 当场红。
