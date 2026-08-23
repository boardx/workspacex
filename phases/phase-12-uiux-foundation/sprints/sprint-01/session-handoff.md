# 会话交接 — Sprint 12/01

## 当前已验证
- F01（统一的 Dialog / Dropdown 弹层原语）passing。三条 verification 命令全过，见
  `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F01.verify.log`。
- F05（chat / profile 核心任务全键盘可达）passing。两条 verification 命令全过，见
  `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F05.verify.log`。
- F13（rev-uiux 评审结果结构化落盘 + 历史回填 + Top5 扣分维度统计）passing。两条
  verification 命令全过，见
  `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F13.verify.log`。
  与 F01/F02 等无代码交集（纯 `.harness/state/` + `.harness/scripts/` 治理数据），
  独立分支 `worker/claude-d-12-F13`，不阻塞/不依赖其他并行 feature。

## 本轮改动（F01，历史）
- `apps/web/components/ui/dialog.tsx`：`DialogContent` 加 `closeTestId`/`hideClose`。
- `apps/web/components/files/overlay.tsx`、`apps/web/components/admin/panel.tsx`：
  `Modal`/`Drawer`/`AdminModal`/`AdminDrawer` 内部改走 Radix Dialog（props 不变，
  约 30 个消费点自动获得一致行为）。
- `apps/web/components/rec/delete-transcription-dialog.tsx`：裸 Radix → `ui/dialog.tsx`。
- 新增 `apps/web/tests/ui/overlay-primitives-dialog-dropdown.test.tsx`、
  `apps/web/e2e/overlay-primitives-keyboard.spec.ts`。

## 本轮改动（F05）
- `apps/web/components/chat/chat-live-message-panel.tsx`：修复发消息后焦点丢到
  `<body>` 的卡点——新增一个跟踪 `submitting` 下降沿的 effect，发送成功后把焦点带回
  composer（不能在 `setSubmitting(false)` 之前直接 `.focus()`，那一刻 DOM 上 composer
  还是 `disabled`，focus 在 disabled 元素上是 no-op）。
- 新增 `apps/web/e2e/chat-keyboard-navigation.spec.ts`（keyboard chat：发消息 + 切会话，
  全程 `page.keyboard`）、`apps/web/e2e/profile-keyboard-navigation.spec.ts`
  （keyboard profile：改显示名并保存，刷新后仍在）。
- `apps/web/e2e/chat-read-fixture.ts` + `apps/api/scripts/seed-chat-read-e2e.ts` +
  `apps/web/playwright.chat-read.config.ts`：新增两条 F05 专属线程
  （`keyboardThreadAId`/`keyboardThreadBId`，种在 `restructureProjectId`）+ 接入
  spec gate（`testMatch` 正则新增 `chat-keyboard-navigation`）。
- `apps/web/e2e/self-service-profile-fixture.ts` + `apps/api/scripts/seed-self-service-profile-e2e.ts`
  + `apps/web/playwright.self-service-profile.config.ts`：新增独立 `keyboardEmail` 专属
  账号（不与 admin 账号共享登录态）+ 接入 spec gate（`testMatch` 新增
  `profile-keyboard-navigation`）。
- `phases/phase-12-uiux-foundation/feature_list.json`（F05.verification）与
  `contracts/accessibility-guardrails/coverage.md`（V1 行）：把裸配置模式
  （`-c playwright.config.ts -g 'keyboard chat'`）改成实测能跑绿的 CI 门控命令
  （`pnpm run verify:chat-read`/`verify:self-service-profile`）——原因见 `progress.md`
  F05 条目，简言之：chat/profile 键盘可达本质要验证真实登录+持久化，裸配置没有
  API/DB，login 表单打不通，实测 100% 因登录超时失败。

## 仍损坏或未验证
- 「暂不迁移」清单（一批裸 Radix 弹层、`project-more-menu.tsx`、canvas 缩放/导出弹层、
  agent-runtime 右侧抽屉）——原因见本 sprint `progress.md` 对应条目，不是遗漏，是评估后
  判定高风险或语义不同（Sheet≠Dialog）而暂缓。
- F06/F16 的 verification 里仍引用与 F05 同源的裸配置模式
  （`-c playwright.config.ts -g 'keyboard org-admin'`/`'axe keyboard'`/`'keyboard'`），
  留给对应 feature 开工时处理，本轮未顺手改（范围纪律）。

## 下一步最佳动作
- F02（Select / Tooltip 原语 + kitchen-sink 展示区）。`components/ui/select.tsx`/
  `tooltip.tsx` 已存在且已在 `PrimitivesGallery` 展示，按 F01 同样的流程（全仓盘点 →
  迁移 → 补 verification）继续。
- F06（org-admin 键盘可达 + axe-core）依赖已满足（F01、F05 均 passing），可开工，
  但注意上面「仍损坏或未验证」提到的裸配置问题会同样出现。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 12/01`
- 调试:`pnpm --filter web exec vitest run tests/ui/overlay-primitives-dialog-dropdown.test.tsx`
- F05 调试:`pnpm run verify:chat-read`、`pnpm run verify:self-service-profile`
