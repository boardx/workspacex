[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/web

 ✓ tests/ui/credit-consumption.test.tsx (15 tests) 1212ms
 ✓ tests/ui/billing-overview.test.tsx (8 tests) 1145ms
   ✓ 真实计费入口与账户状态 > 个人菜单始终可发现账户入口，不依赖支付凭据 559ms
 ✓ tests/ui/realtime-voice-session.test.tsx (14 tests) 2442ms
   ✓ RealtimeVoiceSession > connects with threadId + selected agent (no model/voice from the client) and walks the live states 626ms
   ✓ RealtimeVoiceSession > renders live captions + level meter from a loopback-style turn; muted swaps the speak hint; save notice only while live 358ms
 ✓ tests/ui/billing-subscription-live.test.tsx (32 tests) 3496ms
   ✓ live Stripe subscription > requests checkout without owner data, redirects and reuses the pending URL on reopening 581ms
 ✓ tests/ui/billing-cashier.test.tsx (45 tests) 5857ms
   ✓ F06 live cashier entry > opens real package selection from configured account 641ms
   ✓ F06 real cashier financial lifecycle > does not block package selection on wallet outage 303ms
   ✓ F06 explicit creation rejection > allows a manual retry after structured upstream rejection without showing a fake QR 471ms

 Test Files  5 passed (5)
      Tests  114 passed (114)
   Start at  11:44:38
   Duration  15.89s (transform 3.45s, setup 4.50s, collect 19.32s, tests 14.15s, environment 21.10s, prepare 1.50s)

