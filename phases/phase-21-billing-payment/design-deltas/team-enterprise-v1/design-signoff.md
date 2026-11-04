---
status: confirmed
bundle: team-enterprise-v1
base_bundle: billing-credits
base_bundles: [billing-credits, billing-subscription, org-admin]
covers: []
confirmed_by: "本会话用户（明确授权回填）"
confirmed_at: "2026-11-02T03:30:01Z"
confirmed_via: "用户回复：确认整束设计，授权回填并分阶段实现；agent仅记录此次人工决定，未自行裁决。"
---

# Team / Enterprise 设计签核材料

Issue #6099。当前为后续阶段的设计交付，未认领运行时feature。商业输入见 `docs/superpowers/specs/2026-11-01-cn-us-pricing-design.md`。个人支付确认不代替本束；本束已完成源码0dca410445ac68f15bd06a3ec8339048e93283eb的独立设计一致性ACCEPT、完整材料及最终验证。用户于本会话明确回复确认整束设计并授权回填、分阶段实现，现据此记录人工签核。

> 2026-11-04 决策映射补充（issue #6228）：用户明确“组织没钱默认用自己个人账号额度”；本次仅将UI／T08／T11／API／领域描述对齐上述统一付款方规则。既有签核状态与2026-11-02确认历史保留，未重新裁决或激活旧epoch。

## ① UI

沿用已采用 `../../ui-preview/pricing-v1/README.md` 的组织账户、增员弹窗与平台Team列表。商业Team是organization，不是组织内teams分组；平台入口复用organizations目录。增量在 `../../ui-preview/team-contract-v1/README.md`：严格目录、quote、权益及已付历史进入原型，币种和价格不由另一份客户端规则决定；仍是模拟数据，无真实扣款或持久化。

真实接线将展示服务端报价、共同到期日、首期预计额度与到账实际值。初购容量不足须确认总席位/金额；成员减少不自动减费。永久充值不延长订阅，到期不再以Team钱包准入新AI，个人回退依[统一 credit 付款方规则](../../../../docs/superpowers/specs/2026-10-22-unified-credit-consumption-design.md#payer-resolution)；保留登录、资料和已准入工作完成。年付历史一笔付款一条，月额度发放不生成十二条付款记录。

Enterprise账户显示人工管理和实际余额，不虚构默认月额度、期限或下一笔扣款。平台列表可手动升级，添加额度严格限当前Enterprise，整数1至1,000,000且必填原因。升级处理中/失败保留真实现状；已发旧批次保留原到期事实。

## ② 用例

材料在 `usecases.md`、`domain.md`、`coverage.md`。基础5席/100,000月额度、增员每席15,000月额度、补差价同日到期、首期按剩余月窗折算以及管理员升级Enterprise沿用已确认口径。以下具体执行规则随本束一并经本次人工确认：

1. 每位实际组织成员占一席，四类orgRole均计入；纯项目来宾不产生组织成员关系时不计入。未核销邀请不占位，核销事务竞争容量；失败不消费邀请。初购须足够容纳现有人数，续费保留已购容量。待支付许可意图也约束所有成员入口，报价本身不占位；旧超席成员不移除。
2. 微信补价向上取最小货币单位；Stripe采用固定折算时刻的权威账单preview，不把未知调整混入本项。实际首期credit按付款时刻向下取0.01，最后极短窗口可以为0，未用当期额度到期清零。
3. Enterprise不新增默认自动月额度、自助账单或收费席位上限。已付Team基础和增员额度继续按原购买日发到原到期日，停止未来Team续费，不预发、退款或折抵；Enterprise额外额度仍由管理员手动添加。该业务口径已由用户在2026-11-02明确确认。停止未来Stripe扣款须有真实到期取消安排或已取消状态，不篡改标志、不丢旧付款事实；未完成不得声称升级成功。仅当前代际已生效Enterprise可手动加永久额度，Team使用已有购买额度入口。
4. 个人与组织付款、余额、customer、历史和恢复指针隔离。微信到期后手动购买新期限；连续Stripe续费沿用原购买锚点和已购增员数量。旧脏计费数据不迁移权益；本材料不执行生产清理或epoch切换。

Team开放销售前，全部成员入口容量门和真实PG小数累计前置必须先完成。当前total_granted仍integer；共享响应先保留0.01精度，数据库迁移及所有个人/Free/手动/Team授予读取路径仍待实现和反例验证，不能用Zod通过冒充PG已支持。

## ③ API

`api.md` 是拟议路径及约束，`packages/contracts/src/billing-team.ts` 为可执行schema单源。已物化严格购买/升级/手动额度输入、Team已付期限、四类quote、组织目录、组织权益/月授予、已付订阅历史及手动额度收据；原型实际消费这些结构与反例。个人目录形状和20,000月额度保持不变，组织目录采用独立作用域GET并复用同版市场/币种/充值商品约束。

已补齐完整支付恢复结果、平台摘要、升级操作结果、错误及 operations。身份/平台guards、原Plan版本/审计及组织钱包继续复用，不创建第二个Enterprise布尔值或权限体系。原型与schema不证明真实权限、cursor隔离、支付或事务已完成。

依据[契约设计执行书](../../../../.harness/instructions/contract-design.md)，响应/操作定义及原型消费现已补齐，当前修订的独立一致性复核及最终验证已完成，记录见design-coherence-review.md及evidence/design-gaps。各精确SHA Draft检查点ACCEPT只代表可保存草案，不是正式一致性结论。本次status仅依据上述用户明确授权回填，本材料不授权生产部署、epoch激活或旧账清理。

支付恢复材料已补齐TeamPurchaseOutcome及实际首期收据，增员预览已消费；平台摘要复用既有组织目录，Plan 类型为单源，升级使用 processing/needs_review/succeeded 操作与实际生效收据，错误沿用 code envelope；平台原型已消费严格摘要及模拟成功操作。首期实际月窗通过共享原个人UTC日历绑定paidAt，迟到账不换月窗恢复过期首期。原个人函数逐字共享、旧导入路径保留；此处不代表原型已具备真实guard或支付能力。
