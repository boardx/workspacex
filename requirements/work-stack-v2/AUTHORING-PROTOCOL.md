# V2 Authoring Protocol — 320 independently authored requirements

## Why v1 is rejected
PR #4504 proved the architecture scaffold, but the entity bodies are too template-similar and omit the core composition graph. v1 MUST NOT be treated as implementation-ready.

## Non-negotiable rule
Each of the 320 entity documents is an independent authoring task:
- 1 authoring agent/task with only the entity-specific context it needs.
- 1 independent reviewer pass that sees the authored document plus its relationship edges and evidence.
- No batch template may generate the body text.
- Shared headings are allowed; shared prose paragraphs are not.

## Required precondition: graph before prose
Authoring begins only after:
1. Workflow → exact Skill composition is frozen.
2. DigitalHuman → exact Skill + Workflow composition is frozen.
3. Missing capability/Skill gaps are explicitly listed rather than silently approximated.

The two matrices in this directory are the v2 starting graph.

## Entity-specific research packet

### Skill author packet
Must include:
- exact upstream artifact(s): repo + path + SHA/tag + artifact-level license;
- at least 2 best-practice sources for A1/A2 unless the reason for single-source A0 is documented;
- role/workflow consumers from the relationship graph;
- professional method steps unique to that Skill;
- output artifact schema unique to that Skill;
- unique failure modes and domain-specific eval cases;
- CN/US differences where material.

### Workflow author packet
Must include:
- exact participating Skill IDs;
- stage-by-stage mapping: stage → Skill(s) → Tool category → state transition → side-effect class;
- trigger schema and terminal states;
- human gates and effect receipts;
- retry/idempotency/crash recovery specific to the workflow;
- actual external workflow/template references when A3 applies.

### DigitalHuman author packet
Must include:
- exact core/optional Skill IDs;
- exact Workflow IDs;
- role authority matrix: can decide / can propose / must escalate;
- collaborator/handoff graph;
- business KPI and role-specific eval journey;
- context/memory scope;
- avatar brief specific to the role;
- realtime interaction profile: voice semantics, turn policy, proactivity policy, allowed modalities, language policy and role-specific conversational evals;
- shared runtime reference to requirements/work-stack-v2/realtime-digital-human/CONTRACT.md rather than duplicated provider plumbing;
- Skill gaps that must be created rather than approximated.

## Anti-template gates
A document fails review if:
- more than 35% of non-heading prose is identical to another entity document;
- it lacks at least 3 entity-specific decisions;
- it names generic “2–6 skills” or “multiple workflows” instead of exact IDs;
- it lists only repo-level provenance when an upstream artifact is being adopted/merged;
- its eval section could be pasted unchanged into another domain;
- a DigitalHuman has no explicit skill/workflow graph;
- a realtime-enabled DigitalHuman has no role-specific realtime profile/evals or hardcodes a provider SDK as role semantics;
- a Workflow has no stage-level skill mapping;
- a Skill has no named workflow/role consumers.

## Required reviewer verdict
Each reviewer returns:
- PASS / REWRITE / SPLIT / MERGE / DELETE
- composition correctness
- professional depth
- provenance/license handling
- WorkspaceX architecture fit
- eval completeness
- unresolved questions

Only PASS can enter the v2 implementation-ready set.

## V2 definition of done
The package is done when all 320 documents:
1. are individually authored;
2. have an independent review verdict;
3. resolve all graph edges to real IDs;
4. have exact provenance where external material is relied upon;
5. have no unresolved P0/P1 capability gaps;
6. are implementable without product/architecture redesign by the engineer.
