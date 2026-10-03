# 四数字人与实时语音验收进展

R1基础模型：issue #5124；main基准75addf492。已复用三云端补丁，init快速路径、API45/45、Web43/43、两端typecheck/lint通过。真实Qwen文本及实际PCM输入/模型音频输出已验证。新composition浏览器连接/静音/挂断复验通过；仍没有输入音频或保存记录的通过证据。专业与真人语音全量验收未通过。

R2研究：DevApp D002自称通用协作者、声称无Skills，背景硬门失败；会话thr-7b9b2172-d861-4a0d-83a0-f953db3532d2，截图/输出另存r2。下一步核对已发布角色版本、run冻结instructions/skill版本和native模型请求。

R3产品、R4设计、R5集成（含D005内部能力）：未开始。

不部署；用户后续已授权修复 PR 并在全绿后合并 Main。所有角色暂不评分为9分；无平均分补过。

## R1 CI regression follow-up

Rebased onto origin/main `7cc6d6a07`, incorporating the existing whiteboard keyboard-insert test repair. The first CI core-loop failure reached succeeded/exactly-once/refresh persistence, then lacked the script fence. The test-only API composition had skipped process-start platform Skill self-heal. It now calls shared `startApi` with only isolated endpoint/listen settings injected, retaining catalog initialization and retention/run recovery. API typecheck and voice unit tests (45/45) pass after the fix; full CI revalidation remains required. No assertion was removed.

Online D002 baseline failed background and Skill availability: selector D002, response general-purpose knowledge collaborator, Skill picker available 0. Evidence in r2 remains baseline, not acceptance.

## 2026-10-03 R1 merge / R2 follow-up

User explicitly authorized repairing PR problems and merging to Main, superseding the earlier no-auto-merge request. R1 PR #5128 passed all 24 non-skipped checks and independent exact-SHA review, then merged to Main as `e4ce1c30cf6f0e4bdf5f15b514cb830d8924f6e3`; issue #5124 closed. No deployment action was performed.

R2 issue #5185: only D002 upgraded through existing DevApp admin UI from 1.5.0 to 1.6.0. Correct identity restored, but Skills remain pending and real professional execution selected unauthorized W029. Added guarded same-pack additive verified-Skill refresh and frozen authorized workflow catalog context. API unit/context regression 30/30; real PostgreSQL tests await CI. Actual model brief had fabricated initial quotes, corrected second prose, wrong date/workflow number and missing governed provenance. User-assisted artifact draft open/save/full refresh/reopen passed. R2 report and screenshots remain failed/incomplete acceptance evidence, not 9/10 delivery.
