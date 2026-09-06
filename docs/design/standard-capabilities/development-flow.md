# 实施过程与证据快照

2026-09-07，跟踪 issue #2864。此图是实施记录，不是 feature passing 状态；绿色只表示框内范围已验证提交，黄色为进行中，灰色为待实现或接入，蓝色由 peer 负责。跨会话边界见 [peer-boundaries.md](peer-boundaries.md)。

```mermaid
flowchart TD
  A[核对现有实现与75项目录]:::verified --> B[19个共享工作包：逐编号保留验收]
  B --> E1[WX-E001 锁定环境基线：95测试与16工具schema]:::verified
  E1 --> E2[WX-E002 共享包契约：65327d7b1]:::verified
  E2 --> T11[WX-T011 真实假设确认：ac597acc5]:::verified
  E2 --> E4API[WX-E004 API完整包传输：7dcd2feaa]:::verified
  E2 --> E3[WX-E003 会话沙箱与官方Backend：b12638bd8]:::verified
  E4API --> E4[WX-E004 原生Skills图：实现与独立review中]:::active
  E3 --> E4
  E4 --> Scope[WX-T010 子代理授权及文件范围]
  E4 --> Version[WX-E008 固定包版本兼容]
  E3 --> E6[W04 native产物适配与取消原语]
  E4 --> E6
  E2 --> T42[WX-T042 文本子任务队列增量：06d1e5cce]:::verified
  Peer[peer S2–S10：统一事件与主任务控制、插话审批、工作台与成果UI]:::peer
  E6 -.接入统一契约.-> Peer
  T42 --> T42Join[WX-T042 父取消、产物及公共事件待接入]
  T42Join -.复用统一控制契约.-> Peer
  E2 --> MCP[WX-E005 LangChain MCP接线：现有实现差量审查中]:::active
  MCP --> Browser[W10 浏览器交互与网页产物]
  E4 --> Research[W06 搜索与研究工作流]
  E4 --> Context[W07 项目上下文、检索与写作]
  E3 --> Parse[W08 文档解析]
  E3 --> Office[W09 Office有限编辑与渲染QA]
  E3 --> Data[W18 数据分析与可视化]
  E4 --> Canvas[W11 画布与图表]
  E2 --> Memory[W12 用户记忆与撤销]
  E2 --> Schedule[W13 持久调度]
  E6 --> Media[W14 图片、音频与纪要]
  E4 --> Author[W15 完整Skill草稿包]
  E3 --> SQL[W17 只读SQL工具]
  E4 --> Methods[W19 研究方法包]
  E6 --> Gate[逐任务测试、独立review、真实E2E]
  Peer --> Gate
  T42 --> Gate
  T42Join --> Gate
  Scope --> Gate
  Version --> Gate
  Browser --> Gate
  Research --> Gate
  Context --> Gate
  Parse --> Gate
  Office --> Gate
  Data --> Gate
  Canvas --> Gate
  Memory --> Gate
  Schedule --> Gate
  Media --> Gate
  Author --> Gate
  SQL --> Gate
  Methods --> Gate
  Gate --> Commits[每个任务独立commit]
  Commits --> PR[单个汇总PR及全绿CI]
  PR --> Main[等待后续整合main]
  classDef default fill:#eef0f3,stroke:#88909c,color:#20242a;
  classDef verified fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef active fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  classDef peer fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
```

W01 基础分开显示；W03 API 传输通过不代表原生加载已完成。WX-E003 最终 sessions-only 镜像、HTTP 隔离链和官方 Backend 已验证提交，原生图接线仍在进行。WX-T042 文本子任务持久化、权限、幂等和受限执行已验证提交；父取消、产物和公共事件仍待集成，不代表 W16 全部验收。蓝色节点保留集成验收责任，不在本分支重复建设。

原始 75 项编号、场景、重要程度和验收范围见 `capability-catalog.json`；本图没有删除灰色任务，也不以已有提交数量换算总体完成百分比。

当前执行顺序：完成 E004 原生 Skills 图的独立 review 和未知执行结果禁止重试的回归，再接 E005 已有 MCP 治理。E004 已运行固定脚本并下载真实产物，但尚未提交，也尚未启用生产 factory；因此保持黄色。T010 与 E008 单列为待完成，不把 E004 的局部结果扩展为整个 W03 已完成。
