# 契约束 `curated-capability-packs` — 签核① UI（复用既有屏）

本束**不新增界面、路由、组件或截图**。它完全复用已存在的 Skills 管理面：

- 路由：`/admin/skill`
- 组件：`apps/web/components/admin/capability-catalog-screen.tsx`
- 显式导入组件：`apps/web/components/admin/skill-starter-import-panel.tsx`
- 既有签核材料：[`../skills/ui.md`](../skills/ui.md)
- 既有截图索引目录：`phases/phase-01-run-a-project/ui-preview/skill-v2/`

复用关系的唯一机器可读声明位于 `.harness/scripts/ui-material-map.json`：
`curated-capability-packs` 通过 control-plane issue #432 的 `reuse_bundle: skills` 指向既有材料。
本文件不复制 67 张截图文件名，也不复制图片；否则同一 UI 事实会产生第二份索引并漂移。

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
