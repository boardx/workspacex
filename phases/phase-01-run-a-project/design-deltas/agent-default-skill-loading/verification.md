# verification · agent-default-skill-loading

> 每条门控配一条反证。

## V1 — v2 `/chat` 不做任何 skill 操作，已启用 skill 的正文进模型输入

`apps/web/e2e/copilotkit-v2-skill-mount.spec.ts`：登录、发一条消息，deep-agent 替身回复里
出现 `[skill:]MOUNTPROOF-9317`（哨兵只在可挂载 skill 的 SKILL.md 正文里）。

⚠ 反证：把 `acceptHumanMessage` 里 `orgEnabled` 恒置 `[]`，本条必红（前端分支合入前
它本来就是红的——这正是它存在的意义）。

## V2 — agent 钉了 skill ⇒ 覆盖，不是并集

`apps/api/tests/chat/agent-default-skill-loading.test.ts`「覆盖」一条：`agentPinned=[x]`，
`orgEnabled=[a,b,x]` ⇒ `[x]`。

⚠ 反证：把 `resolveRunSkillVersionIds` 改成 `[...agentPinned, ...orgEnabled]` 并集，红。

## V3 — 组织零已启用 skill ⇒ 空，不伪造

同文件「空列表」一条 + `enabled-skill-version-reader-real-db.test.ts` 第二条。

## V4 — 读口口径 = 目录口径（真库）

`apps/api/tests/skill/enabled-skill-version-reader-real-db.test.ts`：已停用 / 只有草稿 /
别的组织 / 模型 B 四种反证行都不进；取最新已发布版本；按建立顺序。

⚠ 反证：去掉 `sk.status = 'enabled'`，disabled 行进来，红；去掉 `sv.published`，草稿进来，红。

## V5 — 旧挂载是追加且幂等

`chat-agent-skill-context.spec.ts` 第二条 B 半：挂默认加载已带上的 skill，快照逐字不变、
同版本只出现一次。

⚠ 反证：去掉 `withThreadMounts` 的 `new Set`，同版本出现两次，红。

## V6 — 合成点漏注入编译期就红

`Deps.enabledSkills` 必填；任一合成点漏传 ⇒ `tsc` 红（不是运行期静默不生效）。
