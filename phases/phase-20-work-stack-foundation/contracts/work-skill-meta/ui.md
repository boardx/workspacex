# 契约束 `work-skill-meta` — ① UI（签核面第 ① 件）

> **自检：本文件引用 8 张截图，目录下实际 8 张。** 截图目录：`ui-preview/skill-catalog/`。
> 截图目录与 `feature_list.json` WS05 的 `design_ref`（`ui-preview/skill-catalog/`）一致；束名与目录名不同，映射见 `.harness/scripts/ui-material-map.json`。

依据：`requirements/01-skill-catalog.md` R8；覆盖 feature 以 `design-signoff.md` `covers:` 为准。

## 一、界面落点

| 层级 | 路由 / 组件 | 目的 | 现状（已核实） |
|---|---|---|---|
| 入口 | `/skill?screen=work-catalog` | Work Skill 目录屏 | `apps/web/app/skill/page.tsx` 经 `resolveSkillScreen(searchParams.screen)` 选屏；默认屏 `library` 接真实后端（`components/skill/skill-catalog-live.tsx`）；本屏为新增 |
| 左栏 | 领域筛选 + 通道切换（candidate / verified）+ “显示已废弃”勾选 | 过滤 | 新增 |
| 顶栏 | 搜索框 | `q` 关键词 | 新增 |
| 列表 | 行：名称、stableId、domain 标签、通道徽章、riskClass、就绪性徽章 | 浏览 | 新增 |
| 详情抽屉 | 依赖分组（必需/可选，逐项状态+原因）、溯源表、地区/法域、评测套件与门状态占位、版本列表、后继链接、管理员操作 | 查看/管理 | 新增 |

## 二、稳定 `data-testid`（WS05 实现必须提供）

| 区域 | testid |
|---|---|
| 屏根 | `work-catalog-screen` |
| 领域筛选 / 通道切换 / 显示已废弃 | `work-catalog-domain-filter`、`work-catalog-channel-<channel>`、`work-catalog-include-deprecated` |
| 搜索 | `work-catalog-search` |
| 行 | `work-catalog-row-<stableId>`；徽章 `work-catalog-channel-badge`、`work-catalog-readiness-badge` |
| 详情抽屉 | `work-skill-detail`；`work-skill-deps-required`、`work-skill-deps-optional`、`work-skill-provenance`、`work-skill-gates`、`work-skill-versions`、`work-skill-successor` |
| 管理员操作 | `work-skill-change-channel`、`work-skill-set-successor`（非管理员**不渲染**，E9） |

## 三、状态

| 状态 | testid | 可见行为 |
|---|---|---|
| loading | `work-catalog-state-loading` | 列表骨架 |
| empty（E7） | `work-catalog-state-empty` | 空态文案 + `work-catalog-clear-filters` |
| readiness unknown（E5） | `work-catalog-readiness-unknown` | 仅该行/抽屉局部提示，其余字段照常 |
| error | `work-catalog-state-error` | 列表接口失败，可重试 |
| denied | — | 401/404 走统一出口，不泄露存在性 |

就绪性徽章文案：`ready` → “可运行”；`not_ready` → “缺 N 项”；`unknown` → “未知”（绝不显示为 ready）。
optional 缺失在抽屉中显示“可选，未授权，功能降级”（A4）。

## 四、截图索引

| # | 截图 | 人类核对重点 |
|---:|---|---|
| 1 | `../../ui-preview/skill-catalog/work-catalog-screen.png` | 列表信息层级、徽章三态、左栏筛选、详情抽屉分组 |

签核缺口：空态 / unknown / 非管理员视图目前只有文字描述，未有独立截图——签核人可要求补图或接受作为 design delta。

## 附：七态截图（ui-prototyper 产出，`/preview/work-stack` 原型屏）

| 截图 | 状态 |
|---|---|
| `ui-preview/skill-catalog/WS05-skill-catalog-default.png` | default |
| `ui-preview/skill-catalog/WS05-skill-catalog-denied.png` | denied |
| `ui-preview/skill-catalog/WS05-skill-catalog-depfail.png` | depfail |
| `ui-preview/skill-catalog/WS05-skill-catalog-empty.png` | empty |
| `ui-preview/skill-catalog/WS05-skill-catalog-invalid.png` | invalid |
| `ui-preview/skill-catalog/WS05-skill-catalog-loading.png` | loading |
| `ui-preview/skill-catalog/WS05-skill-catalog-success.png` | success |
