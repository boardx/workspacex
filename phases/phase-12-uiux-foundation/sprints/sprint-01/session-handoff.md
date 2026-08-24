# 会话交接 — Sprint 12/01

## 当前已验证
- F04（1-2 处编排级动效 + prefers-reduced-motion 降级）passing。只做 UC-2「chat 消息
  到达进场」（`components/chat/message-entrance.tsx`），UC-3「面板展开/收起」评估后
  留给后续单独立项（理由见 `progress.md` 2026-08-24 条目）。两条 verification 命令
  全过，见 `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F04.verify.log`。
- F01（统一的 Dialog / Dropdown 弹层原语）passing。见
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
- F02（统一的 Select / Tooltip 弹层原语 + kitchen-sink 展示区）passing。三条 verification
  命令全过，见 `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F02.verify.log`。
- F09（复合组件收口：Table / Menu 原语落地）passing。见
  `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F09.verify.log`。

## 本轮改动（F02）
- `apps/web/components/ui/select.tsx`：`DropdownMenuContent` 加 `max-h-72 overflow-y-auto`。
- `apps/web/components/ui/tooltip.tsx`：`TooltipContent` 空 content（null/undefined/纯空白）
  不挂载气泡。
- 迁移 3 处原生 `<select>` → `Select`：`apps/web/app/chat/live/page.tsx`、
  `apps/web/app/project/live/page.tsx`、`apps/web/app/itv/live/page.tsx`（均无 e2e/单测
  依赖裸 `<select>` API，低风险）。
- 迁移 6 处 `title=` 裸 tooltip → `Tooltip` 组件：`apps/web/components/chat/chat-canvas-modal.tsx`、
  `apps/web/components/chat/chat-diagram-canvas-modal.tsx`（各 3 个工具栏图标按钮）。
- `apps/web/components/state/primitives-gallery.tsx`：Select 补禁用态 + 超长列表演示，
  Tooltip 补禁用触发态演示。
- 新增 `apps/web/tests/ui/overlay-primitives-select-tooltip.test.tsx`、
  `apps/web/e2e/overlay-primitives-kitchen-sink.spec.ts`（并入 `overlay-primitives-keyboard`
  project 的 testMatch）。

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
- 「暂不迁移」清单（原生 `<select>`）：
  - `chat-roster-add-input`（chat-read-screen.tsx）、`project-prep-group-*-leader`
    （tab-prep.tsx）—— 5+ 条 CI 门控 e2e spec 用 Playwright `.selectOption()` 直接操作，
    该 API 只认原生 `<select>`，迁移前要先重写这些 spec。
  - `org-admin-member-*-reviewer-function`（org-admin-screen.tsx）—— vitest RTL 测试
    用 `fireEvent.change` + `HTMLSelectElement.value` 断言，同样需要同步重写测试。
  - `project-prep-group-*-status`（tab-prep.tsx）——与 leader select 同一表单，为保持
    同一表单内控件风格一致，留到与 leader 一起处理。
  - `research-studio/*`、`admin/capability-mutate.tsx`、`admin/agent-definition-create-panel.tsx`、
    `admin/limit-rules-live.tsx`、`canvas/template-*.tsx` 等约 8 处未逐一核实测试耦合，
    本轮时间预算内未动，留给后续小 PR 按同样方法逐个核实再迁移。
  - `components/chat/chat-composer-pickers.tsx`：源码注释里已有历史决策记录（故意不用
    原生 `<select>` 也不用 `Select` 组件，手写弹层），非遗漏。
- GitHub issue #1676（F02 对应 issue）标题/labels 是历史遗留漂移（sprint:12-03/
  area:project，phase-12 实际只有 sprint-01），`sync --apply` 的 `--remove-label` 调用
  本轮失败了，标题/labels 没清干净，body 是对的。已用 spawn_task 登记单独任务。

## 本轮改动（F03）
- `apps/web/tailwind.config.ts`：新增 `transitionDuration`/`transitionTimingFunction`
  语义档位 fast=150ms/base=200ms/slow=300ms（三档 timing function 统一
  `cubic-bezier(0.4, 0, 0.2, 1)`）。
- `apps/web/app/globals.css`：新增动效 token 选值依据 + 迁移记录注释块。
- 迁移到语义 token：`components/ui/dialog.tsx`（3 处）、`dropdown-menu.tsx`（1 处）、
  `select.tsx`（1 处）、`components/state/primitives-gallery.tsx`（动效档位展示区本身
  改用真实 token）、`app/kitchen-sink/page.tsx`（1 处示例）。`tooltip.tsx` 无需改
  （迁移前没有 transition）。
- `apps/web/scripts/lint-design.sh`：新增 U10 规则，拦截裸 `duration-<数字>`/内建
  `ease-linear|in|out|in-out`。
- 新建 `apps/web/scripts/motion-legacy-allowlist.txt`（189 条存量豁免，R4-E2）+
  `contracts/motion-microinteraction/motion-migration-priority.md`（三批迁移优先级）。
- 新增 `apps/web/tests/lint-design-motion-rule.test.ts` + `__fixtures__/lint-motion-good.tsx`/
  `lint-motion-bad.tsx`；同步把既有 `__fixtures__/lint-good.tsx` 的裸 `duration-200`
  改成 `duration-base`（否则会被新规则打红）。
- F03（统一的语义化动效 token 体系 + lint 拦截裸 duration/easing）passing。两条
  verification 命令全过，见
  `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F03.verify.log`。

## 下一步最佳动作
- F04（编排级动效：chat 消息到达 / 面板展开收起），依赖 F03 token 体系已就绪。
- 或先做迁移优先级清单 P0 批次（`components/ui`+`components/shell` 共 21 处裸值，
  见 `contracts/motion-microinteraction/motion-migration-priority.md`）。
## 本轮改动（F09）
- 新增 `apps/web/components/ui/table.tsx`（Table/TableHeader/TableBody/TableRow/TableHead/
  TableCell/TableCaption/TableEmpty）与 `apps/web/components/ui/menu.tsx`（F01
  `dropdown-menu.tsx` 的命名别名）。
- 迁移 19 处业务目录手写 `<table>` → `Table` 原语，5 处业务目录手写弹层菜单 → `Menu`
  原语（`shell/personal-menu.tsx`、`shell/org-menu.tsx`、`chat/thread-list-shell.tsx`、
  `projects/projects-screen.tsx`、`projects/project-more-menu.tsx`）——完整清单与设计
  取舍见本 sprint `progress.md` F09 条目。
- `components/state/primitives-gallery.tsx` 新增 `CompositePrimitivesGallery`（Table/Menu
  演示区），接入 `/kitchen-sink`。
- 新增 `apps/web/tests/ui/composite-table-menu.test.tsx`；修复 6 个因迁移需要调整交互
  方式的既有测试（`fireEvent.click` → `fireEvent.pointerDown` 开菜单、`toBeDisabled()` →
  `toHaveAttribute("data-disabled")`，原因见 progress.md）。

## 下一步最佳动作
- F03（语义化动效 token 体系 + lint 拦截裸 duration/easing），或 F10（breadcrumb/
  pagination 原语，R11 拆分的另一半，依赖 F09 已 passing）。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 12/01`
- 调试:`pnpm --filter web exec vitest run tests/ui/overlay-primitives-dialog-dropdown.test.tsx`
- F05 调试:`pnpm run verify:chat-read`、`pnpm run verify:self-service-profile`
- 调试:`pnpm --filter web exec vitest run tests/ui/overlay-primitives-select-tooltip.test.tsx`
