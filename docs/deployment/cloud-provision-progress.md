# 云部署 P0/P1 进度与验收

核验日期：2026-09-11。目标不变：Starter 和 production 两档，初始化前提满足后 300 秒 provision。所有状态均按下述具体范围判断，子项完成不代表整个 CP 交付包完成。

## 颜色规则

- **绿色＝完成**：该节点描述的实现已完成、验证通过并提交；必须附 commit。
- **紫色＝验收通过**：必须注明验收层级、证据和被验收 commit。代码/CI 验收不等于真实云交付验收。
- **红色＝阻塞或需用户确认**：列出具体原因和影响范围；不因一个云验收阻塞而停止其他开发。
- 灰色＝待完成；蓝色＝开发中。没有提交的工作不能标绿。

```mermaid
flowchart TD
    TARGET["目标：两档云部署 / 300 秒 provision<br/>整体尚未完成或验收"]
    TARGET --> A["CP-01a 参数入口 · 完成<br/>Schema / 示例 / CLI<br/>commit a688e8778"]
    A --> AV["参数入口代码验收 · 通过<br/>28 项测试 / CI / PR 3415 已合并<br/>merge 12bb7fe82"]
    A --> B["CP-01b 云预检与环境 profile<br/>待完成"]
    TARGET --> C["CP-02 不可变发布制品与预热<br/>release_artifacts 并行开发中"]
    A --> D["CP-03a OSS 适配实现 · 完成<br/>读写 / 校验 / API 接线 / 参数映射<br/>commit caf9d561a"]
    D --> DV["OSS 代码与集成测试验收 · 通过<br/>35 项 API 测试 + 30 项配置测试 / CI<br/>commit caf9d561a / merge 979763543"]
    D --> DP["CP-03b 桶策略自动核验<br/>待完成"]
    D --> E["CP-04 全文件链路<br/>file_agent_paths 并行开发中"]
    A --> F["CP-05 数据与管理员初始化<br/>data_initialization 并行开发中"]
    C --> G["CP-06 Agent / Sandbox 生产运行<br/>待完成"]
    E --> G
    F --> G
    B --> H["CP-07a 编排核心库 · 完成<br/>deadline / 锁 / 报告 / 取消 / 幂等密钥<br/>commit f19cc290e · 本地49项测试通过"]
    H --> HI["CP-07b 实际部署阶段接线<br/>主 agent 持续集成中"]
    G --> HI
    HI --> I["CP-08 三次云安装计时与故障验收<br/>待完成"]
    DV --> BLOCK["仅真实云验收条件阻塞<br/>未配置专用测试桶、目标 ECS 及凭据<br/>其他代码开发继续"]
    BLOCK -.-> I
    G --> LICENSE["待用户选择：Agent生产服务<br/>LangGraph许可前提 或 自建服务<br/>其他开发不受影响"]
    C --> GH["待用户授权：外部发布范围<br/>agent创建GitHub issue被自动审批拒绝<br/>本地开发与commit继续"]
    classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
    classDef accepted fill:#f3e8ff,stroke:#9333ea,color:#581c87;
    classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
    classDef active fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
    classDef pending fill:#f1f5f9,stroke:#94a3b8,color:#334155;
    class A,D,H done;
    class AV,DV accepted;
    class BLOCK,LICENSE,GH blocked;
    class C,E,F,HI active;
    class TARGET,B,DP,G,I pending;
```

## 可核验证据

| 节点 | 实现 commit | 合并与验收 | 尚不代表 |
|---|---|---|---|
| CP-01a | `a688e8778` | [PR #3415](https://github.com/boardx/workspacex/pull/3415)，合并 `12bb7fe82`；28 项配置测试与 CI 通过 | 云资源预检完成 |
| CP-03a | `caf9d561a`（包含 `ec129ed73` 和 `9bab3b970`） | [PR #3419](https://github.com/boardx/workspacex/pull/3419)，已合并 `979763543`；35 项 API 存储/契约测试、30 项部署配置测试及 CI 通过 | 真实 OSS 桶验收、完整文件生命周期或生产验收 |
| CP-07a | `f19cc290e`，本地提交 | [Issue #3424](https://github.com/boardx/workspacex/issues/3424)；本地部署包 49 项测试通过，含 19 项编排/子进程/密钥测试，类型/lint 通过；待 PR/CI | 已接通实际部署命令，或五分钟目标达成 |

上轮 CI 的契约单一来源失败已由 `caf9d561a` 修复，不再列为红色。跳过的 CI 项不算通过。

**整体判断：8 个交付包尚未全部完成，真实云交付验收尚未通过，不能把整图涂绿或涂紫。** 云条件只影响对应真实验收；不等待这些条件，持续完成可独立开发与验证的工作。
