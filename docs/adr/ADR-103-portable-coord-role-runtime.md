# ADR-103: portable-coord-role-runtime

- 状态: Proposed
- 适用层：方法论（可移植）
- 日期: 2026-08-04
- 关联: #436、#396、PR #402

## 背景

长期角色目前同时存在于仓库 registry、协调网关 Directory、本机凭证缓存和具体工具的
agent 配置中。稳定角色名（例如 `coord-architecture`）与运行时不可变身份（Directory
ULID）混用后，会产生四类故障：同一角色双开、消息投递给错误身份、换工具后凭证漂移，
以及把 token/ULID 复制进可提交配置。

Claude Code 与 Codex 的项目 agent 格式也不同。Claude Code 使用
`.claude/agents/*.md` 的 YAML frontmatter，并可用 `claude --agent <name>` 启动整段
会话；Codex 使用 `.codex/agents/*.toml`，当前格式要求顶层 `name`、`description`、
`developer_instructions`，由人类在 App/CLI 提示 Codex 使用命名角色。工具配置不能成为
第二份角色事实源。

PR #402 / #396 已把 `kind`、`areas`、`reports_to` 与 lifecycle 收敛到
PlatformDirectory。它虽有一条非本变更引起的 CI 失败，方向与本决策一致；另建一套
Directory 或 runtime role schema 会制造双事实源。

## 决策

### 1. 三类身份严格分层

1. `.harness/agents/roles/<stable-role-id>.yaml` 是**行为与权限**的唯一规格源；生成
   Claude Code 与 Codex 两种工具表面。规格和生成物不得含 token、私钥或 Directory
   ULID。
2. PlatformDirectory 是**运行时角色与生命周期**的唯一事实源。复用并修复 PR #402，
   本 ADR 不增加第二套 Directory schema/API。
3. Directory ULID 是 inbox、ACK、claim、heartbeat、release 和审计的唯一 actor id。
   稳定角色名只用于人类选择与运行时解析，不能代替 ULID 调协调 API。

### 2. 启动时 fail closed 解析

launcher 以稳定角色名查询 Directory，要求恰好一个 active 结果，并核对
`kind`、`areas`、`reports_to`。随后读取 gitignored 的本机凭证缓存，要求文件模式
`0600`，通过只读 scoped-identity endpoint 验证 token 确实属于解析出的 ULID。

零个或多个匹配、角色字段漂移、retired identity、错误文件权限、token/ULID 不匹配都
必须停止。token 只可从交互提示或 stdin 输入；不得走 argv、日志、生成文件或 Git。
缓存更新必须以临时文件 + `chmod 0600` + 原子 rename 完成。有效旧凭证迁移时保留，
只有验证失败才轮换。

### 3. 两层租约与同一生命周期

会话先占 `role:<stable-role-id>` 唯一租约，再按 Directory ULID 轮询 private inbox；
收到任务后 ACK，再占 `issue:<number>` 租约。两层租约都定时 heartbeat，任何一层丢失
都停止写入。收尾必须写可继续的 handoff、释放 issue 租约，再释放 role 租约。

服务端继续机械限制：只有 coordinator 可 dispatch，只有 `coord-main` 有 merge 权。
生成的 worker/reviewer 配置不得扩大权限。

### 4. 分阶段迁移，不跨 issue 混做

实现 DAG 是：

`#396 / PR #402 → #442 → #443 → #445 → #446`，同时
`#441 → #443`，最后由 `#444` 把 secret、生成漂移和 authority drift 接入 CI。

- #441：中立 YAML → 当前 Claude Code / Codex 格式。
- #442：scoped identity 自检 endpoint。
- #443：稳定角色解析、0600 缓存与原子迁移。
- #445：inbox / ACK / 双租约 / heartbeat / handoff loop。
- #444：无秘密、无 ULID、唯一 merge/dispatch 权限门禁。
- #446：人类分别从 Claude Code 与 Codex 启动 `dev-chat-e2e` 的双端验收。

Task #44 不属于本设计任务，不得被上述设计或验证提前启动。

机器可读合同位于 `.harness/contracts/portable-role-runtime.yaml`，其结构由
`.harness/scripts/portable-role-architecture.test.ts` 门控。人类启动与迁移手册位于
`.harness/instructions/portable-role-runtime.md`。

## 后果

- 正面：工具可替换，运行时审计身份不变；角色行为只写一次；重复会话与秘密漂移从
  约定变成机械失败；现有 Directory 投资被复用。
- 代价：PR #402 是硬前置；需要新增只读身份自检 endpoint；首次启动多一次本机安全
  bootstrap；任何 Directory/spec 漂移都会阻断启动而不是自动猜测。
- 迁移期间：旧 registry 只能是离线投影/过渡输入，不能重新获得 runtime SSOT 地位。
  #446 通过前，本文描述的是已批准设计合同，不宣称双工具运行时已经完成。
