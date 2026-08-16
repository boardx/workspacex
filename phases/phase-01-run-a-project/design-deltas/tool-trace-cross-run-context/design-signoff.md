---
status: confirmed
bundle: tool-trace-cross-run-context
base_bundle: chat-context-engine
scope: tool-call-trace-fed-back-as-fourth-context-source-across-runs

covers: [F190]  # 原 F185（PR #1321 注册）；被 project 域另一支并行分支（PR #1405）
  # 独立占用同一 ID 并先合并覆盖，重编号为 F190，不改动 status/confirmed_by/confirmed_at
  # 三字段（ADR-023，本次只是 ID 层面的机械修正，不是重新裁决）——见 F190 feature_list.json
  # notes 完整说明。
confirmed_by: yanbin shen
confirmed_at: 2026-08-16T00:00:00+08:00
confirmed_via: >-
  人类在 chat 会话里对 AskUserQuestion 收窄的三组选项逐一作答：
  ① 范围窗口 = 「最近 N 轮 run（如 3 轮）」；
  ② 预算优先级 = 「排在 L2 之后、L3 之前（推荐）」；
  ③ 其余三点（个人线程适用性 / 可审计快照复用 F157 / 失败降级不阻断 run）=
  「采纳全部默认方案（推荐）」。由 chat-dev-context-engine 按 human-decision-packaging.md
  规则二整理进本文件 + `contract.md`，打包成本签核 PR 供人类 review 确认落地。
---

# design delta 签核 · 工具调用轨迹跨 run 回喂上下文

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

已签的 `chat-context-engine` 束把上下文来源定为 L1（近端原文）+ L2（持久摘要）+ L3（文件
检索）三层。本 delta 追加**第四类**来源——本线程近期轮次的工具调用轨迹——这是已签束字面参数

之外的新增，且实现会碰 `execute-run.ts`（F154 notes 明确写着"动这个文件需取 coord-main
串行窗口"），按 ADR-023 的路径需要 design-delta 追加签核，不能援引既有签核直接开工。

## 签核前请重点确认（逐条在 `contract.md` §1 展开）

- [ ] **① 范围窗口**：最近 3 轮 run 的 tool_call（可后续 ±1 微调，超出此范围需重签）。
- [ ] **② 预算优先级**：`L1 > L2 > 工具轨迹 > L3`；且与 L1 有重叠的轮次（仍在 L1 窗口内）
      跳过工具轨迹，避免重复注入。
- [ ] **③ 个人线程一视同仁适用**：本线程范围内的工具轨迹回喂不算跨范围检索，与 F156 delta
      的 `cross_scope_retrieval_requests == 0` 硬边界不冲突。
- [ ] **④ 可审计**：复用 F157 `agent_run_context` 快照结构追加来源字段，不新建第二套记录。
- [ ] **⑤ 失败降级**：读取失败跳过这一类来源、不阻断 run，同 L2 既有策略。

## 与既有束的关系

- **不修改** `contracts/chat-context-engine/` 下任何已签文件的 `status`；本 delta 是在其外
  追加第四类来源，规范以本目录 `contract.md` 为准。
- `ModelCallInput`/`ModelCallPort` 契约不动（同 L1/L2/L3 的既有边界，coord-main 裁决 A 条件
  延续）。
- 签核后 requirement-author 把对应 feature 的 `verification`/`spec_ref` 按本 delta 口径落
  `feature_list.json`，并把新编号补回本文件 `covers:`；实现前须先协调 `execute-run.ts`
  的 coord-main 串行窗口。

