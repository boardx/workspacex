# 实施过程与证据快照

2026-09-07，跟踪 issue #2864。此图是实施记录，不是 feature passing 状态；绿色只表示框内范围已验证提交，黄色为未完成的开发/验收，红色为阻断，灰色为待实现或接入，蓝色由 peer 负责。跨会话边界见 [peer-boundaries.md](peer-boundaries.md)。

```mermaid
flowchart TD
  A[核对现有实现与75项目录]:::verified --> B[19个共享工作包：逐编号保留验收]
  B --> E1[WX-E001 本地及容器锁定依赖：a2e6de1c0]:::verified
  E1 --> E2[WX-E002 共享包契约：65327d7b1]:::verified
  E2 --> T11[WX-T011 真实假设确认：ac597acc5]:::verified
  E2 --> E4API[WX-E004 API完整包传输：7dcd2feaa]:::verified
  E2 --> E3[WX-E003 隔离沙箱及160次回收验证：751b16b34]:::verified
  E4API --> E4[WX-E004 原生Skills图：ebe8afe29]:::verified
  E3 --> E4
  E4 --> Scope[WX-T010 仅文本委派已验证；扩展文件授权待做]:::active
  E3 --> FileTests[T001–T008 官方文件行为证据：f9b1ca28a]:::verified
  FileTests --> ImageRead[WX-T002 有界图像传输：8b7fe404b，46项回归通过]:::verified
  ImageRead --> FileJoin[附件只读挂载与真实完整链：66d36f813]:::verified
  FileJoin --> NativeTrace[标准编号与实际ToolNode身份：50a4895cd]:::verified
  NativeTrace --> InputGate[附件当前可见性与完整链复测：66d36f813]:::verified
  E4 --> NativeJoin[可信factory、加密session与恢复：045f48ae5]:::verified
  E4 --> SkillEvents[实际Skill事实与必达journal：0e2bdb411 / 570abc19e]:::verified
  SkillEvents --> NativeAuthority[逐次工具授权与有界HTTP：0e2bdb411]:::verified
  SkillEvents -.契约对齐.-> Peer
  E4 --> Version[WX-E008 固定包版本兼容]
  E3 --> OutputStore[WX-E006 字节收集与UDS下载：16961012d、ff22a9e5a]:::verified
  OutputStore --> E6[W04 暂存与产物写回：045f48ae5]:::verified
  E4 --> E6
  E2 --> T42[WX-T042 文本子任务与独立回收期限：dd1079503]:::verified
  Peer[peer S2–S10：统一事件与主任务控制、插话审批、工作台与成果UI]:::peer
  E6 -.接入统一契约.-> Peer
  T42 --> PendingCancel[WX-T042 单个pending取消：352a506ba]:::verified
  PendingCancel --> T42Join[WX-T042 父取消与晚到入队阻断：4ef787b83]:::verified
  T42Join --> RunningCancel[WX-T042 running cancel: 5068ecb0a]:::verified
  T42Join -.复用统一控制契约.-> Peer
  E2 --> MCPSchema[WX-E005 完整schema及变更授权：53658daf1]:::verified
  MCPSchema --> MCP[WX-E005 anonymous, isolation and credential broker: 41d60d32f]:::verified:::active
  MCP -.复用准入与审批.-> Peer
  MCP --> Browser[W10 浏览器交互与网页产物]
  E4 --> Research[W06 搜索抓取：85f56f1a1；研究包：086155098]:::verified
  E4 --> Context[W07 项目与检索：35fc834dc；四项Skill：ce3399822]:::verified
  E3 --> Parse[W08 原件解析7d1126261、OCR50c6eac90；跨页表格待做]:::active
  E3 --> Office[W09 Office完整包与有限编辑：02f73bdff]:::verified
  Office --> Renderer[W09 隔离Office渲染与简单页面检查：274f4e8ad]:::verified
  E3 --> Data[W18 离线分析依赖与完整方法包：c917fdbae]:::verified
  E4 --> Canvas[W11 画布版本工具：ecfbee70f；Skill：776e2a9f7]:::verified
  E2 --> MemoryScope[W12 可信个人scope：1f2735a71]:::verified
  MemoryScope --> Memory[W12 持久Store、撤权、取消回滚及生产DI：b91057172]:::verified
  E2 --> Schedule[W13 持久调度接线1d86b1200；通知待接]:::active
  Schedule --> Notify[Persistent notification API verified; UI integration active]:::active:::blocked
  E6 --> Media[W14 image and WAV chain e2cb7a80a; long audio active]:::active:::active
  E4 --> Author[W15 草稿到产物再导入完整链：f51283005]:::verified
  E3 --> SQL[W17 官方SQL与取消反证：7d42283e3]:::verified
  E4 --> Methods[W19 两项方法包及导入源校验：ffbf307a2]:::verified
  Methods --> MethodDelivery[标准包启动发布与跨组织可见性：5aba6a788、d3c1c8c03]:::verified
  E6 --> Gate[逐任务测试、独立review、真实E2E]
  Peer --> Gate
  T42 --> Gate
  T42Join --> Gate
  Scope --> Gate
  FileTests --> Gate
  FileJoin --> Gate
  NativeJoin --> Gate
  Version --> Gate
  Browser --> Gate
  Research --> Gate
  Context --> Gate
  Parse --> Gate
  Renderer --> Gate
  Data --> Gate
  Canvas --> Gate
  Memory --> Gate
  Schedule --> Gate
  Media --> Gate
  Author --> Gate
  SQL --> Gate
  MethodDelivery --> Gate
  Gate --> Commits[每个任务独立commit]
  Commits --> Migration[迁移重放修复：e4b8e9b34，本地202项重放通过]:::verified
  Migration --> Push[已授权公开推送；远端检查点f1ecb4734]:::active
  Push --> PR[Draft PR #2869; latest main integrated 02f6b5c8c; CI pending]:::active:::active
  PR --> Main[等待后续整合main]
  Resource[3 active agents: long audio, organization retrieval, notifications]:::active:::active -.影响未完成工作.-> Gate
  classDef default fill:#eef0f3,stroke:#88909c,color:#20242a;
  classDef verified fill:#dcfce7,stroke:#15803d,color:#14532d;
  classDef active fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;
  classDef peer fill:#dbeafe,stroke:#2563eb,color:#1e3a8a;
```

当前图只记录具体组件的已验证提交，原始 75 项编号和逐项验收仍以 `capability-catalog.json` 为准。绿色不等于部署给所有终端用户，也不等于真实模型端到端验收通过。蓝色由 peer 实现，本分支负责接口集成。

原生生产 factory、加密 session、产物暂存与恢复已提交 045f48ae5。附件原件只读挂载、当前来源可见性与真实 Python→UDS→Nest→PG/ObjectStore 完整链提交 66d36f813；该链使用脚本模型，不替代真实模型验收。

W07 工具提交 35fc834dc，四项完整 Skill 提交 ce3399822；覆盖现有项目 API 与授权附件检索，仍不代表全组织五路检索。W11 源码版本读写、冲突与幂等回放工具提交 ecfbee70f，完整画布 Skill 提交 776e2a9f7；renderSource 是现有源码投影，不是像素截图。

已直接与「agent ux dev」协作，保留其同参数拒绝优先级和取消优先原子更新，分别集成于 1eb5f732c、a8d47eb89。原生暂停结算被取消抢先时释放 session 的修复提交 50b9d9a40，相关 6 文件 41 项回归通过。对方负责统一事件、主任务控制与工作台 UI；running 子任务取消及 MCP 接口依赖尚待继续对齐。

W17 官方 SQL Toolkit、独立只读角色、取消与超时反证已提交 7d42283e3。W08 AnyDoc 原件解析与 OCR 分别提交 7d1126261、50c6eac90，覆盖真实扫描 PDF、PNG/JPEG 与有界逐页处理；跨页表格和更细的 Office 定位仍未完成。

MCP 匿名工具已具备不可变审查与运行快照、逐调用审批和权限重验、隔离 Worker 与实际 ToolNode 接线，提交 0872c9b3d。凭据代理、治理中断确认和浏览器接入仍在开发，不能把匿名链的通过当作 E005 全部完成。

W15 完整草稿包、JSON 产物发布写回与管理员导入链已提交 f51283005；实际脚本验证和完整文件摘要均有测试。标准包发布已有跨组织普通用户 API 可见性证据，S015 平台发布提交f1ecb4734；W14 图片工具完整链提交1f1eee8cf，视觉包发布提交587f72955。

## 最新交付边界

- 本快照最新实现587f72955；最后成功推送f1ecb4734，正常门控13/13通过。随后提交图片1f1eee8cf、MCP重隔离47f11e590、调度1d86b1200及视觉包587f72955，待推送取得新SHA CI。
- main已整合为开发分支上的03b8361e7；唯一Dockerfile冲突保留冻结依赖安装及main的no-reload/并发参数，锁文件安装和实际CLI参数检查通过。没有把本PR合入main。
- MCP重隔离真实数据库/HTTP/Worker 14项、权限AST31项通过。只确认实际本地停止，远端结果保持unknown；凭据代理仍在开发。
- W13生产生命周期和父取消竞争反证通过，同一数据库事务连接覆盖授权与调度写入；持久通知适配器仍缺失，create明确拒绝，不宣称全用户调度可用。
- 图片完整链使用真实provider类、本地供应商协议fixture、真实TLS下载、沙箱解码及PG产物写回，未进行外部模型画质验收。参考图编辑不支持；新图片intent前缀自动清理仍待接入保留策略。
- 与peer初始接口协调已收到回复；后续任务工具Transport closed，未声称新消息送达。工作台与主run控制继续由peer负责。
- 三个并行agent继续音频、凭据、运行中子任务取消；DB测试按单栈串行。浏览器、文件委派、完整检索/表格定位、真实模型联合验收及最终CI仍未完成。
- 全部75项backlog尚未完成；绿色仅覆盖明确验证范围，不以提交数量估算百分比。

## Integration update: 2026-09-07

Latest main d30ac48e8 includes peer PR #2890 and is integrated in 02f6b5c8c. Credential broker 41d60d32f, running cancellation 5068ecb0a and WAV full chain e2cb7a80a are separately committed. Integrated working-tree API typecheck and 58 tests passed; evidence/ci/main-d30ac48e8 states which pending increments were present. CI repair is 246b2d9f4. Last successful push remains f1ecb4734; new-head CI is pending.

All three workers are active on long audio, organization retrieval and notifications. Root handles integration and commits without holding completed workers idle. Full browser, delegated files, complete retrieval/locators, live-model acceptance and final CI remain outstanding. Earlier narrative is historical; this update and scoped nodes state the latest verified boundary. No merge into main or complete 75-item claim.
