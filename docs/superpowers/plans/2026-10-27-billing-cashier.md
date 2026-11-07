# 收银台布局与连续购买 Implementation Plan

**Goal:** 按用户提供的双栏参考图改善充值弹窗，已到账或正常关闭后可继续购买。

**Architecture:** 保留 `useCashierOrder` 作为订单状态权威；UI 常显套餐，活动订单期间锁定选择。显式开始下一次购买前中止旧订单读取，忽略晚到响应。

**Tech Stack:** React / Radix Dialog / Tailwind semantic tokens / Vitest / Playwright。

**Spec:** 用户 2026-10-27 两张截图与直接交办；GitHub #5945。

## 设计

宽屏：左侧三列两行套餐卡片，额度为主、价格在下；微信和不可用的支付宝渠道并排；主操作明确。右侧显示二维码或到账结果、订单号和刷新操作。余额与流水位于底部。窄屏为两列套餐与上下排版。使用现有字体、圆角、语义色，保留中文及真实 API 返回金额。

选择保留现有订单 hook 与 API，只重排当前收银台；重建整套收银台会重复已有权限/到账/重试边界，仅调 CSS 无法解决连续购买竞态。

## 约束

- 不改支付 API、金额计算、回调或服务端入账语义。
- PENDING / PROCESSING / FAILED / 需人工恢复的 CLOSED 不允许绕过旧订单创建新单。
- 不确定的 POST 继续禁止重试；普通 GET 可以被安全中止。
- 关闭并重开弹窗保留订单；必须显式开始下一次购买。
- 本次为直接交办的 ad-hoc 修复，不修改 feature passing 或设计签核状态。

## 执行与验证

- [x] 复用 worktree，fetch/ff main；init、readiness、dashboard、active-features。
- [x] 先添加延迟 GET 的 SUCCESS/CLOSED 回归测试与套餐常显测试，观察三项失败。
- [x] `use-cashier-order.ts` 仅对允许重购的结束状态 abort 旧 GET 后清理订单。
- [x] `live-cashier-dialog.tsx` / `live-qr-panel.tsx` / `cashier-ledger-history.tsx` 实现参考布局。
- [x] 45 项 cashier 测试及 web lint 通过。
- [x] Playwright 在 375/768/1280 宽度检查布局/真实 canvas/连续两单/旧 GET 晚到（1 passed，23.5s）。
- [x] 最终 typecheck、lint、80 项相关测试、独立代码审查。
- [ ] 提交 PR、跟进 CI。

环境边界：tick 因缺 COORD_GATEWAY_URL 无法连接协调平面；未创建假租约。浏览器使用受控 HTTP 支付数据，证据不表示真实微信商户支付已验收。
