# 契约束 `work-eval` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层；形状单源为 `packages/contracts/src/work-eval.ts`，此处不复述字段，只写行为。

## 统一失败枚举（HTTP）

| 错误 | HTTP | 语义 |
|---|---|---|
| `UNAUTHENTICATED` | 401 | 未登录 |
| `WORK_SKILL_NOT_FOUND` | 404 | 不存在或跨组织，不区分 |
| `WORK_EVAL_PLATFORM_ADMIN_REQUIRED` | 403 | 非平台运营回写（E9） |
| `WORK_EVAL_DIGEST_MISMATCH` | 409 | 门状态 digest 不对应该 Skill 任何版本 |
| `WORK_EVAL_STABLE_ID_MISMATCH` | 422 | 门状态 stableId ≠ 目录行 |
| `WORK_EVAL_G5_NOT_PASSED` | 409 | candidate→verified 时当前版本 G5 未过（E5/E6） |
| `WORK_EVAL_IDEMPOTENCY_CONFLICT` | 409 | 同键不同 payload |
| `VALIDATION_FAILED` | 422 | 结构非法（含手工拼的非 `WorkGateStatus`） |

CLI 退出语义见 `WorkEvalCliExit`：0 OK / 1 case fail|error / 2 套件非法 / 3 夹具疑似真实数据 / 4 回写失败。

## UC-1 `validateWorkEvalSuite`（EV01，CLI/测试）
读 `evals/work-stack/<ID>/suite.json` + `cases.jsonl`；Zod 失败打印文件 + 字段路径，退出 2。
额外校验：`stableId` = 目录名 = manifest `evalSuiteId`；`suiteCoverageGaps` 为空（否则 G3 fail，E7）。

## UC-2 `runWorkEval`（EV02，`pnpm harness eval --entity <ID> [--baseline] [--case] [--version]`）
解析套件 → 按 content digest 定位被测版本 → 夹具真实数据扫描（命中 → 退出 3，E11）→ 回环模型 + 工具桩逐 case →
grader 判 pass/fail/error（超时/抛异常 = error，E3）→ 写 `reports/<runId>.json`（`WorkEvalReport`）→ 任一 fail/error 退出 1。
`--baseline` 用 `suite.baseline` 定义的通用 Agent 跑同一 cases；`--case` 产出 `partial=true`（A2）。

## UC-3 `lintWorkStackGates`（EV03，`pnpm run lint:work-stack-gates [--entity]`）
对每个含 `metadata.work` 的实体按 G0→G4 判，输出 `WorkGateResult[]`；取最新非 partial、lane=loopback、
digest 等于当前版本的报告作 G4 证据，否则 `REPORT_STALE`/`NO_SUITE`。任一官方实体 G0–G4 fail 退出非 0。
Workflow/Agent（A1）的 G1/G3/G5 = not_applicable（`NOT_REQUIRED_FOR_KIND`），G0/G2/G4 照判。

## UC-4 `decideG5`（EV05，纯函数）
G0–G4 全过、有基线、必过 case 全过、subject 通过数**严格大于** baseline → pass；否则 fail 并给 reasonCode。

## UC-5 `writeBackWorkGateStatus`（EV04，`POST /admin/skills/catalog/:skillId/gate-status`）
平台运营凭据；校验 stableId、digest 对应版本；以 `(skill_version_id)` 为键追加/替换该版本的门状态记录，
**同一事务**、旧版本记录保留。失败不写半截（E9）；CLI `--write-back` 失败时本地报告保留、退出 4。

## UC-6 `getWorkGateStatus`（EV04，`GET /skills/catalog/:skillId/gate-status`）
成员可读本组织；无记录 → 六门 `not_evaluated`；记录 digest ≠ 当前版本 → `stale=true`；
响应不含报告路径、夹具、grader 细节（R5）。`?versionId=` 读旧版本（A4）。

## UC-7 `markVerified` 门检查（EV05，扩展 `updateWorkSkillCatalogEntry`）
`candidate→verified` 读当前版本门状态；G5≠pass → 409 `WORK_EVAL_G5_NOT_PASSED`（取代 work-skill-meta 的临时
`gateEvidenceRef`）。Agent 装配绑定官方 Skill 时读目录通道，非 verified 拒绝（ADR-119 #4，实现落在第 5 轮装配用例）。
批量：`pnpm harness eval --all-skills --baseline --write-back` = 对 58 个 Skill 循环 UC-2→UC-3→UC-4→UC-5 并出汇总。
