# `stage-aggregation` — UI 材料索引

材料位置：`phases/phase-10-live-collaboration-orchestration/ui-preview/`（真实组件 + mock，
`apps/web/components/live-collab/orchestration-preview.tsx`，预览路由 `/preview/live-collab-orchestration`）。

| 截图 | 展示什么 | 视角/态 |
|---|---|---|
| `stage-kanban-default.png` | 4 组实时卡片网格 + 广播提示按钮 | 引导师 · 默认 |
| `stage-kanban-dep-failed.png` | 依赖失败态（"phase-02 未签，看板停骨架"） | 引导师 · 依赖失败 |
| `stage-kanban-success.png` | 广播已发出的成功反馈 | 引导师 · 成功 |
| `stage-graph-default.png` | 决策树 + 待决岔口 + 推演预测卡 + 下一步可开展的工作 | 引导师 · 默认 |
| `group-graph-default.png` | 分组·本组图谱（与 F10 全场聚合视图对比参照，非本束覆盖范围） | 组员/组长 |

## 缺口（老实核对后的结论）

- **G-1（真实缺口）**：F10（知识图谱决策推演）没有对应的"依赖失败"态截图——`stage-kanban-dep-failed.png`
  只交付了看板视图的诚实空态，`stage-graph-default.png` 展示的是默认态（看起来像已经有数据），
  没有一张图展示"phase-02 知识图谱束未签，此视图停骨架"的等价状态。这是硬阻断在 UI 材料上
  暴露出的一个真实不对称，design-signoff.md 正文已列为签核前确认项，这里如实记录不是编造。
- 未发现看板视图的展示缺口：默认/依赖失败/成功三态都有对应截图，覆盖了 F09 的主要交互路径。

## 视角/态矩阵（供签核时逐格核对）

| 角色 | 能否看到看板聚合视图 | 能否看到知识图谱决策推演聚合视图 | 能否操作广播/开展 |
|---|---|---|---|
| 引导师 | 可见（主持台·全场 → 看板） | 可见（主持台·全场 → 知识图谱·决策推演） | 可操作 |
| 组长 | 不可见（该视图属于全场子视图，viewer-role 束已限定组长视角锁定本组） | 不可见 | 不适用 |
| 组员 | 不可见 | 不可见 | 不适用 |
| 观察者 | 待定：观察者"全场只读聚合"（Q1）是否包含看板/知识图谱这两个子视图——`viewer-role` 束的 Q1 裁决只笼统提到"4 组看板/知识图谱/签到的聚合视图"，未逐个子视图列出细节，两束共享同一个未决问题 | 同左 | 不可操作（只读） |
