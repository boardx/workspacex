# Research / interview stack integration

Exact integration source: `902da4b5a9d4faaac425b41d4d58c6cdca169939`.
Normal merge parents: actual research remote `baf5eb97bcf776f507c1deeced9ff1f93dc9fdf9` and develop `dc9bc31b5658aacd4376ffa3f66e6794293ac953`.

PR #6213 merged interview into the research feature branch, not develop. Its merge tree equals interview source ec3d35d. PR #6205 therefore now carries both reviewed research and interview journeys. Neither journey is claimed delivered on develop. No reset, force push, rebase, retarget or second merge of #6213 was used. Recording branch 7402357 and its 17-file caption stash 98653ef remain protected separately.

`blob-mode-proof.json`: all 326 non-overlapping worker paths preserve their original blobs and modes; all 111 non-overlapping upstream paths preserve theirs. Only the two locale registries overlap; the actual integration adds the activity import and spread in each registry. Candidate tree is recorded before any evidence additions.

`dictionary-proof.json`: both locales contain exactly the complete 2,234-key union, preserve every worker and upstream value, have identical keysets and interpolation placeholders, and retain both sides' imports. All 137 evaluated dictionary objects have unique effective keys, including spreads. There are zero conflicting source values. The read-only checker evaluates versioned sources and imports; it hoists ESM imports before its CommonJS simulation to preserve ESM semantics (several imports are intentionally declared below the exported dictionary). An initial checker invocation without this simulation fix failed with a temporal-dead-zone error; this was a checker defect, not a product change.

Reproduce from repository root:

```sh
node evidence/i18n-research-6198/stack-integration/dictionary-proof.cjs baf5eb97bcf776f507c1deeced9ff1f93dc9fdf9 dc9bc31b5658aacd4376ffa3f66e6794293ac953 902da4b5a9d4faaac425b41d4d58c6cdca169939
```

Prior research ten-image and interview twenty-two-image browser evidence remains evidence for its recorded source only. No new browser, current integration typecheck, focused regression, init, push, CI or develop merge is claimed by these static proofs. Those gates remain pending at this point.
