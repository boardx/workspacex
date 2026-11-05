# One global authority per native tariff key — #6290 / #6298

The user requires the same per-model retail price for personal and enterprise payers and every current/future organization. This stacks behind #6297 exact2a7b6331d37a9d808fd00a9de961749e8c393b58. Image fixed CNY prices and activation remain owned by that PR; its approved fixed prices supersede the older image×10 policy. ASR remains supplier×3 and its canonical approved credit quote. Different models retain different prices. No CN/US database/configuration is activated by this branch.

## Disjoint writable authorities

- `bailian-image`, every unit: only #6297's global image CAS schedule. Three supported image profiles retain that contract, fixed-price helper and activation CLI unchanged. Other units/unknown models fail closed.
- Every other provider/model/unit: `credit_global_native_tariffs`, keyed without organization. A DB CHECK excludes the entire `bailian-image` provider, not just known models or image units. There is no legacy organization fallback.
- Both reuse one existing `app_billing_tariff_writer` pool/config/role. `app_rw` has SELECT only; an operator-authorized native upsert uses the borrowed writer and append-only audit. Missing credentials fail explicitly. Image service retains the pool's single closer; native service does not create or close another pool.
- The native platform DTO/query/UI have no organization price input; strict schemas reject legacy org-shaped writes and all bailian-image writes, directing operators to image CAS. The existing image CN quote endpoint still accepts its required organization context; that context does not choose a price. Model-testing APIs/immutable image contracts are not globally reinterpreted.

## Atomic migration and compatibility

`20261105170000_global_native_credit_tariffs.sql` depends on image1600 and its writer role. Unmerged old0900 is removed. In one existing migrator transaction, row_security=off and an exclusive old-table lock precede consolidation. Non-bailian rows normalize integer ratios with gcd. Equal ratios with differing metadata merge deterministically; conflicting ratios abort with model/unit keys. No arbitrary lowest/latest org price is selected. Legacy image rows are retained, never copied into the nonimage writable store.

The original table becomes `credit_native_tariffs_legacy`; app/PUBLIC privileges are explicitly revoked. A SELECT-only security_invoker/security_barrier view keeps the original name and unions two nonoverlapping sources for the current trusted org: global nonimage rows and image schedule JSON. All view DML is explicitly revoked. New organizations need no copied prices. The shared freeze-policy installer handles the renamed legacy relation.

A repeated1700 validates relation kinds, columns, primary key, rate/version nullability and positive/nonempty validated CHECKs, provider exclusion, canonical view fingerprint/dependency, role privileges and append-only audit trigger. Partial/corrupt cutover refuses completion. The one exact historical force replay `20261022120000_credit_consumption.sql` maps only bare old relation references to legacy after this validator succeeds. Its original raw checksum remains unchanged. Legacy grants are revoked again before that replay transaction commits. Normal migration and unrelated force SQL are not rewritten.

Historical admitted requests retain native quantum/rate/version/wallet snapshots. Settlement/replay do not re-read current tariffs. Estimated ASR remains pending; this does not relabel supplier estimates as reported usage.

## Release and rollback boundary

Apply image1600 before native1700, provision the same reviewed writer credentials, then publish the new runtime/UI. Old runtime can continue reading the compatibility view; old organization-scoped mutation endpoints fail closed. App rollback keeps the read-only view and canonical authorities, never restores legacy writes. Schema rollback requires an independently reviewed quiesced conversion and is not a normal application rollback.

Canonical approved retail snapshots may be promoted across deployments only after live target/source checks. Supplier endpoint geography is cost metadata, not an automatic retail repricing instruction. Root-private CN/US prepared snapshots remain PENDING_NOT_BOUND; no runtime activation is claimed here.

## Required verification (integrated tree not yet tested)

- Isolated PG: ASR33/4300 across personal/team/new org without copied rows; newer request freezes new price/version; old request settles old snapshot.
- Three image fixed profiles across both payers/new org through unchanged CAS; zero duplicate bailian rows in the nonimage authority/view. Unknown model fails closed.
- Real restricted writer can mutate authorized nonimage prices; app/view/legacy DML and nonoperator/legacy-org/image writes refuse. One shared writer lifecycle.
- Equivalent migration ratios consolidate, conflicting values fail, forced RLS cannot hide rows, missing rate CHECK/NOT NULL rejects repeated cutover.
- Two complete independently timed force passes in the exclusive DDL lane plus default migration no-op; global/image/audit/request values and original historical checksums preserved.

```mermaid
flowchart LR
 A[Accepted disjoint-source design] --> B[Post-image1700 and shared writer]
 B --> C[Runtime operator contract and compatibility]
 C --> D[Exclusive PG and permission tests]
 D --> E[Independent review and CI]
 style A fill:#d9d2e9
 style B fill:#ffe699
 style C fill:#ffe699
 style D fill:#ddd
 style E fill:#ddd
```
