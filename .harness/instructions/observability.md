# 可观测性约定

> 对应 L11「让 agent 的运行过程可观测」。可观测性属于 harness 的一部分,不是事后补丁。

## 三件套
- 日志:结构化 JSON,带 task_id / session_id / feature_id。
- 指标:每个推理回合的步数、工具调用次数、耗时、失败率。
- 追踪:plan→act→observe 每步可串联,便于定位"卡在哪一步"。

## 证据落盘
- agent 在 sprint 内产生的关键运行输出写入 `sprints/<sprint>/evidence/`。
- verify 脚本的命令输出自动归档到 evidence,作为 feature.evidence 的来源。

## 归因优先
- 失败时先看追踪/日志做原因归因(任务不清 / 上下文不足 / 环境不可复现 /
  验证缺失 / 状态断裂),再决定改 harness 的哪个子系统。

## 出问题先查 debug recorder（issue #3082，源自 #2873 的复盘）

API 进程自带一个 **debug recorder**：每个 HTTP 请求的结果与耗时（含被 guard 拒掉的）、
超过阈值还没结束的请求（`http.request.stalled`）、未处理异常（`exception.unhandled`）、
业务显式打点，统一记成结构化事件、按 `traceId` 串联、批量落到 `debug_events` 表
（7 天 / 50 万行双重裁剪）。**agent 自己就能查，不需要人类上 VM 拉 journal。**

三条路，按手边有什么选：

1. **HTTP（平台运营准入，`PlatformOperatorGuard`）**
   - `GET /system/debug/traces/:traceId` —— 一条链路全部事件，正序；`traceId` 就是响应头 `x-trace-id`。
   - `GET /system/debug/events?level=error&kind=agent_run&since=…&q=…&limit=…&beforeId=…` —— 倒序翻页；
     加 `source=memory` 读进程内环形缓冲（DB 挂了也能看最近的事件）。
   - `GET /system/debug/status` —— 记录器自身状态（缓冲 / 丢弃 / 落库失败）+ **当前飞行中的请求**：
     假死时第一眼看这个。
2. **CLI（部署机或本地，只要 `app_diag_ro` 凭据）**
   ```bash
   pnpm --filter @repo/api debug:trace --trace-id <id>
   pnpm --filter @repo/api debug:trace --level error --limit 50
   pnpm --filter @repo/api debug:trace --kind http.request.stalled --since 2026-09-08T00:00:00Z --data
   ```
3. **业务代码打点**：注入 `DEBUG_TRACE_PORT`（`DebugTracePort`），调 `record({ traceId, kind, level, msg, data })`。
   同步、不抛、不 await；`data` 会被 `redactDebugData` 脱敏（机密键整键丢、字符串值走同一套正则、有深度/大小上界）。
   `kind` 用点号分层（`agent_run.started` / `agent_run.failed` …），查询按前缀命中。

开关与阈值（环境变量）：`DEBUG_TRACE_ENABLED=0` 关；`DEBUG_TRACE_CAPACITY` / `DEBUG_TRACE_BATCH_SIZE` /
`DEBUG_TRACE_FLUSH_INTERVAL_MS` 控缓冲；`DEBUG_TRACE_SLOW_MS`（默认 2000）/ `DEBUG_TRACE_STALL_MS`（默认 15000）
控「慢」与「卡住」的判定。

与 `error_logs`（`GET /system/error-logs`）的分工：那边只有「炸了」那一刻；这边是炸之前、炸周围、以及**根本
没炸只是不返回**的那些。设计与权限边界见 `apps/api/src/application/ports/debug-trace.port.ts` 头注与迁移
`20260910040000_debug_events.sql`。
