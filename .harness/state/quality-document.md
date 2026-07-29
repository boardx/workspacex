# harness 健康度快照

> 由 `architecture-coordinator`（coord-architecture）按 `.agents/skills/harness-auditor`
> 的五子系统打分法产出。**被审计对象是 `.harness/` 控制平面本身**，不是任何 feature。
> 本文件只追加，不覆盖历史快照——趋势比单次分数有用。

---

## 快照 2026-07-29 — 基线（首次，无趋势可比）

- 审计基点：`origin/main` @ `4188dae`
- 审计环境：独立 worktree `harness/architecture-health-audit`（共享主 checkout 在审计期间
  被并发写入，见「实况观测」）
- 总分 **6 / 10**

### 五子系统打分

| 子系统 | 分 | 判据 |
|--------|----|------|
| 指令 instructions/AGENTS.md | 1 | 分层与按需加载做得好；但四处「文档说了、脚本没做」 |
| 模板 templates | 1 | 10 份模板齐全；`feature_list.template.json` 漂移 4 个在用字段 |
| 状态 state/feature_list | 1 | 审计当时主 checkout 存在在途假 passing（F06）+ 派生视图漂移 |
| 脚本 scripts | 2 | `doctor.ts` 结构化 finding + level + 修复指引 + strict 模式，无空跑成功 |
| 验证 verify/rubrics | 1 | 拦住四层伪造中的三层；**第四层完全穿透**（见承重测试 T1） |

### 最弱子系统：**验证**

不是因为它做得最差——它是全场唯一在实况中主动抓到问题的子系统。判它最弱是因为
**它承载的期望最高而底座是空的**：AGENTS.md 写着「状态不能自己改……只能跑
`pnpm harness verify`，由验证脚本门控转移」，但 evidence 日志与「命令真的执行过」
之间没有任何不可伪造的绑定。整条审计链的可信度上限，等于一个纯文本文件的可信度。

---

## 承重测试结果

### T1 手改 passing + 伪造 evidence（harness-auditor 固定用例 1）

在干净 worktree（doctor 基线 0 FAIL / 0 WARN）上，把 `F07` 从 `not_started` 手改为
`passing`，逐层加码：

| 层 | 伪造程度 | doctor 结果 | 判定 |
|----|---------|------------|------|
| 1a | evidence 指向不存在的文件 | 2 FAIL | ✅ 拦住 |
| 1b | 日志真实落盘、内容像模像样，但未入 git | 3 FAIL | ✅ 拦住 |
| 1c | `git add` + commit，日志无 `[exit 0]` | 2 FAIL | ✅ 拦住 |
| 1d | 手写 5 行含 `[exit 0]` 的日志并提交 | 1 FAIL（仅 PROGRESS 漂移） | ⚠ 仅剩派生视图防线 |
| **1e** | **再手改 `PROGRESS.md` 表格计数对齐** | **0 FAIL — `✓ 审计链完整`** | **❌ 完全穿透** |

**结论：承重的是脚手架，不承重的是流程。** 一个从未实现、测试从未运行的 feature，
靠一份手写日志 + 一行表格数字，就能让 doctor 报「审计链完整：所有 passing 都有真实
非空证据」。

根因在 `.harness/scripts/verify.ts:84`：日志格式是
`$ ${cmd}\n[exit ${r.code}]\n${stdout}` ——纯文本，无 nonce、无内容哈希、无机器签名。
`doctor.ts:69` 只检查字符串里是否含 `[exit 0]`。**机器无法区分 verify 产出与手写文本。**

残余防线只有两条 WARN（issue 未关闭、未合入 main），且二者在 `--strict` 下才升 FAIL；
而伪造者只要正常开 PR 带 `Closes #N` 并合入，这两条自然满足。

### T2 status/owner/evidence 出现在 PR diff 中是否被视为嫌疑（固定用例 2）

**无任何机械门控。** `.github/workflows/` 与 `.harness/scripts/lint-*` 中没有任何一处
检查 `feature_list.json` 的 `status`/`owner`/`evidence` 字段变更来源。该规则纯靠 reviewer
自觉。

附带发现（比 T2 本身更重）：`doctor --strict` **只在 `backend-gates.yml` 里跑，触发条件是
push to main / tag**——即**合并之后**。`harness-verify.yml`（唯一在 `pull_request` 上跑的
workflow）`grep -c doctor` = **0**。所以 PR 阶段唯一的审计链门控是本地 pre-push hook，而它：

1. 装在 `.git/hooks/pre-push`，由 `init.sh` 写入——**不随 clone 分发**，`core.hooksPath` 未设置；
2. `git push --no-verify` 一行绕过；
3. 新 worktree 未装依赖时 `tsx` 不可用 → 脚本自己 warn 跳过。

### T3 verdict 越权（固定用例 3）

**无任何机械门控。** `review:code-ok` / `review:e2e-ok` / `review:feature-ok` /
`review:security-ok` 四个 label 由 `migrate-labels.ts` 创建，此外**全仓无任何消费者**
（`grep -rn "review:" .harness/scripts/` 除创建处外为空）。`registry.yaml` 的
`reviewers.required_for` 路由同样**零消费者**（`grep -rn "required_for\|reviewers"
.harness/scripts/` 为空）。worker 自打通过标签不会被任何脚本发现。

---

## 僵尸规则清单（文档声明为权威，但无脚本消费）

按 AGENTS.md 自己那条——**「没有脚本的规范条目视为未落地」**：

| 规范条目 | 声明处 | 脚本消费者 |
|---------|--------|-----------|
| `registry.yaml` 身份注册表 | 5 份 instructions + 2 个 SKILL.md | **0**（且文件本身仍是空模板，`coord-architecture` 不存在） |
| `reviewers.required_for` 必需 reviewer 路由 | registry.yaml + coordinator-sop.md | **0** |
| `review:*-ok` verdict 状态机 | multi-agent-coordination.md、ADR-004 | **0**（仅创建 label） |
| `coordination:lease` 模块租约 | multi-agent-coordination.md §1.2、两个 coordinator skill | 脚本在（`module-lock.ts`），但总线上**零条**租约 issue——从未被使用 |

---

## 其他漂移

- **AGENTS.md 130 行，违反自己写的「硬上限 ~100 行」。**
- **模板漂移**：`feature_list.template.json` 缺 4 个实际在用字段——`depends_on`、`points`、
  `spec_ref`、`needs_ui_signoff`。其中 `spec_ref` 是 ADR-018 闭环的锚点、`points` 是
  sprint 规划输入。从模板 scaffold 出的新 phase 会天然缺这些字段。
- **陈旧 worktree 7 个**（`git worktree list`），`sweep-worktrees.ts` 存在但未定期跑。
- **pre-push 门控与 ADR-005 直接打架**：ADR-005 要求所有改动在独立 worktree 里做，而
  新建 worktree 没有 `node_modules`，pre-push hook 第一步 `turbo --affected` 直接
  `Command "turbo" not found` 而中止 push。本次审计推送时实测撞上。于是每个守规矩开
  worktree 的 agent 都被迫 `--no-verify`——**规矩越守，门控越被绕过**。要么每个 worktree
  跑一次 `pnpm install`（慢），要么 hook 在依赖不可用时降级为 warn（当前只有 doctor
  那一段这么做了，turbo 那段没有）。

---

## 实况观测（非实验，审计期间自然发生）

审计开始时共享主 checkout（`docs/requirements-prototype-audit`）挂着 15 个 staged 的
F06 文件；数分钟后再看，index 已被清空——另一会话在我读取期间提交了 `cef2bff`
（合并 `worktree-agent-aee5637285f04ce24`）。**共享主 checkout 正在被并发写入**，这正是
ADR-005 要防的形态，且它不是假设，是本次审计的一手观测。

同一时刻对该 checkout 跑 `doctor --phase 00` 得到 2 FAIL / 2 WARN，准确指出
「F06 的 evidence 只在本地磁盘、未提交进 git」与 PROGRESS 派生视图矛盾。
**这是 doctor 在无人提示下抓到真实断链的实证**——记下来，是它承重的正面证据。

---

## 建议的下一步（按杠杆排序，未执行，待决策）

1. **给 evidence 日志加不可伪造绑定**。最小改动：`verify.ts` 写日志时同时写入
   一行机器指纹（如 `[harness-verify sha256=<日志正文哈希> commit=<HEAD> at=<ts>]`），
   `doctor` 校验该哈希与正文一致。这不防蓄意造假者（他能重算哈希），但把
   「顺手手写一份」的成本从 5 行文本抬到必须复现脚本逻辑，并让手改在 diff 里显眼。
   要真正防伪需要脱离仓库的信任锚（CI 产出 artifact / 签名），成本更高，值得单独决策。
2. **把 `doctor --strict` 挪进 `pull_request` 门控**，或至少把非 strict doctor 加进
   `harness-verify.yml`。当前审计链门控发生在合并之后，属于事后审计而非门控。
3. **`review:*-ok` 与 `registry.yaml` 二选一：给它们写消费者脚本，或从文档里删掉。**
   保持现状是最坏的——它让读文档的 agent 以为有门禁。
4. **修模板漂移**（4 个字段），并给模板与实际 feature_list 加一致性测试。
5. **pre-push hook 改为 `core.hooksPath` 指向仓内目录**，让门控随 clone 分发。

> ⚠ 第 1 条是最弱子系统的根因修复，但也最容易做成「又一条没跑过的规范」。
> 落地时**先造反证**：写完门控立刻手写一份假日志，确认 doctor 会红。

---

## 本次已落地（第 1、2 条，见 ADR-022）

**第 1 条 evidence 指纹**、**第 2 条 doctor 进 PR 门控** 已实现。反证在落地当场就造了：

| 反证 | 做法 | 结果 |
|------|------|------|
| A | 原样重放穿透成功的那套伪造（假 passing + 手写含 `[exit 0]` 的日志 + 手对齐 PROGRESS） | **1 FAIL**「没有 verify 指纹……手写的日志不是证据」✅ |
| B-1 | 用 helper 铸一个形式合法的指纹 | **0 FAIL** —— 残余弱点，如实记录，见下 |
| B-2 | 在合法指纹的日志上事后把 `7 tests` 改成 `9 tests` | **1 FAIL**「日志在产出之后被改过」✅ |
| 库层 | `evidence-fingerprint.test.ts` 六条（含「照抄别处的合法尾行」「清空正文」） | **6/6 通过** ✅ |
| 回归 | 干净树上全仓 `pnpm harness doctor` | **退出码 0**，0 FAIL / 9 legacy WARN ✅ |

**B-1 必须被记住**：能 import `evidence-fingerprint.ts` 的人可以铸出合法指纹。这一层挡的是
「被交付压力驱使、顺手写份日志」的 agent，**不是**蓄意造假者。别把它当防伪——真正的
防伪需要脱离仓库的信任锚（CI 侧签名 artifact），成本另论。

未动的：第 3 条（僵尸规则二选一）、第 4 条（模板漂移）、第 5 条（hooksPath），以及
9 个历史存量 feature 的证据补跑。下次审计从这里接。

### ⚠ 第 2 条落地了但当前跑不起来 —— GitHub 账单

PR #27 的 CI 10 秒即红，原因不是改动：

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased.

**GitHub 托管 runner 当前拒绝启动任何 job**，`harness-verify.yml` 整份（含我新加的
doctor 步骤）处于不可执行状态。`backend-gates.yml` 跑在自建 runner 上，推测不受影响
（未实测）。

于是当前的真实门控形势比审计正文里写的还要弱一层：

| 门控 | 状态 |
|------|------|
| PR 阶段 doctor（本次新加） | 代码已合，**因账单无法执行** |
| PR 阶段 typecheck/lint/test | 同上，**无法执行** |
| pre-push hook | 未随 clone 分发 + `--no-verify` 可绕 + 新 worktree 里必然失效 |
| 合并后 `doctor --strict` | 自建 runner，推测仍可用（未实测） |

**这是本次审计最讽刺的一条**：花一轮把「门控存在但不承重」修掉，结果发现门控所在的
执行平面本身欠费停机。修账单是人类的事（agent 无权处理付款），但它必须被写在这里，
否则下一个 agent 会以为 PR 有 CI 保护。
