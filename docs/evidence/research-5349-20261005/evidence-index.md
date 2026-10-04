# Verification evidence (#5349)

The committed images contain synthetic public policy test material and randomly named test sessions. They contain no customer brief, token, cookie, private source text or production credentials. The actual production-mode web build, API authentication and PostgreSQL persistency were exercised by the isolated fullstack test; model/search/ASR are deterministic loopback services. This verifies workflow and quality-gate behavior, not real-provider report language, factual accuracy or the 180-second performance goal.

Final isolated E2E run: exit 0, 1 PASS, test execution about 1.1 minutes (cold build/setup included: 3.1 minutes). Source blobs at launch and after finish match:

- guided-research-live.tsx: `d3d8a8b8962a253f7005cde0fe715e36c59b5987`
- guided-research-runtime.spec.ts: `76f845ab7a34c163bffb4fc5c1fccecfdde358da`

Assertions: one prepare_plan, one generate_report despite SSE disconnect/reload; real server version and terminal state; all question-derived search tasks succeeded; one deliberately invalid evidence response repaired; citation and coverage gates passed; edited plan survived reload; chapter draft survived collapse/reopen; historical chapters URL did not issue POST; conversational regeneration waited for a newer server version; quality-rejected report remained non-completed across reload; Word download and 390px no-overflow checks passed.

## Images

[Editable plan](./research-plan-markdown.png), [streaming execution before body](./research-report-streaming.png), [mobile report](./research-report-chapters-mobile.png), [quality-rejected draft](./research-quality-complete-draft.png).

| Artifact | SHA-256 |
|---|---|
| [research-plan-markdown.png](./research-plan-markdown.png) | `22f4d609d54371783fe46bbd2fe4e181dcae458fb6132762f7e2c4100fbc449d` |
| [research-report-streaming.png](./research-report-streaming.png) | `fd9d32a8891a8424e02f925bab6707bb1fac0afa23441db26f0869ef4b8e2c7f` |
| [research-report-chapters-mobile.png](./research-report-chapters-mobile.png) | `55f4ca823906fd90815f70abc910a3f56cb2c878921778d653cbd9ed091e694d` |
| [research-quality-complete-draft.png](./research-quality-complete-draft.png) | `a51f85a3629ec253ff6d76676c9aa06f5fc24994008bb4709bc8204a0d0d8086` |

[Verification commands and output summaries](./verification.txt). Earlier c5c6 product evidence is archived separately and is not attributed to the final integrated source. The final delta preserves external 82ec server-node navigation and fixes both first-open draft retention and cross-session default mounting.
