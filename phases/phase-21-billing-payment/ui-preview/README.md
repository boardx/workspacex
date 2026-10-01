# Phase-21 billing-payment — UI 先行原型（ADR-023 签核第 ① 件材料）

> 纯前端 + mock，不接后端、不发明后端契约（ui-prototyper 硬规则 ③）。
> 签核状态由**人类**在各束 `contracts/<束>/design-signoff.md` 改，agent 不动 status（硬规则 ①）。
> 本阶段尚未切束（无 `contracts/` 目录），故先只产出本 README + 截图 + apps/web 组件，
> 束划分与束级 ui.md 由契约设计阶段定。
>
> 预览入口：`apps/web/app/preview/billing/page.tsx`
> 起服务：`cd apps/web && npx next dev -p 3210`，访问 `/preview/billing`。
> query：`screen=cashier|subscription|admin|org-billing|menu`、
> `state=default|loading|empty|invalid|depfail|denied|success`（七态）、
> `stage=default|pending|success|expired|failed`（收银台订单态）、
> `subject=personal|org`、`role=user|org-admin|platform-admin`、
> `sub=free|active|trialing|canceled|syncing`、`billing=on|off`、`grant=idle|confirm|done`。
> 顶部调试面板可切屏 / 切态 / 切订单态 / 切主体 / 切视角（视角是**预览手段**，不是权限实现）。
> 截图脚本：`cd apps/web && node scripts/shot-billing.mjs`（全量 31 张，重跑即覆盖）。

## 屏 ↔ UC ↔ 截图 ↔ 组件

| 屏 | UC / R8 出处 | 截图（本目录） | 组件 |
|---|---|---|---|
| 收银台弹窗（个人主体） | `requirements/01-credits-topup.md` R3/R4/R8 | `01-cashier-*.png`（11 张） | `components/billing/cashier-dialog.tsx` + `qr-panel.tsx` |
| 收银台弹窗（组织主体） | 01 R2/R5/E7 | `01-cashier-org-pending.png`、`01-cashier-denied.png` | 同上（subject=org） |
| 订阅升级 / 管理弹窗 | `requirements/03-subscription-stripe.md` R3/R4/R8 | `03-subscription-*.png`（7 张） | `components/billing/subscription-dialog.tsx` |
| 计费管理端（平台管理员） | `requirements/04-billing-admin.md` R3/R8 | `04-admin-*.png`（8 张） | `components/billing/admin-console.tsx` |
| 组织计费区块（组织 admin） | 04 R3.4/R5 | `04-org-billing-*.png`（3 张） | `components/billing/org-billing-section.tsx` |
| 用户菜单入口 | 01 R8 / 03 R8 | `menu-entries-*.png`（2 张） | `components/billing/menu-entries-preview.tsx` |
| 订单生命周期（02 无独立界面） | `requirements/02-payment-order-notify.md` R8 | 经收银台订单五态呈现（pending/success/expired/failed） | 同上 |

## 七态覆盖说明（硬规则 ⑤）

- **收银台**：default=套餐+未下单；loading=套餐骨架屏；empty=无套餐空态（不编造套餐，01 R3.1）；
  invalid=E1 渠道未配置（PAYMENT_PROVIDER_NOT_CONFIGURED，入口明确报错、不展示假二维码）；
  depfail=E2 微信下单失败（可重试、无假二维码）；denied=E7 组织主体权限不足（整窗替换为权限说明）；
  success=支付成功。订单五态由 `stage` 控制：pending（二维码+倒计时+刷新）/ success / expired（遮罩+重新生成）/ failed（destructive+原因+重新生成）。
- **订阅弹窗**：default=free（升级）/success 等订阅形态由 `sub` 变体控制（free/active/trialing/canceled/syncing）；
  loading=骨架；invalid=E1 未配置；depfail=支付链接获取失败；denied=未登录。
- **计费管理端**：default=钱包卡+流水表+发放表单；loading=骨架；empty=流水空态；
  invalid=发放表单校验失败（额度≤0/缺原因）；depfail=流水查询失败；denied=非平台角色 403 投影；
  success=发放完成回显（`grant=done`）；发放二次确认= `grant=confirm`（硬规则 ⑦）。
- **组织计费区块**：default=钱包+开关开+购买入口；`billing=off`=开关关（新购买入口禁用、
  已购余额仍可见，04 R3.4）；denied=普通成员（入口不可见，04 R5）。
- **用户菜单入口**：free=「升级订阅」；active=「我的订阅」+ Pro 徽标（03 R8 计划标识）。

## 我替 UC 做了哪些它没写明的设计决定（人类请逐条看）

1. **收银台双栏布局与比例**：左列（套餐 3 列卡 + 支付方式 + 主按钮，1fr）+ 右列（二维码面板 260px）。
   UC 只列区域清单未定布局。参考实现是「左套餐右二维码」，沿用其骨架但换成本仓 token。
2. **二维码时刻是视觉重心**（frontend-design 的"大胆花在一处"）：二维码本地 canvas 渲染
   （`qrcode` 包已在依赖里，01 R3.4 不依赖图床）；订单号 / 金额 / 倒计时全用 `font-mono`
   ——它们是机器标识符；待支付态显示**每秒跳动的 15 分钟倒计时**（14:32 格式），让订单
   生命周期本身可见。UC 只要求"有效期 15 分钟"，倒计时形态是我定的。
3. **订单五态语义区分（过期 ≠ 错误）**：pending=中性横幅+倒计时；success=实心 success 横幅
   +「本次到账 +1320」；expired=warning-tint 横幅 + 二维码遮罩「已过期，请重新生成」；
   failed=destructive 横幅 + 用户可读失败原因（02 R5：用户可见用户可读的失败原因）。
   遮罩盖住死码，防止误扫。
4. **支付宝置灰而非隐藏**：01 R3.2 说「不展示或置灰不可点」，我选置灰+「未开通」文案——
   用户能看到渠道存在但不可用，比静默消失更能解释「为什么只有微信」。
5. **套餐卡赠予呈现**：赠送额度徽章（success 调）+ 赠送率小字 + 底行「合计 N 额度」；
   参考实现只有一行绿色小字，我补了合计行让「基础+赠送=合计」一眼可算（01 R3.1 要求展示合计）。
6. **收银台内嵌最近流水**：5 行紧凑列表（类型/说明+来源/数量），沿用参考实现的
   "收银台可查最近记录"心智；完整列表在管理端/流水入口（本阶段无独立订单列表页，01 R6）。
7. **人工发放的二次确认形态（硬规则 ⑦）**：内联确认弹窗，列出主体/额度/原因/发放后余额
   四项影响，按钮「再想想 / 确认发放」。UC 只要求原因必填，确认弹窗的形态是我定的。
8. **组织计费开关的关闭后果可视**：关闭后开关旁出现 warning-tint 说明条 + 购买按钮禁用，
   并写明「已购余额不受影响」（04 R3.4）。开关用本仓 Toggle 原语（token 对表达开/关）。
9. **订阅取消的生效时点（03 E5）**：canceled 变体显示两条时点信息——正文「将于 X 到期，
   到期前可继续使用」+ 浅色提示条「取消在周期结束时生效：X 后回到免费版，期间不会再次扣款」。
   syncing 变体（E2 回跳后同步中）显示「同步中，稍后自动更新；若刚完成支付，请勿重复购买」，
   **绝不把已订阅显示为免费**。
10. **菜单入口为原型投影**：没改生产 `components/shell/personal-menu.tsx`（硬约束：
    不改生产页面行为），做了一份带新菜单项的投影组件，生产落地时把两个 MenuItem 接入真菜单。
11. **AI 额度不足引导入口不新造**（01 R8：若现有产品没有对应事件位则不新造）——本阶段未画，
    待契约设计确认现有产品是否有对应事件位。
12. **预览视角收敛为三档**：普通用户 / 组织管理员 / 平台管理员（对应 01/04 的 R5 角色集合；
    02 的外部系统与运维不投屏）。

## R8 线索之间的矛盾与处理

- **01 与 04 的「组织购买入口」归属**：01 R8 说入口在「组织管理页」，04 R8 说构成含
  「组织计费开关」。我合并为一个「组织计费区块」（组织管理页内的设置区块）：钱包 + 购买入口
  + 开关 + 流水。生产挂载点（org-admin 哪个子页）由契约设计定，预览用独立原型屏说明。
- **04 的「手工发额度」与「组织开关」权限主体不同**：发放仅平台管理员（04 R5）、开关仅
  组织 owner/admin（04 R3.4）——两个动作不能同屏同权，故分屏：发放进平台管理端、
  开关进组织计费区块。这是我对 R8「构成」列表的拆分，请确认。
- **02 无独立界面但 R8 要求运维可见**：订单可观察字段目前只在收银台（订单号/状态/金额/
  倒计时）呈现；运维侧「结构化日志可检索」是后端最低要求，未在 UI 投屏（避免发明管理端
  订单查询页）。
- **参考实现的 `REFUNDED` 状态**：需求明确不引入（02 R6），界面无退款态。
- **`01-cashier-success` 与 `state=success`/`stage=success` 重叠**：两处是同一呈现
  （订单成功视图），不重复截图。

## 待确认清单（签核前请人类确认）

- [ ] 收银台双栏（左 1fr 右 260px）与套餐 3 列布局是否符合预期；弹窗宽度 max-w-2xl 是否够用。
- [ ] 支付宝「置灰+未开通」文案 vs 完全隐藏（01 R3.2 二选一，我选了置灰）。
- [ ] 倒计时每秒跳动是否有必要（我做了：订单生命周期可见）；还是静态"有效期至 HH:MM"更安静。
- [ ] 发放二次确认用弹窗形态是否可接受（对比内联抽屉）；「再想想」按钮文案是否合适。
- [ ] 组织计费区块的挂载点（org-admin 哪个子页）由契约设计定，本原型独立成屏。
- [ ] 管理端流水分页 5 条/页是否合适（mock 共 9 条，两页）。
- [ ] 个人订阅价格 ¥49/月 是 mock 占位值，真实价格以 Stripe 侧配置为准，请确认签核时
      不把 mock 价格当契约。
- [ ] 未产出独立截图的态：收银台 denied 的个人主体文案（未登录）、订阅 depfail、
      org-billing loading/depfail 截图中未逐张列（组件已实现，截图按需补）。
- [ ] 束划分后，需把本 README 的屏↔束映射补进束级 `contracts/<束>/ui.md`（本阶段我
      不发明束划分，见 ui-prototyper SKILL）。

## 建议在束级 design-signoff.md 第 ① 件签核时重点核对的 3 处

1. **状态真实性（硬规则 ⑤）**：`01-cashier-expired.png` 必须是「warning-tint + 重新生成」
   而非错误红；`01-cashier-failed.png` 必须是 destructive + 用户可读原因 + 重试；
   `01-cashier-notconfigured.png` 必须**没有**二维码（E1 不得展示永远扫不成功的码）。
   三张图对照看。
2. **资金动作显式（硬规则 ⑦）**：`04-admin-grant-confirm.png` 的确认弹窗是否把
   「主体 / 额度 / 原因 / 发放后余额」四项影响讲清楚，且默认按钮不是「确认」（本实现
   「再想想」为 outline、「确认发放」为 primary——如需更保守请指出）。
3. **权限投影（R5）**：`01-cashier-denied.png`（普通成员组织购买被拒）、
   `04-admin-denied.png`（非平台角色看不到管理端）、`04-org-billing-member.png`
   （普通成员看不到组织计费区块）三张图对照，确认入口隐藏与拒绝语义符合 01/04 R5。
