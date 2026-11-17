# 执行计划 — 保留学习轮次的阶段交接

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：修复返回前序阶段后，原生Chat、工具与Board往返丢失反思版本；保留project、thread、资源与原轮次依据。
- **完成判据**：单元先复现再修复；整合、类型和设计检查通过；新原生构建与双停启/回读验证持续保留原反思版本。
- **不做什么**：不改Chat UI、不变更服务契约或权限、不按MBA历史材料新增三Agent/固定报告页数；真实模型、录音及课堂验收仍另计。
- **假设与待确认**：历史课程为另一MBA作业说明，仅参考人工判断；当前无运行中的重复agent任务，原数据保留。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：阶段与工具持续保留原轮次])
  S1[1. 核对现状与历史范围]
  S2[2. 复现原生Chat丢轮次]
  S3[3. 贯通Chat/工具/Board返回]
  S4[4. 单元/类型/真实后端复验]
  S5[5. 源码包与反馈交接]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G tested
  %% evidence G: verification.md与delivery.json；本轮两处修复和本机交付完成，实模/课堂边界保留
  class S1 tested
  %% evidence S1: 已核对当前分支、无重复活动Agent及历史课程边界；source-intake.md
  class S2 tested
  %% evidence S2: reproduced-failure.txt 证明旧代码丢失反思版本
  class S3 tested
  %% evidence S3: targeted-tests.txt：83项；web-tests.txt：501项；类型、设计及ESLint通过
  class S4 tested
  %% evidence S4: native/test-results.json：1完整通过/双停启，501 Web与38 Runtime；verification.md
  class S5 tested
  %% evidence S5: delivery.json：Library版本3、完整性及xattrs成功；Backlog sequence24保存回读
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-15 | G, S1 | todo → doing | 接到目标，开始理解 |
| 2026-11-15 | S4 | doing → doing | 首次真实新构建与返回轮次通过，stop owner退出1使全流程失败；已加队列关闭屏障，38项runtime测试通过，继续新构建复验 |
