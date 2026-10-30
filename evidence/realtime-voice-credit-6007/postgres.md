[stack-admission] load1=6.90 cores=10 perCore=0.69 running=0/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvucqhwv-b0861d39-319fc7ae05f1 db=wsx_319fc7ae05f11c16182f compose=wsx-319fc7ae05f11c16182f pg=20471 redis=21471 api=24471 web=25471 sandbox=26471 model=27471 deep-agent=28471 asr=29471 vision=30471 loopback-sandbox=31471 mail=19471

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_319fc7ae05f11c16182f capacity=100 current=6 required=32
[realtime-digital-human] upstream error: {"code":"InvalidApiKey","message":"secret detail"}
 ✓ tests/chat/realtime-digital-human-gateway.test.ts (33 tests) 3501ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > upstream close remains bounded when append never resolves, without a false persisted acknowledgement 2015ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > explicit browser loopback keeps a finite PCM stream actionable and cancels its next chunk 527ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > loopback omni upstream: readable Chinese user + role-aware assistant turn is relayed as live captions, audio and persisted 624ms
 ✓ tests/billing/durable-credit-usage.test.ts (16 tests) 2479ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 423ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 1674ms
 ✓ tests/chat/realtime-voice-session.test.ts (14 tests) 5ms
 ✓ tests/billing/realtime-voice-credit-pg.test.ts (6 tests) 13376ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 355ms
 ✓ tests/chat/realtime-voice-transcript-real-db.test.ts (4 tests) 697ms

 Test Files  5 passed (5)
      Tests  73 passed (73)
   Start at  10:27:19
   Duration  26.60s (transform 1.13s, setup 17ms, collect 2.36s, tests 20.06s, environment 0ms, prepare 162ms)

[db-isolation] db=wsx_319fc7ae05f11c16182f peak_connections=3
[timing] pnpm --filter @repo/api exec vitest run tests/billing/realtime-voice-credit-pg.test.ts tests/billing/durable-credit-usage.test.ts tests/chat/realtime-digital-human-gateway.test.ts tests/chat/realtime-voice-session.test.ts tests/chat/realtime-voice-transcript-real-db.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：27s
  清理：0s
  总计：28s
