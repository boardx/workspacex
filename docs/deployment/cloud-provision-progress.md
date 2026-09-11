# 云部署 P0/P1 进度与验收

核验：2026-09-11，本次更新对应用户要求“更新 Mermaid”。三个子 agent 均在运行，主 agent 持续集成。目标是 Starter / production 两档云部署，前提满足后五分钟 provision。

颜色：绿色＝该子项实现完成、已验证并提交；紫色＝注明范围的验收通过；红色＝真实阻塞或需确认；蓝色＝开发中；灰色＝尚未完成。代码/本地验收不等于真实云验收；图中每个绿色和紫色节点均附被核验 commit。

```mermaid
flowchart TD
    T["Starter + production 云部署<br/>目标 300 秒 · 整体尚未验收"]

    T --> CFG["参数 Schema / 两档示例 / CLI · 完成<br/>a688e8778"]
    CFG --> CFGV["参数与 CI 验收通过<br/>PR 3415 · merge 12bb7fe82"]
    CFG --> PRE["ECS / TLS / 托管数据预检接线<br/>开发中：file_agent_paths + 主 agent"]

    T --> REL["不可变 manifest / 预热 / Compose · 完成<br/>87b9518f0 / 52745d26a"]
    REL --> RELV["API 镜像内 CSV/PDF 验收通过<br/>源码 2fd7b465d · 测试 16e215bdb<br/>仅本地 Linux arm64 镜像"]
    REL --> WEB["Web 自托管字体实现 · 完成<br/>c65c6707e / 集成 0489e10ae"]
    WEB --> WEBRUN["Web 镜像与跨域名复用修复<br/>开发中：release_artifacts"]

    T --> OSS["OSS 适配 / 完整性 / 私有桶约束 · 完成<br/>caf9d561a"]
    OSS --> OSSV["OSS 代码与 CI 验收通过<br/>35 API + 30 配置测试<br/>merge 979763543 · 非云桶验收"]
    OSS --> FILE["ZIP 导出 / 删除维护 / 图关联撤回 · 完成<br/>27594f205 / 76dced869<br/>集成 1196fc561 / ae1c7697e"]
    FILE --> FILEV["隔离 PG 与 HTTP 验收通过<br/>6 条数据库测试及文件/UI回归<br/>76dced869 · 非真实 OSS 全链路"]

    T --> DB["迁移 / 管理员 / 默认 Agent ID · 完成<br/>07d93f495 / 72240a753 / 62cd2f9f1"]
    DB --> DBV["PG16 + Redis7 初始化验收通过<br/>252 迁移 / 并发重试 / 稳定 ID<br/>62cd2f9f1 · 非 RDS TLS"]
    DB --> ADB["Starter Agent 独立角色和数据库<br/>开发中：data_initialization"]
    DB --> BACK["Starter 备份与新数据库恢复 · 完成<br/>90b784f69 / 集成 5b57dbfc2"]
    BACK --> BACKV["真实 PG16 恢复验收通过<br/>数据/RLS保留，覆盖与篡改拒绝<br/>90b784f69 · 非 RDS 恢复"]

    T --> SEC["稳定密钥持久化与取消传播 · 完成<br/>fb790f3ff / 集成 9810aa818"]
    PRE --> RUN["provision 命令与真实业务探针接线<br/>主 agent 开发中：报告/清理/端到端整合"]
    WEBRUN --> RUN
    ADB --> RUN
    SEC --> RUN
    FILE --> RUN
    RUN --> CLOUD["两档云端三次安装计时与故障验收<br/>尚未完成，不能标全 PASS"]

    CLOUD -.-> BLOCK["云验收阻塞<br/>未提供专用 ECS / OSS / 云凭据"]
    ADB -.-> LICENSE["待确认：Agent 生产服务许可方案<br/>已有 LangGraph 许可或自建服务"]
    REL -.-> GH["外发阻塞<br/>GitHub issue/push 自动审批被拒<br/>已有授权问题待答复"]

    classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef accepted fill:#f3e8ff,stroke:#9333ea,color:#581c87;
    classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef active fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
    classDef pending fill:#f1f5f9,stroke:#94a3b8,color:#334155;
    class CFG,REL,WEB,OSS,FILE,DB,BACK,SEC done;
    class CFGV,RELV,OSSV,FILEV,DBV,BACKV accepted;
    class PRE,WEBRUN,ADB,RUN active;
    class BLOCK,LICENSE,GH blocked;
    class T,CLOUD pending;
```

## 本轮新增事实

- 文件链路：`76dced869` 已完成真实图关联撤回、归属校验和导出按钮回归；父分支已集成为 `ae1c7697e`。
- 备份恢复：`90b784f69` 已完成真实 PostgreSQL 16 新库恢复、强制 RLS 保留、覆盖/同源/篡改拒绝；父分支集成为 `5b57dbfc2`。独立 PR 为 #3433；不把 PR 创建等同 CI/云验收通过。
- 稳定密钥：`fb790f3ff` 的目录 fsync 和取消传播已集成为 `9810aa818`；Starter Agent 新密钥/独立数据库的扩展仍在开发。
- Web 自托管字体已提交 `c65c6707e`，父集成为 `0489e10ae`；最终镜像构建、域名无关 API 地址与 WebSocket 回归仍在做，因此不标镜像验收紫色。
- 主 agent 的真实 Agent 回复与沙箱取消探针 9 条测试通过；编排接线 3 条 mock 测试通过。尚未提交的接线只标蓝色，不凭测试数字标绿色或真实云 PASS。
- API 镜像、原始 Compose env 与数据库验收均为各自注明的源 commit；最终整合 SHA 必须重新构建和验证。

## 并行开发分工

| 执行者 | 当前工作 |
|---|---|
| release_artifacts | Web 不依赖外网字体、跨域名复用同一镜像、真实构建与页面/字体验收 |
| data_initialization | Starter Agent 独立数据库/角色及幂等测试；跟进数据与备份 PR |
| file_agent_paths | TLS 参数与真实证书预检；只读审查父 provision 取消和协议边界 |
| 主 agent | provision CLI、服务隔离配置、真实业务探针、阶段报告、取消清理、持续集成和文档 |

编译受本机内存限制时错峰，其他代码与测试仍并行。红色条件只影响对应的外发或真实验收，不停止可独立开发的工作。
