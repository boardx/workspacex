# Issue #74 uncached final init evidence

- commit: `e11cff8b`
- command: `TURBO_FORCE=true ./init.sh`
- result: GREEN
- raw output retention: none (only the non-sensitive verification lines below are retained)

```text
  ✓ pre-push hook（受影响模块轻量门控，对齐 CI 快速迭代策略）
[test-isolation] id=run-msdqpaat-0749330f-39cdab20496f db=wsx_39cdab20496fbfbbf14b compose=wsx-39cdab20496fbfbbf14b pg=20000 redis=25000
@repo/api:test: cache bypass, force executing 27d9a75252c87eb2
@repo/api:test: [db-isolation] db=wsx_39cdab20496fbfbbf14b capacity=100 current=6 required=32
@repo/api:test:  Test Files  420 passed (420)
@repo/api:test:       Tests  4305 passed | 2 todo (4307)
@repo/api:test: [db-isolation] db=wsx_39cdab20496fbfbbf14b peak_connections=16
 Tasks:    36 successful, 36 total
==> 基础验证通过。
```

The wrapper database, capacity probe database, and peak sampler database are identical. Turbo explicitly bypassed the API test cache, so this is current-run execution rather than replayed output.
