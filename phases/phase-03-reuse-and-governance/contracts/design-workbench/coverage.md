# 契约束 `design-workbench` — 支撑材料②：UC 覆盖证明

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 只要有一条验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：**B4.1 B4.2 B4.3 B4.4 B4.5 B4.6**
> ⚠ **这一行是派生视图，不是权威。** 束↔feature 映射的权威是 `design-signoff.md`
> frontmatter 的 `covers:`（ADR-023 决策三）。
>
> 验收线索来源：`design-signoff.md` §② 指出**本束没有独立的 `usecases.md`**——
> R4.4（`uc-17-8-研发闭环-反馈到设计到排期.md`）与 `go-live-backlog.md` §B4 是原始需求，
> 下表的 V1–V9 是从这两处 + `packages/contracts/src/design-workbench.ts` 头注三处决策
> 反推出的验收线索编号，供本表引用，不是另一份权威。

## 怎么读这些表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid`（已在仓库中核实）。

已建成并可引用的两处：
`app/platform-admin/design-workbench/page.tsx`（`components/design-loop/workbench-screen.tsx`）·
`app/platform-admin/design-workbench/[projectId]/page.tsx`
（`components/design-loop/detail-screen.tsx`）。

---

## 一、UC → API

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 首页三张模板入口起一个新设计，`criteria`/`frames`/`chat` 由服务端按固定文案填入，不接受前端传 | `createProject`（`in` 无这三个字段，`.strict()`） | `workbench-template-{mobile\|ui\|wireframe}` → `project-dialog` → `project-dialog-submit` | ✅ |
| V2 | 名称必填（1–200 字），空值不可提交 | `createProject.in.name` / `updateProject.in.name`（`NAME_REQUIRED`） | `err-name`（`workbench-new-invalid-light.png`） | ✅ |
| V3 | 「我的设计项目」按名称过滤，服务端参数不是本地过滤 | `listMyProjects({ q })` | `workbench-search` | ✅ |
| V4 | 生成中过渡等到 `createProject` 真实返回，失败退回弹窗提示，不静默吞掉 | `createProject`（reject 分支） | `workbench-generating` / `workbench-action-error`（`workbench-generating-light.png`，脚本让响应延迟 2s 真实截取） | ✅ |
| V5 | 编辑只改名称/模板/背景，不改 `criteria`/`frames`/`chat`；仅 owner 可改 | `updateProject`（`NOT_PROJECT_OWNER`） | `project-edit-{id}` → `project-dialog` | ✅ |
| V6 | 删除硬删，仅 owner；已推送项目也可删 | `deleteProject`（`NOT_PROJECT_OWNER`） | `project-delete-{id}` | ✅ |
| V7 | 详情页对话面板发送一条消息，服务端原子写「用户消息 + 固定回执」两条，整体覆盖本地 `chat` | `appendProjectChat` | `design-detail-input` / `design-detail-send` | ✅ |
| V8 | 推送到收件箱幂等（upsert，`projectId` 是幂等键），重复推送更新同一条收件箱条目、`inboxCode` 不变 | `pushToInbox`（upsert，见契约文件头「推送幂等」） | `design-detail-push` → `design-push-confirm-submit` → `design-push-success` | ✅ |
| V9 | 没有单条 `getProject` 操作；详情页用 `listMyProjects()` 后按 `id` 客户端查找，查不到时是「找不到项目」态，不是网络失败态 | `listMyProjects`（详情页复用） | `design-detail-missing`（`detail-missing-dark.png`） | ✅ |

---

## 二、API → UC（反向：有没有多余的接口）

| API 操作 | 被哪条 V 要求 | 结论 |
|---|---|---|
| `createProject` | V1 V2 V4 | 必需 |
| `listMyProjects` | V3 V9；工作台首页加载态本身（`workbench-loading-light.png`） | 必需 |
| `updateProject` | V2 V5 | 必需 |
| `appendProjectChat` | V7 | 必需 |
| `deleteProject` | V6 | 必需 |
| `pushToInbox` | V8 | 必需 |

**没有多余的操作。** 六条操作各自被至少一条验收线索要求。

⚠ `deepenFeedback` 挂在同一契约文件（`design-workbench.ts`）但调用方是收件箱屏
（`inbox-screen.tsx`），不是本束两屏（工作台首页 / 详情页）——按「谁在用它」放在
`lib/live-feedback.ts`，不在这张表里重复登记，见契约文件头「与 `deepenFeedback` 的关系」。

---

## 三、四个真实错误/等待态的落点（B4.5 切真栈后才有，B4.6 补齐材料）

这四态不是新增的 API 操作，是既有操作在**真实网络条件下**的结果分支——放在这里而不是
上面的表，是因为它们不是「某条业务能不能跑通」，是「跑不通时界面怎么说」：

| 态 | 触发条件 | 落点 | 状态 |
|---|---|---|---|
| 工作台首页 `loading` | `listMyProjects()` 请求中 | `workbench-loading-light.png` | ✅ |
| 工作台首页 `denied` | 非 PM/运营访问（权限判断不在本束内，见 R5） | `workbench-denied-light.png` | ✅ |
| 工作台首页 `dep-failed` | `listMyProjects()` reject | `workbench-retry` → 重试即再调 `listMyProjects()` | ✅ |
| 详情页 `loading`/`dep-failed`/`missing` | `listMyProjects()` 请求中 / reject / 返回但 id 查不到 | `design-detail-retry` / `design-detail-missing` | ✅ |
