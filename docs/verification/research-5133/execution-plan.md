# 执行计划 — 研究证据片段引用修复 #5133

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：模型选择块内原文编号，程序生成精确引用，减少跨块抄写失败。
- **完成判据**：研究 API 测试、typecheck、独立审查及真实公开资料模型重放；PR CI 全绿。
- **不做什么**：不放宽原文归属、原子重试或报告质量门，不修改公共 API。
- **假设与待确认**：沿用已授权的既有契约修复，依赖 PR #5130，禁止合入 main。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：减少引用归属错误])
  S1[1. 理解目标并确认完成判据]
  S2[2. 真实失败诊断与失败用例]
  S3[3. 实现最小改动]
  S4[4. 跑验证命令留证据]
  S5[5. 收尾：PR / 交接]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: /private/tmp/research-5133-red.log: 2 expected failures; /private/tmp/research-5133-regression.log: 106 PASS
  class S3 tested
  %% evidence S3: research-suite-summary.log: 34 files 423 PASS; typecheck.log: exit 0; real-model-result.json: 22 matches 2 calls
  class S4 todo
  class S5 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-03 | G, S1 | todo → doing | 接到目标，开始理解 |

测试证据：/private/tmp/research-5133-red.log：7 条中 2 条预期失败；随后 /private/tmp/research-5133-regression.log：106 条通过。
