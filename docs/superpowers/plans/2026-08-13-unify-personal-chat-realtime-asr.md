# `/rec` 复用 Chat 实时 ASR Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户私有 `/rec` 与 Chat 麦克风共用 `ConfiguredRealtimeAsrProvider` 和 `KERNEL_ASR_*`，同时保留个人 ticket、权限、final 持久化、计量和连续追加。

**Architecture:** 将个人实时 WebSocket gateway 从 Fun-ASR 专用端口迁移到既有 `AsrProviderPort`，让 Qwen Realtime 协议仍只存在于 `ConfiguredRealtimeAsrProvider`。个人 gateway 继续负责 BoardX 事件、final 先落库、capture 生命周期和用量幂等；服务端以收到的 PCM 字节数计算音频时长，不伪造 Fun-ASR usage。

**Tech Stack:** TypeScript、NestJS、`ws`、Vitest、Zod contracts、PostgreSQL、pnpm harness。

## Global Constraints

- 运行时代码必须等 `personal-realtime-transcription` 契约束按新方案重新签核且阶段一致性复核通过。
- 一个 GitHub issue 对应一个实现 PR；分支由 `coord-voice` 在 coord-gateway 恢复后 claim。
- 不引入新依赖，不修改数据库 schema，不改 `/rec` UI，不改变 Chat gateway 行为。
- 上游 API Key 只在 API 进程；浏览器仍仅拿一次性 BoardX ticket。
- interim 不落库；final 必须先落库后推送；停止必须等待 provider `finish()` 收口。
- 不允许 mock/fallback 掩盖未配置或上游失败。

---

### Task 1: 更新并重新签核个人实时转录契约束

**Files:**
- Modify: `phases/phase-01-run-a-project/contracts/personal-realtime-transcription/design-signoff.md`
- Modify: `phases/phase-01-run-a-project/contracts/personal-realtime-transcription/domain.md`
- Modify: `phases/phase-01-run-a-project/contracts/personal-realtime-transcription/usecases.md`
- Modify: `phases/phase-01-run-a-project/contracts/personal-realtime-transcription/coverage.md`
- Modify: `phases/phase-01-run-a-project/design-coherence.md`
- Modify: `phases/phase-01-run-a-project/requirements/05-rec/uc-5-5-用户私有实时转录工作台.md`

**Interfaces:**
- Consumes: 已确认规格 `docs/superpowers/specs/2026-08-13-unify-personal-chat-realtime-asr-design.md`。
- Produces: 唯一签核事实——个人与 Chat 共用 `AsrProviderPort`/`KERNEL_ASR_*`，个人边界仍独立。

- [ ] **Step 1: 把 Fun-ASR 专用名词替换成通用 provider 生命周期**

将 `task-started/task-finished/AliyunAsrTask/ALIYUN_ASR_*` 改为：

```text
ConfiguredRealtimeAsrProvider.open(audio=mono/16k/pcm16le)
  -> onPartial（仅推送）
  -> onFinal（先持久化再推送）
  -> finish（等待尾部 final 或明确失败）
```

- [ ] **Step 2: 改写 XC-40**

明确共享的是上游 provider 和配置，不共享个人与 Chat 的 ticket、WebSocket 路径、授权或落库编排；删除“两条模型路由并存”的旧前提。

- [ ] **Step 3: 保持签核状态由人类修改**

Agent 只提交契约正文，不自行改 `status/confirmed_by/confirmed_at`；等待人类在该 bundle 与阶段一致性复核上确认。

- [ ] **Step 4: 运行契约检查**

Run:

```bash
pnpm harness doctor --phase 01
pnpm exec vitest run --dir .harness
```

Expected: 契约结构、覆盖矩阵与 harness 测试通过；若签核门提示待确认，停止实现并请人类签核。

- [ ] **Step 5: 提交契约变更**

```bash
git add phases/phase-01-run-a-project/contracts/personal-realtime-transcription \
  phases/phase-01-run-a-project/design-coherence.md \
  phases/phase-01-run-a-project/requirements/05-rec/uc-5-5-用户私有实时转录工作台.md
git commit -m "docs(recording): unify personal and chat realtime ASR contract"
```

---

### Task 2: 用通用 ASR 端口替换个人 Fun-ASR 端口

**Files:**
- Modify: `apps/api/src/application/recording/personal-realtime-asr.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/interface/controllers/recording.controller.ts`
- Test: `apps/api/tests/recording/personal-realtime-asr-provider-wiring.test.ts`
- Test: `apps/api/tests/recording/configured-realtime-asr-provider.test.ts`

**Interfaces:**
- Consumes: `AsrProviderPort.open(handlers, audio): Promise<AsrSession>` and `ASR_PROVIDER` from `application/recording/asr-ports.ts`.
- Produces: controller ticket readiness and personal gateway both depend on `ASR_PROVIDER`; `PERSONAL_REALTIME_ASR_PROVIDER` and `PersonalRealtimeAsrProvider` are removed.

- [ ] **Step 1: 写失败的 provider wiring 测试**

Add a test that builds the personal readiness dependency from only `KERNEL_ASR_*` and asserts:

```ts
expect(personalProvider).toBe(chatProvider);
expect(personalProvider.isConfigured()).toBe(true);
```

Also clear `KERNEL_ASR_MODEL` and assert both paths report unconfigured.

- [ ] **Step 2: 运行测试确认 red**

Run:

```bash
pnpm --filter api exec vitest run tests/recording/personal-realtime-asr-provider-wiring.test.ts
```

Expected: FAIL because the personal path still resolves `AliyunFunAsrProvider`/`DASHSCOPE_API_KEY`.

- [ ] **Step 3: 删除个人专用 DI token**

Remove:

```ts
export interface PersonalRealtimeAsrProvider { ... }
export const PERSONAL_REALTIME_ASR_PROVIDER = Symbol(...);
```

Inject `ASR_PROVIDER`/`AsrProviderPort` into `RecordingController`, and use its existing `isConfigured()` in `issueRealtimeAsrTicket`.

- [ ] **Step 4: 让 gateway 使用相同 DI 实例**

In `kernel.module.ts`, keep one provider registration:

```ts
{ provide: ASR_PROVIDER, useFactory: () => new ConfiguredRealtimeAsrProvider() }
```

In `main.ts`, pass `app.get(ASR_PROVIDER)` to Chat, project recording, draft, and personal gateways.

- [ ] **Step 5: 运行 provider tests**

Run:

```bash
pnpm --filter api exec vitest run \
  tests/recording/personal-realtime-asr-provider-wiring.test.ts \
  tests/recording/configured-realtime-asr-provider.test.ts
```

Expected: PASS; no test requires `DASHSCOPE_API_KEY` or `ALIYUN_ASR_*` for personal readiness.

- [ ] **Step 6: 提交端口与 DI 变更**

```bash
git add apps/api/src/application/recording/personal-realtime-asr.ts \
  apps/api/src/kernel.module.ts apps/api/src/main.ts \
  apps/api/src/interface/controllers/recording.controller.ts \
  apps/api/tests/recording/personal-realtime-asr-provider-wiring.test.ts
git commit -m "refactor(recording): share chat realtime ASR provider with personal capture"
```

---

### Task 3: 迁移个人 gateway 到通用 Provider 并保持落库顺序

**Files:**
- Modify: `apps/api/src/interface/ws/personal-realtime-asr.gateway.ts`
- Test: `apps/api/tests/recording/personal-realtime-asr-gateway.test.ts`
- Test: `apps/api/tests/recording/fun-asr-final-persist-before-push.test.ts`（重命名为 provider-neutral 名称）

**Interfaces:**
- Consumes: `AsrProviderPort`, `AsrSession`, `AsrSessionHandlers`, PCM format `{ sampleRate: 16000, channels: 1, encoding: "pcm16le" }`.
- Produces: 现有 `personalRealtimeTranscription.RealtimeAsrServerEvent` 的 `ready/interim/final/stopping/completed/error`，前端契约不变。

- [ ] **Step 1: 写 gateway red tests**

使用 fake `AsrProviderPort`/`AsrSession`，断言：

```ts
expect(openAudio).toEqual({ sampleRate: 16000, channels: 1, encoding: "pcm16le" });
expect(eventsBeforePersist).not.toContainEqual(expect.objectContaining({ type: "final" }));
expect(eventsAfterPersist).toContainEqual(expect.objectContaining({ type: "final", text: "最终文本" }));
expect(session.finish).toHaveBeenCalledTimes(1);
```

并覆盖 partial 只推送不落库、异常 close 只清理一次、停止期间不接受第二次 stop。

- [ ] **Step 2: 运行测试确认 red**

Run:

```bash
pnpm --filter api exec vitest run tests/recording/personal-realtime-asr-gateway.test.ts
```

Expected: FAIL because current gateway expects `onReady/onInterim`, Fun-ASR timestamps, `taskId`, and usage from `finish()`.

- [ ] **Step 3: 改造 handler 映射**

Use:

```ts
deps.provider.open({
  onPartial: ({ text }) => send({ type: "interim", captureId, text }),
  onFinal: ({ text }) => enqueuePersistThenPublish(text),
  onError: () => fail("ASR_PROVIDER_UNAVAILABLE"),
  onClosed: () => handleUpstreamClosed(),
}, { sampleRate: 16000, channels: 1, encoding: "pcm16le" });
```

Send BoardX `ready` only after `open()` resolves. Generate segment `startMs/endMs` from the capture audio clock rather than provider-specific sentence timestamps; preserve monotonic order and never expose invented provider timestamps.

- [ ] **Step 4: 保持停止收尾顺序**

On stop:

```text
send stopping
await upstream.finish()
await final writeChain
record usage
finish capture
send completed
close BoardX socket
```

If `finish()` reports an error or closes without the required final settlement, send the existing stable error and do not send completed.

- [ ] **Step 5: 运行 gateway tests**

Run:

```bash
pnpm --filter api exec vitest run \
  tests/recording/personal-realtime-asr-gateway.test.ts \
  tests/recording/provider-final-persist-before-push.test.ts
```

Expected: PASS with explicit persist-before-publish ordering.

- [ ] **Step 6: 提交 gateway 变更**

```bash
git add apps/api/src/interface/ws/personal-realtime-asr.gateway.ts \
  apps/api/tests/recording/personal-realtime-asr-gateway.test.ts \
  apps/api/tests/recording/provider-final-persist-before-push.test.ts
git commit -m "feat(recording): stream personal capture through shared realtime ASR"
```

---

### Task 4: 以服务端 PCM 时长记录个人转录用量

**Files:**
- Modify: `apps/api/src/interface/ws/personal-realtime-asr.gateway.ts`
- Modify: `apps/api/src/application/recording/personal-realtime-asr.ts`
- Test: `apps/api/tests/recording/personal-realtime-asr-usage.test.ts`
- Modify or remove: `apps/api/tests/recording/fun-asr-usage-idempotency.test.ts`

**Interfaces:**
- Consumes: mono 16 kHz PCM16 little-endian, therefore `bytesPerSecond = 16000 * 1 * 2 = 32000`.
- Produces: `AsrUsageEvent { providerTaskId, orgId, ownerUserId, captureId, model, durationSeconds }` with idempotent provider session id and configured model.

- [ ] **Step 1: 写时长与幂等 red tests**

For 32,000 received PCM bytes, assert:

```ts
expect(usage.durationSeconds).toBe(1);
expect(usage.model).toBe(configuredModel);
expect(secondRecord).toBe(false);
```

Also assert buffered audio before provider open contributes exactly once.

- [ ] **Step 2: 运行测试确认 red**

Run:

```bash
pnpm --filter api exec vitest run tests/recording/personal-realtime-asr-usage.test.ts
```

Expected: FAIL because current code reads `usage.durationSeconds`, `taskId`, and `ALIYUN_ASR_MODEL` from Fun-ASR.

- [ ] **Step 3: 实现服务端计量**

Track accepted binary bytes after protocol validation. On successful finish compute:

```ts
const durationSeconds = Math.ceil(totalPcmBytes / 32_000);
```

Create a provider session id with the injected `IdGenerator` when upstream open starts. Read the model from a safe provider metadata accessor or inject the configured model into gateway dependencies; do not read `ALIYUN_ASR_MODEL`.

- [ ] **Step 4: 运行用量 tests**

Run:

```bash
pnpm --filter api exec vitest run \
  tests/recording/personal-realtime-asr-usage.test.ts \
  tests/recording/fun-asr-usage-idempotency.test.ts
```

Expected: PASS; the latter is renamed/provider-neutral or removed only after equivalent idempotency coverage exists.

- [ ] **Step 5: 提交计量变更**

```bash
git add apps/api/src/interface/ws/personal-realtime-asr.gateway.ts \
  apps/api/src/application/recording/personal-realtime-asr.ts \
  apps/api/tests/recording/personal-realtime-asr-usage.test.ts \
  apps/api/tests/recording/fun-asr-usage-idempotency.test.ts
git commit -m "fix(recording): meter personal realtime ASR from accepted PCM"
```

---

### Task 5: 删除 Fun-ASR 死代码并收敛部署检查

**Files:**
- Delete: `apps/api/src/infrastructure/recording/aliyun-fun-asr-provider.ts`
- Delete: `apps/api/src/infrastructure/recording/aliyun-realtime-transcription-session.ts`
- Delete or replace: `apps/api/tests/recording/aliyun-fun-asr-provider.test.ts`
- Delete or replace: `apps/api/tests/recording/fun-asr-protocol-state-machine.test.ts`
- Modify: deployment/env documentation and health checks found by `rg 'ALIYUN_ASR_|DASHSCOPE_API_KEY' .github .harness apps docs`
- Modify: `.agents/skills/mod-research-studio/SKILL.md`

**Interfaces:**
- Consumes: all personal and Chat realtime ASR callers now use `ASR_PROVIDER`.
- Produces: a single realtime ASR configuration source (`KERNEL_ASR_*`) and no reachable Fun-ASR adapter.

- [ ] **Step 1: 查找全部旧配置引用**

Run:

```bash
rg -n 'AliyunFunAsrProvider|FunAsrProtocolSession|ALIYUN_ASR_|DASHSCOPE_API_KEY' \
  apps .github .harness docs phases
```

Classify each result as runtime, historical design archive, or unrelated DashScope HTTP model config. Do not delete unrelated `DASHSCOPE_API_KEY` uses outside realtime ASR.

- [ ] **Step 2: 删除不可达 Fun-ASR 实现与专用测试**

Only after Task 2–4 tests prove equivalent behavior, remove the two implementation files and replace protocol-state tests with shared-provider gateway tests.

- [ ] **Step 3: 更新部署配置说明**

Document the required runtime variables exactly:

```env
KERNEL_ASR_PROVIDER=aliyun
KERNEL_ASR_BASE_URL=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
KERNEL_ASR_API_KEY=<secret>
KERNEL_ASR_MODEL=qwen3-asr-flash-realtime
```

Ensure readiness checks report `ASR_NOT_CONFIGURED` based on this single group.

- [ ] **Step 4: 回流模块经验**

Append one dated entry to `mod-research-studio` recording pitfalls: Chat and personal realtime transcription must share the application `AsrProviderPort`; protocol-specific lifecycle and deployment variables cannot be duplicated at a second gateway.

- [ ] **Step 5: 运行静态与 provider 回归**

Run:

```bash
pnpm --filter api lint
pnpm --filter api exec vitest run \
  tests/recording/configured-realtime-asr-provider.test.ts \
  tests/recording/personal-realtime-asr-provider-wiring.test.ts \
  tests/recording/personal-realtime-asr-gateway.test.ts \
  tests/recording/personal-realtime-asr-usage.test.ts
```

Expected: PASS and no runtime import of the deleted Fun-ASR files.

- [ ] **Step 6: 提交清理与配置变更**

```bash
git add -A apps/api/src/infrastructure/recording apps/api/tests/recording \
  .github .harness docs .agents/skills/mod-research-studio/SKILL.md
git commit -m "chore(recording): remove duplicate Fun-ASR runtime configuration"
```

---

### Task 6: 全链路验证、harness 证据与 PR

**Files:**
- Modify: the new feature entry/sprint evidence created through harness, never by manually changing status.
- Test: `apps/web/tests/e2e/personal-realtime-transcription-smoke.test.ts`
- Test: existing Chat realtime ASR tests under `apps/api/tests/chat` and `apps/web/tests/ui`.

**Interfaces:**
- Consumes: Tasks 1–5 complete and signed.
- Produces: one issue, one PR, verified evidence, and a DevApp-ready single-config deployment.

- [ ] **Step 1: 运行 API 专项验证**

```bash
pnpm --filter api exec vitest run \
  tests/recording/configured-realtime-asr-provider.test.ts \
  tests/recording/personal-realtime-asr-provider-wiring.test.ts \
  tests/recording/personal-realtime-asr-gateway.test.ts \
  tests/recording/personal-realtime-asr-usage.test.ts \
  tests/recording/realtime-asr-ticket.test.ts \
  tests/recording/personal-transcription-multi-capture.test.ts
```

- [ ] **Step 2: 运行 Web 与 Chat 回归**

```bash
pnpm --filter web exec vitest run \
  tests/e2e/personal-realtime-transcription-smoke.test.ts \
  tests/ui/realtime-transcription-workspace.test.tsx \
  tests/ui/chat-live-message-panel-mic.test.tsx
pnpm --filter api exec vitest run tests/chat/asr-draft-gateway.test.ts
```

- [ ] **Step 3: 运行基础验证**

```bash
pnpm -w run verify:base
```

Expected: exit 0. Any pre-existing failure must be reproduced on exact `origin/main`; do not silently waive it.

- [ ] **Step 4: 运行 harness verify**

After the feature is formally claimed and assigned to a sprint:

```bash
pnpm harness verify --sprint <phase>/<sprint> --feature <feature-id>
```

Confirm the evidence blob is actually in Git:

```bash
git ls-tree HEAD -- phases/**/evidence/
```

- [ ] **Step 5: DevApp true endpoint verification**

With only `KERNEL_ASR_*` configured, verify both:

```text
Chat mic -> interim/final text
/rec start -> interim/final -> stop -> refresh -> continue append
```

Capture browser Network/WS evidence without exposing the API key. Confirm the browser only sees the BoardX ticket and BoardX events.

- [ ] **Step 6: Push and create one PR**

```bash
git push -u origin <claimed-branch>
```

Open a PR containing `Closes #<feature-issue>`, link parent #945, include verification evidence and the old-to-new configuration mapping. Do not merge it as `coord-voice`; hand it to `coord-main` after review.

---

## Plan Self-Review

- Spec coverage: provider sharing, independent personal boundaries, final ordering, stop settlement, usage, configuration, error behavior, deletion of the duplicate adapter, and DevApp verification each map to a task.
- Type consistency: every runtime task consumes the existing `AsrProviderPort`/`AsrSession`; no task invents a second provider protocol.
- Scope: no UI redesign, schema migration, Chat behavior change, new dependency, or fallback is included.
- Gate discipline: Task 1 must be human-signed before Tasks 2–6; claim/issue/verify/PR are explicit and cannot be replaced by local commits.
