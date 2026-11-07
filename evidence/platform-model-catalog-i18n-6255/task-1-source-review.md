# Task 1 independent SOURCE spec / quality review

Verdict: **CHANGES REQUESTED — one P2 source-spec finding**. No P1 found. This is a source review of the immutable candidate, not runtime, branch, native-route or merge acceptance.

## P2 — Reuse existing shared generic copy rather than declaring it again

Location: `apps/web/lib/i18n/namespaces/platform-model-catalog.ts:9` (also lines 14, 106, 115 and 149).

Five new paired entries reproduce existing shared paired resources exactly:

| New duplicate | Existing resource |
| --- | --- |
| `catalog.refresh` | `common.refresh` in `namespaces/controls.ts:6` |
| `catalog.retry` | `adminCommon.retry` in `namespaces/admin-common.ts:2` |
| `disable.guard` | `controls.reasonBeforeConfirm` in `namespaces/controls.ts:7` |
| `disable.reason` | `controls.auditReason` in `namespaces/controls.ts:8` |
| `core.saving` | `common.saving` in `namespaces/controls.ts:3` |

These are identical generic meanings and EN/ZH values, with no model-specific interpolation or context. Keeping independent copies means a correction to the shared refresh/retry/reason/audit/saving labels will leave these mounted controls stale. This violates the requested reuse of existing generic entries and repository single-source rule. Use the existing keys in EntityCatalog, DisableDialog and OrgCoreModelPanel and remove these five new resource entries. No broad shared-resource migration or unrelated cleanup is requested.

## Source assessment

Read all 1,302 candidate diff lines in three bounded chunks, the spec/plan/brief/report, preservation manifest, baseline protected map, and all 401 lines of the frozen new component test. Read actual source narrowly for stable-tag identity, provider translation/interpolation behavior and existing shared-resource authority; the eight candidate source files matched their manifest hashes at inspection.

- The diff remains within the five mounted components, paired namespace and two dictionary import/spread additions. No helper/SDK/contracts/API/provider/accounting edits appear in the candidate.
- Fixed owned copy and accessibility strings are projected through the provider; raw IDs, vendor/name/user metadata, model facts/source titles/URLs and positive prices remain interpolated unchanged. Existing zh-CN numeric formatting and exact currency/price representation remain intact.
- Original status-tag values feed `tagOf` separately from translated labels, retaining `enabled`, `untested` and `t-672a-542f-7528`. Public raw capability/vendor filter values and the filter helper remain unchanged. Chinese public capability/modality labels reuse their existing constant source.
- Effects, owned read callbacks and save ownership guards do not gain locale dependencies. Existing query/tab/selection/draft/checklist/reason state and component keys remain. Semantic known errors/toasts translate during render, preserving unknown raw reasons where previously displayed and excluding ApiError private bodies.
- Local enable/disable and manual assessment remain local state operations. Existing backend limitations and public pricing/account/adapter uncertainty remain explicit in translated copy. No missing backend operation is implemented.
- The frozen new tests describe meaningful localization, state/ownership, payload, price and raw-data assertions; they are component tests with SDK mocks, not evidence of native authorization/persistence behavior.

No additional actionable P1/P2 source defect was identified. This assessment does not establish that the tests collect/pass, strict types or lint pass, locale switching behaves correctly in the native runtime, or 375/1280 layouts fit. Root must execute those gates and cloud/native evidence independently; source inspection is not runtime proof. The root-supplied Stage A RED (66 cases, 41 legacy controls + one raw positive pass, 24 meaningful new failures) is context only and was not rerun by this reviewer.

## Immutable identity reviewed

- Candidate base / frozen-test commit: `a173a62f42d26f14bdb66f1286b54fa378cfdb69`; underlying baseline: `ef49474134137e7d07cef97577d4799fbd9c0eb8`.
- `task-1-source-candidate.diff`: 96,211 bytes; SHA-256 `a620faa112434b144db6c41978d0570937406dd783a55c1bcaae12099fb0329b`.
- `source-candidate-preservation.json`: SHA-256 `079262e74f99cfe675358a871641052d8fd0aa2ea9045364e5675d32b6904211`.
- Frozen `platform-model-catalog-i18n.test.tsx` read SHA-256: `1fcb2aaf3d4dfc62e1ec555cc3022374f7590c6fba140e8ddf9d863c77cc73d1`.

| Candidate path (under apps/web) | SHA-256 |
| --- | --- |
| components/admin/bailian-model-catalog.tsx | `790ef02d9d19ea04f277e0f3d058c216d3f857f895b5e5027f5e351cea02bf5b` |
| components/admin/disable-dialog.tsx | `3d5f776c3789764498941e4fe04d9177b8d308237fa98d4e587acbb1ec9d8d48` |
| components/admin/entity-catalog.tsx | `b221c62701fa1d78238e0d0bcd1619241c4d79266ae1d3d588f1db1094231a6f` |
| components/admin/model-screen.tsx | `e9a1b73fbb193d887fdf02efd3e77c14f7d3c0a95d15fbf7f1df83902bc031cf` |
| components/admin/org-core-model-panel.tsx | `465e5c36684803f29637094fb5363d8b264d3b2ebaab9e30838090bdbdaee9bb` |
| lib/i18n/messages/en.ts | `fd79e7053bb6a190051f6a1d145151a0f651506b838fe62d6e61bab5a6ceb942` |
| lib/i18n/messages/zh-CN.ts | `0799cfb09439802eadd78ce8e57ac1790257b2d429c806a80be815508a7a964b` |
| lib/i18n/namespaces/platform-model-catalog.ts | `6faf9a2af55149e1f9fb6f69844c1d54f8b22f47891dbaee85b8a59d6a84bc4d` |

Reviewer performed read-only inspection and hashing only; no test/type/lint/build/browser/service/network/normal-Git commands, public edits or subagents. This private review is the sole file written by this reviewer.
