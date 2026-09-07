# Real-model test input scope

This test creates a fresh random organization, synthetic actor, synthetic private thread and synthetic message in its own isolation wrapper. It does not query existing user organizations or recordings.

The only uploaded input is the literal three-line transcript authored by this agent in `audio-skill-real-model.live.ts`: a decision to retain originals, an unapproved microphone suggestion, and an action whose owner/date are unknown. No actual meeting recording or user document is read. The two skills come from the already verified standard-audio@1.1.0 pack (fixed Apache-2.0/MIT upstream adaptations). The arithmetic negative case is also synthetic.

The model destination is the existing user-configured Aliyun host `llm-jb1kfwgfohl80lle.cn-beijing.maas.aliyuncs.com`, model `qwen3.8-max`. The existing loader loads credentials into process memory without printing them. The output trace records model-visible messages/tool results only; no callback configuration or key is intentionally serialized. Test error output replaces the configured model key. This is the real-model validation explicitly assigned by the parent; it is not a request to send real user meetings externally.

An earlier bundled launch was rejected before execution due to a possible sensitive-audio interpretation. The bounded S009 retry excludes audio entirely. S016 successful live ASR remains blocked because all four KERNEL_ASR configuration variables are absent; no stub is used to substitute success.

## Failed runs retained

- Initial real-model run: actual parallel native reads returned HTTP 409. The real six-reader reproducer and fix are documented in `parallel-read.md`.
- Next run: the real model chose `write_todos`; the test fixture had omitted that actual run permission. The server correctly returned `approval_required`; the fixture now grants this planning tool through the existing grant repository.
- Next run: the fixture's 40-node limit was insufficient for the installed middleware graph (four actual tool calls). The live-only limit is now 200 nodes, with its original 240-second process deadline retained.
- Next run: the model created and read back source-grounded Markdown, then supplied a human-readable artifact title without `.md`. The server required a matching filename extension but the tool schema did not disclose that constraint. The root owner added the requirement to the shared schema description and regenerated it. No prompt workaround is used.

These runs are failures, not G-SKILL passing evidence. Their logs and partial synthetic-only model trace are preserved alongside this file. The generated text in the last failed run correctly distinguished the confirmed decision, unapproved suggestion and unknown assignee/date, but final writeback still required a successful rerun.
