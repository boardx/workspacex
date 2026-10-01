# V2 restructuring decisions

## Core correction
V2 is not a rewrite of the v1 template. It is a new content-authoring pass driven by a relationship graph.

## Architecture stays
The valid architecture decisions from v1 remain:
- existing Skill domain/version/source-binding/publish lifecycle is the Skill SSOT;
- Workflow generalizes the current durable LangGraph + PostgreSQL pattern;
- DigitalHuman specializes existing Agent + Agent Skill Pins;
- Context/Org Brain, HITL, sandbox, provenance and Board remain shared platform services.

## Content changes
Every entity specification must now answer “what exactly?”:
- exact methods, not generic professional-method language;
- exact outputs, not “structured artifact”;
- exact Skill/Workflow links, not “role-specific subset”;
- exact tools/categories per stage;
- exact evidence artifact and SHA;
- exact role authority and escalation;
- exact domain evals.

## Graph semantics
DigitalHuman composition has three sets:
- **coreSkills**: always mounted/available for the role;
- **conditionalSkills**: mounted or selected for specific intents/workflows;
- **workflows**: role-owned/allowed reference workflows.

Workflow composition has:
- ordered stages;
- exact Skill(s) used in each stage;
- Tool category;
- sideEffect = none/read/write/high-impact;
- humanGate = none/ask/required/multi-gate.

## Gap handling
A missing professional capability is not approximated by a vaguely related Skill. It is written into `skillGaps`. The catalog is then revised by:
- creating a new Skill;
- splitting an over-broad Skill;
- or explicitly choosing not to cover the task.

This is expected to change the current “200” list if deeper authorship proves that a different canonical set is better.

## Realtime DigitalHuman embodiment rule

Realtime interaction is a shared platform runtime, not sixty duplicated per-role implementations.

See:
- requirements/work-stack-v2/realtime-digital-human/README.md
- requirements/work-stack-v2/realtime-digital-human/CONTRACT.md
- requirements/work-stack-v2/realtime-digital-human/IMPLEMENTATION-PLAN.md
- requirements/work-stack-v2/realtime-digital-human/EVALS.md

Each DigitalHuman document authors role-specific realtime semantics (voice style, avatar brief, turn/proactivity policy, allowed modalities, memory/context scope and role-specific evals), while provider selection, media transport, ASR/TTS adapters, avatar renderer and interruption machinery remain shared runtime concerns.

The runtime MUST preserve existing Agent Skill Pins, Workflow/HITL authority, evidence and proactive-speech rules. A conversational model may request a Skill/Workflow but may not bypass Harness authorization or human gates.
