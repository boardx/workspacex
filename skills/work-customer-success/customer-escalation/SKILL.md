---
name: customer-escalation
version: 1.0.0
capability_id: WX-WORK-S189
description: 把已超出一线支持能力的客户问题打包成升级简报：理由、影响（带来源）、升级目标、已尝试、复现步骤、客户沟通台账，以及必须明确的诉求与截止。功能升级与层级升级分开成稿；只出提议，不执行升级。
metadata:
  work:
    stableId: S189
    domain: Customer Success
    riskClass: medium
    dependencies:
      required:
        - ticket.read
      optional:
        - crm.read
        - tracker.read
        - chat.search
    provenance:
      - repo: anthropics/knowledge-work-plugins
        path: customer-support/skills/customer-escalation/SKILL.md
        commit: da38ec1ee89d41e5380e652a97382695003396e7
        license: Apache-2.0
        strategy: adapt
        copied: false
    locales:
      - zh-CN
      - en-US
    jurisdictions:
      - CN
      - US
    evalSuiteId: S189
    inputSchema:
      type: object
      properties:
        mode:
          type: string
          enum:
            - support-escalation
            - renewal-blocker
        subject:
          type: object
          properties:
            ticketIds:
              type: array
              items:
                type: string
            accountRefs:
              type: array
              items:
                type: string
              minItems: 1
          required:
            - ticketIds
            - accountRefs
        reason:
          type: string
          enum:
            - bug-beyond-support
            - multi-customer-pattern
            - churn-threat
            - sla-breach
            - security
            - data-loss
            - commercial-blocker
        declaredBy:
          type: object
          properties:
            userId:
              type: string
            note:
              type: string
          required:
            - userId
        triageRefs:
          type: array
          items:
            type: string
        rootCause:
          type: object
          properties:
            s011Ref:
              type: string
            status:
              type: string
              enum:
                - confirmed
                - probable
                - unknown
          required:
            - s011Ref
            - status
        thread:
          type: array
          items:
            type: object
            properties:
              messageId:
                type: string
              direction:
                type: string
                enum:
                  - inbound
                  - outbound
                  - internal
              at:
                type: string
              text:
                type: string
                description: untrusted
            required:
              - messageId
              - direction
              - at
              - text
        renewalContext:
          type: object
          properties:
            s033Ref:
              type: string
            contractIds:
              type: array
              items:
                type: string
            actionBy:
              type: string
          required:
            - s033Ref
            - contractIds
            - actionBy
        escalationMatrixRef:
          type: string
        locale:
          type: string
          enum:
            - zh-CN
            - en-US
        asOf:
          type: string
      required:
        - mode
        - subject
        - reason
        - thread
        - locale
        - asOf
      allOf:
        - if:
            properties:
              mode:
                const: renewal-blocker
          then:
            required:
              - renewalContext
            properties:
              subject:
                properties:
                  accountRefs:
                    maxItems: 1
        - if:
            properties:
              mode:
                const: support-escalation
          then:
            properties:
              subject:
                properties:
                  ticketIds:
                    minItems: 1
    outputSchema:
      anyOf:
        - type: object
          properties:
            escalationKey:
              type: string
            kind:
              type: string
              enum:
                - functional
                - hierarchical
            mode:
              type: string
            reason:
              type: string
              enum:
                - bug-beyond-support
                - multi-customer-pattern
                - churn-threat
                - sla-breach
                - security
                - data-loss
                - commercial-blocker
            target:
              type: object
              properties:
                to:
                  type: string
                basis:
                  type: string
                  enum:
                    - matrix
                    - security-bypass
                    - manual
                    - unresolved
              required:
                - to
                - basis
            impact:
              type: object
              properties:
                customersAffected:
                  type: object
                  properties:
                    value:
                      anyOf:
                        - type: number
                        - type: "null"
                    basis:
                      type: string
                      enum:
                        - record
                        - s033-ref
                        - customer-stated-verbatim
                        - unquantified
                  required:
                    - basis
                usersAffected:
                  type: object
                  properties:
                    value:
                      anyOf:
                        - type: number
                        - type: "null"
                    basis:
                      type: string
                      enum:
                        - record
                        - s033-ref
                        - customer-stated-verbatim
                        - unquantified
                  required:
                    - basis
                arrExposure:
                  type: object
                  properties:
                    value:
                      anyOf:
                        - type: object
                          properties:
                            amount:
                              type: number
                            currency:
                              type: string
                          required:
                            - amount
                            - currency
                        - type: "null"
                    basis:
                      type: string
                      enum:
                        - record
                        - s033-ref
                        - customer-stated-verbatim
                        - unquantified
                  required:
                    - basis
                slaStatus:
                  type: object
                  properties:
                    value:
                      anyOf:
                        - type: string
                        - type: "null"
                    basis:
                      type: string
                      enum:
                        - record
                        - s033-ref
                        - customer-stated-verbatim
                        - unquantified
                  required:
                    - basis
                dataOrRegulatoryRisk:
                  type: object
                  properties:
                    value:
                      anyOf:
                        - type: string
                          enum:
                            - none
                            - possible
                            - confirmed
                        - type: "null"
                    basis:
                      type: string
                      enum:
                        - record
                        - s033-ref
                        - customer-stated-verbatim
                        - unquantified
                  required:
                    - basis
              required:
                - customersAffected
                - usersAffected
                - arrExposure
                - slaStatus
                - dataOrRegulatoryRisk
            summary:
              type: string
              maxLength: 120
            ask:
              type: object
              properties:
                text:
                  type: string
                  minLength: 1
                needBy:
                  type: string
                  minLength: 1
              required:
                - text
                - needBy
            whatWasTried:
              type: array
              items:
                type: object
                properties:
                  action:
                    type: string
                  at:
                    type: string
                  result:
                    type: string
                  sourceRef:
                    type: string
                required:
                  - action
                  - at
                  - result
                  - sourceRef
            reproduction:
              type: array
              items:
                type: object
                properties:
                  step:
                    type: string
                  verifiedBy:
                    type: string
                    enum:
                      - support-reproduced
                      - customer-reported
                      - unverified
                required:
                  - step
                  - verifiedBy
            customerComms:
              type: object
              properties:
                lastContactAt:
                  type: string
                promisesOutstanding:
                  type: array
                  items:
                    type: object
                    properties:
                      text:
                        type: string
                      dueBy:
                        type: string
                      sourceRef:
                        type: string
                    required:
                      - text
                      - sourceRef
                nextPromisedUpdate:
                  type: string
              required:
                - lastContactAt
                - promisesOutstanding
            rootCauseStatus:
              type: object
              properties:
                s011Ref:
                  type: string
                status:
                  type: string
              required:
                - s011Ref
                - status
            renewalLink:
              type: object
              properties:
                s033Ref:
                  type: string
                actionBy:
                  type: string
                blocksRenewal:
                  type: string
                  enum:
                    - yes
                    - no
                    - unknown
              required:
                - s033Ref
                - actionBy
                - blocksRenewal
            notes:
              type: array
              items:
                type: string
                description: 供人阅读的备注，例如「客户自述」与记录不一致；不含评价性措辞
            proposals:
              type: array
              items:
                type: object
                properties:
                  kind:
                    type: string
                    enum:
                      - create-escalation-record
                      - notify-target
                      - link-to-engineering-issue
                  payload:
                    type: object
                  evidenceRef:
                    type: string
                  contentOriginated:
                    type: boolean
                required:
                  - kind
                  - payload
                  - evidenceRef
                  - contentOriginated
            injectionFlags:
              type: array
              items:
                type: string
          required:
            - escalationKey
            - kind
            - mode
            - reason
            - target
            - impact
            - summary
            - ask
            - whatWasTried
            - customerComms
            - proposals
            - injectionFlags
        - type: object
          properties:
            error:
              type: object
              properties:
                code:
                  type: string
                  enum:
                    - ESCALATION_NO_ASK
                    - ESCALATION_REASON_UNSUPPORTED
                    - ESCALATION_S033_REF_FOREIGN
                    - ESCALATION_INPUT_INVALID
                message:
                  type: string
              required:
                - code
          required:
            - error
---

# 客户升级（S189）

> Work Skill · v2 实体 S189 · 领域 Customer Success · 依据 `requirements/work-stack-v2/skills/S189-customer-escalation.md`（单一事实源；frontmatter 的 JSON Schema 是其 §5/§6 的机器形态）。

## 解决什么问题

问题已超出一线支持能力：该升给谁、凭什么、带什么上下文，才能让接收方不必回头再问客户一遍。把工单、根因结论、沟通记录与业务影响打包成 `EscalationBrief`，并确定升级目标与所需动作。

**不做**：分诊（S187 已给优先级与 `escalationCandidate`，S189 是「候选 → 成稿」，不重判优先级）；找根因（S011，只引用其 `rootCauseStatus` 与证据等级）；回客户（S188/S015，`customerComms` 只记录已发生的沟通与下次承诺）；执行升级（建单、@人、通知都在 Workflow 写阶段之后的人工门）；量化流失概率（S033/S035）。

## 方法

1. **确认升级理由**：`reason ∈ {bug-beyond-support, multi-customer-pattern, churn-threat, sla-breach, security, data-loss, commercial-blocker}`，须命中 S187 的 `escalationCandidate.triggers` 或由人显式声明（声明者进事件）。没有理由不成稿。
2. **区分两种动作**：`functional`（需要复现/修复/决策能力：工程、产品、安全）与 `hierarchical`（让管理层知情并可能介入）。同一事由可同时产生两份简报，目标与栏目不同；hierarchical 简报**不含复现细节**。
3. **影响量化**：`customersAffected`（去重账户数）、`usersAffected`、`arrExposure`、`slaStatus`、`dataOrRegulatoryRisk`，每项 `basis ∈ {record, s033-ref, customer-stated-verbatim, unquantified}`。**ARR 暴露只来自服务端合同记录或同运行内 S033 引用，不接受客户自述**；客户自述只在备注里标明「客户自述」。
4. **选目标**：按组织升级矩阵（事由 × 产品区域）。`security` 与 `data-loss` **绕过层级**直达 `security-on-call`（`basis=security-bypass`），同时必须产生层级告知提议，不跳过告知。矩阵缺失 → `target="unresolved"`，不猜团队。
5. **复现与证据（仅 functional）**：复现步骤逐条标 `verifiedBy ∈ {support-reproduced, customer-reported, unverified}`；`unverified` 步骤在简报首部声明，接收方不应视为已复现。附件只列引用。
6. **已尝试与客户沟通**：抽取已尝试的缓解措施与每次对客户的承诺（时间、内容、兑现状态），防止接收方重复承诺或自相矛盾。
7. **诉求与截止**：`ask` 与 `needBy` 必须明确；无诉求的升级只是转发，抛 `ESCALATION_NO_ASK`，不产生 proposals。

## 硬性不变量

- `ask.text`、`ask.needBy` 非空；`arrExposure.basis ≠ "customer-stated-verbatim"`；`target.basis="security-bypass"` ⇒ `reason ∈ {security, data-loss}`；`kind="hierarchical"` ⇒ 无 `reproduction`；`renewalLink` 仅 `mode="renewal-blocker"`。
- `summary` ≤ 120 字，首句即诉求。
- `escalationKey` 是确定性键：`"esc-" + sha256(orgId|排序后的 ticketIds 或 accountRef|reason|kind)` 前 16 位十六进制；供 S033 `open-escalation` 信号与幂等使用，proposals 的 `payload.idempotencyKey` 取同一值并标 `mode="update-if-exists"`（同键已有未关闭记录则更新而非新建，该查询 proposed-unwired）。
- `renewal-blocker` 必须带 `renewalContext`，且 `s033Ref` 只接受同一运行内引用；`support-escalation` 至少 1 张工单。
- 无合同读权限时 `arrExposure` 为 `{value:null, basis:"unquantified"}`，**不报错**。线程里 `direction="internal"` 的内容不得带评价性措辞进入简报。输出故意不含：流失概率、责任归属、对员工的评价。
- 类型化错误：`ESCALATION_NO_ASK`、`ESCALATION_REASON_UNSUPPORTED`、`ESCALATION_S033_REF_FOREIGN`、`ESCALATION_INPUT_INVALID`（以 `{ error: { code, message } }` 返回）。

## 依赖与未接线（ADR-120）

- required：`ticket.read`——**proposed-unwired**（同 S187，平台无工单模型）。optional：`crm.read`（ARR/合同）、`tracker.read`（关联工程 issue）、`chat.search`。
- 升级记录落点（`tracker.write`、帮助台 `ticket.write`）均无平台实现；`create-escalation-record` 与 `link-to-engineering-issue` 是 proposed-unwired 的写提议。副作用只读，riskClass medium。

## 溯源（G1）

`anthropics/knowledge-work-plugins`：`customer-support/skills/customer-escalation/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt，未复制。详见 `references/upstream.md`。

## 使用方

W007（`support-escalation`）、W017 Renewal Risk Review（`renewal-blocker`）、D006、D023、D046。见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `DIGITALHUMAN-COMPOSITION-MATRIX.md`。
