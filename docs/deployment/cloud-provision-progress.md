# 云部署 P0/P1 进度与验收

核验日期：2026-09-11。目标：Starter / production 两档云部署，前提满足后 300 秒内 provision。整体尚未验收通过。

绿色＝子项实现已提交；紫色＝节点注明范围的验收通过；红色＝阻塞或需要确认；蓝色＝开发/集成中；灰色＝待验收。子分支已完成不等于父分支已集成，本地验收不等于真实云验收。

```mermaid
flowchart TD
    T["Starter + production 云部署<br/>300 秒目标 · 整体待验收"]
    T --> CFG["两档参数与配置实现完成<br/>a688e8778"]
    CFG --> CFGV["配置与 CI 验收通过<br/>merge 12bb7fe82"]
    T --> PRE["ECS 主机准备实现完成 · 待集成<br/>60de93136"]
    PRE --> PREV["7 项模拟测试与类型检查通过<br/>60de93136 · 非真实 ECS"]
    PRE --> TLS["TLS 身份校验与入口配置完成<br/>b2e1b19c4 / 54dcf5eeb"]
    TLS --> TLSV["15 项真实 TLS 测试通过<br/>入口 TLS / WS / SSE 本地通过<br/>b2e1b19c4 / 54dcf5eeb"]
    T --> REL["不可变 manifest / 预热 / Compose 完成<br/>87b9518f0 / 52745d26a"]
    REL --> WEB["Web 字体 / 域名复用 / 运行标识完成<br/>0489e10ae / d6dfef201 / b538ad208"]
    WEB --> WEBV["本地 Web 镜像页面 / CSS / 字体验收通过<br/>3022d0f26 · 不含后续运行标识变更"]
    REL --> SAND["Sandbox 镜像与隔离测试通过 · 待集成<br/>74dc21a5a / a983bb2cb<br/>仅本地容器禁网及联网对照"]
    REL --> IMG["Agent 生产依赖锁与真实镜像构建<br/>开发中：release_artifacts"]
    T --> OSS["OSS 私有存储与完整性适配完成<br/>caf9d561a"]
    OSS --> OSSV["代码与 CI 验收通过 · 非云桶验收<br/>merge 979763543"]
    OSS --> FILE["导出 / 删除 / 图撤回 / 录音文件完成<br/>1196fc561 / ae1c7697e / 143a0d9bb"]
    FILE --> FILEV["数据库与 HTTP 文件链路回归通过<br/>ae1c7697e / 143a0d9bb<br/>非真实 OSS 全链路"]
    T --> DB["迁移 / 管理员 / Agent 与 Memory 分库完成<br/>96f9b7066 / c8bdffe92<br/>e2be59a17 / c1822e4d6"]
    DB --> DBV["本地 PG16 / Redis7 初始化验收通过<br/>252 迁移及角色隔离<br/>96f9b7066 / c1822e4d6 · 非 RDS"]
    DB --> MEM["Native Memory 最小权限与探针完成<br/>4676124f7 · 子分支待集成"]
    MEM --> MEMV["7 项真实 PG 部署测试通过<br/>含截止取消与无晚到 DDL<br/>4676124f7 · 非云端验收"]
    DB --> BACK["备份恢复 / OSS 传输 / 维护命令完成<br/>5b57dbfc2 / 4bffc140b / a16877752"]
    BACK --> BACKV["真实 PG16 新库恢复验收通过<br/>5b57dbfc2 · OSS 仅 SDK 本地验证<br/>4bffc140b · 非云端恢复"]
    T --> SEC["稳定密钥持久化与取消传播完成<br/>9810aa818"]
    PRE --> RUN["provision 编排 / 真实业务探针 / 故障清理<br/>父分支接线未提交 · 开发中"]
    MEM --> RUN
    IMG --> RUN
    SEC --> RUN
    FILE --> RUN
    RUN --> FINAL["最终统一 SHA 镜像重建与整体验证<br/>尚未完成"]
    FINAL --> CLOUD["两档真实云端三次计时与故障验收<br/>尚未完成 · 不标全 PASS"]
    CLOUD -.-> BLOCK["云验收阻塞<br/>缺专用 ECS / OSS / 云凭据"]
    IMG -.-> LICENSE["待确认：Agent 生产服务许可方案<br/>已有 LangGraph 许可或自建服务"]
    REL -.-> GH["GitHub 外发阻塞<br/>自动审批拒绝 issue / push<br/>授权问题待答复"]
    classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef accepted fill:#f3e8ff,stroke:#9333ea,color:#581c87;
    classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef active fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
    classDef pending fill:#f1f5f9,stroke:#94a3b8,color:#334155;
    class CFG,PRE,TLS,REL,WEB,OSS,FILE,DB,MEM,BACK,SEC done;
    class CFGV,PREV,TLSV,WEBV,SAND,OSSV,FILEV,DBV,MEMV,BACKV accepted;
    class IMG,RUN active;
    class BLOCK,LICENSE,GH blocked;
    class T,FINAL,CLOUD pending;
```

本次纠正：Starter Agent 分库、Memory 分库、TLS、Nginx、Web 域名复用、录音文件与 OSS 备份维护已从开发中改为已提交完成。主机准备、Memory 部署及 Sandbox 新增工作已在子分支提交，明确标注待集成。父分支尚未提交的编排接线继续保持蓝色。

紫色证据来自各节点对应提交的测试记录；不同源码版本的测试不能合并为最终整套产品验收。最终统一 SHA 的镜像仍需重建，两档真实云端安装、业务链路、恢复与 300 秒墙钟计时尚未通过。

| 执行者 | 当前状态 |
|---|---|
| release_artifacts | Agent 生产依赖锁与真实镜像构建进行中；Web 与 Sandbox 本地验证完成 |
| data_initialization | 主机准备已提交 60de93136，等待父分支集成 |
| file_agent_paths | Memory 部署与真实 PG 验证已提交 4676124f7，等待父分支集成 |
| 主 agent | 持续集成、编排接线、业务探针、取消清理、测试及文档 |

红色条件只阻塞对应外发或真实云验收，不阻止其他开发。GitHub issue/push 曾被自动审批拒绝，原因是向外部仓库发送实现信息的授权未获确认；未通过其他工具绕过。
