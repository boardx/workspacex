# 进度日志 — Phase 20 work-stack-foundation

## 当前已验证状态(唯一真相)
- 仓库根目录: <repo 路径>
- 标准启动路径: `pnpm -w run dev`
- 标准验证路径: 见 ADR-106（`verify:quick`/`verify:harness`/`verify:release`，不确定就跑 `verify:release`）
- 当前最高优先级未完成功能: <feature id / title>
- 当前 blocker: <无 / 描述>

## 会话记录
### 2026-09-28 11:43:35
- 本轮目标:
- 执行计划摘要(`node .harness/scripts/execution-plan.mjs summary <计划>`):
- 已完成:
- 运行过的验证:
- 已记录证据:
- 提交记录:
- 已知风险或未解决问题:
- 下一步最佳动作:

### 2026-09-29 WF06 review fixes
- 已完成: webhook HMAC 改签原始请求体字节；未认证失败统一 401（不可探测 triggerId）；非对象体 / 短 Idempotency-Key → 422 trigger_input_invalid；
  密钥列改名 `webhook_secret`(+`webhook_secret_previous` R9 轮换槽)，app_rw 无列级 SELECT，只经 SECURITY DEFINER 函数按 id 取；
  补负向测试（owner 离组 / Agent 不可运行 / 轮换 / 原始字节多 key）；用例间等实例落定再 resetOrgs。
- 契约束：撤回实现方对 workflow-runtime/domain.md、usecases.md 的改动（束已签核，实现方不得改）。以下作为**签核待决问题**提交人类：
  - **Q7（草案）** webhook 签名串 `hex(HMAC-SHA256(secret, "${timestamp}.${idempotencyKey}.${rawBody}"))`（rawBody = 原始请求字节）是否写入契约。
  - **Q8（草案）** WorkflowTrigger 增列 `default_input`（schedule 触发器的冻结运行输入，pg-boss 作业不带 payload）；UC-WR-I4 触发器不存在/非 schedule 时安静跳过。
  - **Q9（草案）** webhook 密钥目前明文存于 `workflow_trigger_lookup.webhook_secret`（列级授权隔离）；是否要求改为引用/密文（需解密能力，超出 WF06）。
- 已知风险: 上述 Q7–Q9 未签前，实现先行于契约；owner 离组 / Agent 不可运行在 pg-boss 路径上抛错，由 pg-boss 重试策略兜底（不建实例）。
