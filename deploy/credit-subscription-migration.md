# 月度 credit 切换与旧订阅对账

本文件是发布操作说明；开发测试不代表生产已执行。计费规则见
`docs/superpowers/specs/2026-10-30-credit-subscription-design.md`。

## 顺序（必须先补发，再切换运行时）

1. 保留旧 API 运行版本，备份数据库并核对当前订阅/钱包记录。先应用新增兼容迁移：周期额度和请求收据表；不要提前启动新准入 API。
2. 从 Stripe 确认现存月付 `price_*` 清单。年付、试用、赠送、无法核实付款、未知套餐不得猜成月付；它们必须逐项确认产品迁移决定。**任一阻塞项未解决，不切换整个部署到新 API**，以免旧订阅用户在补发前被统一准入拒绝。
3. 在新构建的运维环境用应用数据库凭据和现有 Stripe 配置运行 dry-run。命令每次一页（最多 100），输出 `nextAfter` 和固定 `until` 高水位；同一 checkpoint 重复执行直至 `complete:true`。checkpoint 不含密钥，应以 0600 保存。

```bash
pnpm --filter @repo/api exec tsx scripts/billing-credit-subscription-backfill.ts \
  --plans price_reviewed_monthly_a,price_reviewed_monthly_b \
  --limit 100 --checkpoint /secure/credit-dry-run.json
```

4. 审核全部页报告。`blocked>0` 退出 2，checkpoint 保留本页起点。修正绑定/付款/套餐映射后重跑；不要手动跳过该页。`verification_failed` 可能是未付款、当前周期不一致、提供方失败或试用，需用 Stripe 和服务端绑定逐项核对，不凭客户端数据补发。
5. 显式执行 apply，**使用另一个 checkpoint**。dry-run checkpoint 不能用于 apply；数据库主机、端口、库名或套餐清单改变都会拒绝复用，旧版缺少主机/端口的 checkpoint 也拒绝。更换目标时从新 checkpoint 重新审计，不移用游标。完成后重新从空 checkpoint 对账，覆盖高水位后新增的订阅，并检查所有 active 月付账户当前周期都存在唯一批次。

```bash
pnpm --filter @repo/api exec tsx scripts/billing-credit-subscription-backfill.ts \
  --plans price_reviewed_monthly_a,price_reviewed_monthly_b \
  --limit 100 --checkpoint /secure/credit-apply.json --apply
```

6. 只有所有页无阻塞、账期/余额对账通过后，才部署统一 credit 准入的 API。发放当前已付款整月 20,000，原周期结束时到期；已有充值和欠款保留，不补扣历史 token。Stripe webhook 同时开始处理 paid invoice；与工具使用相同账单/周期唯一键，重跑不重复。
7. 验证个人余额 0 请求可完成、扣为负后新请求拒绝；企业负余额仍可调用。检查月度额度、永久净额、到期和用户/组织消耗查询。回跳 active 不能作为额度到账证据，应读 `creditGrant` 和实际钱包。

## 恢复、历史事件与回滚

- 未绑定的早到付款回调返回可重试；绑定恢复后可重放。历史 ignored paid 事件可用原已验签事件重放，或用本工具重新核验当前付款周期。周期事实始终按 invoice + subscription + cycle 去重。
- 工具每页重新向固定 Stripe API 读取订阅、最新账单和 price，不读取客户端 metadata userId。只接纳当前真实月周期；旧的已付账单不能顶替当前未付账期。
- `applied` 表示已对账的账户数，包括幂等重放，不表示新增发放数；新增数以 `subscription_grant` 流水为准。流水和周期表应分别核对；不从 token 总量反推费用。
- apply 在用户锁内重新核验并确认本次预期的确切周期已发放或已存在，才报告成功。复读时状态/账期变化返回 `credit_period_not_reconciled`，整页保留起点；恢复后同一账单可重试。历史 `ok` 审计但无额度的情况也会重新核实并补齐独立的周期事实，不修改旧事件审计。
- 新 API 部署失败可回滚旧镜像，保留新增表和全部流水。回滚旧镜像会临时恢复其旧准入行为，需记录窗口；不要删批次、重置余额、清掉负债或把已发生调用当免费来“回滚”。后续重新启用前再次对账。
- 本会话未执行生产 apply、真实付款或生产部署；这些是独立发布动作。
