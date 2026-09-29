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
### 2026-09-28 WS03 review fix (iteration 2)
- 本轮目标: 修 WS03 review 意见并在真实 PostgreSQL 上跑绿两条 verification。
- 已完成: 测试夹具角色 `member` → `consultant`（org_role CHECK 只允许 admin|lead|consultant|compliance）；
  无变化 PATCH 不写 UPDATE / 审计事件（新增用例覆盖）；游标局限写入控制器注释。
- 运行过的验证: `catalog-api.test.ts` 10/10、`catalog-channel-transition.test.ts` 11/11，均在隔离库上跑（`with-test-isolation`）。
  环境无 Docker：用 scratchpad 里的 `docker` shim 把 `compose exec postgres <cmd>` 转发到本机 PG16:5432，并在内层把 PGPORT 覆盖成 5432。
  库名仍是隔离库 wsx_*，不是共享库。
- 待跟进（已登记，未处理）:
  1. **契约收敛**：契约 `Id = z.string().uuid()`，而 skill / version id 形如 `skill-<uuid>`。WS03 控制器只把请求 id 字段放宽成非空文本。
     需要单独一项：改契约 Id 形状或迁移 id，二选一。
  2. **目录游标**：目前是 base64 offset，翻页之间有插入 / 弃用时会重复或漏项。收敛方向：按 (stable_id, skill_id) 做 keyset 游标。
