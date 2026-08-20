# `viewer-role` — UI 材料索引

材料位置：`phases/phase-10-live-collaboration-orchestration/ui-preview/`（真实组件 + mock，
`apps/web/components/live-collab/orchestration-preview.tsx`，预览路由 `/preview/live-collab-orchestration`）。

| 截图 | 展示什么 | 视角/态 |
|---|---|---|
| `stage-default-default.png` | 引导师默认视图，提示条「你有全部权限」 | 引导师 · 默认 |
| `viewer-switcher-expanded.png` | 视角下拉展开：全场 + 4 分组，各带状态后缀 | 引导师 · 交互展开 |
| `role-member-group-chat.png` | 组员视角，视角切换器锁定本组 | 组员 |
| `role-observer-stage-default.png` | 观察者视角，全场只读默认 + 如实提示条 | 观察者 |
| `stage-default-denied.png` | 组员尝试看全场被拒 | 组员 · 无权限态 |

## 缺口（signoff 正文已提示，这里汇总）

- **G-1**：无「观察者被拒访问某组原始转写」的截图——Q1 裁决的边界（聚合可见、逐字稿不可见）目前只有文字依据。
- **G-2**：组长/观察者两个角色的提示条文案未各出一张图，目前只能核对代码里的文案字符串。

## 视角/态矩阵（供签核时逐格核对）

| 角色 | 全场视角 | 分组视角（本组） | 分组视角（别组） |
|---|---|---|---|
| 引导师 | 可读可控 | 可读可控 | 可读可控 |
| 组长 | 不可见（无此选项） | 可读可写（组内权限内） | 不可见 |
| 组员 | 不可见（无此选项） | 可读可写（组内权限内） | 不可见 |
| 观察者 | 只读聚合，不含逐字稿（Q1） | 待定：是否可选进具体分组只读，还是只能看全场聚合 —— **本条 Q1 裁决未覆盖，签核时请一并确认** |
