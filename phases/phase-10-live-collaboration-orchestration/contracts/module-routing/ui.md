# `module-routing` — UI 材料索引

材料位置：`phases/phase-10-live-collaboration-orchestration/ui-preview/module-routing/`（真实组件 + mock，
`apps/web/components/live-collab/orchestration-preview.tsx`，预览路由 `/preview/live-collab-orchestration`）。

本文件引用 **5** 张截图，目录下实际 **5** 张。

| 截图 | 展示什么 | 视角/态 |
|---|---|---|
| `group-chat-default.png` | 分组·与 AI 的对话（统一卡片列表形态） | 组员/组长 |
| `group-interview-default.png` | 分组·用户访谈（统一卡片列表形态） | 组员/组长 |
| `group-research-default.png` | 分组·深度研究（统一卡片列表形态） | 组员/组长 |
| `group-survey-default.png` | 分组·问卷（统一卡片列表形态） | 组员/组长 |
| `group-graph-default.png` | 分组·本组图谱（决策小树 + 已确认事实/待决，非统一卡片形态） | 组员/组长 |

## 缺口（老实核对后的结论）

- **G-1**：`group-graph-default.png` 与其余四张模块截图的布局形态明显不同（图谱用决策树/事实列表，
  其余四个用统一卡片列表）——这不是截图数量不足的缺口，是**需求本身的例外**（`03-module-routing.md#R1`
  的"统一卡片形态"描述是否本就不适用于图谱模块，requirements 原文未明确排除），已在
  design-signoff.md 正文里列为待确认项，不在这里重复标"缺图"，而是标"这张图展示的形态本身
  是否符合预期"需要人核实。
- **G-2**：没有一张截图展示"本场状态"右侧栏（F08）——五张分组截图目前都只截了中间主区域，
  右侧栏（环节倒计时/checklist/需要知道/已生成产出）没有单独的截图或者在这些截图里被裁掉了，
  需要核实这些截图的取景范围是否包含右侧栏；如果不包含，F08 的 UI 材料实际上是缺失的。
- **G-3**：五模块侧栏 tab 本身（`CH`/`IT`/`DR`/`SV`/`KG` 五个 tab 及其计数徽标）没有一张
  独立截图展示完整的侧栏导航态（含 hover/激活态区分），只能从各模块截图的边角推断侧栏存在。

## 视角/态矩阵（供签核时逐格核对）

| 角色 | 能否看到五模块侧栏 | 能否看到别组的模块卡片 |
|---|---|---|
| 引导师 | 可见（任意分组视角下） | 可见（可切到任意分组） |
| 组长 | 可见（本组） | 不可见 |
| 组员 | 可见（本组） | 不可见 |
| 观察者 | 待定：观察者能否进入某个具体分组查看五模块侧栏——同 `viewer-role` 束 Q1 未覆盖的缺口，两束共享同一个未决问题，不在本束重复裁决 |
