---
bundle: context-pack
phase: "00"
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `context-pack` 设计签核

覆盖 feature：**F09 F10 F11 F12 F13**（21 点）
依据 UC：`00-core/uc-0-2 Studio 打开时带上项目上下文`
架构：`docs/architecture/context-engine.md` 第四节（query-planned hybrid，**推翻 graph-first**）

## 四件产出物

| # | 文件 | 内容 |
|---|---|---|
| ① | `domain.md` | 7 个实体/值对象 + **12 条不变量**（其中 6 条跨束：I-6/I-7/I-8/I-9/I-10/I-11） |
| ② | `usecases.md` | 9 个用例 + **11 种失败模式穷举**（`ContextPackReason`）+ 6 个端口 |
| ③ | `packages/contracts/src/context-pack.ts` | 9 个操作的 zod 契约（唯一事实源）；`omissions[].reason` 从单源 import |
| ④ | `coverage.md` | 13 条 R12 逐条映射，**产出 9 个缺口** |

## 签核前请确认

- [ ] **不变量是真的不变量吗** —— 判据是「任何时刻都为真，违反即数据损坏」，且**能写成断言**。
      重点看 I-1（引用必可定位）、I-2（被丢弃不等于不存在）、I-5（同 runId 可重放，纯函数）。
- [ ] **失败模式穷举了吗** —— 11 种 `ContextPackReason`。界面七态的异常态全靠它。
      特别是 `EMPTY_CANDIDATE_SET` / `RETRIEVAL_UNAVAILABLE` **必须阻断 AI，不得「无上下文直接生成」**。
- [ ] **coverage 的两个方向都查了吗** —— UC→API（13 条 R12）与 API→UC（9 操作无孤儿）。
- [ ] **9 个缺口的处置认可吗** —— 尤其：
      - 缺口 2（**跨束**，与 identity 缺口 2 同一件：六条路径共用同一权限判定）
      - 缺口 3（pgvector recall 基线是门槛却无门槛值，需裁决）
      - 缺口 5（快照留存期，与 17-gov retention 统一裁决）
      - 缺口 6/7（跨阶段：本地模型可用性 / claims 数据源）
      - 缺口 9（既有手写 mock 是 pre-existing 第二份，需收敛）

## 关键裁决的落地确认

- [ ] **D-U4 丢弃原因七类封闭枚举** —— 契约 `OmissionReasonSchema` **从 `apps/web/lib/omission-reason.ts`
      import 七个键**构造，未另起一套；`lint-omission-reason` 通过。请确认「跨包引用单源」方向可接受，
      或裁决是否把单源迁进 `packages/contracts`（见 coverage 第四条）。
- [ ] **D-U1 含机密整轮本地，不分流** —— `resolvePackModelConstraint` 语义委托 `identity`，
      `localOnly` 一真则本轮全部走本地。请确认与 identity 束判定一致。
- [ ] **O-36 预算/阈值** —— 总预算随模型窗口推导、阈值按任务类型可配（0.45 默认）已落契约；
      **各路配额未定**（缺口 4），确认可后续固化不阻塞。

## 确认动作

人类核对后把上面 frontmatter 的 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`。
⚠ **这是人的动作，不是 agent 的**（同 ADR-003 的 `ui-signoff.md`）。
