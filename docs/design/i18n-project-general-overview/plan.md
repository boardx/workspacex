# 执行计划 — General project overview i18n — #6258

## 我理解的目标
通用项目概览完整正文及已有状态按current locale显示；保真实请求、权限、raw名字、数量、日期事实与链接。Chat冻结head不改，同WT新branch从accepteddevelop独立开发。

## 执行计划
```mermaid
flowchart TD
  G([目标：通用项目概览完整双语页])
  S1[1. 明确完整页面边界与issue]
  S2[2. 实际路由/状态清单与provider RED]
  S3[3. 最小display实现]
  S4[4. 必要源门/真实浏览器/逐图QA]
  S5[5. 独审/PR绿/main合入/交接]
  G --> S1 --> S2 --> S3 --> S4 --> S5
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: https://github.com/boardx/workspacex/issues/6258#issuecomment-6647274939 — provider6 genuine missing-English RED, actual4.82s
  class S3 tested
  %% evidence S3: evidence/i18n-project-general-overview-6258/task1-source-receipt.json
  class S4 doing
  class S5 todo
```

## 进度日志
| 时间 | 节点 | 状态变化 | 依据 |
|---|---|---|---|
| 2026-11-05 | S1/S2 | done/doing | main认可page scope、issue6258、actual route读取；无测试/产品实现 |
