# 执行计划 — 原生历史轮次返回验收补强

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：补足第6步后续保存后旧轮次的1–5步返回、错误恢复与原生持久化断言。
- **完成判据**：定向类型、ESLint、testid及1例原生用例发现通过；完整原生构建/浏览器由主任务冻结后执行。
- **不做什么**：不改业务组件、全局Playwright配置、模型lane、签核或共享Backlog；不部署、合并、GitHub外发。
- **假设与待确认**：独立QA分支；共享依赖只读；旧轮次必须以真实历史API读取，不拦截、不造模型成功。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：补强真实原生历史返回验收])
  S1[1. 理解目标及测试规范]
  S2[2. 核对501 Web与38 Runtime及原生覆盖]
  S3[3. 补1–5步历史返回和拒绝恢复断言]
  S4[4. 跑定向静态检查及用例发现]
  S5[5. 提交交接与主任务验收命令]
  S6[6. 由主任务冻结后执行完整原生验收]
  S7[7. 补报告历史审阅保存恢复及A4真实文字调用]
  S8[8. 验证第二提交并交接最新报告版本]

  G --> S1 --> S2 --> S3 --> S4 --> S5 --> S7 --> S8 --> S6

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 done
  class S3 done
  class S4 tested
  %% evidence S4: 最终ESLint和Playwright --list均exit0，见eslint.txt/discovery.txt；canonical testid gate真实失败另记README/validation.json，不计通过
  class S5 done
  class S6 todo
  class S7 done
  class S8 tested
  %% evidence S8: 第二提交2b29d5030仅spec；最终report-history-eslint.txt、report-history-spec-semantic.txt诊断0、report-history-discovery.txt发现1例；真实native仍待S6 root执行
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-16 | G, S1 | todo → doing | 接到目标，开始理解 |
| 2026-11-16 | S7 | todo → doing | root追加真实报告历史验收任务；已与A3核对pageSize5、最多2页，服务读取limit+1决定游标 |
