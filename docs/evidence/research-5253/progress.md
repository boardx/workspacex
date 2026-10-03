# Report naming and single-language framing (#5253)

User directly requested topic-specific report naming and removal of duplicated bilingual report prose.

- Baseline: origin/main 814dc05a36e1, fetched before development; reused existing managed worktree.
- Reproduced both English/Chinese all-unverified failures before implementation.
- Shared framing selects Chinese from confirmed topic/goal/focus, otherwise English; geographic region does not select prose language. Technical proper names remain intact. Topic-derived titles respect the 200-character contract.
- Chapter gaps and all-unverified synthesis now use single-language framing. Model prose instructions explicitly prohibit parallel translations and require descriptive topic-specific titles.
- Reader compatibility replaces only the exact legacy deterministic title/paragraphs; preserves authored text, chapters, citations and stored data.
- API chapters/evidence/quality: 108/108 passed using isolated database wrapper; no shared database mutation.
- Web document tests: 9/9 passed, including Chinese and English legacy display and authored report preservation.
- Contracts/API/web typechecks passed.
- Coordination tick unavailable: COORD_GATEWAY_URL absent; readiness inspected, direct user priority recorded on issue #5253.
- No merge or deployment authorized/performed. Remote CI pending until PR creation.
