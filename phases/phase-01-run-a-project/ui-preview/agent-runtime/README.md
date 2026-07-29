# agent-runtime · UI 先行原型截图与 sign-off 说明

> ADR-003 / ADR-023 签核第 ① 件材料。**契约束 `agent-runtime`（合并 04-agent / 20-model / 21-mcp），13 feature / 53 点。**
> 路由：`/preview/agent-runtime`。代码：`apps/web/app/preview/agent-runtime/page.tsx`
> ＋ `apps/web/components/agent-runtime/*` ＋ `apps/web/lib/mock/agent-runtime.ts`（纯 mock，不接后端）。
>
> 截图用真实组件跑 dev server（`next dev`，视口 1360×900，2×）抓的，**不是设计稿**。
> 每屏都可点、可切屏、可切视角、可切七态。抓图时 **0 条真实控制台报错**（沙箱拦掉的 Google 字体请求不计）。
>
> ⚠ **我没有改任何 `ui-signoff.md` / `design-signoff.md` 的 status。** 那是人类的动作。
> 下面「待确认清单」是给 sign-off 用的，不是已确认结论。
>
> ⚠ **范围纪律（重要）**：Agent 管理 / 模型管理 / MCP 服务器**列表屏**在原型里已探明、且已在
> `/admin/agent`、`/admin/model`、`/admin/mcp`（`components/admin/*`）落地，**可直接签**——本轮**不重画**它们。
> 本目录只补各 UC 明确标为 **「原型确认缺失 / 需补画 / 真·未探明配置面板」** 的**净新屏**：
> 权限内核、安全策略四开关与放行评审、机密路由批准卡、AI 团队编排主持台、agent 私聊、行为审计下钻与组织级检索。
> mock 里的 agent / 模型 / MCP 记录**从 `lib/mock/admin.ts` re-export 复用**，保证「同一 agent 在两处是同一条记录」。

---

## 一、截图清单 —— 每张对应哪份 UC 的哪一节、哪些 feature

预览控制条三行：`?screen=`（6 屏）｜`?as=`（视角）｜`?state=`（七态，走共享 `StateShell`）。

### 屏 1 · 三层权限 · 工具白名单编辑器（`screen=permission`，UC-4.1 / UC-21.1）
| 截图 | 状态 / 视角 | UC 节次 | feature |
|---|---|---|---|
| `uc-4-1-permission-default.png` | 默认态 · 能力维护者 | UC-4.1 R3 第 2 步；R7 三层求交；R8 白名单编辑器 | F56 F53 F55 |
| `uc-4-1-permission-cosign.png` | 默认态 · 组织管理员（会签复选出现） | UC-4.1 R3 第 9 步、O-21 会签 | F56 |
| `uc-4-1-permission-tool-whitelist-cosign.png` | 越权申请逐条裁决弹层 | UC-4.1 R3 第 9 步 E2、R5 O-21 | F56 F54 |
| `uc-4-1-permission-loading.png` | 加载态 | UC-0.4 七态 / U1 | F56 |
| `uc-4-1-permission-empty.png` | 空态（白名单为空＝未配不得发布） | UC-4.1 E1、A1 复制不继承；U2 | F56 F55 |
| `uc-4-1-permission-invalid.png` | 校验失败态（越权未会签不得保存） | UC-4.1 AC2/AC3；U3 | F56 |
| `uc-4-1-permission-dep-failed.png` | 依赖失败态（MCP 网关不可达） | UC-4.1 E3；UC-21.1 E1 | F53 |
| `uc-4-1-permission-denied.png` | 无权限态 · 引导师（只用不配） | UC-4.1 R5 | F56 |
| `uc-4-1-permission-success.png` | 成功态（会签放行、白名单定稿） | UC-4.1 R3 第 10–11 步 | F56 |

### 屏 2 · MCP 安全策略 · 放行评审（`screen=mcp-policy`，UC-21.2）
| 截图 | 状态 / 视角 | UC 节次 | feature |
|---|---|---|---|
| `uc-21-2-mcp-policy-default.png` | 默认态 · 组织管理员（四开关 + 隔离行） | UC-21.2 R7 四开关表、R3 开关一~四；O-19 可关闭性 | F54 |
| `uc-21-2-mcp-review-panel.png` | 放行评审弹层（结论三选 + 理由 + 授权范围） | UC-21.2 R3 第 2–3 步、R8 评审面板 | F54 |
| `uc-21-2-mcp-policy-invalid.png` | 校验失败态（放行未设授权范围） | UC-21.2 E2 / AC5 | F54 |
| `uc-21-2-mcp-policy-empty.png` | 空态（无待评审服务器） | UC-21.2 A3 / U2 | F54 |
| `uc-21-2-mcp-policy-denied.png` | 无权限态 · 能力维护者（只读策略） | UC-21.2 R5 | F54 |

### 屏 3 · 机密数据的模型路由 · 批准卡（`screen=routing`，UC-20.3 / UC-20.2）
| 截图 | 状态 / 视角 | UC 节次 | feature |
|---|---|---|---|
| `uc-20-3-routing-default.png` | 默认态 · 引导师（批准卡 · 含机密仅本地） | UC-20.3 R3、R8 批准卡；UC-4.4 ② 批准卡 | F51 F60 |
| `uc-20-3-routing-explain.png` | 「含机密」解释下钻（逐项机密判定） | UC-20.3 R8『可点的解释入口』（原型确认缺失） | F51 |
| `uc-20-3-routing-change-confidential.png` | `[改]` 面板 · 含机密时只列自托管候选 | UC-20.3 R3 第 4 步 E4、AC3b | F51 F50 |
| `uc-20-3-routing-nolocal-fail.png` | **依赖失败态 · 无可用自托管模型**（本用例最重要一态） | UC-20.3 R4 E1、AC2；UC-20.2 E1 | F51 F50 |
| `uc-20-3-routing-invalid.png` | 校验失败态（改成闭源被拒） | UC-20.3 E4 | F51 |
| `uc-20-3-routing-dep-failed.png` | 依赖失败态（证据平面不可达） | UC-20.3 R10 架构对齐 | F51 |
| `uc-20-3-routing-denied.png` | 无权限态 · 观察者 | UC-20.3 R5 | F51 |
| `uc-20-3-routing-success.png` | 成功态（路由到本地 qwen3-32b） | UC-20.3 R3 第 2 步 | F51 |

### 屏 4 · AI 团队编排 · 主持台（`screen=team`，UC-4.2）
| 截图 | 状态 / 视角 | UC 节次 | feature |
|---|---|---|---|
| `uc-4-2-team-default.png` | 默认态 · 引导师（三态 + 因什么载入 + 编制≠在场 + 下一步换谁 + 优先级裁剪 + 改派 + 项目级三开关） | UC-4.2 R3 阶段二/三、R8；AC1/AC2/AC3；O-23 | F57 F58 |
| `uc-4-2-team-member.png` | 默认态 · 组员（改派可见性待确认） | UC-4.2 R5 组员、R10 待确认 | F57 |
| `uc-4-2-team-observer.png` | 默认态 · 观察者（只见在场名单） | UC-4.2 R5 观察者 | F57 |
| `uc-4-2-team-loading.png` | 加载态 | U1 | F57 |
| `uc-4-2-team-empty.png` | 空态（无 agent，不自动塞默认） | UC-4.2 A4 / U2 | F57 |
| `uc-4-2-team-invalid.png` | 校验失败态（可见性不覆盖本项目） | UC-4.2 E3 | F57 |
| `uc-4-2-team-dep-failed.png` | 依赖失败态（实时通道不可用 → 非实时） | UC-4.2 E8 / R9 | F57 |
| `uc-4-2-team-success.png` | 成功态（按环节重新载入，原因已记录） | UC-4.2 AC1 | F57 |

### 屏 5 · 与单个 agent 私聊（`screen=chat`，UC-4.3）
| 截图 | 状态 / 视角 | UC 节次 | feature |
|---|---|---|---|
| `uc-4-3-chat-default.png` | 默认态 · 引导师（skill 清单 + 审计告知 + 转出入口） | UC-4.3 R3、R8（原型确认缺失，整面补画） | F59 |
| `uc-4-3-chat-transfer-provenance.png` | 转出到主线程 · 出处预览弹层 | UC-4.3 R3 第 3 步、AC1 | F59 |
| `uc-4-3-chat-member.png` | 组员视角（默认无私聊入口） | UC-4.3 R5 O-24 | F59 |
| `uc-4-3-chat-denied.png` | 观察者视角（无私聊入口） | UC-4.3 A1 / R5 | F59 |
| `uc-4-3-chat-loading.png` | 加载态 | U1 | F59 |
| `uc-4-3-chat-empty.png` | 空态（无可私聊 agent） | UC-4.3 A4 / U2 | F59 |
| `uc-4-3-chat-invalid.png` | 校验失败态（目标主线程已归档，转出被拒） | UC-4.3 E4 | F59 |
| `uc-4-3-chat-dep-failed.png` | 依赖失败态（模型停用/MCP 隔离，能力受限） | UC-4.3 E2 | F59 |
| `uc-4-3-chat-success.png` | 成功态（转出带出处，未进主线程） | UC-4.3 AC1 | F59 |

### 屏 6 · Agent 行为审计（`screen=audit`，UC-4.4）
| 截图 | 状态 / 视角 | UC 节次 | feature |
|---|---|---|---|
| `uc-4-4-audit-default.png` | 默认态 · 组织管理员（时间线四类 + 异常限速 + 组织级检索） | UC-4.4 R3 阶段三/四、R8；AC1–AC5；D-34 | F60 |
| `uc-4-4-audit-drill-toolcalls.png` | Agent 调用下钻（tool-call 四要素 + 调用链深度 2 + 采纳与否 + 权限快照） | UC-4.4 R3 第 7 步、AC2/AC3；O-22⑤ | F60 |
| `uc-4-4-audit-chain.png` | 异常调用链下钻（含拦截点） | UC-4.4 R3 第 11 步、AC4 | F60 |
| `uc-4-4-audit-facilitator.png` | 项目负责人/引导师视角（无组织级检索） | UC-4.4 R5 | F60 |
| `uc-4-4-audit-denied.png` | 无权限态 · 组长（不可见审计屏） | UC-4.4 R5 | F60 |
| `uc-4-4-audit-loading.png` | 加载态 | U1 | F60 |
| `uc-4-4-audit-empty.png` | 空态（无审计事件，不造示例） | UC-4.4 A1 / U2 | F60 |
| `uc-4-4-audit-invalid.png` | 校验失败态（tool-call 留痕写入失败即调用失败） | UC-4.4 E2 / AC6 | F60 |
| `uc-4-4-audit-success.png` | 成功态（导出 CSV，可复现） | UC-4.4 R6 | F60 |

**testid**：每个可交互元素与关键展示区都带 `data-testid`（`perm-* / mcp-* / routing-* / team-* / chat-* / audit-*`，
七态保留名 `loading / empty / err-* / denied / dep-failed / saved` 由共享 `StateShell` 承担），供 verification 锚定。

---

## 二、界面上无法自洽的点（sign-off 必须先裁的）

1. **🔴 provenance 事件枚举里没有 tool-call / model-route 类型 —— 但 UC-4.4 / UC-20.3 都把它们往这张表写。**
   `packages/contracts/src/provenance.ts` 的 `ProvenanceEventType` 是**封闭枚举**（`ingested / generated /
   capability-* / unauthorized-attempt / admin-project-access …`）。UC-4.4 R10 架构对齐明写「tool-call 记录、
   调用链、批准记录、越权拦截、限速动作**一律写入 `provenance_events`**」，UC-20.3 R7 又要求「每次路由决策写入
   `provenance_events`」。**但枚举里没有 `tool-call` / `agent-call` / `model-route` / `rate-limited` 这几类。**
   我在审计屏（`audit-drill`、`routing`）把这些事件画了出来，但它们**在契约里目前无处落**——
   新增事件类型按 provenance.ts 头注是**要走 ADR 的**。裁决点：新增这几个封闭枚举值（走 ADR），还是把 tool-call
   细节塞进现有 `generated` 的 `detail` 里（会让「Agent 调用 183」这类按类型筛选失效）。**我没擅自加枚举。**

2. **🔴 越权申请「会签」的两签，与 provenance 的 `unauthorized-attempt` / `capability-updated` 对不齐。**
   UC-4.1 O-21 要求越权申请由**安全评审人 + 组织管理员双签**，且 UC-4.4 V22 要审计出「只有一签 = 流程不合规」。
   但 `PermissionDecision` / `ProvenanceEvent` 里**没有承载两个签名人 + 会签状态的字段**。权限内核屏
   （`perm-cosign`）把两签画成了「管理员会签复选 + 安全评审人裁决按钮」，但**这套双签数据结构契约未定**——
   落 API 契约时必须补，否则 V22 的验收断言写不出。

3. **组员是否能看到改派提示 —— UC-4.2 R10 明标「待确认」，界面被迫先呈现一半。**
   `team-member.png` 里我给组员视角画的是「改派提示条**存在但不可操作**，附一个 `待确认` 徽标」。
   实际这条边界（组员端能不能看到「这条更适合 Scout」）**未定**：能看到会泄露「Scout 有行业数据库授权」这类
   授权信息，看不到又与「改派是全线程行为」冲突。sign-off 必须给答案，否则 F58 的 RLS 断言写不出。

4. **「有条件放行」的工具级粒度 —— UC-21.2 R10 倾向 phase-1 不做，但 O-19 未直接覆盖。**
   放行评审面板（`mcp-review-panel.png`）我把结论画成三选：放行 / 维持隔离 / **有条件放行（工具级 · 待确认）**，
   并在第三项旁标了「工具级放行粒度 phase-1 未定」。若最终不做工具级放行，第三个结论应删；若要做，
   需与「涉客户数据按服务器整体标注、工具级留 phase-2」（O-19）保持粒度一致。**这条我没替它拍板。**

5. **机密路由的「剔除机密材料后用闭源模型」出口 —— UC-20.3 A3 标待确认，我没画这个出口。**
   `routing-nolocal-fail.png` 我只画了「明确失败 + 联系管理员」，**没有**给「剔除机密材料后改用闭源」的按钮。
   因为提供该出口需要「被剔除项记入 Context Pack 的 omissions」等一整套，且 A3 本身待确认。
   若 sign-off 决定提供，这一态要补一个「剔除了什么 / 结论可能受限」的确认屏。

6. **蓝本第 12 项「4 个」到底是 4 条规则还是 4 个 agent —— UC-4.2 未探明，主持台按「在场计数」呈现。**
   `team-default.png` 的「编制 6 / 在场 4」用的是线程级编制口径；蓝本级「Agent 编排 4 个」的配置面板内部
   （触发条件编辑器、优先级设置）**属真·未探明，本轮未画**。若「4 个」= 4 条规则，蓝本配置面需要一个
   规则列表 + 触发条件（只能引用 `agenda_segment_id`）编辑器——那是另一块补画，不在本轮。

---

## 三、我替 UC 做的判断（UC 没写明、我在界面上定了的，逐条看）

1. **三层权限画成「并列三格 + 卡在哪层高亮」**（`permission` 屏下半）：UC-4.1 R7 只说「三层求交、收紧优先、
   下层不放宽」，没规定表现。我把每条场景摊成 `① MCP授权 / ② 白名单 / ③ 任务权限包` 三格，未过的格标红并在
   顶部写「拒绝 · 卡在 ② 层」。目的是让「下层写了也不放宽上层」在屏上可证（`tl-l1` 那条：①红、②③即便通过也拒）。
2. **越权申请用红色 `越权申请` 徽标 + 独立会签闸门卡**，不是把越权工具静默隐藏。让「待人类裁决的权限扩张」
   在界面上看得见，正是 ADR-003 的用意。会签复选**仅在组织管理员视角出现**（`permission-cosign.png`）。
3. **四开关的「不可改」用只读常开/常关 + 锁形图标**呈现（`mcp-policy`），而非可点后报错——UC-21.2 R8 明确建议
   「带锁形图标与说明，而非可点但报错」。可关的两条（开关一、二）关掉走二次确认弹层并写「关掉会发生什么」。
4. **「含机密，仅本地模型」做成可点解释下钻**（`routing-explain.png`）：UC-20.3 R8 记原型该行是纯文本、
   行内无入口，属原型确认缺失。我做成点开看「哪些内容被判机密、依据什么标记」，让批准人能对判定负责。
5. **无可用自托管模型 = 整屏失败态 + 无「换个模型试试」出口**（`routing-nolocal-fail.png`）。UC-20.3 R8 要求
   「不提供任何『用别的模型试试』的出口」——我把批准卡整体换成红色失败卡，只留「联系管理员」。
6. **私聊面板整面补画**（`chat`）：右侧滑出布局、顶部固定 skill 清单（带版本）、每条 agent 结论旁 `转到主线程`、
   顶部常驻「本对话属于本项目，可被审计」告知条（O-24 的义务）。这些 UC-4.3 R8 全标原型确认缺失，形式由我定。
7. **编制数与在场数做成两个独立徽标**（`team`：`编制 · 6` / `在场 · 4`），并在 DecisionNote 里点名这是原型
   「AI 团队 · 6」vs「团队 4」对不上的正解。AC2 要求两口径分别标注不混用。
8. **「因什么载入」做成每行可展开的 AI 底色说明块**（`team-*`）；「下一步换谁」「本可载入但被优先级裁剪」
   做成主持台两张并列卡。这三件 UC-4.2 R8 都标原型确认缺失（原型 AI 团队六行零载入原因）。
9. **项目级 AI 权限三开关默认全关**（`team`，O-23）+ 每个开关旁「关掉会发生什么 + 受影响 agent/skill」。
10. **审计条目下钻里补「三层权限快照」「Context Pack 可重放」两行**（`audit-drill`）——O-22⑤ / 架构 P4
    要求每条 tool-call 带 `agent_version / skill_version / model_id + 三层权限快照`，缺任一即审计不完整。
11. **组织级审计检索屏（D-34 新建、原型无）仅组织管理员视角出现**（`audit-default` vs `audit-facilitator`），
    其余视角给一条「切到组织管理员查看」的说明，而非空白。

---

## 四、R8 线索之间互相矛盾、我怎么处理的

- **「客户 CRM 已拦截 7 次」到底是哪个开关的证据**（UC-21.1 R8 说是授权范围执行 vs 早期 UC-21.2 误挂到开关四）：
  我按更正后的口径——它是**授权范围（UC-21.1 / F53）**的执行结果，**不是**开关四『agent 自行发现』的证据
  （客户 CRM 是已注册已连接的服务器）。故开关四画成**只读常关**，并在 `mcp-policy` 的 DecisionNote 里逐字说明
  这个证据错配。异常调用链 `audit-chain.png` 也把这条归到「授权范围越权」而非「发现新服务器」。
- **「私聊不进主线程」（隔离）vs「私聊归项目层、可审计」（O-24）**：看似冲突。我的处理——私聊**正文**与主线程
  隔离（不进转录/洞察/产物），但**审计元数据**进 UC-4.4 时间线；顶部常驻「本对话属于本项目，可被审计」把
  「隔离≠私人空间」讲清楚。转出后才成为项目产出来源（出处预览屏）。
- **「物化/载入是同步」vs「跑批中的 agent 不被环节切换强杀」**（UC-4.2）：`team` 屏把 `跑批中` 态的 Ledger 画成
  「不因环节切换换出、附 `看任务队列`」，与「在场/空闲」区分开——换出只影响是否继续主动发言，不杀后台任务。

---

## 五、明确没做 / 做不到的部分（如实说，不糊）

1. **全部是 mock，零后端**：白名单勾选、三层求交、路由判定、会签、放行、转出、限速都是**静态陈列**，
   不真跑权限引擎、不真调模型、不真写 provenance。七态是切 URL 看九个例子，不是真状态机流转。
2. **不重画三张列表屏**：Agent 管理 / 模型管理 / MCP 服务器**列表**已在 `/admin/*` 存在且可直接签，本轮只补净新屏。
   模型接入表单、五项测试判读面板、模型启用/停用 toggle、停用二选一确认**也已在 `components/admin/model-screen.tsx`
   落地**（F48/F49/F50 的主体），本目录不重复。
3. **蓝本第 12 项「Agent 编排」配置面板内部**（触发条件编辑器、优先级、「4 个」语义）**未画**——属真·未探明，
   见第二节 #6。`[编制]` / `＋ 从 Agent 市场加入` 点开后的面板也只给了 toast 占位。
4. **组织级审计检索屏只做了检索结果列表**（`audit-org-search`），真正的多维筛选（项目×人×时间的联动过滤）
   与导出 round-trip 是后端能力，未做。
5. **响应式**：只抓了 1360 宽桌面图。375 / 768 档未抓图（`RuntimeShell` 用 `flex-wrap` + `sm:` 断点做了自适应，
   但本轮未跑三档验证）。
6. **prompt injection 防线、synthesized 强制、旁路 Context API 检测**（架构不变量）是后端断言，界面不可见、未做。
7. **契约缺口**：`ToolWhitelistEntry / ThreeLayerDecision / McpSecuritySwitch / ToolCallRecord / 双签结构` 等
   phase-1 契约尚未定义，集中放在 `lib/mock/agent-runtime.ts` 顶部并标注「待迁入 packages/contracts」。
   已有的 `VisibilityScope / McpAuthScope / 三正交字段 / MODELS / MCP_SERVERS` 均复用 `lib/mock/admin.ts`（其中
   `VisibilityScope` 已从契约 `identity.ts` 派生）。

---

## 六、建议 sign-off 时重点核对的三处

1. **provenance 事件枚举缺 tool-call / model-route 类型（第二节 #1）** —— 这是会真漂的契约缺口：
   UC-4.4 / UC-20.3 / UC-21.2 三处都往 `provenance_events` 写这些事件，而封闭枚举里没有对应值，
   加枚举要走 ADR。**先定这几类事件类型，再让 requirement-author 锚 testid、写 V16/V18 断言。**
   否则「Agent 调用 183」的按类型筛选、tool-call 四要素的落库都无处安放。

2. **越权申请双签的数据结构 + 组员改派可见性（第二节 #2、#3）** —— 两条都直接决定 F56/F58 的服务端断言：
   双签（安全评审人 + 组织管理员）在 `PermissionDecision` 里目前无字段；组员能否看改派提示会泄露授权信息。
   界面已被迫先呈现一半（会签复选、组员改派条待确认徽标），这两条不定，RLS 与会签验收写不出。

3. **机密路由的三条边界（第二节 #5 + 第三节 #4/#5）** —— 「无本地模型时是否给『剔除机密后用闭源』出口」
   「有条件放行是否做工具级粒度」「机密判定粒度材料级 vs 片段级」。这些直接定义本产品最强的一条数据边界
   （机密不出自托管）的**逃生口有多大**，误判即机密外泄。`routing-nolocal-fail` 当前取的是最保守解（不给出口），
   需机密/合规 + 产品共同拍板。
