# 进度日志 — Sprint 12/01

## 当前已验证状态(唯一真相)
- 仓库根目录: apps/web
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: F03（语义化动效 token 体系 + lint 拦截裸 duration/easing）
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
### 2026-08-23 F13 完成
- 本轮目标: F13（rev-uiux 评审结果结构化落盘 + 历史回填 + Top5 扣分维度统计，issue #1875）。
- 已完成:
  - `.harness/scripts/uiux-review-log.ts`：schema 单一事实源（`UiuxReviewLogEntry` 类型 +
    `validateEntry`/`readEntries`/`appendEntries`/`dedupeKey`），append-only（R7：更正走追加
    新记录，不改写旧行）。
  - `.harness/state/uiux-review-log.jsonl`：新建结构化评审日志，共 233 行：
    - `.harness/scripts/uiux-review-log-backfill.ts` 从 `git log --all` 尽力回填 —— 候选
      242 个 commit（关键词：uiux/fidelity/保真度/rev-uiux/评分/score(/十维/十项），去重后
      新增 231 条（`parsed`=14 条有可靠总分，`unresolved`=217 条命中关键词但格式无法可靠
      解析出总分，`notes` 里原样保留 commit subject，未编造分数）。
    - `.harness/scripts/uiux-review-log-seed-known-detail.ts` 手工搬运 1 条带完整十维明细
      的记录（逐字对照 `.harness/state/chat-ux-scoring-log.md` 2026-08-23 track B 重评，
      非编造——该文件仍是这条记录的权威来源）。
  - `.harness/scripts/uiux-review-log-stats.ts`：Top5 反复扣分维度统计，`computeStats` 导出
    可测；样本量 < 5 时强制输出 `sampleSizeWarning`（R4-E2，不冒充趋势）；Top1 起每条都带
    `actionItem`（已知维度精确映射，未知维度兜底模板，R6：结论必须对应具体行动项）。
  - `package.json` 新增 `uiux-review-log:backfill` / `uiux-review-log:stats` 两个便捷命令。
  - `.harness/instructions/uiux-standards.md` 新增「9. rev-uiux 评审结果落盘」一节，约定
    以后每次评审后追加记录 + 跑 stats 检查 Top5 变化。
  - `phases/phase-12-uiux-foundation/feature_list.json`：F13 的 verification 从
    `pnpm --filter api exec vitest run tests/uiux/*.test.ts` 改为
    `pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/*.test.ts`——
    apps/api 的 vitest 配置带 `globalSetup` 连 Postgres/跑迁移，F13 是纯文件系统治理数据、
    不该背上数据库依赖；`.harness` 目录本就是治理类脚本+测试的家（`lint-nav-reachability.test.ts`
    等同款先例），已在本条 notes 里写清楚改动原因。
- Top5 统计结果（实测输出，样本量提示已如实标注）：
  1. `4-真实的多步能力`（扣 1/1 次）
  2. `5-语音输入体验`（扣 1/1 次）
  3. `6-多轮上下文`（扣 1/1 次）
  4. `7-错误处理透明度`（扣 1/1 次）——行动项：固化「失败态三件套」成 lint-design 规则/组件契约测试
  5. `10-整体连贯性`（扣 1/1 次）
  - 样本量提示：仅 1 条带逐维明细的评审记录（阈值 5），排名会随后续评审补充明细而变化，
    不构成可靠趋势结论——这是 R4-E2 要求的如实披露，不是缺陷。
- 运行过的验证:
  - `pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/uiux-review-log-schema.test.ts` → 18 passed
  - `pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/uiux-review-log-stats.test.ts` → 11 passed
  - `pnpm harness verify --sprint 12/01 --feature F13` → 门控通过，F13 = passing
- 已记录证据: `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F13.verify.log`
- 提交记录: 见分支 `worker/claude-d-12-F13` 对应 PR（`Closes #1875`）。
- 已知风险或未解决问题: 历史回填的 217 条 `unresolved` 记录只有关键词命中、拿不到结构化
  总分/维度，是历史记录本身格式不统一导致，如实标注不代表遗漏；Top5 统计目前样本量为 1，
  需要后续评审持续往日志里追加带逐维明细的记录才能积累出可靠趋势。
- 下一步最佳动作: 后续每次 `rev-uiux` 评审（含 F14/F15）完成后按 `uiux-standards.md` §9
  追加记录到 `uiux-review-log.jsonl`，逐步把样本量做上去。

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

### 2026-08-23 F02 完成
- 本轮目标: F02（统一的 Select / Tooltip 弹层原语 + kitchen-sink 展示区）。
- 已完成:
  - `components/ui/select.tsx`：`DropdownMenuContent` 加 `max-h-72 overflow-y-auto`，
    超长选项列表视口内可滚动截断（不撑爆页面），选项数据仍全量渲染（截断是视觉滚动
    不是裁数据）。
  - `components/ui/tooltip.tsx`：`TooltipContent` 新增空 content 守卫
    （`isEmptyTooltipContent`）——children 为 null/undefined/纯空白字符串时不挂载气泡节点。
  - 全仓裸实现盘点（原生 `<select>`/裸 title= 当 tooltip/裸 `@radix-ui/react-tooltip`）：
    - 裸 `@radix-ui/react-tooltip` 拼装：0 处（本仓 tooltip 一直只有这一个文件用）。
    - 原生 `<select>`：约 15 处分散在 app/ 与 components/ 下。迁移 3 处低风险（见下），
      其余记录「暂不迁移」清单（PR 描述）。
    - `title=` 充当 tooltip 的裸实现：迁移 6 处（chat-canvas-modal.tsx / 
      chat-diagram-canvas-modal.tsx 各 3 个工具栏图标按钮），改用 Tooltip 组件、
      保留 aria-label。
  - `components/state/primitives-gallery.tsx`：Select 区块补齐禁用态 + 40 项超长列表
    可滚动截断演示；Tooltip 区块补齐禁用触发态演示。
  - 新增 `tests/ui/overlay-primitives-select-tooltip.test.tsx`（12 用例：token 化 /
    超长列表 content 带 max-h-*+overflow-y-auto / tooltip 空 content 不挂载）与
    `e2e/overlay-primitives-kitchen-sink.spec.ts`（5 用例：四原语展示区可见 / select
    可展开选中 / select 禁用态 / 超长列表滚动截断 / tooltip hover+禁用态），并入既有
    `overlay-primitives-keyboard` project 的 testMatch（同一静态页、同样不需要种子/登录）。
- 运行过的验证:
  - `pnpm --filter web exec vitest run tests/ui/overlay-primitives-select-tooltip.test.tsx` → 12 passed
  - `pnpm --filter web run lint:design` → 全过
  - `pnpm --filter web exec playwright test -c playwright.config.ts -g 'kitchen sink overlays'` → 5 passed
  - `node .harness/scripts/lint-spec-gate-coverage.mjs` → 全 [covered]/[exempt]，新 spec 非 [unrun]
  - `pnpm -w run verify:quick` → 通过（194 test files / 1656 tests；typecheck/lint 全过）
  - `pnpm harness verify --sprint 12/01 --feature F02` → passing
- 已记录证据: `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F02.verify.log`
- 提交记录: 见本轮 PR（`worker/claude-12-F02` → main）
- 已知风险或未解决问题:
  - 「暂不迁移」的原生 `<select>` 清单里，`chat-roster-add-input`（chat-read-screen.tsx）
    与 `project-prep-group-*-leader`（tab-prep.tsx）被 5+ 条 CI 门控 e2e spec 用
    Playwright `.selectOption()`（仅原生 `<select>` 支持）直接操作，迁移前必须先把那些
    spec 改成点击式交互，成本超出本 feature 范围。
  - `org-admin-member-*-reviewer-function` 有 vitest RTL 测试用 `fireEvent.change` +
    `HTMLSelectElement.value` 断言，迁移同样需要同步重写测试。
  - GitHub issue #1676 的标题/labels 是历史遗留漂移（sprint:12-03/area:project，phase-12
    实际只有 sprint-01），`pnpm harness sync --phase 12 --apply` 已把它的 body 正确
    覆盖为 F02 内容并关闭，但 `--remove-label` 那几条 gh 调用本轮同步日志里失败了，
    标题/labels 未清干净——已用 spawn_task 登记一条独立收尾任务，不在本 PR 里顺手改。
- 下一步最佳动作: F03（语义化动效 token 体系 + lint 拦截裸 duration/easing）。

### 2026-08-24 F03 完成
- 本轮目标: F03（语义化动效 token 体系 + lint 拦截裸 duration/easing）。
- 已完成:
  - `apps/web/tailwind.config.ts`：新增 `transitionDuration`/`transitionTimingFunction`
    语义档位 fast=150ms/base=200ms/slow=300ms（数值沿用 kitchen-sink 展示区已确认过的
    取值，未凭空拍新数字），三档 timing function 统一 `cubic-bezier(0.4, 0, 0.2, 1)`
    （等价内建 `ease-in-out`，也是 Tailwind `transition-*` 默认曲线，全仓无证据支撑
    拆出不同曲线）。
  - `apps/web/app/globals.css`：新增专门的动效 token 依据注释块（选值理由 + F01/F02
    四组件迁移记录 + 存量迁移优先级/豁免清单指路），不与 tailwind.config.ts 重复写
    字面量（同一事实不得声明在两处）。
  - F01/F02 四个弹层组件迁移到语义 token（示范用法）：`dialog.tsx`（Overlay/Content/
    关闭按钮 3 处）、`dropdown-menu.tsx`（菜单项高亮态 1 处）、`select.tsx`（触发器
    1 处）均 `duration-200 → duration-base`；`tooltip.tsx` 的 `TooltipContent` 迁移前
    没有任何 `transition-*`，本次未新增行为。顺带把 `primitives-gallery.tsx` 的
    「动效 token 档位对照」展示区（本身就是这三档 token 的签核材料）从裸
    `duration-150/200/300` + `ease-in-out` 改成真正消费 `duration-fast/base/slow` +
    `ease-base`，以及 `kitchen-sink/page.tsx` 一处示例列表项。
  - `apps/web/scripts/lint-design.sh` 新增 U10 规则：拦截裸 `duration-<数字>` 与内建
    `ease-linear|in|out|in-out`，放行本仓语义类名 `duration-fast/base/slow`、
    `ease-fast/base/slow`。全仓存量 189 条未迁移用法（198 处原始命中，同文件内容
    完全相同的重复行合并计数）登记进新建的
    `apps/web/scripts/motion-legacy-allowlist.txt`（R4-E2 已知例外，按 `path\t行内容`
    子串匹配豁免——不是按行号，那一行文本一变豁免立刻失效，不会被静默放行）。
  - 迁移优先级清单：新建
    `contracts/motion-microinteraction/motion-migration-priority.md`，按目录密度分三批
    （P0 `components/ui`+`components/shell` 21 处最高优先级；P1 `chat`/`projects`/`files`
    跟随功能改动顺手迁移；P2 其余领域专属组件机会性迁移），不要求本 feature 一次改完
    （R5 明文允许分批）。
  - 反证测试：新增 `apps/web/tests/lint-design-motion-rule.test.ts` + 专用 fixture
    `__fixtures__/lint-motion-good.tsx`（duration-fast/base/slow + ease-fast/base/slow
    全放行）/`__fixtures__/lint-motion-bad.tsx`（裸 `duration-500`/`ease-linear` 均被
    U10 拦截并报出规则号与命中文本）。顺带把既有 `__fixtures__/lint-good.tsx` 里两处
    裸 `duration-200` 改成 `duration-base`（否则新规则会让既有 `lint-design-gate.test.ts`
    的「合规 fixture 放行」用例变红）。
  - 未引入 framer-motion 或任何新动画库依赖，保持纯 CSS transition 路线（R6/R10）。
- 运行过的验证:
  - `pnpm --filter web exec vitest run tests/lint-design-motion-rule.test.ts` → 5 passed
  - `pnpm --filter web run lint:design` → 全过（全仓扫描，含新迁移的 4 组件与新豁免清单）
  - `pnpm --filter web exec vitest run tests/lint-design-gate.test.ts` → 12 passed（既有
    门控回归不受影响）
  - `pnpm --filter web exec tsc --noEmit -p .` → 无新增错误
  - `pnpm harness verify --sprint 12/01 --feature F03` → passing（含 base verify:quick）
- 已记录证据: `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F03.verify.log`
- 提交记录: 见分支 `worker/claude-e-12-F03` 对应 PR（`Closes #1868`）。
- 已知风险或未解决问题: 全仓仍有 189 条存量裸 duration/ease 用法未迁移（已登记进
  `motion-legacy-allowlist.txt` + 优先级清单，按 R5 允许分批，不阻塞本 feature）；
  `tooltip.tsx` 的 `TooltipContent` 目前没有任何进出场过渡（迁移前如此，本次未新增
  行为），是否需要补一条是独立决策，不在本次「迁移存量裸值」范围内。
- 下一步最佳动作: F04（编排级动效：候选是 chat 消息到达、面板展开/收起），依赖 F03 的
  token 体系已就绪；或按迁移优先级清单先做 P0 批次（`components/ui`+`components/shell`
  21 处）作为独立小 feature/PR。
### 2026-08-24 F09 完成
- 本轮目标: F09（复合组件收口：Table / Menu 原语落地，issue #1871）。
- 盘点结论（自己重新 grep 核对，未直接信任任务指令里的种子清单）：
  - Table：19 处业务目录手写 `<table>`（admin/limit-policy-tab.tsx、admin/usage-monitor-tab.tsx、
    brain/decision-chain.tsx、brain/decision-ledger.tsx、canvas/knowledge-backflow.tsx、
    canvas/template-admin.tsx、chat/preset-dispatch.tsx、files/files-list.tsx、
    files/live-files-browser.tsx、interview/insights-report.tsx、itv/insight-report.tsx、
    project/tab-prep.tsx、survey/workflow/analysis-report-step.tsx、
    survey/workflow/response-review-step.tsx、tpl-designer/facet-content-editor.tsx、
    tpl-designer/materials-panel-editor.tsx、tpl/designer-panels.tsx（×2 张表）、
    tpl/project-prep-screen.tsx、tpl/workflow-screen.tsx）——逐一读过全部之后形状高度一致
    （thead/tr 表头 + tbody/tr 数据行 + 可选 colSpan 空态/展开行），未发现语义分裂到需要
    拆两个原语的地步，收口为**一套** `Table` 原语，不强行拆分。
  - Menu：5 处业务目录手写「open state + document mousedown/keydown 监听外点关闭/Esc +
    role="menu" 绝对定位 div」（chat/thread-list-shell.tsx、projects/project-more-menu.tsx、
    projects/projects-screen.tsx、shell/org-menu.tsx、shell/personal-menu.tsx）——`Menu`
    原语直接复用 F01 的 `dropdown-menu.tsx`（Radix DropdownMenu），只做命名别名
    （`components/ui/menu.tsx`），不重新实现弹层逻辑。
- 已完成:
  - 新增 `apps/web/components/ui/table.tsx`（`Table`/`TableHeader`/`TableBody`/`TableRow`
    （`variant="header"|"body"`）/`TableHead`/`TableCell`/`TableCaption`/`TableEmpty`）。
    默认 token 贴合已有多数用法（`border-border`/`border-border-subtle`/`bg-panel`），
    未强加 `text-align`（Tailwind preflight 已把 th/td 的 text-align reset 成 inherit，
    与之前手写标签视觉等价）；未做「可排序表头」——19 处盘点里没有一处真的点表头排序，
    现在加是「看起来做了事」而不是回应真实需求。
  - 新增 `apps/web/components/ui/menu.tsx`（`Menu`/`MenuTrigger`/`MenuContent`/`MenuItem`/
    `MenuLabel`/`MenuSeparator`/`MenuGroup`/`MenuRadioGroup`/`MenuRadioItem`，均为
    `dropdown-menu.tsx` 的命名别名）。
  - 迁移全部 19 处 Table 消费点（机械化标签替换：`<table>`→`<Table>`等六对标签，
    classNames/data-testid/事件处理器原样保留，视觉 1:1 不变，因为 `cn()` 用
    tailwind-merge，调用方 className 总能覆盖新原语的默认值）；`project/tab-prep.tsx`
    的空态行额外收口成 `TableEmpty`。
  - 迁移全部 5 处 Menu 消费点：
    - `shell/personal-menu.tsx`、`shell/org-menu.tsx`：改走非受控 `Menu`；org-menu 的
      「切换组织」列表从手写 `role="menuitemradio"` 按钮改用 `MenuRadioGroup`/`MenuRadioItem`
      （Radix 原生渲染 role/aria-checked/选中态 Check 图标）。
    - `chat/thread-list-shell.tsx`（`ThreadCardButton`）：菜单是四态状态机
      （view/menu/editing/deleting）里的一态，`open={mode==="menu"}` 受控，选中项用
      `onSelect` `preventDefault()` 避免 Radix「选中即关闭」抢在本组件自己的状态机之前
      把 `mode` 拉回 `"view"`（两个 setState 竞态，实测复现过一次才定位到）。
    - `projects/projects-screen.tsx`（`ProjectRealCard`）、`projects/project-more-menu.tsx`：
      F01 当初把这两个文件判定为高风险暂缓（菜单内嵌归档二次确认子态）——F09 验证过
      Radix 受控 `open` + `onSelect preventDefault()` 能干净承接这种子态切换，正式迁移。
      迁移顺带**修复**了一个此前的真实缺口：`projects-screen.tsx`/`project-more-menu.tsx`
      的菜单此前完全没有外点关闭/Esc 关闭（纯靠按钮 toggle），Radix 原生补上了。
  - `components/state/primitives-gallery.tsx` 新增 `CompositePrimitivesGallery`
    （Table 演示区含"清空看空态"按钮 + Menu 演示区），接入 `/kitchen-sink`。
  - 新增 `apps/web/tests/ui/composite-table-menu.test.tsx`（18 用例：table.tsx/menu.tsx
    token 化、Table 表头/数据行/空态/variant 默认值/className 覆盖、Menu 开合/外点关闭/
    Esc 关闭/键盘 Enter 触发/disabled 项不可选中）。
  - 修复因迁移而需要调整的既有测试（Radix DropdownMenuTrigger 靠 `pointerdown` 开合，
    不是 `click`；外点关闭需要等 `setTimeout(0)` 让 Radix 的延迟 pointerdown 监听器挂载；
    Radix Item 渲染成 `<div role="menuitem">`，`toBeDisabled()` 只认原生表单控件，
    改断言 `data-disabled`）：`tests/ui/shell-personal-menu.test.tsx`、
    `tests/ui/org-switcher-real-names.test.tsx`、`tests/ui/thread-card-button.test.tsx`、
    `tests/ui/chat-thread-crud.test.tsx`、`tests/ui/personal-chat-screen.test.tsx`、
    `tests/ui/projects-screen-live.test.tsx`。
- 运行过的验证:
  - `pnpm --filter web exec vitest run tests/ui/composite-table-menu.test.tsx` → 18 passed
  - `pnpm --filter web run lint:design` → 全过
  - `pnpm --filter web exec tsc --noEmit -p .` → 无错误
  - `pnpm --filter web exec vitest run`（全量 apps/web 单测回归）→ 203 files / 1716 tests 全过
  - `pnpm harness verify --sprint 12/01 --feature F09` → passing
  - `pnpm harness doctor --phase 12` → 0 FAIL（3 WARN：证据日志未提交/issue 未关闭/
    readiness 未达标，均待本轮 PR 合入与 issue 关闭后自然清除）
- 已记录证据: `phases/phase-12-uiux-foundation/sprints/sprint-01/evidence/F09.verify.log`
- 提交记录: 见本轮 PR（`worker/claude-g-12-F09` → main）
- 已知风险或未解决问题: 无新增遗留；`project-more-menu.tsx` 本身是未被任何路由引用的
  遗留原型卡（`components/projects/project-card.tsx` 无调用方），仍按同样标准迁移以保持
  菜单实现单一事实源，但它不产生真实用户可见行为，不计入"新迁移的真实业务面"。
- 下一步最佳动作: F03（语义化动效 token 体系 + lint 拦截裸 duration/easing），或 F10
  （breadcrumb/pagination 原语，R11 拆分的另一半）。
