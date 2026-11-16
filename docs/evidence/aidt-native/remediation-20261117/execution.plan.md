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
 Q[完整紧凑报告修复与独立复验]
 E[官方E003隔离容器两项补验]
 D[结果报告与源码交付及清理]
 G --> I
 I --> A1 & A2 & A3 & A4 & A5 & A6
 A1 & A2 & A3 & A4 & A5 & A6 --> T
 T --> Q & E
 Q & E --> D
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class G blocked
  %% blocked G: Core executed flows pass; 2 official sandbox integration checks blocked by build storage; classroom/remote CI not performed
 class I tested
  %% evidence I: init.sh quick exit0 /tmp/aidt-remediation-init-20261117.log；d572f1c9a干净基线、原报告及源审计已读、6worker并行启动；tick缺COORD_GATEWAY_URL明确失败不冒心跳。
 class A1 tested
  %% evidence A1: 93b76865a first focus + c1e5146c2 mixed-batch red→green; full graph/runtime241 passed2skipped; TC5 actual owned PG5/5 separate; actual S1probe/S5/S6/SUM full-result SHA equal; a4-runtime/
 class A2 tested
  %% evidence A2: methods1.3.2 + summary1.0.2 immutable; API isolation52/context86; old release hashes intact
 class A3 tested
  %% evidence A3: /tmp/aidt-remediation-context-release-final.log 11files85; API tsc exit0; actual owned PG bridge22+return7; exact full saved hash and old snapshots preserved
 class A4 tested
  %% evidence A4: final Web96files818 + no-incremental tsc0; actual report source review and separate provenance passed
 class A5 tested
  %% evidence A5: 30 final QA guard tests/lint/tsc; browser member text and native retry0model; saved actual report V8 and byte-exact export
 class A6 tested
  %% evidence A6: a1 final42settled; old10 hashes preserved; private backup verified; owned cleanup13ports/leases and1slot released
 class T tested
  %% evidence T: actual S1-S6 + V1/V2 + correction report save/relogin/export; PG29+TC5 5 independent; original semantic1/1 failures retained
 class Q tested
  %% evidence Q: summary102 compact complete; first compact source error preserved; normal student clarification -> model revision semantic0 -> explicit UI save V8/export17512B
 class E blocked
  %% blocked E: official build storage floor1.5GiB; E003 probe0/additional pytest0; original Python2skip not passed, no isolation weakening
 class D doing
```
