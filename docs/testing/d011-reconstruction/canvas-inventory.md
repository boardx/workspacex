# D011 全画布源码调用清单

核查当前 active HEAD 394fa189e96ff3d41c1bf80c43cd6d6bc0e85164。只读源码与真实本地注册表加载，无模型/DB/部署调用。devapp已部署内容、权限和运行结果均未验证。

## 内置注册表（实际运行加载 20 个）

权威中文名：packages/contracts/src/canvas.ts 的 BUILTIN_CANVAS_TEMPLATES；真实注册：packages/fabric-markdown/src/templates-entry.ts。用途是依据模板内容的解释，并非新增工具能力。

| key | 中文名 | 用途 | 实际分区 |
|---|---|---|---|
| persona | 用户画像 | 描述用户背景、目标、行为与痛点 | 用户描述；目标和需求；行为与偏好；痛点和挑战；动机；影响因素 |
| pestel | PESTEL 分析 | 分析宏观环境六类因素 | 政治因素；经济因素；社会因素；技术因素；环境因素；法律因素 |
| swot | SWOT 分析 | 分析优势、劣势、机会与威胁 | 优势；劣势；机会；威胁 |
| bmc | 商业模式画布 | 梳理商业模式九要素 | 关键合作伙伴；关键业务；关键资源；价值主张；客户关系；渠道；客户细分；收入来源；成本结构 |
| mvp | MVP 实验画布 | 设计最小可行实验与验证 | 早期客户；未满足需求；价值主张；愿景与假设；核心用户旅程；实验设计；早期关键指标；实验结果与下一步 |
| three-horizons | 三地平线模型 | 规划近期、中期、远期创新 | H1 焦点领域；H2 焦点领域；H3 焦点领域；第一地平线（1-3年）；第二地平线（3-5年）；第三地平线（5年以上） |
| ai-strategy | AI 战略画布 | 规划AI战略及实施 | 资源配置；AI角色定位；风格调性；背景信息；企业定位；产品服务；目标受众；规则；需求与目标 |
| ai-bmc | AI 商业模型画布 | 梳理AI业务的商业模式 | 核心合作伙伴；输入；输出；价值主张；技术能力；训练人员；用户与客户；资源考量；渠道；成本；收入来源；利益相关方 |
| empathy | 同理心地图 | 整理用户所想所感、所见所闻、言行及痛点收益 | 想的与感受到的；听到的；看到的；说的与做的；痛点；收益 |
| jtbd | 待完成工作画布 | 梳理用户待完成工作及情境 | 情境触发；核心任务；期望成果；内在驱动；痛点阻力；成功标准 |
| journey-map | 用户旅程图 | 梳理用户旅程阶段、行为与体验 | 行为 · 阶段1；行为 · 阶段2；行为 · 阶段3；行为 · 阶段4；行为 · 阶段5；触点 · 阶段1；触点 · 阶段2；触点 · 阶段3；触点 · 阶段4；触点 · 阶段5；痛点 · 阶段1；痛点 · 阶段2；痛点 · 阶段3；痛点 · 阶段4；痛点 · 阶段5；机会 · 阶段1；机会 · 阶段2；机会 · 阶段3；机会 · 阶段4；机会 · 阶段5 |
| value-proposition | 价值主张画布 | 对齐客户工作、痛点收益与产品价值 | 收益创造；痛点缓解；产品与服务；用户任务；收益；痛点 |
| adlib | 价值主张宣言 | 形成价值主张陈述 | 我们的；帮助；想要实现；减少或避免；提升或赋能；竞争对手价值主张 |
| hmw | HMW 问题陈述 | 构造如何可能的问题陈述 | 想法1；想法2；想法3；想法4；想法5；想法6；想法7；想法8 |
| freytag | 戏剧结构金字塔 | 设计故事冲突与叙事结构 | 高光点；情节演进；结束；开场；冲突；收尾；角色设定；故事主题 |
| burger | 汉堡沟通模型 | 组织沟通表达 | 开场引入；核心洞察 WHY；实现路径 HOW；解决方案 WHAT；行动闭环 |
| golden-circle | 黄金圈法则 | 梳理为什么、如何、做什么 | WHY；HOW；WHAT |
| three-lenses | 三视角模型 | 评估用户需求、技术可行与商业可持续 | 人本期望 Desirability；技术可行 Feasibility；商业可行 Viability |
| storyboard | 故事板 | 用场景序列表达方案 | 1 开场；2 冲突；3 情节演进；4 高光点；5 结束；6 收尾 |
| maau | MAAU 画布 | 定义最小可执行Agent单元、分工、上下文及验证 | 意图 Intent；用户 User；人与 Agent 分工；工作流 Workflow；上下文 Context；闭环验证 Validation |

## 组织模板与正常人类入口

GET /canvas/templates：组织库和平台母版，包含 key/displayName/version/status/sections/layoutSource/promptText/recommendAfter；平台行只读，adoptTemplate 才复制为组织自有。createTemplate→updateTemplateDraft/Metadata→mintTemplateVersion→publishTemplate；trialTemplate 与 bindTemplateToSegment→instantiateForSegment 是真实源码实例化入口。组织模板 key 不限内置20个，当前具体组织清单需授权实时列表，不能由源码编造。前端 fence-template-resolver.ts 查询组织库，user-edited 布局覆盖同名内置；未知组织key无数据则诚实错误。MAAU工作流图是第二个 mermaid sequenceDiagram 围栏，非模板内部嵌套图。

## D011 当前实际可调用工具与缺口

原生 factory 注册 standard_canvas_tools()，只有 wx_canvas_read 与 wx_canvas_update（packages/contracts/src/standard-canvas-tools.ts；apps/deep-agent-service/src/deep_agent_service/standard_canvas_tools.py；native_factory.py）。read需要已知 canvasId，返回source/revision/versionId/contentHash及renderSource，后者不是截图；update仅replace-source，需expectedRevision与stable idempotencyKey，既有鉴权、组写权限、CAS、幂等。不存在按模板key限制，因此可更新有权限且已实例化的任意内置或组织画布。不能把工具已注册当作D011当前账号获准或devapp部署通过。

### 路径纠正：Chat 围栏生成已经存在

execute-run.ts:601 每轮读取 requester 可见的已发布组织模板，将动态模板/分区字典注入 prompt；selectGuidanceTemplates 的 all 模式包含整个可见已发布库，matched 模式要求生成意图+模板名称匹配，未指名的画布生成请求则给整个库。围栏校正表始终保留完整可见库，不受 prompt 缩小影响。由模型输出 canvas/persona 围栏→模板解析/注册→Fabric 渲染→Chat 最大化编辑→landAsArtifact 持久产物，是已有正常生成与编辑保存路径，不需要新增权限工具才能生成既有画布。这里的“实例化”指生成可编辑画布对象，不能混同 agenda CanvasInstance 数据库实例。

当前独立标准工具闭集未暴露模板列表/项目实例列表/实例创建/布局坐标/PNG或PDF下载；这是该工具路径的覆盖范围，并不证明整个 Chat 不能发现、选择或生成模板。D011 可用动态 prompt 选型并输出围栏，标准 wx_canvas_read/update 则面向已有 canvasId，两条路径分别验收。生成围栏保存的artifactId不能冒充canvasId。无需为了围栏生成额外创建权限工具或自动增权。

按中文名请求是否覆盖全20：真实 selectGuidanceTemplates 在 synthetic完整注册目录上逐项运行“请生成<中文名>画布”，20/20包含对应key，无源码固定子集限制。生产可选范围仍受 listPublished 的发布状态、组织/团队可见性及仓储读取是否成功限制；不能由本地20证明当前devapp组织20个均已发布可见。提示注入失败会降级无字典，不能宣称生成成功。

## 其他画布家族：20工作坊不等于所有绘图

标准图表契约 MermaidDiagramType 有12种：flowchart（流程图）、sequenceDiagram（时序图）、classDiagram（类图）、stateDiagram（状态图）、erDiagram（实体关系图）、journey（旅程图）、gantt（甘特图）、pie（饼图）、quadrantChart（象限图）、mindmap（思维导图）、timeline（时间线）、gitGraph（Git分支图）。注意标准journey图与工作坊journey-map模板是不同家族。

fabric-markdown 实际插件另支持 xychart（XY图表）与 usecase（独立usecase围栏的用例图）；xychart插件存在不等于它进入12型组织白名单/系统prompt，需分别检查调用链。flowchart/class/state/sequence走核心mermaid-parser，其余插件在diagrams/index.ts激活；template/persona则是另一条模板转换。

还存在产品自由协作白板：apps/web/components/whiteboard/live-board.tsx、collaborative-thinking-editor.tsx、fabric/board-fabric-surface.tsx，canonical文档/命令在packages/whiteboard-core，Fabric只投影并经command port提交与Yjs同步。它不等同canvas模板或mermaid源；不能假设wx_canvas_update可操作该白板。自由白板的D011授权命令入口/实际部署使用能力本轮未证实，记为待核查，而非不存在。

## 实际本地逐模板证据与剩余验收

脚本 /tmp/core-output-canvas/all-template-roundtrip.ts 使用真实模板注册/解析/序列化函数，20个模板各向全部分区填入明确 synthetic便签，生成IR后逐便签编辑，再序列化写本地文件并重新解析，逐字检查编辑内容与字面HTML实体保留；另逐项检验中文名 matched prompt 选择。node --import tsx 执行 exit0，20/20回读、20/20名称匹配。逐项节点/便签数与路径在all-template-roundtrip-results.json，实际.md文件在all-template-artifacts/。

这是实际纯模板IR和本地文件读回，不是mock模型，也不是20/20 devapp/native模型生成通过。未调用provider、真实DB、真实账号或上传。浏览器真实Fabric渲染、artifact持久化再开、PNG/PDF非空下载，以及部署版本、D011所挂可见模板和权限需分别验收。已有源码能完成围栏生成链，当前不足是部署/真实运行证据，不能以独立工具数量断言生成能力缺失。
