# WorkspaceX 开源商业模式方案研究

> 状态：**研究稿，待人类决策**（2026-09-20）。
> 目标读者：创始人/决策者 + 后续执行本方案的 agent。
> 本文只做分析与建议，不改代码、不改许可证；第 7 节列出需要人类拍板的决策点。
> 勘探基础：`.harness/instructions/architecture.md`、`docs/architecture/context-engine.md`、
> `docs/proposals/PROP-LOCAL-WORKSPACE-001.md`、`phases/` 阶段清单、`apps/` `packages/` 目录。

---

## 0. 一句话结论

**采用「开放核心（Open Core）+ 云托管 + 垂直 Skill 市场」三层模式**：
核心运行时（API / Web / Agent kernel / Context Engine / 桌面版）以 **Apache-2.0** 开源，
组织级治理、SSO、审计、多租户托管作为商业版，行业 Skill（IC 审阅、投后评级、投后报告等）
作为付费内容与生态分成。开源边界与仓库现有的架构边界（洋葱层 + 契约单源 + 模块清单）**天然重合**，
不需要为了商业化重新切代码。

---

## 1. 现状盘点（决定"能开源什么"的事实）

| 事实 | 出处 | 对商业模式的含义 |
|---|---|---|
| 仓库**无 LICENSE 文件**，`package.json` 为 `private: true` | 仓库根目录 | 当前法律状态 = 保留所有权利。开源是一个**尚未发生的决策**，可以从零设计边界 |
| 模型接入是 **OpenAI 兼容适配器 + model registry**，支持 Ollama 本地回环、egress guard 零出网 | `apps/api/src/infrastructure/agent-run/configured-model-provider.ts`、`local-egress-guard.ts` | 具备「本地免费 / 云端付费」的分叉点：模型与出网是天然计费线 |
| 已有 `personal-local` 组织类型与桌面发行版提案（Ollama + qwen3.5:4b） | `packages/contracts/src/identity.ts`、`PROP-LOCAL-WORKSPACE-001` | 免费自托管产品形态已在路线图上，是开源增长飞轮的入口 |
| 洋葱架构，`domain/application/infrastructure/interface` 由 `lint-arch-deps` 机械强制 | ADR-020 | 商业功能可作为 **infrastructure 层的替换实现** 或独立 NestJS 模块挂载，不污染开源核心 |
| API 契约 zod 单源 → DTO / client / OpenAPI / mock 全部生成 | `contract-design.md` | 开源核心可以只发布**契约**，闭源实现遵守同一契约；生态方（第三方 skill）也靠它对接 |
| 21 个业务模块，8 个模块知识库（chat / agent-skill-runtime / research-studio / asset-artifact / org-identity / coord-platform / devportal / project） | `PROJECT.md` 模块清单 | 模块清单就是开源/闭源切分的粒度 |
| 17 个 skill、20 个画布模板、45 个原生工具；`skill-sandbox` 与 `devportal` 已存在 | `PROP-LOCAL-WORKSPACE-001` §0 | Skill 市场的基础设施已具备一半 |
| 垂直阶段：IC 材料审阅 agent、投后评级 agent、投后报告 agent（phase 16/17） | `phases/` | 这些是**行业 know-how**，是最不该无偿开源的资产 |
| harness（`.harness/`、coord-*）本身是独立模板项目（agentic-harness-template） | README | 可以作为**第二个开源产品**独立运营，面向 AI 工程团队 |

---

## 2. 系统架构视角：开源边界怎么切

### 2.1 切分原则（三条，都能机械检查）

1. **按模块切，不按文件切**：以 `PROJECT.md` 模块清单为粒度，每个模块整体归属 OSS 或 EE。
2. **闭源只能出现在两种位置**：(a) `infrastructure/` 层的端口替换实现；(b) 独立 NestJS 模块目录
   `apps/api/src/ee/` 与 `apps/web/ee/`。`domain/` 与 `application/` **永远开源**——它们是契约与不变量，
   闭源后生态无法对接。
3. **EE 代码物理隔离**：EE 目录单独 LICENSE（Commercial），CI 加一道 `lint-ee-boundary`：OSS 目录不得
   import `ee/`；EE 可以 import OSS。构建时 `EE_ENABLED=false` 即得纯开源产物。

### 2.2 建议的分层归属

```
┌────────────────────────────────────────────────────────────────┐
│  L4  行业 Skill / 模板（IC 审阅、投后评级、投后报告、行研模板）   │  付费内容 / 市场分成
├────────────────────────────────────────────────────────────────┤
│  L3  企业治理（SSO/SCIM、审计日志、RLS 策略包、配额、计费、        │  EE 商业许可
│      多租户控制面、合规导出、私有模型网关高级路由）                 │
├────────────────────────────────────────────────────────────────┤
│  L2  产品核心（chat、research-studio、asset-artifact、project、    │  Apache-2.0
│      agent-skill-runtime、context-engine、canvas、devportal、       │
│      skill-sandbox、desktop 本地版、基础 org-identity）             │
├────────────────────────────────────────────────────────────────┤
│  L1  契约与协议（packages/contracts、coord-protocol、               │  Apache-2.0（必须最宽松）
│      skill 规格、AG-UI 事件 schema）                                 │
├────────────────────────────────────────────────────────────────┤
│  L0  开发过程 harness（.harness/、coord-brain/directory/           │  Apache-2.0，独立仓/独立品牌
│      projection/repohub、agentic-harness-template）                 │
└────────────────────────────────────────────────────────────────┘
```

**模块级归属表**：

| 模块 | 归属 | 理由 |
|---|---|---|
| mod-chat | OSS | 门面能力，不开源没人用 |
| mod-agent-skill-runtime | OSS（runtime）+ EE（企业 skill 治理：审批流、版本冻结、租户白名单） | 运行时是生态基础；治理是企业买单点 |
| mod-research-studio | OSS 基础（访谈/录制/转写/问卷）；EE：团队级洞察库、跨项目检索 | 单人可用 → 团队协作付费 |
| mod-asset-artifact / canvas | OSS | 与开源画布生态对齐 |
| mod-project | OSS | 项目容器是最小可用单元 |
| mod-org-identity | OSS：本地/单组织、邮箱登录；EE：SSO/SCIM/多组织/审计 | 经典 open core 切线 |
| mod-coord-platform | 拆到 harness 产品，独立开源 | 与业务无关 |
| mod-devportal / skill-sandbox | OSS | 生态入口必须开放 |
| phase-16/17 行业 agent | **闭源**，作为付费 Skill 包发布 | 行业 know-how，是护城河 |
| deep-agent-service（LangGraph 深度研究） | OSS，但**云端算力版**作为托管增值 | 本地可跑；云端更快更稳收费 |

### 2.3 需要新增的架构件

| 件 | 作用 | 落点 |
|---|---|---|
| `lint-ee-boundary` | OSS 不得依赖 EE | `.harness/scripts/`，与 `lint-arch-deps` 同级 |
| Feature flag / license key 校验 | EE 模块按许可证激活；离线许可证签名 | `apps/api/src/ee/licensing/` |
| Skill 包签名与来源标识 | 市场分发的 skill 必须可验签、可追溯 | `skill-sandbox` + `devportal` |
| 计量（metering）事件 | 云版按 token / 座席 / 项目数计费的原始数据 | `application/` 定义端口，EE 实现 |
| 遥测 opt-in | 开源版匿名使用统计（默认关） | `apps/api` 启动配置，写入 PROJECT.md 事实 |
| 双仓或单仓 monorepo 策略 | 见 §7 决策 D2 | — |

---

## 3. 商业模式视角：钱从哪来

### 3.1 候选模式对比

| 模式 | 代表 | 适配 WorkspaceX？ | 风险 |
|---|---|---|---|
| **Open Core** | GitLab、Cal.com、Dify | ✅ 主线。企业治理天然可切 | 切线过深会「自己和自己竞争」 |
| **托管云（Hosted）** | Supabase、n8n、Plausible | ✅ 与 open core 叠加。云上模型/算力/存储是刚性成本，可加成定价 | 大云厂商可以托管你的开源版（用 Apache-2.0 时尤其） |
| **Source-available / 延迟开源** | Sentry（FSL）、HashiCorp（BSL） | ⚠ 可作为**防云厂商**兜底，但会失去「真开源」的社区与 GitHub star 增长 | 社区信任成本高，2023 后争议大 |
| **Skill / 模板市场** | Zapier、Figma Community、Dify 插件 | ✅ 与 devportal + skill-sandbox 现状高度契合 | 市场冷启动需要自己先供货（即 phase 16/17 那批） |
| **支持与服务** | Red Hat | 🔸 早期主要来源之一（私有部署实施），但难规模化 | 人力型收入 |
| **双许可（AGPL + 商业）** | MongoDB 早期、Qt | 🔸 可选：核心 AGPL，闭源集成方买商业许可 | AGPL 会让企业用户法务望而却步，损伤生态 |

**建议组合：Open Core（Apache-2.0）+ 托管云 + Skill 市场，早期用实施服务补现金流。**

### 3.2 定价梯度（草案，数字待市场验证）

| 层 | 对象 | 价格形态 | 包含 |
|---|---|---|---|
| Local（免费） | 个人 | 0 | 桌面版，本地模型，全部 OSS 功能，零出网 |
| Cloud Free | 个人/小团队试用 | 0 + 用量上限 | 托管，1 组织，云端模型配额 |
| Cloud Pro | 小团队 | 按座席/月 + 用量 | 团队协作、云端深度研究、更高配额 |
| Enterprise / 私有部署 | 机构（券商、基金、咨询） | 年费 + 实施 | SSO/SCIM、审计、私有模型网关、行业 Skill 包、SLA |
| Skill 市场 | 开发者 & 用户 | 一次性/订阅，平台抽成 | 第三方与官方行业 skill、模板 |

### 3.3 护城河在哪（开源后还剩什么）

1. **行业 Skill 与评测集**：IC 审阅、投后评级的提示词、流程、评测数据是多年沉淀，不开源。
2. **Context Engine 的运营数据**：证据/Claim/血缘图谱的质量靠使用积累，托管版天然领先。
3. **合规与信任**：金融客户买的是「谁给我兜底」，不是代码。
4. **harness 工程过程**：Agent 团队交付效率本身是竞争力，可独立成产品。

---

## 4. 用户视角：每类用户为什么用、为什么付钱

| 用户 | 需求 | 开源给他什么 | 付费点 | 流失/反感点 |
|---|---|---|---|---|
| **个人研究者 / 分析师** | 本机跑，数据不出网，免费 | 桌面版 + Ollama，完整 studio | 云端更强模型、跨设备同步 | 免费版故意阉割核心流程 |
| **小型咨询/投研团队（3-20 人）** | 协作、共享知识库、快 | 自托管 docker compose 全功能 | Cloud Pro：免运维、协作、算力 | 自托管文档烂、升级痛 |
| **机构（基金/券商/咨询公司 IT）** | 合规、审计、SSO、私有模型、可审计源码 | 可审计的核心源码（这是开源最大的销售助推） | EE 许可 + 行业 Skill 包 + 实施 | 许可证不清晰、EE 边界经常移动 |
| **Skill / 集成开发者** | 稳定契约、沙箱、分发渠道、收益 | contracts + skill-sandbox + devportal | 市场分成（他们是收入方，也是生态） | 契约频繁 breaking、平台自营 skill 挤压 |
| **模型/云厂商与 SI 合作伙伴** | 可托管、可贴牌 | Apache-2.0 允许 | 联合销售、OEM 许可 | 无（这是 Apache 的代价，见 D1） |
| **贡献者 / 社区** | 清晰的贡献路径、能被 merge | harness 的 issue→PR→verify 流程本身就是贡献指南 | 无（换来产品质量与口碑） | 「开源但不接 PR」 |
| **AI 工程团队（harness 用户）** | 让 agent 团队可控地交付软件 | agentic-harness-template | 未来：托管协调服务（coord-gateway 云版）、培训 | 与主产品耦合太深无法单独用 |

**用户视角结论**：免费层必须**完整可用**（个人本地版不缺功能），付费只在「多人、合规、算力、行业内容」四个维度加价。
这是 Open Core 不被社区反噬的唯一做法。

---

## 5. 与仓库现有约束的兼容性

- **契约单源**：开源核心发布 `packages/contracts`，EE 与第三方 skill 都消费它——不新增第二份事实。
- **一个 issue 一个 PR**：开源社区贡献沿用现流程；外部 PR 走同一道 `harness verify` + `classifyChecks` 绿门。
- **静态痕迹 ≠ 动态事实**：许可证状态要以仓库根 `LICENSE` + `package.json.license` + CI `lint-license-headers` 为动态事实，不靠文档声明。
- **同一事实不得声明在两处**：OSS/EE 归属表只放一处（建议 `PROJECT.md` 新增「许可归属」节），本文定稿后引用而非复制。

---

## 6. 分阶段路线（建议，每阶段可独立成 phase）

| 阶段 | 目标 | 关键产出 | 退出判据 |
|---|---|---|---|
| **P0 决策与法务**（2 周） | 拍板 §7 决策 | LICENSE、CLA/DCO、商标政策、EE 边界表 | 人类签核 |
| **P1 边界落地**（1 sprint） | 代码物理隔离 | `ee/` 目录、`lint-ee-boundary`、`EE_ENABLED` 构建、license key | `verify:base` 绿；纯 OSS 构建可跑通 core-loop smoke |
| **P2 开源发布**（1 sprint） | 公开仓库 | README 英文化、docker compose 一键起、桌面版（对齐 PROP-LOCAL-WORKSPACE-001）、CONTRIBUTING | 外部人 30 分钟内跑起来（实测） |
| **P3 云与计费**（2 sprint） | 收入通路 | 计量事件、订阅、组织配额 | 第一笔自助付费 |
| **P4 Skill 市场**（2 sprint） | 生态通路 | 签名/审核/分成、官方行业 Skill 上架 | 第一个第三方 skill 上架并产生交易 |
| **P5 harness 独立**（并行） | 第二产品 | agentic-harness-template 独立仓与品牌 | 独立 star 增长与至少一个外部团队采用 |

---

## 7. 需要人类拍板的决策（收窄成 A/B/C，按 `human-decision-packaging.md`）

| # | 决策 | A | B | C | 建议 |
|---|---|---|---|---|---|
| D1 | 核心许可证 | **Apache-2.0**（最宽松，生态最好，云厂商可托管） | AGPL-3.0 + 商业双许可（防托管，损生态） | FSL/BSL 延迟开源（防托管，非 OSI 开源） | **A**。当前规模的主要风险是没人用，不是被云厂商托管 |
| D2 | 仓库结构 | 单 monorepo 公开，`ee/` 目录商业许可（GitLab 模式） | 双仓：公开 OSS 仓 + 私有 EE 仓 overlay | 先私有，只发布桌面版二进制 | **A**。与 turbo/pnpm 单仓、契约单源、harness 门控最兼容 |
| D3 | EE 切线深度 | 仅治理/合规/多租户 | 治理 + 团队协作 | 治理 + 协作 + 深度研究 | **A**。免费层完整是社区信任的前提 |
| D4 | 行业 Skill 处置 | 闭源付费包 | 开源换生态 | 部分开源（模板开源、评测集闭源） | **A**，视市场冷启动情况改 C |
| D5 | harness 是否独立品牌 | 独立仓独立名 | 留在主仓 `docs/` | 不推广 | **A** |
| D6 | 贡献协议 | DCO | CLA | 无 | **A**（DCO 摩擦最小；若要保留将来改许可证的权利选 B） |

---

## 8. 未决风险

- **Apache-2.0 的托管风险**：若某云厂商托管开源版，我们只能靠 EE 功能与行业 Skill 竞争。可接受，但需要 EE 切线**稳定**——频繁把 OSS 功能挪进 EE 是社区最大反感点。
- **市场冷启动**：Skill 市场没有第三方供货前只有自营内容，要接受 6-12 个月自营期。
- **合规成本**：金融客户的私有部署验收周期长，实施收入是人力型，注意不要被拖成外包公司。
- **免费本地版的模型质量**：qwen3.5:4b 本地体验决定第一印象；桌面版发布前要有明确的「本地/云端能力差异」说明，而不是让用户以为产品本身弱。

---

## 参考

- `.harness/instructions/architecture.md`（洋葱架构 + 契约单源）
- `docs/architecture/context-engine.md`
- `docs/proposals/PROP-LOCAL-WORKSPACE-001.md`
- `.harness/instructions/human-decision-packaging.md`
- 业界案例：GitLab（open core 单仓 `ee/`）、Cal.com（AGPL + 商业）、Dify（Apache-2.0 + 插件市场 + 云）、Sentry（FSL）
