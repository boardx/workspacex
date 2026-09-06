# Peer permission path recognition

Commands from worktree root:
```
node --test apps/api/scripts/tests/workbench*boundary.test.mjs
node apps/api/scripts/lint-permission-paths.mjs
```
Both exit 0; 34 tests passed, 1254 source files scanned, 199 tenant tables, ALLOWLIST unchanged at 91.

Eight explicit structural boundaries replace 52 false reports from an import-only rule. No runtime authority or allowlist entries are added. Queue public methods retain resolveVisibility/write role checks; dispatch re-enters acceptHumanMessage as persisted actor. DB fencing only reads id with org/run/epoch/expiry. Interjection public controller authorizes before listing. Parent execution authority retains locked callback, exact approval arguments, and authority decisions. Recovery only reconciles bounded existing runs. Artifact continuation binds an authorized immutable version; launch re-enters message acceptance; registration binds existing output attachments in writeback transaction.

AST traversal restricts static SQL, table sets, tenant predicates and method surfaces; call-site checks tie the special readers to existing authorization. Mutation tests remove tenant predicates, replace tables, remove controller/queue authorization, change actor, remove lease/expiry/argument/source-version/attachment checks and require rejection. These are structural regression tripwires, not proof of all possible program behaviors or a replacement for runtime authorization. Existing peer runtime tests are separate; no DB stack was run here.
