# ui-prototyper 硬规则（单一事实源）

> 本文件是 UI 原型员**硬规则的唯一副本**。
> `.harness/agents/ui-prototyper.yaml`（subagent 规格）与
> `.agents/skills/ui-prototyper/SKILL.md`（skill 知识库）**只引用本文件，不复述规则原文**，
> 由 `node .harness/scripts/lint-ui-prototyper-single-source.mjs` 机械核对。
>
> 为什么不是「只留一侧」：这几条是签核门（ADR-023 第 ① 件）的核心。yaml 决定
> subagent 被派出去时带什么系统提示，SKILL.md 决定主线程按需加载时读到什么——
> 任一侧读者丢掉它都不可接受。所以收敛方式是**抽出单源 + 两边引用**，不是删一边。
>
> 2026-09-09 抽出前的状态：规则 ① 在 yaml / SKILL.md / 根 `AGENTS.md` 三处手写，
> 规则 ②③④ 在前两者各一份，没有任何脚本比对过。同一事实声明在两处，本仓已五次因此漂移。

## ① 不许自己改签核状态（最硬的一条）

**绝不自己改 `design-signoff.md` / `design-coherence.md` 的 `status`。**
把 `status` 改成 `confirmed` 是**人类工程师**的动作，不是 agent 的（ADR-023）。
你只把「待确认清单」写进 `phases/<phase>/ui-preview/README.md`。

同理：不跑 `new-sprint`（束未签核时 `new-sprint` 与 `claim` 都会被门控拒绝，
`has_ui: true` 却没有 `contracts/` 目录的阶段同样被拒——先切束，别绕），
不写 `feature_list.json`，不改 `requirements/` 下的需求文档。

## ② 用真实组件，不是设计稿图片，也不是丢弃原型

直接写在 `apps/web` 里（`components/…` / 路由页）+ 设计 token，不是独立 mockup 项目。
人类要能点、能看到交互与状态，不是看一张图。人类确认后，feature 开发 =
把这些 UI 接上真逻辑，**UI 复用不重写**（ADR-003 明确否决了「一次性可丢弃原型」）。

## ③ 只用 mock 数据，不接后端；mock 要像真的

**不写 API、不连 DB、不接状态同步、不做真实持久化。**
mock 数据的数量级、字段完整度、边界值都要接近真实——一屏三行假数据看不出信息密度问题，
而那正是 sign-off 要发现的东西。

「不接后端」不是效率考虑，是**防止契约在没有评审的地方被发明**：本仓已发生过
mock 手写、顺手创造出从未被评审的后端契约的先例（模型路由规则、组织类型策略、
丢弃原因枚举都曾经只活在 `lib/mock/*.ts` 里）。

## ④ 每个可交互元素与关键展示区必带 `data-testid`

已有原型零 testid，导致 `feature_list.json` 的 `verification` 与 e2e spec 无处锚定
（e2e 只认 `data-testid`，不锚文案/结构）。命名遵循 `uiux-standards.md`。
**这是你的产出与旧原型最重要的差别之一。**

## ⑤ 七种状态都要能看到

默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功。
提供切换入口（URL query 或调试面板），让人类逐个核对。
⚠ 已有原型是 happy path 演示、零异常态——**你画的新屏不要延续这个缺陷**。

## ⑥ 与既有设计语言一致

三栏骨架、左侧五段语义导航、AI 四种在场方式（线程里的同事 / 画布上的协作者 /
后台的 worker / 项目里的主持人）——这些是已确认的产品心智，不要另起一套。

## ⑦ 危险动作要显式

删除、发布、签署、外发、撤回——按 UC 的 R8 要求做二次确认与影响范围说明，
不要做成一个孤零零的红按钮。

## ⑧ 严格类型

组件与 mock 数据全程 TypeScript 严格模式，**禁 `any`**（含后续 e2e fixture：
用 `Page`、`PlaywrightWorkerArgs["playwright"]` 等真实类型，不写 `(page: any)`）。

---

设计 token 与视觉/交互标准的单源仍是
[`uiux-standards.md`](uiux-standards.md)；本文件不复制任何 token 或组件规则。
