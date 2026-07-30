# UI 先行原型 v2 · `agent-runtime` 私聊屏重画 —— ADR-003 关卡材料

> **本版是重画私聊屏**：v1（`ui-preview/agent-runtime/`，48 张）把「私聊」误判为人际私聊、只画单个 Ava、
> 把组员默认画反。逐条错处 + 16.60–17.05M 数据区证据见同目录 `V1-WAS-WRONG.md`。
> v2 = 39 张非私聊屏原样复制 + 10 张私聊屏重拍，路由沿用 `/preview/agent-runtime?screen=chat`。
> URL 维度：`?screen=chat` · `?state=`（七态）· `?as=`（facilitator/groupLead/member/observer）。

---

## 一、截图 → UC → 屏映射（本轮重拍私聊屏 10 张）

| 截图前缀 | 屏 | 对应 UC / 节 | 覆盖状态 |
|---|---|---|---|
| `uc-4-3-chat-{default,loading,empty,invalid,dep-failed,denied,success}` | 与单个 agent 私聊（花名册 + 抽屉） | UC-4.3 · 原型 AG 数组 17044000 | 七态全 |
| `uc-4-3-chat-member` | 组员视角（默认可私聊 · 原型「开·必留」） | UC-4.3 R5 | 组员 |
| `uc-4-3-chat-drawer` | 点开 Ava → 右侧滑出抽屉（skill/往返/快捷/占位符） | 原型 agentChatOpen 16721252 | 交互态 |
| `uc-4-3-chat-transfer-provenance` | 转出到主线程 · 出处预览 | UC-4.3 转出带出处 | 交互态 |

其余 39 张（`uc-4-1-permission-*` / `uc-21-2-mcp-*` / `uc-20-3-routing-*` / `uc-4-2-team-*` / `uc-4-4-audit-*`）是 v1 原样复制，未改。

### 关键 testid 锚点
- 花名册：`chat-member-policy` `chat-roster` `chat-roster-row-{ava,atlas,scout,ledger,warden,echo}` `chat-note-entry` `chat-no-entry`
- 抽屉：`chat-drawer` `chat-drawer-overlay` `chat-drawer-name` `chat-drawer-close` `chat-drawer-skills` `chat-skill-{key}-{name}` `chat-drawer-messages` `chat-transfer-{key}-{i}` `chat-drawer-quick` `chat-quick-{key}-{q}` `chat-drawer-input` `chat-drawer-send`
- 转出：`chat-transfer-dialog` `chat-transfer-provenance` `chat-transfer-confirm` `chat-transfer-cancel` `chat-toast`

---

## 二、我在 16.60–17.05M 数据区里多看到的东西（任务点名要看）

> 审计自陈那个数据区只做了定点抽取、没通读。我通读后，除了私聊屏的三处否证证据（见 V1-WAS-WRONG），还看到：

1. **能力表是完整的项目级 AI 开关清单**（偏移 16609949 起，同一张表）：除「与 AI 的对话·开·必留」外还有
   `用户访谈（访谈 AI 代跑并回流转写·开）` / `深度研究（带出处的分路检索·开）` / `用户研究（概念测试与可用性回合·关·两天档才开）`。
   **这比 v1 的 `PROJECT_AI_SWITCHES` 三条更全、且默认值不同**（v1 三条默认全关，原型这几条默认多为开）。
   → 被判「缺失」实则写在数据数组里的功能：**项目级 AI 能力开关的完整默认值表**。建议下一轮补进 `team-screen`。
2. **每 agent 的「主动插话」策略**藏在 `AG[].model` 串里：Ava/Scout/Warden = 主动插话开，Ledger = 需批准，Echo = 被动仅被 @。
   这是 agent 级的主动性开关，v1 完全没呈现；v2 私聊花名册用在场态+model 串体现，但**逐 agent 主动插话开关 UI** 未画。
3. **Ledger「跑批中·需批准」与批准卡联动**：花名册在场态「跑批中」直接对应 `routing`/`APPROVAL_CARD`。私聊未做该联动。

---

## 三、我替 UC 做的、UC 没写明的设计决定

1. **组员默认可私聊 = true**（`MEMBER_CHAT_DEFAULT_ON`），依据原型「开·必留」。这是**把 v1 画反的默认改回**，
   但「必留」的留档去向（汇总到哪、谁能看）原型只说「汇总在这」，我未画汇总视图——**待迁入 `packages/contracts` · ThreadChatAgent + 私聊留档策略**。
2. **抽屉宽 400px、右侧滑出、点遮罩关闭**——照原型（偏移 16721252 起）。
3. **本人消息气泡用 `--inverse`（#17171A 反色实心面）**，对应原型 `background:#17171A`；agent 消息用卡片底。这是 token 落点选择。
4. **转出出处沿用 v1** 的 `PRIVATE_CHAT.transferProvenance`（agent 版本 + skill 版本 + 时间 + 数据来源），未改。

---

## 四、R8 线索矛盾与界面无法自洽的点

- **「私聊不进主线程」vs「必留档汇总」**：私聊不进主线程，但又必留档汇总——两者不矛盾（留档 ≠ 进主线程），
  但**留档汇总的可见性**（组员本人 / 引导师 / 审计）原型未定，我只做了「不进主线程」的界面告知，留档视图待补。
- **在场态 6 个 vs 主持台编制 6 / 在场 4**：私聊花名册显示全部 6 个可私聊（含空闲的 Echo、跑批的 Ledger），
  而 `team-screen` 的「团队 4」是在场数。两个口径都对（可私聊 ⊇ 在场），但签核时要明确私聊花名册是否含空闲 agent。

---

## 五、建议 sign-off 时重点核对的 3 处

1. **组员默认「开·必留」是否符合本组规则**（§三.1）—— 这是把 v1 画反的默认改回，且牵动私聊留档合规，最需人拍板。
2. **私聊花名册是否含空闲/跑批 agent**（§四）—— 6 全列 vs 只列在场，决定 `chat-roster` 的成员集。
3. **§二 数据区多看到的项目级 AI 开关完整表 + 逐 agent 主动插话**—— 是否本轮就把它补进 team-screen，还是留下一轮；这块「被判缺失、实则存在」，越早定越省。
