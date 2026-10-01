# 本地数字人与语音验证

日期：2026-10-01（Asia/Shanghai）

命令：`node --import tsx scripts/local-session/digital-voice-session.mjs --data-dir "/private/tmp/wsx-digital-voice-final" --base "http://127.0.0.1:14310" --out "/private/tmp/wsx-digital-voice-20261001/evidence/digital-voice-2026-10-01"`

真实 Chromium、API、PGlite、登录与持久化；语音供应商为显式 loopback 模拟，麦克风为 Chromium 假设备。未验证真实供应商通话质量。

- PASS real local login
- PASS pending seven official roles
- PASS enable roles with dependencies
- PASS select design thinking expert
- PASS loopback live voice and captions
- PASS hang up and refresh persisted turns

Proxy/readiness/rollback tests: 30 passed. Related Web: 21 passed; realtime API and real DB: 31 passed; official-role import: 17 passed.

The earlier attempt refreshed before hangup persistence completed and accepted a sidebar title as a user message. The corrected script waits for assistant message body and resolved thread URL, then scopes post-refresh assertions to the main message container. The six PASS results above are from a fresh database. failure.png preserves the previous attempt for traceability.

Deployment boundary: local validation does not mean devapp is deployed. This change repairs the VM route and trusted deployment helper; devapp verification remains pending merge and deployment.
