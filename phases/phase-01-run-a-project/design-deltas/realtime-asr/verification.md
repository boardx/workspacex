# Realtime ASR 可执行验收契约

这些命令就是实现的完成契约。部分文件尚不存在，**它们的缺席是预期的 RED**，
不是豁免、也不是"健康的空结果"。

## 包结构门（现在就能跑）

```bash
pnpm exec vitest run .harness/scripts/realtime-asr-design.test.ts
```

通过 = 这份待审包结构完整且硬边界没被磨掉。**不等于**人类批准了，
也**不等于**产品行为存在。

## 实现门

```bash
pnpm --filter @repo/api test -- tests/recording/asr-stream-authz.test.ts
pnpm --filter @repo/api test -- tests/recording/asr-final-writes-through-ingest-segment.test.ts
pnpm --filter @repo/api test -- tests/recording/asr-confidential-scope-fail-closed.test.ts
pnpm --filter web test -- tests/recording/live-recording-capture.test.ts
pnpm --filter web exec playwright test e2e/core-loop.spec.ts -g "步骤 7"
```

这些测试必须分别断言：

1. **授权**：无项目角色的连接在**握手阶段**就被拒，不建立连接；`endRecording` 之后
   连接返回 `SESSION_ENDED`。
2. **落库唯一路径**：`asr.final` 走的是既有 `ingestSegment` 用例——
   反证：把 ingestSegment 打桩成抛错，`asr.final` 必须**不**回 `segmentId`；
   且断言不存在第二条写 segment 的代码路径。
   同一 `idempotencyKey` 重放**不产生第二条** segment。
3. **机密域 fail-closed**：机密数据域下连接被拒并回
   `CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`；反证：去掉该判定后测试必须变红。
   并断言源码里**没有**任何"确认后继续"的绕行分支。
4. **浏览器采音**：`getUserMedia` 被拒 / 无设备 / WS 断开 三种情形各自产生
   **可见**的界面状态（不是空白、不是控制台 warning）；音频确实被转成
   PCM16 / 16000Hz / 单声道。
5. **端到端**（Playwright 用 `--use-fake-device-for-media-stream`）：
   登录 → 打开会话 → 开始录音 → 停止 → **转录出现在该会话且刷新后仍在**。

## 禁止 mock 的机械断言

```bash
pnpm --filter web test -- tests/session/covered-routes-no-mock.test.ts
```

录音路径不得 import `lib/mock/rec*` / `lib/mock/itv`。

## 未配置时的诚实降级

模型注册表里没有 ASR 提供方时，界面显示"未配置转写"，WS 面回 `ASR_NOT_CONFIGURED`。
**反证**：把提供方配置删掉，上面第 5 条的 e2e 必须以"未配置"这个**可见状态**失败，
而不是超时、白屏或静默通过。
