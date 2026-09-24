# 契约束 `chat-knowledge-graph` — ① UI（签核面第 ① 件）

> **自检**：本文件引用 31 张截图，目录下实际 31 张。（2026-09-24 ui-prototyper 交付，签核用静态原型；同日按 `requirements/06-user-experience.md` 的 U-1…U-6 改版：界面文案改成大白话，并新增 11 屏）

判据单一事实源：`requirements/uc-18-1` … `uc-18-5` 的 R3 / R4 / R5 / R8 / R12（本文件只引用条目号，不重抄正文）。
截图目录与逐张说明：`../../ui-preview/chat-knowledge-graph/README.md`。

## 一、落点

本束**不新建产品路由**。落地后全部挂在 `/chat` 会话内：
- 右侧栏新增「知识」tab（列表 / 图两视图）；
- 回答气泡底部加引用与「为什么召回」。

签核阶段承载于 `/preview/chat-knowledge-graph?scene=<场景>&role=owner|member`。视角切换只是预览手段，不代表权限实现；真实权限在服务端（uc-18-3 R5）。

组件（实现阶段复用，不重写）：`apps/web/components/chat/knowledge/*`。mock：`apps/web/lib/mock/knowledge-graph.ts`，类型全部 `z.infer` 自契约。

## 二、屏与截图

| 屏 | 截图 | 对应需求 |
|---|---|---|
| 回答下方「已记下 N 条 · 查看 · 撤销」 | `uc-18-1-turn-captured.png` | 06 U-1、uc-18-1 R8 |
| 已记下·展开查看 | `uc-18-1-turn-captured-expanded.png` | 06 U-1 |
| 正在记… | `uc-18-1-turn-pending.png` | 06 U-1 |
| 回答·引用 + 为什么用到它（含关联路径） | `uc-18-2-answer-citations-why-recall.png` | uc-18-2 R3-5、R8；D-KG-2 |
| 回答·关联查询不可用 | `uc-18-2-answer-graph-unavailable.png` | uc-18-2 E1；D-KG-1 |
| 回答·相似查询不可用 | `uc-18-2-answer-vector-unavailable.png` | uc-18-2 E2；D-KG-1 |
| 来源抽屉·正常 | `uc-18-2-source-drawer-normal.png` | uc-18-3 R3-2 |
| 删除二次确认 + 影响范围 | `uc-18-3-delete-confirm.png` | uc-18-3 R7-2 |
| 所有者编辑菜单 | `uc-18-3-edit-menu-owner.png` | uc-18-3 R3-3/4 |
| 关系图·错误 | `uc-18-3-graph-error.png` | 七态 |
| 关系图·加载 | `uc-18-3-graph-loading.png` | 七态 |
| 关系图·正常 | `uc-18-3-graph-normal.png` | uc-18-3 R3-1 |
| 关系图·超限折叠 | `uc-18-3-graph-oversize.png` | uc-18-3 E4 |
| 记忆列表·空 | `uc-18-3-list-empty.png` | uc-18-3 A1 |
| 记忆列表·错误 | `uc-18-3-list-error.png` | 七态 |
| 记忆列表·加载 | `uc-18-3-list-loading.png` | 七态 |
| 记忆列表·正常（含「仅你可见」） | `uc-18-3-list-normal.png` | uc-18-3 R3-1；06 U-6 |
| 记忆列表·有 N 条没记上 | `uc-18-3-list-partial-failure.png` | uc-18-1 E1 |
| 记忆列表·只读（「会话成员可见」，无编辑入口） | `uc-18-3-list-readonly.png` | uc-18-3 R5、E2；06 U-6 |
| 一键对 / 不对 + 全部确认 | `uc-18-3-onetap-yesno.png` | 06 U-2 |
| 点「不对」展开改写 / 忘掉这条 | `uc-18-3-onetap-wrong-open.png` | 06 U-2 |
| 回答·来自你 9/20 的对话 | `uc-18-4-answer-from-personal.png` | uc-18-4 R3-6 |
| AI 提名「值得记住」 | `uc-18-4-nomination-card.png` | uc-18-4 A1 |
| 记到我的长期记忆·逐条结果 | `uc-18-4-promote-results.png` | uc-18-4 R3-5；06 U-3 |
| 来源抽屉·来源已删除 | `uc-18-5-source-drawer-revoked.png` | uc-18-5 R8 |
| 矛盾提醒卡 | `uc-18-6-conflict-card.png` | uc-18-6 D；06 U-5 |
| 矛盾·两条都留（填适用条件） | `uc-18-6-conflict-keep-both.png` | uc-18-6 D |
| 忘掉卡（默认全选） | `uc-18-6-forget-card.png` | uc-18-6 B；06 U-4 |
| 「你记得关于 X 的什么」回答 | `uc-18-6-recall-answer.png` | uc-18-6 C |
| 记住卡·已记住 · 撤销 | `uc-18-6-remember-card-done.png` | uc-18-6 A |
| 记住卡（可改字） | `uc-18-6-remember-card.png` | uc-18-6 A；06 U-4 |

## 三、稳定 `data-testid`（前缀 `kg-`）

| 区域 | data-testid |
|---|---|
| 面板 | `kg-panel`、`kg-panel-title`、`kg-view-list`、`kg-view-graph`、`kg-tri-counts`、`kg-readonly-badge` |
| 入图状态 | `kg-ingestion-status`、`kg-ingestion-idle`、`kg-ingestion-running`、`kg-ingestion-failed`、`kg-ingestion-retry` |
| 列表 | `kg-list`、`kg-group-<kind>`、`kg-claim-<id>`、`kg-claim-open-<id>`、`kg-tri-state-<pending\|confirmed\|conflict>` |
| 空 / 错 | `empty`、`kg-empty-reindex`、`loading`、`err-panel`、`kg-error-retry` |
| 图 | `kg-graph-canvas`、`kg-graph-node-object-<id>`、`kg-graph-node-claim-<id>`、`kg-graph-edge-<id>`、`kg-graph-loading`、`kg-graph-oversize`、`kg-graph-force-expand` |
| 编辑 | `kg-claim-edit-trigger-<id>`、`kg-claim-edit-menu-<id>`、`kg-action-{confirm,revise,delete,contest,merge,split,rename}-<id>`、`kg-confirm-blocked-<id>`、`kg-delete-confirm-<id>`、`kg-delete-impact-<id>`、`kg-delete-confirm-btn-<id>`、`kg-delete-cancel-<id>` |
| 来源抽屉 | `kg-source-drawer`、`kg-source-statement`、`kg-source-evidence-list`、`kg-evidence-<segmentId>`、`kg-evidence-jump-<segmentId>`、`kg-evidence-revoked-<segmentId>`、`kg-source-provenance`、`kg-provenance-<i>`、`kg-source-drawer-close` |
| 回答 | `kg-answer-footer`、`kg-citation-chips`、`kg-citation-<id>`、`kg-why-recall-toggle`、`kg-why-recall-body`、`kg-recall-reason-<id>`、`kg-recall-channel-<id>-<channel>`、`kg-graph-path-<id>`、`kg-channel-unavailable`、`kg-channel-down-<channel>`、`kg-from-personal-<id>` |
| 记忆体验（U-1…U-6） | `kg-visibility`、`kg-turn-captured`、`kg-turn-captured-view`、`kg-turn-captured-undo`、`kg-turn-pending`、`kg-row-yes-<id>`、`kg-row-no-<id>`、`kg-row-revise-<id>`、`kg-row-forget-<id>`、`kg-confirm-all`、`kg-card-remember`、`kg-card-forget`、`kg-card-accept`、`kg-card-dismiss`、`kg-card-done`、`kg-card-stale`、`kg-conflict-card`、`kg-conflict-keep-new`、`kg-conflict-keep-both`、`kg-conflict-ignore` |
| 晋升 | `kg-promote-enter`、`kg-claim-select-<id>`、`kg-promote-submit`、`kg-promote-cancel`、`kg-promotion-results`、`kg-promo-<claimId>`、`kg-choice-merge-<claimId>`、`kg-choice-coexist-<claimId>`、`kg-promo-reject-reason-<claimId>` |
| 提名 | `kg-nomination-card`、`kg-nomination-<claimId>`、`kg-nomination-check-<claimId>`、`kg-nomination-promote` |

## 四、原型替需求补全的设计决定（请核对）

逐条原文见 README「我替 UC 做的设计决定」1–9，签核时最需要看的三条：

1. **入口 = 会话右侧栏「知识」tab**，默认列表视图，图为切换（R8 原文是「头部或侧栏」）。
2. **三态配色**：待确认 = warning，已确认 = success，冲突 = danger。为此给 `components/ui/badge.tsx` 新增了 `success` tone（token 已存在、已过对比度门）。
3. **图视图只读**，编辑全部走列表菜单。

## 五、已裁决的原缺口

- G-1「为什么用到它」的关联路径 → D-KG-2 = A：`ContextItem.graphPath`（见 `../context-pack-delta/`）。
- G-2「这次没能查全」的来源 → D-KG-1 = A：`RetrievalChannelPlan.available`（同上）。
- 原型阶段这两处用本地占位结构驱动；实现阶段（F08）改读上述两个字段。
