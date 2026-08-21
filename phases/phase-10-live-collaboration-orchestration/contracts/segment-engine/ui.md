# `segment-engine` — UI 材料索引

材料位置：`phases/phase-10-live-collaboration-orchestration/ui-preview/segment-engine/`（真实组件 + mock，
`apps/web/components/live-collab/orchestration-preview.tsx`，预览路由 `/preview/live-collab-orchestration`）。

本文件引用 **4** 张截图，目录下实际 **4** 张。

| 截图 | 展示什么 | 视角/态 |
|---|---|---|
| `stage-default-default.png` | 黑色状态条常驻在主持台默认视图（环节 N/M、环节名、倒计时 `＊`、`＋5分钟`/`下一环节`按钮） | 引导师 · 默认 |
| `role-member-group-chat.png` | 状态条在组员分组视角下的呈现（同一条状态条，不同角色壳） | 组员 |
| `role-observer-stage-default.png` | 状态条在观察者视角下的呈现（只读，无推进按钮） | 观察者 |
| `stage-default-loading.png` | 状态条骨架屏（加载态） | 引导师 · 加载 |

## 缺口（老实核对后的结论）

- **G-1**：没有一张截图专门展示"第X组需介入" pill 出现时的状态条——现有截图里这条告警
  处于默认隐藏/未触发态。因为判据本身全仓无来源（`scope_note` 已声明不在本轮签核范围），
  这个缺口暂不需要补图，但签核时请确认"看不到告警长什么样"是否可以接受先签这三件。
- 未发现其它真实缺口：状态条在三种视角（主持台/组员/观察者）下的呈现都各有一张图可核对，
  倒计时占位的 `＊` 标注在 `stage-default-default.png` 里清晰可见，不需要额外补图。

## 视角/态矩阵（供签核时逐格核对）

| 角色 | 状态条可见性 | 可操作按钮（`＋5分钟`/`下一环节`） |
|---|---|---|
| 引导师 | 可见（全场 + 任意分组视角下均常驻） | 可操作 |
| 组长 | 可见（本组视角下常驻） | 不可操作（F119 已限定只有引导师能推进） |
| 组员 | 可见（本组视角下常驻） | 不可操作 |
| 观察者 | 可见（只读） | 不可操作 |
