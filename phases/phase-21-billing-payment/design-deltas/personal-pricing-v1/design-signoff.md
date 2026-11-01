---
status: confirmed
bundle: personal-pricing-v1
base_bundles: [billing-credits, billing-subscription]
covers: []
confirmed_by: "本会话用户（明确授权回填）"
confirmed_at: "2026-11-01T14:01:25Z"
confirmed_via: "用户在本会话明确回复：确认修订设计，授权回填并继续实现；agent 仅据此次人工授权记录，不自行裁决。"
---

# 个人支付设计增量签核材料

本文件记录人工确认。用户于本会话明确授权回填本文件签核状态；此前不得自行修改的规则，按本次直接授权执行。Issue #6088；原 UI PR #6087。covers 暂为空，本 issue 为设计交付，尚未认领运行时 feature，不借旧 confirmed 状态放行。

## ① UI

用户于 2026-11-01 本会话明确选择“采用这版 UI，继续分阶段实现”。界面及截图索引：`../../ui-preview/pricing-v1/README.md`。补充决定也已确认：Free 赠送到账后 30 天到期，Team 增员首期按剩余月度周期折算。

## ② 用例

已确认 `usecases.md` 的 PC1–PC9，尤其年度逐月发放、旧计费脏数据全量重置、超时／重复支付和新用户 30 天赠送。业务规则来自已确认设计，技术恢复处理见 `domain.md`。

## ③ API

已确认 `packages/contracts/src/billing-pricing.ts` 与 `api.md`：服务端版本化目录、只提交 SKU 的幂等 Checkout、付款周期与额度周期分离、单钱包下的 Free 到期批次。

支撑材料：`domain.md`、`coverage.md`。本次用例／API 人工确认已完成，可以逐项进入运行时实现；本文件不表示真实支付、数据重置或发布已经完成。

## 最新数据裁决

用户于 2026-11-01 明确说明旧计费数据全部为脏数据，并选择“全部旧计费数据都清空，包括订单、订阅、余额和流水”。本增量已取消旧权益／订单兼容要求；仅新系统订单需要不可变快照。清理实施仍按环境清单、版本屏障与发布窗口执行，不清用户／组织业务资料。
