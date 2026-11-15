# AIDT 本机试用工具执行计划

目标：用户在自己的电脑用持久账号启动原生 AIDT，保存成果与成员文字，停止后可重新进入。复用 Local Runtime；不使用临时 fixture，不部署或更改权限。完成判据为真实原生登录、共享保存、停止与同目录重启回读。macOS/Windows 未实机验证。

```mermaid
flowchart TD
  G([目标：交付可本机试用的 AIDT])
  S1[1. 核对原生运行器与持久化]
  S2[2. Agent 5 显式启用独立配置]
  S3[3. 主 Agent 实现启动停止健康工具]
  S4[4. Agent 4 检验本机 IPC 所有权]
  S5[5. Agent 6 实测登录保存停起回读]
  S6[6. 主 Agent 打包工具与说明]
  G --> S1 --> S2 --> S3 --> S5 --> S6
  S3 --> S4 --> S5
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 tested
  class S2 tested
  class S3 done
  class S4 tested
  class S5 doing
  class S6 doing
  %% evidence S1: backend-profile.md records actual PGlite migrations and durable reopen.
  %% evidence S2: backend-profile.md records 27 configuration tests and default-off checks.
  %% evidence S4: test/aidt-local-lifecycle.test.ts has 13 passing Linux IPC checks.
```

| 时间 UTC | 节点 | 状态 | 实际依据 |
|---|---|---|---|
| 2026-11-15 03:54 | S1/S2/S4 | 已测试 | 真实 PGlite 重开、配置与13项IPC；日志保留 |
| 2026-11-15 03:54 | S3/S5/S6 | 实现后整体验收中 | 新CLI/脚本已存在；真实浏览器重启验收开始；未宣称本机交付完成 |

原运行器 processes.test 中一项“孙进程停止”检查将容器僵尸进程视为仍在运行，15项中14项通过；本轮不把它改写为全绿。Windows 命名管道分支及 macOS 只能交付源码，尚无实机运行证据。
