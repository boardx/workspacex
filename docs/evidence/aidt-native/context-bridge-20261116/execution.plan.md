# 执行计划 — 已批准的原生教学上下文桥接

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：让六步/SUM原生Chat实际收到本组精确已保存版本，保留原话、权限与普通Chat。
- **完成判据**：契约/授权/原子受理/模型实际消息/回执的反例与原生E2E通过，类型与普通Chat回归通过；更新人工PDF。
- **不做什么**：不部署、不合并、不扩大权限、不改旧Skill不可变包、不将缺材料或prepared冒称已派发。
- **假设与待确认**：用户本轮明确批准设计束；继续沿现隔离分支及已有模型/存储服务，真实教学质量另由人审。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：原生教学上下文真实接通])
  S1[1. 记录人类批准与核验基线]
  S2[2. 六路并行实现契约与接线]
  S3[3. 整合DI与精确回执UI]
  S4[4. 无费用反例及真实链路验收]
  S5[5. 更新源码包、人工PDF与边界]
  S6[6. 供应商模型及课堂验收（仍待）]

  G --> S1 --> S2 --> S3 --> S4 --> S5 --> S6

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: 真实用户本轮批准；/tmp/aidt-context-init-02.log exit0
  class S2 tested
  %% evidence S2: 六路实现sourceReady；各owner实际定向反例与类型绿，证据见a1/a2/a3/a4及context-bridge/a5
  class S3 tested
  %% evidence S3: kernel DI实际接线；API/Web全tsc首轮exit0；receipt11/11与lint0
  class S4 tested
  %% evidence S4: 真实PG22/22；741bc生产构建prepared-only真实浏览器1pass；A1独立核0模型0用量0active，资源全部释放；供应商/课堂另列S6未验
  class S5 doing
  class S6 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-16（北京时间） | G, S1 | todo → doing | 接到目标，开始理解 |
