# Phase 14 · agent-kernel-unification — UI 先行原型

ADR-003 / ADR-023 第 ① 件（UI）签核材料。用 `apps/web` 真实组件 + mock 数据做出、
可点可交互，非设计稿图片。生产环境这些单元落在 `/chat` 三栏骨架内（宿主屏归 chat 束），
本预览页只为逐屏签核把 8 个界面单元单独铺出来。

## 怎么看

```bash
cd apps/web && pnpm dev
# 打开 http://localhost:3000/preview/agent-kernel
# 顶部单元切换器切 8 个单元；部分单元有子状态切换（空态/重连中/系统暂停）
```

- 页面：`apps/web/app/preview/agent-kernel/page.tsx`
- 组件：`apps/web/components/agent-kernel/agent-kernel-units.tsx`
- mock：`apps/web/lib/mock/agent-kernel.ts`
- 设计 token 单源：`.harness/instructions/uiux-standards.md` + `app/globals.css`；
  `pnpm lint:design` 通过，无硬编码色值/像素/字号档位。

## 8 个界面单元 → 对应 UC 小节 → 覆盖状态 → 截图

| # | 单元 | 需求来源 | 触发 run 状态 | 截图 |
|---|------|----------|---------------|------|
| 1 | 计划确认卡片 | 03-plan-mode R3.2 / R8 | `awaiting_plan_confirmation` | `01-plan-confirmation-card.png` |
| 2 | 执行进度流（planningNote + L1 diff 展开） | 03-plan-mode R5 / 02-streaming R3 / R8 | `running` | `02-progress-stream.png` |
| 3 | 工具权限确认弹层（四选一：仅本次/本 run 内/以后都允许/拒绝） | 03-plan-mode R3.5 / R8 | `awaiting_tool_permission` | `03-tool-permission-card.png` |
| 4 | 中途插话入口（可交互 + 已收到反馈） | 04-artifacts-steering R3'.5 / R8 | `running` | `04-interjection-composer.png` |
| 5 | 产出物面板（版本历史 / 基于此继续） | 04-artifacts-steering R3 / R8 | 侧栏（run 内外均可见） | `05-artifacts-panel.png`、`05-artifacts-panel-empty.png` |
| 6 | 错误状态卡片（message + suggestedAction + 折叠详情） | 05-error-observability R3.5 / R8 | `failed` | `06-error-card.png` |
| 7 | 断线重连提示（轻量、自动消失） | 02-streaming R8 | `running`（传输层） | `07-reconnect-toast.png`、`07-reconnect-toast-reconnecting.png` |
| 8 | 暂停态（主动 vs 系统保护性） | 02-streaming R6 / E1 | `paused` | `08-paused-user.png`、`08-paused-system.png` |

### 七种状态说明（uiux-standards §0）
这批单元多数是 agent-run 生命周期里的**具体非终态屏**，本身就是「异常/等待态」的一等公民，
不套用通用列表页的七态模板。可切换/可见的状态覆盖：
- 加载：进度流用 running spinner 步骤 + Progress 表达；重连「重连中」子态。
- 空：`05` 产出物空态（`?state=empty`，data-testid="empty"）。
- 校验失败：`01` 计划删空前置步骤 → `err-plan` 提示（E2）；删空全部 → empty 态 + 确认按钮 disabled。
- 依赖失败：`06` 错误卡即模型/工具依赖失败的人性化呈现（MODEL_CALL_FAILED，非 SANDBOX 误标）。
- 无权限：本批单元均为 run 发起者本人视角；跨用户/审计 transcript 的 RBAC 属后端，UI 不投影（见「需人类澄清」）。
- 成功：`01` 确认后 saved 反馈、`03` 决策后 saved 反馈、`08` 恢复后 saved 反馈。

每个可交互元素与关键展示区都带 `data-testid`（`plan-confirm` / `perm-once|run|deny` /
`interjection-send` / `artifact-version-N` / `error-action-retry` 等），供 verification 锚定。

---

## 我替 UC 做了哪些它没写明的设计决定（请逐条核对）

1. **计划步骤上暴露 L0/L1/L2 风险徽标**（01/02）。R8 只说「结构化 todo 列表」，没说每步显示风险级。
   我在计划阶段就把每步的最高风险级标出来，让用户在确认前就知道哪几步以后会弹权限确认（第 5/6 步 L2）。
   这是我的推断，UC 只在 R5 定义了分级表、未要求前置展示。**若不想在计划阶段暴露分级，需去掉。**
2. **计划步骤用可编辑输入框 + 删除按钮，未做拖拽排序**。R3.2 说「可编辑/删除」，没提排序。
   我放了 GripVertical 图标暗示可拖拽但未实现排序交互——**要不要支持重排序请裁决**。
3. **计划编辑的 E2 校验用「前置依赖被删」为判据**给红字提示。UC 的 E2 只说「引入明显不合法内容」
   举例是「删除必要前置步骤」，没定义「必要」的判定规则。我用 mock 里的 `dependsOn` 关系模拟，
   真实判定属内核（R8 未定义前端判据）。**前端应做多重校验还是纯展示内核回传的错误，需澄清。**
4. **权限弹层做成就地卡片而非模态遮罩弹窗**。R8 用词「弹层」。我选了非阻断的就地卡片（进度流上方），
   与「运行中输入框保持可交互」的插话理念一致，避免遮罩把整个进度流盖住。**若要真模态请裁决。**
5. **四个权限按钮的视觉权重**：仅本次/本 run 内都用/以后都允许均为 outline（对等），拒绝用 destructive。
   UC 未指定哪个是默认高亮项。我刻意不把任何「允许」设成 primary，避免诱导点允许。**是否需要默认项？**
6. **错误卡三个 suggestedAction 全部常驻展示**（retry 为 primary，其余 outline）。R3.5 说「按钮」，
   未说是否全展示或按错误码筛选。我全展示并给每个加一句 hint。**某些错误码可能不该给「重试」，
   映射规则是后端契约（05 R6），前端此处按「全都有」渲染。**
7. **系统保护性暂停不提供直接「恢复」按钮**，只给「额度恢复后通知我 / 联系管理员」（08-system）。
   这是对 R8「区分主动暂停与保护性暂停」的强解读：保护性暂停若能一键恢复就失去保护意义。
   **是否允许用户强行恢复保护性暂停，需人类定夺。**
8. **产出物面板宽度用 `w-panel-alt`(316px)**，与既有右栏骨架同宽，暗示它就是右栏的一种内容。
   R8 只说「独立侧栏」。版本历史未做版本间 diff 可视化（04 R6 明确列为增强项，本 phase 不强制）。
9. **插话发送快捷键定为 ⌘/Ctrl+Enter**（避免与换行冲突），UC 未规定快捷键。

## R8 线索之间的矛盾 / 我怎么处理的

- **02-streaming R6 要求「每个非终态都有对应渲染分支」**，列了 `awaiting_approval` 与
  `awaiting_plan_confirmation`/`awaiting_tool_permission`/`paused`。其中 `awaiting_approval` 与
  03 的 `awaiting_tool_permission` 语义高度重叠但命名不同。我按 03 的命名做权限弹层，
  **`awaiting_approval` 是否为同一状态的旧名（应统一）请确认**——若是两种不同审批，UI 还缺一屏。
- **03 R8 说权限弹层含「本次 run 内都允许」，R5 授权粒度是「单次/本 run 内/组织默认」三档**，
  而 00-overview 明确「组织级默认策略后台不在本 phase」。**已解决**：补上第四个按钮「以后都允许」
  （`data-testid="perm-always"`）作为运行时触发入口——只做该决策档位在 UI 上的落点，不做组织级
  管理后台（后台仍不在本 phase 范围）。

## 建议人类在束级 design-signoff.md 第 ① 件重点核对的 3 处

1. **权限弹层的按钮档位**（上文矛盾第 2 条）：UI 侧已按四档（单次/本 run 内/以后都允许/拒绝）落地，
   仍需人类确认对应的后端授权存储枚举与 API 契约是否已按四档对齐——这是 UI/UC/API 三件必须一致的点，
   错了会级联到契约。
2. **计划阶段是否暴露 L0/L1/L2 风险徽标**（设计决定 1）：影响信息密度与用户心智，
   且决定 `plan_update` 事件是否需要携带每步的风险级字段（牵动 02-streaming 的事件 schema）。
3. **系统保护性暂停能否被用户强行恢复**（设计决定 7）：这是安全语义问题，
   UI 若给了恢复按钮就等于承认保护可被绕过，需人类明确取舍。

## 需人类澄清（需求线索本身模糊）

- **无权限态在这批单元里没有自然落点**。05 R5 / 06 R5 讲的是「他人 run 的 transcript 仅运维可见」，
  那是审计接口的 RBAC，属后端；面向 run 发起者本人的这 8 屏没有「无权限」变体。
  uiux-standards 七态要求「无权限」有截图——**本 phase 是否需要单独做一个「你无权查看此 run」的空屏？
  还是认定它不属于本批单元的职责？** 目前未画，等裁决。
- **重连持续失败的「请手动刷新」态**（02 E2）我只在文案里说明、未单独出屏。若需要作为独立可截图状态，请指出。
