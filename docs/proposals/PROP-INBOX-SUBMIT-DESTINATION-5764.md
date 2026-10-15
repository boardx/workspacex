# #5764：反馈提交后去向的待确认方案

状态：提案，等待人类选择；本文件不是签核，不修改已签核的默认行为。

## 已核实的冲突和权限边界

- [feedback-loop 签核](../../phases/phase-03-reuse-and-governance/contracts/feedback-loop/design-signoff.md) 为 confirmed，2026-09-05；其 [UC-F1 第6步](../../phases/phase-03-reuse-and-governance/contracts/feedback-loop/usecases.md) 规定提交成功后弹层切到「我提过的」，新反馈置顶。
- [UC-17.8 R4.1](../../phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-研发闭环-反馈到设计到排期.md) 另要求直接提交后进入收件箱并自动展开刚提交的详情。`apps/web/e2e/inbox-smoke.spec.ts` 第一项仍保留此断言，但标为 fixme。
- [backlog D8](../../phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md) 已记载人类于2026-09-05选方案③：同组织成员均可读取收件箱，正文仍受 D3 逐行保护；不改变分诊权限。D8 又明确说，上述「自动跳转 vs 我提过的」冲突没有随之裁决。
- 当前权限单源 [inbox.ts](../../packages/contracts/src/inbox.ts) 第62行起与 `apps/api/src/application/inbox/list-inbox.ts` 一致：组织内成员可读；系统异常仍只向平台超管投影。`apps/api/src/domain/feedback/product-feedback.ts` 的 `canTriage` 仍只允许组织管理员分诊。**不能把“非管理员必然无权打开收件箱”当成当前事实。**

## 当前真实入口和实现

- `FeedbackProvider` 挂一个 `FeedbackDialog`；`FeedbackOpenRequest` 目前只有 target、targetLabel。
- 导航栏/窄屏顶栏、首页、chat 的 agent/skill 按钮复用该入口；默认不能因新增后台流程而意外带离正在进行的聊天。
- `feedback-dialog.tsx` 的 send 成功后使用服务端 feedbackId，重置表单并 setTab("mine")；当前没有提交后的导航回调。
- `/platform-admin/[module]` 通过 AppShell 加载 inbox 屏；路由名含 admin 不等于独立的管理员读权限。实际读取仍由现有会话与 API 判定，不能另造一份角色门控替代它。
- `DesignLoopInboxAdminScreen` 已读取 `?open=<feedbackId>` 展开 drawer，故无需新 URL 协议或后台 API。
- 草稿列表已有提交成功后 push 到 `/platform-admin/inbox?open=<id>` 的独立路径，不属于本次默认直接提交去向的修改范围。

## A：由专门的分诊入口显式选择去向（推荐）

**UI**：在收件箱提供管理员可见、名称明确的「新建反馈并分诊」入口。它仍打开同一个反馈弹层；成功后关闭弹层并进入现有 `?open=<服务端feedbackId>` drawer。导航栏、首页、chat agent/skill 等现有入口，所有角色均保持提交后「我提过的」。

**前端接口**：给 `FeedbackOpenRequest` 增加可选的提交后意图，例如 `afterSubmit: "inbox"`；缺省为当前 mine。Provider 将选定意图传给 Dialog，只有收到真实201和 feedbackId 后执行一次导航。导航目标只由固定的应用路由和 encodeURIComponent(feedbackId) 组成，不接受任意外部 URL。该意图不得进入提交 API 请求体。

**用例影响**：UC-F1 原默认不变；为 R4.1 增补明确范围「从分诊工作流发起的直接提交」。管理员在 chat 里提 agent/skill 反馈也留在原聊天。不是把原失败断言改成现状：原 inbox 第一项的触发点改为新分诊入口，仍严格验收201、实际反馈ID、自动导航和指定 drawer。

**API/数据/权限**：无 API schema、数据库、反馈状态机或权限变更。入口可见性复用当前身份/分诊能力投影；后端仍独立授权所有读写。普通成员原本的收件箱读权限不能因入口不可见被收回。

**取舍**：增加一个明确入口和少量前端参数，避免管理员的身份本身改变其所有入口的行为。

## B：所有现有入口按角色分流

**UI**：不增加入口。当前组织管理员从导航栏、首页或 chat 的任一入口直接提交，均进入收件箱 drawer；其他成员仍切到「我提过的」。

**前端接口**：Provider 根据现有服务端身份中的组织角色/分诊能力选择提交后去向；身份尚未就绪时不得预判管理员或借此扩大权限。

**用例影响**：原 inbox 第一项仍从管理员的 rail-feedback 触发，保持自动导航及 drawer 断言。但需要明确修改 UC-F1 的管理员例外；管理员在 chat 中提交 agent/skill 反馈也会离开聊天，必须由人类接受此行为。普通成员的同组织读权限仍与 D8 一致，不能把留在 mine 解释为无权读收件箱。

**API/数据/权限**：同 A，无 API、数据库或后端权限变更。角色只决定客户端去向，不能替代后端鉴权。

**取舍**：不新增入口，代码较少；按身份产生隐式导航，影响所有管理员的既有反馈场景和既有签核范围。

## 两种方案都必须保留的验收

1. 原 inbox 第一项不能删除或仅改为断言 mine：选择 A 后从明确分诊入口触发，选择 B 后仍从管理员导航栏触发；均捕获唯一真实201，按返回 feedbackId 验证 URL 与 drawer 内容一致，并刷新确认反馈持久化。
2. 普通成员 product、agent、skill 反馈：成功后留在当前页面的「我提过的」，新记录置顶；不得强制导航。A 还需证明管理员的这三个默认入口同样不导航。
3. 跨组织/无会话读反馈与收件箱继续被拒；同组织普通成员读取别人反馈的标题可见、正文为空投影的 D3 反证继续有效；分诊写权限不变。
4. 提交失败保持原输入和原失败提示，不导航、不伪造成功；一次提交只产生一条反馈，导航本身不得再次 POST。
5. 提交已成功但目标导航或读取失败时保留服务端ID，提示「已保存，无法打开收件箱」，提供明确回看路径，不误报未保存或重发反馈。
6. 原 feedback-loop、feedback-drafts、chat agent/skill 调用、inbox ②③回归全部保留；只在产品实现与相应验收实际通过后解除第一项 fixme。

## 需要人类确认的最小选择

建议选择 **A：仅“新建反馈并分诊”入口提交后自动打开收件箱；其余现有反馈入口继续“我提过的”**。

确认后再落 UI/用例的范围补充和对应契约束签核材料；API 部分标明无变更。本提案不代改 design-signoff 的 confirmed/status 字段，也不把现有 fixme 当成通过。尚未执行测试、浏览器验收或产品实现。
