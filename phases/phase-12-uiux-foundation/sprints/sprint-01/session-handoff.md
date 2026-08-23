# 会话交接 — Sprint 12/01

## 当前已验证
- F01（统一的 Dialog / Dropdown 弹层原语）passing。三条 verification 命令全过，见
  `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F01.verify.log`。

## 本轮改动
- `apps/web/components/ui/dialog.tsx`：`DialogContent` 加 `closeTestId`/`hideClose`。
- `apps/web/components/files/overlay.tsx`、`apps/web/components/admin/panel.tsx`：
  `Modal`/`Drawer`/`AdminModal`/`AdminDrawer` 内部改走 Radix Dialog（props 不变，
  约 30 个消费点自动获得一致行为）。
- `apps/web/components/rec/delete-transcription-dialog.tsx`：裸 Radix → `ui/dialog.tsx`。
- 新增 `apps/web/tests/ui/overlay-primitives-dialog-dropdown.test.tsx`、
  `apps/web/e2e/overlay-primitives-keyboard.spec.ts`。

## 仍损坏或未验证
- 「暂不迁移」清单（一批裸 Radix 弹层、`project-more-menu.tsx`、canvas 缩放/导出弹层、
  agent-runtime 右侧抽屉）——原因见本 sprint `progress.md` 对应条目，不是遗漏，是评估后
  判定高风险或语义不同（Sheet≠Dialog）而暂缓。

## 下一步最佳动作
- F02（Select / Tooltip 原语 + kitchen-sink 展示区）。`components/ui/select.tsx`/
  `tooltip.tsx` 已存在且已在 `PrimitivesGallery` 展示，按 F01 同样的流程（全仓盘点 →
  迁移 → 补 verification）继续。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 12/01`
- 调试:`pnpm --filter web exec vitest run tests/ui/overlay-primitives-dialog-dropdown.test.tsx`
