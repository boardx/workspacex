# 契约束 `work-eval` — ① UI（签核面第 ① 件）

> **自检：本文件引用 8 张截图，目录下实际 8 张。** 截图目录：`ui-preview/work-eval/`。

依据：`requirements/04-eval-gates.md` R8；目录屏与抽屉骨架属契约束 `work-skill-meta`（`ui.md` 已预留
`work-skill-gates` 区），本束只填实门状态区与列表缩略，不改其余布局。

## 一、界面落点

| 层级 | 路由 / 组件 | 目的 | 现状 |
|---|---|---|---|
| 抽屉区块 | `/skill?screen=work-catalog` 详情抽屉 → `work-skill-gates` | G0–G5 徽章、版本、subject vs baseline | work-skill-meta 占位（WS05，未实现） |
| 列表行 | 目录行尾 | 门状态缩略「G4✓ G5✗」 | 新增 |
| 管理操作 | 抽屉 → 「标为 verified」 | 平台运营执行 `candidate→verified` | 新增；复用 `PATCH /admin/skills/catalog/:skillId` |

数据来源：`getWorkGateStatus`（`WorkGateView`）；列表缩略 `WorkGateSummary`。

## 二、稳定 `data-testid`（EV04 实现必须提供）

| 区域 | testid |
|---|---|
| 门状态区根 | `work-skill-gates` |
| 单门徽章 | `work-gate-badge-<G0..G5>`，属性 `data-state=pass|fail|not_applicable|not_evaluated` |
| 徽章悬停详情 | `work-gate-reason-<gate>`（原因 + 判定时间） |
| 版本 / 套件 | `work-gate-version`（semantic_label）、`work-gate-suite-id` |
| 通过数 | `work-gate-score`（如 `9/10 vs 6/10`） |
| 过期提示 | `work-gate-stale` |
| 列表缩略 | `work-catalog-gate-summary` |
| 标为 verified | `work-gate-mark-verified`（非平台运营**不渲染**；G5 未过 `disabled` + `work-gate-mark-verified-reason`） |

## 三、状态

| 状态 | testid | 可见行为 |
|---|---|---|
| 未评测（A4） | `work-gate-state-not-evaluated` | 六枚灰徽章「未评测」，通过数显示「—」 |
| 报告过期（E4） | `work-gate-stale` | 黄色提示「当前版本尚未重新评测」 |
| 加载失败 | `work-gate-state-error` | 仅区块内提示可重试，不影响抽屉其余字段、不整页报错 |
| denied | — | 401/404 走统一出口 |

徽章文案：pass「通过」、fail「未通过」、not_applicable「不适用」、not_evaluated「未评测」。
**绝不**把 not_evaluated 渲染成通过；成员视图不出现夹具原文、grader 源码或报告路径链接。

## 四、截图索引

| # | 截图 | 人类核对重点 |
|---:|---|---|
| 1 | `../../ui-preview/work-eval/gate-status-panel.png` | 六门徽章四态、通过数对比、过期提示、verified 按钮灰显 |

签核缺口：未评测空态、非平台运营视图、列表缩略目前只有文字描述，签核人可要求补图或接受为 design delta。

## 附：七态截图（ui-prototyper 产出，`/preview/work-stack` 原型屏）

| 截图 | 状态 |
|---|---|
| `ui-preview/work-eval/EV04-gate-status-default.png` | default |
| `ui-preview/work-eval/EV04-gate-status-denied.png` | denied |
| `ui-preview/work-eval/EV04-gate-status-depfail.png` | depfail |
| `ui-preview/work-eval/EV04-gate-status-empty.png` | empty |
| `ui-preview/work-eval/EV04-gate-status-invalid.png` | invalid |
| `ui-preview/work-eval/EV04-gate-status-loading.png` | loading |
| `ui-preview/work-eval/EV04-gate-status-success.png` | success |
