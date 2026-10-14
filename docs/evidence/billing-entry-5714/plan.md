# #5714 — 个人计费入口执行计划

目标：用户能从实际个人菜单发现计费账户，读取真实状态；不可用和失败不伪造余额或支付结果。

```mermaid
flowchart LR
 G[用户能找到额度与订阅] --> A[现状与契约核对] --> B[正式入口与状态] --> C[读取和导航验证] --> D[浏览器与独立审查] --> E[绿PR与发布闭环]
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class G doing
 class A tested
 %% evidence A: main只有preview/billing和未接入菜单；issue5714记录用户截图断点。
 class B tested
 %% evidence B: component.log验证菜单可达与真实API读取状态。
 class C tested
 %% evidence C: component/lint/typecheck/navigation.log命令退出0。
 class D doing
 class E todo
```
