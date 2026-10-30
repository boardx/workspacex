
 RUN  v2.1.9 /Users/shenyangjun/boardx/workspacex/apps/api

 ❯ tests/auth/self-usage-cursor.test.ts (2 tests | 1 failed) 56ms
   × continues a calls snapshot started without asOf using its returned cursor 54ms
     → FORBIDDEN

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/auth/self-usage-cursor.test.ts > continues a calls snapshot started without asOf using its returned cursor
Error: FORBIDDEN
 ❯ SelfAiUsageService.calls src/application/auth/self-ai-usage-service.ts:53:215

 ❯ tests/auth/self-usage-cursor.test.ts:29:15

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
   Start at  19:44:04
   Duration  886ms (transform 450ms, setup 0ms, collect 714ms, tests 56ms, environment 0ms, prepare 32ms)

