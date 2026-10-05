# 第二阶段：模型接入、恢复与体验优化

目标：完成已授权模型和配额功能的可靠调用、恢复与公共目录体验。验证依据分别保留源码、局部测试、完整CI及真实页面证据。供应商可信修正、真实模型价格/边界与第三阶段环境仍需真实输入。

灰=待开始，黄=进行中，绿=源码完成，紫=有通过证据，红=阻塞。

```mermaid
flowchart TD
  G([目标：第二阶段可靠接入与体验优化])
  S1[统一可信身份与计费契约]
  S2[实现 SDK 确认丢失恢复]
  S3[实现账本结算恢复]
  S4[实现图片原生单位准入]
  S5[实现语音原生单位准入]
  S6[整理百炼目录与后台体验]
  S7[独立边界验证与复核]
  S8[集成与正常测试 CI]
  S9[交父线程协调合并]
  S10[核实供应商已结算修正证明]
  G --> S1
  S1 --> S2
  S1 --> S3
  S1 --> S4
  S1 --> S5
  S1 --> S6
  S1 --> S7
  S2 --> S8
  S3 --> S8
  S4 --> S8
  S5 --> S8
  S6 --> S8
  S7 --> S8
  S8 --> S9
  G --> S10
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 doing
  class S2 tested
  class S3 tested
  class S4 tested
  class S5 doing
  class S6 doing
  class S7 tested
  class S8 doing
  class S9 todo
  class S10 blocked
  %% evidence S2: Python model/retrieval tests 90/90 exit 0; SDK owner report, root integration pending final hooks
  %% evidence S3: vitest usage-unit 623/623 exit 0; /tmp/wsx-stage-two-api-unit.log
  %% evidence S4: image/native/ASR target 59/59 exit 0; /tmp/wsx-native-wire-tests-final.log
  %% evidence S7: independent negative tests 13/13 exit 0; /tmp/wsx-stage-two-review/post-native-fix.junit.xml
  %% blocked S10: 缺可信供应商账号/请求/修正版本来源；不能用普通请求ID授权修正
```

源码节点只表示产出存在；子智能体局部测试结果在根集成复核前不标完整CI通过。

## 本轮交付与未闭合项

- 已实现不可变原生预留种类、单位、最大数量；同金额不同数量不能重放，Token回执不能替代原生数量。
- 已接图片/ASR可信部署配置与同租户准入事务；终态使用新的全局事务。配置缺失保持拒绝，没有生产启用。
- SDK仅重放同一物理请求的回执，不重试供应商。跨物理请求的逻辑重试仍缺可信、持久化的producer operation身份。
- ASR当前协议未报告计费usage，估算时长只作计量提示，费用预留继续保留。不能宣称已精确结算。
- TTS有严格协议/参数/计量基础模块，缺可信调用入口、实际dispatch、音频产物与流式取消闭环；旧Token TTS还缺输出硬边界。
- 未启动本地数据库。12个实际PG验收用例已编写，尚待正常CI执行。
- 已结算供应商修订缺账号/请求/单调revision可信来源；no-op回放不等于修订授权。
- 第三阶段仍缺可用隔离本地API/Web、迁移后的schema和正常operator/member登录上下文；没有真实认证页面验收截图。
- 百炼公开目录为独立issue/PR，公开规格不等于账号可用，价格未知不填默认、不自动启用。
