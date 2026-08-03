# Issue #74 database isolation stability evidence

- commit: `b3bb4133bf5c705c29ed161aedd5ff9ba8753255`
- started_at: `20260803T2034Z`
- command: `pnpm --filter @repo/api run test:stability`
- policy: five complete runs; no failed-test retry; rounds 2 and 3 reuse one isolation id/database

| round | isolation id | database | compose project | result | peak connections | failure set | raw log sha256 |
|---:|---|---|---|---|---:|---|---|
| 1 | `issue74-20260803T2034Z-1` | `wsx_04dc0b07358b0287d8aa` | `wsx-04dc0b07358b0287d8aa` | Test Files  420 passed (420) | 15 | none | `29b3a6e4b558fc06df45c0ac34c2ac05df8f464fee2b598b4f0635d9de9d7afb` |
| 2 | `issue74-20260803T2034Z-reuse` | `wsx_f0d519a79533ea81e140` | `wsx-f0d519a79533ea81e140` | Test Files  420 passed (420) | 15 | none | `7762a1ed32807d19310aa3cfbe1afeea3c8120ea7b08cdd03fd4e8eaa9b067d6` |
| 3 | `issue74-20260803T2034Z-reuse` | `wsx_f0d519a79533ea81e140` | `wsx-f0d519a79533ea81e140` | Test Files  420 passed (420) | 16 | none | `cb41656a987a7e031c4d773e64a6bdfe1edf54c144aeca2cb0666e27f6ac6b48` |
| 4 | `issue74-20260803T2034Z-4` | `wsx_fa722adfcb646c9d64de` | `wsx-fa722adfcb646c9d64de` | Test Files  420 passed (420) | 16 | none | `29b44c5bcbe4e6dc61aeca32a8a43dc5341218e2a4dfe2216e27f7d12d3cc016` |
| 5 | `issue74-20260803T2034Z-5` | `wsx_1e61ed63a6fa777379ce` | `wsx-1e61ed63a6fa777379ce` | Test Files  420 passed (420) | 16 | none | `e5918c2aacd127cd008aa7676b91c269cf31148e6c4e5b3118a886b010b7c62f` |

- finished_at: `2026-08-03T20:45:15Z`
- overall: GREEN
