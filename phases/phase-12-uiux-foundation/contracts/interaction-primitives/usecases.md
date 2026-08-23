# 契约束 `interaction-primitives` — 签核②：用例接口

> 本束**无后端 API 契约面**——四类弹层原语与复合组件都是纯前端展示/交互组件，不产生
> 服务端调用。因此本文的「用例」是**前端组件接口**（props in / 行为 out），不是
> `packages/contracts/src/*.ts` 意义上的后端端口。第③件签核材料（API 契约）在
> `design-signoff.md` 中记录为「不适用」，理由见该文件。

## UC-1：打开/关闭一个 Dialog
```
in:  { trigger: ReactNode, content: ReactNode, open?: boolean, onOpenChange?: (open: boolean) => void }
out: { 渲染态: "closed" | "open" }
pre: 无（任意页面可挂载）
err: FOCUS_TRAP_ESCAPE — 焦点被外部脚本（如第三方库）抢出 dialog 子树时，需在下一帧拉回
```

## UC-2：通过键盘操作 Dropdown / Select
```
in:  { items: Item[], activeIndex: number, disabled?: boolean }
out: { selectedValue: Item["value"] | null }
pre: 组件已挂载且 disabled !== true
err: EMPTY_ITEMS — items 为空时渲染明确的空态提示，不是静默不可交互（对应 uiux-standards 七态约定）
err: DISABLED_INTERACTION — disabled 时任何键盘事件不产生 selectedValue 变化
```

## UC-3：Tooltip 悬浮展示
```
in:  { trigger: ReactNode, content: string, delay?: number }
out: { 渲染态: "hidden" | "visible" }
pre: trigger 元素可获得 hover 或 focus
err: CONTENT_EMPTY — content 为空字符串时不渲染 tooltip（避免空气泡）
```

## UC-4：收口一个复合组件模式
```
in:  { pattern: "table" | "menu" | "breadcrumb" | "pagination", existingImplementations: FilePath[] }
out: { newPrimitivePath: string, migrationMap: Record<FilePath, "migrated" | "exception"> }
pre: existingImplementations.length >= 3（R4-A1 门槛）
err: BELOW_THRESHOLD — 重复次数 < 3，降级为不收口，在 migrationMap 中不产生条目，仅记录盘点结论
err: SEMANTIC_DIVERGENCE — 候选模式语义差异过大（如「数据表格」与「设置项列表」），拆成 ≥2 个更聚焦的原语而非强行合一
```

## 已知迁移债（对应 design-coherence.md X-B）
本束（F01/F02）落地时，四个新组件的进出场动效仍使用现有裸 `transition-*` 类
（不裸切换、但也不等 `motion-microinteraction` 束的语义 token 落地）。
`motion-microinteraction` 束（F03）完成后，需要回头把这四个组件迁移到新 token，
这是一笔显式记录的技术债，不是遗漏。

## UC-5：Table 数据渲染（大数据量）
```
in:  { rows: T[], columns: ColumnDef<T>[] }
out: { 渲染态: "loading" | "empty" | "populated" }
pre: 无
err: LARGE_DATASET_DEGRADE — rows.length 超过约定阈值（本束建议 ≥200 行触发虚拟滚动或分页提示，具体阈值由实现时性能实测确定）
```
