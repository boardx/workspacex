# Final Web check after contract rename, skill metadata and release opt-in wiring

Worktree `/workspace/aidt-pr-20261117`, HEAD `1a2ec212d38635a60b1337cc4a949ec564c0d7a8` plus the final uncommitted contract/metadata/release changes. Exact source blobs and dirty paths are captured in `/tmp/aidt-pr-web-final-validation.json`. No source was edited by this reviewer.

- Final nonincremental Web typecheck: `pnpm exec tsc --noEmit --incremental false` exited **0**; diagnostic log is empty. Evidence `/tmp/aidt-pr-web-final-typecheck.log` and `/tmp/aidt-pr-web-final-typecheck.exit`.
- Targeted ordinary Chat/module opt-in regressions: **9 files, 99 tests passed**, **exit 0**, 18.37s. Evidence `/tmp/aidt-pr-web-final-opt-in-chat.log` and `.exit`.
- All commands sourced `/tmp/aidt-pr-env.sh`; Vitest worker cap was 2. No browser, Docker, paid model, registry I/O or deployment was started. No repetition of the prior full 818/192 suites.

Targeted files: `aidt-entry-isolation-config`, UI `aidt-entry-isolation`, UI `aidt-module-compatibility`, `aidt-module-boundary`, UI `project-member-chat-launcher`, UI `project-member-chat`, UI `copilotkit-v2-host-run-context`, UI `workbench-composer-draft`, `live-project-member-chat`.

The tests cover missing/false AIDT flags rejecting both `/aidt` routes before teaching UI import; explicit true/1 opt-in; ordinary tagged-project links/listing, create-project contract, Studio returns and Chat templates remaining correct; actor/token isolation; independent member launcher disabled/unauthenticated idle behavior; frozen-selector retry preserving newer drafts/attachments/mentions. A search found no old `projectMemberChat.ReadOnlyReason` consumer; the new `MemberChatReadOnlyReason` is used by its contract's Access schema. Full Web typecheck passed after this rename and the hidden teaching-skill metadata additions.

Release wiring review: workflow `enable_aidt` defaults false for both dispatch/call inputs; Web Dockerfile's two public ARGs default 0 and are supplied before Next build; plan validates an explicit true opt-in only for devapp with a newly built tag; build validates 0/1 values and forwards them only to Web. The UI flags remain independent in application code; this optional release input intentionally builds both. API runtime flags and schema admission remain separate. These are source/plan observations, not a built image or deployed `/aidt` proof.

Boundary: reuse of an existing tag with opt-in false does not attest that tag's compiled AIDT flags. The script explicitly says this in its summary. Do not claim that every reused image necessarily excludes AIDT or that runtime env changes can enable/disable already inlined public flags. No production action is authorized or performed by this check.

Machine-readable receipt includes log SHA256, exact source blobs, exit codes, command environment and test summary: `/tmp/aidt-pr-web-final-validation.json`. The prior full verification report remains `/tmp/aidt-pr-web-validation.md`; its post-contract 67-test supplement overlaps its full AIDT suite and is not additional unique coverage. Remote CI, image-build and devapp/human acceptance remain distinct tasks.
