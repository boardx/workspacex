# Complete platform telemetry settings localization

Issue6237; next B8 page `/platform-admin/telemetry`. Existing approved telemetry behavior and consent decisions remain authoritative. This is display localization under the user's continuing whole-i18n instruction, not a new consent flow or API.

## Behavior

- Render the complete screen in Chinese/English: page chrome, four independent switches, their consequences, enabled/disabled/pending labels, reporter state and interval, last-attempt time/outcome/omitted sections, original report body and loading/empty/permission/failure states.
- Language switches preserve pending ownership, current booleans, report object, request counts and mounted controls. Locale never enters request effects or restarts a save. One click sends exactly the existing PUT body containing that one consent item; all switches remain disabled while one save is pending. Response remains authoritative; failure leaves the old value.
- Store semantic failures and translate on render. Known permission/validation causes and safe shared HTTP fallbacks never expose private messages, exception details or internal codes. Loading, failure and empty remain distinct.
- Original consent meanings/defaults/version, role authority, schemas/IDs, methods/paths/bodies and reporter timing/collection/transport are unchanged. Both settings/last-report reads and consent PUT use PlatformOperatorGuard, not organization-admin authority.
- Preserve raw report JSON, key/value order at the actual input boundary, numeric precision and underlying timestamps. Human labels/dates may localize; JSON machine identifiers/units/data do not.
- Every relevant control/label and error must be usable at375/1280, with native scrolling for the existing JSON code panel. No clipped role-like labels, forced clicks, clock changes or budget/retry extensions.

## Copy authority and approach

Chosen by root within the authorized scope: one page namespace, semantic state, existing provider/shared HTTP copy and canonical typed enum maps. Chinese consent label/ifOff values reference `instanceTelemetry.TELEMETRY_CONSENT_COPY` directly; they are not declared a second time. English supplies faithful display translations. Existing namespace imports from contracts provide the established pattern.

Alternatives rejected: duplicating contract Chinese in a local catalogue creates drift; changing shared contract/API or adding a parallel translation provider expands the feature unnecessarily. This is root's implementation choice, not a new human-signoff assertion.

## Verification and delivery

Native meaningful component RED precedes production edits; preserve the existing three contract-copy/one-item-write/denial tests. Cover deferred reads/writes, both locale directions, all closed reporter/outcome states, safe errors, raw JSON and independent flags. Retain original API/controller/contract/worker bytes.

Canonical real UI/API/PG acceptance uses the published6234 dedicated platform fixture. Configure `WSX_TELEMETRY_DISABLED=1` only for the isolated test API: reporterState is kill_switch and the worker starts no timer or network. Synthetic persisted last-attempt history may be seeded as a read prerequisite, explicitly not evidence of real sending. Real consent mutations/readbacks/reloads, designated operator allowed and ordinary/revoked actor403 must be actual.

All planned16 final375/1280 PNGs are individually reviewed; raw logs/JSON/traces stay private. Own containers/volumes/all11listeners must be zero and peer slot released before QA. Independent task/runtime/final reviews, canonical credential scan, normal hooks/push and one PR are required. Main exclusively owns CI/queue/server merge.

Parent6234 actually merged into develop at2026-11-04T14:35:23Z asb992054dd498530092d09a1fa559f0b12a33406b (publishedhead715d), and issue6224 closed14:35:25Z; root independently verified the live GitHub fields. Normal incorporation of this accepted parent is required before GREEN. The earlier715d unaccepted-stack permission is now historical. If pending at publication, create an explicit Draft stack PR; after its actual merge, target develop with fresh CI. Never count feature-base merge as delivery. Root owns active6237 through its first actual CI failure and green delivery. Reuse this worktree; fetch main/develop, no new worktree.
