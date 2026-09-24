---
bundle: chat-knowledge-graph
phase: "18"
covers: [F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F12, F13, F14]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
---

# 契约束 `chat-knowledge-graph` 设计签核

覆盖 phase-18 全部 14 个 feature（`../../feature_list.json`）：底座（AGE 镜像、本体表、执行器、投影、向量索引）、会话入图、删除失效、混合召回、知识面板读写、晋升到个人空间、北极星端到端。
需求：`requirements/uc-18-1` … `uc-18-5`；第 0 轮（S0）已由人类于 2026-09-24 确认。
为什么是一束：五个 UC 共用同一套表、同一个执行器和同一组不变量（I-1…I-16）。拆开会出现「A 束签了，B 束签时发现 A 的不变量不够用」（contract-design.md 的切束判据）。

## 〇、签核前请先拍板的两项（这两项会改动已签的 `context-pack` 束）

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| **D-KG-1** | 图或向量一路不可用时，「检索不可用」这个信号放在哪（uc-18-2 E1/E2、S6） | **A.** `RetrievalChannelPlan` 加 `available: boolean`，按通道报健康状态；**B.** `omission-reason` 新增一类 `channel-unavailable`（封闭枚举，需补 ADR）；**C.** 本束另起字段，不动 context-pack | **A**。「不可用」是通道级状态，不是某一条内容被丢弃；塞进 omissions 会得到一条没有 `ref` 的丢弃记录 |
| **D-KG-2** | 「为什么召回」的图路径文本从哪来（uc-18-2 R3-5） | **A.** `ContextItem` 加可选 `graphPath: { src, relation, dst }[]`；**B.** 前端用 `KgEdge` 自己拼 | **A**。前端没有召回时用到的那条路径，自己拼出来的路径不一定是召回实际走的那条 |

两项选定后，由 agent 在 `context-pack` 束走 design-delta，再回到这里。

## 一、材料清单

- ① UI：`ui.md`（21 张截图，`/preview/chat-knowledge-graph`）
- ② 用例：`usecases.md`（UC-KG-1…7 对外；UC-KG-8…10 内部）
- ③ API 契约：`packages/contracts/src/chat-knowledge-graph.ts`（7 个操作、14 个错误码）
- 支撑 · 领域模型：`domain.md`（不变量 I-1…I-16，以及三态投影）
- 支撑 · 覆盖证明：`coverage.md`（五个 UC 共 20 条 R12 验收判据全部映射；反向逐操作列出）

## 二、签核时请重点核对

1. **① UI**
   - 入口是会话右侧栏「知识」tab，默认列表视图；
   - 三态配色，以及 Badge 新增的 `success` tone；
   - 图视图只读。
   见 `ui.md` 第四节。
2. **② 失败模式**：
   - `KG_ACTOR_NOT_HUMAN` 与 `KG_NOT_OWNER` 分成两个码。前者是 Agent 身份，后者是可见但不是所有者。
   - 晋升是逐条结果，不整批失败。
   请确认这两处取舍。
3. **③ API 契约**：`getPersonalKnowledge` 没有 R12 判据直接要求它（`coverage.md` 第二节），请判断保留还是删掉。
4. **不变量**：
   - I-3「模型不直写」要靠数据库角色权限落实：应用连接对本体表没有写权限，只有执行器有。请确认接受这个实现约束。
   - I-11「canonical 为准」是删除不泄漏的关键。
5. **范围**：本阶段只开放 `chat_session` 和 `personal` 两种作用域（I-1）。`KgScopeKind` 的五个成员现在就定义好，外扩时不用改表。

## 三、签核记录

（人类签核后填写 frontmatter 的 `status: confirmed`、`confirmed_by`、`confirmed_at`；agent 不许改。）
