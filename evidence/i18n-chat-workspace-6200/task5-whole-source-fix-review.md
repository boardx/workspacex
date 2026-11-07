# Chat6200 true source fix delta — static follow-up

Frozen snapshot: /tmp/chat6200-review-fix-current-private
Manifest FILE SHA256: 17cb1dba404bcc0209cad800cc2fa771a05461ca1633def0f716270a18140340.
Baseline: earlier whole-source snapshot manifest FILE SHA256 1d65af8f5d9317e419c695c2d957372f602a752b3bddfbb3523e7c5b61479e4a (payload b03c…, durable f695 plus captured PlanControl WIP).

All 46 protected file hashes independently match the manifest. Review is limited to the actual 26 source/test changes: 9 component paths, 8 helper paths, 3 namespace paths and 6 tests. Files not present in old changed-only snapshot (e.g. panel wrapper and original runtime helpers) were compared against immutable f695, avoiding the misleading full-new-file spans in source-delta.patch. No mutable WT source was substituted.

## Verdict

**Both original grouped P2 findings are statically addressed in this delta. No new confirmed actionable i18n Critical/Important/P1/P2 finding.** This does not assert current GREEN, type/lint success, image QA or fresh browser acceptance.

## P2-1: runtime/restore/notice/suggestion seams

- Actual controller attaches explicit owned provenance only at closed run-error formatter/outcome producers; plain string values exit renderChatDisplayText unchanged, even if their content resembles an owned label. Error classification, authoritative read, reattach/recovered branching, retry and raw payload logic are unchanged.
- ownedRunError mapping is built from the original closed error/reason enum cross-product and original formatter outputs. Known transport messages and unknown/generic owned outcomes use typed keys; default zh returns original text. English conversion delegates known code/reason to the existing localized PlanFailure helper with cloud semantics, matching the original run formatter's semantics; it does not add local-edition advice or expose unknown internals.
- Phase factories are unchanged. Added phaseLabelOwned is optional on public props and defaults to raw behavior. Only actual canonical controller, whose labels originate in existing own phase factories or closed restoration status, emits true. It is forwarded through panel/shell to inspector and view; custom caller labels without provenance remain verbatim.
- renderChatPhase uses a closed exact static map, then exact factory-generated prefix/suffix slices for named tool/skill phases. The inner raw tool/skill string is preserved, including braces and Han content, rather than passed through an arbitrary Chinese regex or catalog-name guess. Unknown owned labels fall back raw. Default zh returns original label unchanged.
- Trace/auth/stalled/unconfirmed/voice-empty/voice-saved/recovered notices now store owned semantic keys at original producers and render at current locale. Known run errors retain original formatted text plus explicit provenance. Recovery diagnostics/custom strings remain raw.
- Existing transition announcer reads current locale via ref; its running-transition gate and original effect dependencies stay intact. Locale itself does not trigger SSE subscription, requests, resend, or state reset.
- Persona producer state uses owned key plus raw reason params. Local suggestion chips retain old default-zh label and add optional labelMessage; FollowUpSuggestions translates only that explicit metadata. Existing prompt, template ID, displayName/raw name params, onSelect/onDismiss, disabled and generated-message behavior remain unchanged.

## P2-2: remaining reachable copy

- MessageAttachments now consumes provider and uses existing chatInspector.file.skill key for the skill-draft badge. Its predicate, file name/ID, preview selection, byte/MIME and upload lifecycle are unchanged.
- Feedback draftSaved receipt uses a new typed key in both locales; draft state/body/storage/route/POST logic is unchanged. Current snapshot's namespace comma issue is fixed in source.
- Existing PlanControl resume/action-error copy uses typed current-locale keys, retaining raw actionErrorCode and unchanged resume callback/canWrite/busy guards. Disabled pause remains disabled; no unmounted feature is enabled.

## Noninterference / compatibility checks

- Independently compared controller effect/callback/memo dependency list against the previously reviewed snapshot: 48 before, 48 after, all ordered dependency arrays identical. New locale hook/ref adds no request callback dependency.
- Runtime helper extraction is literal-only. RUN_RESTORE_PHASE_LABEL, REPLYING_PHASE_LABEL and RUN_RECOVERED_NOTICE literals independently match immutable f695; original compatibility exports remain. TRANSPORT_ERROR_TEXT values/classification are relocated, not reclassified. The new module imports original phase factories and pure labels; namespace imports point to dependency-free labels/factories rather than back to chat-runtime-display, avoiding a new namespace cycle.
- PlanControl removes only two empty resource entries whose authoritative contract returns null advice (HITL_REJECTED/MODEL_CALL_FAILED); display mapping skips those same entries. No contract, advice precedence or error/retry state change.
- A static TypeScript parse of protected .ts/.tsx copies found no parse diagnostics, including feedback-overlay.ts. This was source parsing only, not typecheck/build/lint/test execution.
- Read new provider assertions for actual restored-parent/chrome/attachment/feedback seams. They retain original locale/raw DOM/no-extra-call checks and add explicit owned-copy cases; test inspection does not certify their outcomes.

## Evidence / remaining boundaries

Author's initial semantic RED, two corrected-driver semantic REDs, and later collect failure remain separate. The reported 19-suite attempt with missing namespace comma had 18 collection failures and 5 passes; it is not GREEN. The comma is now statically corrected, while fresh GREEN/type/lint remain pending. The prior seven-browser/geometry/ENOSPC boundaries are inherited, not upgraded by this source fix.

No tests, typecheck, lint, init, build, browser, network, services or raw/private trace/log reads were performed. No source/index/branch edits. Only this private report was written. Non-i18n preexisting behavior and minor prose-comment cleanup remain explicitly deferred as instructed. Later acceptance should review only genuinely changed source and fresh runtime/evidence deltas, not repeat the whole branch pass.
