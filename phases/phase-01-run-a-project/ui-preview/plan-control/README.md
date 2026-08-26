# plan-control 契约束（TW-P0-3 可编辑计划 + 六态工作流）UI 先行原型 · 八屏

ADR-023 签核第 ① 件（UI）材料。截图由 `apps/web/scripts/shot-plan-control.mjs` 从预览路由
`/preview/plan-control?screen=g01..g08` 抓取（纯 mock，不接后端，零 console error）。

- 组件：`apps/web/components/plan-control/plan-control-screens.tsx`
- mock：`apps/web/lib/mock/plan-control.ts`
- 预览路由：`apps/web/app/preview/plan-control/page.tsx`
- 落点：全部落在 `/chat` 三栏骨架内的计划面板 / 消息流（宿主屏归 `chat` 束，本束**不新建路由**）。
  预览页只是把四个区域单独铺出来供逐屏签核。

## 八屏 ↔ ui.md 对应

| 截图 | 屏 | 对应 ui.md | 覆盖 |
|---|---|---|---|
| `g-01-plan-readonly-three-status.png` | S2 | 2.1 只读态 | 三种步骤状态同屏 + 约束缩进；无 `write_todos` 字样（判据二） |
| `g-02-plan-edit-actions.png` | S3 | 2.1 编辑态 | 调序(UC-3)/删步(UC-4)/加约束(UC-5)/撤约束(UC-6) 四动作同屏 + 删后「撤销」浮条 |
| `g-03-plan-reorder-dragging.png` | S3 | 2.1 调序中间态 | 抬起 + 落点高亮；键盘等价 Alt+↑/↓（TW-A11Y-8） |
| `g-04-constraint-inline-input.png` | S3 / S7 | 2.1 + 2.2 | 加约束就地展开 + 已挂载一条；附孤儿约束(I-8) 与陈旧横条(I-5) |
| `g-05-phase-indicator-six-states.png` | S1 | 2.3 六态指示器 | 六联；`failed` 替换整条；当前态可读文本 + `aria-current` + `role=status`（判据一） |
| `g-06-confirm-gate-vs-simple.png` | S4 | 2.4 确认门 | required=true 对照 required=false（简单提问节点不入 DOM，非隐藏）；无「跳过确认」（判据四） |
| `g-07-run-progress-and-pending-apply.png` | S5 / S8 | 2.5 + 2.2 | 执行进度 + 暂停(UC-9)；执行中编辑告知条(I-11) |
| `g-08-failure-two-recovery.png` | S6 | 2.5 失败态 | 仅两个恢复动作（重试该步 UC-10 / 修改输入）；「恢复检查点」按钮**不渲染**（裁决 c） |

## 我替 UC 做的设计决定（人类签核第 ① 件时请逐条看）

1. **删步无二次确认，改用「已移除 · 撤销」浮条**（G-02）。依据 ui.md 2.1 末尾的取舍论证
   （账本 append-only，撤销 = 基于旧 revision 重放）。ui.md 明确标注「请人类确认这个取舍」。
2. **执行中编辑告知文案**（G-07）逐字：「你的改动会**落到账本、在当前步骤完成后生效**，
   不会改变正在跑的这一步。要立刻生效请先暂停。」——如实实现裁决四「不立刻生效」，
   不承诺当前步会变。这是 I-11 对用户的唯一出口，措辞请重点核。
3. **「暂停」用词未定**（G-07）。ui.md 2.5 说若语义是「中止后可重开一轮」，建议改「停止」。
   我先按 ui.md 正文用「暂停」，此项**待人类拍**，不是我能定的。
4. **确认门对照采用左右两栏同屏**（G-06），让「简单提问路径该节点不入 DOM」这条判据四的
   反面在一张图里可见。ui.md 只要求「一对对照」，未指定并列还是两张，我选并列。
5. **六态用「六联」单图**（G-05），ui.md G-05 允许「六个态各一张或一张六联」，我选六联省张数、
   便于横向比较高亮位置。
6. **加约束的默认输入预填了「只用公开可引用的来源」**（G-04）示范挂载后形态；真实交互中输入为空。
7. **新增四锚点全部在 G-04 一屏可见**（`plan-constraint-remove` / `plan-stale-banner` /
   `plan-pending-apply` / `plan-orphan-constraint`）——ui.md 第四节要求签核时一并确认。

## R8 线索之间的矛盾与处理

- ui.md 2.3 示例写「准备 › [计划] › 执行 › 审批 › 完成」是五格线，而 S1 标题又叫「六态」。
  处理：`failed` 是第六态但**不在线上**（ui.md 2.3 明说 failed 替换整条 → S6），
  所以线上恒为五格 + failed 单独态。G-05 把六态都画出来，第六行就是替换整条的失败摘要。
- 无其它实质矛盾。

## 建议人类在束级 design-signoff.md 第 ① 件签核时重点核对的 3 处

1. **G-07 的执行中编辑告知文案**——它是裁决四「不立刻生效」对用户的唯一承诺面，措辞一旦签就落地。
2. **G-08 只有两个恢复动作、「恢复检查点」如实缺席**——确认这就是裁决 (c) 想要的形状
   （不是漏画，是明确不做，TW-P0-3 封顶 0.7）。
3. **G-02 删步「撤销」取舍 + 「暂停/停止」用词**——这两处 ui.md 都标了「请人类拍」，签核时定稿。

## 未接后端（如实声明）

本束是 UI 先行原型，所有按钮**当前不接后端**（mock）。verification 阶段接 UC-1~UC-10 真实读写后，
才有「点了有真实后端读写」的证据。截图证明的是形态与文案，不是端到端行为。
`chat-task-workbench-failure-restore-checkpoint`（恢复检查点）锚点按裁决 (c) **不存在**，e2e 不许 test.skip。
