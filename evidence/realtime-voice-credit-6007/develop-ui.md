[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/.worktrees/credit-subscription/apps/web

 ✓ tests/ui/credit-consumption.test.tsx (15 tests) 3603ms
   ✓ HTTP credit rejection preserves draft and offers scoped recharge without retry 638ms
   ✓ platform control reads authoritative setting and saves explicit choice 340ms
   ✓ forbidden settings are hidden and failed save retains last confirmed setting 425ms
   ✓ organization wallet fractional debt is visible 670ms
   ✓ native tariff requires explicit configured price and keeps native units 424ms
 ✓ tests/ui/billing-overview.test.tsx (8 tests) 3392ms
   ✓ 真实计费入口与账户状态 > 个人菜单始终可发现账户入口，不依赖支付凭据 2679ms
   ✓ 真实计费入口与账户状态 > 未配置渠道仍读取真实钱包和订阅，不显示二维码或虚构额度 311ms
 ✓ tests/ui/realtime-voice-session.test.tsx (14 tests) 4571ms
   ✓ RealtimeVoiceSession > connects with threadId + selected agent (no model/voice from the client) and walks the live states 696ms
   ✓ RealtimeVoiceSession > subtitle under the name: shows the role one-liner, hidden when it just repeats the name 987ms
   ✓ RealtimeVoiceSession > controls carry visible labels + aria-label/tooltip, and a live mic level meter follows capture RMS 719ms
 ✓ tests/ui/billing-subscription-live.test.tsx (32 tests) 7011ms
   ✓ live Stripe subscription > requests checkout without owner data, redirects and reuses the pending URL on reopening 1014ms
   ✓ live Stripe subscription > active uses the approved entitlement and operation 468ms
   ✓ live Stripe subscription > trialing uses the approved entitlement and operation 1073ms
   ✓ live Stripe subscription > retires a pending checkout after a newly confirmed incomplete_expired transition via refresh 345ms
   ✓ live Stripe subscription > polls a known return a bounded number of times without claiming free or creating another checkout 1019ms
 ✓ tests/ui/billing-cashier.test.tsx (45 tests) 9230ms
   ✓ F06 live cashier entry > opens real package selection from configured account 1896ms
   ✓ F06 live cashier entry > does not invent packages for an empty catalog 1060ms
   ✓ F06 real cashier financial lifecycle > masks all sensitive content on a definitive 404 order denial 369ms
   ✓ F06 real cashier financial lifecycle > does not display forged create result 2 418ms
   ✓ F06 real cashier financial lifecycle > hides expired QR without inventing CLOSED or regenerating an intent 415ms
   ✓ F06 real cashier financial lifecycle > does not encourage paying again after an accounting failure 348ms
   ✓ F06 purchase navigation intent > consumes an explicit configured purchase intent once and restores a safe focus target 306ms

 Test Files  5 passed (5)
      Tests  114 passed (114)
   Start at  11:10:01
   Duration  19.18s (transform 4.68s, setup 4.53s, collect 24.24s, tests 27.81s, environment 14.63s, prepare 1.23s)

