# AIDT 后端契约最终修复与验证交接

工作树：`/workspace/aidt-pr-20261117`。基线 HEAD：`1a2ec212d38635a60b1337cc4a949ec564c0d7a8`（已集成 develop `4060bcf`）。最终验证时 HEAD 未变、修复仍为dirty。我的修改为下列三文件，未 commit：

- `packages/contracts/src/aidt-stages.ts`
- `apps/api/tests/aidt-stages/shared-stage-unit.test.ts`
- `packages/contracts/src/project-member-chat.ts`

root后续分配给 `/root/pr_python_review` 的配套修复共两文件，已纳入本报告最终统一验证：`packages/contracts/src/skill-entry-points.ts`、`packages/contracts/tests/skill-entry-points.test.ts`。其他人的workflow/Docker/registry变更未由我修改，亦不在本契约测试结论的行为覆盖中。

根及相关目录规则已读；packages/contracts、apps/api 下无额外 scoped AGENTS。root 已完成本工作树 init quick 和完整依赖安装；本次没有重复安装、改签核、执行迁移、调用模型、改权限或发布。

## 行为变化

在现有契约形状内，将保存版本、来源版本（含报告来源）、阶段摘要、历史请求及响应游标限制为 PostgreSQL integer 最大值 `2147483647`。最大保存版本仍有效；`expectedRevision` 最大 `2147483646`，为既有 append 的 `expectedRevision+1` 留出空间。新稿的初始 expectedRevision=0 与缺失阶段摘要 revision=0 保留；来源版本仍为正整数。

新增10个有意义测试：7项契约入口的 max有效/max+1拒绝；expectedRevision加一空间与初始零；内存服务保存最后合法版本后拒绝再追加；超范围历史/草稿来源/报告来源在任何仓储调用前返回 AIDT_STAGE_INVALID。未声称内存测试证明真实PG写入。

另将成员文字契约的导出名 `ReadOnlyReason` 收窄为 `MemberChatReadOnlyReason`，仅更新同文件Access内部引用。全仓检索未发现外部旧名引用；root index为namespace reexport。wire字段、枚举值、错误码、权限、现有project生命周期schema均不变，未放宽任何门。

## 首轮实际验证（失败历史保留，已被下方最终绿测取代）

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| API stage定向红测（只加测试、修复前） | exit1，新增10失败、47通过 | `/tmp/aidt-pr-backend-boundary-red.log` |
| API stage定向绿测（修复后） | exit0，2文件57测试通过 | `/tmp/aidt-pr-backend-boundary-green.log` |
| contracts完整测试 | exit1，146文件通过/1失败；1501测试通过/2失败，见下方集成阻塞 | `/tmp/aidt-pr-backend-contracts-test.log` |
| contracts非增量tsc | exit0，无诊断 | `/tmp/aidt-pr-backend-contracts-tsc.log` |
| contract-source单源lint，真实pnpm环境 | exit1，同名契约碰撞，见下 | `/tmp/aidt-pr-backend-contract-source-final.log` |
| 两修改文件 `git diff --check` | exit0 | 已实际执行，无输出 |

执行命令：API目录 `./node_modules/.bin/vitest run --config vitest.aidt-stage-unit.config.ts`；contracts目录 `./node_modules/.bin/vitest run` 与 `./node_modules/.bin/tsc --noEmit --incremental false`；repo根 `node .harness/scripts/lint-contract-source.mjs`。最后一条重跑使用 root 提供的 `/tmp/aidt-node` / `/tmp/aidt-tools` 真实Node/pnpm及独立store环境。首次默认fallback pnpm导致generator启动失败的日志单独保存在 `/tmp/aidt-pr-backend-contract-source.log`，不作为有效lint结果。

API综合无DB configs/非增量tsc由 `/root/pr_verification_plan` 负责；Web检查由 `/root/pr_frontend_review` 负责。已于01:31 UTC通知两者源码稳定；没有重复其综合检查。

## 首轮发现并已解决的其他集成阻塞

1. `packages/contracts/tests/skill-entry-points.test.ts` 两测试失败：六个 `aidt-*` 与 `dt-summarize-project` 尚未登记到现有入口或隐藏技能表；候选文件也被扫描到。不能将完整contracts测试报绿。建议在不加入默认平台三入口的前提下，按可选教学模块边界登记hidden，并保留目录完整性门。
2. contract-source gate失败：`project-member-chat.ts` 导出泛名 `ReadOnlyReason`，与既有 `apps/api/src/domain/project/readonly-reason.ts:22` 的生命周期类型重名，触发literal-copy gate。两者语义不同（成员文字还包括role），建议将新契约名字收窄为 `MemberChatReadOnlyReason`；不放宽gate、不扩大旧生命周期枚举。

root明确授权后：命名由我在单文件内修复，hidden登记由 `/root/pr_python_review` 独占修复。后者保留原有扫描路径与已发包内容，新增7项hidden登记及1个防止进入普通三入口的测试，不新增reason枚举或API形状。没有擅自扩大修复范围。

## 最终统一验证（2026-11-17 01:37–01:38 UTC）

两路源码均稳定后执行，所有实际退出码为0：

| 检查 | 实际结果 | 最终日志 |
| --- | --- | --- |
| contracts完整测试 | **147文件、1504/1504测试通过，exit0** | `/tmp/aidt-pr-backend-contracts-final-test.log` |
| contracts非增量tsc | **exit0，无诊断** | `/tmp/aidt-pr-backend-contracts-final-tsc.log` |
| contract-source单源lint | **exit0**；1527 contract types，扫描apps/web/lib及apps/api/src，生成文件匹配 | `/tmp/aidt-pr-backend-contract-source-green.log` |
| 成员频道service/controller无DB回归 | **2文件、26/26通过，exit0** | `/tmp/aidt-pr-backend-member-rename-unit.log` |
| 全工作树 `git diff --check` | **exit0** | 已实际执行，无输出 |

API综合验证者另已回报 **625项全通过、API非增量tsc exit0**，详细证据 `/tmp/aidt-pr-verification-final.md`；这不是我重跑的检查。此前阶段边界57/57仍保留原日志。

旧完整contracts的1501通过/2失败、旧单源lint失败和新最终绿日志使用不同文件名，未覆盖失败历史。最终合同验证没有剩余红项；真实PG迁移、模型和devapp部署仍沿root整体交付计划，不由本次无数据库验证代替。
