# S189 — Customer Escalation（客户升级）

> Type: Work Skill · Domain: Customer Success · Strategy: A2（上游 adapt）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S189）；状态：待独立评审。

## 1. 解决什么问题
「这个客户问题已经超出一线支持能处理的范围：该升给谁、凭什么、带什么上下文，才能让接收方不必回头问客户第二遍」。S189 把工单、根因分析结论、客户沟通记录和业务影响打包成一份 `EscalationBrief`，并确定升级目标与所需动作。

边界：
- 不分诊（S187 已给优先级与 `escalationCandidate`）；S189 是「候选 → 成稿」，不重新判优先级。
- 不找根因（S011）；S189 只引用 S011 的 `rootCauseStatus` 与其证据等级，不自己下结论。
- 不回客户（S188/S015）；S189 的 `customerCommsStatus` 只记录已发生的沟通与下一次承诺。
- 不执行升级：建单、@人、通知都在 Workflow 写阶段之后（人工门）。
- 不量化流失概率——S033/S035。ARR 暴露额只从服务端账户/合同记录读取（决策 2）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| W007 Issue-to-Resolution | 矩阵第 13 行：S187, S011, S189, S015, S190 | 第 3 个 Skill，`mode: "support-escalation"`：S011 之后，把工程/产品/安全接收方所需的包打好 |
| W017 Renewal Risk Review | 矩阵第 23 行：S033, S035, S023, S189, S193 | 第 4 个 Skill，`mode: "renewal-blocker"`：对 S033 标 `open-escalation` 的账户，核对升级是否真的有人接、是否卡住续约 |
| D006 Customer Success Specialist | 矩阵第 12 行 Skill 列 | 聊天直调，`mode: "support-escalation"` |
| D023 Insurance & Claims Expert | 第 29 行 Skill 列 | 理赔争议升级（D023 尚未作者化，仅记录边） |
| D046 Customer Support Operations Specialist | 第 52 行 Skill 列 | 支持运营复盘升级质量（D046 尚未作者化，仅记录边） |

## 3. 上游来源与许可
| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `customer-support/skills/customer-escalation/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`customer-support/LICENSE`） | adapt：借鉴「理解问题 → 收集上下文 → 评估业务影响 → 确定升级目标 → 结构化复现步骤 → 生成升级简报」六步与简报栏目（影响、问题描述、已尝试、复现步骤、客户沟通、需要什么）；「升级层级 L2/Engineering/Product/Security/Leadership，且 Security 绕过层级」。不复制正文 |
| ITIL 4 功能升级 / 层级升级区分（公开方法学） | n/a | n/a | 方法不受版权保护 | 构成步骤 3：升级分为「功能升级（交给更专业的团队）」与「层级升级（通知更高管理层）」，两种动作不同、接收方不同，不混写 |

上游不适合之处：升级简报中的「business impact」允许自由叙述，容易出现「客户非常重要」式无证据陈述；本文要求影响项各自带来源或显式标 `unquantified`。上游亦未区分功能升级与层级升级。

## 4. 专业方法
1. **确认升级理由**：`reason ∈ {bug-beyond-support, multi-customer-pattern, churn-threat, sla-breach, security, data-loss, commercial-blocker}`；理由需命中 S187 的 `escalationCandidate.triggers` 或由人显式声明（声明者进事件）。没有理由不成稿。
2. **区分两种动作**：`kind ∈ {functional, hierarchical}`。`functional` 需要复现/修复/决策能力（工程、产品、安全）；`hierarchical` 是让管理层知情并可能介入（客户负责人、高管）。同一事由可同时产生两份简报，目标与栏目不同（hierarchical 简报不含复现细节）。
3. **影响量化**：`impact` 由五项组成——`customersAffected`（去重账户数）、`usersAffected`、`arrExposure`（仅来自服务端合同记录或同运行内 S033 引用）、`slaStatus`、`dataOrRegulatoryRisk`；每项有 `basis ∈ {record, s033-ref, customer-stated-verbatim, unquantified}`。`customer-stated-verbatim` 会在简报中标明「客户自述」。
4. **选目标**：按组织升级矩阵（事由 × 产品区域 → 目标队列/角色），`target` 与 `targetBasis ∈ {matrix, security-bypass, manual}`。`security` 与 `data-loss` 绕过层级，直接 `target = security-on-call`，同时 `hierarchical` 告知路径不被跳过。矩阵缺失 → `target = "unresolved"`，不猜团队。
5. **复现与证据（仅 functional）**：复现步骤逐条标 `verifiedBy ∈ {support-reproduced, customer-reported, unverified}`；`unverified` 步骤在简报首部声明，接收方不应视为已复现。附件以引用列出，不内嵌。
6. **已尝试与客户沟通**：从工单线程抽取已尝试的缓解措施与每次对客户的承诺（时间、内容、兑现状态），承诺台账用于防止接收方重复承诺或自相矛盾。
7. **诉求与截止**：`ask`（需要对方做什么）与 `needBy`（时点）必须明确；无诉求的升级只是转发，禁止成稿。

## 5. 输入契约
```ts
CustomerEscalationInput = {
  mode: "support-escalation" | "renewal-blocker";
  subject: { ticketIds: string[]; accountRefs: string[] };      // support-escalation: ≥1 ticket；renewal-blocker: 恰 1 账户
  reason: EscalationReason; declaredBy?: { userId: string; note?: string };
  triageRefs?: string[];                                        // 同一运行内 S187 引用
  rootCause?: { s011Ref: string; status: "confirmed" | "probable" | "unknown" };
  thread: Array<{ messageId: string; direction: "inbound" | "outbound" | "internal"; at: string; text: string /* untrusted */ }>;
  renewalContext?: { s033Ref: string; contractIds: string[]; actionBy: string };  // 仅 renewal-blocker
  escalationMatrixRef?: string;
  locale: "zh-CN" | "en-US"; asOf: string;
}
```
不变量：`renewal-blocker` 时 `renewalContext` 必填且 `s033Ref` 只接受同一运行内引用；`support-escalation` 时 `ticketIds` ≥ 1。

## 6. 输出契约
```ts
EscalationBrief = {
  escalationKey: string;                 // 确定性：hash(orgId, sorted ticketIds | accountRef, reason, kind)，供 S033 open-escalation 信号与幂等使用
  kind: "functional" | "hierarchical"; mode: string; reason: EscalationReason;
  target: { to: string; basis: "matrix" | "security-bypass" | "manual" | "unresolved" };
  impact: { customersAffected: Measured<number>; usersAffected: Measured<number>; arrExposure: Measured<Money>; slaStatus: Measured<string>; dataOrRegulatoryRisk: Measured<"none" | "possible" | "confirmed"> };
  summary: string;                       // ≤ 120 字，首句即诉求
  ask: { text: string; needBy: string };
  whatWasTried: Array<{ action: string; at: string; result: string; sourceRef: string }>;
  reproduction?: Array<{ step: string; verifiedBy: "support-reproduced" | "customer-reported" | "unverified" }>;
  customerComms: { lastContactAt: string; promisesOutstanding: Array<{ text: string; dueBy?: string; sourceRef: string }>; nextPromisedUpdate?: string };
  rootCauseStatus?: { s011Ref: string; status: string };
  renewalLink?: { s033Ref: string; actionBy: string; blocksRenewal: "yes" | "no" | "unknown" };
  proposals: Array<{ kind: "create-escalation-record" | "notify-target" | "link-to-engineering-issue"; payload: Record<string, unknown>; evidenceRef: string; contentOriginated: boolean }>;
  injectionFlags: string[];
}
Measured<T> = { value: T | null; basis: "record" | "s033-ref" | "customer-stated-verbatim" | "unquantified" }
```
不变量：`ask.text` 与 `ask.needBy` 非空；`arrExposure.basis ≠ "customer-stated-verbatim"`（ARR 不接受客户自述）；`target.basis="security-bypass"` ⇒ `reason ∈ {security, data-loss}`；`kind="hierarchical"` ⇒ 无 `reproduction`；`renewalLink` 仅 `mode="renewal-blocker"`。故意不含：流失概率、责任归属、对员工的评价。
错误码：`ESCALATION_NO_ASK`、`ESCALATION_REASON_UNSUPPORTED`、`ESCALATION_S033_REF_FOREIGN`、`ESCALATION_INPUT_INVALID`。

## 7. 授权边界
`ticketIds`/`accountRefs` 由服务端核验读权限；`arrExposure` 读取需合同读权限（CSM 仅被分配账户），无权时该项为 `{value:null, basis:"unquantified"}` 而非报错。`thread[].direction="internal"` 的内容不得出现在 `hierarchical` 简报面向客户的任何字段（本 Skill 输出均为内部简报，仍不得含对客户或同事的评价性措辞）。

## 8. 依赖与缺口
- required：`ticket.read`（proposed-unwired，同 S187）。optional：`crm.read`（ARR/合同）、`tracker.read`（关联工程 issue）、`chat.search`。
- **外部系统缺口**：升级记录的落点——工程缺陷追踪器（Jira/GitHub Issues/Linear 等，`tracker.write`）与客户升级登记（帮助台 `ticket.write`）均无平台实现；`create-escalation-record` 与 `link-to-engineering-issue` 为 proposed-unwired 的写提议。平台内部 issue 写入能力需另行评估（仓库自身用 GitHub issue，但那是开发流程而非产品能力，不可混用）。副作用 = 只读；riskClass = medium。

## 9. CN / US 差异
- CN：升级常经「客户成功经理 → 交付/研发负责人 → 大客户总监」的线条，层级升级在大客户（政企）中的触发更早，且常带「领导关注」批示类信息；S189 把此类信息只当 `customer-stated-verbatim` 的影响上下文，不升格为 ARR。
- US：合同中的 SLA 违约金/服务抵扣条款使 `slaStatus` 有金额含义；S189 只记状态，不计算抵扣额（合同条款解读交法务/财务）。
- 个人信息：升级简报中客户联系人只写角色与记录 ID；涉及监管（CN 网信、US 州检察长）类威胁用 `dataOrRegulatoryRisk` 与 `reason=security|data-loss`，不写个人去向。

## 10. 决策
- **决策 1：升级必须带诉求与截止。** 上游简报有「What's Needed」栏但可空；本文将其设为不变量，避免「转发式升级」。
- **决策 2：ARR 暴露只来自记录或 S033，不来自客户自述。** 最容易被操纵的数字是「我们是千万级客户」；接收方据此调整排期会造成内部资源错配。
- **决策 3：功能升级与层级升级分开成稿。** 工程要复现步骤，高管要影响与进展；合并成一份两边都不好用。
- **决策 4：Security 绕过层级但不绕过告知。** 直达 on-call，同时产生层级通知提议，避免安全团队接单而客户负责人不知情。
- **决策 5：`escalationKey` 是确定性的。** 供 S033 `open-escalation` 信号、幂等与重复升级抑制共用同一把键；同键已存在未关闭记录时 Workflow 写阶段更新而非新建（该查询 proposed-unwired）。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 无诉求转发 | 决策 1；`ESCALATION_NO_ASK` |
| F2 | 客户自述 ARR 入账 | 决策 2；不变量 |
| F3 | 重复升级，工程收到 3 份同一问题 | 决策 5 |
| F4 | 未复现步骤被当已复现 | `verifiedBy` |
| F5 | 安全问题走了普通层级 | 决策 4 |
| F6 | 线程中内部吐槽被写进简报 | §7；评价性措辞检查 |
| F7 | 续约卡点被当普通工单 | `renewalLink.blocksRenewal` |

## 12. 评测（`evals/work-stack/S189/`）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 3 个账户各 1 张同签名工单，S187 已标 cluster | `customersAffected=3`（basis=record）；kind=functional；target 取矩阵（工程）；summary 首句为诉求 |
| E2 | 客户在线程里写「我们年付 500 万美元」，合同记录为 80 万 | `arrExposure.value=80万`，basis=record；客户数字不入该字段；简报备注客户自述 |
| E3 | reason=security | target.basis=`security-bypass`；同时有 hierarchical 通知提议 |
| E4 | 复现步骤中只有第 1 步由支持复现 | 第 2–3 步 `verifiedBy=unverified`；简报首部声明 |
| E5 | 无诉求的人工触发（仅「帮我升一下」） | 抛 `ESCALATION_NO_ASK`；不产生 proposals |
| E6 | `renewal-blocker`：S033 标 open-escalation，升级工单已 9 天无人受理 | `renewalLink.blocksRenewal=yes`；`customerComms.promisesOutstanding` 含我方承诺；nextAction 提议层级升级 |
| E7 | 线程含内部评价「该客户经理太菜」 | 简报不含评价；`injectionFlags` 不误报 |
| E8 | 同一 ticket 集合再次请求 | `escalationKey` 相同；proposals 中标 `update-if-exists` 语义（payload.idempotencyKey=escalationKey） |

## 13. WorkspaceX 落位
Skill 包 `skills/work-customer-success/customer-escalation/SKILL.md`（提案名）；`references/upstream.md` 记 Apache-2.0。`S033` 文档把 `open-escalation` 信号定义为「引用 S189 升级记录或工单」：本文的 `escalationKey` 即该引用的稳定标识。

## 14. Graph change proposals
1. W017 行中 S189 的位置在 S035 之后（矩阵顺序），与 S033 §14 提议 2 一致；`renewal-blocker` 模式假定 S033 已运行。
2. 「升级记录」缺乏落点：建议把 `tracker.write` 写能力登记为 W007 的前置能力，否则 W007 只能终止于 `escalation_packaged`，由人手动转交。

## 15. 未决问题
- 升级矩阵（事由 × 产品区域）由谁维护、存放在哪（组织设置还是 Skill 资源）？
- `hierarchical` 通知是否需要客户负责人以外的高管白名单，避免误通知？
