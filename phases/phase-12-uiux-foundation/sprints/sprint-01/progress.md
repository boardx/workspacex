# 进度日志 — Sprint 12/01

## 当前已验证状态(唯一真相)
- 仓库根目录: apps/web
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F02（统一的 Select / Tooltip 弹层原语 + kitchen-sink 展示区）
- 当前 blocker: 无

## 会话记录
### 2026-08-23 10:27:28
- 本轮目标:
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-08-23 F01 完成
- 本轮目标: F01（统一的 Dialog / Dropdown 弹层原语落地，全站弹窗观感一致）。
- 已完成:
  - `components/ui/dialog.tsx`：`DialogContent` 新增可选 `closeTestId`/`hideClose`，
    让共享叠层原语能各自保留独立的关闭按钮 testid（嵌套/多实例场景不撞名）。
  - 迁移两套全站共用的手写叠层原语，内部改走 `components/ui/dialog.tsx`（Radix Dialog +
    Portal），调用方 props 不变，约 30 个消费点无需改动即获得一致的 Esc/点遮罩/焦点陷阱/深色模式：
    - `components/files/overlay.tsx`（`Modal`/`Drawer`）
    - `components/admin/panel.tsx`（`AdminModal`/`AdminDrawer`，`ConfirmDialog` 建立在 `AdminModal` 上自动跟随）
  - 迁移一个裸 Radix 实例：`components/rec/delete-transcription-dialog.tsx`。
  - 记录「暂不迁移」清单（见 PR 描述）：一批仍是裸 `@radix-ui/react-dialog`/`dropdown-menu`
    导入的次要弹层（低风险但本轮未逐个动，留给 F02/后续小 PR）；`chat-canvas-modal.tsx`/
    `chat-diagram-canvas-modal.tsx`（画布缩放导出，深度定制，高风险）；
    `components/projects/project-more-menu.tsx`（菜单内嵌确认子态 + 组织角色权限门控，
    测试覆盖深，高风险）；`components/agent-runtime/chat-screen.tsx` 的右侧抽屉（更贴近
    Sheet 语义而非 Dialog，暂不套）。
  - 新增 `tests/ui/overlay-primitives-dialog-dropdown.test.tsx`（13 用例：token 化 / 关闭
    行为一致性 / 嵌套 dialog 不丢焦点）与 `e2e/overlay-primitives-keyboard.spec.ts`（4 用例：
    Tab 焦点陷阱 / Esc 关闭 / 方向键导航 / 深色模式可见）。
- 运行过的验证:
  - `pnpm --filter web exec vitest run tests/ui/overlay-primitives-dialog-dropdown.test.tsx` → 13 passed
  - `pnpm --filter web run lint:design` → 全过
  - `pnpm --filter web exec playwright test -c playwright.config.ts -g 'overlay primitives keyboard'` → 4 passed
  - `pnpm exec vitest run tests/ui/`（全量 apps/web 单测回归）→ 150 files / 1168 tests 全过
  - `pnpm exec tsc --noEmit -p .`（apps/web）→ 无新增错误
  - `pnpm harness verify --sprint 12/01 --feature F01` → passing
- 已记录证据: `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F01.verify.log`
- 提交记录: 见本轮 PR（`worker/claude-12-F01` → main）
- 已知风险或未解决问题: 「暂不迁移」清单里的裸 Radix 实例仍分散在各业务目录，后续 F02/独立
  PR 应逐个收拢；`project-more-menu.tsx` 迁移前需先评估 Radix DropdownMenu 的 onSelect
  preventDefault 是否能干净承接「菜单内切到确认子态」这个交互，不能想当然直接套。
- 下一步最佳动作: F02（Select / Tooltip 原语 + kitchen-sink 展示区，两者已在
  `components/ui/select.tsx`/`tooltip.tsx` 且 `PrimitivesGallery` 已展示，需要同样做
  全仓盘点 + 迁移 + 补 verification）。
