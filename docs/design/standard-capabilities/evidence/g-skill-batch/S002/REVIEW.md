# S002 acceptance history and final verified result

The sections below preserve earlier failures chronologically; final acceptance is recorded in the last section.

The actual model loaded web-research and its reference, made a research plan, and successfully queried the production Google search adapter twice. It then requested four real official URLs concurrently; StandardWebError terminated the graph before report publication. Live wrapper exited 1 and cleaned up.

A subsequent sequential, no-DB probe of createStandardWebService().fetch on the same URLs showed both docs.langchain.com overview URLs time out under the existing deadline; www.langchain.com/deep-agents and www.langchain.com/blog/deep-agents-vs-langchain-vs-langgraph succeeded with 2884 and 10011 extracted characters. See public-fetch-probe.txt. Thus parser-concurrency exhaustion is not established as this failure's cause. No response body is fabricated and no timeout has been increased.

The current hard exception prevents the model from using other successfully available public sources. This scenario remains unaccepted pending a safe observable failure behavior and complete real report/source review.

## Narrow failure projection

Only an actually received HTTP 503 is now projected by the tool as a fixed `ToolMessage(status='error')`, with its actual injected tool-call ID. No upstream response body is exposed or counted as content. Authority/schema/other status failures and unknown transport failure still raise. No retry is introduced. The real official StateGraph/ToolNode countertest first failed with StandardWebError, then passed; 13 targeted tests pass including 401/403 and one-dispatch timeout countertests. Command: `apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_standard_web_unavailable.py apps/deep-agent-service/tests/test_standard_web_tools.py -q`. See tool-failure-before.txt and tool-failure-after.txt. Real-model report rerun remains pending.

## First real rerun after projection

The model observed explicit error messages, selected other real official pages, and published research.md after 25 actual tool calls. The graph then hit the existing test recursion limit of 200 before normal completion; wrapper exited 1. Raw output and trace are retained as live-after-recursion.txt and recursion-before-trace.json. The DB wrapper cleaned up and was handed to the next worker. No limit was increased.

Manual review also found abbreviated source IDs/hashes, an extra URL labeled fetch-failed without a corresponding fetch call, and over-broad version applicability based on a dated article. Hence report existence is not semantic acceptance. research-before-semantic-review.md preserves this actual generated draft. The next scenario explicitly requires full identifiers and actual call-outcome consistency; the test requires a complete source ID/hash pair from a successful fetched response, alongside manual claim/version review. Node-update counts were added to the runner to distinguish normal middleware steps from a real loop before any budget decision.

The parent approved removing the newly invented live-runner recursion settings (200 positive/100 negative) after the companion S015 dynamic trace proved ordinary hooks consumed 200 nodes at only 18 model calls. This runner now uses the same official default as production; the existing 25-model-call middleware cap and 240-second subprocess deadline remain unchanged. This budget alignment does not waive the independent semantic citation checks.

## Final real acceptance

The final live wrapper exited 0 and cleaned up (2m28s). Actual qwen3.8-max completed the research, published research.md and committed real artifact-version writeback. Negative arithmetic made zero tool calls. Two real searches and five actual fetches match the report's budget table: four successful full texts and one explicitly unavailable source.

Manual plus mechanical comparison verified all four successfully used pages' full sourceId and contentHash exactly match the real fetch responses, and each has truthful non-truncated status. The failed Deep Agents overview is labeled search-snippet-only, not successfully read. The relationship claims are supported by successfully read current official blog/product/overview content; the report expressly limits older-source applicability. A shorthand in one prose citation points to a full ledger entry, rather than replacing the ledger identifier. The optional interpretation that low-level control may favor a lower-level framework is explicitly labeled inference, not source fact. This passes the representative public official-source research scenario; it does not promise availability of arbitrary websites.
