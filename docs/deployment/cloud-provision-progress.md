# 云部署 P0/P1 进度与验收

核验日期：2026-09-11。目标：Starter / production 两档云部署，前提满足后 300 秒内 provision。代码、自动化验收与 Devapp 升级链已通过；真实云端计时验收在输入现场参数后执行。

绿色＝子项实现已提交；紫色＝节点注明范围的验收通过；红色＝阻塞或需要确认；蓝色＝开发/集成中；灰色＝待验收。子分支已完成不等于父分支已集成，本地验收不等于真实云验收。

```mermaid
flowchart TD
    T["Starter + production 云部署实现完成<br/>300 秒目标 · PR #3448"]
    T --> CFG["两档参数与配置实现完成<br/>a688e8778"]
    CFG --> CFGV["配置与 CI 验收通过<br/>merge 12bb7fe82"]
    T --> PRE["ECS 主机准备 / 收据 / 完整树复核完成<br/>11fed55f5 / fce330d40 / 62adf697a"]
    PRE --> PREV["18 项准备与完整树测试通过<br/>62adf697a · 非真实 ECS"]
    PRE --> TLS["TLS 身份校验与入口配置完成<br/>b2e1b19c4 / 54dcf5eeb"]
    TLS --> TLSV["15 项真实 TLS 测试通过<br/>入口 TLS / WS / SSE 本地通过<br/>b2e1b19c4 / 54dcf5eeb"]
    T --> REL["不可变 manifest / 预热 / Compose / 生成器完成<br/>87b9518f0 / 52745d26a / 3ef5c87de"]
    REL --> WEB["Web 字体 / 域名复用 / 运行标识完成<br/>0489e10ae / d6dfef201 / b538ad208"]
    WEB --> WEBV["本地 Web 镜像页面 / CSS / 字体验收通过<br/>3022d0f26 · 不含后续运行标识变更"]
    REL --> SAND["Sandbox 镜像与隔离实现完成<br/>63181f368 / d0c55086e / a00c95b75"]
    SAND --> SANDV["禁网/联网对照与中文 PDF 验收通过<br/>a00c95b75 · 独立诊断 SHA"]
    REL --> IMG["Agent 固定依赖 / UID / 平台绑定完成<br/>d28a0e618 / 4b4c50ad3 / a3009a359"]
    IMG --> IMGV["Agent hash 镜像禁网图导入通过<br/>adb413882 · 独立诊断 SHA<br/>未启动许可 Server"]
    T --> OSS["OSS 私有存储与完整性适配完成<br/>caf9d561a"]
    OSS --> OSSV["代码与 CI 验收通过 · 非云桶验收<br/>merge 979763543"]
    OSS --> FILE["导出 / 删除 / 图撤回 / 录音文件完成<br/>1196fc561 / ae1c7697e / 143a0d9bb"]
    FILE --> FILEV["数据库与 HTTP 文件链路回归通过<br/>ae1c7697e / 143a0d9bb<br/>非真实 OSS 全链路"]
    T --> DB["迁移 / 管理员 / Agent 与 Memory 分库完成<br/>96f9b7066 / c8bdffe92<br/>e2be59a17 / c1822e4d6"]
    DB --> DBV["本地 PG16 / Redis7 初始化验收通过<br/>252 迁移及角色隔离<br/>96f9b7066 / c1822e4d6 · 非 RDS"]
    DB --> MEM["Native Memory 最小权限与探针完成<br/>3df33729b / d1dee7409 / b2aa84f0d"]
    MEM --> MEMV["7 项真实 PG 部署测试通过<br/>含截止取消与无晚到 DDL<br/>4676124f7 · 非云端验收"]
    DB --> BACK["备份恢复 / OSS 传输 / 维护命令完成<br/>5b57dbfc2 / 4bffc140b / a16877752"]
    BACK --> BACKV["真实 PG16 新库恢复验收通过<br/>5b57dbfc2 · OSS 仅 SDK 本地验证<br/>4bffc140b · 非云端恢复"]
    T --> SEC["稳定密钥 / 角色 / root路径信任完成<br/>9810aa818 / b2aa84f0d<br/>c59201ece / 62adf697a"]
    PRE --> RUN["provision 编排 / 业务探针 / 故障清理完成<br/>389512e65 / 33ba11f73 / 8f9e1f0cc / c59201ece"]
    MEM --> RUN
    IMG --> RUN
    SEC --> RUN
    FILE --> RUN
    RUN --> RUNV["部署包 263 项与 API 探针 13 项通过<br/>62adf697a · 编排使用模拟执行器"]
    RUN --> FINAL["统一 SHA 六镜像准备完成<br/>source 8261cd531 · linux/arm64"]
    FINAL --> FINALV["Web/API/Agent/Sandbox及PG/Redis<br/>真实本地运行验收通过 · 8261cd531<br/>未启动许可Server"]
    FINALV --> PRV["PR #3448 自动化验收通过<br/>5b801fa94 · 必需门禁全 PASS<br/>Devapp 受信全栈烟测通过"]
    PRV --> CLOUD["输入现场参数后执行<br/>Starter / production 各三次真实云计时<br/>当前未宣称云端验收通过"]
    IMG -.-> LICENSE["生产输入参数<br/>LangGraph 商业许可或自建 Agent 服务地址"]
    classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef accepted fill:#f3e8ff,stroke:#9333ea,color:#581c87;
    classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef active fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
    classDef pending fill:#f1f5f9,stroke:#94a3b8,color:#334155;
    class T,CFG,PRE,TLS,REL,WEB,SAND,IMG,OSS,FILE,DB,MEM,BACK,SEC,RUN,FINAL done;
    class CFGV,PREV,TLSV,WEBV,SANDV,IMGV,OSSV,FILEV,DBV,MEMV,BACKV,RUNV,FINALV,PRV accepted;
    class CLOUD,LICENSE pending;
```

主机准备、收据与完整发布树复核、Memory、Sandbox、Agent 固定依赖、业务编排、生成密钥、root 路径信任和统一 SHA 本地镜像构建均为绿色。部署包 263 项、API 探针 13 项、统一 linux/arm64 镜像运行验收，以及 PR #3448 的必需门禁均为紫色；它们仍不代表真实云验收。

统一镜像证据绑定源码 `8261cd531aef0b0114d83c2c9fc035be3200934b`：Web/API/Agent/Sandbox 的 OCI revision 一致，固定 PG16/vector 与 Redis7 也通过运行检查。PR #3448 的最新提交 `5b801fa94c1456240667564d99d3c83a38368927` 已通过 `backend-required`、`verify-control-plane`、`verify-affected`、`verify-full-compile`、`merge-gate`、全栈烟测和全部后端测试分片。镜像尚未发布到受批准 registry，因此没有伪造 release manifest；两档真实云端安装、业务链路、恢复与 300 秒墙钟计时将在输入目标环境参数后验收。

| 执行者 | 当前状态 |
|---|---|
| release_artifacts | 8261cd531 统一 linux/arm64 镜像构建和本地运行验收完成；registry 发布待授权 |
| data_initialization | 参数/验收矩阵与 prepare→provision 交界复验完成 |
| file_agent_paths | Memory、取消清理、凭据和 root 路径信任审查完成 |
| 主 agent | PR #3448 已提交且必需门禁全绿；真实云验收在输入前提参数后执行 |

当前没有红色节点。灰色节点是部署时必须提供的目标环境输入或尚未执行的真实云现场验收，不表示代码阻塞，也不冒充已经完成的云端验收。
