# 修复验收未通过项

目标：解决已有S3/S5重复调用、S2模拟采访边界、SUM来源挤占/版本遗漏及截断不可见；通过严格实际复验，不降低断言。
范围：沿现有已签selector/snapshot/receipt和原生Chat，版本兼容、旧数据/账本保全；无生产/合并/权限余额修改、无被拒GitHub外发。新wire契约仍需人类签核，本轮优先不新增。
已知环境：init quick退出0；coord-gateway未配置导致tick失败，正式协调心跳不虚报；readiness队列为全仓任务，本轮按用户明确AIDT缺陷直接交办推进。

```mermaid
flowchart TD
 G([目标：修复未通过项并严格复测])
 I[1. 初始化并核原失败]
 A1[Agent1 教学回合收敛]
 A2[Agent2 新不可变教学包]
 A3[Agent3 总结字段摘录]
 A4[Agent4 报告来源审阅UI]
 A5[Agent5 严格E2E与内容判据]
 A6[Agent6 隔离栈与计量保全]
 T[集成单元PG与真实模型浏览器复测]
 D[结果报告与源码交付及清理]
 G --> I
 I --> A1 & A2 & A3 & A4 & A5 & A6
 A1 & A2 & A3 & A4 & A5 & A6 --> T --> D
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class G doing
 class I tested
  %% evidence I: init.sh quick exit0 /tmp/aidt-remediation-init-20261117.log；d572f1c9a干净基线、原报告及源审计已读、6worker并行启动；tick缺COORD_GATEWAY_URL明确失败不冒心跳。
 class A1 tested
  %% evidence A1: real LangChain graph fake-provider adversarial suite206 passed2skipped; TC5 pending dedicatedPG; no real model quality claim
 class A2 tested
  %% evidence A2: new immutable packs checks /tmp/aidt-boundaries-isolation.log 48/48; approved pins5/5; candidate regression10/10; old release hashes unchanged
 class A3 tested
  %% evidence A3: /tmp/aidt-remediation-context-all.log 10files68; API tsc exit0; semantic projection preserves full saved hash and immutable old snapshots
 class A4 tested
  %% evidence A4: /tmp/aidt-remediation-web-all-expanded.log 85files705; /tmp/aidt-remediation-web-tsc-fixed.log exit0; summary source/UI17 focused tests
 class A5 doing
 class A6 doing
 class T doing
 class D todo
```
