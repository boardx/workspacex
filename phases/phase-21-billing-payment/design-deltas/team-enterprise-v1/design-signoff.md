---
status: pending
bundle: team-enterprise-v1
base_bundles: [billing-credits, billing-subscription, org-admin]
covers: []
---

# Team / Enterprise 设计签核材料

Issue #6099。这是后续阶段的设计交付，`covers` 未认领运行时 feature。商业规则来源为 `docs/superpowers/specs/2026-11-01-cn-us-pricing-design.md`；个人支付的签核不会自动覆盖本束。

## ① UI

沿用用户已采用的 `../../ui-preview/pricing-v1/README.md`：组织账户的共享余额、订阅期限、已用／已购席位和增员弹窗；平台 Team 列表的 Enterprise 标识、升级确认和添加额度弹窗。商业 Team 是 `organizations.kind=organization`，不是组织内 `teams` 分组；实际入口复用平台 organizations 目录。

真实接线补充文字：增员展示服务端报价及共同到期日，首期额度标为预计、到账后显示实际值；开通时席位不足须明确确认总席位及总价。平台添加额度注明不延长 Team 有效期；升级处理中或失败保留当前真实套餐。沿用既有布局和错误／加载／无权限状态。

## ② 用例

材料为 `usecases.md`、`domain.md` 和 `coverage.md`。已确认商业规则保持不变：基础席位不随实际人数下降减价、补差价同日到期、首期额度按剩余月度窗折算、到期只挡新团队 AI、Enterprise 平台管理员开通与加额度。下列具体执行规则仍是本束提案，须随本文件由人确认：

1. **核心成员口径**：每个实际组织成员占一席，四类 `orgRole` 均计入；纯项目来宾不产生组织成员关系时不计入。邀请尚未核销不占位，核销事务竞争最后一席，失败不消费邀请。既有超席成员不移除；首次开通须购买足够容量，续费保留已购容量。
2. **折算精度**：微信补价沿用原建议的向上取最小货币单位；Stripe 使用固定版本、固定折算时刻的真实账单预览，显示其实际整数金额，不强行用另一套公式重算。实际首期额度按权威到账时刻向下取到 0.01 credit，支付前明确为预计值。
3. **Enterprise 生效**：不自动发月度额度、不创建自助账单或虚构期限；开通后组织 AI 不再受旧 Team 到期日和 Team 收费席位上限限制。旧已发额度按原批次有效期保留。平台加额度为永久额外额度。升级前处理本应用所属 Team 的待支付变更并核实停止未来 Stripe 续费；失败显示处理中／失败，不显示已升级。
4. **付款归属**：Team 开在明确选择的组织下，不把个人 Pro 或个人余额迁移成组织权益；个人 Pro 的续费独立，购买前告知这一点。微信过期后手动购买新期限；连续 Stripe 续费保留原购买锚点及全部已购增员数量。

## ③ API

`api.md` 是本次拟议形状及约束；实现后唯一可执行 schema 放在 `packages/contracts`，本次不新增运行时 DTO、route 或 Zod schema。复用现有身份 guards、`platform-organizations.ts` 的 `Plan`／版本／审计和组织钱包；不另建第二个 Enterprise 布尔值或权限体系。`platform-organizations.ts` 为关联可执行契约，不虚构同名已签核契约束。

签核前须完成独立一致性复核。任何修订另留审查记录；本文件唯一记录人工签核状态，agent 不自行改为 confirmed。本设计不授权生产部署、计费 epoch 激活或旧账清理。
