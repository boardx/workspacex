# 契约束 `curated-capability-packs` — 签核① UI（复用既有屏）

> **UI material reuse: no new screen; reuse_bundle: `skills`.**

本文件引用 67 张截图，目录下实际 67 张。

本束**不新增界面、路由、组件或截图**。它完全复用已存在的 Skills 管理面：

- 路由：`/admin/skill`
- 组件：`apps/web/components/admin/capability-catalog-screen.tsx`
- 显式导入组件：`apps/web/components/admin/skill-starter-import-panel.tsx`
- 既有签核材料：[`../skills/ui.md`](../skills/ui.md)
- 既有截图索引目录：`phases/phase-01-run-a-project/ui-preview/skill-v2/`

复用关系的唯一机器可读声明位于 `.harness/scripts/ui-material-map.json`：
`curated-capability-packs` 以 `reuse_bundle: skills` 指向既有材料（issue #432）。

## 复用的精确截图集（67 张，lint-ui-material 双向门禁盯守）

> 本清单曾被刻意省略（担心与 `skills/ui.md` 形成第二份索引并漂移），但门控 `//1b` 的
> 立法要求复用束完整引用精确集合——**且漂移担忧已被门控本身化解**：双向检查下，
> 目标目录多一张、这里少引一张，当场红。「第二份副本 + 机械门控」正是 AGENTS.md
> 允许的形态（2026-08-11 coord-main 夜间裁决，留档待人类复核）。

- `uc-3-1-library-contract-viewer.png`
- `uc-3-1-library-default.png`
- `uc-3-1-library-denied.png`
- `uc-3-1-library-dep-failed.png`
- `uc-3-1-library-editor.png`
- `uc-3-1-library-empty.png`
- `uc-3-1-library-facilitator.png`
- `uc-3-1-library-invalid.png`
- `uc-3-1-library-loading.png`
- `uc-3-1-library-member-denied.png`
- `uc-3-1-library-success.png`
- `uc-3-1-library-tryrun-fail.png`
- `uc-3-1-tryrun-default.png`
- `uc-3-1-tryrun-denied.png`
- `uc-3-1-tryrun-dep-failed.png`
- `uc-3-1-tryrun-empty.png`
- `uc-3-1-tryrun-invalid.png`
- `uc-3-1-tryrun-loading.png`
- `uc-3-1-tryrun-role-denied.png`
- `uc-3-1-tryrun-success.png`
- `uc-3-2-binding-default.png`
- `uc-3-2-binding-denied.png`
- `uc-3-2-binding-dep-failed.png`
- `uc-3-2-binding-empty.png`
- `uc-3-2-binding-invalid.png`
- `uc-3-2-binding-loading.png`
- `uc-3-2-binding-member.png`
- `uc-3-2-binding-observer.png`
- `uc-3-2-binding-orphan-dialog.png`
- `uc-3-2-binding-rebind.png`
- `uc-3-2-binding-saveas-dialog.png`
- `uc-3-2-binding-success.png`
- `uc-3-3-temp-default.png`
- `uc-3-3-temp-denied.png`
- `uc-3-3-temp-dep-failed.png`
- `uc-3-3-temp-empty.png`
- `uc-3-3-temp-invalid.png`
- `uc-3-3-temp-loading.png`
- `uc-3-3-temp-member.png`
- `uc-3-3-temp-picker.png`
- `uc-3-3-temp-success.png`
- `uc-3-4-versioning-default.png`
- `uc-3-4-versioning-denied.png`
- `uc-3-4-versioning-dep-failed.png`
- `uc-3-4-versioning-disable-dialog.png`
- `uc-3-4-versioning-empty.png`
- `uc-3-4-versioning-harddelete-dialog.png`
- `uc-3-4-versioning-invalid.png`
- `uc-3-4-versioning-loading.png`
- `uc-3-4-versioning-reviewer.png`
- `uc-3-4-versioning-success.png`
- `uc-3-5-promotion-approve-dialog.png`
- `uc-3-5-promotion-default.png`
- `uc-3-5-promotion-denied.png`
- `uc-3-5-promotion-dep-failed.png`
- `uc-3-5-promotion-empty.png`
- `uc-3-5-promotion-invalid.png`
- `uc-3-5-promotion-loading.png`
- `uc-3-5-promotion-success.png`
- `uc-3-6-feedback-default.png`
- `uc-3-6-feedback-denied.png`
- `uc-3-6-feedback-dep-failed.png`
- `uc-3-6-feedback-diff.png`
- `uc-3-6-feedback-empty.png`
- `uc-3-6-feedback-invalid.png`
- `uc-3-6-feedback-loading.png`
- `uc-3-6-feedback-success.png`


## 人类本轮要确认的 UI 边界

- pack 不出现在推荐列表，也不被预选；管理员手工输入 `garden-advisors` / `1.0.0`。
- 仍使用 `skill-starter-import` → `skill-starter-import-confirm` → `skill-starter-import-result`。
- 成功回执沿用“导入完成：新增 4 个 Skill”，随后刷新 `admin-skill-list`。
- 非管理员看不到导入按钮；服务端权限拒绝另由用例契约保证。
- 不新增“来源=Garden/社区”的可见 badge。若产品需要该 badge，属于 API/source enum 扩展，需另行签核。

## 稳定 testid（全部既有）

| testid | 用途 |
|---|---|
| `skill-starter-import` | 展开显式导入面 |
| `skill-starter-import-confirm` | 确认导入固定坐标 |
| `skill-starter-import-result` | 成功/失败回执 |
| `admin-skill-empty` | 导入前真实空态 |
| `admin-skill-list` | 导入后组织目录 |
