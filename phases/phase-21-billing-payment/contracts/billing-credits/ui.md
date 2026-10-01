# 契约束 `billing-credits` — ① UI（签核面第 ① 件）

> **自检：本文件引用 24 张截图，目录下实际 24 张。** 截图目录：`ui-preview/billing-credits/`。
> （其中 `menu-entries-free.png` / `menu-entries-subscribed.png` 是两束共用的入口证据，各持一份副本；原图保留在同级 `ui-preview/` 下。）

依据：`requirements/01-credits-topup.md` R8、`02-payment-order-notify.md` R8、`04-billing-admin.md` R8 与各文件 R12。
覆盖 feature 的权威在 `design-signoff.md` frontmatter `covers:`。
数据形状来自 `packages/contracts/src/billing-credits.ts` 的 `billingCredits.*`；原型 mock（`apps/web/lib/mock/billing.ts`）是**界面投影**，实现期按 ADR-020 单源收敛为从契约生成。

## 一、界面落点

| 层级 | 路由 / 组件 | 目的 | 契约操作 |
|---|---|---|---|
| 预览宿主 | `/preview/billing`（`apps/web/app/preview/billing/page.tsx` + `components/billing/billing-preview.tsx`） | 签核材料载体；调试条切换 屏 / 七态 / 订单态 / 主体 / 视角 | —（仅原型，实现期并入真实入口） |
| 收银台 | `components/billing/cashier-dialog.tsx` + `qr-panel.tsx`（个人 / 组织双主体） | 套餐选择 → 生成二维码 → 轮询 → 终态；待支付态每秒刷新倒计时 | `getBillingConfig`、`listPackages`、`createPaymentOrder`、`getPaymentOrder`、`getWallet` |
| 计费管理端 | `components/billing/admin-console.tsx` | 钱包卡 + 流水分页表 + 发放表单 + 二次确认 | `adminGetWallet`、`adminGrantCredits`、`listTransactions` |
| 组织计费区块 | `components/billing/org-billing-section.tsx` | 组织钱包 + 购买入口 + 计费开关 | `getWallet`、`getOrgBillingSetting`、`updateOrgBillingSetting`、`createPaymentOrder` |
| 用户菜单入口投影 | `components/billing/menu-entries-preview.tsx` | 「购买额度」入口与余额（订阅入口见 `billing-subscription` 束） | `getBillingConfig`、`getWallet` |

> 实现期落点（本束提案）：用户菜单「购买额度」→ 收银台；组织管理页「组织计费」区块；平台后台「计费管理」。
> 落地时须同步 `apps/web/lib/navigation.ts` 与 nav-reachability 配置（contract-design.md「物化③连带门」第 1–3 条）。

## 二、稳定 `data-testid`（实现时须存在；均取自已交付原型组件）

| 区域 | `data-testid` | 判据 |
|---|---|---|
| 收银台根 | `billing-cashier-dialog` | `enabledProviders` 为空时此入口不可达（不渲染假二维码） |
| 套餐 / 支付方式 | `billing-provider-wechat`、`billing-provider-alipay` | 支付宝置灰且不可点（未开通） |
| 生成按钮 | `billing-generate-qr` | 提交后进入待支付态；失败可重试（无"假二维码"订单） |
| 二维码区 | `billing-qr-code-area`、`billing-qr-placeholder` | 二维码本地 canvas 渲染；过期/失败态一律遮罩（防误扫） |
| 订单信息 | `billing-order-no`、`billing-order-status`、`billing-order-countdown` | 订单号 / 状态 / 每秒倒计时（mono） |
| 刷新 | `billing-refresh-status`、`billing-refresh-hint`、`billing-regenerate` | 轮询失败不误报；过期后可重新生成 |
| 成功 | `billing-success-badge`、`billing-order-credited` | 成功徽标 + 到账额度展示 |
| 余额 / 流水 | `billing-cashier-balance`、`billing-wallet-card`、`billing-wallet-balance`、`billing-recent-ledger`、`billing-view-all-ledger`、`billing-ledger-table`、`billing-ledger-empty` | 钱包与流水区（空态不编造） |
| 权限（收银台） | `billing-cashier-denied` | 组织主体非 owner/admin：整窗替换权限说明，不泄露余额/流水 |
| 管理端 | `billing-admin-host`、`billing-admin-subject`、`billing-admin-denied` | 发放与查询都有主体与权限态 |
| 发放表单 | `billing-grant-subject`、`billing-grant-amount`、`billing-grant-reason`、`billing-grant-submit`、`billing-err-grant-amount`、`billing-err-grant-reason` | 额度必须为正整数、原因必填 |
| 发放确认 | `billing-grant-confirm-dialog`、`billing-grant-confirm-ok`、`billing-grant-confirm-cancel`、`billing-grant-saved` | 二次确认列四项影响；成功提示 |
| 组织计费区块 | `billing-org-host`、`billing-org-wallet`、`billing-org-balance`、`billing-org-ledger`、`billing-org-billing-toggle`、`billing-org-billing-off-note`、`billing-org-purchase-btn`、`billing-org-denied`、`billing-org-toggle-saved` | 开关关闭：购买禁用 + 说明条 + 已购余额仍可见；普通成员不可见 |
| 菜单入口 | `billing-menu-host`、`billing-menu`、`billing-menu-trigger`、`billing-menu-buy-credits`、`billing-menu-profile`、`billing-menu-brain` | 「购买额度」在个人菜单可达 |
| 重开入口（原型调试） | `billing-reopen-cashier` | 仅原型用，实现期删除 |

## 三、截图索引（24 张）

### 收银台（11 张）

| 截图 | 状态 | 说明 |
|---|---|---|
| ![default](../../ui-preview/billing-credits/01-cashier-default.png) | default | 未下单：套餐选中态 + 「生成二维码」可点 |
| ![pending](../../ui-preview/billing-credits/01-cashier-pending.png) | pending | 二维码 + 订单号 / 金额 / 15 分钟倒计时（mono）+ 刷新按钮 |
| ![success](../../ui-preview/billing-credits/01-cashier-success.png) | success | 到账成功：成功徽标 + 余额 / 流水随刷新更新 |
| ![expired](../../ui-preview/billing-credits/01-cashier-expired.png) | expired | 过期：warning 语义（**不是**错误红）+ 遮罩防误扫 + 重新生成 |
| ![failed](../../ui-preview/billing-credits/01-cashier-failed.png) | failed | 失败：destructive + 用户可读原因 + 重试 |
| ![empty](../../ui-preview/billing-credits/01-cashier-empty.png) | empty | 无可用套餐空态（不编造套餐） |
| ![loading](../../ui-preview/billing-credits/01-cashier-loading.png) | loading | 骨架屏 |
| ![notconfigured](../../ui-preview/billing-credits/01-cashier-notconfigured.png) | E1 未配置 | 渠道未配置：入口不可用，无假二维码 |
| ![create-failed](../../ui-preview/billing-credits/01-cashier-create-failed.png) | E2 下单失败 | 微信下单失败：可重试；不产生"待支付且有二维码"的假态 |
| ![org-pending](../../ui-preview/billing-credits/01-cashier-org-pending.png) | 组织主体 | 为组织购买的待支付态 |
| ![denied](../../ui-preview/billing-credits/01-cashier-denied.png) | E7 越权 | 普通成员：整窗权限说明，不泄露组织余额 / 流水 |

### 计费管理端（8 张）

| 截图 | 状态 | 说明 |
|---|---|---|
| ![default](../../ui-preview/billing-credits/04-admin-default.png) | default | 钱包卡 + 流水分页表 + 发放表单 |
| ![loading](../../ui-preview/billing-credits/04-admin-loading.png) | loading | 加载态 |
| ![empty](../../ui-preview/billing-credits/04-admin-empty.png) | empty | 流水空态 |
| ![grant-invalid](../../ui-preview/billing-credits/04-admin-grant-invalid.png) | 参数非法 | 额度 ≤0 / 缺原因的行内校验 |
| ![grant-confirm](../../ui-preview/billing-credits/04-admin-grant-confirm.png) | 二次确认 | 弹窗列四项影响：主体 / 额度 / 原因 / 发放后余额 |
| ![grant-success](../../ui-preview/billing-credits/04-admin-grant-success.png) | 发放成功 | 余额 12,480 → 13,280，流水新增一笔 grant |
| ![denied](../../ui-preview/billing-credits/04-admin-denied.png) | 越权 | 非平台角色：权限说明 |
| ![depfail](../../ui-preview/billing-credits/04-admin-depfail.png) | 依赖失败 | 后端不可用时的呈现（不编造数据） |

### 组织计费区块（3 张）

| 截图 | 状态 | 说明 |
|---|---|---|
| ![default](../../ui-preview/billing-credits/04-org-billing-default.png) | default | 组织钱包 + 购买入口 + 计费开关 |
| ![off](../../ui-preview/billing-credits/04-org-billing-off.png) | 开关关闭 | 新购买禁用 + 说明条；**已购余额仍可见**（只影响新建，I-12） |
| ![member](../../ui-preview/billing-credits/04-org-billing-member.png) | 普通成员 | 入口隐藏（R5） |

### 用户菜单入口（2 张，与 `billing-subscription` 束共用副本）

| 截图 | 状态 | 说明 |
|---|---|---|
| ![free](../../ui-preview/billing-credits/menu-entries-free.png) | 免费用户 | 「购买额度」入口（订阅升级入口见另一束 ui.md） |
| ![subscribed](../../ui-preview/billing-credits/menu-entries-subscribed.png) | 已订阅 | 入口展示（Pro 徽标与「我的订阅」的签核归 `billing-subscription` 束） |

## 四、说明（非缺口）

- 02 号需求声明本域**无独立界面**：订单可观察字段经收银台五态与上述组件呈现，不另造订单查询页。
- 「AI 额度不足引导入口」按 01-R8「没有对应事件位则不新造」**未绘制**，登记在 `ui-preview/README.md` 待确认清单。
- 组织购买入口在生产页面的挂载点为实现期决策（原型为独立屏），不影响本束材料完整性。
