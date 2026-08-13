# `/rec` 复用 Chat 实时 ASR Provider · 可执行验收契约

## 签核前设计门

```bash
pnpm exec tsx .harness/scripts/validate-fl.ts 01
pnpm exec vitest run .harness/scripts/lib/design-signoff.test.ts
```

F173 在本 delta 为 `pending` 时必须被 design gate 拒绝；人类改为 `confirmed` 后才允许 claim。

## F173 实现门

```bash
pnpm --filter api exec vitest run \
  tests/recording/personal-realtime-asr-provider-wiring.test.ts \
  tests/recording/configured-realtime-asr-provider.test.ts \
  tests/recording/personal-realtime-asr-gateway.test.ts \
  tests/recording/personal-realtime-asr-usage.test.ts \
  tests/recording/provider-final-persist-before-push.test.ts

pnpm --filter web exec vitest run \
  tests/e2e/personal-realtime-transcription-smoke.test.ts \
  tests/lib/boardx-realtime-asr-client.test.ts \
  tests/lib/pcm-audio-worklet.test.ts \
  tests/ui/realtime-transcription-workspace.test.tsx

pnpm --filter api run typecheck
pnpm --filter web run typecheck
```

## 反证

- 将 personal wiring 临时恢复为 `AliyunFunAsrProvider` 时 provider-wiring 测试必须红。
- 将 final 推送移到 persist 前时 persist-before-push 测试必须红。
- 将 32000 bytes 的期望时长从 1 秒改为 2 秒时 usage 测试必须红。
- 删除任一 `KERNEL_ASR_*` 时 configured 测试必须证明 Chat 与 personal 同时为 false。
