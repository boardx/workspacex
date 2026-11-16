# 执行计划 — 已批准的补充真实模型E2E

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：按V2完整走通原生六步与SUM，核对真实模型、保存成果、历史来源和学生决定。
- **完成判据**：现有真实Playwright用例与实际run/消息/receipt/计量及文件字节对应；失败保留，不把配置或prepared当模型通过。
- **不做什么**：不部署生产、不合并、不扩大权限或余额、不造真人证据、不自动新建重试。
- **假设与待确认**：用户本轮明确“批准”新增S1一次+Design最多两任务；原S2–S6/SUM六名额保留，旧账不重置；未另给金额上限，不虚构货币硬限额。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：完整真实六步与总结E2E])
  E[1. 核验本轮初始化、批准与私密配置]
  C[2. 分开旧预算与新增额度、启动唯一真栈]
  U1[3. S1真实引导与学生确认保存]
  U2[4. S2真实引导与发现材料边界]
  U3[5. S3画像前反思、画像与HMW]
  U4[6. S4分类选择与描述单]
  P[7. Design V1与S5验证目标和原型]
  U6[8. S6测试反思、回溯与Design V2]
  R[9. SUM真实报告、审阅保存与导出]
  V[10. 核对来源、计量、清理及PDF交付]
  F[11. 补齐访谈清单PDF与测试原件入口并验证]

  G --> E --> C --> U1 --> U2 --> U3 --> U4 --> P --> U6 --> R --> V
  C --> F --> V

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G blocked
  %% blocked G: 新增S2唯一actualrun失败；CA透传已修且HTTP可达，但模型未重新验收，独立max1耗尽且2pending未知占款保留；后续5原生与2Design依赖前序未执行，不自动重跑
  class E tested
  %% evidence E: 本轮用户批准新增S1一次与Design两任务；init日志/tmp/aidt-paid-init-20261116.log实际exit0；旧预算hash未变
  class C tested
  %% evidence C: A5追加私有QA canonical不可变版本428d072b，A1独立15组数据/旧版本/旧消息/快照/权限/账目与两预算hash全不变；默认指针换新，所有执行器0，新Web健康。此非普通发布API或修复后教学通过。
  class U1 tested
  %% evidence U1: 真实Playwright S1 attempt02 1passed18.7s；run68880459-6de1-43a8-a909-0a969f03a7a8实际message-dispatch-observed，学生重写/保存与freshlogin；attempt01仅grep0测试失败保留
  class U2 blocked
  %% blocked U2: 新增一次S2 actualrun40539aa6 MODEL_CALL_FAILED；独立预算1/1已占、按约定停止不重发；来源精确与隔离审计过但无回复/学生新保存。2physical失败、pending2预留86.29测试credits，用量未知；执行器已关闭，不改账，连接原因诊断中
  class U3 todo
  class U4 todo
  class P todo
  class U6 todo
  class R todo
  class V tested
  %% evidence V: 本轮final-cleanup normalexit0、自有容器卷网/13端口租约slot清0，未知financial状态保全不改账；源码Libraryv7/PDFv6已guarded保存，PDF27页非空/无越界/字体嵌入，Library页1/24/27回读通过；完整模型E2E仍U2失败
  class F tested
  %% evidence F: ec5ff2e9d新构建真实Playwright两场2passed10.1s：采纳清单实际PDF字节/文字/字体/视觉，新S6真实TXT与PNG上传回读、保存重登、同org非成员与错project404；A4相关52单测及全WebTS0。
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-16（北京时间） | G, E | todo → doing | 接到目标，开始理解 |
| 2026-11-16（本轮） | E, C, U1 | 初始化与唯一栈已测试，S1链路已测试 | A1 fresh健康/实际执行器与计量，A6 S1真实1passed，A2只读精确来源审计；S1复合三问体验偏离见A3报告，不当教学通过。 |
| 2026-11-16（本轮） | U2 | 前置QA失败后继续首模型调用 | 上传HTTP状态与MIME参数断言错误已定位，A1证实S2 run0/旧账不变；保留尝试记录，未把前置失败当新模型重试。 |
| 2026-11-16（本轮） | F | 新增 → doing | 逐项核对发现S2缺访谈清单PDF入口、S6缺测试原件入口；A4复用现有Web导出/上传补齐，A1规划独立新Web构建，PG/API/同组保留。 |
