# Team / Enterprise 设计执行计划

理解：承接已采用UI及已确认商业规则，把组织席位／额度、到期准入和平台手动Enterprise操作整理成可审阅的用例／API；所有新增执行口径显式待人确认。Issue #6099，只复用本会话已有worktree。

```mermaid
flowchart LR
 S1[核对真实组织与权限事实] --> S2[用例与API草案]
 S2 --> S3[草案独立复核]
 S3 --> S4[可执行schema与原型消费验证]
 S4 --> S5[正式一致性复核]
 S5 --> S6[人类签核]
 S6 --> S7[逐切片实现与真实验证]
 S7 --> S8[逐PR正常集成develop]
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 class S1 done
 class S2 done
 class S3 doing
 class S4,S5,S6,S7,S8 todo
```

S1为源码核对，不冒充动态权限验证。草案复核不代替可执行第③件、正式复核或人工签核；先发布draft材料供审阅，完善同一材料PR而不提前关闭设计issue，不借文档合入激活运行时。前置个人支付PR尚按顺序排队，重置／上线继续归独立发布步骤。
