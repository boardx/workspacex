# 可移植长期角色：人类启动与迁移手册

> 状态：ADR-103 的 Proposed 设计合同。#441–#446 完成前，以下命令是验收目标，
> 不是当前基线已提供的能力。

## 人类看到的稳定入口

人类在当前 Directory project 下只选择稳定角色名，例如 `coord-architecture` 或
`dev-chat-e2e`。工具配置由同一份 `.harness/agents/roles/<role>.yaml` 生成；Directory
ULID 与 token 不出现在这些文件。
model 也不属于角色规格：默认继承本次工具/会话配置，更换 model 不会换身份或权限。

### Claude Code

1. 在仓库根目录运行 `pnpm harness agent-bootstrap --role <stable-role-id>`。首次运行从
   隐藏输入/stdin 接收 scoped token；不要把 token 放在命令参数里。
2. 运行 `claude --agent <stable-role-id>`。
3. 启动页应显示 `@<stable-role-id>`。角色在开始工作前自行解析 Directory 身份、占
   role lease、轮询 private inbox 并 ACK；任一步失败就停止。

Claude Code 的项目 agent 位于 `.claude/agents/*.md`。官方说明：
https://code.claude.com/docs/en/sub-agents

### Codex App / CLI

1. 在仓库根目录运行同一个 `pnpm harness agent-bootstrap --role <stable-role-id>`。
2. 在 Codex App 打开本仓库，或在本仓根目录启动 Codex CLI。
3. 新建任务并明确输入：`Use the <stable-role-id> project agent for this task.`
4. agent 必须先回报已解析的稳定角色（可显示角色名，不显示 token），再进入相同的
   role lease → inbox → ACK → issue lease 流程。

Codex 的项目 agent 位于 `.codex/agents/*.toml`；文件顶层字段至少为 `name`、
`description`、`developer_instructions`。Codex 中 `/agent` 用来查看/切换 agent thread，
不是给长期角色另造身份。

## 运行时顺序

```text
project + stable role
  → Directory enrollment role binding 恰好一个 active match
  → launcher 从 OS credential broker 只取 selected role + scoped whoami 验证
  → COORD_AGENT_ID = Directory ULID
  → role lease
  → private inbox(ULID) → ACK
  → issue lease → heartbeat
  → handoff → release issue → release role
```

禁止用稳定角色名调用 private inbox/ACK/claim；这些动作只认 Directory ULID。禁止在
输出中显示 token。第二个同角色会话必须在 role lease 处失败，不能旁路继续。

## 旧缓存原子迁移与同用户隔离

1. 旧 `.harness/state/.cache/coord-credentials.json` 即使是 `0600`，也不能暴露给同一 OS
   用户下的 agent；它只可由 agent sandbox 外的可信 launcher 读取一次。
2. 以 `(project_id, stable_role_id)` 从 Directory enrollment binding 解析唯一 active
   ULID；不以 mutable `agent.name` 或 registry 猜测。
3. 用 scoped whoami 验证旧 token 与 ULID。匹配则写入 OS credential broker/keychain，
   键包含 project、stable role、ULID；验证失败才要求重新输入。
4. 磁盘只写每角色的非秘密 reference/hash metadata，模式 `0600`，使用临时文件、fsync、
   chmod 和原子 rename；成功后从旧 cache 移除明文 token。
5. launcher 只把 selected role token 注入本次进程。agent 无权枚举 broker、读旧 cache、
   或请求其他角色；`dev-*`/`rev-*` 的可见凭据集合绝不能含 `coord-main`。
6. dry-run 不打印 token，只允许显示项目、稳定角色、ULID 的脱敏摘要和验证状态。

## 分阶段执行

| 顺序 | Issue | 产物 |
|---|---:|---|
| 0 | #396 / PR #402 | 修复并合并 PlatformDirectory runtime role SSOT |
| 1 | #441 | 中立 YAML 生成 Claude Code / Codex 当前格式 |
| 2 | #442 | Directory project-role binding + scoped identity 自检 endpoint |
| 3 | #443 | role resolver、broker selected-role 注入、0600 metadata、原子迁移 |
| 4 | #445 | inbox / ACK / 双租约 / handoff loop |
| 5 | #444 | secret、ULID、生成漂移、权限漂移 CI 门禁 |
| 6 | #446 | `dev-chat-e2e` 双工具验收；使用 coord-main 明确派发的测试任务 |

不得在这条迁移链中启动 Task #44。每个 issue 独立分支、独立 PR、独立验证证据。
