# CopilotKit / AG-UI 范围澄清（实测，非裁决）

> 这是一份**调查/澄清文档**，不是 ADR，不改变任何一方现存文档的地位。
> 实测 SHA：`10b8fa6f`（分支 `worker/coord-architecture-copilotkit-agui-scope`，2026-08-08）。
> 结论仅代表证据指向；第 3 节明确写出需要人类/coordinator 拍板的点，本文档不替他们拍板。

## 0. 结论先行（详细证据见下）

1. **真实的 `@copilotkit`/AG-UI 落地已经存在**，不再是"零依赖、纯 polling/纯 CSS"——这与本任务背景摘要给出的旧快照（"从未安装 `@copilotkit`"）不一致，那份摘要已过期。截至实测 SHA：
   - `apps/web` 已装 `@copilotkit/react-core@^1.66.4`、`@copilotkit/react-ui@^1.66.4`（`apps/web/package.json:26-27`）。
   - `apps/api` 有一个真实的 AG-UI SSE 端点 `POST /copilotkit/agui`（`apps/api/src/interface/controllers/copilotkit-agui.controller.ts`），事件类型取自 `@ag-ui/core` 的 `EventType`，走真实 `text/event-stream`（同文件 128-201 行）。
   - 有一个真实使用 `@ag-ui/client` 的 `HttpAgent` 的前端预览面板（`apps/web/components/chat/copilotkit-preview-panel.tsx`），以及一个把 `@copilotkit/react-ui` 的 `Markdown` 组件接入**生产** `/chat` 消息面板的改动（`apps/web/components/chat/chat-live-message-panel.tsx`，见 §2）。
2. **但这一切都发生在一次人类直接指令之后（issue #654，2026-08-07），该指令明确覆盖了 `context-engine.md` 的"P4 限定"旧裁定**——`architecture.md`／`context-engine.md` 目前谁都没有被回填这条最新事实，两份文档仍停在 2026-07-28 的原文，是本文档要指出的**真实漂移**，不是要我来仲裁的悬案。
3. **生产 `/chat` 聊天面仍然是纯 polling**（`chat-live-message-panel.tsx` 顶部注释明写"轮询,不是 SSE"，且实测未变）；AG-UI SSE 桥接端点目前只被一个**未挂在生产导航上的孤立预览路由** `/chat/copilotkit-preview` 调用。PR #670 对生产面板做的是**视觉重做 + 复用一个不依赖 CopilotKit runtime context 的展示型组件（`Markdown`）**，没有把生产聊天切换到 AG-UI/SSE 协议。
4. **一个具体、真实、目前还没人处理的缺口**：`apps/web/next.config.mjs` 的 `rewrites()` 里**没有** `/copilotkit` 前缀的改写条目（详见 §4），而本仓的浏览器 E2E 网关（`playwright.chat-read.config.ts`、`playwright.fullstack-smoke.config.ts`）把 `NEXT_PUBLIC_API_URL` 设成 Web 自己的 origin，依赖这份改写表做同源代理——这意味着在这些网关下访问 `/chat/copilotkit-preview` 并发消息，`/copilotkit/agui` 请求会被 Next 自己接住返回 404 HTML，而不是打到 `CopilotkitAguiController`。这正是本文件同一份 `next.config.mjs` 里反复出现的"缺裸路径改写 → 前端表现成'后端没实现'"那个坑（见该文件 #435/#595/#552/#548/#466/#652/#363 等注释里记录的同类先例），但 `/copilotkit` 还没有被补上，也没有出现在 `.harness/state/rewrite-coverage-allowlist.json` 的棘轮名单里——即它既不是"已知豁免的历史债"，也不是"已解决"，是一个未登记的空白。

---

## 1. 今天代码里真实存在什么（file:line 证据）

### 1.1 依赖

- `apps/web/package.json:26-27`：
  ```
  "@copilotkit/react-core": "^1.66.4",
  "@copilotkit/react-ui": "^1.66.4",
  ```
  （`@copilotkit/runtime` **没有**被装——即经典 GraphQL runtime 拓扑被人类裁决明确排除，见 §2。）
- `@ag-ui/client`、`@ag-ui/core` 作为传递依赖被直接 import（`apps/web/components/chat/copilotkit-preview-panel.tsx:4-5`；`apps/api/src/interface/controllers/copilotkit-agui.controller.ts:52` 的文件头注承认"already a transitive dependency via `apps/web`'s CopilotKit packages, so declaring it here added no new download"）。

### 1.2 后端：`POST /copilotkit/agui`

- 控制器：`apps/api/src/interface/controllers/copilotkit-agui.controller.ts`（202 行）。事件序列固定为 `RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT → TEXT_MESSAGE_END → RUN_FINISHED`（成功）或单条 `RUN_ERROR`（1-48 行文件头，128-201 行实现），是真实的 SSE（`response.writeHead(200, {"Content-Type": "text/event-stream", ...})`，145-150 行），不是伪装成 SSE 名字的别的协议。
- 编排：`apps/api/src/application/agent-run/agui-bridge.ts`（137 行）。文件头（1-33 行）如实写明：**这不是新的执行路径**，只是复用既有的 `mutateThread`/`acceptHumanMessage`/`readAgentRun` 三步，**轮询**直到终态后把最终文本一次性包成 AG-UI 事件——"Why polling, not a push from the executor" 一节（26-32 行）直接点名 `agent-run.controller.ts` 的"Polling, not SSE"约束仍然成立，AG-UI 只是在这次轮询结束后**对前端**呈现为一次 SSE 推送，不是端到端 token 级流。
- 契约状态：`phases/phase-01-run-a-project/contracts/chat/agui-bridge-delta-pending.md`——ADR-023 的 contract-delta 登记，状态 🟡"待人类补签"（13-16 行），不是完整签核。

### 1.3 前端：预览面板与生产面板

- `apps/web/components/chat/copilotkit-preview-panel.tsx`（126 行）：真实用 `@ag-ui/client` 的 `HttpAgent` 驱动 `POST /copilotkit/agui`（4-5 行 import，58-61 行构造 `HttpAgent`），**不使用** `@copilotkit/react-ui` 的 `<CopilotChat>`，理由写在文件头 8-21 行——人类在 #654 的裁决第 1 条排除了经典 GraphQL runtime，而 `@copilotkit/react-core` 的 `<CopilotKit runtimeUrl>` provider 内部固定走 GraphQL，没有"直接注入一个 `AbstractAgent`"的入口，所以改走 `@ag-ui/client` 直连。
- 挂载点：`apps/web/app/chat/copilotkit-preview/page.tsx`（12 行）——独立路由 `/chat/copilotkit-preview`，文件头注明"不挂在 `/chat` 生产入口下"。**没有任何生产导航链接指向这个路由**（grep 全仓 `CopilotKitPreviewPanel`/`copilotkit-preview` 只命中它自己的定义与挂载文件、以及 `chat-dead-mock-cluster.test.ts` 里"五条 `/chat/*` 路由必须都在场"的台账测试）。
- 生产面板改动（PR #670，commit `bc6155a3`）：`apps/web/components/chat/chat-live-message-panel.tsx` 新增
  ```tsx
  import { Markdown } from "@copilotkit/react-ui";
  import "@copilotkit/react-ui/styles.css";
  ...
  {isAgent ? <Markdown content={message.text} /> : <p className="whitespace-pre-wrap">{message.text}</p>}
  ```
  commit message 原话确认这是"真实使用了 CopilotKit 的组件（不是视觉模仿）"，但明确限定为 `@copilotkit/react-ui` 里**不依赖 CopilotKit runtime context 的纯展示组件**，且"没有触碰 #654 裁决排除的那条 GraphQL runtime 路径，也没有触碰 AG-UI 桥接端点'每次开新线程'那条已知约束"。生产聊天面板其余部分（发送、轮询、终态判断）**未变**——`chat-live-message-panel.tsx` 顶部仍是"轮询,不是 SSE"的既有实现（第 28-84 行一带的注释仍在，"AgentRun 轮询的有界退避"）。
- PR #670 第一个 commit（`ce8f2bc9`）是纯视觉重做（头像气泡、圆角输入条），commit message 自陈"这一轮只动了展示层，数据流/testid/文案一个没动""styling-only，行为测试零回归"，并且明确说明**没有**切到 AG-UI 流式接入，理由是"AG-UI SSE 桥接端点设计上每次调用都开一条全新的个人线程……不能对着一个已有 threadId 追加消息……直接换掉发送机制会打断'继续这条对话'的语义，是真实的回归"。

**小结**：截至实测 SHA，全仓没有任何生产路径把聊天消息的**发送/接收**协议换成 AG-UI SSE——那条协议目前只活在一个孤立预览页里；生产 `/chat` 拿到的是 CopilotKit **组件库**（`Markdown` 展示组件 + 未来可能的其他纯展示组件）而不是 CopilotKit/AG-UI **协议**。这个区分很重要，见 §3。

---

## 2. 范围分歧的证据：`architecture.md` vs `context-engine.md` vs issue #654 人类裁决

### 2.1 两份文档说了什么（均在 2026-07-28 定稿，此后未改动过一个字）

- `.harness/instructions/architecture.md:27`（分层总表，"Agent UI / 实时"一行）：
  > CopilotKit v2 + AG-UI（SSE），**仅作 presentation protocol** | 服务端 run/event 才是权威；协作编辑另用 CRDT（Yjs） | 传输可换 WebSocket，state schema 不变

  这一行**没有**把 CopilotKit/AG-UI 限定在某个阶段——它出现在整张"参考栈"总表里，读起来像是**全局默认**的 Agent UI 层选型。同文件第 22 行把 LangGraph 明确限定为"仅限深度研究/HITL/多阶段生成"，但第 27 行的 CopilotKit/AG-UI 一行没有类似的限定语。

  > 注：任务背景摘要提到的路径 `docs/architecture/architecture.md` 实测**不存在**（`ls` 报 No such file or directory）；真实文件是 `.harness/instructions/architecture.md`。

- `docs/architecture/context-engine.md:315`（"原选型 vs 修正"对照表）：
  > CopilotKit + AG-UI | 只解决 UI 事件协议，不解决任务持久化/幂等/背压/权限 | 继续用，但**仅作 presentation protocol**；**服务端 run/event 才是权威**

  同文件 `:321-322`（紧接着的"一句话"总结）：
  > **一句话**：Apache AGE、LangGraph、CopilotKit 各自降回本位—— **图投影、执行编排、UI 协议**，它们都不是 Context Engine 本身。

  同文件 `:333`（"落地顺序"表，P4 一行）：
  > **P4 Agent 工作流** | 深度研究/工作坊总结/研究综合用 LangGraph；每个 run 保存计划、工具调用、checkpoint、Context Pack；高影响操作用动态 interrupt 审批；**AG-UI 负责实时呈现与恢复**

  P4 那一行把"AG-UI 负责实时呈现"明确写在 P4（深度研究/工作坊）阶段的描述里，而不是作为一条独立于阶段的通用 UI 层规则重复声明——这是"P4 限定"读法的直接依据。

**分歧本质**：两份文档字面上没有互相矛盾的陈述（都同意"CopilotKit/AG-UI 只是展示协议，不碰持久化权威"），但**范围隐含得不一样**——`architecture.md` 把它写进全局分层表（暗示全场景适用），`context-engine.md` 把它的"负责实时呈现"具体动作只写在 P4 这一行里（暗示只在多步工作流阶段生效）。这正是 AGENTS.md 点名的"同一事实声明在两处、口径不一致"的第六种情形。

### 2.2 issue #654：人类已经就这个分歧direct裁决过一次，但docs没有回填

`gh issue view 654`（created `2026-08-07T04:32:20Z`，仍 OPEN）body 原文（节选，翻译保留原义）：

> 人类明确、直接要求：chat 界面**现在开始**（不是"以后再评估"）必须用 **CopilotKit 的 UI 和对应后台**……**这条指令覆盖 `docs/architecture/context-engine.md` 里"CopilotKit/AG-UI 适用范围 = P4 多步 Agent 工作流阶段"的旧裁定；那份文档的范围复核还没定论，但人类此刻的直接指令优先。**……`.harness/instructions/architecture.md` 早先"Agent UI/实时 = CopilotKit v2 + AG-UI(SSE)"的要求，从今天起是硬约束，不是待办愿望。

同一 issue 下 coord-main 的裁决评论（"人类直接指令覆盖范围问题，不是我自行拍板"）第 2 条：

> **LangGraph/多步编排：裁定现在不引入，范围保持单轮 chat。**……多步编排留给已有的 P4 阶段规划……**采纳你的推荐。**

**这意味着**：截至实测 SHA，事实上已经有一次真实的人类裁决，明确把 **CopilotKit/AG-UI 的 UI 协议层**范围从"仅 P4"扩大到"chat 输入框现在就要用"，但**同时保留了** LangGraph/多步编排仍然限定在 P4——也就是说裁决把"CopilotKit UI 协议"和"LangGraph 编排"两件事分开处理了，前者扩大范围、后者维持原范围。issue #654 阶段 2 计划（body 末尾"分阶段落地计划"第 4 点）明确写了要"回填 `docs/architecture/context-engine.md` 的'P4 阶段限定'裁定为'chat 是 CopilotKit 的落地起点，不是 P4 专属'"——**但阶段 2 至今没有做**（`git log` 显示只完成到阶段 1a/1b + #670 的视觉/组件接入，见 §1），两份文档仍是 2026-07-28 的原文，没有任何一行提到 #654 或这次范围扩大。

### 2.3 我的读法（不是裁决）

证据支持："CopilotKit/AG-UI **协议层**（SSE 事件、`HttpAgent`/`@ag-ui/client`）现在适用于通用单轮 chat，不再仅限 P4"这个结论已经被人类在 #654 直接裁决过，`architecture.md` 的全局表述更接近"现状"；但"**LangGraph 多步编排**仍然限定在 P4"这条也被同一次裁决保留了——所以不是"`architecture.md` 全对、`context-engine.md` 全错"，而是 `context-engine.md` 把"UI 协议范围"和"编排引擎范围"**绑在同一行**（P4 那一行同时提到两者）掩盖了两者其实要分开处理这件事。

**推荐**：不建议由我或任何 agent 单方面改写这两份文档来强行拉平——这正是 AGENTS.md 明令"凡出现第二份副本，一律收敛为单一事实源"要走机械门控的场景，而这里涉及的是一个**真实、尚未建成的子系统的技术栈选型**，属于人类/coordinator 该拍板的范围（任务说明里也是这么要求的）。具体走哪条路，见 §5。

---

## 3. PR #670 是否需要 followup

**评估结论：不需要"撤销"，但需要一条"范围登记"补丁，且需要确认一个隐含假设。**

1. **不是纯 CSS 视觉模仿**：commit `bc6155a3` 让生产 `/chat` 面板真实 `import { Markdown } from "@copilotkit/react-ui"`，这是真实的包依赖使用，不是"看起来像 CopilotKit"的手写还原。若 §2.3 的读法成立（人类已经裁决 CopilotKit UI 协议层范围扩大到通用 chat），这个改动方向上没有问题。
2. **但它没有被登记为"#654 范围扩大"的落地**：commit message 只字未提 #654 或范围问题，`agui-bridge-delta-pending.md`（唯一登记 AG-UI 相关契约变化的地方）也没有更新提到"生产聊天面板现在依赖 `@copilotkit/react-ui`"这件事。如果将来有人按 `context-engine.md` 字面意思（P4 限定）审计代码，会发现生产 `/chat`（不是 P4 深度研究场景）已经在用 CopilotKit 组件，产生"文档说不该用、代码已经在用"的表面矛盾——这正是需要被显式记录、而不是留给下一个人重新发现的漂移。
3. **隐含假设需要确认**：`@copilotkit/react-ui` 的 `Markdown` 组件被 commit message 描述为"纯展示，不读任何 ChatContext/CopilotKit provider"，因此判定它不受 #654 裁决第 1 条（排除经典 GraphQL runtime）约束。这个判定本身没有在代码里被机械验证（没有测试断言"`Markdown` 组件不依赖 CopilotKitContext"），只是 commit message 里的一句技术判断。如果未来 `@copilotkit/react-ui` 升级版本悄悄改变了这个组件的内部依赖，这个假设可能失效而不会有任何测试变红。

**建议动作**（供任务负责人取舍，不代我执行）：在 `agui-bridge-delta-pending.md` 或新登记文件里补一条"生产 `/chat` 面板已引入 `@copilotkit/react-ui` 的 `Markdown` 组件（PR #670），范围依据 issue #654 人类裁决"，把这个事实从 commit message 挪进契约登记的仓库位置，避免下次审计时重新发现。

---

## 4. `/copilotkit/agui` 的 rewrite 缺口：仍未处理

- `apps/web/next.config.mjs` 的 `rewrites()`（8-163 行）逐条列出了 `/auth`、`/identity`、`/capabilities`、`/canvas`、`/skills`、`/admin/skills`、`/admin/agents`、`/skill-versions`、`/models`、`/model-calls`、`/recording`、`/retention-policy`、`/chat`、`/threads`、`/agent-runs`、`/agents`、`/projects`、`/artifacts`、`/artifact-versions`、`/artifact-aliases`、`/export-jobs`、`/organizations`——**没有一条 `/copilotkit` 前缀的规则**。
- 这不是我猜测出来的新发现——同一文件里反复出现相同形状的教训（#435/#458/#466/#496/#520/#548/#552/#595/#617/#652/#363 的行内注释），每次都是"少一条裸路径改写 → 请求被 Next 自己的 404 HTML 接住 → 前端 `JSON.parse` 报 `Unexpected token '<'` → 表现成'后端没实现'而不是'路由没接'"。`/copilotkit/agui` 完全符合这个模式：`CopilotkitAguiController` 是裸的 `@Controller()`（`copilotkit-agui.controller.ts:99-100`），没有任何子路径可以让 `:path*` 通配兜住裸路径本身。
- 浏览器 E2E 网关证据：`apps/web/playwright.chat-read.config.ts:69` 与 `apps/web/playwright.fullstack-smoke.config.ts:328` 都把 `NEXT_PUBLIC_API_URL` 设为 Web 自己的 origin（同源），意味着这些网关下 `apiBaseUrl()` 返回的是 Web origin，`copilotkit-preview-panel.tsx:59` 构造的 `HttpAgent` URL 会是同源路径，**必须**经过 Next 的 rewrite 才能到达真实 `apps/api`——而这条 rewrite 不存在。
- `.harness/state/rewrite-coverage-allowlist.json` 里**没有** `copilotkit` 条目——也就是说这个缺口既不是"已登记的历史豁免"，也不是"已经补上"，是一个**尚未被任何机械门控发现的空白**。（`copilotkit-agui-httpagent.test.ts` 用的是一个自建的裸 `http.createServer` stub，绕开了真实 `apps/api` + Next rewrite 这条链路，所以现有测试套件不会因为这个缺口变红。）
- **影响面判断**：只影响走同源代理模式的浏览器 E2E/部署场景；如果生产部署把 `NEXT_PUBLIC_API_URL` 直接设成真实 API 的跨源地址（当前 `copilotkit-preview-panel.tsx` 本身不强制同源），并且 CORS 配置允许，这条路径可以绕开 rewrite 直接工作。但鉴于本仓所有其他路由都走同源 rewrite 模式（`next.config.mjs` 头注"跨端口 CORS 配置扩张成产品运行时改动"暗示这不是本仓偏好的路数），`/copilotkit` 独自例外更像遗漏而非有意设计。

**这个缺口目前没有被任何 GitHub issue 追踪**（`gh issue list --search "copilotkit OR agui"` 只命中 #654 本身，其 body 里也没有提到这个 rewrite 缺口）。

---

## 5. 建议的下一步（3–5 条，不含糊）

1. **拿到人类/coord-main 对 §2.3 读法的明确确认**：是否同意"CopilotKit/AG-UI **协议层**范围已扩大到通用 chat（依据 #654），但 LangGraph **编排层**仍限定 P4"这一读法；确认后由人类或 coordinator（不是我）决定 `architecture.md`/`context-engine.md` 谁改、怎么改，或者是否需要一条新 ADR 把这次范围裁决固化下来（issue #654 本身已经是一次事实上的裁决，但从未落成 ADR，目前只活在一个 OPEN 的 issue 里）。
2. **回填 issue #654 阶段 2 计划里承诺过的文档更新**（body"分阶段落地计划"第 4 点自己写的动作项，至今未做）——这不是我在提新要求，是把 issue 自己承诺的收尾项做完。
3. **补上 `/copilotkit` 的 Next rewrite 条目**（§4），并在 `.harness/state/rewrite-coverage-allowlist.json` 或对应门控里给它一个真实覆盖，别让它继续以"未登记空白"的状态存在——这条如果不补，`/chat/copilotkit-preview` 在浏览器 E2E 网关下大概率是打不通的（未实测验证，因为没有现成测试跑这条链路；建议下一个碰这块的人先跑一次真实浏览器验证再动手）。
4. **给 PR #670 补一条契约/范围登记**（§3 建议动作），把"生产 `/chat` 已经引入 `@copilotkit/react-ui` 组件"这件事从 commit message 挪进 `agui-bridge-delta-pending.md` 或束级 `design-signoff.md` 待办区，避免下次审计重新发现同一个漂移。
5. **不要把这份文档当结论执行**——它只负责把证据摆整齐；两份现存文档的取舍、是否需要新 ADR，仍然是人类/coord-main 的决定。
