---
status: pending
bundle: inbox-unified
scope: unified-ops-inbox
covers: [B3.1, B3.2, B3.3, B3.4, B3.5, B3.6, B3.7, B3.8]
---

# 统一收件箱 —— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`
§B3 · 需求 R4.3（`uc-17-8-研发闭环-反馈到设计到排期.md`）· `packages/contracts/src/inbox.ts`。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 本文件是补签，不是先签后做——如实写在这里

`inbox-unified` 这个契约束此前**没有** `contracts/inbox-unified/` 目录：B3.1–B3.5（契约、
聚合、系统异常状态事件、web 切真栈、GitHub 徽标）已经全部实现并合入 `main`（PR #2660 及
之后的 sprint 记录，见 backlog §0.2/§0.3），B3.7 / B3.8 有并行会话在推进。本文件是 backlog
B6.2「为三个新束补映射」要求的产物才第一次建出来——与 `design-workbench` 束
`design-signoff.md` 记录过的情形相同（人类先直接要求把功能做出来，agent 事后补齐材料 +
签核文件）。

**后果**：代码已经在 `main` 上跑，但按 ADR-023，本束下的条目在 `status` 被人类改成
`confirmed` 之前不应被标 `passing`。

**本文件的五件材料没有新造任何决策**：全部整理自 `packages/contracts/src/inbox.ts` 文件头
（D2 裁决、stage 映射单源、状态迁移不新建接口、非超管 withheld、severe 只看次数）、
`application/inbox/list-inbox.ts` 文件头（应用层聚合 + keyset 分页的取舍）与 backlog §0.2。
凡契约头注写了「待确认」或「本轮刻意没有」的，下面原样摆到台面上。

---

## ① UI

见 [ui.md](./ui.md)：11 张截图，全部由 `apps/web/scripts/shot-feedback-design-loop.mjs`
渲染**生产同一份组件**（`components/design-loop/inbox-screen.tsx`）拍摄，数据由
`page.route()` 拦截 `/inbox*` 与反馈/系统异常路由提供。截图目录 `ui-preview/feedback-design-loop/`
与 `feedback-drafts` 束共用（同一份脚本产出，`ui-material-map.json` 用 `shared_dir` 登记）。

⚠ 请人类核对的 UI 决定（`ui-preview/feedback-design-loop/README.md` 「我替 UC 做了哪些它
没写明的设计决定」第 1、2、7 条）：四态状态色分档；类型 chip 合并成 4 项（缺陷/需求并成
「反馈」）；列表「数量/时间」列的口径。

## ② 用例

见 [usecases.md](./usecases.md)：六条用例、验收线索 V1–V10。它们**不是**从 R4.3 逐字抄的——
R4.3 写的是原型（GitHub 随机编号、`severe` 由标签派生），契约落地时按现状改过口径，每一处
偏离在 `domain.md` §7 单列。

## ③ API 契约

`packages/contracts/src/inbox.ts`：两条只读操作 `listInbox`（`GET /inbox`）/ `getInboxCounts`
（`GET /inbox/counts`）。**本束刻意没有写操作**——状态迁移、投票、GitHub、时间线全部复用
`feedback-loop.ts` / `system-error-logs.ts` 已签核的操作（契约文件头「状态迁移不新建接口」）。
`lint-third-artifact` 形态 A，映射 `third-artifact-map.json`：`inbox-unified → inbox`。

---

## 签核前请人类确认的三件（契约/backlog 里已标「待确认」或「取舍」，不是新提案）

1. **D2 = 替换**已裁（2026-09-04），但 B3.6（旧 `/platform-admin/feedback` 退役 + 301 +
   `feedback-loop` 束重签）**尚未做**，两屏目前并存——同一状态机两处投影。签本束是否以
   B3.6 完成为前提？
2. **`severe` 口径**：需求原文「次数阈值**或** level=error」；`error_logs` 没有 `level` 列，
   契约只取次数（`INBOX_EXCEPTION_SEVERE_COUNT_THRESHOLD = 10`），反馈恒 `false`（反馈今天
   没有标签）。是否接受。
3. **分页取舍**：两源不能一条 SQL JOIN（`app_diag_ro` vs `app_rw`+RLS），应用层归并 +
   `INBOX_EXCEPTION_FETCH_CAP = 2000` 上限；撞上限的异常**不在**收件箱里且界面无提示——
   B6.4 起每次聚合记结构化日志（`exceptionCapHit`），值班可见，用户不可见。是否接受
   「日志可见即可」，还是要求界面提示。
