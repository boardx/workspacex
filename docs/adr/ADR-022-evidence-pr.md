# ADR-022: evidence 指纹与 PR 阶段审计链门控

- 状态: Proposed
- 适用层：方法论（可移植）
- 日期: 2026-07-29

## 背景

2026-07-29 的控制平面健康度审计（`.harness/state/quality-document.md`）跑了
harness-auditor 的固定承重测试，在干净仓库上逐层加码伪造一个 feature：

| 层 | 伪造程度 | doctor 结果 |
|----|---------|------------|
| 1a | evidence 指向不存在的文件 | 2 FAIL ✅ |
| 1b | 日志落盘但未入 git | 3 FAIL ✅ |
| 1c | 已提交，但日志无 `[exit 0]` | 2 FAIL ✅ |
| 1d | 手写 5 行含 `[exit 0]` 的日志并提交 | 1 FAIL ⚠ |
| **1e** | **再手改 `PROGRESS.md` 表格计数对齐** | **0 FAIL — `✓ 审计链完整`** ❌ |

一个从未实现、`verification` 命令从未执行过的 feature，靠一份手写日志加一行表格
数字，就让 doctor 报「所有 passing 都有真实非空证据」。

根因有两条，互相独立：

1. **日志与「命令真的执行过」之间没有任何绑定。** `verify.ts` 落盘的是纯文本
   `$ cmd\n[exit 0]\n<stdout>`，`doctor.ts` 只 grep 字符串 `[exit 0]`。机器无法区分
   verify 产出与手写文本。AGENTS.md 写着「状态不能自己改……只能跑 `harness verify`，
   由验证脚本门控转移」——这条规范的机械底座是空的。
2. **审计链门控发生在合并之后。** `doctor --strict` 只在 `backend-gates.yml`，触发条件是
   push to main / tag。唯一跑在 `pull_request` 上的 `harness-verify.yml` 里 `doctor`
   出现 0 次。PR 阶段仅剩本地 pre-push hook，而它装在不随 clone 分发的 `.git/hooks`
   里、`git push --no-verify` 一行绕过、依赖不可用时脚本自己跳过。

这正是 AGENTS.md 自己那条**「没有脚本的规范条目视为未落地」**——只是这次落空的不是
某条规范，而是**整条审计链的可信度上限**。

## 决策

**一、evidence 日志带机器指纹。**
`verify` 落盘时追加尾行
`[harness-verify v1 sha256=<正文哈希> commit=<HEAD> at=<ISO>]`；`doctor` 重算正文哈希比对。
格式只声明在 `.harness/scripts/lib/evidence-fingerprint.ts` 一处，`verify` 与 `doctor`
共同 import（遵守「同一事实不得声明在两处」）。判定三分：

- 无尾行 → **FAIL**：「它不是 `harness verify` 产出的，手写的日志不是证据」
- 有尾行但哈希不符 → **FAIL**：「日志在产出之后被改过」
- 一致 → 通过

**历史存量走显式豁免名单** `.harness/state/evidence-legacy.json`：门控上线前已 passing
的 9 个 feature 缺指纹判 WARN。名单**只减不增**，跑 `--backfill-evidence` 补出真实日志
后即从名单删除。不用「按日期/commit 自动豁免」是因为那会让豁免面隐式膨胀——显式名单
是可数、在 diff 里显眼的技术债。

**二、`doctor` 进 `pull_request` 门控。**
`harness-verify.yml` 增加 `pnpm harness doctor`（**不带 `--strict`**：strict 会把「passing
必须已合入 main」升为 FAIL，PR 阶段本来就还没合，是鸡生蛋——`backend-gates.yml` 的注释
里记着同一个坑）。两道互补：**PR 阶段拦伪造证据，合并后的 `--strict` 拦未落地**。

### ⚠ 这一层挡什么、不挡什么（不要误读）

指纹**不是防伪**。信任锚在仓库内部，读得懂 `evidence-fingerprint.ts` 的人就能铸出
合法指纹——这一点在反证 B-1 里实测确认过（形式合法的指纹 → doctor 0 FAIL）。

它挡的是**真实威胁模型**：被交付压力驱使、顺手把日志写出来的 agent。把成本从「写 5 行
文本」抬到「必须复现哈希逻辑」，并让任何对已产出日志的事后改动立刻变红。要防蓄意
造假需要**脱离仓库的信任锚**（CI 侧签名 artifact / 外部存证），成本高得多，属于另一个
决策，本 ADR 不做。

**任何人读到这条 ADR 时，不要把指纹当作「证据不可伪造」的依据。**

## 后果

正面：
- 承重测试 1e 那条完整穿透路径被堵死（反证 A 实测：同一套伪造现在 1 FAIL）。
- 证据日志成为**只能由脚本产出**的产物，手工编辑必然暴露在 doctor 里。
- 假 passing 在**合并前**被拦，而非合并后被审计出来。
- 反证固化为 `evidence-fingerprint.test.ts` 六条用例（含「照抄别处的合法尾行」
  「清空正文」两条绕过尝试），不会随时间悄悄失效。

负面 / 待偿：
- 9 个历史 feature 的证据仍无指纹，处于显式豁免中。清偿动作是逐个跑
  `--backfill-evidence`，需要各自的测试环境（部分依赖 docker/PG），未在本次完成。
- `doctor` 进 PR 门控后，任何触碰 `feature_list.json` / `sprints/**` 的 PR 都会被审计链
  体检——历史欠债较多的 phase 可能因此变红。本次落地前实测全仓 `doctor` 退出码 0，
  但后续新增 phase 需注意。
- 指纹给了**虚假安全感的风险**。缓解手段只有一条：把限度写死在代码注释、本 ADR 和
  quality 快照三处，且都用同样直白的措辞。

对架构平面的影响：仅控制平面（`.harness/`、`.github/workflows/`），不触碰 `apps/`、
`packages/`。
