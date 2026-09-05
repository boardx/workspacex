# UI 先行 · UC-17.8 研发闭环（反馈 → 设计 → 排期）

> 签核第 ① 件（UI）的取材记录。**这里是待确认清单，不是签核本身**——签核是人的动作，
> 在束级 `design-signoff.md` 第 ① 件完成，本目录不建 `ui.md`、截图不进 `ui-material-map.json`
> （束尚未切分，见 ADR-023）。截图由 `apps/web/scripts/shot-feedback-design-loop.mjs` 生成，
> 渲染的是**真组件** + 固定 seed（不写 localStorage），取材页 `/preview/feedback-design-loop`。

## 画了哪些屏 · 对应 R4 哪一节

| 屏 | 对应 R4 | 组件（真栈） | 截图前缀 |
|---|---|---|---|
| 快速反馈弹窗（改） | R4.1 | `components/feedback/feedback-dialog.tsx` | `dialog-*` |
| 反馈草稿（新） | R4.2 | `components/design-loop/drafts-screen.tsx` | `drafts-*` |
| 运营收件箱（新，列表+看板+drawer） | R4.3 | `components/design-loop/inbox-screen.tsx` | `inbox-*` |
| PM 设计工作台首页 + 新建弹窗 + 生成中过渡 | R4.4 | `components/design-loop/workbench-screen.tsx` | `workbench-*` |
| 设计详情全屏深色页 + 推送确认 + 推送成功页 | R4.4 | `components/design-loop/detail-screen.tsx` | `detail-*` |

跨页共享状态：~~`apps/web/lib/design-loop-store.tsx`~~（原型期的 React context + localStorage mock；UC-17.8 B6.1（2026-09-05）已删除——五屏全部真栈化，取材页数据由 `scripts/shot-feedback-design-loop.mjs` 的 `page.route` 拦截提供）。
平台后台落点：`/platform-admin/{feedback-drafts,inbox,design-workbench}` +
详情 `/platform-admin/design-workbench/<id>`（全屏，脱离三栏骨架）。

## 七态覆盖（每屏每态各一张）

- 收件箱七态齐全：`inbox-board-light/dark`（默认）、`inbox-empty`（空）、
  `inbox-loading`（加载）、`inbox-decline-invalid`（校验失败：转不做理由为空）、
  `inbox-depfailed`（依赖失败）、`inbox-denied`（无权限）、`inbox-success`（开始处理后成功横幅）。
- 另有交互态：`inbox-board-draghover`（看板拖放悬停高亮）、`inbox-drawer`（贴边 drawer）、`inbox-list`（列表视图）。
- 草稿：`drafts-default`、`drafts-empty`、`drafts-edit-drawer`、`drafts-refine`（继续完善浮层）。
- 工作台：`workbench-default`、`workbench-empty`、`workbench-new-dialog`、`workbench-new-invalid`（名称必填校验）。
- 详情：`detail-canvas`、`detail-spec`、`detail-push-confirm`、`detail-push-success`。
- 弹窗：`dialog-default`（缺陷字段集）、`dialog-req`（切到需求字段集）、`dialog-draft-saved`（存草稿回执）。

浅/深两态：每块屏至少一张浅一张深；设计详情按需求是深色 IDE，只出深色。

## 我替 UC 做了哪些它没写明的设计决定（请逐条看）

1. **状态色映射**：四态 → 语义 token（待处理 warning / 进行中 ai / 已完成 primary / 不做 neutral），
   GitHub 四态 → open=success 绿、draft=muted 灰、merged=ai 紫、closed=destructive 红。
   UC 只说了 GitHub 四色，四态状态色是我按现有 feedback-loop 语义分档补的。
2. **反馈类型 chip 与子类型**：R4.3 的类型 chip 是「全部/缺陷/需求/系统异常/设计方案」5 项；
   我把「缺陷/需求」合并成一个「反馈」chip（4 项：全部/反馈/系统异常/设计方案），
   因为缺陷/需求已在卡片上以类型标呈现，5 个 chip 会与状态子筛选挤在一行。**待确认是否要拆回 5 项。**
3. **结构化字段并入正文**：R4.1 要求缺陷 5 字段 / 需求 4 字段。现有弹窗（2026-09-02 决策）
   已去掉独立标题字段、标题从正文首句派生。我保留该决策：**没有单列标题字段**，
   结构化补充字段（缺陷 3 项 / 需求 3 项）填了会在提交时并进正文，留空则正文原样不动
   （保证既有 23 条采集侧测试全绿）。「复现步骤」= 主「详细说说」多行域，不另列多行控件。
   **这是与 R4.1 字面（含标题字段）最大的偏离，见下方矛盾①。**
4. **弹窗高度**：R4.1/R9 要求两 Tab 高度固定 `min(680px,88vh)`；现有弹窗容器是
   `h-[min(85vh,54rem)]` 且被 `tests/ui/feedback-dialog.test.tsx` 锁定断言。我**保留现有高度**，
   未改成 680px（改会破坏既有测试）。继续完善浮层用的是 `min(680px,88vh)`。**待确认以哪个为准。**
5. **附件放宽到 5 个任意文件**：客户端上限 4→5、accept `*/*`、到 5 个后上传入口**隐藏**（不是置灰）。
   ⚠ 现有契约 `submitFeedback.in.attachmentIds` 仍是 `.max(4)` 且上传只收图片 MIME——
   真提交 5 个会被后端拒。**本轮 UI 先行未动契约/后端，真栈化需同步放宽契约。**
6. **视觉禁用用 token 而非 opacity 0.45**：R4.1 写「opacity 0.45」，但 `uiux-standards` U1.1
   禁止 `disabled:opacity-*`。我用 Button 的 `disabled:bg-disabled` token 表达禁用。**按规范单源处理。**
7. **收件箱列表「数量/时间」列**：系统异常显示「N 次 · M 人」，其余显示日期——UC 只说列名，具体口径我定的。
8. **详情深色 IDE**：用 `.dark` 强制现有深色 token 体系（不另立颜色），全屏脱离 AppShell。
9. **存草稿 / 工作台链接的可见条件**（2026-09-04 D5 裁决；2026-09-05 B6.1 收口）：
   「存为草稿」走真 API（`createFeedbackDraft`）；「去 PM 设计工作台」链接是**纯路由跳转**
   （`/platform-admin/design-workbench`）、恒可见——原型 mock store 及其 Provider 已随 B6.1
   整个删除，`AppShell` 不再挂任何原型 Provider。

## R8 / R4 线索之间的矛盾与我的处理

- **矛盾①（标题字段）**：R4.1 字段集列了「标题」，但仓内 2026-09-02 决策已删独立标题字段、
  从正文派生，且有测试 `⑤ …没有单独的标题框` 锁定。→ 我沿用既有决策（无标题字段），
  结构化字段并入正文。**需人类裁决：要不要为 17.8 重新引入标题字段（并重写采集侧测试）。**
- **矛盾②（弹窗高度）**：R4.1「min(680px,88vh)」 vs 既有 `h-[min(85vh,54rem)]`（测试锁定）。
  → 保留既有，见设计决定 4。
- **矛盾③（现有后台是替换还是并存）**：R8 明写「[待确认] 是替换还是并存」。
  → 我**没有动** `feedback-screen.tsx` 与 `/platform-admin/feedback`（反馈与迭代仍在），
  新增三个平级模块并存。**需人类裁决：新收件箱上线后，旧「反馈与迭代」是下线、重定向、还是保留。**
- **矛盾④（GitHub 模拟 vs 真栈）**：R4.3 说 GitHub 随机编号模拟，R1 又说 [现状] 已真建 Issue 不退回模拟。
  → 原型里用固定编号展示徽标，未接真 `triageFeedback`。真栈化时接现有真链路。

## 建议人类在束级 design-signoff.md 第 ① 件签核时重点核对的 3 处

1. **结构化字段 vs 派生标题（矛盾①）**——这是与 R4.1 字面偏离最大处，直接影响采集侧测试基线，
   要先定：17.8 是否重新引入独立标题字段。看 `dialog-default-light.png` / `dialog-req-light.png`。
2. **新收件箱与旧「反馈与迭代」的关系（矛盾③）**——四态看板是否替换现有三 tab 列表。
   看 `inbox-board-light.png` 对比 `/platform-admin/feedback` 现状。
3. **异常态是否达标**——看板七态是否都可用、可读、文案是否给了可行动指引（尤其
   `inbox-decline-invalid`、`inbox-depfailed`、`inbox-denied`、`inbox-empty`）。旧原型是 happy-path
   零异常态，本轮补齐的正是这块，签核时逐张核对。

## 自检结果

- `pnpm --filter web run typecheck`：通过。
- `pnpm --filter web run lint`（含 `lint-design.sh`）：通过（0 warning，设计 token 无硬编码）。
- `pnpm run lint:nav-reachability`：通过。
- `pnpm --filter web run test`：通过（新增 `tests/ui/design-loop.test.tsx` 5 条；既有采集侧 23 条全绿）。
- 每个可交互元素带 `data-testid`（kebab、无业务数据）。
