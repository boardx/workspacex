# PR 检查/修复/合并 SOP —— 无 `gh` CLI 环境速查

> 单一事实源仍是 `.harness/scripts/lib/pr-queue.ts`（`PR_QUEUE_STATES` / `REQUIRED_CHECKS` /
> `classifyPr`）与 `coordinator-sop.md`。本文不新定义任何判定规则，只是给
> **拿不到本机 `gh` 二进制、只有 GitHub MCP 工具**的会话（例如 Claude Code on the web
> 的远程执行环境）一份操作速查——`pnpm harness pr-queue` 内部调用 `gh pr list ...`，
> 无 `gh` 时会以退出码 127 直接失败，这类会话必须手动复现同一套判定，容易漏项。

## 什么时候用这份文档

会话里跑 `pnpm harness pr-queue` 得到 `gh 命令失败（127）` 或 `command not found: gh`
时，改用下面的 MCP 工具组合手动判定，**判定标准逐条对照 `pr-queue.ts`，不要凭印象**。

## 一、用 MCP 工具拿到判定所需的原始事实

对每个 open PR：

| 需要的事实 | 用哪个工具 |
|---|---|
| PR 基本信息、`mergeable_state`、head SHA、body（找 `Closes #N`） | `mcp__github__pull_request_read` method `get` |
| CI 各 check 的 status/conclusion | `mcp__github__pull_request_read` method `get_check_runs`（比 `get_status` 更全——本仓 CI 全部走 GitHub Actions checks，传统 commit status 通常是空的） |
| 独立 exact-SHA review 的 BLOCK/ACCEPT 结论 | `mcp__github__pull_request_read` method `get_comments`（本仓的"独立审"目前是**以 PR 评论形式**发布，不是原生 GitHub Review——见下方"关于 review 身份"） |
| 正式 GitHub Review（Approve/Request changes） | `mcp__github__pull_request_read` method `get_reviews` |
| PR 上的 `review:*` label | `mcp__github__list_pull_requests` 或 `pull_request_read` method `get` 的 `labels` 字段 |

## 二、按 `pr-queue.ts` 的规则手动分类

判定优先级（第一个命中的决定 state，但要记录全部命中项，见 `PR_QUEUE_STATES` 表）：

1. **`MERGE_BLOCKED`**：`review:changes` 与某个 `review:*-ok` label 同时存在（自相矛盾）；
   `mergeable_state` 为 `dirty`/`blocked`/`unknown`；PR body 里既无 `Closes #N` 也无
   `Refs #N`；作者与"审核者"是同一 GitHub 身份且没有其它可信的独立性证据。
2. **`WAITING_WORKER`**：Draft，或 `mergeable_state` 为 `behind`（需要 rebase）。
3. **`CHANGES_REQUIRED`**：带 `review:changes` label；或最新一条独立审评论是 BLOCK/
   CHANGES_REQUIRED 且**评论里写明的 SHA 等于当前 head SHA**（SHA 不等 = 评论已过期，
   按 `WAITING_REVIEW` 处理，不能直接采信）；或任一 **required check** 结论是
   `FAILURE`/`TIMED_OUT`/`ACTION_REQUIRED`/`STARTUP_FAILURE`。
   **⚠ 非 required 的 check 一样"红就是红"**——`classifyPr` 对未声明的 check 只看
   结论是不是 `FAILURE` 类，不看是否在 `REQUIRED_CHECKS` 里；`SKIPPED`/`NEUTRAL`/
   `CANCELLED` 才算"空转"、被忽略。**只有 job 本身配置了 `continue-on-error: true`
   的 check，失败时上报的 conclusion 才会变成非 failure 类**，否则一条真失败的
   非必需 check 照样会把 PR 判成 `CHANGES_REQUIRED`——遇到这种情况先确认该 job 当前
   workflow 定义是否真的带 `continue-on-error`，不要凭"反正它不在 REQUIRED_CHECKS
   里"就当作不拦人（2026-08-31 复核 PR #2422 时，`fullstack-smoke` 在该 head SHA
   上就是真失败，需要按下方"三、fullstack-smoke 的特殊状态"分诊，不能直接忽略）。
4. **`WAITING_CI`**：任一 required check 还没结论，或**一条都拿不到**（问不到不等于绿）。
   `REQUIRED_CHECKS` 当前值见 `pr-queue.ts`（本文不复述，会随裁决增删，抄一份必然漂移；
   截至本文写作时是 `verify-control-plane` / `verify-affected` / `verify-full-compile`）。
5. **`WAITING_REVIEW`**：没有当前 head SHA 的独立审 ACCEPT 结论，或 head 漂移后旧结论
   已失效。
6. **`READY_TO_MERGE`**：以上都不命中。

## 三、`fullstack-smoke` 的特殊状态（2026-08-06 人类裁决，#633）

浏览器 e2e（真 docker 栈）**不阻塞合并，只阻塞发布**——它已从 `REQUIRED_CHECKS` 摘出，
`harness-verify.yml` 里对应 job 同步加了 `continue-on-error: true`。但如上一节所说，
这条豁免只在该 job **确实带着 `continue-on-error` 跑**时才生效；如果某次运行的
conclusion 就是 `failure`（未被 continue-on-error 吸收），`classifyPr` 仍会把它计入
`changes`。遇到这种情况：
1. 先看失败断言本身——是不是与本 PR 改动的代码路径无关（不同文件、不同功能域）。
2. 无关联 ⇒ 尝试重跑该 job（`mcp__github__actions_run_trigger` 或对应的 rerun
   工具），或对比同一 spec 在 base/main 最近一次运行是否同样失败——同样失败即可
   在 PR 评论里写明分诊结论（不能只是内部判断，必须留痕），继续走合并；不要
   在完全没有对照证据的情况下自行断言"与我无关"。
3. 有关联 ⇒ 这是本 PR 要修的真实回归，不能绕过。

## 四、关于"独立 review"身份

本仓当前对开发中 PR 采用的是**"以评论形式发布的 exact-SHA 独立审"**（不是原生
GitHub Formal Review）——发布者的 GitHub 身份目前与 PR 作者相同（`usamshen`），
评论正文会显式声明这一点（"GitHub cannot represent a true non-author formal
review, this is the audit projection, not an approval"）。这是本仓 `APPROVE_CHECK_
SUSPENDED`（`pr-queue.ts`）现状的直接后果：原生 approve 检查已暂停为纯记录、不拦人
（2026-08-16 人类裁决，见该常量注释的完整背景与恢复条件）。**在这个约束解除之前，
"评论内容是否真的指出了可核验的具体代码问题"就是唯一可信的信号**——收到 BLOCK
评论时，逐条去读代码/测试文件验证它是否成立，不要因为"发布者=作者"就整体忽略，
也不要因为它挂了"独立审"的名头就无条件采信，两种偷懒都会让门禁空转。

## 五、合并前最后一步

- 确认要合并的 SHA 与"ACCEPT"评论里写明的 SHA 完全一致（`mcp__github__pull_request_read`
  method `get` 的 `head.sha`）——SHA 漂移会让旧评论失效，需要新的独立审。
- 确认 `mergeable_state` 为 `clean`。
- 用 `mcp__github__merge_pull_request`（`merge_method: "squash"`，本仓惯例）合并。
- 合并后核对：PR 确实 `merged: true`；`Closes #N` 的 issue 已自动关闭（未自动关闭时
  手动关闭并注明原因）。

## 六、与 `coordinator-sop.md` 的关系

本文只是"没有 `gh` 时怎么拿到同一份判定"的操作层适配，**不改变任何判定规则、不新增
豁免**。规则本身的变更（`REQUIRED_CHECKS` 增删、`APPROVE_CHECK_SUSPENDED` 的恢复条件
等）一律去改 `pr-queue.ts` 或走人类裁决，不在本文件另写一份会漂移的副本。
