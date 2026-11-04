# Accepted recording integration

PR #6227 was created at `3d9d56f9eae8fece1b4d7e452e5a349c4650b6f8`. Its first remote readback was conflicting because accepted recording PR #6220 had advanced develop to `323b9f0769d18a5517ee6704aeb68b05400903ad`.

Normal merge source `ce8e561d461cf29d467e8cbc1c1a8e1177b6e559` resolves only the two locale-registry import conflicts by retaining both sides. Both registries add exactly eight lines and delete zero relative to each parent. All other common, worker-only and accepted-only paths preserve exact Git mode/type/blob identity, including deletions (see preservation.json). Quota source, tests, browser case and entity-localization config remain byte-identical to the previously measured source. The recording fullstack-smoke configuration is preserved from accepted develop.

The changed assembled catalogs justify fresh runtime resource/count validation: 13/13 in two files pass (3.264s); both registry files pass ESLint (2.304s); init passes (9.186s). Raw output remains private; curated exit/timing/hash receipts are adjacent. The prior 88-case and real-browser/17-image acceptance remain attributed to their recorded source/runtime freezes, rather than relabeled as a new browser run. Final normal push hooks verify the current dependency graph. Independent merge review and publication receipts are recorded separately.
