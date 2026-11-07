# Compiler verification fix

Root supplied an actual web type-check failure (exit 2, 39.91 seconds) identifying TS7006 in three feedback consumers and TS2769 in one role query. This worker did not rerun that command or any tests, lint, build, Git or resources.

Changed only these source/test files:

- `apps/web/components/admin/member-quota-tab.tsx`
- `apps/web/components/admin/member-invites-panel.tsx`
- `apps/web/components/admin/limit-rules-live.tsx`
- `apps/web/tests/ui/ai-usage-i18n.test.tsx`

The three product files now annotate the outer feedback state updater return type as `MemberFeedback`: `setX((): MemberFeedback => ...)`. This supplies contextual typing to returned nested translator/locale callbacks despite the React setter union. Existing translator MessageKey restrictions stay enforced. Also annotated wrappers returning an existing feedback function consistently. No any, casts or suppressions were added. These are erased TypeScript annotations: closures, state values, locale timing, dependencies, API calls, runtime branches and state transitions are unchanged.

The single test change removes unsupported `exact: true` from the getByRole options for the exact string name `成员原文 {name} · 8`. Testing Library role queries match string names exactly by default, so the expected text and assertion strength remain unchanged.

Source is frozen for root validation. No tests/type/lint/build/Git/resources were run by this worker; root compiler rerun evidence remains pending.

Rootactualcoveringcompilerproof: `pnpm --filter web typecheck` exit0/11.62s/no timeout after4fileannotation/testoptionfix. Initialexactcommandexit2/39.91s withreportedTS7006/TS2769 ispreserved. API`pnpm --filter @repo/api typecheck` separatelyactualexit0/52.13s; sourcefixtureincluded. No runtimecodechanges; all prior47/22/52units remainrecordedbeforeerasedannotations, no rerunclaim. Rootheavyprocessesallactuallyexited andpriority6147windowreleased. CanonicalAPIlintbudgettimeout124 andinit/static/browser/finalwholebranch remainpending.
