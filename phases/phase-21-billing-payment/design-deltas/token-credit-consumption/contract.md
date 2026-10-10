# Token 消费与充值钱包契约补充草案

本补充将已签核的充值钱包接入真实 AI token 使用。人类于 2026-10-10 在本会话确认业务规则：1 credit = 1000 tokens，精确到 0.01 credit 向上取整，调用前预留、按真实 usage 幂等结算，余额不足拒绝新调用，个人与组织分别记账，Stripe 订阅不自动赠送充值额度。此草案待书面复核；不修改已有束的签核状态。

## 与既有契约的关系

- 基础契约：`packages/contracts/src/billing-credits.ts` 和 Phase 21 `contracts/billing-credits/`。
- 本补充替代本阶段“额度只入不耗”的范围限制，增加消费及预留记录；充值与订阅保持独立。
- 现有 token 配额、组织 AI 策略、成本限额继续有效，钱包不足不得被无限额策略绕过。
- 不把原型 mock 当作计费服务；不把 Stripe 订阅状态当作钱包余额或免费额度来源。
- 本补充只处理真实 token 消费。以图像、字符、秒等原生单位计价的能力继续使用已有单位与成本策略，不伪造 token 数量。

## 单位与精度

生产端兑换常量由未来 `packages/contracts/src/billing-credit-consumption.ts` 的公共导出唯一声明，其余层引用。
钱包及账本采用 credit 的百分之一作为内部最小单位，通过 bigint 整数运算：`debitMinor = (tokens + 9n) / 10n`。

| 上游真实 tokens | 扣除 credits | 内部最小单位 |
|---:|---:|---:|
| 0 | 0 | 0 |
| 1 | 0.01 | 1 |
| 10 | 0.01 | 1 |
| 11 | 0.02 | 2 |
| 1000 | 1.00 | 100 |
| 1001 | 1.01 | 101 |

F01 现有整数 credit 的所有金额字段在独立迁移中按一百倍无损转换为内部整数单位，不能直接改变旧列的业务含义。接口展示量保持 credit，精确到两位；既有套餐基础和赠送额度保持其购买时快照。人民币支付金额继续使用整数分，与 credit 单位分别处理。

## 计费主体与授权

- 主体由服务端可信请求上下文决定。个人调用扣本人钱包；显式组织使用扣该组织钱包，并验证正式成员及已有策略权限。
- 请求预留时固定主体、用户、模型、最大 token 上界和规则版本；终态不得依据当前页面或后来改变的组织开关重新选钱包。
- 不自动从组织钱包退回个人钱包；跨主体回退须另行设计确认。
- 公共客户端不能提交结算 token 数、扣费数额或替他人指定计费钱包。
- 钱包/消费列表的组织管理可见性沿用 owner/admin 边界。普通成员查自己模型用量复用既有用量接口，不增加读取整组织账本的权限。

## 预留与结算

1. 在已有真实模型 admission 边界，基于经过验证的输入及输出上界计算最大预留量。
2. 在同一个数据库事务中锁定钱包，校验 `availableMinor = balanceMinor - heldMinor`，记录唯一请求预留。余额不足时不派发上游调用。
3. 入账、发放、预留、结算共享钱包锁及事务边界；预留不生成消费流水，也不直接减少账面余额。
4. 上游真实 usage 经现有计量回执认证、请求归属匹配后，按其 reported 总 token 数结算；不得用字符估算补出一个免费或确定扣费结果。
5. 一次真实 HTTP/model 请求只有一笔消费。重复终态、重放与并发回调重用原预留和结算结果，不再扣费；真实新请求的重试按不同物理 requestId 分别计量。
6. 已知真实零用量释放预留、不生成零额流水。调用失败但已报告非零真实 usage 仍如实扣费。
7. 已确认没有派发上游的请求可以释放预留。已经派发但 usage 不明的请求保留预留，进入可恢复待结算状态；不以本地超时推断零用量。
8. 已报告的实际用量若违反可信最大上界，则保留预留并登记待对账错误，不透支、不将实际使用丢弃、不假装已经结算。处理超出上界的追加收费须有另行明确裁决。
9. 已正常结算的额度 `balanceMinor >= 0`，可用额度 `balanceMinor - heldMinor >= 0`；既有账实相符不变量继续成立。
10. `credit_transactions` 新增消费类型和模型请求来源；每笔保留 requestId、实际 tokens、规则版本和结算后余额。人工发放依然只能来源于 admin_grant。

## 用户界面

充值收银台与钱包使用真实接口。钱包显示余额、预留量和可用额度；消费流水显示真实 token 数和精确到两位的 credit 消耗。
余额不足的新调用显示明确说明及购买入口；未配置渠道时保持渠道不可用的诚实状态。订阅页面沿用已签核设计，不显示未经实现的赠送额度。

## 代码边界

| 职责 | 既有接入点或新文件 |
|---|---|
| 可信 admission 与回执结算 | `apps/api/src/application/agent-run/ai-admission-ports.ts`、`apps/api/src/infrastructure/auth/pg-ai-admission-repository.ts` |
| 真实模型调用 | `admit-priced-model-call.ts`、`admit-priced-input-only-call.ts`、`PgRuntimeModelUsageRepository` 及其统一装配 |
| 钱包事务与预留持久化 | 独立 billing application/domain/infrastructure 模块，复用现有 DatabasePort |
| API 形状与单位单源 | 新 `packages/contracts/src/billing-credit-consumption.ts`，与旧充值形状明确迁移衔接 |
| 查询与页面展示 | Phase 21 真实钱包、流水和收银台，沿用现有 session/权限守卫 |

实施前逐一核查所有支持的 token 调用入口；不能只接聊天日志而漏掉内部 runtime model request。现有 quota admission 的预算锁和回执真实性判定不能绕过。

## 验收场景与预计功能拆分

每项独立 issue/PR，先写反证再实现，状态由 harness verify 判定。

1. **单位迁移与消费契约**：旧余额/流水总值转换不变，SQL 可真实重放且事务失败可回滚，整数边界与六个兑换例正确。
2. **预留与结算内核**：并发不足拒绝、重复请求不重复预留、重复终态不重复扣费、真实失败用量照记、未知量不免费释放、主体固定、账实相符。
3. **真实模型接线**：至少一条真实调用链在余额不足时零上游请求，在充值后成功调用并根据实际回执产生一笔消费；runtime/internal 入口同样执行门控；旧配额限额继续生效。
4. **消费查询与 UI**：刷新及重开仍显示真实余额、预留和消费；购买→到账→AI调用→消费流水的浏览器/API/DB 链路一致，组织成员不越权。

建议验证目标：`tests/billing/credit-unit-migration.test.ts`、`credit-reservation-settlement.test.ts`、`credit-runtime-admission.test.ts`、Web `tests/ui/billing-credit-consumption.test.tsx` 和独立浏览器消费闭环 lane。这些目前是待建设的验证目标，不是已存在或已通过的测试。
