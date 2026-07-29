# 契约束 `chat` — 领域模型与不变量（支撑材料）

> **这一件回答的问题**：对话这摊数据，**什么东西在任何时刻都必须为真**？
> 判据是：**违反即数据损坏，且能写成断言**。写不成断言的是「规则」，不是不变量——别混。
>
> 覆盖 feature 见 `design-signoff.md` frontmatter 的 `covers:`（**权威**）。
> 依据 UC：`uc-8-1` `uc-8-2` `uc-8-3` `uc-8-4` `uc-8-5`（08-chat 五份全部）。

---

## 一、实体与值对象

### 1. `Thread`（对话线程）

| 字段 | 说明 |
|---|---|
| `id` | — |
| `projectId` | 恒非空——**对话不存在于项目之外**（含 agent 私聊，见 I-9） |
| `groupId` | 组号；`null` 表示全场 / 研究阶段线程 |
| `visibilityScope` | 值对象，取值见下 |
| `phase` | `onsite`（现场）/ `research`（研究）——决定右栏是否显示转录（uc-8-2 E1） |
| `archived` | 已归档线程**只读**，默认筛选不返回（uc-8-1 R7 / V5） |
| `ownershipLayer` | `project`（恒定，见 I-9） |
| `createdBy` / `lastActivityAt` | — |

### 2. `VisibilityScope`（可见范围 · **封闭枚举**）

```
member-private   组员私聊     本人 + 本组组长 + 引导师
group-shared     本组共享     全组可见
plenary          全场         项目内全员
team-visible     团队可见     研究阶段：同（组织）团队可见
private          私有         研究阶段：仅创建者
```

⚠ **五值封闭，新增必须走 ADR**（uc-8-5 R6 明写「不得另立一套角色枚举」，
同理其可见范围取值也不得由实现者扩张）。
⚠ 面向用户的**文案**（徽标上印什么字）**尚未确定**——见「待人类裁决」第 2 条。

### 3. `Message`

`id` / `threadId` / `authorKind`(`human`|`agent`) / `agentId` / `skill` /
`thinkingSummary` / `badges[]` / `citations[]` / `toolCallLogId` / `proactive`(bool) /
`visibilityScope`（继承自线程，可更严不可更松）

`badges[]` 是**值对象数组**，取值：`degraded`（`降级运行 · <模型名>`）、`review-pending`（`待复核 N`）。
[原型 · 状态 4.5]「把不变量放在它发生的地方」——**标在发生它的那条消息上**，不折叠进别处。

### 4. `Citation`（引用角标 · 三段结构）

`index`（编号）+ `sourceFullName`（出处全称）+ `anchor`。
`anchor` 是判别联合：`{kind:"page", page}` | `{kind:"transcript", range}` | `{kind:"message", messageId}`。
**三段缺一不可**（uc-8-2 R7 引用层）。

### 5. `ToolCall`（工具调用 · **`provenance_events` 的投影，不是第二张表**）

`function`（函数签名）+ `args`（实参）+ `hitCount | reuseFlag` + `status`
（`done`|`reuse`|`running`|`failed`）+ `tokens` + `callerAgentId` + `model@version` + `pipelineVersion`。

汇总行：`callCount` + `readVolume`（`读了 64 条 · 12.4k token`）。

### 6. `ApprovalRequest`（批准请求 · 产品信任核心）

`id` / `threadId` / `status`(`paused`|`approved`|`reparamed`|`declined`|`expired`) /
`callChain[]`（谁调的谁）/ `models[]`（`{id, hosting: "cloud"|"local", registryVersion}`）/
`budget`（`{tokens, amount, currency, unitPriceRef}`）/ `dataScope[]`（`{name, confidential:bool}`）/
`exits`（恒三出口）/ `supersedesRequestId`（改参链）/ `backgroundTaskId` / `expiresAt`。

### 7. `AgentPresence` / `TeamRoster`

在场状态**三值封闭**：`present`（在场）/ `batching`（跑批中）/ `idle`（空闲）。
每个 agent 必须有**职责一句话**。
两个计数分开：`presentCount`（在场数）与 `rosterCount`（编制数）。

### 8. `ChatLanding`（对话产出落地）

`artifactId` + `bindingMode`(`draft`|`live`|`pinned`) + `provenanceBacklink`
（`{conversationId, messageId, citations[]}`）+ `hasSource`(bool)。
⚠ **三模式绑定/快照不可变/引用资格门控的机制本体不在本束**，在 phase-00 `artifact`（D-38）。
本束只持有**入口 + 出处回链 + 门控接线**。

### 9. `ConversationPreset` / `PresetInstance`

预设：`id` + `openingPrompt` + `skills[]` + `agents[]` + `dispatchTargets`
（全场 / 指定组 / 指定角色）+ `version`（按 `artifact_versions` 管理、不可变）。
实例：`id` + `presetId` + `threadId` + `startedBy`。
**预设 ≠ 实例，两者可见性分开判定**（uc-8-4 R7）。

### 10. `PermissionDecision`（判定记录）

`orgRole` + `projectRole` + `groupId` + `visibilityScope` + `allowed` + `deniedLayer`
(`organization`|`project`) + `auditEventId`。
供审计与「为什么被拒」解释使用（uc-8-5 R7 / V5）。

---

## 二、不变量

### A 组 · 可见性（F108，uc-8-5）

**I-1** `Thread.visibilityScope` 的取值恒在五值枚举内，且该枚举是**封闭的**——新增成员必须走 ADR。
› 怎么断言：`expect(SCOPE_VALUES).toEqual(contract.VisibilityScope.options)`，
并断言**未声明的值不能通过** `safeParse`。⚠ 断言集合一致，**不断言 `toHaveLength(5)`**
（`contract-design.md` §五-7 的教训：数成员数会把一个正当的、经 ADR 的新增拦下来）。

**I-2** 任一读取的允许判定恒等于**两层交集**：`allowed === orgLayerAllowed && projectLayerAllowed`。
任一层为假即拒绝，**不存在只过一层就放行的路径**。
› 怎么断言：对判定函数做属性测试，穷举 `(orgRole × projectRole × scope × sameGroup)` 全组合，
断言输出恒等于两层与运算的结果。

**I-3** 拒绝**不泄露资源存在性**：对「资源不存在」与「资源存在但无权」两种情况，
对外响应体与状态码**逐字节相同**。
› 怎么断言：构造两条请求（不存在的 threadId / 存在但越权的 threadId），
断言两次响应的 `status` 与 `body` 深相等。

**I-4** 每一次拒绝都恰好带一个 `deniedLayer ∈ {organization, project}`，且**不为空**。
› 怎么断言：拒绝路径上 `expect(decision.deniedLayer).toMatch(/^(organization|project)$/)`。

**I-5** **观察者的响应体里不存在**原始转写字段、私聊消息、以及任何写能力标记
（输入区 / 批准卡 / `[改派]` / `[全屏编辑]` / `[停止录音]`）。
**是服务端不下发，不是前端隐藏。**
› 怎么断言：以观察者身份取线程详情，`expect(Object.keys(body)).not.toContain("rawTranscript")`；
并对响应体跑契约 schema 的**反向断言**（塞进一个 `rawTranscript` 字段后 `safeParse` 必须失败）——
否则这条断言可能在空转。

**I-6** 跨组一律不可见，**引导师除外**：`groupId(actor) !== groupId(thread) && projectRole !== facilitator ⇒ 拒绝`。
› 怎么断言：第 2 组组长/组员请求第 3 组线程 → 拒绝（且满足 I-3）；引导师请求同一线程 → 成功。

**I-7** `member-private` 线程的可读集恒等于 `{作者本人, 本组组长, 引导师}`（∪ 管理员审计读，见 I-8），
**同组其他组员与观察者不在其中**。
› 怎么断言：五身份遍历，断言可读集与该集合精确相等（多一个少一个都失败）。

**I-8** 组织管理员读**项目层**对话内容 ⇒ **返回内容**且**必然产生一条审计事件**，
该事件对项目负责人可查；读**个人层**只返回计数、不返回正文。
**且不区分管理员是否持有该项目角色**（O-04）。
› 怎么断言：管理员在无项目角色的项目里读 → `expect(status).toBe(200)` **不是 403**；
`expect(auditEvents).toHaveLength(before+1)`；读个人层 → `expect(body.content).toBeUndefined()`。
⚠ 早期稿本的「无项目角色即 403」断言**作废**，照旧稿写测试会产出一个方向相反的绿灯。

**I-9** agent 私聊的 `ownershipLayer` 恒为 `project`，**永不为 `personal`**（O-24）。
› 怎么断言：任取一条私聊记录 `expect(row.ownership_layer).toBe("project")`；
并在 DB 层加 CHECK 约束，使写入 `personal` 直接失败。

**I-10** 私聊**不改变 agent 在场态计数**：发起私聊前后 `presentCount` 与 `rosterCount` 恒不变。
› 怎么断言：读计数 → 发起私聊 → 再读，断言两次相等。

**I-11** 由多来源摘要生成的内容，其可见范围恒取**所有来源中最严格**的那个（防信息洗白）。
› 怎么断言：用 `{plenary, member-private}` 两来源生成摘要，断言结果 scope === `member-private`。

**I-12** 对话的可见性规则对**文件下载同样成立**——`messages.jsonl` 的 ACL 与线程 ACL **同源**
（同一套 `acl_bindings`，文件浏览器不是权限旁路）。
› 怎么断言：组员在 22-files 请求别组会话 / 他人私聊的 `messages.jsonl` → 取不到；
观察者取不到原始转写与私聊文件；管理员可下载项目层文件但**产生审计事件**。

### B 组 · 线程列表与文件形态（F109，uc-8-1）

**I-13** 线程卡的「N 条待复核」与消息头角标「待复核 N」**取自同一字段**，两处数值恒相等。
› 怎么断言：同一线程的列表接口与详情接口，`expect(card.reviewPending).toBe(detail.reviewPending)`；
且代码里**只有一处**计算它（`grep` 不到第二个求和实现）。

**I-14** 线程卡的 `● 转录中` 徽标与**转录服务的真实状态**绑定，**不得由最后消息时间推断**。
› 怎么断言：把转录服务置为运行中 → 列表返回 `transcribing`；停止转录 → 徽标消失；
同时构造「最后消息很新但转录已停」的用例，断言**不出现**该徽标。

**I-15** 已归档线程在默认筛选下不返回；显式筛选可读但**全部写操作被拒**。
› 怎么断言：默认列表不含该 id；`?archived=true` 含它；对它调用改名/删除/发消息全部拒绝。

**I-16** 每个线程在对象存储里恰好有**一个** `messages.jsonl`（**会话为文件粒度**，不是每条消息一个文件），
Segment 精确到消息、anchor 为 `messageId`。
› 怎么断言：产生 N 条消息后列该会话前缀的对象，`expect(keys.filter(isMessagesFile)).toHaveLength(1)`；
任取一条消息的 Segment，断言其 anchor 为 `messageId` 且能在该 `.jsonl` 中定位到。

### C 组 · AI 团队与消息流（F110/F113，uc-8-2）

**I-17** `AgentPresence` 三值封闭（`present`|`batching`|`idle`），且每个 agent 的
**职责一句话非空**。
› 怎么断言：面板接口对每个 agent 断言 `presence` 在枚举内且 `duty.trim().length > 0`；
未声明的取值 `safeParse` 必须失败。

**I-18** `presentCount` 恒等于 `presence === "present"` 的 agent 数，
**与 `rosterCount`（编制数）分离**；两者不得互相顶替。
› 怎么断言：`expect(presentCount).toBe(agents.filter(a=>a.presence==="present").length)`；
并构造一个「跑批中 + 空闲」的场景断言两数不等。
⚠ **这条口径是实现选的，UC 没写**——见「待人类裁决」第 4 条（S-06）。

**I-19** AI **主动发言**（`proactive === true`）的消息，其 `citations` 恒非空。
取不到来源 ⇒ **不产生消息**（不是产生一条空来源消息）。
› 怎么断言：构造取不到来源的主动补充场景 → `expect(messages.length).toBe(before)`；
并对存量数据跑一条全表断言：`proactive && citations.length === 0` 的行数为 0。

**I-20** 右栏恒为**恰好五个**标签（`转录/执行/洞察/产物/材料`），且每个标签的计数与其列表长度一致
（`执行` 为 `已完成/总数` 形式）。
› 怎么断言：`expect(tabs.map(t=>t.key)).toEqual(["transcript","execution","insight","artifact","material"])`；
逐标签 `expect(tab.count).toBe(list.length)`；空线程时计数全 0 且**标签不隐藏**。

**I-21** 改派提示的 `reason` 恒非空（原型例：「有行业数据库授权」），**不得只说「更合适」**。
› 怎么断言：`expect(suggestion.reason?.trim()).toBeTruthy()`。

### D 组 · 可追溯性（F111，uc-8-2）

**I-22** 界面展开的工具调用链条数与该轮 `provenance_events` 条数**严格相等**——
它是**投影，不是第二份日志**。
› 怎么断言：一轮运行后 `expect(chain.length).toBe(provenanceEvents.length)`；
并静态检查全仓**不存在**第二张「调用日志表」。

**I-23** `provenance_events` 是 **append-only**：任何 UPDATE / DELETE 都被拒绝。
› 怎么断言：直接对该表发 UPDATE 与 DELETE，断言两者都失败（DB 级规则，不是应用层 if）。
⚠ 本仓有先例：F08 的第一版 append-only 修法被反证证明是假的。**写完这条门控立刻造反证。**

**I-24** 每条引用的 anchor **100% 可定位**到原件（页码 / 时间码 / `messageId`）；
不可定位的引用视为不合格。
› 怎么断言：遍历某轮全部引用，逐条调用定位函数，断言成功率为 1.0（不是「大部分」）。

**I-25** 工具调用**失败条不得被隐藏**：汇总数与明细条数相等，失败条在明细中带失败态与原因；
基于失败调用得出的结论标为不完整。
› 怎么断言：注入一次工具失败 → `expect(detail.filter(c=>c.status==="failed")).toHaveLength(1)`；
`expect(summary.callCount).toBe(detail.length)`；`expect(conclusion.incomplete).toBe(true)`。

**I-26** agent 取上下文的路径上**不存在**对 `segments` / 向量库 / 对象存储的直连查询——
一律经 Context API 取 Context Pack。
› 怎么断言：静态检查（import / 连接串扫描）；跨 tenant / 项目泄漏测试结果为零。

### E 组 · 批准闸门（F112，uc-8-2）

**I-27** `status === "paused"` 期间，目标动作的副作用数恒为 **0**。
› 怎么断言：触发高影响动作 → 断言目标系统无任何写入（计数 / 快照对比），
且 `expect(req.status).toBe("paused")`。

**I-28** 批准卡的**六项披露字段全部非空**：标题与状态 / 调用链 / 模型 / token 预算（**用量与折算金额同时**）/
要读的数据及其密级 / 三出口。缺一即失败。
› 怎么断言：`for (const k of SIX_FIELDS) expect(body[k]).toBeTruthy()`；
`expect(body.exits).toHaveLength(3)`（此处数量是契约本身，不是枚举成员数）。

**I-29** `status` 的转移是**单向且一次性**的：`paused → {approved | reparamed | declined | expired}`，
**已终态不可再转**。
› 怎么断言：状态机表驱动断言；对已 `approved` 的请求再调 `decline` → 拒绝；
并发两次 `approve` 只有一个生效，另一个收到「状态已变化」。

**I-30** `[改参数再跑]` 生成**新的**批准请求，原请求**不可就地改写**，
且新请求通过 `supersedesRequestId` 指回原请求（原请求存档为「已改参」）。
› 怎么断言：改参后 `expect(newReq.id).not.toBe(oldReq.id)`；
`expect(oldReq.status).toBe("reparamed")`；断言 `oldReq` 的披露六项**字节未变**。

**I-31** 批准卡的**模型标识、单价与折算金额恒来自 model registry**，
本模块**不存在硬编码的模型名或价目表**。
› 怎么断言：改 registry 里的单价，同一动作的批准卡金额随之变化；
静态检查本模块源码中不出现模型型号字面量与货币单价常量。
⚠ 现状与此相反：`apps/web/lib/mock/chat.ts` 里就有型号与价目（S-13 也承认「18 台模型的型号与定价全是编的」）。

**I-32** **含机密的数据范围 ⇒ 本轮的模型集合全部 `hosting === "local"`**（D-U1）；
调用出域模型的请求在 **gateway 层被拒绝**，不是界面提示。
› 怎么断言：构造含机密的 dataScope 并把模型改为云端 → API 层拒绝，错误指向「含机密仅本地模型」；
断言该拒绝**不依赖界面禁用**（直接打接口）。
🔴 **[待人类裁决]** —— 见下节第 1 条。**这条不变量的判定函数在两个口径下写法不同**，
裁决前不得据其写死断言。

### F 组 · 产出落地（F114，uc-8-3）

**I-33** 落地产出的出处回链三项恒非空：`conversationId` / `messageId` / `citations[]`，
**缺失时只能落草稿、不得定版**。
› 怎么断言：构造缺 `messageId` 的落地请求 → 只允许 `mode="draft"`；调 `pin` 被拒。

**I-34** 下游引用（加入报告正式版 / 提交验收 / 引用为决策依据 / 写回图谱与大脑）
**恒要求 `bindingMode === "pinned"`**；`draft` 与 `live` 全部被服务端阻断。
› 怎么断言：三种模式 × 四个下游接口的 12 格矩阵，断言 8 格拒绝（错误指向「需先定版为固定快照」）、
4 格成功。**门必须是 phase-00 `artifact` 的 `referenceForDownstream` 那一个**，不在对话侧自判。

**I-35** **模式不可降级**：`pinned` 不能退回 `live` 或 `draft`。
› 怎么断言：对已定版产出调 `upgradeBinding` 目标为 `draft`/`live` → 拒绝。

**I-36** `draft` 模式产出**仅创建者可见**，其余角色（**含项目管理员与组织管理员**）
返回 **404 而非 403**（否则 404/403 的差异本身泄露了存在性）。
› 怎么断言：六身份遍历，创建者 200，其余全部 404（**逐字节相同的 404**，见 I-3）。

**I-37** `hasSource` 是**服务端可判定的状态**，不是纯视觉：无引用的结论 `hasSource === false`，
且「加入报告」被拒。
› 怎么断言：构造无引用结论 → `expect(item.hasSource).toBe(false)`，调「加入报告」拒绝。

### G 组 · 预设（F115，uc-8-4）

**I-38** 预设的使用计数恒等于**真实实例数**，与下发人数无关。
› 怎么断言：下发给 10 人、3 人开始 → `expect(usageCount).toBe(3)`。

**I-39** 预设本身可见 ≠ 实例可见：A 开始后生成的实例对 B 不可见（判定走 A 组不变量）。
› 怎么断言：B 请求 A 的实例 → 拒绝且满足 I-3。

**I-40** 下发时校验预设引用的 agent / skill 在下发对象的**可见性范围内**，
越范围**在下发接口即拒绝**，不是下发后失败。
› 怎么断言：预设引用「仅能源组」的 agent 并下发给非能源组 → 下发接口返回拒绝，
错误标明是**组织层**可见性限制；断言此时**没有任何实例或通知被创建**。

**I-41** 预设**不得预先批准任何高影响动作**，也**不得预置绕过权限或同意位的检索范围**（O-05）。
› 怎么断言：在预设里塞一个「预批准」标记 → 保存被拒；
实例运行中命中高影响动作 → 仍然产生批准卡（I-27 依旧成立）；
拒绝「交给 AI 分析」的受访者片段在任何预设实例的模型输入中出现次数为 0。

### H 组 · 保留期（跨 A–G）

**I-42** 保留期一律**读参数不硬编码**：材料 180 / 留痕 180 / 审计 1095 天（O-01 默认值）；
快照 / 绑定关系 / 审计留痕属**不可删对象**，不受材料保留期约束。
› 怎么断言：静态检查源码中不出现 `180` / `1095` 字面量参与保留期计算；
跑一次到期删除任务，断言它**不触及**快照与审计事件。

---

## 三、[待人类裁决]

> 这些是 UC 没写、或 UC 与实现口径打架的地方。**不许由实现者自己定。**

### 1. 🔴 含机密时的模型路由口径（缺一条二选一的裁决）

| 口径 | 出处 | 后果 |
|---|---|---|
| **A：整轮走本地** | `feature_list.json` F112 / D-U1：「含机密⇒整轮走本地，不是分流，后端 gateway 按同一规则拦截」 | 含机密时**云端模型本轮完全不可用**；批准卡的 `[改]` 里云端选项不可选 |
| **B：机密走本地、云端并存承接非机密** | `ui-preview/README.md` **S-01**：实现取的就是这个口径，`modelPolicyViolation()` 只在「有机密但无任何本地模型」时报违规 | 允许 `gpt-5.2 ＋ 本地 qwen3-32b` 并存（原型印的就是这行字） |

**为什么必须裁**：原型**字面自相矛盾**——同一张批准卡上同时印着
「gpt-5.2 ＋ 本地 qwen3-32b」和「含机密，仅本地模型」。
两个口径会做出**两个不同的 gateway**，而 gateway 只能有一个。

⚠ **跨束交叉约束**：`agent-runtime`（模型网关 / model registry）束会写同一条。
**两边都指向本条裁决，不各自定义一份口径**（见 `design-signoff.md` 的 X-1）。
在裁决落地之前，I-32 的判定函数**不得写死**。

### 2. 可见范围徽标的位置与文案（缺界面依据）

uc-8-5 AC1 要求「每条对话都明确标出可见范围」，但 uc-8-5 R8 / R10 自述
**原型的线程卡与线程头上均未见此徽标**。缺：徽标贴在哪（线程卡 / 线程头 / 两处）、
五个取值印什么字、观察者视角下怎么呈现。
**服务端的 `visibilityScope` 字段本身是 [原型] 明确的**，缺的只是界面这一半。

### 3. 观察者到底还能看到什么（S-11，两处判断不一致）

uc-8-5 说观察者「已发布产出与脱敏聚合可见」；实现在 `/chat` 的口径是
「滤掉批准卡与转录卡，不渲染输入区/改派条/分享，**只留 AI 发言与产物卡**」。
**「已发布产出的只读展示」要不要保留没有答案**——它决定 F108 的投影函数少返回还是多返回一块。

### 4. 「在场数」是否包含跑批中的 agent（S-06）

原型同时有「团队 **4**」与「AI 团队 · **6**」。实现选了「在场 = present（4 个），
跑批中与空闲不计入」。它连带决定线程卡上的「N 个 agent」是哪个数。**UC 没写。**
I-18 目前按实现口径写，裁决后可能要改。

### 5. 「高影响动作」的完整判定表（O-26，未在本轮裁决范围）

已定的只有原则：R1/R2/R3 按操作类型自动推导（外发邮件恒 R3、读公开资料恒 R1），任务模板可覆盖。
**完整映射表没有。** 批准卡「不自行定义风险等级，只呈现判定结果」——
所以这张表是本束的**外部输入**，缺它无法穷举「哪些调用会停下来」。

### 6. 批准超时时长与折算金额来源（uc-8-2 R10 [待确认]）

O-36 已给默认值：**现场 5 分钟 / 非现场 24 小时**（可配）。仍缺：
token → 金额的**汇率与单价来源**、**是否按组织可配**。
现在 `budgetLine` 读的是 mock 常量。

### 7. 对话侧是否同样「未挂来源标灰」（uc-8-3 R6 [待确认]）

「每句都会挂来源，未挂来源的标灰」的原文出自**洞察报告工作台**（proto-05），
**不在对话侧**；uc-8-3 的原型缺口三态明写对话屏「未见任何标灰呈现」。
对话侧同规则属**推断**。I-37 目前按「同规则」写。

### 8. `[加入报告]` 是否自动触发定版（uc-8-3 R10 [待确认]）

一键定版 + 绑定（一步），还是阻断 + 给定版入口（两步）？
本束按**两步**书写（对齐 `uc-0-1` E1）。

### 9. 「组长能看本组组员私聊」是否需对组员显式告知（uc-8-5 R10 [待确认]）

契约上是硬规则（I-7）；**告知的位置与文案没有依据**。合规侧建议告知。

### 10. 观察者单独授权「环节结束自动失效」的触发点（uc-8-5 R10 [待确认]）

是「环节切换」还是「环节标记完成」？两者在跨环节的边界上行为不同。

### 11. 「更早」线程的归组与检索（uc-8-1 [原型确认缺失]）

原型只有 `今天` / `本周` 两组，**无「更早」组、无翻页、无时间筛选**。
更久线程怎么归组、怎么找回来，需产品定义。

### 12. 预设对象整体缺原型（uc-8-4，本束最大的一块空白）

「预设」二字在原型抽取档案 proto-01~10 中 **0 命中**。列表、编辑器、下发对象选择器、
使用计数、被下发者接收入口**全部不存在**。F115 的全部主流程步骤**不得按 `[原型]` 实现**。
本文件对 F115 写出的不变量（I-38…I-41）全部来自 `[Backlog]` 文档，**没有界面证据**。
