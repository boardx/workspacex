# 执行计划 — AIDT 上下文原子受理

## 我理解的目标
- **目标**：在现有消息入口同事务冻结 AIDT 材料，保留学生原文、准确 Agent/Skill 版本和普通 Chat 路径。
- **完成判据**：两层 selector 幂等、null 互换冲突、事务回滚、并发 replay、失权重验与普通无 selector 的定向反例通过。
- **不做什么**：不启动真实模型栈、不收费、不部署、不提交、不修改设计签核状态。
- **假设与待确认**：用户在本轮明确批准桥接；根协调员已确认统一 init 退出 0。历史设计页 pending 状态保留，不代签。

```mermaid
flowchart TD
  G([目标：同事务受理消息 run 与材料快照])
  S1[1. 核对批准范围与模块规范]
  S2[2. 与契约和材料 owner 固定端口]
  S3[3. 写可失败的受理反例]
  S4[4. 实现原子保存与幂等处理]
  S5[5. 定向验证与交接]
  S6[6. 对齐 AIDT 闭合冲突码]
  G --> S1 --> S2 --> S3 --> S4 --> S5 --> S6
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G tested
  %% evidence G: context-atomic-validation.json + closed conflict followup
  class S1 tested
  %% evidence S1: Approved bundle read; root unified init exit0 /tmp/aidt-context-init-02.log
  class S2 tested
  %% evidence S2: A2/A3 ports imported; context-atomic-typecheck.log exit0
  class S3 tested
  %% evidence S3: context-atomic-red.log 11 failed/2passed -> context-atomic-green.log 43passed
  class S4 tested
  %% evidence S4: context-atomic-green.log 43passed and scoped tsc exit0
  class S5 tested
  class S6 tested
  %% evidence S6: context-atomic-conflict-red.log 10fail -> green45pass; conflict-typecheck exit0
  %% evidence S5: context-atomic-handoff.md; git diff --check exit0
```

## 进度日志
- 2026-11-16：已确认 root init0；端口为 A2 `AidtMessageAcceptancePort`，准备、持久化与 replay 重验全部使用仓储传入的同一 TenantSession。契约 schema/hash 由 A3/A2 单源提供。
- 2026-11-16：root 批准补准确 AIDT 冲突闭码；ordinary HTTP/SSE 原边界保留，新增 S6 记录该已批准实现修正。
