---
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-05T09:30:00Z"
bundle: design-workbench
scope: pm-design-workbench
covers: [B4.1, B4.2, B4.3, B4.4, B4.5, B4.6]
---

# PM 设计工作台 —— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`
§B4 · `packages/contracts/src/design-workbench.ts`。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 本文件是补签，不是先签后做——如实写在这里

`design-workbench` 这个契约束此前**没有** `contracts/design-workbench/` 目录：B4.1–B4.5
（契约、迁移、API、「深化」真栈、web 切真栈）已经全部实现并合入 `main`（PR #2677 / #2705 /
#2707），本文件是 backlog B4.6 要求的产物才第一次建出来。ADR-023 的顺序（先签后做）在这
一束上被打破了——同 `feedback-loop` 束 `design-signoff.md` 记录过的那种情形（人类先直接
要求把功能做出来，agent 事后补齐第 ① 件材料 + 这份签核文件）。

**后果**：代码已经在 `main` 上跑，但按 ADR-023，`design-workbench` 束下的 feature 在
`status` 被人类改成 `confirmed` 之前，不应该被标 `passing`（若 `phases/phase-03-reuse-and-
governance` 的 `feature_list.json` 里有对应条目引用本束，需要人类过一遍下面三件再签）。

---

## ① UI

**已补齐**（UC-17.8 B4.6）：`ui.md` 引用 16 张截图，目录 `ui-preview/design-workbench/`
实存 16 张，`lint-ui-material` 双向对账已绿。

来源与生成方式见 [ui.md](./ui.md)——渲染真组件，`page.route()` 拦截固定夹具，不连真库。

⚠ **B4.6 补的不只是截图，还有一条此前不存在的能力**：B4.5 把 `workbench-screen.tsx`/
`detail-screen.tsx` 从本地 mock 切到真实 `/pm-designs*` 之后，取材页
`/preview/feedback-design-loop` 在没有真实后端的环境下**再也拍不出这两屏的图**（真实
请求会挂起或失败）——`apps/web/scripts/shot-feedback-design-loop.mjs` 新增的
`routeDesignWorkbench()` 补上了这条 `page.route()` 拦截，同 `feedback-loop`/`inbox-unified`
两束在各自真栈化时走过的同一条路（草稿 B1、收件箱 B3.4）。这不是本束设计范围的新决策，
只是把材料产出流程补齐到和其他真栈化束一致的水位。

⚠ **新增的七个态**：B4.5 切真栈之前，工作台首页/详情页的读取来自本地 mock，不会失败也
不会挂起；切真栈之后这两屏各自长出真实的加载中/无权限/依赖失败（工作台首页）与加载中/
依赖失败/找不到项目（详情页）分支，外加工作台首页「生成中过渡」从固定 1.1s 假等待改成
等待 `createProject` 真实返回。这七个态都已经在代码里（`workbench-screen.tsx`/
`detail-screen.tsx` 的状态分支），`ui.md` 的屏 C/D/G 逐张引用，详见该文件。

## ② 用例

B4 这一束目前**没有独立的 `usecases.md`**——R4.4（`uc-17-8-研发闭环-反馈到设计到排期.md`）
是原始需求来源，`packages/contracts/src/design-workbench.ts` 文件头的两处【待确认点】
（可见性口径、首次引导语是否落库）以及「推送幂等选的是 upsert」一节，实际上承担了本该在
`usecases.md` 里写的产品取舍记录——它们是**契约文件里的用例决策**，不是契约本身。是否要
把它们抽成独立的 `usecases.md`，还是维持现状（决策记在契约文件的头注里），留给签核时的
人类判断；本文件不代为决定。

## ③ API 契约

见 `packages/contracts/src/design-workbench.ts`（六条操作：`createProject` /
`listMyProjects` / `updateProject` / `appendProjectChat` / `deleteProject` /
`pushToInbox`，另有 `deepenFeedback` 挂在同一契约文件但按「谁在用」放在
`lib/live-feedback.ts`，见该契约文件头注「与 `deepenFeedback` 的关系」）。

---

## 签核前请人类确认的两件（契约文件头两处【待确认点】的落地判断，不是技术判断）

1. **设计项目可见性口径**：契约选了「组织内全员可读，仅 owner 可改/删/推送」，而不是照搬
   `feedback-loop` 的 D3 保守口径（提交人 + 超管可见）。理由见契约文件头【待确认点 1】。
   —— 若认为设计项目也需要按人收窄可读范围，这条要重新裁。
2. **首次引导语不落库**：`DESIGN_WORKBENCH_CHAT_INTRO` 是展示层文案，`chat` 为空时前端
   本地渲染，不经过 `appendProjectChat` 写入。理由见契约文件头【待确认点 2】。
   —— 若认为引导语也应该是 `chat` 的第一条记录，这条要重新裁。

这两条此前随代码一起落地，没有经过独立的签核轮——本文件把它们摆到台面上，不是新提案。
