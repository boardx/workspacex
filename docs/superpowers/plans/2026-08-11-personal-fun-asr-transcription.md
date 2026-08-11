# 用户私有 Fun-ASR 实时转录实施计划

> Issue：#945（设计父 issue）。交付拆成 F164/F165/F166，每个 feature 单独 issue、分支与 PR。  
> 执行约束：束级签核与阶段一致性复核通过前不得 claim 或写产品实现；每一步先写失败测试并观察 RED。

## 目标

把 `/rec` 从 mock 原型变成用户私有、可持续落库的实时转录工作台：历史与创建来自 PostgreSQL，麦克风经 AudioWorklet 产生 PCM16/16k/mono，BoardX 后端用一次性 ticket 代理阿里云 Fun-ASR，最终段先落库再推送，停止后等待 `task-finished`。

## 既有能力复用

- 复用 `recording_sessions`、`recording_tracks`、`recording_segments` 与 `ingestTranscriptSegment`，不新增第二条正文写路径。
- 复用 `ConfiguredRealtimeAsrProvider` 的 application port 形状与现有 `ws` 依赖，但实现新的 Fun-ASR 协议 adapter；旧项目级 Qwen3 路径在迁移完成前保持兼容。
- 复用现有额度、模型调用日志、JWT guard、PostgreSQL client 与 RLS 基础设施。
- 替换 `apps/web/lib/live-recording.ts` 中的 ScriptProcessor 采音实现，前端不引入新依赖。

## Task 0：完成设计门禁

文件：

- `phases/phase-01-run-a-project/contracts/personal-realtime-transcription/*`
- `phases/phase-01-run-a-project/design-coherence.md`
- `phases/phase-01-run-a-project/feature_list.json`

步骤：

1. 人类核对 UI、用例、API 三节并修改新束 `design-signoff.md` 的签核状态。
2. 人类更新阶段一致性复核，覆盖 `personal-realtime-transcription`，明确它与 `recording`、`auth`、额度和模型注册表的交叉约束。
3. 运行 `pnpm harness sync --phase 01 --apply` 为 F164/F165/F166 建立独立 issue。
4. 建立只包含 F164 的 sprint，claim 给 `coord-voice`；后续每个 feature 依次执行同样流程。

门禁验证：

```bash
pnpm harness doctor --phase 01
pnpm exec tsx .harness/scripts/verify-uc-coverage.ts 01
node .harness/scripts/lint-ui-material.mjs
```

## Task 1（F164）：先定义共享契约

文件：

- 新建 `packages/contracts/src/personal-realtime-transcription.ts`
- 修改 `packages/contracts/src/index.ts`
- 新建 `packages/contracts/tests/personal-realtime-transcription.test.ts`

RED：测试 create/list/read/ticket/WS 事件 schema，反证 `projectId` 不是创建必填，错误枚举不含项目角色码，final/completed 必须携带 capture 标识。

GREEN：实现 zod schema 与导出；前后端只从该文件取类型。

验证：

```bash
pnpm --filter @repo/contracts exec vitest run tests/personal-realtime-transcription.test.ts
pnpm --filter @repo/contracts run test
```

## Task 2（F164）：用户私有元数据和兼容 migration

文件：

- 新建 `apps/api/migrations/<timestamp>_personal_realtime_transcriptions.sql`
- 修改 `apps/api/src/application/recording/recording-ports.ts`
- 修改 `apps/api/src/infrastructure/recording/pg-recording-repository.ts`
- 新建 `apps/api/tests/recording/personal-transcription-persistence.test.ts`
- 新建 `apps/api/tests/recording/personal-transcription-owner-boundary.test.ts`

RED：

1. A 创建后刷新可读；B 和管理员正文查询为 not found。
2. `source_type=personal` 允许 `project_id NULL`，其它 source type 仍拒绝 NULL。
3. `personal_transcriptions` 没有正文列；正文只在 recording segments。

GREEN：

- 新表 `personal_transcriptions(id, org_id, owner_user_id, name, tags, status, created_at, updated_at)`。
- `recording_sessions.source_type` 增加 personal；只对 personal 放宽 project_id。
- 增加 owner 过滤的 repository port，不允许通用 `findById` 绕过 owner。
- 保留 org RLS，并在 application/controller 层强制 owner；管理员不获得正文旁路。

## Task 3（F164）：创建、历史、详情与多 capture API

文件：

- 修改 `apps/api/src/interface/controllers/recording.controller.ts`
- 新建或修改 `apps/api/src/application/recording/personal-transcription-usecases.ts`
- 新建 `apps/api/tests/recording/personal-transcription-multi-capture.test.ts`

RED：create/list/read 真 HTTP 集成测试；停止后再次创建 capture，详情聚合两次 run 的 final，ordinal 稳定且不重复。

GREEN：实现三个 HTTP 入口；list 使用游标分页并在 DB 中过滤 owner/query/tag/sort，不把全表拉到内存。

## Task 4（F165）：一次性 ticket

文件：

- 扩展上述 migration 或新增 ticket migration
- 新建 `apps/api/src/application/recording/realtime-asr-ticket-service.ts`
- 新建 `apps/api/src/infrastructure/recording/pg-realtime-asr-ticket-repository.ts`
- 新建 `apps/api/tests/recording/realtime-asr-ticket.test.ts`

RED：有效 ticket 只能消费一次；过期、跨 transcription、跨 capture、跨用户均拒绝；数据库和日志不出现原文。

GREEN：生成 256-bit 随机 ticket，只存 SHA-256 摘要；事务内 `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()` 原子消费；TTL 约 60 秒。

## Task 5（F165）：Fun-ASR provider 状态机

文件：

- 新建 `apps/api/src/infrastructure/recording/aliyun-fun-asr-provider.ts`
- 修改 `apps/api/src/application/recording/asr-ports.ts`
- 修改 `apps/api/src/kernel.module.ts`
- 新建 `apps/api/tests/recording/fun-asr-protocol-state-machine.test.ts`

RED：用本地 stub WebSocket 逐帧断言：open 后第一帧 run-task；task-started 前 PCM=0；result-generated partial/final 映射正确；finish-task 后仍接收 final；task-finished 才 resolve finish；task-failed 与未知事件映射稳定错误。

GREEN：

- 从 `ALIYUN_ASR_MODEL/REGION/WORKSPACE_ID` 与 `DASHSCOPE_API_KEY` 读配置。
- 后端组装 model、format=pcm、sample_rate=16000、标点和热词。
- 有界缓冲、启动/收尾 timeout、bufferedAmount 背压和幂等 close。
- 不在源码建立模型枚举清单；模型值来自部署配置。

## Task 6（F165）：BoardX WS、先落库后推送和用量

文件：

- 修改 `apps/api/src/interface/ws/asr-stream.gateway.ts`
- 修改 `apps/api/src/interface/controllers/recording.controller.ts`
- 新建 `apps/api/tests/recording/fun-asr-final-persist-before-push.test.ts`
- 新建 `apps/api/tests/recording/fun-asr-usage-idempotency.test.ts`

RED：

- final callback 中 DB 不可用时客户端不得收到 final。
- finish-task 后尾部 final 仍落库；写链完成和 task-finished 之前无 completed。
- 重复 usage/final event 不重复段、不重复模型日志、不重复扣额。

GREEN：ticket 握手替代长期 JWT WebSocket 身份；网关只调用既有 segment ingestion；capture 终态和模型用量同一幂等边界收口。

## Task 7（F166）：BoardX 客户端与 AudioWorklet

文件：

- 新建 `apps/web/lib/realtime-asr/realtime-asr.types.ts`
- 新建 `apps/web/lib/realtime-asr/boardx-realtime-asr-client.ts`
- 新建 `apps/web/lib/realtime-asr/pcm-audio-worklet.ts`
- 新建 worklet processor 文件（放入现有 web 静态资源约定目录）
- 新建 `apps/web/tests/lib/pcm-audio-worklet.test.ts`

RED：48k 双声道样本下混、降采样并编码 PCM16 little-endian；ready 前不发音频；stop 后不发新帧；每种 error 都映射到 UI 状态；dispose 幂等释放资源。

GREEN：AudioWorklet 管线与 BoardX 稳定事件客户端；不 import 阿里事件类型。

## Task 8（F166）：历史页与创建弹窗去 mock

文件：

- 修改 `apps/web/app/rec/page.tsx`
- 修改 `apps/web/components/rec/rec-app.tsx`
- 修改 `apps/web/components/rec/transcription-history.tsx`
- 修改 `apps/web/components/rec/create-transcription-dialog.tsx`
- 新建 `apps/web/lib/realtime-asr/personal-transcription-api.ts`
- 新建 `apps/web/tests/ui/personal-transcription-history.test.tsx`

RED：真实 API 加载、空态、失败、搜索/标签/排序；创建请求不含 projectId；成功进入返回 session；重复提交只发一次。

GREEN：移除 `MOCK_TRANSCRIPTIONS` 的生产路径；server/client 身份沿用现有应用鉴权，不继续使用 `mockIdentity`。

## Task 9（F166）：简化详情与 final/interim 状态

文件：

- 修改 `apps/web/components/rec/realtime-transcription-workspace.tsx`
- 删除不再使用的详情分析面板代码/import
- 新建 `apps/web/tests/ui/realtime-transcription-workspace.test.tsx`

RED：详情主区域只存在一个 `rec-live-toggle` 和 `rec-live-transcript`；interim 替换不追加；final 去重追加；finalizing 按钮 disabled；completed 后允许新的 capture；错误态保留已落库 final。

GREEN：接入 API/client/worklet，以 reducer 维护 `finalSegments` 与唯一 `interimSegment`。

## Task 10：端到端与视觉验证

文件：

- 新建 `apps/web/tests/e2e/personal-realtime-transcription-smoke.test.ts`
- 更新 `phases/phase-01-run-a-project/ui-preview/realtime-transcription/README.md`
- 证据写入对应 sprint evidence，不修改 passing 状态。

验证顺序：

```bash
pnpm --filter @repo/contracts run test
pnpm --filter api exec vitest run tests/recording/personal-transcription-owner-boundary.test.ts tests/recording/personal-transcription-persistence.test.ts tests/recording/personal-transcription-multi-capture.test.ts
pnpm --filter api exec vitest run tests/recording/realtime-asr-ticket.test.ts tests/recording/fun-asr-protocol-state-machine.test.ts tests/recording/fun-asr-final-persist-before-push.test.ts tests/recording/fun-asr-usage-idempotency.test.ts
pnpm --filter web exec vitest run tests/ui/personal-transcription-history.test.tsx tests/ui/realtime-transcription-workspace.test.tsx tests/lib/pcm-audio-worklet.test.ts
pnpm --filter web exec vitest run tests/e2e/personal-realtime-transcription-smoke.test.ts
./init.sh
```

浏览器验证使用可控假上游和真实 API/PostgreSQL：创建 → 开始 → interim → final → 停止 → completed → 刷新 → 正文仍在 → 再次开始形成第二 capture。真实 DashScope 只做受控环境 smoke，不把 API Key 或音频写入证据。

## 交付顺序

1. F164：契约、用户私有元数据与历史落库。
2. F165：ticket、Fun-ASR、WS、用量。
3. F166：AudioWorklet、真实 UI、E2E。

每项完成后分别 `harness verify`、提交证据、PR `Closes #<feature issue>` 并合入 main，再开始下一项。
