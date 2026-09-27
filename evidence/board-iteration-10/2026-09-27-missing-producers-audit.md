# R10 缺失真实验收 producer 审计

- 审计对象：`0eb94db0692a5329264bee4d054125a71cae5d96`，issue #4257。
- 范围：只读检查该 SHA 的验收源码、PRD 与统一十轮计划；没有运行浏览器、Docker、真实 API 或数据库。本文不代表任何行为通过，也不推断其他分支已集成。
- 权威参照：`phases/phase-19-board-visual-workspace/design-deltas/2026-09-26-unified-board-plan.md`、同阶段 `requirements/00-source-prd.md`、`06-ai-chat-handoff.md`、`07-interchange-storage.md`、`08-performance-accessibility.md`。
- 既有 1k/5k/10k 性能及 50-client soak producer 不重复审计；这里只记录它们在矩阵中的接线状态，不能据此推定已运行。

## 结论

`apps/web/scripts/board-acceptance-matrix.mjs` 共 12 条 lane；3 条性能和 1 条协作 soak 有命令，另外 **8 条 command=null**。这只是接线计数，不是 PRD 覆盖率。没有依据给出“已覆盖多少百分比”或九分评分。

`verify-board-acceptance-evidence.mjs` 当前仅有 performance / collaboration-50 的专用内容验证分支，最终仍固定 `approved:false, score:null`。补齐 producer 时还必须补相应产物 schema、结果验证与反证，最后才能依据完整证据改变放行逻辑；不能仅把 null 换成任意退出码 0 的脚本。

真实模型 AI 聚类及 Chat Mermaid/Fabric 布局交接没有独立 lane，也不能由现有六旅程标题吸收。其结果需要被 journeys 的必需子项或新的显式 lane 强制校验。

## 缺失 lane 与最小实施包

优先级：P0 为阻止当前核心可用性、内容安全或真实旅程闭环的缺口；P1 为本期仍必须完成、可在底层依赖接通后并行开发的完整门。优先级不改变原 PRD P0/P1 范围。

| lane | 当前证据不足的具体位置 | 最小真实 producer 与必需产物 | 依赖 / 优先级 |
|---|---|---|---|
| visual | 矩阵有视觉门，但无 producer/专用 validator；便利贴 benchmark 是预览审查清单，不是当前集成 SHA 的截图评分 | 正式浏览页+空板+编辑/多选+长中文便利贴+Panel/Connector+属性弹层，固定三种 viewport，截图/录像及每状态 canonical id；检查文字不畸变、菜单不重叠、选中对象不被盖、触摸目标可达；独立评审逐维度评分与否决项、失败截图及 exact build 绑定 | R2/R3/R6 集成；P0，用户最新 0 分反馈应先形成可见改善证据 |
| journeys | `board-final-acceptance.spec.ts` 有6条真实动作规格，但 command=null，没有旅程产物验证器；第6条明确是预生成 proposal，非真实模型聚类 | 为6旅程生成统一报告：起止、动作时间线、断言结果、对象id/geometry、第二客户端及刷新结果、视频/trace；复用现有规格补齐统计和独立子项，不以可收集测试数计通过 | R5/R6/R7/R9正式能力；P0 |
| api-ws-objectstore | 没有独立 producer。浏览器里看到“已同步”不等于API/WS/文件三层交叉校验 | UI写→捕获真实updateId/gesture ACK/seq→API canonical Read→文件manifest/hash→第二客户端→进程重启/刷新；反向API写→两个浏览器与文件一致。记录各层revision/hash、原始ACK、持久化指针及拒绝结果 | R7/R8/R9；P0，存储/恢复/安全共用基础 |
| storage | `board-import-storage.spec.ts` 没有PG查询、存储读取、故障注入或联合恢复 | filesystem和Hosted adapter分别跑真实内容写入；PG表正文列与字节增长分类采样（元数据/审计允许增长，正文不得复制）；upload/pointer事务失败、ACK后断电/进程退出、缺失/损坏blob、checkpoint fallback、GC与copy/backup/legal-hold roots、联合backup/restore hash；保留故障前后head/文件hash/SQL结果 | R8可控隔离服务和真实adapter/KMS配置；P0；故障操作限验收隔离数据 |
| security | `board-security.spec.ts` 只有匿名head 401及伪造actor 403，没有第二租户、WS、blob或撤权 | 两个真实组织、owner/editor/commenter/viewer/受限Agent；API读写/评论/导出、真实WS握手及更新、原件/媒体/签名URL负向矩阵；活跃连接撤权清空+后续写拒绝，重放/过期/跨租户ID与source artifact；确保拒绝后无mutation、无新对象/可见blob | R7 ACL、R8下载/媒体、R9委托；P0 |
| import | 同名spec自行构造1个Miro sticker JSON，不能抵扣真实供应商迁移；未覆盖Mural、三块板、媒体/关系/Frame/Group、loss report核对或重新导入 | 至少3块授权脱敏真实供应商板，覆盖Miro/Mural；原件来源/版本/hash+原始截图；真实向导预览/确认，逐source id比对文字/样式/geometry/parent/connector/媒体；所有降级/跳过逐项有报告；幂等重试、取消与失败恢复；导出后重新导入并比对canonical语义及资产hash | R8 importer+扫描/asset持久化；真实数据需合法现有导出或官方授权连接，不能自造包声称真实；P1 |
| accessibility | `board-accessibility-input.spec.ts` 检查页面可见+axe、设置CSS zoom、合成pointerdown/up，没有证明屏幕阅读器、触摸拖动/缩放、笔压矢量结果或reflow操作可达 | Chromium/Firefox/WebKit核心键盘流，焦点顺序/恢复/远端删除播报；真实屏幕阅读器输出/录屏；200%/400%浏览器缩放下关键控件与对象编辑可达；RTL/高对比/reduced motion；触屏真实pan/pinch/select/drag/text，stylus连续pressure输入且canonical points/pressure与视觉变化一致；axe只是子项 | R6对象大纲/紧凑菜单、R4笔画、R7远端事件；浏览器仿真与真机证据分开，不能合成事件抵扣硬件行为；P1 |
| meeting-room | 矩阵未接命令；没有会议室生命周期producer。普通50-client soak与短presenter跟随不是该证据 | 独立会议室/大屏/控制端真实身份加入、presenter选择、跟随及主动退出；连续≥30分钟有单调时钟/签名ledger、每段viewport revision与对象revision；切换主持人、手工pan取消跟随、断线重连不回退、撤权/离开清理；触摸界面录像及设备信息 | R9会议室接入与R7presence；单独运行、独立ledger，不能重复使用普通soak ledger；P1 |

## 两个不能漏掉的 R9 子门

### 真实模型 AI Organize（PRD 36、47、53、57、60）— P0

现有第6旅程的命名和注释已明确边界：`AI Ready API ... pre-generated 30-note proposal ... (not model clustering)`。它验证事务/确认/撤销与受托 API，**不能证明模型读了30条文本、判断主题、命名、创建Panel或≤2次操作**。

最小实施：实际 UI 选30条有混合主题且事先未附cluster标签的文本→点击AI Organize→真实模型/skill执行 canonical Read→生成含引用对象版本的proposal→预览确认。记录脱敏模型run id、模型/skill版本、对象输入hash、原始输出与proposal关联、主题命名和覆盖/遗漏报告、真实用户动作计数。确认前零mutation，确认后所有对象恰好归类、布局合理且无静默丢失；一次Undo回到原状态。另跑模型超时/取消/越权/过期revision并发反证，拒绝时不能部分写入。质量判断需独立人审/固定语义标准，不能以“有3个Panel”作为语义正确。

依赖：R9真实模型调用和工具权限链、canonical Read、proposal UI、批量Undo；参考仓库真实模型专用lane，不能沿用确定性loopback替身。真实模型凭据仅运行环境注入，不进入trace或报告。

### Chat图形原布局插入（追加要求、统一计划R9）— P1

当前R10相关Board specs没有flowchart/sequence/persona从Chat真实artifact点击插入Board的producer。最小实施：3类真实渲染图分别从点击时Fabric场景提取layout hash；通过可见“插入Board”流程，经source artifact和target Board双ACL后，与两个浏览器中的对象world geometry/style/边/分组比对；刷新、幂等重试、选区子集及stale-source拒绝、Undo。重新解析Mermaid得到近似排版不算通过。

## PRD 1–60追溯边界

此表覆盖全部章节的审计归属，不宣称每条功能已实现。每个细项必须在最终requirement→case→artifact索引中展开，不能用一个大场景标题抵扣全部细项。

| PRD章节 | 归属及尚需闭合的证据 |
|---|---|
| 1–3 | R1统一Visual/Structural/Semantic对象；跨API/WS/存储的同ID与语义，不仅截图 |
| 4–5 | R1/R6全屏Canvas和底部一级工具，视觉/键盘/触屏lane；原左栏被后续底部dock要求覆盖 |
| 6–9 | R3 Sticky四创建路径、Tab方向/间距、全部样式与尺寸模式；journeys只证明其中子集，需逐状态视觉+IME+Undo |
| 10–13 | R3/R4文字五层级、格式/列表/链接以及Tile结构字段；类型存在不抵扣交互、持久化与协作 |
| 14–16 | R5 Panel三模式、拖入/嵌套/复制/删除保留/clip/autoexpand；Panel旅程仅移动10子对象 |
| 17–23 | R4/R5形状集合与样式，Connector三route/tip/style/label/attachment；ABC旅程仅绑定及随动 |
| 24–27 | R4矢量draw四工具/压感，图片所有输入/格式/编辑/替换/下载；混排旅程不等于完整编辑矩阵 |
| 28–35 | R6选择、全部Align/Distribute/Layout/Guides/Smart建议；grid旅程不能抵扣其它策略与取消零写入 |
| 36 | R9真实模型聚类门，现有prepared proposal不足 |
| 37–41 | R3/R4/R6上下文工具、精确属性、全部DnD/快捷键/复制；visual+a11y+真实操作逐项 |
| 42–44 | R5 layer/lock/group及Panel语义区别；ACL/批量操作不可绕过锁定 |
| 45–47 | R7评论/多人/所有对象Undo；real live spec可复用但最终同SHA需事件、重连和peer证据 |
| 48–49 | R3智能paste/bulk100行，实际选择分支、计数、一次Undo及IMЕ边界 |
| 50–53 | R1/R9统一模型/connector semanticRelation/event/Agent操作；跨层lane及真实模型子门 |
| 54–55 | 全部P0/P1；Template/Table/Icon/LinkPreview/Tag/Reaction等不能因非六旅程主角而省略 |
| 56 | P2保留路线，不计V0.1已完成，也不新增为此次九分阻断项 |
| 57–60 | 六体验指标+六旅程+语义共同空间；AI全链动作指标仍缺，所有前述硬门必须同集成SHA |

## 建议开发顺序与并行边界

1. **先补视觉与六旅程报告**：R6集成后形成用户能看见的截图对照，明确遮挡/字体/可达性否决项；journeys只接真实已实现范围，AI不足继续红。
2. **并行三个独立实施包**：A视觉/键盘/读屏/触控；B跨层持久化+storage/security；C真实模型AI+Chat交接。共享runner/报告schema由一个owner接线，避免各自定义第二套阈值。
3. **R8接通后**完成3真实迁移板；**R9接通后**单独会议室长时。数据或硬件不可用时明确blocked/not-run及具体缺件，不能用fixture或单测替换。
4. 主session集中在同一集成SHA运行。失败修复只重跑受影响链路；最终证据目录必须列出每细项的case、原始产物hash、环境/构建身份和独立review。CI绿、运行证据、视觉评分分开记录。

所有producer需保留失败产物；清理只针对本次创建的隔离资源。目录名、脚本存在、测试collect、样例ledger、unit退出码、历史PR合并均不构成真实验收通过。
