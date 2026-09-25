---
bundle: chat-knowledge-graph
phase: "18"
covers: [F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F12, F13, F14, F15, F16, F17]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
---

# 契约束 `chat-knowledge-graph` 设计签核

覆盖 phase-18 全部 17 个 feature（`../../feature_list.json`）：底座（AGE 镜像、本体表、执行器、投影、向量索引）、会话入图、删除失效、混合召回、知识面板读写、晋升到个人空间、北极星端到端。
需求：`requirements/uc-18-1` … `uc-18-5`；第 0 轮（S0）已由人类于 2026-09-24 确认。
为什么是一束：五个 UC 共用同一套表、同一个执行器和同一组不变量（I-1…I-16）。拆开会出现「A 束签了，B 束签时发现 A 的不变量不够用」（contract-design.md 的切束判据）。

## 〇、已由人类拍板的事项（2026-09-24）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| D-KG-1 | 图 / 向量不可用的信号放哪 | **A**：`RetrievalChannelPlan.available` | `../context-pack-delta/`（随本束一起签） |
| D-KG-2 | 「为什么召回」的图路径从哪来 | **A**：`ContextItem.graphPath`，召回实际走过的边 | 同上 |
| S0-3 | 个人对话可召回本人个人空间的记忆 | 同意 | `../personal-recall-delta/` |

人类原话：「按你的建议来决定。另外你要考虑到谁是用户，如何让用户的体验可以达到 9 分，容易使用，获得价值。」
据此加了 `requirements/06-user-experience.md`（画像、价值时刻、E1–E10 九分标准、用词表），并对本束做了 U-1…U-6 六项修订，新增 uc-18-6 与 F15–F17。

## 〇·一、这次签核请特别看的：体验修订 U-1…U-6

| # | 修订 | 为什么（对应价值时刻 / 体验维度） |
|---|---|---|
| U-1 | 回答下方单行「已记下 N 条 · 查看 · 撤销」 | 价值出现在对话里（M1、E1） |
| U-2 | 每条「对 / 不对」一键 + 「全部确认」 | 改错 ≤ 2 次点击（M4、E5） |
| U-3 | 「记到我的长期记忆」对 AI 记下的条目也能用（点了就算确认） | 不让确认成为获益的前置（E1）；仍由人点击 |
| U-4 | 对话里说「记住 / 忘掉」，Agent 只出确认卡，人点一下 | 最低学习成本（M4、E5）；I-17 保证 Agent 不执行 |
| U-5 | 前后矛盾时当轮出提醒卡，可忽略且不再重复 | M3、E7、E8 |
| U-6 | 面板常驻「仅你可见 / 会话成员可见」 | M5、E9 |

**阶段退出门**：F15 体验评测集最新一轮总分 ≥ 9.0（06 R4）。

## 一、材料清单

- ① UI：`ui.md`（21 张截图，`/preview/chat-knowledge-graph`）
- ② 用例：`usecases.md`（UC-KG-1…7、11、12 对外；UC-KG-8…10 内部）
- ③ API 契约：`packages/contracts/src/chat-knowledge-graph.ts`（7 个操作、14 个错误码）
- 支撑 · 领域模型：`domain.md`（不变量 I-1…I-19，以及三态投影）
- 支撑 · 覆盖证明：`coverage.md`（六个 UC 共 24 条 R12 验收判据全部映射；反向逐操作列出）
- 体验标准：`requirements/06-user-experience.md`
- 两个 delta：`../context-pack-delta/`、`../personal-recall-delta/`

## 二、签核时请重点核对

1. **① UI**
   - 入口是会话右侧栏「知识」tab，默认列表视图；
   - 三态配色，以及 Badge 新增的 `success` tone；
   - 图视图只读。
   见 `ui.md` 第四节。
2. **② 失败模式**：
   - `KG_ACTOR_NOT_HUMAN` 与 `KG_NOT_OWNER` 分成两个码。前者是 Agent 身份，后者是可见但不是所有者。
   - 晋升是逐条结果，不整批失败；「全部确认」遇到冲突态则整批拒绝，不做部分确认。
   请确认这两处取舍。
3. **③ API 契约**：`getPersonalKnowledge` 没有 R12 判据直接要求它（`coverage.md` 第二节），请判断保留还是删掉。
4. **不变量**：
   - I-3「模型不直写」要靠数据库角色权限落实：应用连接对本体表没有写权限，只有执行器有。请确认接受这个实现约束。
   - I-11「canonical 为准」是删除不泄漏的关键。
5. **范围**：本阶段只开放 `chat_session` 和 `personal` 两种作用域（I-1）。`KgScopeKind` 的五个成员现在就定义好，外扩时不用改表。

## 三、签核记录

（人类签核后填写 frontmatter 的 `status: confirmed`、`confirmed_by`、`confirmed_at`；agent 不许改。）
