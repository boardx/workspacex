# First production-browser run — source e8ece66846e6edc82546bc3ec0f01f0140b5eddd

Observed exit0: 1/1 test passed, case59.7s, isolated wrapper total4m59s (command4m58s,cleanup1s). Own compose scope `wsx-ec04e55844377d871f94` was dynamically checked after completion:0 containers.

The exact discovery arguments were reused with only `--list` removed. This run built fresh production output, used real login/API/PostgreSQL and the existing deterministic model fixture. The source was committed before execution. All10 PNGs have been inspected; their hashes are in screenshots.json. The runner log remains local in this folder; the permanent browser receipt is to be added after the final follow-up.

Verified business journey: intake raw name/goal across languages; unsaved-change recovery; actual persisted /import; plan draft/save/reload; report generation; language change without extra commands or canonical report changes; actual regeneration and independently preserved previous report; list metadata save/reload and deletion cancellation. Both375 and1280 document-width assertions passed.

Visual QA found an additional issue despite this functional pass:375px completed-step labels truncate the long English “Confirm research details”. Source inspection also found a hardcoded Chinese “已完成” in the same indicator's screen-reader text, outside the previous changed-file scope. The added unit counterexample and actual step-label geometry assertion have been written but have not run at this point. This first run is preserved as evidence of that finding, not presented as final visual acceptance.

Full-page history captures show sticky elements at the current scroll position. The follow-up screenshot helper resets scrolling before capture; source report content, including mixed source-language headings, remains intentionally unchanged.
