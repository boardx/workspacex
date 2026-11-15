# AIDT V2 Markdown 开发执行计划

来源：`docs/requirements/aidt-v2-delta.md`，用户直接粘贴的完整 Markdown 为依据。既有 A+B 批准继续有效；不增加服务契约或代理签核，不部署生产。当前位于隔离分支 `worker/aidt-v2-learning-loop`。

```mermaid
flowchart LR
 R[需求差异 FR15–19] --> P[问题价值与来源]
 R --> S[意外发现与暂无]
 R --> I[学生点子分类]
 R --> V[验证问题与本轮反思]
 R --> K[原生阶段 Skill 1.3]
 P --> J[界面/保存/交接/报告集成]
 S --> J
 I --> J
 V --> J
 K --> J
 J --> T[单元与类型检查]
 T --> E[真实本地持久化与重启验收]
 E --> D[本地可运行交付]
 classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d
 classDef active fill:#fef3c7,stroke:#d97706,color:#78350f
 classDef tested fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
 classDef pending fill:#f3f4f6,stroke:#9ca3af,color:#374151
 class R done
 class P,S,I,V,K tested
 class J,T tested
 class E tested
 class D active
```

分工：问题反思 Agent 负责 FR15 与教学输入输出说明；资源 Agent 负责 FR16；创意 Agent 负责 FR17 及描述单；验证 Agent 负责 FR18/19 与历史浏览；后端/Skill Agent 负责不可变 1.3 包与显式新版会话；QA Agent 负责真实本地验收；主 Agent 负责整体集成、保存引用、报告、回溯导航及交付。

状态含义：组件测试通过不等于真实保存、模型行为、30人课堂或生产验收。构建与端到端结果完成后另记；当前不标整个功能完成。
