---
status: pending
bundle: personal-pricing-v1
base_bundles: [billing-credits, billing-subscription]
covers: []
---

# 个人支付设计增量签核材料

本文件为待签核材料，agent 不修改人工签核状态。Issue #6088；原 UI PR #6087。covers 暂为空，本 issue 为设计交付，尚未认领运行时 feature，不借旧 confirmed 状态放行。

## ① UI

用户于 2026-11-01 本会话明确选择“采用这版 UI，继续分阶段实现”。界面及截图索引：`../../ui-preview/pricing-v1/README.md`。补充决定也已确认：Free 赠送到账后 30 天到期，Team 增员首期按剩余月度周期折算。

## ② 用例

待核对 `usecases.md` 的 PC1–PC9，尤其年度逐月发放、旧订单兼容、超时／重复支付和新用户 30 天赠送。业务规则来自已确认设计，技术恢复处理见 `domain.md`。

## ③ API

待核对 `packages/contracts/src/billing-pricing.ts` 与 `api.md`：服务端版本化目录、只提交 SKU 的幂等 Checkout、付款周期与额度周期分离、单钱包下的 Free 到期批次。

支撑材料：`domain.md`、`coverage.md`。未签核前只交付 schema／材料及测试，不连接支付运行时、不迁移生产数据。
