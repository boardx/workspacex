# Coverage — Transcription

> 第 ③ 件（API 契约）：本束复用 `packages/contracts/src/recording.ts`（见 `.harness/scripts/third-artifact-map.json`），后续个人转录、ASR ticket、recording segment 与 transcript artifact 都从 recording 契约扩展。

| V | 验收行为 | API 操作 / 门控命令 | Feature | 状态 |
| --- | --- | --- | --- | --- |
| V1 | 转录文档创建、历史落库、名称与标签保存 | `pnpm --filter api exec vitest run tests/recording/personal-transcription-document.test.ts` | F01 | 待生成 |
| V2 | ASR ticket、interim/final 去重与断线恢复状态机 | `pnpm --filter api exec vitest run tests/recording/asr-ticket-state-machine.test.ts` | F02 | 待生成 |
| V3 | 音频与 `transcript.jsonl` file-first 回流为 Artifact | `pnpm --filter api exec vitest run tests/recording/file-first-transcript-artifact.test.ts tests/recording/transcript-jsonl-schema.test.ts` | F03 | 待生成 |
| V4 | 历史管理、删除确认和审计约束 | `pnpm --filter api exec vitest run tests/recording/personal-transcription-management.test.ts` | F04 | 待生成 |

| Feature | Requirement |
| --- | --- |
| F01 | `00-overview.md#R2` |
| F02 | `00-overview.md#R2` |
| F03 | `00-overview.md#R3` |
| F04 | `00-overview.md#R4` |
