# 原始需求 — 弹层类交互原语收口（Dialog / Dropdown / Select / Tooltip）

估点 **5**

> 来源：2026-08-23《WorkspaceX 十分制评估》P0 缺口「组件覆盖面」+《十分冲刺 Backlog》IT-01。

## R1 概览
- **Use Case 名称**：把弹层类交互统一到 `components/ui/`
- **Actor**：apps/web 全体页面的终端用户（间接受益）；直接施作者是负责该 feature 的开发 agent
- **目标**：`components/ui/` 已装 Radix 依赖（dialog/dropdown-menu/tooltip 等）但从未集中封装，各业务目录各自拼装弹层，导致遮罩透明度、圆角、阴影层级、进出场时机在不同页面各写一份。用户在潜意识里会感到"这个弹窗和那个弹窗不一样"却说不出哪里不对。目标是把 dialog / dropdown / select / tooltip 四类高频弹层收口成统一原语。
- **系统边界**：`apps/web/components/ui/`（新增文件）、`apps/web/tailwind.config.ts`（如需新增 token）、全站引用了裸 Radix 组装的业务文件（预计 15-25 个）、`apps/web/app/kitchen-sink/page.tsx`（展示区块）

## R2 前置条件 / 触发条件
- **前置条件**：
  - `@radix-ui/react-dialog`、`@radix-ui/react-dropdown-menu`、`@radix-ui/react-tooltip` 已在 `package.json` 中声明（已确认存在）
  - `apps/web/app/globals.css` 的 token 单源仍是唯一颜色/圆角/阴影事实源，新组件不得引入第二份数值
- **触发条件**：
  - 本 phase 开工，或任意后续 feature 需要新增一处弹层交互时，必须优先复用本 feature 产出的原语，而不是再手写一份

## R3 主流程
1. 盘点全仓当前 dialog/dropdown/select/tooltip 的裸 Radix 拼装点，列出文件清单
2. 按 `apps/web/components/ui/button.tsx` 的 CVA 范式（variant × size，token 化间距/圆角/阴影/过渡）新建 `dialog.tsx` / `dropdown-menu.tsx` / `select.tsx` / `tooltip.tsx`
3. 四个组件均支持：键盘可达（Esc 关闭、Tab 焦点陷阱、方向键在 dropdown/select 内导航）、深色模式、`data-testid` 可传入
4. 逐一替换业务目录里的旧实现为新原语，保留一份"旧实现 → 新原语"的迁移映射表
5. 在 `apps/web/app/kitchen-sink/page.tsx` 新增四个组件的展示区块，作为后续 UI 先行阶段的参考起点

## R4 备选流程与异常流程
- **备选流程**：
  - A1：某个业务场景需要 dialog 内嵌复杂表单（非纯确认对话框）——新原语需支持可滚动内容区，不强制单一尺寸
  - A2：dropdown 菜单项过多需要滚动——新原语需处理超长列表的视口截断
- **异常流程**：
  - E1：Radix 版本升级导致 API 变化——迁移记录需注明当前锁定的 Radix 版本号
  - E2：某个旧实现有本 feature 未预料到的定制样式需求（如全屏 dialog）——不能强行套用统一样式，需在迁移映射表里记录为"暂缓迁移"并写明原因，不许静默丢弃差异
  - E3：新原语上线后某页面视觉出现回归——需有 kitchen-sink 截图对比作为回滚依据

## R5 权限与可见性
- 本 feature 不涉及业务权限差异；所有角色看到的弹层交互行为一致
- 唯一的"权限"是开发流程权限：新增弹层交互的后续 feature 必须复用本原语，不得绕过（由 code review / lint 约束，非运行时权限）

## R6 后置条件 / 不包含
- **后置条件**：`components/ui/` 新增 4 个封装组件；kitchen-sink 可视化展示这 4 个组件；全仓裸 Radix 拼装点清零或有明确记录的例外
- **不包含**：
  - 不重做 12 个既有原子组件（avatar/badge/button 等）
  - 不在本 feature 内做动效 token 体系设计（属于下一个 feature，本 feature 只需先用现有 `transition-*` 类保证有过渡，不裸切换）
  - 不做 table/menu/breadcrumb 等复合组件（属于「组件覆盖面二期」feature）

## R7 业务规则
- 弹层的遮罩透明度、圆角、阴影层级必须全部来自 `globals.css` 的既有 token，不允许新写字面量色值/像素值（对应 `lint-design.sh` 的 U5a/U5b 规则）
- 任何弹层关闭方式（点遮罩/Esc/关闭按钮）必须行为一致，不能有的组件支持点遮罩关闭、有的不支持

## R8 界面线索
- 前端入口：全站任意需要弹层交互的位置（设置面板、确认框、右键菜单、下拉选择、悬浮提示）
- 线框/参考：现有 `apps/web/components/ui/button.tsx` 是唯一已确认的范式标杆，新组件应与其视觉语言一致
- 提醒：本 feature 属于 has_ui 阶段，开工前需随所属契约束一起经人类签核（design-signoff.md 第①节）

## R9 非功能约束
- 性能/规模预期：单页面同时存在的弹层数量正常场景 ≤3 层嵌套，需验证嵌套 dialog 场景不出现焦点丢失
- 安全/隐私/合规：无特殊要求
- 兼容与降级要求：需在 375/768/1280 三档视口下无横向溢出（对应 uiux-standards.md U8）

## R10 已知约束 / 依赖
- 依赖：`@radix-ui/react-*` 系列已装依赖；`apps/web/lib/theme.ts` 的深色模式机制
- 技术约束：Tailwind + CVA + `cn()` 工具函数（现有约定，见 uiux-standards.md §5）

## R11 切分提示
- 期望粒度：可拆成 dialog+dropdown 一组、select+tooltip 一组两个 feature，或合并为一个较大 feature（工作量评估为 L，1-2 周）
- 优先级：本阶段第一优先级，后续多个 feature（动效 token、组件覆盖二期）依赖本 feature 的产出

## R12 AI Ready 验收线索
- 可验证行为：kitchen-sink 页面能看到 4 个新组件的完整状态展示；`lint-design.sh` 全绿；全仓搜索裸 Radix Root 拼装模式命中数降到 0（或有记录的例外）；Playwright 截图对比新旧弹层视觉差异在容忍范围内；键盘走查（Tab/Esc/方向键）在 4 个组件上均可用
