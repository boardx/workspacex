---
phase: "03"
status: pending          # pending | confirmed —— 人类工程师确认 UI 后，把这里改成 confirmed
confirmed_by:            # 确认人（姓名/邮箱）
confirmed_at:            # 确认时间（ISO，如 2026-07-01T10:00:00Z）
---

> # ⛔ 本文件已停用（2026-07-30，ADR-023 决策一）
>
> **UI 签核已并入束级 `contracts/<束>/design-signoff.md` 的第 ① 件**（材料写在同目录 `ui.md`，
> 引用 `ui-preview/` 截图）。人类的签核动作从两次变一次。
>
> **本文件保留仅为留痕。改它的 `status` 不再有任何效果**——全仓已没有任何脚本读取它，
> `.harness/scripts/lib/design-signoff.test.ts` 里有一条测试机械地钉住这一点
> （「harness 脚本里不存在任何读取 ui-signoff.md 的代码」）。把这里改成 `confirmed`
> **不会**让 `new-sprint` / `claim` / `doctor` 放行任何 feature。
>
> 本阶段现在怎么开工 → `.harness/instructions/contract-design.md`；
> 为什么这么改 → `docs/adr/ADR-023-unified-signoff.md` 决策一；
> 原关卡的**理由**仍然有效 → `docs/adr/ADR-003-ui-first-signoff-gate.md`。
>
> ⚠ frontmatter 的 `status` / `confirmed_by` / `confirmed_at` 一律**原值保留**，未被任何 agent 改动。

# UI 先行确认 — 跨项目复用与治理（Phase 03）

> 这是本阶段的 **UI 签核关卡**（ADR-003）。UI 相关阶段必须先把真实界面做出来、
> 由**人类工程师确认**，才能生成/定稿 `feature_list.json` 并开 sprint 进入代码开发。
> ~~门控由 `new-sprint` 强制：本文件顶部 `status` 不是 `confirmed` 时，`pnpm harness new-sprint` 直接拒绝。~~
> **（已失效，2026-07-30）** 见文件顶部停用说明。

## 交付形态（本阶段约定）
- **真实组件**：直接写在 `apps/web` 里，用 **mock 数据**、**不接后端**。人类确认后，feature 开发 = 把这些 UI 接上真逻辑，**UI 不丢弃、可复用**。
- 视觉/交互严格遵循 [uiux-standards.md](../../.harness/instructions/uiux-standards.md)。

## UI 范围清单（逐屏/逐组件勾选，覆盖 requirements/ 里的用户故事）
<!-- ui-prototyper 填写：每一项 = 一块可见界面，附组件路径与截图。人类逐项核对。 -->
- [ ] （示例）Board Header 框架 — `apps/web/components/board/board-header.tsx` — 截图：`ui-preview/board-header.png`
- [ ] …

## 组件落点（apps/web 下真实路径）
<!-- 列出本阶段新增/改动的组件文件，供 requirement-author 把 user_visible_behavior 锚定到真实元素（data-testid）。 -->
-

## 截图证据
<!-- 截图存放在同目录 ui-preview/ 下，这里贴相对链接。 -->
-

## 人类确认意见
<!-- 确认人填写：通过 / 需修改（列出修改点）。改完再确认。 -->
-

---
**确认动作**：核对无误后，把顶部 frontmatter 的 `status` 改为 `confirmed`，填 `confirmed_by` / `confirmed_at`，提交。之后才可调 requirement-author 生成 feature_list、跑 new-sprint。
