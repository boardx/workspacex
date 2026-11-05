# Live confirmation locale and B5 closure

Issue: [6263](https://github.com/boardx/workspacex/issues/6263). Explicit main scope: only the proven live query confirmation pending status plus complete B5 evidence closure. Stack starts from published6261 head9bc4e913; parent actual merge remains a dependency. Same checkout, no new worktree/agent/services.

Use the existing provider in GuidedResearchFlow and one paired research resource for `正在分析研究需求…` / `Analyzing research requirements…`. No lifecycle, request, idempotency, raw data, model/parser/API changes. The status is reachable through actual BriefScreen→ResearchIntake.onPending. Restoration paragraphs have no proven live reachability and remain out of scope.

One focused real-flow unit case holds creation at the existing adapter, changes locale on the same status DOM, verifies unchanged raw payload and exactly one create call, then releases through existing failure recovery. One appended actual query-route browser case holds the response from the actual creation API, changes locale pending, releases to normal saved route; two375/1280 English pending captures. Prior two cases remain byte-exact. No old51 rerun or expanded screenshot matrix.

B5 evidence closure retains research/interview original journey boundaries, actual recording deletion404, #6261 controlled assistant HTTP boundary and final source/run/checkout-parent/22PNG identities. Persisted questions/default expert content remain raw; mock preview copy belongsB10; #6239 stays deferred. Stage completion requires both actual merges and MAIN full-stage acceptance.
