# CI template validation follow-up

Source 5c558b71d548e3626ebdaf47a3e898582ac4763a. verify-affected job110920643872:6992 passed, one chat-canvas-fence test failed (expected builtin, received null). Container exists in loading state; data-template-source is set only after valid async template resolution.
Unchanged focused baseline15 passed, demonstrating timing sensitivity. Controlled deferred template response reproduced original immediate assertion:1failed14passed. After waitFor exact builtin, same file15passed exit0. All error/body/code assertions preserved; no runtime/export changes. ESLint and diff check passed.
Command: pnpm --filter web exec vitest run tests/ui/chat-canvas-fence.test.tsx.
Logs /tmp/pr5127-fence-baseline.log, /tmp/pr5127-fence-red.log, /tmp/pr5127-fence-green.log. These focused results are not full CI green.
