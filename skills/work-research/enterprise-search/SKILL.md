---
name: enterprise-search
version: 1.0.1
capability_id: WX-WORK-S003
metadata:
  work:
    stableId: S003
    domain: Research
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - knowledge.search
        - mail.search
        - project.read
      optional: []
    provenance:
      - repo: anthropics/knowledge-work-plugins
        path: enterprise-search/skills/search-strategy/SKILL.md
        commit: da38ec1ee89d41e5380e652a97382695003396e7
        license: Apache-2.0
        strategy: adapt
        copied: false
      - repo: onyx-dot-app/onyx
        path: backend/onyx/context/search/enums.py
        commit: 9ec4da4b0beb9946dd333d2b7390953d9aa89d6c
        license: MIT
        strategy: reference-only
        copied: false
    locales:
      - zh-CN
      - en-US
    jurisdictions:
      - CN
      - US
    evalSuiteId: S003
    inputSchema:
      type: object
      properties:
        question:
          type: string
          minLength: 1
        mode:
          type: string
          enum:
            - evidence
            - dedupe
        queryType:
          type: string
          enum:
            - decision
            - status
            - locate
            - who-knows
            - policy
            - timeline
            - exists
        projectIds:
          type: array
          items:
            type: string
        scopes:
          type: array
          items:
            type: string
            enum:
              - current-files
              - organization-index
              - organization-hybrid
        timeWindow:
          type: object
          properties:
            from:
              type: string
              format: date-time
            to:
              type: string
              format: date-time
          additionalProperties: false
        researchPlanItemRef:
          type: string
        maxHitsPerItem:
          type: integer
          minimum: 1
          maximum: 10
      required:
        - question
        - mode
      additionalProperties: false
      $schema: http://json-schema.org/draft-07/schema#
    outputSchema:
      type: object
      properties:
        question:
          type: string
        queryType:
          type: string
          enum:
            - decision
            - status
            - locate
            - who-knows
            - policy
            - timeline
            - exists
        queryTypeInferred:
          type: boolean
        scopeDeclared:
          type: object
          properties:
            scopes:
              type: array
              items:
                type: string
                enum:
                  - current-files
                  - organization-index
                  - organization-hybrid
            projectIds:
              type: array
              items:
                type: string
            declaredAt:
              type: string
              format: date-time
          required:
            - scopes
            - projectIds
            - declaredAt
          additionalProperties: false
        items:
          type: array
          items:
            type: object
            properties:
              itemId:
                type: string
              claimToVerify:
                type: string
              queriesRun:
                type: array
                items:
                  type: object
                  properties:
                    scope:
                      type: string
                      enum:
                        - current-files
                        - organization-index
                        - organization-hybrid
                    query:
                      type: string
                    variantOf:
                      type: string
                    hitCount:
                      type: integer
                      minimum: 0
                    status:
                      type: string
                      enum:
                        - ok
                        - denied
                        - unavailable
                        - not-configured
                  required:
                    - scope
                    - query
                    - hitCount
                    - status
                  additionalProperties: false
              status:
                type: string
                enum:
                  - answered
                  - conflicting
                  - not-found-in-scope
                  - blocked
              hits:
                type: array
                items:
                  type: object
                  properties:
                    hitId:
                      type: string
                    sourceId:
                      type: string
                    versionId:
                      type: string
                    citationAnchor:
                      type: string
                    accessibleAt:
                      type: string
                      format: date-time
                    sourceTimestamp:
                      type: string
                      format: date-time
                    relation:
                      type: string
                      enum:
                        - supports
                        - contradicts
                        - mentions-only
                        - superseded
                    supersededBy:
                      type: string
                    excerpt:
                      type: string
                      maxLength: 400
                    owner:
                      type: string
                  required:
                    - hitId
                    - sourceId
                    - versionId
                    - citationAnchor
                    - accessibleAt
                    - relation
                    - excerpt
                  additionalProperties: false
            required:
              - itemId
              - claimToVerify
              - queriesRun
              - status
              - hits
            additionalProperties: false
          maxItems: 6
        duplicateOf:
          type: array
          items:
            type: object
            properties:
              sourceId:
                type: string
              versionId:
                type: string
              similarityReason:
                type: string
            required:
              - sourceId
              - versionId
              - similarityReason
            additionalProperties: false
        coverageGaps:
          type: array
          items:
            type: object
            properties:
              itemId:
                type: string
              reason:
                type: string
                enum:
                  - permission-denied
                  - retrieval-unavailable
                  - scope-not-indexed
                  - hybrid-not-configured
                  - none-in-scope
              suggestion:
                type: string
            required:
              - itemId
              - reason
              - suggestion
            additionalProperties: false
        injectionFlags:
          type: array
          items:
            type: object
            properties:
              hitId:
                type: string
              note:
                type: string
            required:
              - hitId
              - note
            additionalProperties: false
      required:
        - question
        - queryType
        - queryTypeInferred
        - scopeDeclared
        - items
        - coverageGaps
        - injectionFlags
      additionalProperties: false
      $schema: http://json-schema.org/draft-07/schema#
      allOf:
        - if:
            properties:
              queryType:
                const: who-knows
            required:
              - queryType
          then:
            properties:
              items:
                items:
                  properties:
                    hits:
                      items:
                        required:
                          - owner
---

# 企业内部检索（S003）

> Work Skill · v2 实体编号 S003 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S003-enterprise-search.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

「我们内部到底有没有、在哪、谁说的、现在还算不算数」——在调用方当前有权读取的组织资料里，把一个自然语言问题变成一组有范围声明的检索，返回可逐条核验的命中账本与覆盖声明（查了哪里、没查哪里、为什么没查）。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（frontmatter `metadata.work` 的机器 schema 由 `apps/api/src/application/work-eval/s003-contract.ts` 生成，运行 `apps/api/scripts/generate-s003-machine-contract.ts` 更新，禁止手工修改）：
- 输入契约：`requirements/work-stack-v2/skills/S003-enterprise-search.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S003-enterprise-search.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、knowledge.search、mail.search、project.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`enterprise-search/skills/search-strategy/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `onyx-dot-app/onyx`（`backend/onyx/context/search/enums.py`，commit `9ec4da4b0beb…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S003 的行；本文件不复述矩阵。
