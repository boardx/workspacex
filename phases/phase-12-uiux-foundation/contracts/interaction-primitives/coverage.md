# 契约束 `interaction-primitives` — 支撑材料：UC 覆盖证明

> 本束无后端 API，「API 操作」列统一记为 `N/A（前端纯组件）`。两个方向仍然都要查：
> **UC → 消费点**（有 UC 却没有任何页面用到 ⇒ 组件是多余的）；
> **消费点 → UC**（页面里有交互却没有对应 UC ⇒ 有需求没写清楚）。

| UC / R12 条目 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|
| UC-1 Dialog 打开/关闭 + focus trap（01-R3, 01-R12） | N/A | `components/ui/dialog.tsx`；kitchen-sink 展示区；全站替换点见迁移映射表 | ⏳ 待 F01 落地 |
| UC-2 Dropdown/Select 键盘操作（01-R3, 01-R12） | N/A | `components/ui/dropdown-menu.tsx`、`select.tsx` | ⏳ 待 F01/F02 落地 |
| UC-3 Tooltip 展示（01-R6, 01-R12） | N/A | `components/ui/tooltip.tsx` | ⏳ 待 F02 落地 |
| UC-4 复合组件收口盘点（06-R3, 06-R12） | N/A | 盘点报告 + 新原语文件 | ⏳ 待 F09 落地 |
| UC-5 Table 大数据量渲染（06-R3, 06-R9） | N/A | `components/ui/table.tsx`（候选，盘点后确定） | ⏳ 待 F09 落地 |

## 反向核查：现有代码里是否已有本束未覆盖的裸拼装点
- ⚠ **本表在需求阶段撰写，反向核查（全仓 grep 裸 Radix 拼装点）需在 F01 开工时执行一次**，
  结果回填本表。此处先如实标注为「未核查」而非假设结果，避免第二次「同一事实两处声明却对不上」。

## 覆盖状态图例
- ✅ 已落地并有自动化验证　⏳ feature 未开工，UC 已定义　❌ 有缺口需要处理
