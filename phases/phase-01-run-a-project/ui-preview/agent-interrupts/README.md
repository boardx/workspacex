# agent-interrupts 契约束（三种新 HITL 中断）UI 先行原型 · 三屏 × 七态

ADR-023 签核第 ① 件（UI）材料。截图由 `apps/web/scripts/shot-agent-interrupts.mjs`
从预览路由 `/preview/agent-interrupts` 抓取（纯 mock，不接后端，零 console error；
仅有的日志异常是离线环境 Google Fonts 的 AbortError，脚本已 abort 字体请求，无关渲染）。

- 组件：`apps/web/components/agent-interrupts/{confirm-intent,fill-params,choose-option}-card.tsx`
  + 共用外壳 `interrupt-card-shell.tsx`
- mock：`apps/web/lib/mock/agent-interrupts.ts`（形状逐字对齐 `contracts/agent-interrupts/domain.md`
  的 ParamField / OptionCard / ConfirmIntentArgs）
- 预览路由：`apps/web/app/preview/agent-interrupts/page.tsx`
- 七态承载：复用全站共享 `components/state/state-shell.tsx`（**不各屏自造异常态**——
  新屏一律经它渲染，规避「已有原型零异常态」的老缺陷）
- 落点：三张卡都是**对话流内的一条特殊消息卡**（宿主屏归 `chat` 束，本束**不新建路由**，
  与 `agent-runtime` X-9「批准卡本体归 chat 束」的既有关系一致）。预览页只是把这条卡
  单独铺出来供逐屏签核。

## 三屏 ↔ ui.md 对应

| 截图 | 屏 | 对应 ui.md / UC | 覆盖 |
|---|---|---|---|
| `uc-1-confirm-intent-*.png` | 屏一 目标复述卡 | ui.md「屏一」/ UC-1 | 理解文本 + 3 条假设（≥2，I-2）；「继续」(approve)/「改假设」(edit)；I-1 门控可视化条 |
| `uc-1-confirm-intent-edit.png` | 屏一 编辑态 | ui.md「屏一」改假设分支 | 每条假设变可编辑文本框 + 增删；「用新假设继续」= 用新假设重新确认一次（UC-1 edit） |
| `uc-1-confirm-intent-observer.png` | 屏一 观察者视角 | UC-1 err NO_WRITE_ROLE | 视角切换器切到「观察者」→ 决策接口不可用，落 denied 态（R5 委托 chat UC-0） |
| `uc-2-fill-params-*.png` | 屏二 参数补全表单 | ui.md「屏二」/ UC-2 | 5 字段；AI 猜的 4 个字段单独高亮 + 依据文案（I-3）；required 无猜测项(抄送对象)无高亮 |
| `uc-2-fill-params-invalid.png` | 屏二 校验失败态 | UC-2 FIELD_REQUIRED_BLANK | 「抄送对象」必填未填 → destructive 边框 + 错误横条 |
| `uc-2-fill-params-success.png` | 屏二 成功态 | UC-2 appliedTo | 成功文案随 appliedTo 切换（full-rerun / ledger-only 两态，见 domain 缺口 AI-1 的降级） |
| `uc-3-choose-option-*.png` | 屏三 多方案对比 | ui.md「屏三」/ UC-3 | 3 张等宽卡，固定三行对照 见效/投入/预计收益（顺序 = domain 字段序）；「都不要」(reject) |
| `uc-3-choose-option-two.png` | 屏三 2 张态 | domain I-5（options ∈ [2,3]） | 2 张等宽（下限） |
| `uc-3-choose-option-selected.png` | 屏三 选中过渡态 | UC-3「选中即 resume」 | 点选整卡即选中（黑描边 + 勾标），无二次确认；resume 载荷用 optionId（I-6） |

**七态齐全**：每屏 default / loading / empty / invalid / dep-failed / denied / success 各一张
（见文件名后缀），加屏专属变体（edit / observer / two / selected）共 25 张。
自检：本目录 25 张 png，`ui.md` 引用 25 张。

## 我替 UC / ui.md 做的设计决定（人类签核第 ① 件时请逐条看）

1. **⚠ 最重要：AI 猜测字段的高亮改走「中性强调」，不用彩色**（uc-2 全系列）。
   ui.md「屏二」早稿写「视觉与 chat 束 `MessageBadge` 同一套 token」——而 `MessageBadge`
   用的是 `--ai`/`--ai-tint`（靛紫 #4B3BE8「AI 在场色」）。本轮**人类导入的新 UX 重设计**
   要求「黑白灰为主，唯一彩色是 `--danger`」。两者直接冲突。我按**更新的那条（新重设计）**
   落地：AI 字段用 `border-l-2 border-background-foreground/40 + bg-muted` 左描边浅底
   + `Badge tone="outline"`（中性）+「依据：…」文案。**这满足 ui.md 的本意「不新起一套
   颜色语言」（我一套颜色都没加），也满足新重设计。但它与 ui.md 字面「用 ai-tint token」
   不符**——请人类拍：AI 高亮到底要不要保留靛紫「AI 在场色」，还是随新重设计彻底去色。
2. **卡片主 CTA 用纯黑实心（`background-foreground`），不用 `variant="primary"`**（全系列）。
   原因同上：本仓 `--primary` 是青绿 #0C8371（会违反「唯一彩色 danger」）。参考的
   `SendEmailApprovalDialog` 其「批准并继续」也不是 primary（是默认 secondary）。我选纯黑实心
   而非 secondary 灰，是为了在黑白灰体系里给主动作足够层级。**这是设计取舍，请核。**
3. **choose_option 的「都不要」逃生口（reject）默认渲染出来**（uc-3）。ui.md「屏三」把它
   列为「是否渲染由签核时人类决定」的待确认项——我**先画出来**供人类看到形态（红字 outline，
   与 `--danger` 语义一致），但**渲染与否最终由签核裁定**，`showDecline` 是一个开关，
   人类说不要就传 false。请拍：留还是去。
4. **fill_params 的 `appliedTo` 做成一个显式的二选一分段控件**（uc-2，改动任一字段后出现）。
   ui.md 只说「底部提示行 ledger-only 时显示某文案」，没说怎么让用户**选** full-rerun / ledger-only。
   我把它显式化成「立即重跑受影响步骤 / 只记账，完成后生效」两个按钮，选 ledger-only 时才出提示行。
   这是我替 UC-2 补的交互，ui.md 未规定，请核。
5. **视角切换器只放 chat UC-0 的四角色**（引导师/组长/组员/观察者）。UC 的 R5 委托 chat UC-0，
   没有单列本束的角色枚举——我沿用项目工作台既有的四视角（与已确认原型一致），观察者恒无写权 → denied。
6. **AI 以「线程里的同事」在场**：三卡共用外壳带一个中性机器人头像 + 一句摘要标题，
   对应「AI 四种在场方式」里的「线程里的同事」，不另起风格。
7. **异常态复用共享 StateShell**：其成功态的绿勾、依赖失败态的琥珀色是**全站既有七态规范**
   （web-kernel 契约束 G-1），不是本束新增配色。若严格按「唯一彩色 danger」，这两处系统级配色
   要不要一起收敛，超出本束范围，如实标注、不擅自改共享组件。

## R8 线索之间的矛盾与处理

- **矛盾一（已在上面第 1、2 条展开）**：ui.md 早稿「AI 徽标用 ai-tint token」「视觉同 MessageBadge」
  ↔ 新重设计「唯一彩色 danger」。处理：按新重设计去色，标为待人类确认。
- **矛盾二**：ui.md「屏三」说「选中即 resume（不设二次确认）」，同时又留了「都不要」逃生口。
  这两者不冲突——逃生口是 reject 分支（主动放弃），选中是 edit 分支（选定即走），我都画了；
  但要注意「选中即 resume」意味着**点卡本身就是终态动作**，没有「选了再点确认」这一步，
  截图 `selected` 态展示的是「已选中、可改选」的**过渡**（真实交互里选中会立刻 resume 关卡）。
  请人类确认这个「无确认」的强度是否可接受（危险动作纪律：这不属于删除/发布/外发，只是选路线）。

## 建议人类在束级 design-signoff.md 第 ① 件签核时重点核对的 3 处

1. **AI 高亮的颜色决定（设计决定 #1）**——去色（现状）还是保留靛紫「AI 在场色」。
   这是三屏里唯一与 ui.md 字面不一致的地方，签了就定。
2. **choose_option「都不要」逃生口留/去（设计决定 #3）**——ui.md 明确把这条踢给人类拍。
3. **fill_params `appliedTo` 二选一控件的措辞与默认值（设计决定 #4）**——「立即重跑受影响步骤」
   这句话如实反映了 domain 缺口 AI-1 的降级（其实是 full-rerun，不是「精确子集」），
   措辞不能让用户误以为只重跑了受影响子集。

## 未接后端（如实声明）

本束是 UI 先行原型，所有按钮**当前不接后端**（mock）。verification 阶段接 UC-1~UC-3 的真实
resume 载荷（approve / edit / `{selectedOptionId}`）后，才有端到端行为证据。截图证明的是
**形态、状态覆盖与文案**，不是端到端行为。所有可交互元素与关键展示区已挂 `data-testid`
（前缀 `agent-interrupt-{confirm-intent,fill-params,choose-option}-*`），供 verification 锚定——
这是本原型与「已有原型零 testid」最重要的差别。
