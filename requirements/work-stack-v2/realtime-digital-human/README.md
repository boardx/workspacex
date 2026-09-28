# WorkspaceX Realtime Digital Human Solution

Status: architecture/requirements package for Work Stack v2  
Scope: all 60 DigitalHumans (D001-D060)  
Principle: one shared realtime runtime, sixty authored role configurations

## 1. Decision

WorkspaceX SHALL NOT implement sixty independent "talking avatar" systems.

The 60 DigitalHumans are role configurations on top of one shared Realtime Digital Human Runtime. A role contributes identity, authority, Skills, Workflows, voice/avatar presentation, turn-taking policy, memory scope, and role-specific evals. Media transport, realtime session state, interruption handling, tool execution, evidence, security, and provider adapters remain shared platform capabilities.

The runtime is an embodiment layer over the existing Agent/Harness architecture, not a second agent platform.

A DigitalHuman is therefore:

DigitalHuman = Agent identity + authored role policy + exact Skill pins + exact Workflow permissions + memory/context scope + realtime conversation policy + embodiment profile

The avatar is presentation. The role remains the Agent/DigitalHuman entity. The role never gains authority merely because it can speak.

## 2. Why this fits the existing repository

This design reuses existing WorkspaceX seams rather than replacing them:

- Shared realtime ASR is already designed around ConfiguredRealtimeAsrProvider and AsrProviderPort:
  - docs/superpowers/plans/2026-08-13-unify-personal-chat-realtime-asr.md
- Proactive speaking already has a domain rule that distinguishes source-backed speech from "no source":
  - apps/api/src/domain/chat/proactive-speech.ts
- Agent-to-Skill version binding already exists:
  - packages/contracts/src/agent-skill-pins.ts
- Skill progressive disclosure already exists for normal and deep-agent runs:
  - apps/api/src/application/agent-run/skill-catalog.ts
- Work Stack v2 already defines exact DigitalHuman -> Workflow -> Skill composition:
  - requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md
  - requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md

The new runtime SHALL compose these seams. It SHALL NOT create a provider-specific duplicate of Skill mounting, tool calling, memory, HITL, or authorization.

## 3. User experience target

A user should be able to enter a WorkspaceX room and speak to a DigitalHuman as naturally as speaking to a colleague.

Required interaction behaviors:

1. User can start speaking without pressing "send".
2. DigitalHuman detects that the user has actually finished a turn, not merely paused.
3. DigitalHuman can produce a short acknowledgement before a long Workflow completes.
4. User can interrupt the DigitalHuman while it is speaking.
5. False interruptions and short backchannels such as "嗯", "对", "right" should not unnecessarily destroy a turn.
6. DigitalHuman can see authorized WorkspaceX context: selected board objects, active document, current viewport, pointers, shared images/screens, and current room participants.
7. DigitalHuman can call its exact mounted Skills and allowed Workflows.
8. DigitalHuman can propose or execute actions only within its existing authority and human-gate policy.
9. Long-running work streams progress without leaving the realtime session.
10. Conversation, tool receipts, approvals, and evidence remain auditable.
11. The same role can run in cloud, hybrid, or on-prem mode without changing its professional specification.

## 4. Reference architecture

User microphone/camera/screen
        |
        v
Realtime Media Plane
WebRTC preferred for cloud/hybrid; provider-neutral session boundary
        |
        +---------------------------+
        |                           |
        v                           v
Turn + Audio Runtime          Visual Context Runtime
VAD / endpointing             Board selection
barge-in / backchannel        viewport / pointer
noise / echo controls         document / image / screen
        |                           |
        +-------------+-------------+
                      v
             Conversation Brain
      fast acknowledgement / dialog state
      speech-to-speech OR chained pipeline
                      |
          intent / task delegation
                      v
               WorkspaceX Harness
     DigitalHuman role + Agent Skill Pins
        Skills / Workflows / MCP / tools
      permissions / HITL / memory / evidence
                      |
            structured response stream
                      |
          +-----------+-----------+
          |                       |
          v                       v
     Speech output          Behavior stream
                           expression / gaze
                           gesture / state
          |                       |
          +-----------+-----------+
                      v
                Avatar Renderer
          SaaS OR self-hosted/local
                      |
                      v
                realtime user

## 5. Two-brain execution model

### 5.1 Conversation Brain

Purpose: preserve human conversational rhythm.

Responsibilities:
- turn detection and endpointing;
- interruption/barge-in;
- lightweight clarification;
- acknowledgement/backchannel;
- short factual responses when no deep execution is required;
- generation of speech prosody/behavior hints;
- routing into the Harness.

The Conversation Brain MUST NOT bypass WorkspaceX tool authorization. It can decide to request work; it cannot directly perform a protected side effect.

### 5.2 Deep Execution Brain

Purpose: perform professional work.

Responsibilities:
- resolve DigitalHuman role and exact Skill pins;
- select allowed Workflow;
- run Skill/Workflow logic;
- access authorized context and tools;
- enforce human gates;
- persist evidence and effect receipts;
- return structured progress and result events.

This maps directly to Work Stack v2. The realtime layer does not replace W001-W060 or S001-S200; it makes them conversationally accessible.

## 6. Shared runtime versus per-role configuration

### Shared runtime owns

- realtime media session;
- transport and reconnect;
- VAD/turn detection;
- interruption/backchannel classification;
- ASR/STT adapter;
- realtime-model adapter;
- TTS adapter;
- avatar renderer adapter;
- behavior stream;
- context capture and redaction;
- transcript/event journal;
- tool delegation bridge;
- latency metrics;
- provider health/fallback;
- session security.

### Each DigitalHuman owns

- role identity;
- professional scope;
- coreSkills;
- conditionalSkills;
- workflows;
- can-decide / can-propose / must-escalate matrix;
- collaborator/handoff graph;
- memory scope;
- realtime voice profile;
- avatar profile;
- communication style;
- proactivity policy;
- language policy;
- role-specific realtime evals.

Provider names MUST NOT be authored into D001-D060 as role facts. Provider selection is deployment/runtime policy.

## 7. Realtime modalities

Each role can declare allowed modalities independently:

- text;
- audio input;
- audio output;
- avatar video;
- camera vision;
- screen vision;
- board vision/context;
- document context;
- pointer/selection context.

The default enterprise-safe role can be audio + WorkspaceX context without camera vision.

## 8. Transport strategy

### Cloud / hybrid

Prefer WebRTC for human-facing realtime audio/video because it provides low-latency bidirectional media, congestion handling, jitter buffering, NAT traversal, and browser support.

Recommended architecture candidate: LiveKit as a provider-neutral realtime room/session layer. It is not a hard dependency of the DigitalHuman domain contract.

### Existing ASR path

Do not discard ConfiguredRealtimeAsrProvider. The chained pipeline mode should reuse AsrProviderPort so Chat, recording, and DigitalHuman sessions do not grow separate ASR abstractions.

### Direct speech-to-speech path

The runtime may also use a realtime multimodal model through a ConversationBrainAdapter. OpenAI Realtime is a candidate for cloud mode because it supports direct audio sessions, WebRTC and realtime tool-oriented interaction.

The direct-audio path MUST still emit normalized WorkspaceX turn/transcript events needed for audit, memory, evaluation, and tool attribution.

## 9. Provider strategy

The domain contract is provider-neutral.

Candidate adapters, not architectural dependencies:

| Capability | Cloud candidate | Self-host/local candidate | WorkspaceX rule |
|---|---|---|---|
| Realtime room/media | LiveKit | self-hosted LiveKit or equivalent WebRTC SFU | hidden behind media-session port |
| Conversation brain | OpenAI Realtime or other realtime model | local chained pipeline | no direct protected side effects |
| STT/ASR | existing configured provider | FunASR/Qwen ASR candidate | reuse AsrProviderPort |
| TTS | configured cloud TTS | CosyVoice candidate | streaming chunks required |
| Avatar | hosted realtime avatar provider | MuseTalk candidate | hidden behind renderer port |
| Turn detection | realtime-model/server detector or LiveKit | local detector/VAD | normalized turn events |

Open-source/vendor adoption requires a separate implementation-time provenance check, pinned release/SHA, license review, model-weight license review, benchmark, and security review.

## 10. Avatar and behavior model

The avatar renderer MUST NOT infer role authority from animation.

The model output is split into two channels:

SpeechOutput:
- audio or text-to-speech chunks;
- sentence/phrase boundaries;
- speaking state;
- interruption marker.

BehaviorOutput:
- interactionState: idle | listening | thinking | speaking | interrupted;
- affect: neutral, warm, analytical, concerned, confident, etc.;
- gaze target;
- head gesture;
- facial expression hint;
- gesture hint;
- intensity;
- start/end timing.

BehaviorOutput is advisory presentation data. Business decisions remain in Harness events.

This separation allows WorkspaceX to switch from a hosted avatar to MuseTalk, 3D/WebGPU, XR, or a no-avatar audio UI without changing the role.

## 11. Workspace context contract

Realtime DigitalHumans must "see" WorkspaceX semantically before they see raw pixels.

Preferred context order:

1. structured board selection and object data;
2. current file/document metadata and authorized content;
3. viewport and pointer references;
4. explicit user-shared image;
5. sampled screen/camera frames when authorized.

Do not continuously send the whole screen merely because a video model accepts frames.

A normalized ContextSnapshot should include:

- orgId/workspace/project/room scope;
- activeBoardId;
- selectedObjectIds;
- activeFileId;
- activePanel/surface;
- viewport summary;
- pointer/selection references;
- participant IDs/roles;
- optional sampled visual references;
- redaction flags;
- capturedAt;
- provenance/evidence reference.

## 12. Tool and Workflow boundary

Realtime conversation can request execution but SHALL NOT become a hidden tool loop.

Execution flow:

User speech
-> normalized user turn
-> DigitalHuman intent decision
-> allowed Workflow/Skill resolution
-> Harness run
-> human gate if required
-> tool effect
-> effect receipt/evidence
-> structured result
-> conversational rendering

For sideEffect = write or high-impact, existing Workflow/HITL requirements win even if the user is speaking naturally.

Interruption of spoken output does not automatically cancel an already-authorized external side effect. Speech cancellation and run cancellation are separate commands.

## 13. Proactive speech rule

Reuse the existing proactive-speech principle:

- agent opted out -> do not proactively speak;
- no usable source/evidence -> do not proactively speak;
- an @mention/direct address follows the normal addressed-turn path;
- proactive speech must identify the triggering context/event;
- each role can further narrow proactive behavior.

In multi-human rooms, DigitalHumans should be quiet by default unless directly addressed, explicitly invited, or a source-backed policy trigger is satisfied.

## 14. Memory model

Realtime conversation creates high-frequency ephemeral state. It must not all become durable memory.

Scopes:

- acoustic buffer: milliseconds/seconds, never durable by default;
- current turn: until turn settlement;
- session conversational state: room/session lifetime;
- task/run state: Workflow lifetime;
- project/org memory: only through existing memory/context governance;
- role memory: references shared memory, never owns a secret parallel store.

A role spec defines what it MAY read/write, not a separate storage implementation.

## 15. Cloud, hybrid, on-prem

### Cloud Premium

- browser WebRTC;
- cloud realtime conversation model;
- cloud or hosted avatar;
- WorkspaceX Harness remains source of execution authority.

Goal: best naturalness and shortest path to product validation.

### Hybrid

- browser WebRTC;
- mix of cloud realtime brain and local/private Skills/data;
- configurable TTS/avatar;
- sensitive context stays in WorkspaceX policy boundary.

Goal: main WorkspaceX enterprise mode.

### On-prem

- self-hosted realtime room/media;
- local ASR;
- local small/medium LLM routing;
- local streaming TTS;
- local avatar renderer;
- same DigitalHuman domain schema and Harness APIs.

Goal: enterprise offline/private deployment. Quality must be measured independently; "local" is not allowed to silently lower required authorization/evidence standards.

## 16. Initial three-role pilot

Do not start by tuning all 60 avatars. Validate the runtime on three deliberately different roles.

### D001 Executive / Strategy Partner

Workflows: W001, W004, W009, W003  
Skills: S195, S008, S063, S012, S013, S020, S199, S198, S010, S196, S197, S007

Validates:
- concise executive dialog;
- source-backed proactive participation;
- decision-to-execution handoff;
- high interruption frequency;
- board/document context.

### D031 FP&A Analyst

Workflows: W034, W035, W036, W039  
Skills: S079, S080, S085, S081, S102, S020

Validates:
- data-heavy tool calls;
- long-running analysis with immediate acknowledgement;
- numbers spoken and rendered consistently;
- write/high-impact boundaries;
- evidence-linked answers.

### D011 Design Thinking Expert

Workflows: W027, W028, W029, W031, W002  
Skills: S062, S009, S064, S065, S066, S071, S063, S075, S018  
Known gaps: Persona/Journey facilitation; HMW framing; Prototype planning

Validates:
- facilitation and multi-human turn-taking;
- board selection/pointer context;
- proactive prompts without dominating the room;
- visible creation of workshop artifacts;
- gap discipline: missing Skills are not faked.

## 17. External technology evidence reviewed for this architecture

Verified 2026-09-28:

- OpenAI Realtime API: https://developers.openai.com/api/docs/guides/realtime
- LiveKit Agents: https://docs.livekit.io/agents/
- LiveKit turn handling: https://docs.livekit.io/reference/agents/turn-handling-options/
- FunASR: https://github.com/modelscope/FunASR
- CosyVoice: https://github.com/FunAudioLLM/CosyVoice
- MuseTalk: https://github.com/TMElyralab/MuseTalk
- HeyGen LiveAvatar creation reference: https://help.heygen.com/en/articles/9612935-liveavatar-custom-liveavatar-creation-guide

These links justify feasibility and adapter evaluation only. They are not yet pinned implementation provenance.

## 18. Non-goals

This package does not:
- choose a permanent single avatar vendor;
- replace the existing Chat or recording ASR contracts;
- grant Skills or Workflows that are absent from the v2 graph;
- auto-resolve the 113 discovered Skill gaps;
- make all conversation audio durable;
- let the avatar renderer call business tools;
- treat a lifelike avatar as evidence of correctness;
- make sixty per-role runtime forks.

## 19. Definition of done for the runtime layer

The shared runtime is implementation-ready when:

1. CONTRACT.md is accepted as the provider-neutral contract.
2. IMPLEMENTATION-PLAN.md tasks map to owned repository boundaries.
3. EVALS.md has executable acceptance scenarios.
4. D001, D031 and D011 pass the pilot gates.
5. No protected tool side effect can be triggered outside Harness/HITL.
6. Interrupting speech is distinct from cancelling an execution run.
7. Existing ASR and Agent Skill Pin behavior remains backward compatible.
8. Every DigitalHuman can reference the shared runtime without duplicating provider logic.
9. Cloud and local adapters can be swapped without changing role composition.
10. A role's realtime behavior is independently reviewable in its authored DigitalHuman document.
