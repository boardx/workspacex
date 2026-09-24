# PROP-EXPERT-COMMUNITY-001 — 工作最佳实践社区：专家智能体 × 技能包 × 工具

> 状态：**提案**（2026-09-24）。**D-EC1、D-EC2、D-EC3、D-EC5、D-EC7、D-EC8、D-EC9 已由人类拍板**（2026-09-24，见 §9），仅 D-EC4、D-EC6 待定。不代表任何能力已实现或已签核。
> 性质：用户直接交办的研究与方案（本会话），不认领 feature、不改 `feature_list.json`。
> 与既有文档的关系（同一事实不写两处）：
> - 商业结构、开源边界、12 类角色体验 → 以 `docs/research/open-source-business-model.md`（v32.10）为准，本文只引用、不复述；本文与它冲突的地方列在 §9 待拍板。
> - 导入 → 草稿 → 试跑 → 发布的**开发工作台**体验 → 以 `docs/design/ai-capability-studio-e2e-plan-2026-09-09.md`（phase-15）为准，本文只定义它上面缺的层。
> - 逐 skill 的运行要求拆解（155 个上游 skill）→ 附录 `PROP-EXPERT-COMMUNITY-001-appendix-kwp-skills.md`。

---

## 0. 一页结论

1. **方向可行，且时机对。** 2025-10 起 SKILL.md（Agent Skills）成为跨厂商开放标准（agentskills.io，46 个客户端含 Claude、Codex、Gemini CLI、Cursor、Microsoft Agent Framework）。LangChain deepagents——也就是我们 `apps/deep-agent-service` 的底座——原生用同构的 `AGENTS.md + skills/*/SKILL.md`。**开源生态里已经有一批可商用许可、质量经得起逐行审阅的职能内容**，最成熟的是 Anthropic 官方的三个 Apache-2.0 仓库（knowledge-work-plugins、claude-for-legal、financial-services）和两个 MIT 社区包（marketingskills、claude-seo）。
2. **我们缺的不是内容，是"把内容变成团队可信赖的工作单元"的那一层。** 调研拆了 155 个官方 skill：111 个核心 skill 里 35 个可直接导入、66 个改写后导入、10 个只作参考；**所有 skill 在不接任何连接器时都能靠"上传文件"降级运行**。要让 82% 的 skill 全功能运行，需要 8 项工具能力 + 12 类连接器；我们已有聊天、知识库、产出物、转录、深度研究、Agent/Skill 运行时，**缺的是邮件、日历、项目跟踪、CRM 四类连接器，以及代码执行（Python/Office）、SQL 沙箱、真调度器**。
3. **用户为什么用我们**（§1）：同样一份开源 skill，在 Claude Cowork 里是"一个人的插件"，在 WorkSpaceX 里是"**团队经过验证、带本组织档案、有审批与审计、在中国可部署、换模型也能跑的工作方法**"。社区的核心资产不是 skill 数量，而是**验证证据**（每个条目带评测基线对比与扫描结论）和**组织档案**（playbook、品牌规范、指标口径随团队沉淀）。
4. **怎么建**（§3–§7）：九层能力，其中 Agent 运行时、skill 运行时、MCP 网关、多租户与审批**已有**（phase-00/14 落地）；需要新建的层都有可直接借用的开源实现——质量门借 Claude 插件目录的策略扫描（Apache-2.0）、评测借 skill-creator（Apache-2.0）与 finance_skills 的基线对照方法、注册表借官方 MCP Registry 的 schema、连接器借厂商官方远程 MCP、文档生成借 python-docx/openpyxl/python-pptx（MIT）。
5. **路线图**（§8）：**社区立即开放**（D-EC2）——W0 先上一个公开的社区注册表仓库，外部作者提 PR 提交技能包，CI 自动跑 L0–L3 质量门；它用开放标准格式，提交的内容当天就能在 Claude Code / Codex / Cursor 里安装使用，不等产品 UI（§8.4）。**W1 不依赖任何新连接器**，只靠 phase-15 工作台 + 平台级安全策略 + 评测 runner，就能在产品里上线 20 个协作类 skill，并让社区条目可以升到"已验证"；W2 接四类连接器与组织档案，推出第一个专家智能体；W3 扩运行时（Python/Office/SQL/调度），打开金融建模、SEO、后台 agent；W4 做产品内的社区体验（徽章与趋势展示、组织私有目录、创作者分成）。
6. **已拍板两项**（§9）：D-EC1——开源导入的内容按上游许可免费提供，卖验证、本地化、托管执行与企业治理，自研内容仍闭源售卖；D-EC2——社区立即开放。已回写 `open-source-business-model.md` v32.11（D4 改写、新增 D18、技能包作者提前到 H1）。其余四项待定，其中 **D-EC5 许可白名单与生态负责人任命是开放社区的前置条件**。
7. **逐 skill 评审**（§6.0、附录 C）：按一套可复核的入选标准（硬门 + 价值分 + 就绪分，每个分数附证据，边界带双人共识）对 645 个 skill 逐个打分：A 层 104 个、其中 31 个 W1 即可上线。评审员一致性与权重敏感性检验全部达标。数据给出两个方向性结论：**法务是开源内容里最强的一块**；**组织档案比任何连接器都更值得先建**（75 个 A 层 skill 依赖它），所以档案从 W2 提前到 W1 末尾。

---

## 1. 用户为什么要用我们

### 1.1 竞争格局：内容已经免费，差异在"信任 + 团队 + 本地"

| 替代方案 | 它给了什么 | 它没给的（我们的机会） |
|---|---|---|
| Claude Cowork / Claude Code 插件 | 155 个官方职能 skill，免费、质量高；Small Business 插件官方称装机 90 万+ | 个人级：档案写在本机文件（`legal.local.md`、`~/.claude/...`），**团队无法共享、审批、审计**；在中国大陆不可用；只跑 Claude |
| ChatGPT / Codex 插件（2026-06 发布 6 个职能插件） | 投研、数据分析等深度插件 | 许可 Proprietary，不可复用；Sales、投行插件未开源；同样是个人级 |
| Coze 扣子、Dify、n8n 市场 | 模板量大（n8n AI 类约 8,000、Dify 约 300 模板） | 平台 DSL，**质量参差、几乎无评测**；偏自动化流水线，不是专业方法论 |
| 飞书 / 钉钉 AI | 本地协作入口、组织数据 | 方法论内容薄；锁定单一生态，退出成本高 |
| GitHub 上的开源包 | 内容本身 | 需要自己读代码、判断许可、防注入、写评测、做本地化——**没人替你验证** |

### 1.2 价值主张（给四类人）

| 谁 | 他的痛 | 我们的承诺 | 第一个价值时刻 |
|---|---|---|---|
| **个人专业者**（PM、法务、财务、市场、销售、HR） | 开源 skill 很多，不知道哪个靠谱；每次都要重新交代公司背景 | 目录里每个条目标明**验证级别、评测基线提升、扫描结论**；一次访谈建好领域档案，之后所有 skill 共用 | 上传一份文件，5 分钟内拿到一份符合本公司规范、每个数字标了来源的成品（需求文档 / 合同审阅 / 周报） |
| **团队 leader（买家）** | 团队方法论在个人脑子里、质量不一 | playbook、品牌规范、指标口径成为**版本化团队资产**；专家智能体按团队档案工作；偏离累积后自动提"修订提案"由负责人审批 | 第一次看到团队产出按同一套标准交付，且有复核记录 |
| **IT 与安全（把门人）** | 外部 skill 可能含提示注入、凭据外传；SaaS 数据出境 | 所有导入内容过 L0–L7 质量门（§5）；写操作有五种审批模式；工具定义哈希固定；**可私有化部署、国内模型可用、退出自由** | 安全评审一次通过，拿到可审计的扫描报告与工具权限清单 |
| **技能包作者 / 社区贡献者** | 写了好 skill 没有分发渠道、不知道质量如何 | 提交即获得自动 lint、安全扫描、评测跑分；达到门槛获得验证徽章与曝光 | 第一个技能包的 PR 通过 L0–L3 自动门并合入社区注册表，当天就能被 Claude Code / Codex / Cursor 安装（D-EC2：立即开放，见 §8.4） |

### 1.3 一句话定位（建议）

> **WorkSpaceX：把全球开源的最佳工作方法，变成你团队验证过、带着你组织上下文、可审计可自托管的专家智能体。**

差异化的三根支柱，每根都要有机械可检查的证据，否则只是口号：

1. **已验证**——每个上架条目有评测集与"有/无 skill"基线对比（不是星数）。门控：没有 `evals/` 的条目不能标"已验证"。
2. **懂你的组织**——档案（组织级 + 领域级）与项目/事项隔离是平台能力，不是每个 skill 自己写文件。门控：skill 里出现写本地配置文件的指令 = lint 红。
3. **可信赖**——审批、审计、多租户、私有化、多模型、退出自由。门控：复用 phase-14 已有的审计 transcript 与 HITL 四档授权。

---

## 2. 目标形态：社区里有什么

```mermaid
flowchart LR
  subgraph 上游开源生态
    U1[Anthropic 官方<br/>kwp / legal / finance]
    U2[社区包<br/>marketingskills / claude-seo ...]
    U3[MCP 官方 Registry<br/>厂商远程 MCP]
    U4[框架示例<br/>deepagents / TradingAgents ...]
  end
  subgraph WorkSpaceX 社区（子注册表）
    I[导入管线<br/>钉 SHA · 许可检查 · 格式转换]
    G[质量门 L0–L7<br/>lint · 扫描 · 评测 · 专家认证]
    C[(目录<br/>专家智能体 / 技能包 / 工具)]
  end
  subgraph 客户组织实例
    P[组织私有目录<br/>白名单 · 私有技能包]
    X[组织档案 + 项目/事项<br/>组织大脑]
    R[运行：聊天 / 项目 / 后台 agent]
  end
  U1 & U2 & U4 --> I
  U3 --> I
  I --> G --> C --> P --> R
  X --> R
  R -- 评分 · 失败 · 偏离提案 --> G
  C -. 修复回馈上游 PR .-> U1 & U2
```

三类内容单元：

| 单元 | 定义 | 例子 | 仓库现有对应 |
|---|---|---|---|
| **技能包** | 一组 SKILL.md（+ references/scripts/evals）+ 清单元数据，商业与分发单元 | kwp `product-management`、marketingskills | `skills/*`、`capability_id`、`version-chain.ts` |
| **专家智能体** | 角色 + 路由 + 一组技能包 + 档案 schema + 连接器需求 + 触发器 + 审批 + 评测（§4） | "商事法务专家"、"财务建模专家"、"SEO 审计专家" | `domain/agent/definition.ts`（有定义、版本、发布审核，缺档案/路由/触发器） |
| **工具** | MCP server 或平台内置工具，按"连接器类别"注册 | HubSpot 远程 MCP、飞书 CLI、python 沙箱 | `infrastructure/mcp/*`、`wx_*` 工具 |

---

## 3. 需要构建的能力地图

判断口径：**已有** = 代码在 main 且有 passing feature 或真实调用方；**部分** = 骨架在、缺闭环；**缺失** = 无实现。证据路径见附录 C。

| # | 能力 | 现状 | 缺口 | 构建方式 | 借用的开源实现 |
|---|---|---|---|---|---|
| C1 | **格式兼容**：读 agentskills 标准 SKILL.md、Claude `.claude-plugin/`、Codex `.codex-plugin/`；显式 `allowed-tools` | 部分（`skill-frontmatter.ts` 读 name/version/capability_id；无 allowed-tools） | 宽松解析（以目录名为准，容忍严格 YAML 失败——上游有 41+5+2 个违规）；Claude 专有字段映射（argument-hint→参数 schema、`user-invocable:false`→仅路由调用） | 自研（小） | `agentskills/skills-ref` 校验器（Apache-2.0）；Codex `marketplace.rs` 的读法作参考 |
| C2 | **导入管线**：URL/私库发现、钉 SHA、许可检测、NOTICE 保留、改写标注、上游 bump 与三方合并 | 部分（`application/skill-import/*` 已有 URL/私库导入；phase-15 设计了草稿与三方合并，未开工） | 许可证门（Proprietary / NC / Commons Clause / 无 LICENSE 自动拒）；每日 bump + 重扫；批量导入一个插件 | **并入 phase-15**，本方案只加许可门与 bump | claude-plugins-official 的 `bump-plugin-shas` / `revert-failed-bumps` workflow（Apache-2.0） |
| C3 | **连接器类别注册表**：skill 只写类别（CRM、邮件…），组织绑定具体 provider；实测探针；降级路径 | 缺失（MCP 网关已有，但无"类别"概念；业务 OAuth 连接器仅 GitHub） | 类别表 + provider 绑定 + `live_probe`（只有真实调用成功才算已连接）+ 每个 provider 一份"陷阱参考"文件 | 自研 | kwp `CONNECTORS.md` 的 `~~category` 约定；OpenAI data-analytics `.app.json` 的 `category/optional` 设计（仅参考，许可 Proprietary） |
| C4 | **业务连接器**：邮件、日历、项目跟踪、CRM（W2 必需）；文档/知识库、会议转录、数据仓库（W3） | 缺失 | OAuth 2.1 per-user token、网关统一吊销、工具注解（readOnly/destructive） | **导入**厂商官方远程 MCP + 开源自托管替代 | 见 §7 选型表 |
| C5 | **档案与记忆**：组织档案、领域档案（访谈式 onboarding，quick/full、可暂停续访、写前列空缺、改前给 diff）、个人写作风格、项目/事项隔离 | 部分（组织大脑架构定稿、Context Engine 自评 3/10；项目容器已有 `domain/project`） | 档案 schema + 访谈 skill 运行时；事项工作区（跨事项默认不可读、归档不删）；"用到时问一个问题再建议保存"交互 | 自研，**内容参考** claude-for-legal `cold-start-interview`（Apache-2.0，643 行，最完整样板）与 marketingskills `product-marketing` | claude-for-legal、marketingskills（MIT） |
| C6 | **学习闭环**：偏离台账 → 达阈值生成修订提案 → 负责人逐条 Accept/Reject/Edit/Defer → 改档案前给 diff | 部分（`rating-attribution.ts` 消息级评分归因到 skill 版本；`promotion-link.ts` 方法晋升） | 偏离台账与提案流 | 自研，流程照 claude-for-legal `playbook-monitor` + `review-proposals` | 同上 |
| C7 | **代码执行**：Python 沙箱（openpyxl、LibreOffice headless 重算、matplotlib）、SQL 只读执行 | 部分（`apps/skill-sandbox` 两层隔离，现为 Node：docx/pptxgenjs/exceljs/pdf-lib） | Python runtime、公式重算、SQL 沙箱、出网白名单 | 扩 skill-sandbox | gVisor / microsandbox / E2B（Apache-2.0）；**不用** Daytona（2026-06 停止开源维护） |
| C8 | **调度与后台 agent**：cron 定时、数据阈值触发、无头运行、结果无论有无都汇报（all-clear）、只做建计划时授权的动作 | 缺失（上游 SMB 插件自己承认"没有调度器"） | 调度器 + 触发器 schema + 后台运行的审批降级（只出提案不执行） | 自研，运行在 deep-agent-service（LangGraph 已有 checkpointer） | claude-for-legal `renewal-watcher` cookbook 作行为规范 |
| C9 | **编排与工具作用域分层**：路由 skill + 资格门；编排者只读、仅叶子 agent 可写/外发；叶子输出 JSON schema 校验 | 部分（deepagents 支持 subagent；`three-layer-permission.ts`） | 路由/资格门、作用域 lint | 自研 + 参考 | financial-services `orchestrate.py` 与 `lint-tool-scope.py`（Apache-2.0） |
| C10 | **产出物与溯源**：Office 生成、公司模板资产、产物 QA（数字 tie、公式优先、配平检查）、来源标签由工具层自动打（`[来源: 工具X]` / `[模型知识—需核验]` / `[未溯源]`） | 部分（产出物治理、`wx_artifact_publish`、docx/pptx/xlsx 生成已有） | 模板资产库、产物校验钩子、工具层来源标签 | 自研 + 参考 | financial-services `validate_dcf.py`、`extract_numbers.py`；claude-for-legal 来源标签规范 |
| C11 | **平台级安全策略**：外部内容一律当数据；金钱/凭据请求拦截；缺失≠零；不编造数字；租户边界；个人数据不复现；写入被拒转清单不重试；永不删除、永不自动发送 | 部分（HITL 四档授权、SSRF 两道门、审计 transcript 已有） | 把上游复制了 36 次的 9 条规则 + SMB 14 个共享规则**上移为一份平台策略**，skill 内重复出现 = lint 红 | 自研（收敛） | kwp sales 2.0 规则块、SMB shared rules、claude-seo untrusted-content 测试 |
| C12 | **质量门与评测**（§5） | 部分（`security-gate.ts`、`publish-review.ts`、`review-authorization.ts` 禁自审） | 结构 lint、安全扫描、evals runner、基线对照、触发 eval、持续复验 | 导入 + 自研 | skill-creator（Apache-2.0）、JoelLewis finance_skills 的 grade/benchmark（MIT）、snyk/agent-scan、cisco skill-scanner、Claude 插件目录 policy prompt（Apache-2.0） |
| C13 | **社区目录与分发**：子注册表、验证徽章、信号（30 天趋势而非累计）、组织私有目录/白名单、创作者提交、上游回馈 | 缺失（devportal 实测不是市场，公开层被 Access 挡住） | 全部 | 自研；schema 借 MCP Registry | modelcontextprotocol/registry（server.json、命名空间认证）；Dify 签名与风险自报；Cursor 的 verified 申请流 |
| C14 | **本地化**：中文触发语、中国法/会计准则/劳动法、国内连接器（飞书、钉钉、企业微信、e签宝）、国内数据源 | 缺失 | 内容改写 + 国别门控（美国准则的 skill 标注适用法域） | 自研为主 | 飞书官方 `larksuite/cli`（MIT，含 20+ skills） |

**最小可用集**（覆盖 W1）：C1、C2（phase-15）、C11、C12 的 L1–L3+L5 最小版。**不需要 C3/C4**——降级模式下 skill 读上传文件即可完整运行。

---

## 4. 专家智能体：抽象与落地

### 4.1 为什么要有"专家智能体"这一层

单个 skill 只解决一个动作；真实工作是"一个角色 + 一套档案 + 多个动作 + 定时盯着"。开源里做得最完整的样板排序：

1. **claude-for-legal / commercial-legal**：档案、事项工作区、11 类专业 skill、3 个后台 agent（定时 / 数据触发 / 复盘）、提案闭环、编排 cookbook、约 509 行共享护栏。
2. **financial-services 的 agent 插件**（pitch-agent、model-builder）：角色 md + 捆绑 skill + 工具声明 + 两处人审检查点；编排者与叶子权限分离最干净。
3. **claude-seo**：编排 skill 按条件派生 19 个子 agent；61 个脚本 + 67 个测试文件；工程安全最好。
4. **deepagents examples**：最小可移植结构（memory / skills / subagents 同构递归）——与我们运行时同源。

### 4.2 建议 schema（落到 `packages/contracts`，经契约签核后实施）

```yaml
ExpertAgent:
  identity:      { role_prompt, audience_modes: [professional, non_professional], disclaimers }
  profile:       { org_profile_ref, domain_profile_schema, onboarding: { modes: [quick, full], resumable: true }, customize_map }
  workspace:     { scope: org | project | matter, isolation: strict | cross, archive_policy: archive_never_delete }
  router:        { eligibility_gate, routing_map }
  skills:        [{ pack_id, version_pin, invocable: user | router_only, inputs_schema, outputs_contract }]
  tools:         { orchestrator: read_only, leaves: [{ name, grants: [write, send, mcp:*], output_schema }] }
  connectors:    [{ category, required: false, live_probe: true, fallback: upload | paste | checklist }]
  triggers:      [{ type: on_demand | schedule | data_threshold, target_skill, destination, all_clear: true }]
  approvals:     [{ action: sign | send | post | spend | write_record, gate: explicit_yes | role_based }]
  output_policy: { provenance_tags: auto, reviewer_note, severity_scale, decision_tree }
  learning:      { deviation_log, proposal_threshold, review_flow: diff_then_approve }
  evals:         { cases, trigger_cases, baseline_compare: required, graders: [deterministic, llm], artifact_validators }
```

与现有代码的关系：`domain/agent/definition.ts` 已有定义、版本快照、发布审核、工具调用审计——**扩字段，不另起一套**。`profile` 落在组织大脑（Context Engine）上，不新建存储。

### 4.3 首批专家智能体候选

| 专家智能体 | 内容来源 | 为什么先做 | 依赖能力 |
|---|---|---|---|
| **产品经理助理** | kwp product-management（5 直接 + 3 改写）+ operations status-report + support synthesize | 与"团队协作/知识管理"定位最契合；零连接器可跑 | W1 即可 |
| **商事法务专家** | claude-for-legal commercial-legal（改写，中国法本地化）+ kwp legal | 开源样板最完整；价值感最强（发布日引发法律信息公司股价单日跌 13–18%） | C5 档案、C6 提案、C8 定时（续约提醒）、本地化 |
| **财务建模专家** | financial-services financial-analysis（dcf、comps、3-statement、xlsx-author、audit-xls） | 与 phase-16/17 投后场景同一客群 | C7 Python + 公式重算、C10 产物校验；数据源降级为上传年报 |
| **增长营销专家** | marketingskills（50 个，自带 340 个评测 case）+ claude-seo 轻量子集 | 唯一"内容 + 评测"都成熟的社区包 | C5 产品营销档案；写操作的 CLI 收编为连接器 |

---

## 5. 质量门：什么叫"已验证"

借鉴 Claude 插件目录、Dify、Cursor、skills.sh、Hugging Face 的做法，分八层。**徽章只按实际通过的最高层发放**，不按星数。

| 层 | 名称 | 判据 | 借用 | 谁执行 |
|---|---|---|---|---|
| L0 | 身份 | 来源命名空间归属（GitHub 账号 / DNS）；作者账号 ID 固定，防接管 | MCP Registry 命名空间认证；claude-plugins-community owner-liveness-sweep | 自动 |
| L1 | 结构 | frontmatter 白名单与长度；name=目录名；描述含"做什么+何时用"；正文 ≤500 行建议 | `skills-ref validate`、`claude plugin validate` | 自动 |
| L2 | 包卫生与许可 | 无 secret/.env/二进制；有 LICENSE 且在白名单（Apache-2.0、MIT、BSD、CC-BY）；**Proprietary / NC / Commons Clause / 无 LICENSE 一律拒** | Dify pre-check；claude-plugins-official validate-licenses | 自动 |
| L3 | 安全扫描 | 静态规则 + LLM 审阅：凭据跨服务外传、宽作用域 hook、未披露遥测、提示注入、描述与行为不符、联网/下载软件披露 | Claude 插件目录 `.github/policy/prompt.md` + schema（Apache-2.0，可直接复用）；snyk/agent-scan；cisco skill-scanner；Tencent AI-Infra-Guard | 自动 + 可疑转人工 |
| L4 | 运行约束 | 工具注解（readOnly/destructive）；工具定义哈希固定（tools/list 漂移告警）；沙箱执行；写操作映射到审批模式 | OWASP MCP Top 10；microsoft/mcp-gateway | 平台 |
| L5 | 行为评测 | 自带 `evals/evals.json`（金样例 + 外部内容注入反例 + 缺数据不许编造断言）；**有/无 skill 基线对照**；触发 eval（易混 skill 对）；确定性评分优先，无法机械判断的标 manual_review 不计通过 | skill-creator（run_eval / aggregate_benchmark / grader）；JoelLewis finance_skills（`grade_responses.py`、iteration 工作区）；promptfoo / inspect_ai（MIT） | 自动（平台跑） |
| L6 | 专家认证 | 领域专家试用签核；本地化审阅（法域、准则） | Anthropic 先 community 后 verified 的两级；n8n "3 个获批成 Verified Creator" | 人 |
| L7 | 持续复验 | 钉 SHA；上游变动自动 bump + 重扫 + 重跑评测；失败自动回滚；连接器端点每日存活探测；线上评分跌破阈值降级 | claude-plugins-official 三个 workflow；`rating-attribution.ts` | 自动 |

**一个值得记住的数据**：finance_skills 的评测里，有 skill 96.8%、无 skill 基线 88.9%，**只提升 7.9 个百分点**（4 胜 8 平 0 负）。这说明"导入 = 有价值"不成立，**没有基线对照的"已验证"是假的**。

徽章建议：`官方`（上游厂商出品且 ≥L5）/ `已验证`（≥L6）/ `社区`（≥L3）/ `实验`（仅 L2）。上游 kwp 没有任何评测——导入时补评测本身就是我们的增值。

---

## 6. 内容导入评估（分领域）

### 6.0 逐 skill 评审结果（2026-09-24，数据驱动）

§6.1–6.3 是首轮逐包审阅的结论。之后按附录 C 的入选标准（`PROP-EXPERT-COMMUNITY-001-skill-selection-standard.md`）对 **645 个 skill 逐个打分**：549 个全量评审，96 个次要来源包分层抽样。每个分数附证据；边界带内的 161 个由两名评审员独立打分后取共识。完整排名、层级、合并组见 `evals/skill-selection/REPORT.md` 与 `ranking.csv`（可用 Excel 打开），本节只写结论，不复述清单。

**分层**：A 核心入选 104 · B 候选 218 · C 参考 191 · D 不采用 132。A 层中 31 个 W1 可上线（零连接器或降级即可）、66 个 W2、7 个 W3。

**标准自检全部达标**：评审员每维平均差 0.43（随机盲评 38 个）与 0.39（边界带补评 123 个）；边界带外层级一致；各组权重 ±20% 最多 4% 的 skill 换层——**结论不依赖权重拍板**。

**六个结论**：

1. **法务是最强的一块**：claude-for-legal 151 个里 47 个进 A 层，价值最高的前十里有七个是法务（上线审查、供应商合同审阅、批量表格审阅、法规比对、AI 用例分诊……）。原因是它的共享护栏最系统、且与法域无关的方法论多。**所以"商事法务专家"作为第一个重磅专家智能体（§4.3、D-EC3）有数据支撑。**
2. **官方通用插件是第二块**：knowledge-work-plugins 181 个里 42 个进 A 层，集中在会议纪要、客户原话、研究综合、状态汇报、企业检索——正是团队协作与组织大脑的核心，与我们的定位最契合。
3. **金融插件被本地化拖住**：financial-services 61 个只有 2 个进 A 层，41 个在 B 层。方法论不差，但数据源绑定付费终端、内容依附美国市场；它是"改写后才有价值"的一类，应排在财务建模专家（W3）里做，而不是早期导入。
4. **星数不等于入选**：claude-seo（1.76 万星）0 个进 A 层——以 Google 生态为中心、依赖付费 API；marketingskills（5.1 万星）50 个里 6 个进 A 层。**来源健康只占 10% 权重是对的**。
5. **硬门拦住了该拦的**：许可（deanpeters 的 NC 许可、anthropics/skills 的 docx/xlsx 专有许可）、弃用空壳、只跑内置样例的脚本、与客群无关的灌水目录，都被筛到 D 层。评审还发现了上游的实际错误（例如 wshobson 两个 skill 把烧钱率公式写反），这是只看星数发现不了的。
6. **能力拉动改写了路线图顺序**（见下表与 §8.2 的修订）：挡住最多 A 层 skill 的不是连接器，而是**组织 / 领域档案**——75 个 A 层 skill 依赖它，远超任何一个连接器（外部文档 38、邮件 31、CRM 26）。Python 沙箱只挡住 7 个 A 层。

| 能力 | 计划波次 | 依赖它的 A 层 skill | 含 B 层的拉动值 |
|---|---|---|---|
| 组织 / 领域档案与访谈式 onboarding | W2 → **建议提前到 W1.5** | 75 | 10693 |
| 其他专用连接器（CLM、ERP、金融终端） | W3 | 33 | 6302 |
| 外部文档 / 知识库 | W2 | 38 | 4649 |
| 邮件 | W2 | 31 | 4484 |
| CRM | W2 | 26 | 4233 |
| 调度与后台 agent | W3 | 16 | 1671 |
| Python 沙箱 | W3 | 7 | 3084 |

**要合并的重复**（跨来源包同职能族，报告 §8 列了 22 组）：最大的两组是"状态汇报"（10 个）与"档案访谈"（9 个）——后者印证了第 6 条：**档案访谈应当做成平台的一个通用机制**，而不是导入 9 份相近的 skill。

**局限**：安装量与实测评测都还没有（评测 runner 在 W1 建）；仍有 14 个次要来源包的抽样 skill 在边界带内只有单人评分；编排壳的层级按壳本身计，人工合并时以被调用者为准。

结论四档：**直接导入**（改 frontmatter 与占位符即可）/ **改写导入**（保留结构，改规则、本地化、换连接器）/ **参考自研**（借结构不借内容）/ **不采用**。评分 1–5（专业深度 / 可操作性 / 护栏 / 可测试性）来自逐文件审阅。

### 6.1 通用职能：Anthropic knowledge-work-plugins（Apache-2.0，25.5k★，2026-01-29 → 2026-09-23，1061 次提交）

| 插件 | skill 数 | 直接 / 改写 / 参考 | 关键理由 | 波次 |
|---|---|---|---|---|
| product-management | 8 | 5 / 3 / 0 | 与团队协作最契合 | W1 |
| operations | 9 | 6 / 3 / 0 | status-report、runbook、process-doc 通用 | W1 |
| customer-support | 5 | 3 / 2 / 0 | 与反馈分诊闭环契合 | W1 |
| marketing | 8 | 6 / 2 / 0 | 全只读、纯模板 | W1 |
| data | 10 | 5 / 4 / 1 | 需 SQL / Python | W1（只读部分）/ W3 |
| enterprise-search | 5 | 0 / 2 / 3 | 检索应由平台原生；综合规则可用 | W1（作后台规范） |
| legal | 9 | 3 / 5 / 1 | `legal.local.md` 要变团队资产；签署只参考 | W2 |
| human-resources | 9 | 3 / 5 / 1 | 缺 HRIS/ATS 连接器与免责声明 | W2 |
| finance | 8 | 3 / 5 / 0 | 美国 GAAP / SOX 要本地化 | W2–W3 |
| sales | 36 | 0 / 36 / 0 | 9 条规则上移平台；厂商写法下沉连接器 | W2（CRM 到位后） |
| productivity | 4 | 0 / 0 / 4 | 本地文件记忆 → 平台记忆服务 | 参考 |
| small-business | 44 | 抽 15：0 / 8 / 7 | 美国税务、账本写入重；report-builder、proposal-builder 可改写 | 参考为主 |

**W1 首批 20 个**（零连接器、高频、协作价值大）：write-spec、stakeholder-update、status-report、kb-article、process-doc、runbook、synthesize-research、knowledge-synthesis、digest、customer-research、ticket-triage、validate-data、analyze、product-brainstorming、change-request、sprint-planning、meeting-briefing（泛化为通用会议简报，接实时转录）、onboarding、brand-review（泛化为风格与术语审查）、legal-risk-assessment（作为**全平台唯一风险矩阵**，替代 operations 的 3×3）。

**需合并去重**（否则违反"同一事实不写两处"）：竞品分析 3 份（marketing / PM / sales）、风险矩阵 2 套、journal-entry 与 journal-entry-prep、content-creation 与 draft-content。

逐 skill 的输入、连接器、工具、记忆、写操作、难度见附录 B。

### 6.2 垂直领域

| 领域 | 首选 | 许可 / 规模 | 评分（深/操/护/测） | 结论 | 平台前置 | 波次 |
|---|---|---|---|---|---|---|
| **法务** | anthropics/claude-for-legal（12 个执业领域插件，151 个 SKILL.md，2026-05-11 首提） | Apache-2.0，9.5k★ | 5 / 5 / 5 / 2.5 | **改写导入**：共享护栏与输出规范几乎原样抽成平台级"专业服务护栏"；commercial → privacy / product / AI 治理 → employment / corporate；美国法内容本地化，引用源换国内法规库 | C5、C6、C8、C14 | W2–W3 |
| **金融建模** | anthropics/financial-services（financial-analysis、IB、ER、PE、fund-admin、KYC；10 个 agent 插件） | Apache-2.0，37.0k★；版本仍 0.x，HEAD 的 `.mcp.json` 不是合法 JSON | 4.5 / 4.5 / 4 / 3 | **改写导入**建模类（dcf、comps、3-statement、lbo、audit-xls、xlsx-author）；数据源 MCP 都是付费终端 → 必须支持"上传年报"降级；ic-memo 需加深 | C7、C10 | W3 |
| **营销** | coreyhaines31/marketingskills（50 个，340 个评测 case / 2110 条断言） | MIT，51.3k★，2026-01-15 → 2026-09-04 | 4 / 4.5 / 3.5 / 4 | **直接导入**并带评测；`product-marketing.md` 映射为团队产品档案；65 个 CLI 收编为连接器、写操作走审批；`marketing-council`（模拟真实人物）改写或下架 | C5 | W1（只读类）/ W2 |
| **SEO / GEO** | AgriciDaniel/claude-seo（26 skill + 19 subagent + 61 脚本 + 67 测试文件） | MIT，17.6k★，近 30 天 149 次提交 | 4 / 4 / 4.5 / 4.5 | **改写导入**：先 seo-page / technical / schema；`url_safety.py` 与 untrusted-content 测试**提为平台标准**；audit 编排与 drift 监控待 C7+C8 | C7（Playwright、Python）、C8 | W3 |
| **GTM / 销售** | kwp sales（36）+ marketingskills 的 launch / competitors / revops / sales-enablement；alirezarezvani 的 deal-desk、pricing-strategist | Apache-2.0 / MIT | deal-desk 3 / 3 / 3 / 2 | kwp sales 改写（W2）；deal-desk 改写并保留 "never auto-approves"；结构参考 deepagents deploy-gtm-agent | C3、C4（CRM） | W2 |
| **HR** | kwp human-resources；护栏参考 claude-for-legal employment-legal | Apache-2.0 | tuanductran/hr-skills 2 / 2 / 2.5 / 2 | **以自研为主**：劳动法本地化；hr-skills 只取任务分类；所有对人打分类 skill 统一用 SMB hiring-screener 的公平性约束 | C5、C14 | W2–W3 |
| **产品管理** | kwp product-management | Apache-2.0 | — | W1 直接导入；deanpeters/Product-Manager-Skills（7.1k★）为 **CC BY-NC-SA，禁止商用，不采用** | — | W1 |
| **管理层 / 决策** | alirezarezvani board-meeting（多角色独立发言后合成）、decision-logger、context-engine | MIT，26.4k★ | 3 / 3 / 3 / 2 | **挑选改写**：board-meeting 协议作"多专家评审"样板；c-level advisor 仅作知识参考；只跑内置样例的脚本必须改成可输入，否则给人"有工具"的错觉 | — | W3 |

### 6.3 只参考、不导入

| 对象 | 原因 | 取什么 |
|---|---|---|
| openai/plugins（public-equity-investing、data-analytics） | 许可 Proprietary | 路由 + 调用门槛、显式调用子 skill、shared 标准层、数据源按类别解析、"语义层即 skill" |
| TradingAgents（108k★）、ai-hedge-fund（63.7k★） | 代码型 LangGraph 应用；后者明示教学用途 | 多角色辩论 + 风控链的拓扑 |
| deepagents examples | 内容玩具级 | memory / skills / subagents 三原语、文件交接长输出 |
| n8n / Dify / Flowise 模板 | 平台 DSL；n8n 许可限制嵌入；Flowise 2026-08 归档 | 业务流程步骤清单 |
| Google adk-recipes、Microsoft agent-framework / m365 模板 | 演示级或锁平台 | 架构模式 |
| 星数与提交数严重背离的仓库（如 2.7k★ 仅 1 次提交） | 刷星 / 引流嫌疑 | 不采用 |

---

## 7. 工具与连接器选型（W2–W3）

原则：**优先厂商官方远程 MCP（OAuth）**；需要自托管时选许可友好的开源实现；聚合层只选 MIT/Apache。注意：厂商托管端点本身不是开源软件，我们的开源承诺落在客户端与网关一侧。

| 类别 | 首选 | 自托管 / 替代 | 注意 |
|---|---|---|---|
| 邮件 / 日历（Google） | Google 托管 MCP（gmail / calendar / drive） | taylorwilsdon/google_workspace_mcp（MIT，3.2k★） | 国内可用性需实测 |
| 邮件 / 日历（M365） | Microsoft Agent 365 MCP | Softeria/ms-365-mcp-server（MIT） | 部分为预览 |
| 团队聊天 | Slack 官方远程 MCP；**飞书 larksuite/cli**（MIT，17.4k★，含 20+ skills） | korotovsky/slack-mcp-server（MIT） | 飞书远程 MCP 授权 7 天过期；lark-openapi-mcp 仓库 2025-08 后停更；**钉钉官方 MCP 仓库无 LICENSE 且停更** → 需评估自研适配 |
| 项目跟踪 | Atlassian 官方（Apache-2.0）、Linear、Asana 远程 MCP | — | 优先接平台自己的任务模块 |
| CRM | Salesforce Hosted MCP（2026-04 GA）、HubSpot 远程 MCP（支持写入） | — | 国内 CRM（纷享销客、销售易）无成熟 MCP → W2 后评估 |
| 文档 / 知识库 | Notion（MIT）、Confluence（Atlassian） | — | 与组织大脑的关系：外部源只读导入为证据 |
| 数据仓库 | googleapis/mcp-toolbox（Apache-2.0，16.5k★，20+ 种库） | bytebase/dbhub（MIT） | 只读、行数上限、审计 |
| 会议转录 | 平台自有 `local-asr-gateway` 优先；Zoom / Fireflies / Gong 远程 MCP | — | Gong 2026-06 起按积分计费 |
| 电子签 | DocuSign 远程 MCP（open beta） | e签宝社区 MCP（未核实）；法大大无 | W3 之后 |
| Web 搜索 / 抓取 | 已有 `web_search` / `fetch_url` | crawl4ai（Apache-2.0）；searxng 为 **AGPL**，只能独立部署不嵌入 | — |
| 浏览器 | 已有 browser-runtime（Playwright MCP） | chrome-devtools-mcp（Apache-2.0） | — |
| 代码沙箱 | 扩 `apps/skill-sandbox`：gVisor / microsandbox | E2B（Apache-2.0） | **不用** Daytona（停止开源）、Modal（运行时闭源） |
| 文档生成 | 已有 docx / pptxgenjs / pdf-lib；Python 侧加 python-docx、python-pptx、openpyxl（MIT）；读取侧 markitdown（MIT） | docxtemplater（MIT 核心）；转 PDF 用 LibreOffice headless 或 pandoc 子进程（GPL，子进程调用规避传染） | **anthropics/skills 的 docx/xlsx/pptx/pdf 是专有许可，不可再分发**；exceljs 2024-01 后停更，Python 侧用 openpyxl |
| 连接器聚合 | activepieces（MIT，约 400 个 MCP，`packages/ee` 除外） | Composio SDK（MIT，托管闭源） | **避开** Pipedream（源码可见许可禁竞争商用）、n8n（SUL 限嵌入）；Nango 为 ELv2 需法务评估 |
| MCP 安全 | snyk/agent-scan、cisco mcp-scanner（Apache-2.0） | Tencent AI-Infra-Guard（Apache-2.0） | 工具定义哈希固定 + 漂移告警 |

---

## 8. 路线图

### 8.1 当前位置

| phase | 与本方案的关系 | 状态 |
|---|---|---|
| phase-14 agent-kernel-unification | Agent 运行时、HITL 四档授权、审计 transcript——**本方案的底座** | 15/15 passing |
| phase-00 shared-kernel | 多租户 RLS、Artifact / Version、两层角色 | 22/23 passing |
| phase-15 ai-capability-studio | 导入 → 草稿 → 试跑 → 发布工作台——**W1 的关键路径** | 未开工（空清单；设计 PR #3239） |
| phase-13 platform-owned-skills | 四个官方文档 skill 对所有 org 默认可用 | 0/1，未开工 |
| phase-03 reuse-and-governance | 组织大脑、知识晋升、数字专家、审计治理 | 0/65，未开工 |
| phase-04 digital-expert-interview-studio | 数字专家访谈（专家智能体雏形） | 5 passing / 1 进行中 / 1 未开工 |
| phase-16 / 17 投后 agent | 专家智能体的垂直应用（与"财务建模专家"同客群） | 未开工 |
| Context Engine（组织大脑） | 档案与记忆的承载 | 自评 3/10 |

### 8.2 四个波次

```mermaid
flowchart TB
  classDef done fill:#2e7d32,color:#fff
  classDef todo fill:#6a1b9a,color:#fff
  P14[phase-14 Agent 内核<br/>已完成]:::done

  subgraph W0[W0 社区立即开放 + 对齐 · 约 2 周]
    OWN[任命生态负责人<br/>定 D-EC5 许可白名单]:::todo
    REG[社区注册表仓库<br/>PR 提交 · CI 跑 L0-L3]:::todo
    SEED[种子条目<br/>上游钉 SHA 引用 + 署名]:::todo
    F1[C1 格式对齐<br/>allowed-tools / 宽松解析]:::todo
    L[C2 许可门 + 上游登记表]:::todo
  end

  subgraph W1[W1 协作类 20 个 skill 上线 · 零连接器]
    S15[phase-15 工作台<br/>导入/草稿/试跑/发布<br/>可从社区注册表导入]:::todo
    SP[C11 平台安全策略收敛]:::todo
    E1[C12 评测 runner<br/>L5 基线对照 → 可发"已验证"]:::todo
    K20[导入 kwp 20 个 + marketingskills 只读类]:::todo
    PM[专家智能体①<br/>产品经理助理]:::todo
    PF[C5 组织/领域档案<br/>访谈式 onboarding<br/>（§6.0 数据提前）]:::todo
  end

  subgraph W2[W2 连接器 + 档案]
    CR[C3 类别注册表 + 探针]:::todo
    C4[C4 邮件/日历/项目/CRM + 飞书]:::todo
    LG[专家智能体②<br/>商事法务（中国法本地化）]:::todo
    SL[kwp sales / HR / legal 改写]:::todo
  end

  subgraph W3[W3 运行时扩展]
    PY[C7 Python + Office 重算 + SQL]:::todo
    SC[C8 调度 + 后台 agent]:::todo
    C6[C6 偏离 → 提案 → 审批]:::todo
    FM[专家智能体③ 财务建模<br/>④ SEO 审计]:::todo
  end

  subgraph W4[W4 产品内社区体验]
    RG[C13 产品内目录<br/>徽章 · 评测提升 · 30 天趋势]:::todo
    PR[组织私有目录 / 白名单]:::todo
    SUB[L6 专家认证 · Verified 创作者]:::todo
    PAY[创作者激励与分成]:::todo
  end

  OWN --> REG --> SEED
  L --> REG
  P14 --> S15
  F1 & L --> S15
  REG --> S15
  S15 & SP & E1 --> K20 --> PM
  E1 --> REG
  PM --> CR --> C4
  C4 --> SL
  C4 & PF --> LG
  PY --> FM
  SC --> C6
  SC --> FM
  E1 --> RG
  LG & FM --> RG --> PR --> SUB --> PAY
```

**并行 / 串行**：
- W0 内：任命负责人与定许可白名单**先于**注册表对外（串行，没有负责人与白名单就开放等于无人把门）；注册表与 C1 格式对齐、C2 许可门**并行**，且注册表 CI 直接复用 C2 的许可门脚本（同一事实只写一处）。
- 社区注册表**不等** W1：它是开放标准格式的 git 仓库，产品侧的能力库在 W1 由 phase-15 接入读取。
- W1 内：phase-15 工作台、平台安全策略、最小评测三条线**并行**；导入 20 个 skill 必须等三条都到位（串行）。
- **档案（C5）从 W2 提前到 W1 末尾**（§6.0 能力拉动：75 个 A 层 skill 依赖它，是任何单个连接器的两倍以上）。它与 20 个 skill 的导入并行开发，且不依赖任何连接器；9 份相近的"档案访谈"skill 合并为这一个平台机制。
- W2 的连接器（C3/C4）在档案之后；法务专家智能体两者都要。
- W3 的 Python 沙箱与调度器**并行**，与 W2 无代码冲突，可提前开工。
- **热点串行**：`apps/api/src/domain/skill/*` 与 `packages/contracts/src/skills.ts` 是 phase-13、phase-15 与本方案 C1/C2 的共同核心，三者**必须串行**，按 phase-15 → C1 → phase-13 排。

**每个波次的出口判据**（没有机械判据的不算完成）：

| 波次 | 出口判据 |
|---|---|
| W0 | 生态负责人已任命、D-EC5 已定；社区注册表仓库公开，一个外部 fork 的 PR 能自动跑完 L0–L3 并给出通过 / 拒绝结论；一个恶意样例（凭据外传、无 LICENSE、Proprietary 许可各一）被拦；种子条目可用 `npx skills add` 与 Claude Code marketplace 安装；上游登记表入库（仓库 / SHA / 许可 / 结论） |
| W1 | 20 个 skill 在真实项目聊天中各完成一次"上传文件 → 成品产出物"的 e2e；每个都有 ≥3 条评测（金样例、注入反例、缺数据不编造）且有/无 skill 对照结果入库；skill 正文里出现被收敛的安全规则副本 = lint 红 |
| W2 | 四类连接器各有一个 provider 通过 live_probe；法务专家智能体完成 onboarding 访谈 → 审一份真实 NDA → 输出带来源标签的审阅意见；所有写操作落在五种审批模式之一且留审计 |
| W3 | DCF 模型在沙箱里生成、LibreOffice 重算、`validate_dcf` 通过；后台 agent 按 cron 运行一周，all-clear 与告警都送达；一条偏离提案走完 Accept → 档案 diff → 生效 |
| W4 | 产品内目录每个条目展示最高验证层、评测提升、扫描时间、许可、维护活跃度；组织可设私有目录与白名单；上游 bump 失败能自动回滚；外部作者从提交到上架的审核时限达成率 ≥ 公布值 |

### 8.3 落进仓库流程的方式

按 `AGENTS.md`「开发任务必须在 GitHub 上可见」：本提案通过评审后，
1. W0 的决策结论回流到 `docs/research/open-source-business-model.md` 的决策表与对应 ADR；
2. W1 的工作**并入 phase-15**（它的需求原话就是"方便导入 GitHub 开源方案"），由 requirement-author 从本文 §3 C1/C2/C11/C12 与 §6.1 生成 feature；
3. W2–W4 建议新开 phase（暂名 `phase-18-expert-community`），走契约先行签核（三件一处签：UI / 用例 / API 契约），专家智能体 schema（§4.2）是其 API 契约的输入。
4. W0 的社区注册表是**内容仓库**，不是产品代码：它不走本仓 sprint / feature 流程与 23 项 CI，只跑自己的 L0–L3 门控。新建公开仓库需要组织管理员操作。

### 8.4 社区立即开放的最小方案（D-EC2）

**为什么能"马上"**：内容用开放标准格式（SKILL.md + `.claude-plugin/marketplace.json`），Claude Code、Codex（源码可读 `.claude-plugin` 市场）、Cursor、`npx skills add` 都能直接从 git 仓库安装。所以社区的第一天**不依赖产品 UI**：作者提交后就有真实分发渠道，产品内能力库在 W1 由 phase-15 接入同一个仓库。

| 项 | 做法 | 借用 |
|---|---|---|
| 载体 | 独立公开仓库（`boardx/work-practices`，D-EC9 已定）：`skills/<命名空间>/<技能包>/`，根目录放 `marketplace.json`、`CONTRIBUTING`、`CODE_OF_CONDUCT`、`SECURITY`（披露通道） | claude-plugins-community 的目录结构 |
| 提交 | 外部作者 fork 后提 PR；PR 模板要求**风险自报**（low/medium/high）、声明联网与写操作、许可证；接受 DCO 签名 | Dify PR 模板与风险标签；研究稿 D6 |
| 自动门 | CI 依次跑 L0 身份、L1 结构（`skills-ref validate`）、L2 许可与包卫生（**复用 C2 许可门脚本**）、L3 安全扫描（静态规则 + LLM 审阅）；任何一层红 = 不能合入 | §5 各层借用项 |
| 徽章 | 合入即"实验"；维护者人工 triage 后升"社区"；W1 评测 runner 上线后，补齐评测且基线对照为正的条目升"已验证" | §5 |
| 种子内容 | 首批 20 个协作类 skill：**以钉 SHA 的方式引用上游**（不复制，署名上游），只有本地化改写过的版本才复制进仓库并保留 NOTICE、标注已修改 | claude-plugins-official 外部条目的 `source.sha` |
| 人工 | 维护者 triage 轮值；公布首次响应时限；拒绝固定四件：谢、理由、替代路径、是否欢迎再提 | 研究稿 4.7、4.8 |
| 持续 | 每日：上游 bump + 重扫；MCP 端点存活探测；作者账号 ID 漂移检测 | claude-plugins-official 三个 workflow |

**开放前必须具备**（缺一不开）：生态负责人与 triage 轮值名单；D-EC5 许可白名单；L3 扫描所需的 CI 模型密钥（存 repo secret，只给扫描 job）；安全披露邮箱（研究稿 4.9 记录 `SECURITY.md` 仍是占位）。

---

## 9. 需要人类拍板的决策

| 编号 | 决策 | 冲突 / 背景 | 建议 |
|---|---|---|---|
| **D-EC1** | **开源导入的内容怎么卖** | 研究稿 D4：「运行时开源、内容与评测集闭源」。但本方案首批内容来自 Apache-2.0 / MIT 上游，改写后仍须保留许可与 NOTICE，**不能闭源再卖** | **✅ 已定（2026-09-24，人类决策，按建议）**：分两类。①开源导入内容**免费提供**，卖点是验证、本地化、托管执行与企业治理；②自研内容（中国法本地化 playbook、行业评测集、组织档案模板）闭源售卖。已回写研究稿 v32.11 的 D4 |
| **D-EC2** | **社区何时对外** | 研究稿 H1 不承诺技能包作者体验（H2，2028–2031） | **✅ 已定（2026-09-24，人类决策）：立即开放**。开放路径见 §8.4；技能包作者已在研究稿 v32.11 提前到 H1（新增 D18）。代价：维护者负荷前移，见 §10 第 8、9 条 |
| **D-EC3** | **第一个专家智能体选哪个** | 候选：产品经理助理（最稳、零连接器）/ 商事法务（价值感最强、需本地化）/ 财务建模（与投后客群一致、需 Python 沙箱） | **✅ 已定（2026-09-24，人类决策，按建议）**：产品经理助理先上（W1，验证全链路），商事法务作为第一个重磅（W2） |
| **D-EC4** | **本地化优先级** | 研究稿 D8 为"中国优先"；而上游内容几乎全是美国法、美国准则 | 法务、财务、HR 三个领域的 skill 在本地化前**标注适用法域**，不对中国用户默认启用 |
| **D-EC5** | **许可证白名单**（**因 D-EC2 立即开放，已成为开放的前置条件**） | 需一次性定死，写进 L2 门控 | **✅ 已定（2026-09-24，人类决策，按建议）**：允许 Apache-2.0、MIT、BSD、CC-BY-4.0（署名）；拒绝 Proprietary、CC-NC、Commons Clause、GPL/AGPL（内容与代码皆拒，独立部署的外部服务除外）、无 LICENSE |
| **D-EC7** | **客群上限是否放宽到 U3 ≤ 2** | 现规则只把 U3 ≤ 1 压到 C 层。评审员发现同包共享护栏会把 U3 = 2 的 skill 推到 A 层附近：目前 A 层有 8 个 U3 = 2，其中 7 个来自 small-business 插件（小企业老板的应付、月结、获客等） | **✅ 已定（2026-09-24，人类决策，按建议）**：保持 U3 ≤ 1。若日后决定 ICP 不含小企业，再收紧到 U3 ≤ 2 |
| **D-EC8** | **确认入选标准的权重** | 权重只写在 `evals/skill-selection/rubric.json`；敏感性检验显示 ±20% 最多改变 4% 的层级 | **✅ 已定（2026-09-24，人类决策，按建议）**：按 `rubric.json` 现值确认；以后改权重必须重跑 `score.mjs` 看敏感性 |
| **D-EC9** | **生态负责人与注册表仓库** | 社区立即开放（D-EC2）的前置条件 | **✅ 已定（2026-09-24，人类决策）**：由项目发起人兼任生态负责人（Claude 负责自动门控与初审，提交量上来后再任命专人）；注册表仓库为 `boardx/work-practices` |
| **D-EC6** | **上游回馈政策** | 我们会修复上游缺陷（kwp README 与 skill 名不一致、financial-services `.mcp.json` 语法错误、zoom 41 个 name 违规等） | 通用修复回馈上游 PR（建立社区信用，也降低我们的合并成本）；本地化与组织相关改动保留在我们这边 |

---

## 10. 风险与事前验尸

假设 12 个月后失败，最可能的原因：

| # | 死法 | 早期信号 | 应对 |
|---|---|---|---|
| 1 | **导入了 200 个 skill，没人用** | 安装量远大于完成真实任务数 | W1 只上 20 个；度量"真实任务完成"而非上架数 |
| 2 | **"已验证"徽章失信** | 用户投诉产出错误，而该条目标着已验证 | 没有基线对照不发徽章；线上评分跌破阈值自动降级（L7） |
| 3 | **提示注入 / 凭据外传事故** | 扫描发现率上升；工具定义漂移告警 | L3 必过；写操作审批；工具哈希固定；外部内容一律当数据 |
| 4 | **上游漂移，维护成本失控** | bump PR 积压、三方合并冲突率上升 | 钉 SHA + 自动 bump；通用修复回馈上游减少分叉面 |
| 5 | **本地化不做，中国用户拿到美国法建议** | 法务 / 财务 skill 在国内租户被默认启用 | D-EC4 国别门控 |
| 6 | **连接器战线过长** | 同时接 10 个 provider、每个都不稳 | W2 只接四类各一个 provider；其余走"上传文件"降级 |
| 7 | **方案留在文档里** | 三个月后仓库没有对应 issue / feature | 通过评审即由 requirement-author 生成 phase-15 feature（§8.3） |
| 8 | **立即开放后维护者先垮**（研究稿事前验尸第 1 条：最可能的死法是维护者先走） | 未分诊 PR 积压；首次响应超过公布时限；维护者每周投入持续上升 | 自动门挡掉大部分（L0–L3 全自动）；合入即"实验"不做人工承诺；公布真实的响应时限；积压超阈值时暂停新提交并公告，而不是默默拖着 |
| 9 | **开放首月被垃圾或恶意提交淹没**（官方 MCP Registry 3.5 万条目里夹着大量测试垃圾；Snyk 研究称 36% 的 skill 含提示注入，未核实） | L3 拦截率异常；同一作者短时间批量提交 | L3 必过才能合入；按作者限速；新作者首个 PR 必经人工 triage；恶意样例入库作为扫描回归用例 |

---

## 11. 度量

| 指标 | 定义 | 为什么 |
|---|---|---|
| 真实任务完成数 / 周 | 使用社区条目、在真实项目中产出被保存的产出物 | 防止"上架即成功"的虚假繁荣 |
| 评测提升 | 有 skill 相对基线的 pass rate 提升（百分点） | 验证价值的唯一硬证据 |
| 首个价值时刻时长 | 新用户从进入目录到拿到第一个成品 | 对齐研究稿的价值时刻度量 |
| 档案复用率 | 使用组织 / 领域档案的 skill 调用占比 | 衡量"懂你的组织"是否成立 |
| 安全门拦截数与误报率 | L3 拦截、人工复核推翻比例 | 门控质量 |
| 上游同步健康度 | 钉住版本落后上游的天数、bump 失败率 | 维护成本 |
| 30 天安装趋势 | 而非累计安装 | 避免马太效应 |

---

## 12. 下一步（评审通过后）

1. D-EC1、D-EC2 已定；其余四项待定，**D-EC5 与生态负责人任命挡住社区开放，优先决定**。
2. 组织管理员新建公开的社区注册表仓库（§8.4），落 CONTRIBUTING / PR 模板 / L0–L3 CI / 种子条目。
3. 开 issue：`[W0] 上游内容登记表 + 许可门 lint`、`[W0] SKILL.md 格式对齐 agentskills（allowed-tools、宽松解析）`、`[W1] 平台级安全策略收敛（上游 9 条 + SMB 14 份共享规则 → 一份）`、`[W1] 评测 runner 最小版（借 skill-creator）`。
4. 由 requirement-author 把 §3 C1/C2/C11/C12 与 §6.1 首批 20 个写进 phase-15 的 `requirements/`，生成 feature。
5. 对 W2 的四类连接器各做一次 provider 可用性实测（尤其国内网络下的 Google / Slack / HubSpot 远程 MCP）。

---

## 附录 A：数据口径

- Stars / forks：GitHub 搜索 API，2026-09-24 实时读取。
- 创建日期、最后提交、提交数、贡献者：`git clone --filter=blob:none --no-checkout` 后用 git 统计。
- 安装量 / 下载量：skills.sh、pypistats、api.npmjs.org 被出口代理拦截，**均未核实**；文中采用的装机数（Small Business 90 万+）为厂商口径。
- 评分：调研 agent 逐文件审阅给出，附原文片段证据，保存在本会话 scratchpad，未入库。
- 上游许可：以仓库根 LICENSE 与 `plugin.json` 为准，不以媒体报道为准（例：媒体称 OpenAI 职能插件"MIT 开源"，`plugin.json` 写 Proprietary）。

## 附录 B：逐 skill 拆解

见 `PROP-EXPERT-COMMUNITY-001-appendix-kwp-skills.md`（knowledge-work-plugins 12 个插件、155 个 skill；核心 111 个全文审阅 + small-business 抽样 15 个）。

## 附录 C：仓库现状证据（2026-09-24，main 之上的本分支）

| 结论 | 证据 |
|---|---|
| Agent 运行时基于 deepagents + LangGraph + PG checkpointer | `apps/deep-agent-service/pyproject.toml`、`graph.py`、`postgres_checkpointer.py` |
| skill 导入（URL / 私库 GitHub OAuth PKCE） | `apps/api/src/application/skill-import/*`、`packages/contracts/src/skill-source-connections.ts` |
| skill 版本快照不可变、单调递增 | `apps/api/src/domain/skill/version-chain.ts` |
| 评分归因到 skill 版本 | `apps/api/src/domain/skill/rating-attribution.ts`、`satisfaction.ts` |
| 审核禁自审、安全门 | `review-authorization.ts`、`security-gate.ts`、`publish-review.ts` |
| frontmatter 唯一读取入口，无 allowed-tools | `apps/api/src/domain/skill/skill-frontmatter.ts` |
| 标准技能包种子（10 个） | `apps/api/src/infrastructure/skill/ensure-standard-skill-packs.ts` |
| MCP 远程发现、凭据 AES-256-GCM 封存 | `apps/api/src/infrastructure/mcp/*`、`packages/contracts/src/mcp-credential-envelope.ts` |
| 沙箱两层隔离（Node） | `apps/skill-sandbox/`（execute-script.ts、docker-compose.sandbox.yml） |
| 业务 OAuth 连接器仅 GitHub | `packages/contracts/src/skill-source-connections.ts`；deep-agent 全树无 send_email 实现（见 `deep-agent-hitl.ts` 注释） |
| HITL 单一事实源 | `packages/contracts/src/deep-agent-hitl.ts` |
| devportal 不是市场 | `docs/research/devportal-positioning.md` |
| Context Engine 3/10 | `docs/proposals/PROP-CONTEXT-ENGINE-001.md` |
| phase 状态 | `phases/phase-*/feature_list.json`（本文 §8.1 为 2026-09-24 读数） |
