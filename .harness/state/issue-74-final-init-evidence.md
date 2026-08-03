# Issue #74 uncached final init evidence

- commit: `d7b00697`
- command: `TURBO_FORCE=true ./init.sh`
- result: GREEN
- raw output retention: none (only the non-sensitive verification lines below are retained)

```text
[test-isolation] id=run-msdqee33-49836fb7-d5fcaaaa926c db=wsx_d5fcaaaa926c743ff043 compose=wsx-d5fcaaaa926c743ff043 pg=20770 redis=25770
@repo/api:test: cache bypass, force executing c06c119803a5c085
@repo/api:test: [db-isolation] db=wsx_d5fcaaaa926c743ff043 capacity=100 current=6 required=32
@repo/api:test:  Test Files  420 passed (420)
@repo/api:test:       Tests  4305 passed | 2 todo (4307)
@repo/api:test: [db-isolation] db=wsx_d5fcaaaa926c743ff043 peak_connections=15
 Tasks:    36 successful, 36 total
==> 基础验证通过。
```

The wrapper database, capacity probe database, and peak sampler database are identical. Turbo explicitly bypassed the API test cache, so this is current-run execution rather than replayed output.
