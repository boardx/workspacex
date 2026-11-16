# 执行计划 — 完成教学功能缺口

## 我理解的目标
- **目标**：六个子智能体并行完成独立功能片段，保留原生Chat和全局成员文字插件，在当前环境真实验收。
- **完成判据**：逐项先复现/实现/验证，主分支整合后统一测试、类型/设计及真实本机验收，交付代码和明确的能力状态。
- **不做什么**：不部署生产、合并、改权限、代签新服务契约；不以mock代替模型；录音/语音房继续后置。
- **假设与待确认**：用户电脑的cn.local.env尚未同步，此处可独立推进其加载和诊断，不编造真实凭据。

```mermaid
flowchart TD
  G([目标：可用的六步教学闭环])
  S1[Agent1 模型配置接入与诊断]
  S2[Agent2 返工学习传给原生Agent]
  S3[Agent3 报告追溯历史学习]
  S4[Agent4 成员文字聊天可靠性]
  S5[Agent5 真实原型版本关联]
  S6[Agent6 独立验收与缺陷回流]
  S7[主Agent 集成与跨模块回归]
  S8[主Agent 当前环境真实停启验收]
  S9[主Agent 源码交付和Backlog更新]
  S10[真实模型 六步Agent实测]
  G --> S1 & S2 & S3 & S4 & S5 & S6
  S1 --> S10
  S1 & S2 & S3 & S4 & S5 & S6 --> S7 --> S8 --> S9
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: 13项安全配置测试；真实模型仍由S10独立记录
  class S2 tested
  %% evidence S2: 返工上下文测试、根Chat参数接线与Web类型检查通过；待S8原生验收
  class S3 tested
  %% evidence S3: 报告历史与冻结来源测试通过；待S8原生验收
  class S4 tested
  %% evidence S4: 成员范围59项测试已覆盖；待S8真实主消息和回复停启
  class S5 tested
  %% evidence S5: 原型DTO及父组件绑定测试通过；非真实生成验收
  class S6 done
  class S7 tested
  %% evidence S7: 650项不同Web测试、类型/设计/ESLint通过；见integration目录
  class S8 doing
  class S9 todo
  class S10 blocked
  %% blocked S10: cn.local.env仅见于用户Mac截图，当前云工作区无可读文件；不以缺配置skip冒充真实模型通过
```

## 进度日志
| 时间 | 节点 | 状态变化 | 依据 |
|---|---|---|---|
| 2026-11-16 | G,S1-S6 | todo → doing | 用户要求保持6个子智能体并行，分别使用隔离worktree |
