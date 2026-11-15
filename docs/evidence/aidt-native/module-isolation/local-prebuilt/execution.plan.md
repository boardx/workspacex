# AIDT 本机预构建执行计划

目标：消除本机每次进入步骤工作区时的开发编译等待，保留原生 Chat、共享成果及全局成员文字，不部署或扩权限。完成判据：安全拒绝过期/错误构建；真实预构建后两次停启，精确回读原成果与消息，并记录实际页面耗时。AI/ASR 未配置不冒称可用。

```mermaid
flowchart TD
  G([目标：可验证的本机预构建启动])
  S1[1. 核对原90秒页面等待及运行器]
  S2[2. Agent 5 适配原生构建目录检查]
  S3[3. Agent 4 校验构建与源码并锁定输出]
  S4[4. 主 Agent 接入build和预构建命令]
  S5[5. Agent 6 真实构建停启回读与计时]
  S6[6. 主 Agent 更新说明和证据]
  G --> S1 --> S2 --> S4 --> S5 --> S6
  S1 --> S3 --> S4
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 tested
  class S2 tested
  class S3 tested
  %% evidence S3: 28 artifact/source/ownership checks passed in 74 total, no Next process or real model used
  class S4 tested
  %% evidence S4: 10 mocked CLI lifecycle checks plus 15 actual IPC checks, typecheck and zero-egress passed; actual build still S5
  class S5 todo
  class S6 doing
  %% evidence S1: ../local-runtime/README.md records native source-mode workspace display at 85-90 seconds.
  %% evidence S2: /tmp/aidt-local-web-build-tests.log records 21 checks; typecheck passed.
```

进展：目录适配、CLI/产物边界单测已通过第一轮。真实 build 尚未运行；不会将单测当成速度提升或模型接通证据。根命令改为直接调用 tsx，保持用户相对数据路径基于当前仓库目录；原默认 dev 保留。
