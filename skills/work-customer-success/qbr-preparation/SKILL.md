---
name: qbr-preparation
version: 1.0.0
capability_id: WX-WORK-S191
description: 为某客户的季度业务回顾准备两份互不串的材料：含难点与真实判断的内部准备视图，和只含可对客户说且有证据内容的共享视图（白名单字段）。引用而不重算 S035/S033/S193，商业提案只移交。
metadata:
  work:
    stableId: S191
    domain: Customer Success
    riskClass: medium
    dependencies:
      required: []
      optional:
        - crm.read
        - product.usage.read
        - ticket.read
        - calendar.read
    provenance:
      - repo: anthropics/knowledge-work-plugins
        path: sales/skills/customer-health/SKILL.md
        commit: da38ec1ee89d41e5380e652a97382695003396e7
        license: Apache-2.0
        strategy: reference-only
        copied: false
    locales:
      - zh-CN
      - en-US
    jurisdictions:
      - CN
      - US
    evalSuiteId: S191
    inputSchema:
      type: object
      properties:
        mode:
          type: string
          enum:
            - qbr
            - mini-review
        accountRef:
          type: string
        periodStart:
          type: string
        periodEnd:
          type: string
        meetingDate:
          type: string
        successPlan:
          type: object
          properties:
            planRef:
              type: string
            goals:
              type: array
              items:
                type: object
                properties:
                  goalId:
                    type: string
                  owner:
                    type: string
                    enum:
                      - customer
                      - us
                  statement:
                    type: string
                  metricRef:
                    type: string
                required:
                  - goalId
                  - owner
                  - statement
          required:
            - planRef
            - goals
        healthResultRef:
          type: string
          description: 同一运行内 S035 引用
        renewalContext:
          type: object
          properties:
            s033Ref:
              type: string
              description: 同一运行内 S033 引用
        vocRef:
          type: string
          description: 同一运行内 S193 引用
        usageSummary:
          type: object
          properties:
            sourceRef:
              type: string
            metrics:
              type: array
              items:
                type: object
                properties:
                  name:
                    type: string
                  current:
                    type: number
                  previous:
                    type: number
                  unit:
                    type: string
                required:
                  - name
                  - current
                  - previous
                  - unit
          required:
            - sourceRef
            - metrics
        supportSummary:
          type: object
          properties:
            sourceRef:
              type: string
            ticketsOpened:
              type: integer
            ticketsClosed:
              type: integer
            p1Count:
              type: integer
            csatAvg:
              type: number
            csatN:
              type: integer
          required:
            - sourceRef
            - ticketsOpened
            - ticketsClosed
            - p1Count
        commitmentsLedgerRef:
          type: string
        roadmapItems:
          type: array
          items:
            type: object
            properties:
              itemId:
                type: string
              title:
                type: string
              disclosureApproved:
                type: boolean
            required:
              - itemId
              - title
              - disclosureApproved
        attendees:
          type: array
          items:
            type: object
            properties:
              role:
                type: string
              side:
                type: string
                enum:
                  - customer
                  - us
            required:
              - role
              - side
        locale:
          type: string
          enum:
            - zh-CN
            - en-US
      required:
        - mode
        - accountRef
        - periodStart
        - periodEnd
        - locale
    outputSchema:
      anyOf:
        - type: object
          properties:
            mode:
              type: string
            accountRef:
              type: string
            period:
              type: object
              properties:
                start:
                  type: string
                end:
                  type: string
              required:
                - start
                - end
            internalView:
              type: object
              properties:
                goalReview:
                  type: array
                  items:
                    type: object
                    properties:
                      goalId:
                        type: string
                      status: &a1
                        type: string
                        enum:
                          - met
                          - partially-met
                          - not-met
                          - not-measurable
                      evidenceRefs:
                        type: array
                        items:
                          type: string
                      makeMeasurableBy:
                        type: string
                    required:
                      - goalId
                      - status
                      - evidenceRefs
                valueClaims:
                  type: array
                  items:
                    type: object
                    properties:
                      claim:
                        type: string
                      state:
                        type: string
                        enum:
                          - proven
                          - unproven
                      evidenceRef:
                        type: string
                    required:
                      - claim
                      - state
                hardTopics:
                  type: array
                  items:
                    type: object
                    properties:
                      topic:
                        type: string
                      source:
                        type: string
                        enum:
                          - outstanding-promise
                          - price-change
                          - voc-negative
                          - health-dimension
                          - incident
                      preWire:
                        type: object
                        properties:
                          who:
                            type: string
                          byDate:
                            type: string
                          points:
                            type: array
                            items:
                              type: string
                        required:
                          - who
                          - byDate
                          - points
                    required:
                      - topic
                      - source
                      - preWire
                healthNote:
                  type: object
                  properties:
                    s035Ref:
                      type: string
                  required:
                    - s035Ref
                renewalNote:
                  type: object
                  properties:
                    s033Ref:
                      type: string
                    qbrRelativeToActionBy:
                      type: string
                      enum:
                        - before
                        - after
                        - unknown
                  required:
                    - s033Ref
                    - qbrRelativeToActionBy
                undisclosableQuestions:
                  type: array
                  items:
                    type: string
                notes:
                  type: array
                  items:
                    type: string
                    description: 内部备注，例如 CSAT 样本不足；永不进入 customerView
              required:
                - goalReview
                - valueClaims
                - hardTopics
                - undisclosableQuestions
            customerView:
              type: object
              properties:
                agenda:
                  type: array
                  items:
                    type: object
                    properties:
                      slot:
                        type: string
                      minutes:
                        type: integer
                        minimum: 1
                      owner:
                        type: string
                        enum:
                          - customer
                          - us
                    required:
                      - slot
                      - minutes
                      - owner
                goalProgress:
                  type: array
                  items:
                    type: object
                    properties:
                      goalId:
                        type: string
                      status: *a1
                      summary:
                        type: string
                    required:
                      - goalId
                      - status
                      - summary
                valueHighlights:
                  type: array
                  items:
                    type: object
                    properties:
                      statement:
                        type: string
                      evidenceLabel:
                        type: string
                    required:
                      - statement
                      - evidenceLabel
                usageHighlights:
                  type: array
                  items:
                    type: object
                    properties:
                      metric:
                        type: string
                      change:
                        type: string
                    required:
                      - metric
                      - change
                roadmapDiscussion:
                  type: array
                  items:
                    type: object
                    properties:
                      itemId:
                        type: string
                      title:
                        type: string
                    required:
                      - itemId
                      - title
                nextPeriodProposals:
                  type: array
                  items:
                    type: object
                    properties:
                      action:
                        type: string
                      customerOwnerRole:
                        type: string
                      usOwnerRole:
                        type: string
                      measure:
                        type: string
                    required:
                      - action
                      - customerOwnerRole
                      - usOwnerRole
                      - measure
                  maxItems: 3
              required:
                - agenda
                - goalProgress
                - valueHighlights
                - usageHighlights
                - roadmapDiscussion
                - nextPeriodProposals
              additionalProperties: false
            consistencyCheck:
              type: object
              properties:
                passed:
                  type: boolean
                violations:
                  type: array
                  items:
                    type: object
                    properties:
                      rule:
                        type: string
                        enum:
                          - unsourced-number
                          - internal-field-leak
                          - undisclosed-roadmap
                      where:
                        type: string
                    required:
                      - rule
                      - where
              required:
                - passed
                - violations
            handoffs:
              type: array
              items:
                type: object
                properties:
                  to:
                    type: string
                    enum:
                      - S023
                      - S036
                      - S189
                  reason:
                    type: string
                required:
                  - to
                  - reason
            proposals:
              type: array
              items:
                type: object
                properties:
                  kind:
                    type: string
                    enum:
                      - schedule-meeting
                      - update-success-plan
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
          required:
            - mode
            - accountRef
            - period
            - internalView
            - customerView
            - consistencyCheck
            - handoffs
            - proposals
        - type: object
          properties:
            error:
              type: object
              properties:
                code:
                  type: string
                  enum:
                    - QBR_ACCOUNT_NOT_VISIBLE
                    - QBR_PERIOD_INVALID
                    - QBR_REF_FOREIGN
                    - QBR_INPUT_INVALID
                message:
                  type: string
              required:
                - code
          required:
            - error
---

# QBR 准备（S191）

> Work Skill · v2 实体 S191 · 领域 Customer Success · 策略 A0（WorkSpaceX 原创；上游仅 reference-only）· 依据 `requirements/work-stack-v2/skills/S191-qbr-preparation.md`（单一事实源；frontmatter 的 JSON Schema 是其 §5/§6 的机器形态）。

## 解决什么问题

下周要与某客户开季度回顾会：上个周期共同承诺了什么、客户实际拿到了什么价值（有证据的）、有哪些难谈的话题要提前打招呼、下个周期建议一起做什么。产出 `QbrPackage`：**内部准备视图**（难点、风险、健康判断、议程预案）与**客户共享视图**（只含可对客户说的内容），两者互相不串。

**不做**：判账户健康（S035，只引用其结论，共享视图里不出现健康颜色与内部评分）；计算续约截止（S033，仅在内部视图提示本次 QBR 在续约动作日之前/之后）；汇总客户声音（S193，只取经逐字授权可引用的部分）；发送、排会、改 CRM（全为 `proposals`）；账户战略（S023）与商务方案（S036）。

## 方法

1. **目标回顾**：`successPlan` 的目标（客户目标 + 我方承诺）逐条给 `met | partially-met | not-met | not-measurable` 与证据；`not-measurable` 是合法结论（没有指标就不能说达成），并附 `makeMeasurableBy`（下期如何使其可测）。
2. **价值证据表**：每个价值主张必须有证据（客户系统数据 / 客户逐字陈述 / 产品使用数据）；来源不可见则 `state="unproven"`，**不进客户共享视图**，仅内部列「待证明」。缺少外部数据时降级为调用方上传材料，`valueClaims` 一律 `unproven`。
3. **使用与支持概览**：趋势取自 `usageSummary`，支持概况取自 `supportSummary`；共享视图只展示对客户有意义且已对其披露过的指标。`csatN < 30` 时 `csatAvg` 不进共享视图，内部视图注明样本不足。
4. **难点预案**：列出客户不会主动提但会在会上问的话题（未兑现承诺、持续故障、价格上调、竞品对比、负面主题、红/黄维度），每项给 `preWire`（谁、何时之前、说什么要点；`byDate` 早于会议日）。来源：S189 `promisesOutstanding`、S033 `price-increase-pending`、S193 负面主题、S035 红/黄维度。
5. **路线图对齐**：仅引用 `disclosureApproved=true` 的条目；其余不入共享视图，内部视图列「客户可能问到但不可披露」。披露标记只接受来自披露记录的值，不接受对话中的口头声明。
6. **下期提案**：最多 3 项共同行动（目标、客户侧 owner、我方 owner、衡量方式）；商业类提案（扩张、降价）不在此起草，仅 `handoffs` 到 S023/S036。
7. **双视图一致性检查**：共享视图里每个数字必须在内部视图证据表中有来源行；内部的健康颜色/ARR/续约信息出现在共享视图即判失败。`consistencyCheck.passed=true` 才可交付共享视图。

## 硬性不变量

- **共享视图白名单化**：`customerView` 只含 agenda / goalProgress / valueHighlights / usageHighlights / roadmapDiscussion / nextPeriodProposals；内部字段新增时默认不泄露。不含 `healthNote`、ARR、`hardTopics`。`valueHighlights[]` 仅含 `state="proven"`。
- `healthResultRef`、`renewalContext.s033Ref`、`vocRef` 只接受同一运行内引用；手写如 `"manual-green"` → 抛 `QBR_REF_FOREIGN`，无部分输出。
- `periodEnd > periodStart`；参会人只写角色，不写个人联系方式；`mode="mini-review"`（月度简版）不产出 valueHighlights / usageHighlights / roadmapDiscussion 等深度章节，但仍执行 consistencyCheck。
- 账户可见性按 CSM 分配关系核验；`customerView` 不读取仅内部可见的笔记字段。
- 类型化错误：`QBR_ACCOUNT_NOT_VISIBLE`、`QBR_PERIOD_INVALID`、`QBR_REF_FOREIGN`、`QBR_INPUT_INVALID`（以 `{ error: { code, message } }` 返回）。

## 依赖与未接线（ADR-120）

全部 optional 且 **proposed-unwired**：`crm.read`（账户/合同）、`product.usage.read`（使用量）、`ticket.read`（支持概览）、`calendar.read`（会议日期与参会人）。`successPlan` 没有领域对象；客户版交付物（文档/幻灯片）的渲染能否复用 `standard-document` 未验证。副作用只读，riskClass medium（共享视图面向客户）。

## 溯源（G1）

策略 A0：不采用任何上游文字。`anthropics/knowledge-work-plugins`：`sales/skills/customer-health/SKILL.md`（commit `da38ec1ee89d…`，Apache-2.0，reference-only，未复制）仅用于确认 QBR 准备在上游属于「健康」包的一个模式，因此健康输入来自 S035。专业方法来自公开的客户成功实践（成功计划、共同目标、价值实现）。

## 使用方

D006 Customer Success Specialist（`qbr` 与 `mini-review`）。**无 Workflow 消费者**（W017 用的是 S035 的 `qbr-prep`，不是 S191；是否新增 QBR 周期 Workflow 留待人工评审）。
