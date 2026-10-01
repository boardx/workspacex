# Realtime Digital Human Runtime Contract

Status: proposed shared contract for Work Stack v2  
Applies to: D001-D060

## 1. Contract goals

The contract normalizes realtime conversation, role resolution, WorkspaceX context, Harness delegation, and embodiment so provider-specific SDKs do not leak into DigitalHuman requirements.

Normative words SHALL, MUST, SHOULD, MAY have their usual requirements meaning.

## 2. Core identifiers

A realtime session MUST be attributable to:

- sessionId
- orgId
- actorUserId
- roomId or conversationId
- digitalHumanId
- digitalHumanPublishedVersionId
- policyRevision
- providerBindingRevision
- startedAt

If a role is unpublished or its pinned Skills cannot be resolved, a realtime session MUST fail closed rather than silently substituting a different role/Skill version.

## 3. DigitalHuman realtime profile

Each authored DigitalHuman MAY enable realtime interaction through a role-specific profile.

Required semantic shape:

    RealtimeDigitalHumanProfile {
      digitalHumanId
      modalities
      voiceProfile
      avatarProfile
      turnPolicy
      proactivityPolicy
      languagePolicy
      contextPolicy
      memoryPolicy
      presentationPolicy
    }

### voiceProfile

Role-owned semantics:
- speaking style;
- pace range;
- tone;
- pronunciation dictionary references;
- allowed languages;
- non-verbal cue policy.

Deployment-owned details:
- TTS provider;
- provider voice ID;
- model name;
- region;
- codec.

### avatarProfile

Role-owned semantics:
- portrait/identity asset reference;
- professional wardrobe/background brief;
- expression range;
- gesture intensity;
- accessibility fallback;
- AI-generated identity/consent metadata.

Deployment-owned details:
- renderer provider;
- renderer model;
- WebRTC room details;
- GPU class.

### turnPolicy

- mayInterruptUser: default false;
- userMayInterrupt: default true;
- proactiveSpeech: inherited from proactivity policy;
- maxContinuousSpeechMs;
- acknowledgementPolicy;
- silenceTimeout;
- clarificationThreshold.

## 4. Session state machine

Allowed session states:

- idle
- connecting
- listening
- committing_turn
- thinking
- tool_waiting
- speaking
- reconnecting
- ending
- closed
- failed

Important transitions:

idle -> connecting -> listening

listening -> committing_turn -> thinking

thinking -> speaking
thinking -> tool_waiting
tool_waiting -> speaking
speaking -> listening

speaking -> interrupted -> listening is represented as a speech interruption event plus transition to listening; interrupted does not become a durable top-level session state.

Any active state -> reconnecting -> previous recoverable state

Any active state -> ending -> closed

Any state -> failed only for non-recoverable session failure.

## 5. Turn state machine

A user turn is not the same as a transcript chunk.

Turn states:

- capturing
- candidate_end
- committed
- acknowledged
- delegated
- resolving
- responding
- completed
- cancelled
- failed

Rules:

1. Partial ASR text MUST NOT be treated as committed user intent.
2. A committed turn receives one stable turnId.
3. Barge-in can create a new turn while agent speech is active.
4. A false interruption can be discarded without creating a committed turn.
5. A user instruction to cancel a run MUST be explicit and routed to the run controller; mere audio interruption cancels only current speech output.
6. Tool execution events reference both turnId and runId when delegation occurs.

## 6. Normalized event envelope

All realtime events use a shared envelope:

    RealtimeEvent {
      eventId
      sessionId
      sequence
      at
      type
      actor
      turnId?
      runId?
      payload
      evidenceRef?
    }

sequence MUST be monotonic per session.

Recommended event families:

Media:
- media.connected
- media.disconnected
- media.reconnecting

User:
- user.speech.started
- user.speech.partial
- user.speech.committed
- user.interruption.candidate
- user.interruption.confirmed
- user.interruption.false

Agent:
- agent.ack.started
- agent.thinking
- agent.speech.started
- agent.speech.chunk
- agent.speech.interrupted
- agent.speech.completed

Harness:
- run.requested
- run.started
- run.progress
- approval.requested
- approval.resolved
- tool.effect.receipt
- run.completed
- run.failed
- run.cancelled

Context:
- context.snapshot
- context.selection.changed
- context.visual.sampled

Avatar:
- avatar.state
- avatar.behavior
- avatar.degraded

## 7. MediaSessionPort

Responsibilities:
- issue/validate ephemeral media session credentials;
- connect/disconnect/reconnect;
- inbound audio frames;
- optional inbound camera/screen tracks;
- outbound audio/video tracks;
- network quality events.

The browser MUST NOT receive long-lived upstream AI/provider credentials.

The media port MUST NOT know Skill IDs or Workflow semantics.

## 8. TurnDetectorPort

Input:
- audio activity;
- optional transcript/alignment;
- optional realtime-model turn signal.

Output:
- speechStarted;
- candidateEnd;
- committedEnd;
- interruptionCandidate;
- interruptionConfirmed;
- falseInterruption.

The adapter may use semantic turn detection, VAD, acoustic detection, or a provider-native detector, but emits the same normalized events.

## 9. SpeechRecognitionPort

Chained mode MUST adapt the existing AsrProviderPort rather than creating a second general-purpose ASR domain.

Normalized outputs:
- partial transcript;
- final transcript;
- provider event identity when available;
- language if confidently known;
- explicit warnings when timing/speaker/confidence are unavailable.

No component may invent word timing, speaker identity, or calibrated confidence.

## 10. ConversationBrainPort

Two modes are valid:

### realtime-audio

Input:
- audio/turn stream;
- role prompt/policy;
- authorized context summaries;
- callable delegation functions.

Output:
- normalized response tokens/audio;
- transcript;
- intent/delegation request;
- behavior hints.

### chained

Input:
- committed transcript;
- role/context;
- Skill/Workflow catalog summary.

Output:
- response text;
- delegation request;
- optional behavior hints.

The port MUST NOT expose provider SDK objects to the domain.

## 11. HarnessDelegationPort

A realtime brain never receives unrestricted business tools.

Allowed requests:
- answer-without-run;
- request-skill;
- request-workflow;
- request-context;
- request-clarification;
- request-handoff;
- request-run-cancel.

HarnessDelegationPort resolves:
- DigitalHuman published version;
- Agent Skill Pins;
- exact allowed Workflow IDs;
- role authority;
- organization policy;
- human gates;
- side-effect class.

A request for a Skill or Workflow not mounted/allowed MUST fail visibly.

## 12. ContextSnapshotPort

Context must be explicit and scoped.

Snapshot fields SHOULD include:

    {
      scope: { orgId, projectId?, roomId?, boardId? },
      surface,
      activeFileId?,
      selectedObjectIds[],
      viewport?,
      pointerRefs[],
      participantRefs[],
      visualRefs[],
      redactions[],
      capturedAt,
      sourceRefs[]
    }

Rules:
- structured data before screenshot;
- minimum necessary context;
- explicit visual sampling;
- permission checked at capture and at use;
- source references survive into evidence when the answer relies on them.

## 13. BehaviorStreamPort

Behavior stream is presentation-only.

Shape:

    {
      state,
      affect?,
      gazeTarget?,
      headGesture?,
      facialExpression?,
      gesture?,
      intensity?,
      startsAtOffsetMs?,
      durationMs?
    }

Renderer MUST degrade gracefully:
- full avatar -> talking portrait -> audio-only -> text-only.

A renderer failure MUST NOT fail an otherwise valid Harness run.

## 14. AvatarRendererPort

Required operations:
- prepare identity;
- open session;
- accept audio/speech chunks;
- accept behavior events;
- interrupt current speech/animation;
- close session;
- report renderer health.

The renderer MUST NOT receive direct credentials to WorkspaceX data stores or business tools.

## 15. SpeechSynthesisPort

Required for chained mode.

Properties:
- streaming first-audio support;
- interrupt/cancel;
- pronunciation hints;
- language selection;
- chunk timing metadata when available.

Role voice semantics are resolved to provider voice bindings by deployment policy.

## 16. Proactive speech contract

The existing domain decision in apps/api/src/domain/chat/proactive-speech.ts remains authoritative for the base opt-in/source check.

Realtime adds:

    ProactiveSpeechTrigger {
      triggerId
      sourceRef
      reason
      roomState
      addressedToAgent
      urgency
    }

Before speaking proactively:
1. check role opt-in;
2. check usable source;
3. check room policy;
4. check cooldown/noise policy;
5. produce an explainable trigger reference.

No-source is a normal "do not speak" result.

## 17. Acknowledgement versus answer

For long-running Workflows, the Conversation Brain SHOULD acknowledge immediately without fabricating the final result.

Valid:
- "我先核对预算和现金流数据。"
- "我先把这三个白板对象读一下。"

Invalid:
- claiming a conclusion before the Workflow has produced evidence;
- narrating hidden chain-of-thought;
- inventing progress percentages.

Acknowledgement is its own event and not the Workflow result.

## 18. Interruption semantics

User interruption has four separate effects:

1. stop current TTS/audio playback;
2. stop current avatar speaking animation;
3. open a new user-turn capture;
4. optionally request run cancellation only if the user actually gives a cancel instruction.

This prevents a normal conversational interruption from corrupting a long-running authorized task.

Target: confirmed interruption to audible stop SHOULD be <= 250 ms p95 in the reference cloud deployment, measured from local detector confirmation, excluding hardware playback buffering outside WorkspaceX control.

## 19. Latency budget

Reference target, to be validated per deployment:

- speech-start detection event: <= 100 ms p95 after detector threshold;
- simple committed-turn to first audible agent feedback: <= 800 ms p95;
- confirmed interruption to agent-audio stop: <= 250 ms p95;
- long task acknowledgement: <= 700 ms p95 after committed turn;
- avatar audio-to-lip drift: <= 150 ms p95 where renderer exposes timing;
- reconnect without losing settled transcript/run identity: <= 3 s p95 on recoverable network loss.

These are product targets, not claims about any vendor.

## 20. Data retention and privacy

Default policy:
- raw acoustic buffers are ephemeral;
- committed transcript is retained only according to conversation policy;
- camera/screen frames are not durable by default;
- sampled visual context records references/provenance, not an unrestricted video archive;
- recording/retention consent is distinct from using a microphone for a live session;
- avatar identity assets require provenance/consent metadata;
- secrets never enter transcript or avatar behavior payloads.

## 21. Failure handling

Provider failures are normalized:

- MEDIA_UNAVAILABLE
- TURN_DETECTION_UNAVAILABLE
- ASR_UNAVAILABLE
- BRAIN_UNAVAILABLE
- TTS_UNAVAILABLE
- AVATAR_UNAVAILABLE
- CONTEXT_UNAVAILABLE
- ROLE_NOT_PUBLISHED
- SKILL_VERSION_NOT_FOUND
- WORKFLOW_NOT_ALLOWED
- POLICY_DENIED
- APPROVAL_REQUIRED
- RUN_FAILED

Fallback rules:
- avatar failure -> audio/text degradation allowed;
- TTS failure -> text fallback allowed if policy permits;
- ASR failure -> text input fallback;
- brain failure -> do not fabricate;
- authorization failure -> fail closed;
- missing Skill -> surface the gap, never approximate silently.

## 22. Observability

Each turn SHOULD emit:
- network/session timing;
- turn detection timing;
- committed transcript timing;
- first acknowledgement timing;
- first model token/audio timing;
- first avatar frame timing;
- interruption timing;
- run/tool latency;
- provider/model binding;
- fallback/degradation reason;
- role/version/Skill versions/Workflow ID;
- approval/effect receipt IDs.

Metrics must avoid storing raw audio unless explicitly enabled.

## 23. Provider binding

Provider binding is an operational object separate from DigitalHuman:

    RealtimeProviderBinding {
      bindingId
      revision
      mediaProvider
      turnDetector
      conversationBrain
      asr
      tts
      avatar
      region
      residencyPolicy
      fallbackPolicy
    }

This separation is mandatory for 60-role scalability.

## 24. Compatibility rule

Existing Chat, recording, ASR, Agent Skill Pins, and Skill catalog contracts must continue working without adopting the avatar/video layer.

Realtime Digital Human is an additive consumer of those domains.
