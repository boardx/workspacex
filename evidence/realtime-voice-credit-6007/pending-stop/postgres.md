[stack-admission] load1=10.56 cores=10 perCore=1.06 running=1/2
[stack-admission] 排到了，等了 0s
[test-isolation] id=run-mvugonxs-32bd5aac-d97141661b25 db=wsx_d97141661b25ce53fd4e compose=wsx-d97141661b25ce53fd4e pg=20060 redis=21060 api=24060 web=25060 sandbox=26060 model=27060 deep-agent=28060 asr=29060 vision=30060 loopback-sandbox=31060 mail=19060

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/api

[db-isolation] db=wsx_d97141661b25ce53fd4e capacity=100 current=6 required=32
[realtime-digital-human] upstream error: {"code":"InvalidApiKey","message":"secret detail"}
 ✓ tests/chat/realtime-digital-human-gateway.test.ts (33 tests) 3522ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > upstream close remains bounded when append never resolves, without a false persisted acknowledgement 2014ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > explicit browser loopback keeps a finite PCM stream actionable and cancels its next chunk 532ms
   ✓ WS /chat/realtime-digital-human — Chat 语音模式 > loopback omni upstream: readable Chinese user + role-aware assistant turn is relayed as live captions, audio and persisted 634ms
 ✓ tests/billing/durable-credit-usage.test.ts (18 tests) 3383ms
   ✓ admits twenty normal concurrent starts without spurious accounting failures 412ms
   ✓ repeated confirmed predispatch credit rejection never consumes spool capacity 2624ms
 ✓ tests/chat/realtime-voice-session.test.ts (14 tests) 46ms
 ✓ tests/billing/realtime-voice-credit-pg.test.ts (7 tests) 35220ms
   ✓ rejects personal debt before opening any provider WebSocket 315ms
   ✓ bills cumulative provider response usage once, completes into debt and blocks a new connection 1448ms
   ✓ allows enterprise debt and retains confirmed charges as pending when another response lacks usage 574ms
   ✓ rejects conflicting provider response replay without another debit 371ms
   ✓ settles a confirmed nondispatch and releases its durable slot on disconnect during admission 561ms
 ✓ tests/chat/realtime-voice-transcript-real-db.test.ts (4 tests) 2059ms

 Test Files  5 passed (5)
      Tests  76 passed (76)
   Start at  12:17:54
   Duration  61.61s (transform 2.02s, setup 93ms, collect 9.31s, tests 44.23s, environment 1ms, prepare 1.32s)

[db-isolation] db=wsx_d97141661b25ce53fd4e peak_connections=4
[timing] pnpm --filter @repo/api exec vitest run tests/billing/realtime-voice-credit-pg.test.ts tests/billing/durable-credit-usage.test.ts tests/chat/realtime-digital-human-gateway.test.ts tests/chat/realtime-voice-session.test.ts tests/chat/realtime-voice-transcript-real-db.test.ts
  等待重e2e互斥锁：0s
  环境预留：0s
  等待资源：0s
  命令执行：1m3s
  清理：2s
  总计：1m5s
