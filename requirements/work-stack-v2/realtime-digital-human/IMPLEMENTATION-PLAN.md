# Realtime Digital Human Implementation Plan

Status: phased implementation backlog  
Target branch family: Work Stack v2

## 1. Delivery strategy

Build one runtime, prove three roles, then scale to sixty configurations.

Do not create sixty implementation tickets for provider plumbing. Role authoring remains sixty independent DigitalHuman author/review jobs; runtime implementation is shared platform work.

## 2. Phase 1 — Conversational core and three-role pilot

Goal: D001, D031 and D011 can hold a natural audio conversation, be interrupted, see bounded WorkspaceX context, and delegate real Skills/Workflows without bypassing governance.

### P1.1 Contracts

Create:
- packages/contracts/src/digital-human-realtime.ts

Define:
- session create/close;
- ephemeral media ticket;
- normalized RealtimeEvent;
- ContextSnapshot;
- run delegation;
- speech interruption;
- explicit run cancellation;
- degradation state.

Acceptance:
- no provider-specific SDK types;
- strict Zod boundaries;
- session and run IDs are distinct;
- speech cancel and run cancel are distinct.

### P1.2 Domain state machines

Create:
- apps/api/src/domain/digital-human-realtime/session-state.ts
- apps/api/src/domain/digital-human-realtime/turn-state.ts
- apps/api/src/domain/digital-human-realtime/behavior.ts

Reuse:
- apps/api/src/domain/chat/proactive-speech.ts

Acceptance:
- deterministic transition tests;
- false interruption does not commit a turn;
- partial ASR cannot create a Harness request;
- proactive no-source remains silent.

### P1.3 Application ports

Create provider-neutral ports under:
- apps/api/src/application/digital-human-realtime/

Ports:
- MediaSessionPort
- TurnDetectorPort
- ConversationBrainPort
- HarnessDelegationPort
- ContextSnapshotPort
- SpeechSynthesisPort
- AvatarRendererPort

ASR:
- adapt/reuse existing AsrProviderPort;
- do not create a competing general ASR abstraction.

### P1.4 Harness bridge

Implement a bridge that resolves:
- DigitalHuman published version;
- exact Skill pins;
- exact allowed Workflows from v2 composition;
- role authority;
- side-effect class;
- HITL requirements.

Critical invariant:
Realtime model output can request an action, but only Harness can authorize/execute it.

Tests:
- request an unmounted Skill -> explicit deny;
- request disallowed Workflow -> explicit deny;
- read-only Workflow -> runs;
- required human gate -> approval event, no side effect before approval;
- interruption of speech -> run continues;
- explicit "cancel that analysis" -> run cancellation request.

### P1.5 Media transport

Recommended reference adapter:
- WebRTC via LiveKit or equivalent provider-neutral media service.

Server:
- short-lived session/ticket endpoint;
- no long-lived provider secret in browser;
- reconnect/session continuity.

Web:
- apps/web/lib/use-digital-human-session.ts
- apps/web/components/digital-human/realtime-stage.tsx
- apps/web/components/digital-human/session-status.tsx

UI states:
- connecting;
- listening;
- thinking;
- working;
- speaking;
- interrupted;
- degraded;
- error.

### P1.6 Conversation brain

Support two modes from day one:

Mode A: realtime-audio
- direct realtime multimodal model adapter;
- normalized transcripts/events;
- function/delegation bridge only.

Mode B: chained
- existing ASR;
- normal/deep agent reasoning;
- streaming TTS.

Feature flag/provider binding chooses the mode.

Acceptance:
- same D001 profile can run in either mode;
- role/Skill/Workflow facts are identical.

### P1.7 Voice output

Implement streaming speech abstraction.

Requirements:
- first-audio streaming;
- hard interrupt;
- language/voice binding;
- no provider IDs in D001/D031/D011 requirement docs.

Local candidate later: CosyVoice.

### P1.8 Avatar MVP

Implement AvatarRendererPort.

Phase-1 allowed implementations:
- hosted live avatar adapter for quickest validation; OR
- local MuseTalk proof adapter.

Required degradation:
avatar unavailable -> audio-only, not session failure.

Use the user-approved 60 avatar assets only as role identity inputs. Do not train/clone a real person's likeness without provenance/consent.

### P1.9 Workspace context MVP

Support:
- current board ID;
- selected object IDs and structured object content;
- active document/file reference;
- pointer/selection;
- explicit image attachment.

Do not start Phase 1 with continuous whole-screen capture.

D011 must prove:
User selects three sticky notes and asks "这三个里面哪个问题定义最好？"
The DigitalHuman receives the exact selected object set and cites/references those objects in its response.

### P1.10 Pilot roles

D001:
- executive brief and decision dialog;
- source-backed proactive behavior;
- W001/W004/W009/W003.

D031:
- forecast/variance/cash/board-finance tasks;
- W034/W035/W036/W039.

D011:
- facilitation/board interaction;
- W027/W028/W029/W031/W002;
- known missing Skills remain explicit gaps.

### Phase 1 exit gates

- pass all P0 scenarios in EVALS.md;
- p95 interruption-to-stop <= 250 ms in reference deployment;
- p95 simple-turn first feedback <= 800 ms in reference deployment;
- no unauthorized side effect in adversarial tests;
- three roles run from shared runtime code;
- at least one realtime-audio provider and one chained pipeline mode work;
- avatar failure degrades to audio;
- evidence/run receipts remain linked to turnId.

## 3. Phase 2 — 60-role productization

Goal: all authored DigitalHumans can use the runtime through configuration.

### P2.1 Realtime profile in DigitalHuman lifecycle

Add to DigitalHuman publish/version schema:
- realtimeProfileRef or embedded reviewed profile;
- voice semantic profile;
- avatar asset/profile;
- turn policy;
- proactivity policy;
- modalities;
- language policy.

Profile follows DigitalHuman versioning/publish rules.

No live session may mix role content from different published versions.

### P2.2 Role configuration generation is prohibited

The 60 profiles are individually authored/reviewed as part of D001-D060.

Shared schema is allowed.
Shared body prose/template generation is not.

Each profile must make role-specific choices:
- how concise/verbose;
- interrupt sensitivity;
- whether proactive prompts are appropriate;
- voice demeanor;
- avatar expression range;
- language/domain pronunciation;
- when to escalate;
- role-specific conversation evals.

### P2.3 Multi-human rooms

Add:
- participant roster;
- addressed-to detection;
- @mention/direct-name routing;
- speaker-aware turn ownership where available;
- agent cooldown;
- one-agent-at-a-time arbitration by default.

Default policy:
DigitalHumans do not all answer the same room utterance.

### P2.4 Multi-DigitalHuman handoff

Handoff is a Harness event, not avatar theater.

Example:
Executive Partner asks FP&A Analyst to verify cash-flow assumptions.

Requirements:
- handoff reason;
- source context;
- receiving role permissions;
- new run/turn linkage;
- visible identity change;
- no sharing beyond receiving role's authorized context.

### P2.5 Board/vision context

Add:
- viewport events;
- board object diff stream;
- explicit screenshot sampling;
- optional screen/camera vision;
- redaction policy.

Prefer semantic board objects over image inference whenever possible.

### P2.6 Realtime behavior authoring

Introduce reusable presentation primitives:
- attentive listen;
- think;
- explain;
- emphasize;
- caution;
- celebrate;
- handoff;
- wait-for-approval.

Role profiles choose ranges, not frame-by-frame choreography.

### P2.7 Provider matrix and fallback

Build provider binding admin/runtime policy:
- cloud premium;
- hybrid;
- on-prem.

Per provider record:
- capabilities;
- region/residency;
- cost class;
- language support;
- streaming support;
- interruption support;
- health;
- approved orgs.

### P2.8 Cost and capacity

Track per session:
- media minutes;
- ASR seconds;
- realtime-model audio/text usage;
- TTS seconds/characters;
- avatar render minutes;
- Harness model/tool usage.

Autoscaling must be separate for:
- media;
- reasoning;
- TTS;
- avatar GPU.

### Phase 2 exit gates

- all PASS DigitalHuman specs can publish a realtime profile;
- no role-specific provider code;
- at least 20 concurrent reference sessions in load test, then increase by capacity target;
- multi-human arbitration prevents response storms;
- cost/latency telemetry attributed per session and role;
- fallback/degradation visibly reported.

## 4. Phase 3 — Enterprise on-prem and embodied organization

Goal: same contract, private deployment, multi-agent realtime collaboration.

### P3.1 Self-hosted media plane

Evaluate self-hosted LiveKit or equivalent WebRTC stack.

Requirements:
- internal TURN/STUN plan;
- enterprise TLS;
- topology/capacity benchmark;
- reconnect;
- network-loss tests;
- audit-friendly session metadata.

### P3.2 Local speech stack

ASR:
- reuse AsrProviderPort;
- evaluate FunASR/Qwen ASR with real Mandarin/English/domain audio.

TTS:
- evaluate CosyVoice or approved alternative;
- streaming first-audio benchmark;
- pronunciation dictionaries;
- voice licensing.

### P3.3 Local conversation brain

Use the WorkspaceX local model router.

Recommended pattern:
- small model/detector for routing, turn utility, classification;
- stronger local model for conversational reasoning;
- Harness/deep-agent for professional execution.

Do not force all realtime work through one model.

### P3.4 Local avatar

Evaluate MuseTalk first as a practical 2D talking-face renderer.

Separate work item for:
- full-body/3D;
- WebGPU;
- XR/spatial presence.

Avatar quality is independently measured and never blocks text/audio fallback.

### P3.5 Enterprise governance

Required:
- data residency binding;
- provider allowlist;
- camera/screen policy;
- recording/retention policy;
- avatar identity consent/provenance;
- watermark/AI identity policy where required;
- audit export;
- per-role capability policy;
- redaction.

### P3.6 Realtime organization mode

Support:
- humans + multiple DigitalHumans in one room;
- role handoffs;
- meeting facilitation;
- board co-creation;
- approval requests;
- asynchronous Workflow completion that reports back into the room.

### Phase 3 exit gates

- on-prem reference deployment passes EVALS.md;
- no cloud dependency in offline mode;
- provider switch does not modify D001-D060 professional specs;
- enterprise policy can disable camera/avatar while keeping role functionality;
- multi-agent room behavior remains deterministic and non-spammy.

## 5. Recommended issue decomposition

Epic RDH-1: contracts/state
- normalized event contract
- session state machine
- turn state machine
- runtime profile contract

Epic RDH-2: media/turns
- media session adapter
- turn detector
- interruption/backchannel
- reconnect

Epic RDH-3: Harness integration
- role resolution
- Skill pin resolution
- Workflow allowlist
- HITL/effect receipt
- run cancellation

Epic RDH-4: conversation/output
- realtime-audio adapter
- chained adapter
- TTS
- acknowledgement stream

Epic RDH-5: embodiment
- behavior stream
- avatar adapter
- degradation
- avatar profile UI

Epic RDH-6: context
- board semantic context
- selection/pointer
- visual sampling
- redaction

Epic RDH-7: pilots/evals
- D001
- D031
- D011
- latency lab
- safety/authority adversarial suite

Epic RDH-8: scale/on-prem
- 60 profiles
- multi-human
- multi-DigitalHuman
- local speech
- local avatar
- capacity/cost

## 6. Implementation guardrails

1. No new unrestricted in-process tool loop.
2. No browser provider secrets.
3. No partial transcript as final intent.
4. No speech interruption == run cancellation.
5. No silent Skill approximation.
6. No provider name as a permanent DigitalHuman domain fact.
7. No avatar failure == professional run failure.
8. No visual context without explicit scope/permission.
9. No durable raw audio by default.
10. No bypass of existing publish/version/Agent Skill Pin rules.

## 7. Open decisions that do not block Phase 1 architecture

- LiveKit versus alternative WebRTC orchestration;
- hosted avatar provider for the first external demo;
- exact local TTS model;
- exact local turn detector;
- whether first public UI uses full video avatar or portrait + voice;
- final concurrency/cost SLO by plan tier.

These remain provider/deployment decisions, not reasons to fork the domain model.
