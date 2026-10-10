# 会话交接 — Sprint 21/01

## 当前已验证
F01 数据库迁移16/16通过，owner历史门禁已修复且10/10通过。第二次官方 verify（head 535bfd12f）退出1：local-runtime有9项环境变量未归类，API三项Python集成缺pytest；完整日志在 evidence/F01.verify.log。F01仍in_progress，无PR、未合入、不得宣称完成。分类缺口已由 #5574 / PR #5585 负责，其Windows前置PR #5582未合入；不重复开发或降低门禁。已按锁文件 uv sync --extra dev --frozen 补齐本机pytest，正在仅复验三项失败测试。
证据：`evidence/F01.schema.log`；正式门控：`evidence/F01.verify.log`（由 harness 生成）。

## 本轮改动
恢复已存在 issue #4883 对应六表迁移、套餐种子、订单快照保护与最小运行时授权。组织设置强制 RLS，五张 owner-scoped 表的内核豁免声明保留；后续 HTTP 归属鉴权仍必须实现。补真实 SQL 重放、事务回滚和动态租户隔离测试。用户豁免协调凭据接入，未豁免验收或 PR 门控。

## 仍损坏或未验证
微信下单/回调、Stripe 订阅、钱包与管理端、前端真实接线仍未实现。token 使用目前只有既有计量/配额基础，没有充值钱包消费闭环。人类确认 1 credit=1000 tokens、0.01 credit 向上取整、预留与真实 usage 幂等结算、余额不足拒绝；现有 credits 契约只入不耗且整数，需后续独立消费设计 delta，不得在 F01 改签核状态或扩展整数形状。

## 下一步最佳动作
完成 `pnpm harness verify --sprint 21/01 --feature F01 --owner coord-voice`，提交 F01 的独立 PR（Closes #4883），跟进 CI/review 到绿，由协调者合并。然后取 `F-TBD-billing-config`，先 claim 原子取号，再 `pnpm harness sync --phase 21 --apply`，只做一个 feature。已有签核可复用；消费新契约另行物化。

## 命令
- 启动：`pnpm turbo run dev --filter=web --filter=@repo/api`
- 验证：`pnpm harness verify --sprint 21/01 --feature F01 --owner coord-voice`
- 单测：`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/billing/schema-migration.test.ts`

## 前置门禁复核（2026-10-10）
#5550 独立分支 `codex/fix-5550-synthetic-fixture-secrets` 已推送，head `95eeb75bdaf26182c67f8a40f4e6c254e3e53466`；直接改动测试、扫描及独立审查通过，未创建 PR。全量 quick 8 项失败，原失败七文件定向复跑 497/497 通过；harness 失败于主分支已有九处非法颜色 token、五处过期 LEGACY 条目，相关文件均与 origin/main 一致。两次隔离 wrapper 已清理完成。保留三份 `evidence/prerequisite-5550.*.log`，不将定向复跑等同于全量通过。

上述是 2026-10-10 的历史阻塞，已由主线修复取代，不再等待前置草稿 PR 批准。2026-10-11 用户要求“按照参考的功能先实现，但是要考虑用户体验”，继续现有授权实现；专项通过后仍需等待本次完整门控结果。token 消费草案在独立分支 `codex/token-credit-consumption-design` 的 `design-deltas/token-credit-consumption/contract.md`，业务规则已确认，不修改既有签核状态。F01 分支已推送；无 passing、无 PR、无 merge。

2026-10-10 元数据修正：owner 使用人类提供且 registry 已登记的 role_id coord-voice（不占协调席位）；历史日志中的 agent ID 保留为当时执行证据。sprint 收敛到 F01，其余未认领占位功能不提前领入。

2026-10-11 独立 review 接受 head `c48f0a211e11feb4f3972d58732f599ca2a5a0ff` 的 F01 范围与约束；只证明实现审查，不能替代全量门控。体验判据已加入实施准备：响应丢失时恢复同一充值意图、终态停用二维码、网络错误与付款失败分开、Stripe 立即/到期取消按服务端呈现。后续配置只对 `/billing/config` 使用方法级 `@Public()`，不豁免钱包/订单鉴权；部署配置单源且不完整渠道不声明可用。

2026-10-11 本次失败证据独立保留为 `evidence/F01.owner-transition-failure.log` 与 `evidence/F01.owner-transition-diagnostic.log`，避免下次正式日志覆盖。自身隔离栈 wsx-a99b14cc18f85f180431 已由 wrapper 清理，docker ps -a 零残留；不清理他人栈。

2026-10-11 身份历史修复已落到 `535bfd12f4ae745c5508275a1f40fe2a8bb82d3f`：初次认领直接使用 coord-voice，旧提交保存为 `refs/codex-backups/f01-owner-fix-20261011`。独立 exact SHA review ACCEPT，迁移/测试字节未变。生产迁移门退出0、对应测试10/10；原官方门控再次执行，schema16/16通过后进入 verify:release，全量结果仍待返回。

Python dev依赖按锁文件补齐后，标准隔离复验3文件/6测试全部通过，日志evidence/F01.python-env-retry.log；自身栈wsx-cc3e033269eeeb2b3c4b已清理。剩余全量阻塞为主线local-runtime归类修复#5585（前置#5582全checks结束、尚未合入）。不重复开发；等待实际主线合入后fetch/rebase并重新官方verify。
