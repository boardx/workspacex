# WorkspaceX Work Skills Dataset & Open-Practice Distillation Plan

Status: research/design draft  
Source baseline: PR #4017 (645 evaluated skills) plus external workflow/skill ecosystems.

## 1. Objective

Build a **WorkspaceX-native Work Skills dataset** for upper-level agents. The dataset is not a mirror of any marketplace. It is a curated, normalized, provenance-aware corpus distilled from validated practices across open-source and source-available ecosystems in the US and China.

The raw community artifact is evidence. The WorkspaceX canonical skill is the product asset.

## 2. Two-layer model

### Layer A — Practice Evidence Registry

Stores external evidence without implying that WorkspaceX may redistribute or embed it.

Each evidence record captures:
- source project/repository/marketplace
- artifact type: skill / workflow / template / playbook / agent / integration
- upstream URL + immutable revision when available
- author / organization
- license and license confidence
- adoption evidence: installs, stars, usage claims, maintenance activity
- market/locale: US / China / global
- job family and target user
- workflow steps
- inputs / outputs
- required systems/connectors
- approval and safety pattern
- observed strengths
- observed weaknesses
- reusable practice abstractions
- legal handling class

### Layer B — WorkspaceX Canonical Work Skills

Only WorkspaceX-owned/approved capabilities consumed by upper-level agents.

A canonical skill may derive from one or many evidence records.

## 3. Transformation classes

### A0 — Direct Adopt
Use when:
- license permits commercial redistribution/modification;
- workflow fits WorkspaceX runtime with minimal adaptation;
- quality/evals meet WorkspaceX gates;
- no material product-specific assumptions remain.

Action:
- pin upstream revision;
- retain required attribution/NOTICE;
- add WorkspaceX metadata, evals, adapters and safety policy;
- upstream content remains identifiable in provenance.

### A1 — Integrate / Best-of Merge
Use when multiple open skills implement the same job with different strengths.

Action:
1. extract common workflow core;
2. compare decision points, guardrails, output contracts and edge cases;
3. choose the strongest pattern per stage;
4. remove vendor/platform duplication;
5. create one WorkspaceX canonical skill;
6. preserve all upstream contributors in provenance.

Target architecture:
- common core
- domain overlay
- locale overlay
- provider adapter

### A2 — Clean-room Rewrite
Use when the external artifact contains valuable practice but its license does not permit direct reuse, or redistribution rights are unclear.

Action:
- Evidence agent records only high-level workflow facts, task decomposition, public concepts, observed user outcomes and interoperability requirements.
- Authoring agent receives the abstract requirement/practice specification rather than protected expression.
- WorkspaceX authors a new skill from first principles.
- Store legal basis and source separation evidence.

No protected text/assets/scripts are copied.

### A3 — Cross-platform Rebuild
Use for n8n/Coze/Activepieces/Dify-style workflows whose execution representation does not map directly to WorkspaceX.

Action:
- parse workflow graph into platform-neutral steps:
  trigger → gather → transform/reason → human gate → act → verify → record
- replace platform nodes with WorkspaceX capabilities/connectors;
- preserve useful control-flow patterns;
- create native WorkspaceX skill + workflow;
- evaluate behavior rather than node-level equivalence.

### A4 — Reject / Archive
Use when:
- hard license/security/provenance gate fails;
- practice is vendor documentation rather than a reusable work skill;
- duplicate adds no unique practice;
- ICP fit is poor;
- obsolete or unverified;
- cannot be safely localized.

Keep the evidence record; exclude it from the active Work Skills catalog.

## 4. Canonical data schema

```yaml
id: wx/<domain>/<skill>
name:
version:
status: draft|experimental|verified|deprecated

job:
  family:
  user_roles: []
  intent:
  trigger_examples: []
  success_outcome:
  frequency:

agent_mounts: []
composes_with: []

contract:
  inputs: []
  outputs: []
  invariants: []
  completion_criteria: []
  failure_modes: []

workflow:
  stages: []
  human_gates: []
  verification_steps: []
  rollback_or_recovery: []

context:
  required: []
  optional: []
  memory_reads: []
  memory_writes: []

capabilities:
  required: []
  optional: []
  provider_adapters: []

policy:
  risk_class:
  read_write_scope:
  untrusted_content:
  approval_mode:
  jurisdiction:
  privacy:
  audit_events: []

localization:
  global_core:
  cn_overlay:
  us_overlay:
  other_overlays: []

provenance:
  transformation: direct|merge|clean_room|cross_platform|original
  evidence_ids: []
  upstream_revisions: []
  licenses: []
  attribution: []
  legal_review:
  transformation_notes:

quality:
  intrinsic_value:
  evidence_strength:
  implementation_readiness:
  eval_suite:
  baseline_uplift:
  reviewer_variance:
  last_verified_at:
```

## 5. Skill architecture principles

### 5.1 Skills are job capabilities, not vendor manuals
"Post a campaign across social networks" is a Work Skill.
"How to configure node X in n8n" is source evidence or a provider adapter.

### 5.2 One capability, many providers
Provider-specific differences belong in adapters:
- CRM: HubSpot / Salesforce / Feishu / domestic CRM
- social: LinkedIn / X / Instagram / Douyin / Xiaohongshu / WeChat
- docs/chat: Google / Microsoft / Feishu / DingTalk / WeCom

### 5.3 Shared core + overlays
Examples:
- contract-review core + CN commercial-law overlay + US overlay
- competitive-analysis core + sales/product/marketing perspectives
- status-update core + sales/project/legal output schemas
- profile-onboarding core + professional-domain questions

### 5.4 Workflow and skill are separate layers
A skill defines repeatable professional capability and contract.
A workflow defines trigger, sequencing, scheduling, branching and connector execution.
One skill can have several workflows.

### 5.5 Agents are compositions, not copies
Upper-level agent = role policy + context + selected canonical skills + orchestration rules.

## 6. Initial upper-agent taxonomy

1. Executive & Strategy
2. Product & Design
3. Sales & Revenue
4. Marketing & Growth
5. Customer Success & Support
6. Finance & Investing
7. Legal & Compliance
8. People & HR
9. Operations & Project
10. Data & Research
11. Engineering & IT
12. Knowledge & Productivity

Shared skills are mounted by multiple agents rather than duplicated.

## 7. Source strategy

### Tier 1 — Native/open skill ecosystems
Primary ingestion candidates:
- Anthropic knowledge-work-plugins
- other Agent Skills repositories / skills.sh discovery
- Feishu/Lark-oriented Agent Skills
- high-quality role/domain repositories

Use for task design, output contracts, professional guardrails and role-specific workflows.

### Tier 2 — Automation/workflow ecosystems
- n8n
- Activepieces
- Coze Studio/workflow ecosystem
- Dify workflow/plugin ecosystem
- similar automation libraries

Use primarily for:
- trigger patterns
- connector sequences
- approval gates
- retry/error handling
- synchronization/state patterns
- human-in-the-loop publishing/payment/write flows

Default treatment is cross-platform rebuild unless a specific artifact license and format clearly allow direct reuse.

### Tier 3 — Professional standards and public playbooks
Examples:
- official platform best-practice documentation
- public professional frameworks
- accounting/legal/HR/marketing standards and checklists where reusable

Use as authoritative references to correct community-skill weaknesses.

## 8. Research and distillation pipeline

### Stage 0 — Source registry
Continuously discover US + China sources.
Record provenance/license before content extraction.

### Stage 1 — Normalize
Map every artifact to:
- job family
- intent
- trigger
- steps
- inputs/outputs
- connectors
- human gates
- verification
- locale
- risk

### Stage 2 — Cluster
Cluster by semantic job-to-be-done, not filenames or repositories.

Detect:
- exact duplicates
- same core/different domain
- same job/different provider
- workflow stages mistakenly represented as separate skills
- broad families that must remain separate tasks

### Stage 3 — Practice extraction
For each cluster create a practice matrix:
- best discovery/input pattern
- best reasoning/decomposition
- best professional rule
- best human gate
- best failure handling
- best output contract
- best verification
- best localization pattern

### Stage 4 — Transformation decision
Assign A0–A4.

### Stage 5 — Canonical authoring
Create WorkspaceX-native SKILL.md plus references/scripts/assets as necessary.

### Stage 6 — Eval
At minimum:
- golden happy path
- missing-data / absent-is-not-zero
- prompt-injection/untrusted-content
- permission denial
- wrong-locale/jurisdiction
- provider unavailable/fallback
- output schema validation
- skill-vs-no-skill baseline

### Stage 7 — Agent assembly
Mount canonical skills into role agents.
Evaluate end-to-end role journeys rather than isolated skill quality only.

### Stage 8 — Production feedback
Track:
- activation frequency
- task completion
- user edits/rejections
- human approval reversals
- eval regression
- connector failures
- upstream drift
- overlap between skills

Use evidence to split/merge/deprecate skills.

## 9. Batches

### Batch 1 — Consolidate PR #4017
Input: 645 evaluated records.
Deliver:
- per-source action: keep/improve/merge/drop
- canonical clusters
- upper-agent mapping
- improvement tags

Current analysis branch contains a first non-destructive pass.

### Batch 2 — US/global workflow practices
Ingest high-signal workflow/template sources from n8n, Activepieces and Agent Skills directories.
Focus:
- social media
- sales ops
- customer service
- finance operations
- scheduled reporting
- research/content pipelines

### Batch 3 — China-local work practices
Focus:
- Feishu/Lark
- WeCom
- DingTalk
- Douyin
- Xiaohongshu
- WeChat Official Accounts
- domestic approval/document/CRM patterns
- Coze ecosystem

### Batch 4 — Professional-depth correction
For each agent, compare community skills against authoritative professional standards and rewrite shallow skills.

### Batch 5 — Canonical V1
Freeze first production set and attach eval suites.

## 10. Acceptance gates for a WorkspaceX Work Skill

A canonical skill cannot become `verified` unless:

1. Provenance known.
2. Legal handling class recorded.
3. Job-to-be-done is distinct.
4. Inputs and output contract are explicit.
5. Required vs optional capabilities are separated.
6. Human-write/financial/legal/identity gates are explicit.
7. Untrusted-content handling is explicit where applicable.
8. Locale/jurisdiction behavior is explicit.
9. Verification exists.
10. At least one baseline comparison shows measurable benefit.
11. It can be mounted by an agent without importing vendor-specific policy into the core.

## 11. Repository layout proposal

```
work-skills/
  registry/
    sources.json
    evidence/
  canonical/
    shared/
    executive/
    product/
    sales/
    marketing/
    support/
    finance/
    legal/
    hr/
    operations/
    data/
    engineering/
  overlays/
    cn/
    us/
    industries/
  adapters/
    providers/
  evals/
  provenance/
```

## 12. Immediate action plan

### P0 — Foundation
- approve canonical schema and A0–A4 transformation policy
- establish license/provenance gate
- separate evidence registry from distributable canonical content
- implement required vs optional capability semantics

### P1 — Complete 645-item consolidation
- manually adjudicate high-impact merge clusters
- create canonical skill specs for top shared capabilities
- convert `improve` tags into concrete rewrite issues
- remove A4 items from active agent catalog

### P2 — Expand sources
- import marketplace metadata and selected artifacts from global/China ecosystems
- prioritize artifacts with adoption/maintenance evidence
- never equate popularity with professional correctness

### P3 — Author canonical skills
Priority shared skills:
1. profile-onboarding
2. profile-customization
3. enterprise-search
4. meeting-prep
5. status-update
6. competitive-analysis
7. risk-assessment
8. response-drafting

Then build role-specific cores:
- sales customer intelligence / account planning / outreach / pipeline review
- marketing content / brand / social distribution / SEO
- finance close / reconciliation / modeling / reporting
- legal contract / regulatory / matter workflows
- product discovery / research synthesis / prioritization
- HR recruiting / onboarding / performance
- ops process / project / reporting

### P4 — Agent validation
Construct 12 upper-agent prototypes and run realistic multi-skill journeys.

### P5 — Continuous distillation
Set a recurring upstream scan. New external artifacts first enter Evidence Registry; only reviewed transformations can enter Canonical Work Skills.

## 13. Principle

WorkspaceX should not compete by having the largest number of skills.

It should compete by having the **smallest coherent set of high-quality work capabilities that encode the best validated practices, adapt to each organization, compose cleanly into agents, and improve through evidence**.
