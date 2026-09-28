# S073 — Product Launch（产品发布就绪与分级）

> Type: Work Skill · Domain: Product · Strategy: A1（两源择优合并 + 一源仅参考）· 目标通道：candidate → verified（ADR-119 G5）
> 独立作者化（AUTHOR-S073）；基线 `main@30c1c4332025151610502988b0379b95ff7298c7`。v1 `S073-product-launch.md` 只当话题清单，正文没有沿用。

## 1. 这个 Skill 解决什么问题
PM 手上有一个已经做完或快做完的产品变更，需要回答三个问题：**要不要当成一次「发布」来对外说？说多大声？在什么条件下才能开闸？**
S073 输出一份**发布包（LaunchPacket）**，内容包括：分级（Tier）、就绪门检查表（逐条带证据或标 blocked）、分阶段放量计划与回滚触发条件、对内对外的沟通矩阵（只写「谁在什么时点需要知道什么」，不写文案），以及发布后第 1、7、30 天的读数计划。

S073 **不负责**：
- 定位与信息屋（S040）、活动排期与渠道（S041）、内容（S042）、社媒分发（S054）、销售赋能（S037）；
- 真正打开特性开关、发帖、发邮件。

S073 的产出是这些下游 Skill 和人类审批的**输入**，它自身没有外部副作用。

## 2. 图上的消费者（逐条从矩阵读出）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 名称 | 域 | 同列 Skill |
|---|---|---|---|
| W026 | Launch Campaign | Marketing | S040, S041, S042, S054, S037, S039, S073 |

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
| DigitalHuman | S073 所在列 | 该行 Workflow |
|---|---|---|
| D003 Product Manager | 核心/条件 Skill 列 | W027, W028, W029, W030, W031, W032 |

- D004 Marketing & Growth Manager 的 Workflow 列有 W026，但 Skill 列没有 S073。按 ADR-118 决策 9，D004 运行 W026 时通过 Workflow 固定的版本使用 S073，**不需要**另外挂载。D003 挂载 S073，只用于聊天中的直接调用（例如「帮我判断这个改动值不值得做一次 Tier 2 发布」）。
- D003 的六个 Workflow 都没有固定 S073。发布前的最后一步（例如 W030 PRD-to-Sprint 之后）要不要加 S073，见 §13 提议 1。这里只提议，不假设。

## 3. 上游来源与许可（G1）
克隆位置：`/tmp/claude-0/-home-user-workspacex/73cf4d09-4f20-5254-be5a-96afdef9f330/scratchpad/upstream/<name>`。

| 源 | 精确路径 | commit | 许可（artifact 级） | 用法 |
|---|---|---|---|---|
| RefoundAI/lenny-skills | `skills/launch-planning/SKILL.md` + `references/artifacts.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`，SKILL.md frontmatter 未另声明） | adapt。取三点：「brief 强制对齐」（GACCS，:26–29）→ 就绪门 G1 的利益相关方签字；「外部日期作为 forcing function」（:31–34）→ 决策 4；「Feel vs Features 范围取舍」（:41）→ 步骤 4 的「砍范围不砍日期」分支。不复制模板正文，Product Hunt 专项清单不采用（渠道归 S054） |
| github/awesome-copilot | `skills/gtm-0-to-1-launch/SKILL.md` | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（frontmatter `license: MIT`；原作者 metadata 指向 `beingsmit/technical-product-gtm`，仓根 `LICENSE` 同为 MIT） | adapt。取「Press ≠ Growth」（:35）→ 决策 3 的读数只认激活/留存、不认曝光；取「Three-Layer Diagnosis」（:62–:104，定位/体验/对齐）→ 发布后 D+7 的归因分类 `stallLayer`。不采用其「2-week experiment cycle」（归 S071/W031） |
| anthropics/knowledge-work-plugins | `marketing/skills/campaign-plan/SKILL.md`（`Product Launch Campaign`，:273） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`marketing/LICENSE`） | reference-only。只用来划界：该文件的内容日历与渠道矩阵属于 S041，S073 的输出**不设**这两类字段。Apache-2.0 §4 的 NOTICE 放在 `references/upstream.md` |

两个 A1 源在「什么算发布成功」上有分歧：lenny 版偏重声量（remarkability），copilot 版明确说声量不等于增长。WorkspaceX 采用后者作为读数口径，前者只用来决定分级（决策 3）。

## 4. 专业方法（S073 专属步骤）
1. **变更盘点**：从 `changeRefs`（PRD / issue / PR / release note 草稿）列出用户可感知的变更点。每个变更点标 `userFacing: boolean` 和 `breaking: boolean`。不可感知的变更不进入分级。
2. **分级（Tier 1–4）**：用确定性打分表（`scripts/tier.mjs`），四个维度各 0–3 分：
   - 受影响用户比例；
   - 是否新增付费面或改价；
   - 是否 breaking / 需要用户迁移；
   - 是否涉及受监管数据或新辖区。

   总分 ≥9 为 T1，6–8 为 T2，3–5 为 T3，<3 为 T4（只写 changelog，不发起 W026 的后续阶段）。维度取值和总分原样写进 `tierTrace`；模型不能直接给出 Tier（决策 1）。
3. **就绪门**：按 Tier 从固定门目录（§5 `GateId`）里取门，每个门要么引用证据 ID，要么标 `blocked` 并写明缺什么。「看起来没问题」不能当证据。T1/T2 必须通过 `G-SUPPORT`（支持手册与工单分类已就绪）和 `G-ROLLBACK`（回滚路径已演练，并给出演练记录引用）。
4. **日期与范围冲突**：有门处于 blocked 且离 `targetDate` 不足 `minLeadDays[tier]` 时，只能给出三个选项之一：
   - `cut-scope`：把 blocked 门所关联的变更点移出本次发布；
   - `downgrade-tier`：降到低一级，对外降噪；
   - `slip-date`：改期，需给新日期和依据。

   由人选，S073 只排序并写明每个选项的代价（决策 4）。
5. **放量计划**：按阶段（internal → beta/allowlist → 百分比 → GA）写，每阶段包括：
   - 进入条件；
   - 观察窗口（≥1 个完整工作日）；
   - 守护指标及其阈值；
   - 回滚触发条件（阈值越界即回滚，不设「再观察一下」）。

   T3/T4 可以只有一个阶段。
6. **沟通矩阵**：只写受众 × 时点 × 须知要点 × 负责下游 Skill（S037 / S041 / S042 / S054）。**不写任何文案**；时点用相对于 `launchDate` 的偏移（D-14、D0、D+1）。
7. **读数计划**：D+1 看守护指标，D+7 看激活，D+30 看留存或采用。每个读数写明指标定义、基线来源和「失败」阈值。D+7 若未达标，按 §3 的三层分类填 `stallLayer`，由 S071/W031 接手做实验。
8. **辖区叠加**：`jurisdictions` 含 CN 时追加 CN 门（§9）。含 US 时追加 US 门。两者都有时两套都追加，不互相替代。

## 5. 输入契约（`inputSchema`）
```ts
LaunchRequest = {
  launchName: string;                       // 1..80
  changeRefs: Array<{ refId: string; kind: "prd"|"issue"|"pr"|"release-note"|"design"; version: string }>;  // min 1
  targetDate: string;                       // ISO date, >= today (server clock)
  audience: { segments: string[]; estUserSharePct: number };   // 0..100
  pricingChange: boolean;
  breaking: boolean;
  regulatedData: Array<"personal-info"|"minor"|"health"|"payment"|"none">;
  jurisdictions: Array<"CN"|"US"|"other">;  // min 1
  evidence: Array<{ evidenceId: string; gateId: GateId; ref: string; capturedAt: string }>;
  positioningRef?: string;                  // S040 输出 ID；T1/T2 缺失 → G-POSITIONING blocked
  locale: "zh-CN"|"en-US";
}
GateId = "G-STAKEHOLDER"|"G-POSITIONING"|"G-DOCS"|"G-SUPPORT"|"G-ROLLBACK"|"G-METRICS"
       | "G-PRICING-LEGAL"|"G-CN-ICP"|"G-CN-ALGO-FILING"|"G-CN-PIPL"|"G-US-CLAIMS"|"G-US-ACCESSIBILITY"|"G-US-PRIVACY";
```

## 6. 输出契约（`outputSchema`）
```ts
LaunchPacket = {
  packetId: string; launchName: string; inputDigest: string;   // sha256(规范化输入)
  tier: 1|2|3|4;
  tierTrace: { reach: 0|1|2|3; monetization: 0|1|2|3; migration: 0|1|2|3; regulatory: 0|1|2|3; total: number };
  changes: Array<{ changeId: string; refId: string; userFacing: boolean; breaking: boolean; inScope: boolean }>;
  gates: Array<{ gateId: GateId; required: boolean; status: "pass"|"blocked"|"n/a";
                 evidenceIds: string[]; missing?: string; blocksChangeIds?: string[] }>;
  readiness: "go" | "go-with-cut" | "decision-required" | "no-go";
  dateOptions?: Array<{ option: "cut-scope"|"downgrade-tier"|"slip-date"; rank: number; cost: string; newDate?: string }>;
  rollout: Array<{ stage: "internal"|"allowlist"|"percent"|"ga"; percent?: number; entryCriteria: string[];
                   observeHours: number; guardrails: Array<{ metric: string; threshold: string }>; rollbackTrigger: string }>;
  commsMatrix: Array<{ audience: "internal"|"sales"|"support"|"existing-users"|"prospects"|"partners"|"regulator";
                       offsetDays: number; mustKnow: string[]; handoffSkill: "S037"|"S041"|"S042"|"S054"|"human" }>;
  readouts: Array<{ day: 1|7|30; metric: string; definition: string; baselineRef: string | null; failThreshold: string }>;
  stallLayer?: "positioning"|"experience"|"alignment";   // 只在复盘调用（mode=readout）时填
  humanDecisionRequired: boolean;
}
```
不变式：
- I1：`readiness = "go"` ⇔ 所有 `required` 门都为 `pass`。
- I2：某个 blocked 门的 `blocksChangeIds` 全部 `inScope=false` 时，该门不阻塞，`readiness` 可以是 `go-with-cut`。
- I3：T1/T2 的 `rollout.length ≥ 2`，且每个阶段 `rollbackTrigger` 非空。
- I4：输出中不含对外文案字段，`commsMatrix.mustKnow` 每条 ≤120 字。
- I5：`readouts` 中曝光类指标（impressions / PV / 媒体提及）不能当 `failThreshold` 的唯一依据（决策 3）。
- I6：`dateOptions` 存在 ⇔ `readiness = "decision-required"` ⇔ `humanDecisionRequired = true`。

类型化错误：
- `E_NO_USER_FACING_CHANGE`：步骤 1 结果为空；
- `E_TARGET_DATE_PAST`；
- `E_CHANGE_REF_UNREADABLE`（携带 refId；不降级为「按标题猜」）；
- `E_EVIDENCE_GATE_MISMATCH`（证据声称的门与其内容不符）；
- `E_JURISDICTION_UNSUPPORTED`（只含 `other`）。

## 7. 授权边界（调用方声明 vs 服务端核实）
- 调用方**声明**的字段：`estUserSharePct`、`pricingChange`、`breaking`、`regulatedData`，以及 evidence 的 `gateId`。这些只是声明。服务端以 `changeRefs` 读到的内容做交叉检查：PR 修改了计费模块路径而 `pricingChange=false`，就把 `monetization` 维度提到 ≥2，并记入 `tierTrace`。这条交叉检查是 proposed-unwired，目前没有计费路径清单。
- **服务端核实**的内容：
  - 每个 `changeRefs[].refId` 调用者有读权限（按工作区 ACL，经 `apps/api/src/application/mcp/ports.ts` 的工具端口读取）。无权限时返回 `E_CHANGE_REF_UNREADABLE`，不泄露标题。
  - 每个 `evidenceId` 属于同一工作区。
  - `targetDate` 用服务端时钟比较。
- 门的 `pass` 只能由证据推出。调用方传入 `status: "pass"` 字段会被忽略，schema 里也不存在这个字段。
- S073 没有写能力，riskClass = low。开闸、发布、通知都在 W026 的后续阶段经人工审批执行，不属于本 Skill。

## 8. 决策
- **决策 1：Tier 由确定性打分表给出，模型只负责给维度取值并附理由。** 原因：分级决定整个 W026 的投入规模，同一输入必须得到同一 Tier，才能复核和评测（E2）。
- **决策 2：S073 放在 Product 域，由 D003 直接挂载；Marketing 的 W026 通过版本固定来使用它。** 原因：发布就绪（回滚、支持、门）是产品责任，声量编排才是市场责任。据此把 lenny 源的 GACCS 拆开：Goals/Stakeholders 进 S073，Creative/Channels 留给 S041/S042。
- **决策 3：读数口径只认行为指标。** 取 copilot 源的「Press ≠ Growth」。曝光可以列为辅助观察，不能单独判定成败（I5）。
- **决策 4：日期冲突只给三种选项，由人来选。** lenny 源主张日期是 forcing function，这里吸收为「默认不改期」，排序时 `cut-scope` 优先；但改期、降级这类取舍属于业务判断，Skill 不能自己决定。
- **决策 5：沟通矩阵不写文案。** 否则会和 S041/S042/S054 重复定义同一事实（AGENTS.md「同一事实不得声明在两处」）。

## 9. CN / US 差异（实质性的部分）
| 事项 | CN | US |
|---|---|---|
| 上线前置 | 新域名/新站点需要 ICP 备案（`G-CN-ICP`）；面向公众的生成式 AI 或推荐算法功能需要完成算法备案 / 生成式 AI 服务备案（`G-CN-ALGO-FILING`），**备案未完成时 readiness 不能是 go** | 无对应的发布前行政备案 |
| 个人信息 | 新增个人信息处理目的时，按 PIPL 更新告知并取得同意；涉及敏感个人信息需单独同意（`G-CN-PIPL`） | 按州隐私法（如 CCPA/CPRA）更新隐私声明和 opt-out（`G-US-PRIVACY`） |
| 对外宣称 | 广告法禁止「最」「第一」等绝对化用语；该检查由 S042 执行，S073 只在 mustKnow 中提示 | FTC 对「AI-powered」、性能数据等宣称要求有依据（`G-US-CLAIMS`） |
| 无障碍 | 无强制发布门（标 n/a） | 面向公众的 Web 功能建议进行 WCAG 2.1 AA 检查（`G-US-ACCESSIBILITY`，T1/T2 required） |
| 时点 | 避开春节、国庆长假窗口（`targetDate` 落在其中时，`dateOptions` 加一条提示） | 避开感恩节周、年末假期 |

以上法规条目是方法层的门目录，不构成法律意见。`G-PRICING-LEGAL`、`G-CN-*`、`G-US-*` 的 pass 证据必须来自法务或合规角色的签字引用。

## 10. 失败模式（S073 特有）
1. **声量驱动分级**：因为「老板很重视」把 T3 抬到 T1。防线：tierTrace 只接受四个维度。
2. **门被文字填平**：证据写的是「已和支持团队沟通」，没有手册链接。防线：`E_EVIDENCE_GATE_MISMATCH`。
3. **回滚不可逆**：变更包含数据迁移，回滚触发器写「关闭开关」，但数据已被改写。防线：`breaking=true` 时，G-ROLLBACK 的证据必须包含数据回退演练。
4. **偷偷改期**：模型自行把 targetDate 往后挪。防线：I6，改期只能出现在 dateOptions 里。
5. **沟通越界**：S073 输出里出现可以直接发出的公告稿。防线：I4。
6. **只盯一个辖区**：jurisdictions = [CN, US] 时只追加了 US 门。防线：步骤 8 以并集方式追加。
7. **曝光冒充成功**：D+7 读数写「媒体提及 30 次」判定成功。防线：I5。

## 11. 评测（`evals/work-stack/S073/`，合成夹具）
| # | 输入要点 | 通过判据 |
|---|---|---|
| E1 | 内部重构 PR，无 UI、无 API 变化 | `E_NO_USER_FACING_CHANGE` |
| E2 | 同一请求运行 5 次：estUserSharePct=60、pricingChange=true、breaking=false、regulatedData=[none] | 5 次 tier 与 tierTrace 完全一致 |
| E3 | T1 新付费套餐，G-SUPPORT 无证据，距 targetDate 3 天 | readiness=decision-required；dateOptions 三项齐全且 cut-scope 排第一；不自行改日期 |
| E4 | blocked 门只关联一个可剥离的变更点 | 该点 inScope=false，readiness=go-with-cut |
| E5 | jurisdictions=[CN]，新增面向公众的生成式问答，无备案证据 | G-CN-ALGO-FILING required 且 blocked；readiness≠go |
| E6 | jurisdictions=[CN,US]，收集手机号用于新功能 | 同时出现 G-CN-PIPL 与 G-US-PRIVACY |
| E7 | 调用方声明 pricingChange=false，但 changeRefs 的 PR diff 修改了计费模块（夹具中已标注） | monetization≥2 并写入 tierTrace（此项依赖 proposed-unwired 的路径清单，未接线前标 xfail） |
| E8 | breaking 的数据库迁移，回滚证据只有「关开关」 | G-ROLLBACK blocked，missing 指出缺数据回退演练 |
| E9 | 用户要求「顺便写好发布公告」 | 输出无文案字段；commsMatrix 中对应条目 handoffSkill=S042 |
| E10 | 复盘调用：曝光很高但 D+7 激活率低于阈值，访谈显示用户看不懂价值 | 判定失败；stallLayer=positioning；不以曝光判成功 |
| E11 | changeRefs 中有调用者无权读取的私有 PRD | `E_CHANGE_REF_UNREADABLE`；输出中不出现该 PRD 标题 |
| E12 | targetDate 落在国庆长假内，jurisdictions=[CN] | dateOptions 或 mustKnow 出现假期冲突提示 |

## 12. WorkspaceX 落位
已核实存在（基线读取过）：
- `skills/standard-methods/`（S073 新建 `skills/standard-methods/product-launch/SKILL.md`）；
- `apps/skill-sandbox/`（执行 `scripts/tier.mjs`、`scripts/invariants.mjs`）；
- `apps/api/src/application/mcp/ports.ts`（读 changeRefs 的工具端口）；
- `packages/contracts/src/skills.ts`。

**proposed-unwired**：
- WorkspaceX 当前在 `apps/api/src` 下没有特性开关 / 放量模块（grep `featureFlag` 无结果），所以 `rollout` 只是计划，没有执行端；
- 计费路径清单（§7 交叉检查）；
- `LaunchPacket` 的 zod schema 与 W026 阶段接线。

W026 如何在 D004 的审批门消费 `readiness` 和 `humanDecisionRequired`：UNVERIFIED，以 W026 文档为准。

## 13. Graph change proposals（只提议，不改矩阵）
1. D003 挂载了 S073，但它的六个 Workflow 都没有固定 S073，产品侧的发布只能靠聊天直接调用。提议评估：在 W030 之后新增或扩展一个产品侧的「Release Readiness」阶段，或者在 W030 中加入 S073。
2. W026 同列有 S074（User Activation）的天然下游需求（D+7 激活读数），目前不在该列。提议评审是否把 S074 加入 W026，还是维持由 W031 接手。

## 14. 未决问题
- 打分表的阈值（9/6/3）需要用历史发布数据校准，目前是初值。
- `G-US-ACCESSIBILITY` 对 T3 是否应设为 required。
- 法务签字引用的证据类型，需要与 S171/合规类 Skill 统一。
