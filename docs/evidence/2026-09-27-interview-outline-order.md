# Interview Markdown outline ordering

Refs #4464. Continuation after the text-import batch; uses the same worktree.

- Added AST-based adjacent sibling subtree ordering. Nested follow-ups and stable references move with their parent; question groups cannot cross expert boundaries.
- Added accessible upward/downward controls, disabled at sibling boundaries and during pending writes.
- New groups append without trimming the original Markdown, preserving CRLF and trailing whitespace.
- TDD: missing helper failed first; corrected fixture heading indexes after inspecting the shared parser. Final focused regression: 3 files / 34 tests passed.
- Web typecheck and lint are checked separately before committing.

Not complete: granular question title editing, persistent runtime recovery/pause, complex Word export fidelity, full real-browser/model validation. This is a partial redesign batch, not a claim that the whole workflow is complete.
