# #6107 — PR6123, migration replay fix validated, normal push/CI pending

Reuse the existing tree `/Users/shenyangjun/boardx/workspacex/.worktrees/team-capacity-6107`, active branch worker/team-capacity-6107. #6111 adapter remains intact on worker/team-stripe-checkout-6111 at8a8ce549bbe244544f73c151779a8b36db426306. Never create another tree.

## Verified

Capacity/P2 runtime source was independently accepted, PG8 + real Kernel HTTP2 + permission/last-admin/dual-review/legacy23 passed. Internal admission narrow AST boundary accepted, pure12 and actual permission scan green. Old reviewed98f archived at archive/team-capacity-6107-reviewed-98f. Clean replay onto design-merged develop6ed excluded old18 design commits and preserves all25 capacity patches. Normal serial prepush25/25 and push succeeded; independent PR https://github.com/boardx/workspacex/pull/6123 Closes6107.

Precision6119 then actually merged as develope676. Normal merge resolved only recovery suffix305→031→040, no050. All capacity runtime/test/helper/031 policy semantics/AST files remained identical to reviewed0f69; root accepted head1a583, normal hook25/25/push succeeded. No dynamic PG/HTTP/Next repeated.

CI actual gates-runtime failed because031's unguarded table creation broke force replay. Minimal independently ACCEPTed source fix e99c94d90 adds table IF NOT EXISTS and DROP POLICY IF EXISTS before both unchanged policy definitions; existing transaction keeps replacement atomic. One owned migrate:check now passed448 empty applications + force448 + identical schema/data digests and populated fixture checks. Raw red/green/suffix logs are beside this file.

## Resource / next step

Last migrate wrapper exited0 and exact compose wsx-adc08fa06f4a78425d7c confirmed absent. Root was notified and holds the next050 migration verification window. This worker has no queue/stack or heavy process. Do not start a normal hook concurrently: wait for root's explicit static release. No source admission change or broad dynamic rerun is justified.

After that release, use the existing normal serial pre-push (temporary pnpm passthrough appends only --concurrency=1 and root shared turbo cache; no hook/check bypass), push current candidate/evidence to existing PR6123, update public final SHA/base/CI boundary. Follow actual CI failures from precise logs and keep owning PR to green; never blindly rerun jobs or claim a local hook equals CI. Root owns final merge/deployment; no sales/passing activation or production reset/epoch action is authorized. Only actual merged future migrations belong in recovery suffix.
