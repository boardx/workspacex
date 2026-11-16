# 新一轮真实浏览器与模型验收

目标：用户配置模型已实际成功后，用新独立测试小组从原生WorkspaceX UI完整重走六步、Design与报告；逐项区分机械结果与教学内容。
完成判据：真实浏览器页面操作、服务端保存/重登回读、原始文件/版本、实际模型回复/计量与精确来源审计相互匹配。
边界：不清旧失败/预算/pending，不改权限余额；不部署生产或合并，不假造真人研究；新seed独立不冒旧状态恢复。

```mermaid
flowchart TD
 G([目标：真实浏览器六步与报告验收])
 E[1. 确认用户新授权、初始化与真实模型连通]
 I[2. 启动唯一新栈并构建当前UI]
 B[3. 免费浏览器验证草稿重试与成员文字]
 S1[4. 提出问题与理由来源]
 S2[5. 共情材料与采纳清单PDF]
 S3[6. 意外发现、画像与HMW]
 S4[7. 学生分类选择与描述单]
 S5[8. 验证问题、原型V1与冻结]
 S6[9. 测试反思、回溯与原型V2]
 R[10. 小组报告审阅保存与导出]
 V[11. 独立审计、交付与资源清理]
 G --> E --> I --> B --> S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> R --> V
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class G doing
 class E tested
 %% evidence E: 用户明确无需credit额度停测并授权浏览器；标准init quick0；真实SDK OK/3.7s/22tokens/0retry（provider-connectivity.json），产品链尚待验
 class I doing
 class B todo
 class S1 todo
 class S2 todo
 class S3 todo
 class S4 todo
 class S5 todo
 class S6 todo
 class R todo
 class V todo
```
