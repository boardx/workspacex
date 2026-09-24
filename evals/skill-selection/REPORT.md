# 技能入选评审报告（自动生成）

> 由 `evals/skill-selection/score.mjs` 生成，**不要手改**。标准：`docs/proposals/PROP-EXPERT-COMMUNITY-001-skill-selection-standard.md`；权重与阈值：`rubric.json` v1.1.0。

评审 645 个 skill（校验错误 0，警告 0）。

## 1. 权重与阈值（来自 rubric.json）

| 组 | 维度 | 权重 |
|---|---|---|
| S | S1 协作闭环 | 14 |
| S | S2 组织大脑复利 | 10 |
| S | S3 可组合性 | 9 |
| U | U1 使用频率 | 9 |
| U | U2 单次价值 | 11 |
| U | U3 目标客群覆盖 | 9 |
| Q | Q1 专业深度 | 9 |
| Q | Q2 可操作性与输出契约 | 7 |
| Q | Q3 护栏 | 7 |
| Q | Q4 可测试性 | 5 |
| H | H1 上游维护 | 5 |
| H | H2 采用证据 | 5 |

就绪分 R：R1 依赖就绪 50，R2 适配成本 30，R3 本地化成本 20。
层级阈值：A ≥ 68，B ≥ 55，C ≥ 40；边界带 ±5；客群上限：U3 ≤ 1 时最高 C 层。
波次：R1 ≥ 4 且 R ≥ 60 → W1；R1 ≥ 3 → W2；其余 W3。

## 2. 总览

层级：A 104 · B 218 · C 191 · D 132

双人共识定层 161 个；仍待定（单人评分且 V 在 A 阈值 ±5 分内，需第二评审或实测评测）14 个；客群上限压层 26 个。

A 层波次：W1 31 · W2 66 · W3 7

| 来源包 | 评审数 | A | B | C | D | V 中位数 |
|---|---|---|---|---|---|---|
| anthropics/knowledge-work-plugins | 181 | 42 | 83 | 53 | 3 | 61.6 |
| anthropics/claude-for-legal | 151 | 47 | 33 | 45 | 26 | 59.9 |
| anthropics/knowledge-work-plugins#partner-built | 71 | 0 | 6 | 7 | 58 | 33.2 |
| anthropics/financial-services | 61 | 2 | 41 | 11 | 7 | 59.4 |
| coreyhaines31/marketingskills | 50 | 6 | 25 | 19 | 0 | 57.8 |
| alirezarezvani/claude-skills | 40 | 4 | 20 | 13 | 3 | 59.4 |
| AgriciDaniel/claude-seo | 35 | 0 | 4 | 24 | 7 | 48.0 |
| wshobson/agents | 15 | 0 | 4 | 7 | 4 | 46.6 |
| JoelLewis/finance_skills | 12 | 0 | 1 | 6 | 5 | 43.2 |
| tuanductran/hr-skills | 10 | 0 | 0 | 3 | 7 | 39.8 |
| RefoundAI/lenny-skills | 8 | 0 | 0 | 2 | 6 | 37.2 |
| anthropics/skills | 6 | 3 | 0 | 1 | 2 | 73.8 |
| deanpeters/Product-Manager-Skills | 4 | 0 | 0 | 0 | 4 | 61.2 |
| evolsb/claude-legal-skill | 1 | 0 | 1 | 0 | 0 | 59.4 |

## 3. 标准自检

### 3.1 评审员一致性（独立盲评）

配对样本 38 个。

- 每维平均绝对差（均值）0.43（合格线 ≤ 0.8）✅
- 边界带（阈值 ±5）外的层级一致率 100%，样本 6 个（合格线 ≥ 75%）✅
- 相邻层级一致率（相差不超过一层）100%（合格线 ≥ 95%）✅
- 参考：全体层级一致率 63%；V 平均差 4.8 分；建议一致率 71%

层级不一致的配对（第一评审 / 第二评审）：

| id | 第一评审 | 第二评审 | 在边界带内 |
|---|---|---|---|
| kwp/sales/account-context | B 67.2 | A 69.8 | 是 |
| kwp/sales/crm-hygiene-check | C 56.2 | B 58.4 | 是 |
| kwp/enterprise-search/search-strategy | B 64.4 | A 69.2 | 是 |
| kwp/small-business/canva-creator | B 65.2 | C 57.4 | 是 |
| kwp/small-business/close-month | B 67.6 | C 55.0 | 是 |
| kwp/small-business/lead-finder | B 62.8 | A 68.4 | 是 |
| kwp/engineering/code-review | B 58.0 | C 53.0 | 是 |
| legal/ai-governance-legal/matter-workspace | C 47.0 | B 56.2 | 是 |
| legal/ip-legal/matter-workspace | C 50.6 | B 56.2 | 是 |
| legal/commercial-legal/cold-start-interview | B 65.4 | A 73.2 | 是 |
| legal/employment-legal/investigation-summary | B 57.8 | C 40.0 | 是 |
| legal/legal-clinic/customize | D 28.6 | C 41.2 | 是 |
| legal/legal-builder-hub/customize | D 30.4 | C 41.2 | 是 |
| fs/fund-admin/roll-forward | B 59.4 | C 53.4 | 是 |

| 维度 | 平均绝对差 |
|---|---|
| U3 | 0.63 |
| Q3 | 0.55 |
| R2 | 0.53 |
| S2 | 0.50 |
| S3 | 0.50 |
| Q4 | 0.47 |
| Q1 | 0.45 |
| S1 | 0.37 |
| R1 | 0.37 |
| Q2 | 0.34 |
| R3 | 0.34 |
| U1 | 0.32 |
| U2 | 0.24 |

### 3.1b 边界带补评（不计入上面的随机样本统计）

补评 123 个（第一评审 V 在 A 阈值 ±5 内）。每维平均绝对差 0.39；V 平均差 4.1 分。这些 skill 的层级以两人逐维平均的共识分为准。

### 3.2 权重敏感性（各组权重 ±20%）

| 组 | 扰动 | 层级改变的 skill | 比例 |
|---|---|---|---|
| S | +20% | 21 | 3% |
| S | −20% | 11 | 2% |
| U | +20% | 12 | 2% |
| U | −20% | 13 | 2% |
| Q | +20% | 17 | 3% |
| Q | −20% | 21 | 3% |
| H | +20% | 10 | 2% |
| H | −20% | 24 | 4% |

最大比例 4%（合格线 ≤ 15%）✅ 结论对权重不敏感。

## 4. 能力拉动（按被挡住的 A/B 层价值排序）

| 能力 | 计划波次 | 依赖它的 A/B 层 skill 数（其中 A 层） | 拉动值（V 之和） |
|---|---|---|---|
| profile 组织/领域档案与访谈式 onboarding | W2 | 159（75） | 10693 |
| connector:other 其他专用连接器（CLM、ATS、ERP、金融终端等） | W3 | 96（33） | 6302 |
| connector:docs 外部文档/知识库连接器 | W2 | 68（38） | 4649 |
| connector:email 邮件连接器 | W2 | 67（31） | 4484 |
| connector:crm CRM 连接器 | W2 | 64（26） | 4233 |
| connector:chat 团队聊天连接器（外部） | W2 | 53（26） | 3579 |
| python Python 沙箱（含 openpyxl / LibreOffice 公式重算） | W3 | 49（7） | 3084 |
| connector:pm 项目跟踪连接器 | W2 | 32（11） | 2083 |
| connector:transcript 会议转录（平台自有或外部） | W2 | 30（16） | 2073 |
| connector:calendar 日历连接器 | W2 | 28（13） | 1850 |
| scheduler 调度与后台 agent | W3 | 24（16） | 1671 |
| connector:warehouse 数据仓库连接器 | W3 | 6（1） | 362 |
| sql SQL 只读执行 | W3 | 5（1） | 304 |
| browser 无头浏览器渲染与爬取 | W3 | 3（2） | 206 |

● = 双人共识分；◐ = 单人评分且 V 在 A 阈值 ±5 分的边界带内，层级待第二评审或评测确认。

## 5. A 层：核心入选

| id | V | R | 波次 | 职能族 | 建议 | 一句话 |
|---|---|---|---|---|---|---|
| legal/product-legal/launch-review | 84.4 | 60.0 | W2 | 上线审查 | rewrite | 按八类框架与公司风险校准审查 PRD，输出特权审查备忘与可贴到工单的去特权行动项，并联动隐私/AI 治理分诊 |
| kwp/small-business/proposal-builder | 82.2 | 84.0 | W1 | 提案报价 | rewrite | 把会议转录/笔记/照片/RFP 转成基于历史报价与自有模板的方案报价书，私下提示风险并经批准送签 |
| legal/commercial-legal/vendor-agreement-review | 82.0 | 60.0 | W2 | 合同审阅 | rewrite | 逐条对照团队 playbook 审阅供应商合同，给出严重度、可直接粘贴的修订文本与审批路由 |
| legal/corporate-legal/tabular-review | 81.0 | 88.0 | W1 | 批量抽取 | rewrite | 对一批文件按类型化列 schema 做表格化审阅：一文一行、每格附逐字引文与位置，先抽样再并行扇出 |
| kwp/sales/call-summary | 80.4 | 84.0 | W1 | 会议纪要 | rewrite | 把通话转录或笔记转为客户跟进邮件草稿、内部团队摘要与带引用的 CRM 更新提议 |
| legal/regulatory-legal/policy-diff | 79.8 | 64.0 | W2 | 合规检查 | rewrite | 将新规逐条拆解为要求并与内部政策库比对，输出每条的缺口类型、修改建议与负责人 |
| legal/ai-governance-legal/use-case-triage | 79.6 | 64.0 | W2 | AI 用例分诊 | rewrite | 对照公司 AI 用例台账与红线把"能不能用 AI 做 X"分为批准/有条件/不批准，列出前置条件、审批路径并建议台账更新 |
| legal/ai-governance-legal/aia-generation | 79.0 | 60.0 | W2 | AI 影响评估 | rewrite | 为 AI 系统/用例做影响评估：判断是否需要、快慢轨道、结构化访谈、逐监管体系分类、政策差异与带责任人的部署条件 |
| mkt/customer-research | 79.0 | 80.0 | W1 | 客户研究 | rewrite | 分析访谈转录/调研/工单与线上评论，按置信度综合主题、原话库与基于证据的画像 |
| kwp/small-business/inbox-manager | 77.8 | 74.0 | W1 | 邮件分诊 | rewrite | 把收件箱分为需你处理/已起草/已处理三类，按后果排序，起草回复、提取承诺并把账单线索移交对应技能 |
| askills/doc-coauthoring | 77.8 | 94.0 | W1 | 文档协作 | rewrite | 三阶段文档共创：上下文收集→分节头脑风暴/筛选/起草/精修→用无上下文子 agent 做读者测试 |
| legal/privacy-legal/pia-generation ● | 77.6 | 60.0 | W2 | 隐私影响评估 | rewrite | 为新功能/处理活动按团队格式生成隐私影响评估：是否需要、产品访谈、数据流、风险缓解与带责任人的上线条件 |
| legal/ai-governance-legal/vendor-ai-review | 77.0 | 64.0 | W2 | AI 供应商审查 | rewrite | 对照公司 AI 供应商立场逐条审阅 AI 协议/附录/服务条款：训练用数据、输入保密、模型变更、输出权属、责任与多层供应链转嫁 |
| legal/regulatory-legal/gap-surfacer | 76.8 | 64.0 | W2 | 合规检查 | rewrite | 合规缺口与征求意见追踪框架：入库去重、状态报告、到期提醒、关闭与风险接受，Slack 通知逐条确认 |
| kwp/legal/review-contract | 76.6 | 80.0 | W1 | 合同审阅 | rewrite | 按组织谈判 playbook 逐条审阅合同，红黄绿分级并生成修改建议与谈判策略 |
| kwp/small-business/report-builder | 76.4 | 74.0 | W1 | 仪表盘 | rewrite | 把口述报表需求转为指标规格，拉数计算并自检，出摘要+XLSX 并保存定义以便复跑 |
| kwp/sales/customer-voice | 76.2 | 88.0 | W1 | 用户研究综合 | rewrite | 从通话转录与邮件中提取按主题聚类、带归属的客户原话 |
| legal/litigation-legal/chronology | 76.2 | 60.0 | W2 | 诉讼文书 | rewrite | 从文档来源抽取、去重并按案件理论标注重要性的事实时间线，含特权闸门与多种输出变体 |
| mkt/product-marketing | 76.0 | 64.0 | W2 | 档案访谈 | rewrite | 访谈或从代码库自动起草产品营销上下文文档（12 节定位/ICP/语气/证据），带版本与变更日志供其他技能共用 |
| legal/employment-legal/international-expansion | 76.0 | 64.0 | W2 | 出海扩张 | rewrite | 新国家首批招聘的实施规划：EOR vs 实体取舍框架、税务/财务/HR 跨职能提问、外部律师简报请求与持久跟踪表 |
| mkt/marketing-loops | 76.0 | 34.0 | W3 | 营销自动化循环 | rewrite | 设计按节奏运行的营销循环：九要素规格、节奏匹配信号速度、状态幂等、两级动作审批与熔断 |
| legal/privacy-legal/use-case-triage | 75.6 | 60.0 | W2 | 隐私分诊 | rewrite | 快速判断一项数据处理活动是可直接推进、需做 PIA、法定必须 DPIA 还是因与隐私政策冲突而停止，并列出前置条件 |
| legal/product-legal/marketing-claims-review | 75.6 | 60.0 | W2 | 宣传合规 | rewrite | 逐条抽取营销文案中的事实/比较/暗示/绝对化表述，检查佐证并给出保留气势的改写 |
| kwp/small-business/build-agent | 75.4 | 62.0 | W2 | 技能构建 | rewrite | 把店主反复手工做的任务提炼为带审批点的可复用技能，实测后注册到路由并可共享 |
| mkt/competitor-profiling | 75.4 | 64.0 | W2 | 竞品分析 | rewrite | 输入竞品 URL，抓取官网/定价/评价并结合 SEO 数据，产出结构化竞品档案与汇总 |
| kwp/product-management/stakeholder-update | 75.2 | 84.0 | W1 | 状态汇报 | rewrite | 按受众与节奏生成干系人进展汇报（高管/工程/协作方/客户/发布），含红黄绿与风险沟通 |
| legal/corporate-legal/closing-checklist | 75.2 | 60.0 | W2 | 交割清单 | rewrite | 从收购协议初始化交割清单，自动吸收尽调发现的交割前事项，跟踪状态与关键路径 |
| legal/corporate-legal/diligence-issue-extraction | 75.0 | 60.0 | W2 | 尽调 | rewrite | 按公司分类与重要性阈值阅读数据室文件，按公司备忘格式抽取尽调问题并交接交割事项 |
| legal/commercial-legal/saas-msa-review ● | 75.0 | 60.0 | W2 | 合同审阅 | rewrite | 在通用 playbook 审阅之上叠加 SaaS 专项：自动续约、调价、数据退出、SLA、分处理者与 AI 训练权 |
| legal/ai-governance-legal/policy-monitor ● | 74.9 | 64.0 | W2 | 政策漂移监测 | rewrite | 扫描已保存的 AIA/分诊/供应商审查产出，发现 AI 政策与实际 AI 用法的漂移并起草修订文本与用例台账条目 |
| kwp/small-business/crm-autopilot | 74.8 | 58.0 | W2 | CRM 维护 | rewrite | 从邮件、日历、会议转录自动记录 CRM 活动，给沉寂商机起草跟进并做数据卫生清理 |
| kwp/enterprise-search/search | 74.8 | 68.0 | W2 | 企业检索 | rewrite | 一次查询并行检索所有已连接来源，去重排序后合成带来源的答案 |
| kwp/sales/competitive-intelligence | 74.6 | 84.0 | W1 | 竞品分析 | rewrite | 交易内对指定竞品的打法，以及跨客户盘的赢输模式、客户原话与持续刷新的 battlecard |
| legal/employment-legal/internal-investigation | 74.6 | 60.0 | W2 | 内部调查 | rewrite | 内部调查全流程框架：立案与来源清单、按拉取准则筛文件、调查日志问答、调查备忘录与分受众摘要 |
| kwp/product-management/synthesize-research ● | 74.4 | 94.0 | W1 | 用户研究综合 | direct | 把访谈、问卷、工单等研究材料综合为按频次×影响排序的发现、画像、机会与建议 |
| legal/commercial-legal/renewal-tracker | 74.4 | 64.0 | W2 | 续约跟踪 | rewrite | 维护合同续约登记册，按工作日回滚与邮寄在途时间计算取消截止日并分级预警 |
| legal/ai-governance-legal/policy-starter | 74.4 | 60.0 | W2 | AI 使用政策 | rewrite | 先做范围访谈，再检索公开的示范 AI 政策与监管指引，按选定章节起草带来源与 [review] 决策点的内部 AI 使用政策草案 |
| legal/regulatory-legal/policy-redraft | 74.4 | 64.0 | W2 | 合规检查 | rewrite | 针对缺口生成政策最小改动的修订提案（含修订理由与待核标注），写入新文件不覆盖原政策 |
| legal/commercial-legal/nda-review ● | 74.2 | 64.0 | W2 | NDA 审阅 | rewrite | 按团队 playbook 把来件 NDA 快速分为绿/黄/红三档，识别夹带条款并给最小颗粒度修改建议 |
| kwp/small-business/hiring-screener | 74.2 | 80.0 | W1 | 简历筛选 | rewrite | 只按岗位评分表给简历打分分档，起草所有候选人回复、安排面试并生成入职清单 |
| kwp/sales/call-prep | 74.0 | 60.0 | W2 | 会前准备 | rewrite | 客户会议前汇总参会人、客户历史、过往通话要点与机会状态，给出会谈目标与发现式问题 |
| kwp/sales/create-an-asset | 74.0 | 84.0 | W1 | 内容创作 | rewrite | 基于已批准材料与客户数据生成定制的客户 deck、一页纸或留存资料，数字全部带出处 |
| legal/regulatory-legal/reg-feed-watcher | 74.0 | 46.0 | W2 | 法规监测 | rewrite | 拉取监管信息源并按重要性阈值过滤分级，输出摘要并登记征求意见期限、衔接政策差异分析 |
| legal/corporate-legal/integration-management | 73.8 | 60.0 | W2 | 并购整合 | rewrite | 并购交割后法务整合跟踪：按 Day1/30/90/180 工作计划、同意事项与合同转让分层并出周报 |
| askills/skill-creator | 73.8 | 48.0 | W3 | Skill 编写 | rewrite | 创建与迭代 skill：意图访谈、写 SKILL.md、测试用例、有/无 skill 基线并行运行、断言评分、基准聚合、人工评审与描述触发优化 |
| alir/project-management/senior-pm | 73.6 | 44.0 | W3 | 状态汇报 | rewrite | 组合级项目管理：多维健康评分、EMV 风险矩阵、资源产能、优先级模型与高管报告 |
| legal/privacy-legal/dpa-review | 73.4 | 60.0 | W2 | DPA 审阅 | rewrite | 按处理者/控制者方向分别对照 DPA playbook 逐条审阅数据处理协议，含行业监管叠加与隐私政策一致性检查 |
| legal/privacy-legal/policy-monitor ● | 73.4 | 58.0 | W2 | 政策漂移监测 | rewrite | 扫描已保存的 PIA/DPA/分诊/DSAR 产出，发现隐私政策与实际做法的漂移并起草修订文本；也可即时查询新做法是否被覆盖 |
| legal/litigation-legal/demand-received ● | 73.4 | 60.0 | W2 | 风险评估 | rewrite | 分诊收到的律师函：抽取要素、交叉检查事项组合、评估强弱、给出回应选项与建议 |
| kwp/enterprise-search/knowledge-synthesis ● | 73.4 | 81.0 | W1 | 知识综合 | rewrite | 把多源检索结果去重、聚类、按新鲜度与权威性评估置信并合成带引用的答案 |
| legal/commercial-legal/review ● | 73.3 | 62.0 | W2 | 路由编排 | rewrite | 识别来件合同的主协议与附件结构，路由到 NDA/供应商/SaaS 审阅技能并合成单份审阅备忘 |
| kwp/small-business/grant-rfp-writer | 73.2 | 76.0 | W1 | 投标书 | rewrite | 筛选可投的资助/招标机会，先做硬性 go/no-go，再按合规矩阵用真实材料起草并跟踪中标后义务 |
| legal/litigation-legal/matter-intake | 73.2 | 56.0 | W2 | 事项管理 | rewrite | 新事项统一立案：识别、利冲、来源、风险分级、重要性、外所、负责人、保全与关键日期 |
| kwp/small-business/outreach-composer ● | 72.8 | 75.0 | W1 | 外联序列 | rewrite | 从店主已发邮件学语气，基于具体钩子写外联序列，经 slop 自检与批准后排队并记 CRM |
| alir/c-level-advisor/decision-logger ◐ | 71.8 | 62.0 | W2 | 决策记录 | rewrite | 两层决策记忆：原始记录与已批准决策分层，追踪行动项、冲突与“不再重提” |
| kwp/product-management/competitive-brief ● | 71.6 | 88.0 | W1 | 竞品分析 | rewrite | 面向产品策略的竞品简报：功能对比矩阵、定位分析、赢单/丢单、趋势与战略含义 |
| legal/ip-legal/ip-clause-review ● | 71.4 | 60.0 | W2 | 合同审阅 | rewrite | 审阅合同中的 IP 条款（转让、许可、保证、赔偿），先查转让缺口，按严重度给出最小粒度改稿 |
| mkt/marketing-plan ● | 71.3 | 73.0 | W1 | 营销计划 | rewrite | 以 fCMO 视角产出 13 节 AARRR 结构的 12 个月营销计划，分 INIT/REVIEW/FINALIZE 可续做 |
| legal/employment-legal/termination-review ● | 71.2 | 52.0 | W2 | 风险评估 | reference | 解雇前审查：高风险标记扫描、豁免误分类、最终工资时限、遣散与弃权要求及解雇日清单 |
| kwp/sales/inbox-sweep ● | 71.1 | 62.0 | W2 | 回复起草 | rewrite | 批量分类未读客户邮件、按优先级排序并以本人文风起草线程内回复 |
| legal/ai-governance-legal/reg-gap-analysis ● | 70.9 | 62.0 | W2 | 法规差距分析 | rewrite | 把新 AI 法规/指引拆解为逐条要求，区分提供者与部署者，对照用例台账、供应商立场与 AI 政策找差距并出整改计划 |
| askills/internal-comms ◐ | 70.6 | 68.0 | W2 | 状态汇报 | rewrite | 按公司偏好格式撰写内部沟通：3P 周报、公司通讯、FAQ、状态与事故报告，按类型加载示例规范 |
| kwp/small-business/contract-review ● | 70.5 | 80.0 | W1 | 合同审阅 | rewrite | 为无法务的小企业按 8 类风险审阅 NDA/MSA 等合同，分级提示并输出修订版 DOCX |
| kwp/small-business/social-content-engine ● | 70.5 | 55.0 | W2 | 内容创作 | reference | 维护滚动发帖日历、学语气、生成 Canva 图、写文案并暂存待批，不自动发布 |
| legal/ip-legal/cease-desist ● | 70.5 | 56.0 | W2 | 知识产权 | rewrite | 起草或分诊商标/著作权警告函：发函按执法姿态校准并设发送闸门，收函出选项备忘录 |
| kwp/sales/account-plan ● | 70.3 | 67.0 | W2 | 客户经营计划 | rewrite | 汇总客户现状、目标、干系人覆盖、机会与风险，生成可持续刷新的战略客户计划并回写 CRM 摘要 |
| kwp/sales/stakeholder-map ● | 70.3 | 79.0 | W1 | 客户研究 | rewrite | 绘制交易或客户中的干系人地图：角色、影响力、态度、缺失角色与接触路径 |
| legal/litigation-legal/demand-draft ● | 70.3 | 56.0 | W2 | 诉讼文书 | rewrite | 基于接案记录起草律师函/催告函，先过特权、自认、和解通讯等门槛，输出 docx 与发送后清单 |
| kwp/small-business/ticket-deflector ● | 70.0 | 74.0 | W1 | 回复起草 | reference | 读客户来信，查订单/付款/CRM/工单，按退款政策起草回复，退款需单独确认；可主动排查问题订单 |
| kwp/sales/customer-health ● | 69.9 | 69.0 | W2 | 客户健康度 | rewrite | 对客户关系、互动趋势、商务、支持与价值交付打红黄绿并生成 QBR 准备包 |
| kwp/enterprise-search/digest ● | 69.8 | 68.0 | W2 | 动态摘要 | rewrite | 扫描聊天/邮件/文档/任务等来源，按项目归组生成日报或周报式动态摘要，行动项置顶 |
| kwp/legal/triage-nda ● | 69.8 | 86.0 | W1 | NDA 审阅 | direct | 按十项筛查标准对来件 NDA 快速分级（绿/黄/红）并给出路由与修改建议 |
| kwp/small-business/business-pulse ● | 69.8 | 45.0 | W3 | 经营简报 | rewrite | 并行拉取账本、收款、CRM、日历、邮件等生成一页经营快照与今日首要事项 |
| kwp/sales/route-lead ● | 69.6 | 79.0 | W1 | 路由编排 | reference | 按组织自有规则确定性地为线索或商机分配 owner，生成可接受/覆盖的路由卡与交接说明 |
| kwp/small-business/ap-processor ● | 69.6 | 68.0 | W1 | 应付处理 | rewrite | 从邮箱/上传件提取账单、编码科目、三单匹配，分两道审批入账并提出付款批次 |
| legal/ip-legal/oss-review ● | 69.6 | 64.0 | W2 | 合规检查 | rewrite | 开源许可合规审查：按部署模式分类依赖许可、判定传染性义务、出站开源兼容性检查 |
| legal/ip-legal/clearance ● | 69.6 | 66.0 | W1 | 知识产权 | rewrite | 商标近似初筛：显著性排除、近似商标检索、邻近词族与混淆因素逐项标记，绝不下'可用'结论 |
| legal/commercial-legal/cold-start-interview ● | 69.3 | 54.0 | W2 | 档案访谈 | rewrite | 访谈商事合同团队并读取已签合同样本，生成含买卖双方 playbook、升级矩阵、房屋风格的执业档案 |
| kwp/sales/end-of-day ● | 69.2 | 67.0 | W2 | 状态汇报 | reference | 收尾当天：逐个处理或跳过当日通话、核对 CRM、记录承诺并排出明日三件事 |
| kwp/data/data-context-extractor ● | 69.2 | 55.0 | W3 | 指标口径 | rewrite | 访谈分析师并探查数仓，生成公司专属的数据分析 skill（实体、指标口径、标准过滤、坑点），可迭代补充 |
| kwp/small-business/job-post-builder ● | 69.1 | 80.0 | W1 | 招聘 | rewrite | 从岗位简报生成职位描述、分阶段面试指南与评分表、筛简历评分表和 offer 模板 |
| kwp/small-business/speed-to-lead ● | 69.1 | 54.0 | W3 | 线索响应 | reference | 定时扫描表单/邮箱/CRM 新询盘，按标准分四档，起草带真实时段的回复，热线索即时转人 |
| legal/privacy-legal/reg-gap-analysis ● | 69.1 | 62.0 | W2 | 法规差距分析 | rewrite | 把新出台/修订的隐私法规逐条拆解，对照现行政策与实践找差距，输出带负责人与期限的整改计划 |
| legal/ai-governance-legal/cold-start-interview ● | 69.0 | 57.0 | W2 | 档案访谈 | rewrite | 访谈 AI 治理团队（提供者/部署者、监管足迹、影子 AI 盘点、场景化红线），读取 AI 政策/评估/供应商协议生成执业档案与用例台账 |
| alir/c-level-agents/decide ◐ | 69.0 | 62.0 | W2 | 决策记录 | rewrite | 把创始人批准的董事会备忘录落为决策记录：成功/止损标准、保留异议、90 天复查 |
| kwp/small-business/month-end-prep ● | 68.8 | 52.0 | W2 | 月结 | reference | 账本与各支付渠道结算净额对账，查重复与缺票，写损益叙述并导出关账包 |
| legal/ip-legal/portfolio ● | 68.8 | 53.0 | W2 | 知识产权 | rewrite | 维护 IP 组合登记册：计算续展/年费期限、报告、增改与审计 |
| alir/c-level-advisor/board-meeting ◐ | 68.8 | 62.0 | W2 | 战略决策会 | rewrite | 六阶段多角色高管“董事会”审议：独立发言、批评、综合、创始人签核、决策入档 |
| legal/product-legal/cold-start-interview ● | 68.8 | 59.0 | W2 | 档案访谈 | rewrite | 访谈产品法务并读取 10 份历史上线审查，归纳"什么会阻断/需工作/仅知会"的公司风险校准表与审查框架 |
| mkt/prospecting ● | 68.7 | 63.0 | W2 | 潜客名单 | rewrite | 按四种分支把 ICP 转为带来源与置信度的合格潜客名单，含热/温/冷评分与合规护栏 |
| kwp/small-business/grow-pipeline ● | 68.6 | 70.0 | W1 | 外联序列 | reference | 串联市场扫描、找客户、写外联、记 CRM 的拓客链，每个交接处设审批 |
| kwp/sales/account-context ● | 68.5 | 62.0 | W2 | 客户研究 | rewrite | 汇总 CRM、邮件、文档、转录与内部聊天，生成现有客户的 360 度现状简报 |
| legal/product-legal/feature-risk-assessment ● | 68.5 | 66.0 | W2 | 风险评估 | rewrite | 对上线审查中发现的新颖或高风险功能做深度评估：具体场景、可能性与严重度、缓解缺口、2–3 个可选方案与推荐 |
| kwp/sales/account-research ● | 68.4 | 82.0 | W1 | 客户研究 | rewrite | 对目标公司及联系人做公开信息研究、ICP 匹配打分并查重 CRM 归属 |
| kwp/legal/meeting-briefing ● | 68.4 | 67.0 | W2 | 会前准备 | rewrite | 为有法律相关性的会议汇集背景、生成简报并跟踪会后行动项 |
| kwp/sales/deal-review ● | 68.3 | 79.0 | W1 | 管道复盘 | rewrite | 对单笔商机做信号调整后的健康度评分、资格缺口、阶段真实性核查与下一步建议 |
| legal/ip-legal/invention-intake ● | 68.3 | 56.0 | W2 | 知识产权 | rewrite | 发明披露初筛：新颖性、显而易见、可专利主题、公开时限、可检测性与战略价值六项筛查 |
| legal/ip-legal/fto-triage ● | 68.2 | 61.0 | W2 | 知识产权 | rewrite | 专利自由实施(FTO)初筛：检索或用户提供专利，逐要素权利要求对照，列开放问题，绝不下'可上市'结论 |
| fs/financial-analysis/competitive-analysis ● | 68.2 | 90.0 | W1 | 竞品分析 | rewrite | 两阶段（先定范围与大纲再建）产出 10-20 页竞争格局幻灯片 |
| kwp/productivity/update ● | 68.1 | 65.0 | W2 | 事项管理 | rewrite | 同步项目跟踪器任务到 TASKS.md、分诊过期事项、补全记忆空白，可深扫聊天/邮件找漏记待办 |
| legal/privacy-legal/cold-start-interview ● | 68.1 | 57.0 | W2 | 档案访谈 | rewrite | 访谈隐私团队（控制者/处理者、监管足迹、DPA 立场、PIA 与 DSAR 流程），读取隐私政策/DPA 模板/样例 PIA 生成执业档案 |
| legal/corporate-legal/entity-compliance ● | 68.1 | 56.0 | W2 | 合规检查 | rewrite | 维护集团各法律主体的年报/特许税等申报台账，报告到期事项、导入注册代理报告并做健康审计 |
| legal/privacy-legal/dsar-response ● | 68.1 | 60.0 | W2 | 数据主体请求 | rewrite | 处理数据主体权利请求：分类权利、身份核验、逐系统定位数据、豁免分析，并起草确认函与实质答复函 |
| fs/financial-analysis/dcf-model ● | 68.0 | 45.0 | W3 | 估值 | rewrite | 构建含 WACC、情景选择器与敏感性表的机构级 DCF Excel 模型 |

## 6. B 层：候选（以实验身份进社区，评测证明后升级）

| id | V | R | 波次 | 职能族 | 建议 | 一句话 |
|---|---|---|---|---|---|---|
| alir/product-team/product-skills ◐ | 67.8 | 36.0 | W3 | 产品发现 | reference | 产品域编排：16 条子技能路由，加持续发现循环（节奏跟踪+机会方案树 linter 门禁） |
| kwp/partner-built/brand-voice/guideline-generation ● | 67.6 | 79.0 | W1 | 品牌规范 | rewrite | 从文档、销售通话转录与发现报告合成带置信度与待决问题的品牌语气规范并存档版本 |
| kwp/productivity/memory-management ● | 67.5 | 62.0 | W2 | 档案定制 | rewrite | 两级记忆（热缓存 CLAUDE.md + memory/ 目录）解码人名、缩写、项目代号等内部语言并持续维护 |
| kwp/sales/team-pipeline ● | 67.4 | 79.0 | W1 | 管道复盘 | reference | 销售主管视角按人和阶段汇总团队管道，找出决定季度的交易与需辅导的人 |
| kwp/marketing/brand-review ● | 67.4 | 86.0 | W1 | 品牌审查 | rewrite | 对照品牌语调、风格指南与信息支柱审阅内容，按严重度列偏差并给改写，同时标出合规风险 |
| legal/litigation-legal/portfolio-status ● | 67.4 | 62.0 | W2 | 状态汇报 | rewrite | 从事项台账汇总组合：风险分布、临近期限、陈旧事项、重要性合计与异常标记 |
| fs/financial-analysis/3-statement-model ● | 67.4 | 40.0 | W3 | 财务模型 | rewrite | 填充三表联动模型模板，公式驱动并逐表与用户确认、跑平衡与现金勾稽检查 |
| kwp/legal/legal-risk-assessment ● | 67.3 | 90.0 | W1 | 风险评估 | direct | 严重度×可能性矩阵评估法律风险，给出分级处置、风险备忘录与外部律师升级标准 |
| mkt/attribution ● | 67.2 | 73.0 | W1 | 营销归因 | rewrite | 选择归因模型、调和多源冲突数字、识别盲区，并给出一方归因的身份拼接方案 |
| kwp/sales/close-plan ● | 67.1 | 82.0 | W1 | 成交计划 | rewrite | 为后期交易生成客户语言的商业论证与倒推日期的双方行动计划 |
| kwp/product-management/write-spec ● | 67.1 | 94.0 | W1 | 需求文档 | direct | 把问题或想法写成 PRD：问题、目标/非目标、用户故事、分级需求与验收标准、指标 |
| legal/corporate-legal/board-minutes ● | 67.1 | 58.0 | W2 | 会议纪要 | rewrite | 从日历识别董事会/委员会会议，按种子纪要的公司格式起草会议记录并附审核清单 |
| kwp/customer-support/customer-research ● | 67.1 | 68.0 | W2 | 客户研究 | rewrite | 多源检索回答客户问题，按来源分层给置信度并建议沉淀到知识库 |
| kwp/design/research-synthesis ● | 67.0 | 91.0 | W1 | 用户研究综合 | rewrite | 把访谈、问卷、工单、NPS 等综合成主题、洞察、人群与优先建议 |
| kwp/small-business/growth-pulse ● | 67.0 | 72.0 | W1 | 增长复盘 | rewrite | 汇总渠道趋势、漏斗转化、活动回报、产品表现与口碑，给出本周三项增长动作 |
| kwp/small-business/monday-brief ● | 66.9 | 64.0 | W2 | 经营简报 | reference | 串联经营快照、已存 KPI 报告与本周日历邮件，合并为一页周一简报 |
| kwp/small-business/review-reputation ● | 66.9 | 73.0 | W1 | 口碑监测 | reference | 汇总公开评论、争议、工单与邮件为带原话的主题，逐条起草回复并找出沉寂客户 |
| legal/ip-legal/infringement-triage ● | 66.9 | 57.0 | W2 | 知识产权 | reference | 商标/著作权/专利/商业秘密四类侵权分诊：逐因素标注倾向，不下结论并可转警告函或下架 |
| fs/financial-analysis/comps-analysis ● | 66.9 | 50.0 | W3 | 可比公司分析 | rewrite | 在 Excel 搭建含经营指标、估值倍数与分位统计的可比公司分析 |
| kwp/enterprise-search/search-strategy ● | 66.8 | 65.0 | W2 | 企业检索 | reference | 把自然语言问题分解为各来源的子查询，按查询类型加权排序并处理歧义与降级 |
| fs/partner-built/spglobal/tear-sheet ● | 66.7 | 31.0 | W3 | 公司速览 | rewrite | 按研究/投行/战投/销售四种受众用 CapIQ 数据生成公司一页纸 Word |
| kwp/sales/lead-triage ● | 66.6 | 79.0 | W1 | 线索分诊 | rewrite | 对入站线索或线索积压按 ICP 契合与意向打分分级并给出路由与首触建议 |
| kwp/customer-support/kb-article ● | 66.6 | 89.0 | W1 | 知识库文章 | direct | 把已解决工单或常见问题写成可检索的知识库文章 |
| legal/legal-builder-hub/skills-qa ● | 66.5 | 84.0 | W1 | 技能评审 | rewrite | 按 13 项设计参数、3 类法律失败模式与注入启发式扫描评估技能，给出 READY/SOME/MATERIAL/REFUSE 结论 |
| alir/commercial/deal-desk ◐ | 66.4 | 40.0 | W3 | 定价 | rewrite | 单笔交易折扣与条款审查，打分并路由给具名审批人，从不自动批准 |
| mkt/ads ● | 66.3 | 71.0 | W1 | 付费投放 | rewrite | 付费广告投放策略：平台选择、结构、受众、出价、再营销、审计与扩量判断 |
| legal/corporate-legal/deal-team-summary ● | 66.1 | 64.0 | W2 | 状态汇报 | rewrite | 把尽调发现按受众分层（高管/交易负责人/工作组）汇总成简报并突出变化与待决事项 |
| kwp/product-management/roadmap-update ● | 66.0 | 84.0 | W1 | 路线图 | rewrite | 创建、更新或重排产品路线图，含 Now/Next/Later、RICE 等框架与依赖/容量分析 |
| kwp/legal/brief ● | 65.9 | 65.0 | W2 | 法务简报 | rewrite | 汇总邮件/日历/聊天/CLM 生成法务每日简报、专题简报或突发事件简报 |
| legal/employment-legal/worker-classification ● | 65.9 | 58.0 | W2 | 风险评估 | reference | 对拟议用工安排按所在法域检索的分类测试逐项打分，判断雇员/独立承包人/派遣/外包并做差距分析 |
| kwp/data/validate-data ● | 65.8 | 89.0 | W1 | 数据校验 | direct | 在分享前审查分析的方法、计算与偏差，给出三档可分享结论 |
| legal/commercial-legal/stakeholder-summary ● | 65.8 | 71.0 | W2 | 业务摘要 | rewrite | 把合同审阅备忘压缩成 200 字内的业务版结论，按受众翻译并核对升级是否全部送达 |
| kwp/operations/status-report ● | 65.7 | 89.0 | W1 | 状态汇报 | direct | 汇总项目进展生成含红黄绿状态、KPI、风险与待决事项的管理层周/月报 |
| legal/litigation-legal/matter-briefing ● | 65.7 | 62.0 | W2 | 会前准备 | rewrite | 单个事项简报：当前态势、近期变化、下一期限、开放问题与风险重评提示 |
| kwp/small-business/lead-finder ● | 65.6 | 80.0 | W1 | 线索挖掘 | reference | 从现有客户推导理想客户画像，找相似公司与决策人，按匹配/信号/可达性打分出名单 |
| alir/c-level-advisor/context-engine ◐ | 65.6 | 62.0 | W2 | 档案定制 | reference | 加载并维护公司上下文档案，检测过期、会中增补、对外调用前匿名化 |
| kwp/small-business/marketing-monday ● | 65.5 | 65.0 | W1 | 增长复盘 | reference | 串联增长脉搏、口碑监测与竞品网页扫描，合并为每周一页增长简报与三项行动 |
| kwp/small-business/pay-the-bills ● | 65.5 | 65.0 | W1 | 应付处理 | reference | 串联账单编码、现金检查与付款批次暂存，两道审批之间先看现金 |
| kwp/sales/win-loss-review ● | 65.4 | 74.0 | W1 | 管道复盘 | rewrite | 分析近期关闭商机的量化与定性赢输模式，给出系统、辅导与数据层面的改进建议 |
| kwp/sales/handle-objection ● | 65.3 | 79.0 | W1 | 回复起草 | rewrite | 把客户异议分类并基于自有赢输历史、客户原话与已审证据给出应对话术与禁忌 |
| legal/product-legal/is-this-a-problem ● | 65.3 | 64.0 | W2 | 法务快问 | rewrite | 对产品经理的即时法律小问题按风险校准表一分钟内给出"没问题/需看一下/暂停"，并识别常见陷阱 |
| kwp/legal/legal-response ● | 65.2 | 79.0 | W1 | 法务回复 | rewrite | 按模板生成数据主体请求、诉讼保全、供应商、NDA 等常见法务回复，内置升级触发检查 |
| legal/corporate-legal/written-consent ● | 65.0 | 56.0 | W2 | 公司治理文书 | rewrite | 以先例库为基础按公司格式起草董事会/委员会一致书面同意，附签署清单与州法通知核查 |
| kwp/sales/deal-signals ● | 64.9 | 59.0 | W3 | 风险评估 | reference | 定期扫描客户盘，只报告越过阈值的交易信号（沉寂、滑期、冠军变动、竞品提及等） |
| legal/ai-governance-legal/ai-inventory ● | 64.9 | 54.0 | W2 | AI 系统台账 | rewrite | 按欧盟 AI 法案逐系统登记 AI 系统的角色（提供者/部署者等）与风险等级，并引导分类与复评 |
| fs/financial-analysis/deck-refresh ● | 64.9 | 59.0 | W3 | 演示文稿更新 | rewrite | 用新数字更新已有 deck 的所有出现位置，先出变更计划审批再最小改动 |
| fs/operations/kyc-rules ● | 64.7 | 63.0 | W3 | KYC 规则评级 | rewrite | 按机构 KYC/AML 规则表对开户记录评级、逐条引用规则并路由处置 |
| fs/investment-banking/pitch-deck ● | 64.7 | 44.0 | W3 | 推介材料 | rewrite | 用源数据填充投行 pitch deck 模板，按验证-修复循环保证版式与跨页一致 |
| kwp/product-management/metrics-review ● | 64.5 | 84.0 | W1 | 指标复盘 | rewrite | 按周/月/季审阅产品指标，输出记分卡、趋势归因、亮点与隐忧及行动建议 |
| kwp/small-business/cash-flow-snapshot ● | 64.5 | 77.0 | W1 | 现金流预测 | rewrite | 基于应收应付与历史回款时滞生成 30/60/90 天现金流预测、置信区间与具名风险，附 XLSX |
| kwp/small-business/seo-ai-visibility ● | 64.4 | 78.0 | W1 | SEO 审计 | rewrite | 审计并修复搜索与 AI 助手可见性：爬虫可达、可渲染、llms.txt、schema、事实清晰，产出可粘贴修复 |
| fs/private-equity/ic-memo ● | 64.3 | 90.0 | W1 | 投资备忘录 | rewrite | 综合尽调、财务与交易条款起草九章结构的投委会备忘录 |
| legal/corporate-legal/cold-start-interview ● | 64.3 | 50.0 | W2 | 档案访谈 | rewrite | 模块化访谈公司法务（并购/董秘/上市公司/主体管理），从种子文件抽取格式与阈值写入执业档案，并支持单笔交易上下文 |
| alir/marketing-skill/content-production ◐ | 64.2 | 86.0 | W1 | 内容创作 | rewrite | 长文内容生产三模式：调研出简报、起草、SEO/可读性/品牌语调优化与发布门禁 |
| legal/litigation-legal/matter-update ● | 64.0 | 60.0 | W2 | 事项管理 | reference | 为事项追加带日期的事件并刷新台账字段，强制重要性复核与和解接受闸门 |
| fs/fund-admin/gl-recon ● | 64.0 | 57.0 | W3 | 对账 | rewrite | 总账与子账按键全外连接匹配、分桶并标注可能原因，输出差异报告 |
| mkt/ad-creative ● | 63.9 | 71.0 | W1 | 广告创意 | rewrite | 按平台字数规格批量生成与迭代广告文案/创意，基于真实素材接地并出评审页 |
| kwp/sales/daily-briefing ● | 63.9 | 67.0 | W2 | 状态汇报 | reference | 晨间汇总当日会议及客户背景、即将成交商机、待回复客户邮件与当日三件要事 |
| fs/equity-research/earnings-analysis ● | 63.6 | 45.0 | W3 | 投研报告 | rewrite | 财报发布后 24-48 小时内生成 8-12 页含超预期/不及预期分析的业绩点评报告 |
| fs/financial-analysis/lbo-model ● | 63.6 | 44.0 | W3 | LBO 模型 | rewrite | 按模板填充 LBO 模型公式：资金来源运用、债务表、现金扫款与回报 |
| mkt/sales-enablement ● | 63.4 | 85.0 | W1 | 销售赋能 | rewrite | 制作销售物料：演示文稿、一页纸、异议处理、ROI 计算器、演示脚本、提案模板与销售手册 |
| kwp/data/analyze ● | 63.4 | 76.0 | W2 | 数据分析 | rewrite | 把自然语言数据问题分为速答/完整分析/正式报告三档，取数、校验后呈现结论 |
| mkt/copy-editing ● | 63.4 | 81.0 | W1 | 文案 | rewrite | 以“七轮扫查”编辑既有营销文案，配专家小组打分与内容刷新判断 |
| kwp/small-business/invoice-chase ● | 63.3 | 72.0 | W1 | 催收 | rewrite | 拉应收账龄、交叉核对近期收款，按客户付款习惯起草不同语气的催款邮件，批准后发送 |
| alir/marketing-skill/copywriting ◐ | 63.2 | 86.0 | W1 | 文案 | rewrite | 转化型页面文案写作：首页/落地页/定价页的标题、CTA、分节结构与备选方案 |
| fs/financial-analysis/ib-check-deck ● | 63.0 | 55.0 | W3 | 材料质检 | rewrite | 对投行 deck 做数字一致性、数据叙事对齐、措辞与格式四维质检 |
| fs/investment-banking/datapack-builder ● | 63.0 | 65.0 | W2 | 数据包 | rewrite | 从 CIM、年报或网页抽取并标准化财务数据，搭建 8 页签数据包 Excel |
| legal/commercial-legal/amendment-history ● | 63.0 | 69.0 | W2 | 合同审阅 | rewrite | 按时间顺序整理主协议与各次修订，汇总变更或追踪某条款的现行有效文本 |
| fs/financial-analysis/audit-xls ● | 62.9 | 52.0 | W3 | 模型审计 | rewrite | 按选区/工作表/全模型三档审计表格公式错误与财务模型完整性 |
| legal/litigation-legal/demand-intake | 62.8 | 60.0 | W2 | 诉讼文书 | rewrite | 律师函起草前的结构化接案：姿态、事实、依据、筹码/BATNA、特权过滤与自认风险 |
| mkt/seo-audit ● | 62.8 | 76.0 | W1 | SEO 审计 | rewrite | 按优先级审计站点可抓取/索引、技术、页面、内容与权威，含国际化 hreflang 细则与分级报告格式 |
| kwp/sales/deal-advance-gap | 62.6 | 84.0 | W1 | 管道复盘 | reference | 对单笔商机按阶段退出标准与资格框架列出推进缺口，排出关键路径与最早可信成交日 |
| kwp/sales/expansion-whitespace | 62.6 | 84.0 | W1 | 客户经营计划 | reference | 按产品、部门、地域、用量四维映射客户已购与可购空白，排序扩单打法并提议创建商机 |
| kwp/sales/forecast | 62.6 | 84.0 | W1 | 销售预测 | rewrite | 把商机数据写成 commit/best-case/pipeline 预测叙述，含变化、风险与求助事项 |
| kwp/sales/renewal-radar | 62.6 | 84.0 | W1 | 续约管理 | reference | 列出窗口内即将续约的客户，按信号评估风险与增购潜力并补齐续约商机记录 |
| kwp/small-business/reactivate | 62.6 | 74.0 | W1 | 客户召回 | reference | 按客户自身购买节奏找出沉寂客户并按价值排序，起草不推销的召回序列，遇投诉即停 |
| fs/private-equity/portfolio-monitoring | 62.6 | 94.0 | W1 | 投后监控 | rewrite | 解析组合公司月/季报，对比预算标红黄绿并检查契约合规 |
| kwp/productivity/start | 62.6 | 62.0 | W2 | 档案访谈 | rewrite | 首次初始化任务与记忆系统：从待办清单交互式解码黑话，可选扫描聊天/邮件/日历/文档建立档案 |
| kwp/cowork-plugin-management/cowork-plugin-customizer | 62.6 | 56.0 | W2 | 档案定制 | reference | 从组织聊天/文档/邮件中学习工具与流程，替换插件占位符并打包定制插件 |
| kwp/partner-built/common-room/account-research | 62.6 | 24.0 | W3 | 客户研究 | reference | 基于 Common Room 数据按四种模式研究账户，稀疏时如实说明并补网页检索 |
| mkt/revops ● | 62.5 | 83.0 | W1 | 收入运营 | rewrite | 设计线索生命周期、评分、路由、管道阶段、交接 SLA、审批分级与指标看板规格 |
| legal/employment-legal/hiring-review | 62.4 | 56.0 | W2 | 招聘 | reference | 审查录用通知与竞业/保密条款：按实际工作地判定法域、豁免分类、竞业可执行性与地方性要求 |
| kwp/marketing/competitive-brief ● | 62.4 | 86.0 | W1 | 竞品分析 | rewrite | 网页调研竞品，输出定位与信息对比、内容缺口、机会与威胁，可延伸为销售战卡 |
| kwp/partner-built/brand-voice/discover-brand | 62.4 | 60.0 | W2 | 品牌规范 | rewrite | 在 Notion/Drive/Slack/Gong 等平台检索品牌资料，分级排序并输出含待决问题的发现报告 |
| kwp/sales/pipeline-review | 62.2 | 84.0 | W1 | 管道复盘 | rewrite | 按阶段汇总管道健康度：覆盖率、阶段滞留、转化基线与风险交易 |
| kwp/operations/process-doc ● | 62.2 | 94.0 | W1 | 流程文档 | direct | 把口头流程整理为含 RACI、流程图、详细步骤、例外与指标的 SOP |
| fs/fund-admin/accrual-schedule | 62.2 | 70.0 | W2 | 月结 | rewrite | 按计提政策逐项计算期末计提、引用支持凭证并起草待审批分录 |
| mkt/content-strategy ● | 62.2 | 81.0 | W1 | 内容策略 | rewrite | 规划内容支柱与选题集群，从关键词/通话转录/调研中挖选题并加权排序 |
| kwp/sales/account-tiering ● | 62.2 | 84.0 | W1 | 客户分层 | rewrite | 按 ICP 契合度与互动度两轴对客户清单打分分层，并给出每层推荐动作 |
| kwp/engineering/incident-response | 62.2 | 88.0 | W1 | 事故响应 | rewrite | 事故分级、状态通报与无责复盘（含 5 Whys 与行动项）全流程 |
| kwp/small-business/ad-manager ● | 62.0 | 70.0 | W1 | 广告投放 | reference | 读广告表现（连接器或 CSV），核对平台与 CRM 归因，给出带金额影响的调整建议与文案，逐项审批后执行 |
| legal/employment-legal/expansion-update | 62.0 | 68.0 | W2 | 出海扩张 | reference | 更新出海扩张跟踪表：一次收集进展、重算被解锁事项、标记逾期并给出下一优先级 |
| kwp/sales/schedule-meeting | 62.0 | 60.0 | W2 | 会议安排 | reference | 查日历、提议时间、起草或直接发送邀请，并把会议记入 CRM |
| mkt/ab-testing | 62.0 | 84.0 | W1 | 实验设计 | rewrite | 设计 A/B 实验：假设、样本量、指标与护栏指标、结果解读与实验手册 |
| mkt/copywriting | 62.0 | 76.0 | W1 | 文案 | rewrite | 为首页/落地页/定价页等撰写转化文案，含页面结构、CTA 公式与备选方案注解 |
| alir/c-level-agents/post-mortem | 62.0 | 62.0 | W2 | 复盘 | rewrite | 按事前承诺的成功/止损标准为已执行决策打分，并复查当初异议与假设 |
| mkt/pricing ● | 61.9 | 83.0 | W1 | 定价 | rewrite | SaaS 定价与包装：价值指标、分档结构、初始定价法则、提价灰度与定价页双轴拆解 |
| fs/equity-research/thesis-tracker | 61.8 | 88.0 | W1 | 投资论点跟踪 | rewrite | 维护持仓投资论点：支柱、风险、催化剂、更新日志与评分卡 |
| kwp/sales/weekly-wrap ● | 61.8 | 74.0 | W1 | 状态汇报 | reference | 周末汇总本周成交、推进、滑期与新建商机，并排出下周一要事，可发团队频道 |
| mkt/ai-seo | 61.6 | 76.0 | W1 | AI 搜索优化 | rewrite | 面向 AI 答案引擎的可见性审计与优化：可抽取结构、权威信号、第三方存在与机读文件 |
| kwp/finance/variance-analysis | 61.6 | 90.0 | W1 | 差异分析 | direct | 价量/费率组合/人头等差异分解、重要性阈值、差异叙述与瀑布桥 |
| legal/litigation-legal/oc-status | 61.6 | 60.0 | W2 | 邮件起草 | reference | 按事项组合批量起草给外部律所的每周状态询问邮件，可生成 Gmail 草稿 |
| fs/fund-admin/nav-tieout | 61.6 | 70.0 | W2 | LP 报表核对 | rewrite | 依据 NAV 包独立重算 LP 资本账户并逐行比对 LP 报表 |
| alir/project-management/meeting-analyzer | 61.6 | 86.0 | W1 | 会议沟通教练 | rewrite | 分析会议转录：发言占比、打断、回避冲突、口头禅、提问质量、主持与决策，出教练报告 |
| legal/commercial-legal/escalation-flagger | 61.6 | 68.0 | W2 | 升级处理 | rewrite | 按升级矩阵判断合同问题该由谁审批，并起草可直接决策的请示消息（不代发） |
| fs/equity-research/sector-overview ● | 61.5 | 87.0 | W1 | 行业研究 | rewrite | 产出行业全景报告：市场规模、结构、竞争格局、估值与投资含义 |
| alir/research-ops/research-finance | 61.4 | 36.0 | W3 | 研发预算 | reference | 研发项目财务：含间接费率的多期预算、燃烧/跑道对里程碑、资本化 vs 费用化路由给具名财务负责人 |
| fs/partner-built/spglobal/earnings-preview-beta | 61.4 | 28.0 | W3 | 财报前瞻 | rewrite | 基于 CapIQ 与 Kensho 数据生成 4-5 页带全链接附录的单公司财报前瞻 HTML 报告 |
| fs/equity-research/initiating-coverage | 61.4 | 28.0 | W3 | 投研报告 | rewrite | 分 5 个独立任务产出 30-50 页首次覆盖报告：研究、建模、估值、图表、成稿 |
| kwp/small-business/canva-creator ● | 61.3 | 27.0 | W3 | 内容创作 | reference | 把已批准的内容简报执行为完整活动：排期、Canva 设计、文案并在 HubSpot 暂存社媒帖 |
| kwp/small-business/close-month ● | 61.3 | 29.0 | W3 | 月结 | reference | 串联对账、基于关账数重做现金预测、发布关账包的三段式月结流程 |
| kwp/small-business/report-pack | 61.2 | 38.0 | W3 | 仪表盘 | reference | 按设定节奏重跑已保存报表并配经营快照上下文，合为一次交付 |
| legal/regulatory-legal/cold-start-interview | 61.2 | 50.0 | W2 | 档案访谈 | rewrite | 监管插件入门访谈：建立监管机构关注清单、重要性阈值、政策库索引与信息源配置 |
| kwp/customer-support/customer-escalation | 61.0 | 64.0 | W2 | 升级处理 | rewrite | 把支持问题打包成面向工程/产品/管理层的结构化升级简报 |
| alir/marketing-skill/marketing-strategy-pmm | 61.0 | 80.0 | W1 | GTM定位 | rewrite | 产品营销：ICP 定义、Dunford 定位、竞品作战卡、发布分级与销售赋能、国际拓展 |
| fs/fund-admin/variance-commentary | 60.8 | 94.0 | W1 | 差异分析 | rewrite | 对超阈值的损益与资产负债行写出基于活动的驱动因素说明 |
| kwp/small-business/smb-router | 60.8 | 52.0 | W2 | 路由编排 | reference | 读取业务档案，把店主的模糊请求路由到最合适的单个技能或链路命令，并做连接器感知降级 |
| mkt/events | 60.6 | 84.0 | W1 | 活动营销 | rewrite | 按主办/赞助/演讲/参会四角色规划活动，强调会前约见、24-48 小时跟进与按管道计量 |
| fs/private-equity/dd-checklist | 60.6 | 80.0 | W1 | 尽调 | rewrite | 按行业与交易类型生成尽调清单并跟踪状态、负责人与红旗 |
| fs/private-equity/value-creation-plan | 60.6 | 94.0 | W1 | 价值创造计划 | rewrite | 搭建投后价值创造计划：杠杆映射 EBITDA 桥、100 天计划与 KPI 责任矩阵 |
| legal/employment-legal/expansion-kickoff | 60.4 | 64.0 | W2 | 出海扩张 | reference | 出海扩张入口命令：检查是否已有跟踪表后加载 international-expansion 完整流程并创建跟踪文件 |
| alir/c-level-agents/execute | 60.4 | 68.0 | W2 | 执行计划 | rewrite | 把已批准决策拆成 90 天执行计划：工作流、DRI、周里程碑、节奏与风险登记 |
| kwp/small-business/smb-onboard | 60.4 | 58.0 | W2 | 档案访谈 | reference | 引导店主接入前两个工具、跑一个见效示例、访谈业务并持久化业务档案与每周节奏 |
| kwp/partner-built/common-room/call-prep ● | 60.3 | 36.0 | W3 | 会前准备 | reference | 结合账户、参会人与信号生成客户通话简报、谈话要点与异议预案 |
| mkt/churn-prevention | 60.2 | 76.0 | W1 | 流失挽留 | reference | 设计取消流程、按原因匹配挽留优惠、健康分预警与失败扣款催缴序列 |
| fs/equity-research/morning-note | 60.2 | 84.0 | W1 | 晨报 | rewrite | 汇总隔夜动态、当日事件与交易想法，写 2 分钟可读的晨会纪要 |
| fs/operations/kyc-doc-parse | 60.2 | 86.0 | W1 | KYC 资料解析 | rewrite | 把投资人开户资料包解析为结构化 KYC 字段与文件清单并标注缺失过期 |
| kwp/customer-support/ticket-triage | 60.2 | 64.0 | W2 | 工单分诊 | rewrite | 对进线工单做分类、P1–P4 定级、查重与路由，并给初始回复 |
| kwp/partner-built/brand-voice/brand-voice-enforcement ● | 60.2 | 82.0 | W1 | 品牌审查 | rewrite | 加载品牌规范，按“语气恒定、语调随场景”生成并解释符合品牌的内容 |
| legal/litigation-legal/matter-close | 60.0 | 60.0 | W2 | 事项管理 | reference | 结案：记录结果、最终成本与经验教训，归档出活跃组合但不删除 |
| fs/partner-built/spglobal/funding-digest | 60.0 | 28.0 | W3 | 融资动态周报 | reference | 按关注赛道拉取 CapIQ 融资轮次，生成一页交易流摘要 PPT |
| alir/c-level-advisor/strategic-alignment | 60.0 | 88.0 | W1 | OKR对齐 | rewrite | 检查战略到个人的 OKR 级联：孤儿目标、冲突目标、覆盖缺口与筒仓 |
| kwp/legal/vendor-check ● | 60.0 | 59.0 | W3 | 合同台账 | rewrite | 跨 CLM/CRM/邮件/文档检索某供应商已签协议，出状态、缺口与到期提醒 |
| alir/finance/financial-analyst | 60.0 | 44.0 | W3 | 财务模型 | rewrite | 比率分析、DCF 估值、预算差异与滚动预测四件套，附脚本与报告模板 |
| legal/legal-builder-hub/skill-installer ● | 59.9 | 39.0 | W3 | 技能管理 | reference | 安装社区技能：先查白名单与许可，展示原文，结构信任检查+QA，人工 yes 后才写入 |
| legal/employment-legal/handbook-updates | 59.8 | 60.0 | W2 | 制度文件 | rewrite | 对员工手册拟修改做差异比对，查找交叉引用、州补充条款影响与"承诺缩减"风险 |
| legal/legal-clinic/supervisor-review-queue | 59.8 | 64.0 | W2 | 事项管理 | reference | 督导审核队列：学生产出待批，支持批准/改后批准/退回并全量记录与模式分析 |
| seo/seo-content-brief | 59.8 | 86.0 | W1 | 内容简报 | reference | 生成竞争性 SEO 内容简报：竞品打分与三类缺口、分节字数与关键词放置、元标签、信息增益与 E-E-A-T 要求 |
| alir/commercial/pricing-strategist | 59.8 | 44.0 | W3 | 定价 | rewrite | 选定价模型、跑 Van Westendorp 支付意愿分析、设计好/更好/最好分层包装 |
| fs/investment-banking/strip-profile | 59.8 | 40.0 | W3 | 公司速览 | reference | 逐页生成信息密集的投行公司简介（strip profile）幻灯片并逐页审批 |
| fs/private-equity/deal-screening ● | 59.7 | 92.0 | W1 | 项目初筛 | rewrite | 按基金投资标准快速筛选 CIM/teaser，输出通过/否决与一页筛选备忘 |
| mkt/marketing-council | 59.6 | 80.0 | W1 | 专家评议 | reference | 模拟 12 位营销大师组成顾问团，按各自框架给观点、绘制分歧图并由主席综合建议 |
| alir/marketing-skill/copy-editing | 59.6 | 86.0 | W1 | 文案 | rewrite | 七轮扫描法编辑营销文案：清晰、语气、So What、证据、具体、情绪、零风险 |
| legal/corporate-legal/material-contract-schedule | 59.4 | 60.0 | W2 | 交易文书 | rewrite | 按收购协议对"重大合同"的定义从尽调结果生成披露附表，并另建同意事项跟踪表 |
| evolsb/claude-legal-skill | 59.4 | 86.0 | W1 | 合同审阅 | rewrite | 合同审阅：签前完整性检查、确认立场与议价力、红旗速查、分类型清单、市场基准、红线建议与谈判优先级 |
| kwp/sales/draft-outreach | 59.4 | 80.0 | W1 | 外联序列 | rewrite | 结合 CRM、历史往来与公开信息起草个性化开发信或多触点序列，并按要求加入序列工具 |
| kwp/human-resources/policy-lookup | 59.4 | 90.0 | W1 | 政策问答 | direct | 检索员工手册与制度文档，用白话回答政策问题并注明出处 |
| kwp/operations/change-request | 59.4 | 88.0 | W1 | 变更管理 | rewrite | 生成含影响分析、风险、实施与沟通计划、回滚方案和审批表的变更申请 |
| kwp/design/design-system | 59.4 | 88.0 | W1 | 设计系统 | rewrite | 审计、记录或扩展设计系统：命名一致性、token 覆盖、组件文档与新模式 |
| fs/investment-banking/deal-tracker ● | 59.4 | 82.0 | W1 | 事项管理 | rewrite | 跟踪多个在途交易的里程碑、待办与周会回顾，提示逾期与风险 |
| fs/private-equity/unit-economics | 59.4 | 74.0 | W2 | 单位经济 | rewrite | 分析 ARR 桥、同期群、LTV/CAC、净留存与收入质量评分 |
| alir/c-level-advisor/cfo-advisor | 59.4 | 54.0 | W2 | 财务模型 | rewrite | 初创公司 CFO 顾问：跑道、单位经济、融资稀释、董事会财务包 |
| alir/marketing-skill/pricing-strategy | 59.4 | 90.0 | W1 | 定价 | rewrite | SaaS 定价设计/优化/涨价：价值指标、三档结构、价值定价、调研方法与定价页设计 |
| jl/wealth-management/performance-reporting | 59.4 | 44.0 | W3 | 业绩报告 | rewrite | 投资组合业绩报告：TWR/MWR、GIPS 组合、基准比较、风险看板、归因摘要、目标进度与通俗表达 |
| kwp/customer-support/draft-response | 59.2 | 80.0 | W1 | 回复起草 | rewrite | 按情境与客户关系起草对外客户回复，附内部备注与质量自检 |
| fs/private-equity/deal-sourcing | 59.0 | 60.0 | W2 | 项目寻源 | rewrite | 检索目标公司、查邮件/Slack/CRM 既往接触并起草个性化创始人外联邮件 |
| kwp/marketing/performance-report | 59.0 | 76.0 | W1 | 营销复盘 | rewrite | 按周/月/季生成营销表现报告：指标表、趋势、得失、优化建议与下期重点 |
| seo/seo-content | 59.0 | 76.0 | W1 | 内容质量评估 | reference | 评估页面内容的 E-E-A-T、可读性、单薄度与 AI 引用就绪度，并提供草稿去 AI 腔与隐形水印字符清理 |
| kwp/data/explore-data | 59.0 | 48.0 | W3 | 数据探查 | rewrite | 对表或上传文件做数据画像：结构、空值、分布、质量问题与后续分析建议 |
| kwp/design/design-handoff | 59.0 | 68.0 | W2 | 设计交付 | rewrite | 从设计稿生成开发交付规格：token、组件、状态、断点、边界与动效 |
| fs/private-equity/dd-meeting-prep | 59.0 | 94.0 | W1 | 会前准备 | rewrite | 为管理层会、专家访谈、客户背调等尽调会议生成分级问题清单与红旗 |
| kwp/legal/compliance-check | 58.8 | 72.0 | W1 | 合规检查 | rewrite | 对拟议行动或功能做合规检查：适用法规、要求、风险与所需审批，附 GDPR/CCPA、DPA 清单 |
| fs/financial-analysis/ppt-template-creator | 58.8 | 48.0 | W3 | 模板技能生成 | reference | 把机构的 PPT 模板解析成自包含的可复用模板 skill |
| fs/financial-analysis/skill-creator ● | 58.8 | 48.0 | W3 | 技能创作 | reference | 指导创建、初始化、校验与打包新 skill 的元技能 |
| mkt/onboarding | 58.8 | 84.0 | W1 | 用户激活 | rewrite | 设计注册后激活流程：寻找 aha 时刻、最短价值路径、清单/空状态/引导与停滞用户召回 |
| kwp/partner-built/common-room/weekly-prep-brief ● | 58.7 | 34.0 | W3 | 会前准备 | reference | 汇总未来 7 天所有外部会议，逐场生成账户与参会人研究周报 |
| mkt/social | 58.4 | 76.0 | W1 | 社媒内容 | rewrite | 社媒内容创作与再利用：内容支柱、钩子公式、从播客/网络研讨会转录拆内容原子、日历与短视频脚本 |
| seo/seo-geo | 58.4 | 76.0 | W1 | AI 搜索优化 | rewrite | 面向 AI Overviews/AI Mode/ChatGPT/Perplexity 的 GEO 审计：可引用性、结构、多模态、权威信号、爬虫访问分项与报告 |
| seo/seo-cluster | 58.2 | 76.0 | W1 | 关键词聚类 | reference | 按 SERP 重合度聚类关键词，设计支柱-辐条内容架构与内链矩阵，生成交互式集群图与内容简报 |
| alir/ra-qm-team/iso42001-specialist | 58.2 | 44.0 | W3 | AI 治理 | reference | ISO/IEC 42001 AI 管理体系内审：条款 4-10 差距、AI 风险登记与 Annex A 控制映射、9.2 内审计划 |
| kwp/finance/close-management | 58.2 | 80.0 | W1 | 月结 | rewrite | 月结日历、任务依赖层级、状态看板与关账复盘清单 |
| wsh/startup-business-analyst/competitive-landscape | 58.2 | 90.0 | W1 | 竞品分析 | rewrite | 竞争格局分析：五力、蓝海四动作、定位图、竞品档案模板、定价对比与持续监测节奏 |
| kwp/finance/financial-statements | 58.0 | 80.0 | W1 | 财务报表 | rewrite | 生成带环比/预算对比与重大差异标记的损益表，附资产负债表与现金流量表格式 |
| fs/fund-admin/break-trace ● | 57.9 | 50.0 | W3 | 差异溯源 | rewrite | 把对账差异追溯到两侧源交易，给出单句根因、责任方与处置动作 |
| legal/employment-legal/investigation-open | 57.8 | 60.0 | W2 | 内部调查 | reference | 开立内部调查：运行立案问询、生成来源清单并创建持久调查日志（调用 internal-investigation 模式 1） |
| legal/employment-legal/investigation-add | 57.8 | 60.0 | W2 | 内部调查 | reference | 向在办调查添加文件/访谈笔记：按拉取准则筛选、报告命中比例并记录全部已审文件（模式 2） |
| legal/employment-legal/investigation-query | 57.8 | 60.0 | W2 | 内部调查 | reference | 对调查日志提问：证人说法、说法冲突、证据缺口与各议题最强证据，均引用日志条目（模式 3） |
| legal/employment-legal/investigation-memo | 57.8 | 60.0 | W2 | 内部调查 | reference | 根据调查日志起草或增量更新特权调查备忘录（模式 4） |
| legal/employment-legal/policy-drafting | 57.8 | 60.0 | W2 | 制度文件 | rewrite | 起草一份通用员工政策，并为法域足迹中规则不同的地区生成补充条款与内部起草说明 |
| alir/business-operations/vendor-management | 57.8 | 40.0 | W3 | 供应商管理 | reference | 供应商季度评分卡、SLA 合规与赔付资格、第三方风险四向量分级 |
| kwp/small-business/lead-triage | 57.8 | 68.0 | W1 | 线索评分 | reference | 按互动、匹配度、紧迫度给入站线索打分排序，附谈话要点、跟进草稿与候选时段 |
| mkt/offers | 57.8 | 80.0 | W1 | 报价方案设计 | reference | 用价值方程诊断并重构商业报价：六要素、奖励叠加、担保类型、真实稀缺与命名 |
| mkt/public-relations | 57.8 | 76.0 | W1 | 公关媒体 | reference | 赢得媒体报道：四种 PR 模式、故事角度、蹭热点、记者推介质量门、播客嘉宾准备与新闻页 |
| wsh/startup-business-analyst/startup-metrics-framework | 57.8 | 90.0 | W1 | 指标体系 | rewrite | 分商业模式与阶段的创业公司指标体系：收入、单位经济、现金效率、留存、市场平台/消费/B2B 指标与投资人关注点 |
| kwp/human-resources/performance-review | 57.6 | 84.0 | W1 | 绩效评估 | rewrite | 生成自评模板、经理评语与校准会准备文档 |
| fs/private-equity/ai-readiness | 57.6 | 94.0 | W1 | 投后赋能 | rewrite | 扫描组合公司找出最高杠杆 AI 机会，按 EBITDA 贡献排序并识别可复制打法 |
| fs/financial-analysis/xlsx-author | 57.4 | 88.0 | W1 | 表格生成 | reference | 无头模式下用 openpyxl 生成 .xlsx 文件的输出约定（颜色、无硬编码、检查页） |
| legal/legal-builder-hub/auto-updater | 57.4 | 38.0 | W3 | 技能管理 | reference | 检查已装社区技能的上游更新，展示 diff、重跑安全扫描，人工批准后才应用并可回滚 |
| fs/financial-analysis/clean-data-xls | 57.4 | 54.0 | W3 | 数据清洗 | rewrite | 清理表格数据：空白、大小写、文本数字、日期、重复与混合类型 |
| mkt/launch | 57.4 | 80.0 | W1 | 产品发布 | rewrite | 产品/功能发布规划：ORB 渠道框架、SLC 就绪门、五阶段发布与发布清单 |
| kwp/sales/crm-hygiene-check ● | 57.3 | 60.0 | W2 | 数据校验 | reference | 只读审计 CRM 商机的缺失字段、过期日期与阶段不匹配，输出修复清单 |
| kwp/operations/runbook ● | 57.3 | 94.0 | W1 | 运行手册 | direct | 为重复性操作生成含前置条件、逐步命令、预期结果、故障排查、回滚与升级的运行手册 |
| mkt/analytics ● | 57.2 | 81.0 | W1 | 埋点方案 | reference | 制定埋点追踪方案：事件命名、属性、GA4/GTM 实施、UTM 规范与校验清单 |
| kwp/product-management/product-brainstorming | 57.0 | 100.0 | W1 | 头脑风暴 | direct | 作为有观点的产品思考伙伴，分模式探索问题、发散方案、压测假设与战略 |
| kwp/small-business/call-list | 57.0 | 58.0 | W2 | 外呼清单 | reference | 调用线索排序选出今日前 N 个电话，附谈话要点、日历占位与跟进草稿 |
| kwp/small-business/build-connector | 57.0 | 24.0 | W3 | 开发者工具 | reference | 为无官方连接器的工具查目录、经 Zapier 或定时导出接入，最小权限并测试 |
| kwp/operations/capacity-plan | 56.8 | 88.0 | W1 | 容量规划 | rewrite | 按人员、预算、时间三维分析团队利用率与未来需求缺口，给出招聘/延期情景 |
| alir/product-team/ui-design-system | 56.8 | 48.0 | W3 | 设计系统 | reference | 从品牌色生成设计令牌、组件体系、响应式计算与开发交接清单 |
| mkt/competitors | 56.6 | 80.0 | W1 | 竞品对比页 | reference | 制作四类竞品对比/替代页，配集中式竞品数据文件与 SEO 关键词规划 |
| mkt/influencer-marketing | 56.4 | 76.0 | W1 | 达人营销 | reference | 达人/大使合作全流程：寻找与审核、合作结构与报价区间、披露合规、创意简报与 ROI 计量 |
| fs/fund-admin/roll-forward ● | 56.4 | 59.0 | W3 | 审计支持 | rewrite | 为资产负债科目编制期初到期末滚动表，每行勾稽总账并做合计检查 |
| legal/legal-clinic/client-comms-log | 56.2 | 84.0 | W1 | 事项管理 | reference | 按案件追加式记录客户沟通（方向、渠道、摘要、待办），并可扫描未回复与跟进缺口 |
| kwp/marketing/campaign-plan | 56.2 | 82.0 | W1 | 营销活动策划 | rewrite | 生成完整营销活动简报：目标、受众、信息、渠道、内容日历、指标与风险 |
| kwp/design/design-critique | 56.2 | 88.0 | W1 | 设计评审 | rewrite | 对设计稿按可用性、层级、一致性、无障碍给出结构化评审意见 |
| kwp/engineering/standup | 56.2 | 68.0 | W2 | 状态汇报 | rewrite | 从提交、工单、聊天汇总出昨日/今日/阻塞格式的站会更新 |
| wsh/business-analytics/kpi-dashboard-design | 56.2 | 88.0 | W1 | 仪表盘 | reference | KPI 仪表盘设计：指标分层、SMART、仪表盘层级、最佳实践与常见口径冲突排错 |
| kwp/data/build-dashboard | 56.2 | 84.0 | W1 | 仪表盘 | rewrite | 把数据生成自包含的交互式 HTML 仪表盘（KPI 卡、Chart.js 图表、筛选、可排序表） |
| fs/investment-banking/buyer-list | 56.0 | 80.0 | W1 | 买方名单 | rewrite | 为卖方并购流程梳理战略与财务买方、评估匹配度并分层排定接触顺序 |
| wsh/startup-business-analyst/startup-financial-modeling | 55.8 | 44.0 | W3 | 财务模型 | rewrite | 初创公司 3-5 年财务模型：同期群收入、成本结构、现金流与跑道、三情景、融资与里程碑 |
| kwp/finance/reconciliation | 55.8 | 84.0 | W1 | 对账 | rewrite | 总账对明细账、银行、关联方对账方法与调节项分类、账龄升级规则 |
| mkt/cro | 55.6 | 80.0 | W1 | 转化优化 | reference | 按七维影响顺序诊断营销页面转化问题，输出速赢项、高影响改动与测试假设 |
| kwp/engineering/code-review ● | 55.5 | 91.0 | W1 | 代码审查 | rewrite | 从安全、性能、正确性、可维护性四维审查 diff 或 PR 并给结论 |
| kwp/data/statistical-analysis | 55.4 | 48.0 | W3 | 统计分析 | rewrite | 描述统计、趋势、异常值与假设检验方法，以及统计结论的谨慎边界 |
| mkt/emails | 55.2 | 80.0 | W1 | 邮件起草 | reference | 设计生命周期/培育/欢迎/召回邮件序列：节奏、主题行、每封结构与指标计划 |
| alir/compliance-os/gdpr-audit-prep | 55.2 | 66.0 | W1 | 隐私合规 | reference | GDPR 内审六问（逐条引用条款）：RoPA、合法性基础、DPIA、DSAR、跨境传输、违规日志 |
| kwp/sales/rep-context | 55.2 | 64.0 | W2 | 绩效评估 | reference | 为销售主管 1:1 准备单个销售的管道、近期活动、聊天所提阻塞与针对性问题 |
| fs/private-equity/returns-analysis | 55.2 | 60.0 | W2 | 回报分析 | rewrite | 按进入/退出倍数、杠杆、增长与持有期做 IRR/MOIC 敏感性与情景分析 |
| kwp/engineering/architecture | 55.0 | 88.0 | W1 | 架构设计 | rewrite | 撰写或评估架构决策记录（ADR），显式比较方案与取舍 |

## 7. 按专家智能体的 A 层构成

- **legal**（51）：legal/product-legal/launch-review（84.4）、legal/commercial-legal/vendor-agreement-review（82.0）、legal/corporate-legal/tabular-review（81.0）、legal/regulatory-legal/policy-diff（79.8）、legal/ai-governance-legal/use-case-triage（79.6）、legal/ai-governance-legal/aia-generation（79.0）、legal/privacy-legal/pia-generation（77.6）、legal/ai-governance-legal/vendor-ai-review（77.0）、legal/regulatory-legal/gap-surfacer（76.8）、kwp/legal/review-contract（76.6）、legal/litigation-legal/chronology（76.2）、legal/employment-legal/international-expansion（76.0） …
- **sales**（29）：kwp/small-business/proposal-builder（82.2）、kwp/sales/call-summary（80.4）、kwp/small-business/inbox-manager（77.8）、kwp/legal/review-contract（76.6）、kwp/sales/customer-voice（76.2）、mkt/product-marketing（76.0）、mkt/competitor-profiling（75.4）、kwp/small-business/crm-autopilot（74.8）、kwp/sales/competitive-intelligence（74.6）、legal/commercial-legal/nda-review（74.2）、kwp/sales/call-prep（74.0）、kwp/sales/create-an-asset（74.0） …
- **product**（27）：legal/product-legal/launch-review（84.4）、legal/ai-governance-legal/use-case-triage（79.6）、legal/ai-governance-legal/aia-generation（79.0）、mkt/customer-research（79.0）、askills/doc-coauthoring（77.8）、legal/privacy-legal/pia-generation（77.6）、kwp/sales/customer-voice（76.2）、mkt/product-marketing（76.0）、legal/privacy-legal/use-case-triage（75.6）、legal/product-legal/marketing-claims-review（75.6）、mkt/competitor-profiling（75.4）、kwp/product-management/stakeholder-update（75.2） …
- **ops**（27）：kwp/small-business/proposal-builder（82.2）、legal/commercial-legal/vendor-agreement-review（82.0）、legal/regulatory-legal/policy-diff（79.8）、kwp/small-business/inbox-manager（77.8）、askills/doc-coauthoring（77.8）、legal/ai-governance-legal/vendor-ai-review（77.0）、legal/regulatory-legal/gap-surfacer（76.8）、mkt/marketing-loops（76.0）、kwp/small-business/build-agent（75.4）、kwp/product-management/stakeholder-update（75.2）、legal/commercial-legal/saas-msa-review（75.0）、kwp/enterprise-search/search（74.8） …
- **exec**（19）：legal/ai-governance-legal/use-case-triage（79.6）、kwp/small-business/inbox-manager（77.8）、askills/doc-coauthoring（77.8）、kwp/small-business/report-builder（76.4）、legal/employment-legal/international-expansion（76.0）、kwp/product-management/stakeholder-update（75.2）、legal/ai-governance-legal/policy-starter（74.4）、alir/project-management/senior-pm（73.6）、alir/c-level-advisor/decision-logger（71.8）、kwp/product-management/competitive-brief（71.6）、mkt/marketing-plan（71.3）、askills/internal-comms（70.6） …
- **finance**（15）：legal/corporate-legal/tabular-review（81.0）、kwp/small-business/report-builder（76.4）、legal/employment-legal/international-expansion（76.0）、legal/corporate-legal/closing-checklist（75.2）、legal/corporate-legal/diligence-issue-extraction（75.0）、legal/commercial-legal/renewal-tracker（74.4）、legal/corporate-legal/integration-management（73.8）、kwp/legal/triage-nda（69.8）、kwp/small-business/business-pulse（69.8）、kwp/small-business/ap-processor（69.6）、kwp/small-business/month-end-prep（68.8）、alir/c-level-advisor/board-meeting（68.8） …
- **marketing**（15）：mkt/customer-research（79.0）、kwp/sales/customer-voice（76.2）、mkt/product-marketing（76.0）、mkt/marketing-loops（76.0）、legal/product-legal/marketing-claims-review（75.6）、mkt/competitor-profiling（75.4）、kwp/sales/competitive-intelligence（74.6）、kwp/sales/create-an-asset（74.0）、legal/privacy-legal/policy-monitor（73.4）、kwp/small-business/outreach-composer（72.8）、mkt/marketing-plan（71.3）、kwp/small-business/social-content-engine（70.5） …
- **engineering**（14）：legal/product-legal/launch-review（84.4）、legal/ai-governance-legal/use-case-triage（79.6）、legal/ai-governance-legal/aia-generation（79.0）、legal/privacy-legal/pia-generation（77.6）、legal/ai-governance-legal/vendor-ai-review（77.0）、legal/privacy-legal/use-case-triage（75.6）、legal/ai-governance-legal/policy-starter（74.4）、askills/skill-creator（73.8）、legal/ai-governance-legal/reg-gap-analysis（70.9）、legal/ip-legal/oss-review（69.6）、legal/ai-governance-legal/cold-start-interview（69.0）、legal/ip-legal/invention-intake（68.3） …
- **research**（12）：legal/corporate-legal/tabular-review（81.0）、mkt/customer-research（79.0）、kwp/sales/customer-voice（76.2）、legal/litigation-legal/chronology（76.2）、mkt/competitor-profiling（75.4）、kwp/enterprise-search/search（74.8）、kwp/product-management/synthesize-research（74.4）、legal/regulatory-legal/reg-feed-watcher（74.0）、kwp/enterprise-search/knowledge-synthesis（73.4）、kwp/product-management/competitive-brief（71.6）、kwp/sales/account-research（68.4）、fs/financial-analysis/competitive-analysis（68.2）
- **support**（9）：kwp/sales/call-summary（80.4）、kwp/sales/customer-voice（76.2）、kwp/product-management/synthesize-research（74.4）、kwp/sales/call-prep（74.0）、kwp/enterprise-search/knowledge-synthesis（73.4）、kwp/sales/inbox-sweep（71.1）、kwp/small-business/ticket-deflector（70.0）、kwp/sales/customer-health（69.9）、legal/privacy-legal/dsar-response（68.1）
- **hr**（6）：legal/employment-legal/international-expansion（76.0）、legal/employment-legal/internal-investigation（74.6）、legal/ai-governance-legal/policy-starter（74.4）、kwp/small-business/hiring-screener（74.2）、legal/employment-legal/termination-review（71.2）、kwp/small-business/job-post-builder（69.1）
- **data**（2）：kwp/small-business/report-builder（76.4）、kwp/data/data-context-extractor（69.2）
- **other**（2）：kwp/small-business/build-agent（75.4）、askills/skill-creator（73.8）

## 8. 同职能族候选合并组（跨来源包，需人工确认是否真重复）

- **状态汇报**：★kwp/product-management/stakeholder-update（A 75.2）、alir/project-management/senior-pm（A 73.6）、askills/internal-comms（A 70.6）、kwp/sales/end-of-day（A 69.2）、legal/litigation-legal/portfolio-status（B 67.4）、legal/corporate-legal/deal-team-summary（B 66.1）、kwp/operations/status-report（B 65.7）、kwp/sales/daily-briefing（B 63.9）、kwp/sales/weekly-wrap（B 61.8）、kwp/engineering/standup（B 56.2）
- **档案访谈**：★mkt/product-marketing（A 76.0）、legal/commercial-legal/cold-start-interview（A 69.3）、legal/ai-governance-legal/cold-start-interview（A 69.0）、legal/product-legal/cold-start-interview（A 68.8）、legal/privacy-legal/cold-start-interview（A 68.1）、legal/corporate-legal/cold-start-interview（B 64.3）、kwp/productivity/start（B 62.6）、legal/regulatory-legal/cold-start-interview（B 61.2）、kwp/small-business/smb-onboard（B 60.4）
- **合同审阅**：★legal/commercial-legal/vendor-agreement-review（A 82.0）、kwp/legal/review-contract（A 76.6）、legal/commercial-legal/saas-msa-review（A 75.0）、legal/ip-legal/ip-clause-review（A 71.4）、kwp/small-business/contract-review（A 70.5）、legal/commercial-legal/amendment-history（B 63.0）、evolsb/claude-legal-skill（B 59.4）
- **事项管理**：★legal/litigation-legal/matter-intake（A 73.2）、kwp/productivity/update（A 68.1）、legal/litigation-legal/matter-update（B 64.0）、legal/litigation-legal/matter-close（B 60.0）、legal/legal-clinic/supervisor-review-queue（B 59.8）、fs/investment-banking/deal-tracker（B 59.4）、legal/legal-clinic/client-comms-log（B 56.2）
- **合规检查**：★legal/regulatory-legal/policy-diff（A 79.8）、legal/regulatory-legal/gap-surfacer（A 76.8）、legal/regulatory-legal/policy-redraft（A 74.4）、legal/ip-legal/oss-review（A 69.6）、legal/corporate-legal/entity-compliance（A 68.1）、kwp/legal/compliance-check（B 58.8）
- **客户研究**：★mkt/customer-research（A 79.0）、kwp/sales/stakeholder-map（A 70.3）、kwp/sales/account-context（A 68.5）、kwp/sales/account-research（A 68.4）、kwp/customer-support/customer-research（B 67.1）、kwp/partner-built/common-room/account-research（B 62.6）
- **竞品分析**：★mkt/competitor-profiling（A 75.4）、kwp/sales/competitive-intelligence（A 74.6）、kwp/product-management/competitive-brief（A 71.6）、fs/financial-analysis/competitive-analysis（A 68.2）、kwp/marketing/competitive-brief（B 62.4）、wsh/startup-business-analyst/competitive-landscape（B 58.2）
- **会前准备**：★kwp/sales/call-prep（A 74.0）、kwp/legal/meeting-briefing（A 68.4）、legal/litigation-legal/matter-briefing（B 65.7）、kwp/partner-built/common-room/call-prep（B 60.3）、fs/private-equity/dd-meeting-prep（B 59.0）、kwp/partner-built/common-room/weekly-prep-brief（B 58.7）
- **风险评估**：★legal/litigation-legal/demand-received（A 73.4）、legal/employment-legal/termination-review（A 71.2）、legal/product-legal/feature-risk-assessment（A 68.5）、kwp/legal/legal-risk-assessment（B 67.3）、legal/employment-legal/worker-classification（B 65.9）、kwp/sales/deal-signals（B 64.9）
- **仪表盘**：★kwp/small-business/report-builder（A 76.4）、kwp/small-business/report-pack（B 61.2）、wsh/business-analytics/kpi-dashboard-design（B 56.2）、kwp/data/build-dashboard（B 56.2）
- **内容创作**：★kwp/sales/create-an-asset（A 74.0）、kwp/small-business/social-content-engine（A 70.5）、alir/marketing-skill/content-production（B 64.2）、kwp/small-business/canva-creator（B 61.3）
- **月结**：★kwp/small-business/month-end-prep（A 68.8）、fs/fund-admin/accrual-schedule（B 62.2）、kwp/small-business/close-month（B 61.3）、kwp/finance/close-management（B 58.2）
- **财务模型**：★fs/financial-analysis/3-statement-model（B 67.4）、alir/finance/financial-analyst（B 60.0）、alir/c-level-advisor/cfo-advisor（B 59.4）、wsh/startup-business-analyst/startup-financial-modeling（B 55.8）
- **定价**：★alir/commercial/deal-desk（B 66.4）、mkt/pricing（B 61.9）、alir/commercial/pricing-strategist（B 59.8）、alir/marketing-skill/pricing-strategy（B 59.4）
- **文案**：★mkt/copy-editing（B 63.4）、alir/marketing-skill/copywriting（B 63.2）、mkt/copywriting（B 62.0）、alir/marketing-skill/copy-editing（B 59.6）
- **路由编排**：★legal/commercial-legal/review（A 73.3）、kwp/sales/route-lead（A 69.6）、kwp/small-business/smb-router（B 60.8）
- **档案定制**：★kwp/productivity/memory-management（B 67.5）、alir/c-level-advisor/context-engine（B 65.6）、kwp/cowork-plugin-management/cowork-plugin-customizer（B 62.6）
- **会议纪要**：★kwp/sales/call-summary（A 80.4）、legal/corporate-legal/board-minutes（B 67.1）
- **尽调**：★legal/corporate-legal/diligence-issue-extraction（A 75.0）、fs/private-equity/dd-checklist（B 60.6）
- **NDA 审阅**：★legal/commercial-legal/nda-review（A 74.2）、kwp/legal/triage-nda（A 69.8）
- **招聘**：★kwp/small-business/job-post-builder（A 69.1）、legal/employment-legal/hiring-review（B 62.4）
- **SEO 审计**：★kwp/small-business/seo-ai-visibility（B 64.4）、mkt/seo-audit（B 62.8）
- **对账**：★fs/fund-admin/gl-recon（B 64.0）、kwp/finance/reconciliation（B 55.8）
- **AI 搜索优化**：★mkt/ai-seo（B 61.6）、seo/seo-geo（B 58.4）
- **差异分析**：★kwp/finance/variance-analysis（B 61.6）、fs/fund-admin/variance-commentary（B 60.8）
- **邮件起草**：★legal/litigation-legal/oc-status（B 61.6）、mkt/emails（B 55.2）
- **升级处理**：★legal/commercial-legal/escalation-flagger（B 61.6）、kwp/customer-support/customer-escalation（B 61.0）
- **设计系统**：★kwp/design/design-system（B 59.4）、alir/product-team/ui-design-system（B 56.8）

★ = 该族 V 最高者，建议作为规范版本。

## 9. 硬门未通过

| id | 未过的门 | 说明 |
|---|---|---|
| askills/xlsx | G1 | 许可为 Proprietary（All rights reserved），G1 不过 |
| askills/docx | G1 | 许可为 Proprietary（LICENSE.txt：All rights reserved），G1 不过；编辑外部文档时先删符号链接，视外部文件为不可信 |
| dp/tam-sam-som-calculator | G1 | 许可 CC-BY-NC-SA-4.0 禁止商用，G1 不过；依赖同包 workshop-facilitation/autonomous-investigation 协议 |
| dp/agent-orchestration-advisor | G1 | 许可 CC-BY-NC-SA-4.0 禁止商用，G1 不过；依赖同包 context-engineering-advisor |
| dp/discovery-interview-prep | G1 | 许可 CC-BY-NC-SA-4.0 禁止商用，G1 不过 |
| dp/user-story-mapping | G1 | 许可 CC-BY-NC-SA-4.0 禁止商用，G1 不过 |
| legal/external_plugins/cocounsel-legal/deep-research | G3 | 厂商插件目录无独立 LICENSE，名义上随仓库 Apache-2.0；全部价值依赖 Thomson Reuters 付费订阅的专有 MCP，无替代 → G3 fail |
| alir/c-level-advisor/c-level-skills | G3 | 自述“This is the bundle index, not an advisor”，无步骤/模板/判据，属导航空壳 |
| alir/business-growth/business-growth-skills | G3 | 自述“This router ships no tools of its own”，仅路由表，属空壳 |
| alir/ra-qm-team/ra-qm-skills | G3 | 自述“This router ships no tools of its own”，仅路由表 |
| legal/legal-clinic/form-generation | G3 | 已弃用空壳，仅重定向到 draft |
| legal/legal-clinic/plain-language-letters | G3 | 已弃用空壳，仅重定向 |

可修复（fixable）103 个，改写时处理。

## 10. 数据质量

- 低置信度 2 个；仅 E1 证据 0 个（A 层要求 ≥ E2）。
- R1 推出的波次与 capabilities 推出的波次不一致：178 个（说明连接器"可选有降级"，按降级后能力判了更早的波次）。
- 校验错误 0，警告 0。

