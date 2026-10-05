# Planned measurement interpretation — #5364

The byte-preserved public report from failed trial #5327 incorrectly triggered an executed measurement gap in its future measurement-method row (line 76). Its local introduction explicitly marks these actions as awaiting real evidence; the metric explains the limited meaning of a prospective zero count.

Controlled verification: `pnpm --filter @repo/api test:interview-markdown-unit`.
Actual RED: 1 failed / 273 passed. GREEN: 282 passed across 6 files.

The exception requires a plain future-plan introduction immediately followed by the first table row, the specific method/metric structure, no execution assertion before the note, and the finite zero interpretation. Naked zero relations, heading-only plans, actual execution prefixes, and later measured results remain rejected. Source quote binding is unchanged. Duplicate matching rows fail closed.

Fixture SHA256: 1802bf35454669c79dfe5093773507da9cad22d9ecef962607b5ab3be21d44c3.
This fixes one mechanical false rejection only. #5327 remains OPEN FAIL; no new real-model request or deployment was performed.

API TypeScript: `pnpm --filter @repo/api exec tsc --noEmit` exited 0.

Independent review rejected 2957d6c07: headings could inherit/restart the flattened plan scope. Actual review RED: 2 failed / 276 passed; fixed by checking adjacent paragraph/table AST nodes and requiring unique matching assertion. Four title/duplicate regressions now pass.

Second independent review rejected c124b792b: a fenced-code table could lend context to actual prose. Actual regression RED: 1 failed / 281 passed. The shared Markdown parser now reads only adjacent top-level plain paragraph/table nodes; code and blockquotes cannot supply plan context. GREEN 282/282.
