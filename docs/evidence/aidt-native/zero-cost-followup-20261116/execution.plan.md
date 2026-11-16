# S2零费用后续：因果核查与安全回归

目标：仅在无模型调用、无额外模型费用的范围核实S2证书因果边界，补安全诊断和失败体验回归。
完成判据：原始记录证据与机制回归分开；目标测试真实执行；无外部模型/财务/权限变更；资源释放。
边界：不自动重跑S2，不将loopback/HEAD当真实模型通过，不修改pending或旧失败。
当前原S2费用仍以最后已保全记录为准，供应商账单未知；不从离线快照推断新结算。

```mermaid
flowchart TD
  G([目标：零模型费用推进与可复核结论])
  E[1. 核初始化、范围与旧记录保护]
  C[2. 离线核原始异常与因果边界]
  L[3. 回归本机TLS旧新启动环境]
  D[4. 补有界安全异常诊断]
  U[5. 核Chat失败与草稿保留]
  V[6. 验证、清理与交付]
  G --> E
  E --> C --> V
  E --> L --> V
  E --> D --> V
  E --> U --> V
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class E tested
  %% evidence E: 标准init quick exit0；原6agent分工与无模型/财务写范围已明确；旧S2 journal不重置
  class C tested
  %% evidence C: A2网络none只读工具限定debug/error+4native字段，原错误及41B安全primitive仅APIConnectionError；6JSON/links0，原cause未知；A3独立边界审阅，不以机制回归追认历史
  class L tested
  %% evidence L: 实际HTTPX/loopback TLS旧profile验证失败且HEAD0，新helper校验开HEAD200且1次；标准租约/重bind/临时私钥清理通过；6/6含5旧env tests，scopedTS/loopback gate0，不证明historicalS2原cause
  class D tested
  %% evidence D: ebbb40272私有安全诊断12/12stdlib实际通过，含内存Runtime与ASGI poll/SSE原wire逐字不变、未知类/secret/控制信号/日志失败/有界cause图；compile0，无实际模型
  class U tested
  %% evidence U: c9cf6ebb7仅失败重试保B文本/活跃mention/新附件，重发A原文/id/来源冻结，后续正常send B仍清稿；4文件25回归通过，强化host11另过（包含重叠不相加），fullWeb tsc0、lint0
  class V doing
```

本轮仍由原6个Agent分工，不新建付费任务或绕过已耗尽max1。A1核历史启动/费用时点；A2离线只读异常记录；A3独立因果文字审阅；A4草稿失败回归；A5安全日志；A6本机TLS。
