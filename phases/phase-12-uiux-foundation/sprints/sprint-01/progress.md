# 进度日志 — Sprint 12/01

## 当前已验证状态(唯一真相)
- 仓库根目录: apps/web
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F02（统一的 Select / Tooltip 弹层原语 + kitchen-sink 展示区）
- 当前 blocker: 无

### 2026-08-23 F05 完成
- 本轮目标: F05（chat / profile 核心任务全键盘可达）。
- 已完成:
  - 走查发现并修复两个真实卡点（均是「任务能做但过程被打断」级别，不是彻底不可达）：
    1. **chat 发消息后焦点丢失到 `<body>`**——`components/chat/chat-live-message-panel.tsx`
       的 `submit()` 此前不管焦点；只用键盘连续发多条消息时，发完一条要重新从页面最开头
       Tab 一遍才能回到输入框。修法：新增一个跟踪 `submitting` 下降沿的 effect（与
       `thread-list-shell.tsx` 的 `ThreadCardButton` 用 `pending` 下降沿判断"提交结算"
       同一手法），发送成功后把焦点带回 composer。⚠ 踩过一次坑：直接在 `submit()` 内
       `setSubmitting(false)` 之前调用 `composerRef.current?.focus()` 不生效——composer
       的 `disabled` 绑的是 `submitting`，那一刻 DOM 上它还是 disabled，对 disabled 元素
       `.focus()` 是浏览器规范里的 no-op，焦点会落空退到 body（实测过一次这个错误假设）。
    2. `chat-keyboard-navigation.spec.ts` 自己的走查方向问题（非产品缺陷）——两条 F05
       专属线程按 `last_activity_at DESC` 排序，后创建的 `keyboardThreadBId` 天然排在
       `keyboardThreadAId` 前面，只往前 Tab 永远够不到，改成两个方向都试。
  - 新增两条真实端到端 Playwright 用例（用 `page.keyboard`，不用 `page.mouse`）：
    - `apps/web/e2e/chat-keyboard-navigation.spec.ts`：只用键盘发一条消息（Tab 走查到
      `chat-message-input`，Enter 发送，断言 202 + 焦点不丢）；只用键盘切换到另一个会话
      （Tab/Shift+Tab 走查到目标会话卡，Enter 选中，断言 URL/`aria-current` 均切换）。
      接入 `playwright.chat-read.config.ts`（新增两条 F05 专属线程
      `keyboardThreadAId`/`keyboardThreadBId`，种在 `restructureProjectId`，避免撞
      `chat-read.spec.ts:41`「本项目只有一条会话」的既有断言）。
    - `apps/web/e2e/profile-keyboard-navigation.spec.ts`：只用键盘改显示名并保存，
      刷新后仍在（证明真写库）。接入 `playwright.self-service-profile.config.ts`
      （新增独立的 `keyboardEmail` 专属账号，不与 admin 账号共享登录态——admin 账号
      在 `self-service-profile.spec.ts` 自己的用例里会真的改密码）。
  - `pnpm harness verify`/`lint-spec-gate-coverage.mjs` 双门槛都过：两条新 spec 均判定
    `[covered]`（吸取 F01 那轮的教训，不能只本地跑通就算数）。
  - ⚠ `feature_list.json` 的 F05.verification 与束级 `coverage.md` 的 V1 行原样是
    `-c playwright.config.ts -g 'keyboard chat'`（F01 沿用的裸配置模式）——F01 的
    Dialog/Dropdown 是纯客户端原语，能靠 `/kitchen-sink` 无登录演示页在裸配置下跑通；
    chat「发消息/切会话」与 profile「改资料并保存」本身就是要验证真实登录+持久化
    （R3 的 user_visible_behavior 逐字要求"端到端可复现"），裸配置的 webServer 只起
    `next dev`、没有 API/DB，登录表单必然打不通——**实测复现**：两条测试在裸配置下
    100% 因 `toHaveURL(/\/projects$/)` 超时失败。已把两处都改成
    `pnpm run verify:chat-read`/`verify:self-service-profile`（已挂真实登录+种子库的
    CI 门控命令），逐条命令实测跑绿（24/24、2/2）。同一模式的 `-c playwright.config.ts
    -g 'keyboard ...'` 还留在 F06/F16 的 verification 里，留给对应 feature 开工时处理。
- 运行过的验证:
  - `pnpm run verify:chat-read` → 24 passed（含新增 2 条）
  - `pnpm run verify:self-service-profile` → 2 passed（含新增 1 条）
  - `node .harness/scripts/lint-spec-gate-coverage.mjs` → 两条新 spec 均 `[covered]`
  - `pnpm harness verify --sprint 12/01 --feature F05` → passing（含 base verify:quick）
- 已记录证据: `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F05.verify.log`
- 提交记录: 见本轮 PR（`worker/claude-a-12-F05` → main）
- 已知风险或未解决问题: F06/F16 的 verification 里仍引用同一种裸配置模式
  （`-c playwright.config.ts -g 'keyboard org-admin'`/`'axe keyboard'`/`'keyboard'`），
  与本轮发现的问题同源，留给各自 feature 开工时处理，本轮未顺手改（范围纪律）。
- 下一步最佳动作: F02（Select / Tooltip 原语 + kitchen-sink 展示区），沿用既有 owner 的
  下一步计划；F06（org-admin 键盘可达）现在依赖已满足（F01、F05 均 passing）。

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
