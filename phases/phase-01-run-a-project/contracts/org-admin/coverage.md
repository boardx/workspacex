# 契约束 `org-admin` — UC 覆盖证明（支撑材料）

> **这一件回答的问题**：前面三件定的接口，**真的够跑通业务吗？**
> 领域模型再漂亮、API 再整齐，如果有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
>
> 覆盖 feature：F03 F04 F05 F06 F07 F10 F11 F12 F13 F14 F15 F16（12 个，合计 **30 点**）
> ⚠ **这一行是派生视图，不是权威。** 权威是 `design-signoff.md` frontmatter 的 `covers:`
> （ADR-023 决策三）。改覆盖范围改那里，不要只改这一行。
>
> 依据 UC 与其 R12 条数：`uc-1-1`（10，本束只取 F03 相关部分）· `uc-1-2`（12）·
> `uc-1-3`（11）· `uc-1-4`（14）· `uc-1-6`（14）——**合计 61 条验收线索**。

## 怎么读这些表

**两个方向都要查，缺一个方向就是白查**：
- **UC → API**：某条验收线索找不到对应 API ⇒ **接口不够，业务跑不通**
- **API → UC**：某个 API 操作没有任何 UC 要它 ⇒ **接口是多余的，或有 UC 没写**

「前端消费点」列填**已建成界面**里的真实 `data-testid` 或路由（已在代码中核实，见 `ui.md`）；
填不出来的标 `—（API 层验收）`，**但不能空着**。
同一 UC 内带字母后缀的子条目（如 V5a/V5b/V5c）**合并进其基号那一行**。

---

## 一、`uc-1-1` R12（10 条）—— 本束只负责 F03；其余已在 phase-00 `auth` 束覆盖

⚠ 门控按 `spec_ref` 的 UC 路径要求本表覆盖 `uc-1-1` R12 **全部** 10 条，
但本束的 `covers:` 里 `uc-1-1` 只挂着 **F03（设备与会话列表）**。
其余 9 条的归属已由 2026-07-29 的 auth 最小可用切片迁移确定，见
`phases/phase-00-shared-kernel/contracts/auth/coverage.md`。**这里如实标注归属，不假装本束在做。**

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1 邮箱+密码是唯一认证路径，无可用 SSO/社交端点 | phase-00 `auth.Login`（本束不实现） | `/login` `login-form` `login-submit` `login-providers` | ✅ 已在 phase-00 auth（F20） |
| V2 | **AC2 会话 30 天有效；踢掉另一设备后该设备下次请求即被拒** | `ListDeviceSessions` / `KickDeviceSession` | ⚠ **未建** —— 全仓 grep `kick` / `deviceSession` / 「设备与会话」**零命中** | ⚠ **缺口 1** |
| V3 | AC3 忘记密码全流程后旧密码失效、既有会话全失效 | phase-00 `auth.ResetPassword` | `/login` `login-forgot-link` `login-forgot-submit` `login-forgot-sent` | ✅ 已在 phase-00 auth（F21） |
| V4 | 防枚举：邮箱不存在与密码错误返回完全相同 | phase-00 `auth.Login`（domain I-1 含耗时） | `/login` `login-form` 的 invalid 态 | ✅ 已在 phase-00 auth |
| V5 | 限速/锁定；密码策略 ≥12 位查弱口令库；phase-1 无 MFA 端点 | phase-00 `auth.Login` + 口令策略（V5a/V5b/V5c 合并） | `/login` `login-password` `login-password-toggle` | ✅ 已在 phase-00 auth |
| V6 | 会话携带组织 ID/组织角色/团队；管理员访问无项目角色的项目被拒 | phase-00 `identity.ResolveIdentity` + `Authorize` | `/admin/members` `admin-members-boundary`（本束 F06 复用同一断言） | ✅ 已在 phase-00 identity |
| V7 | 新账号无项目时「全部项目」显示真实空态 | phase-00 `identity.ListCapabilities` | `/projects` 空态 `?state=empty` | ✅ 已在 phase-00 |
| V8 | 邮件服务不可用时忘记密码明确失败并保留输入 | phase-00 `auth.ResetPassword` → 依赖失败 | `/login` `login-forgot-panel` 的 dep-failed 态 | ✅ 已在 phase-00 auth |
| V9 | 组织停用后仍能登录但全部写接口被拒且显示只读条 | phase-00 `auth.Login` + RLS 只读降级（F22） | `AppShell` 顶栏只读条（S-08：不放登录页） | ✅ 已在 phase-00 auth（F22） |
| V10 | 登录成功/失败/密码重置/会话吊销四类事件可检索 | phase-00 `AuditWriter` + 本束 `KickDeviceSession` 写同一条链 | `/admin` 活动流 `admin-overview-activity` | ⚠ **缺口 2**（查询面跨束） |

---

## 二、`uc-1-2` R12（12 条）—— F12 F13 F14

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | **AC1 走完进场流程账号表不新增任何记录**，而发言/便签/投票均可归属到名单条目 | `JoinByGroupLink`（domain I-18 行数前后相等） | `/join` `join-verify-form` `join-enter` → `/group` `group-add-sticky` `group-stickies` | ✅ |
| V2 | AC2 引导师侧「分组与签到」该人由未到变已到，本组 n/m 与全场计数刷新 | `JoinByGroupLink` → `GetCheckinBoard` | ⚠ **分组与签到屏未建**（现场协作子屏） | ⚠ **缺口 3** |
| V3 | AC3 属第 2 组的人打开第 3 组链接**不报错**，落在第 2 组并提示「你在第 2 组」 | `JoinByGroupLink` → `redirectedFromLinkGroup`（I-20） | `/join` `join-wrong-group` | ✅ |
| V4 | AC4 名单外手机号验证后不进任何组，出现 `[向引导师申请加入]`，引导师侧新增待批，批准前读不到任何内容 | `ApplyForJoin` / `ReviewJoinApplication`（I-21 返回 0 行） | `/join` `join-not-listed` `join-apply` `join-apply-status` `join-apply-approve` `join-apply-reject` | ✅ |
| V5 | AC5 设备 A 贴 2 张便签后断开，设备 B 重开落回同一组同一环节且便签仍在 | `ResumeLiveSession`（I-23 不依赖 Cookie） | `/join` `join-reconnect` `join-reconnect-verify` → `/group` `group-stickies` | ✅ |
| V6 | 五种身份调同一批接口严格符合 R5；组长比组员恰好多两个动作端点。**V6a**：无 `?t=` 被拒、`used_by` 可查、24h 过期、撤销后已在场者至环节结束 | `JoinByGroupLink` + `RenderRoleView`（I-10/I-11/I-13/I-26） | `/group` `group-lead-actions` `group-raise-hand` `group-submit-output` | ✅ |
| V7 | 隐私态：任何参与者可见的响应与页面中他人手机号均不以完整形式出现 | `GetCheckinBoard` / `JoinByGroupLink`（I-16/I-22） | `/join` `join-phone` 掩码回显；`/group` 代称 | ✅ |
| V8 | 合规态：撤回后手机号入待删除队列、≤5 分钟退出检索、报告段落标失效、≤30 天出回执 | `WithdrawParticipantPhone`（I-34，时限引用 D-13/D-15 单源） | `/consent` `consent-withdraw-flow` `consent-withdraw-confirm`；`/session` `session-withdraw-flow` | ✅ |
| V9 | 依赖失败：短信服务不可用时明确失败并保留输入，提供兜底路径，无假成功 | `RequestJoinCode` → `SMS_UNAVAILABLE` | `/join` `?state=dep-failed`（`join-get-code` 失败态） | ✅ |
| V10 | 拒绝麦克风权限仍能完成进场与全部文字操作，开关状态始终可见可切换 | `SetMicrophoneState`（I-25） | `/join` `join-mic-note`；`/group` `group-mic-toggle` `group-mic-status` | ✅ |
| V11 | 空态：本组尚无画布/便签时显示真实空态与下一步，不生成伪数据 | `JoinByGroupLink` → 空 canvas | `/group` `?state=empty` `group-canvas` `group-stickies` | ✅ |
| V12 | 审计态：进场/申请加入/批准拒绝/换设备接管/身份归档五类可检索；名单外尝试也有安全审计 | `AuditWriter`（本束五类事件） | `/admin` `admin-overview-activity` `admin-activity-export` | ⚠ **缺口 2** |

---

## 三、`uc-1-3` R12（11 条）—— F15 F16

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1 每组一条链接；用第 3 组链接进场落在第 3 组；四条链接互不串组 | `IssueInviteLink(kind="group")` + `JoinByGroupLink` | ⚠ **「参与者与邀请」管理屏未建**；进场侧可用 `/join` 验 | ⚠ **缺口 4** |
| V2 | **AC2 撤销后 5 秒内用该链接的新访问被拒**（[Backlog] 数字，原型无时限） | `RevokeInviteLink`（I-12 时序断言） | `/join` 失效态提示「找引导师重发」 | ⚠ 数值待裁（domain [待定 G]） |
| V3 | 分组与签到屏同时可见每组链接+复制+二维码、签到名单、到场状态、n/m、全场计数、`[看加入页]`；某人进场后计数 +1 | `GetCheckinBoard` | ⚠ **未建** | ⚠ **缺口 3** |
| V4 | 一次性链接被使用后立即失效，且使用记录可查到使用者与使用时间 | `JoinByGroupLink` → `InviteLink.usedBy/usedAt`（I-11） | ⚠ 呈现位置待定（domain [待定 E]）；`/join` 可验失效 | ⚠ **缺口 4** |
| V5 | 有效期三档各自生效，超期提示「找引导师重发」而非报错页。**V5b** 身份四选落库角色严格一致且协同引导师=facilitator、观察者只读面与 UC-1.4 逐项相同；**V5c** 名单批量邀请与 `[重发]` 与计数刷新；**V5d** 邀请码与主链接等效 | `IssueInviteLink` / `UpsertParticipantRoster` / `BroadcastInvites`（I-17） | ⚠ **管理屏未建**；观察者面可用 `/group` `?as=observer` 交叉验 | ⚠ **缺口 4** |
| V6 | 七种身份访问链接管理接口严格符合 R5，且**令牌明文与手机号从不出现在观察者与组员的响应体中** | `IssueInviteLink` / `GetCheckinBoard` + `Authorize`（I-16） | `/group` `?as=observer` 与 `?as=member` 的响应快照 | ✅（API 层可先行） |
| V7 | 单条撤销只作废该条（即作废其令牌），`[重置全部]` 作废全部；两种情况已在场者保留至环节结束，环节推进后下一次请求失败。**V7b** `invite_link` 含非空 token、`used_by` 写入、无令牌进不去 | `RevokeInviteLink` / `ResetAllInviteLinks`（I-10/I-13/I-14/I-15） | ⚠ **单条撤销的确认弹层原型确认缺失**；`/join` 可验失效侧 | ⚠ **缺口 4** |
| V8 | 空态：尚未分组或名单为空时显示真实空态与下一步 | `UpsertParticipantRoster` → 空数组 | ⚠ **未建**（管理屏空态） | ⚠ **缺口 4** |
| V9 | 依赖失败：短信/二维码服务失败时输入与最近成功数据保留、可解释可重试、无「看似已群发」的假成功 | `BroadcastInvites` → `PARTIAL_DELIVERY` / `SMS_UNAVAILABLE` | ⚠ **未建**；契约的 `failed[]` 是渲染依据 | ⚠ **缺口 4** |
| V10 | 并发态：两名引导师同时重置全部链接不静默覆盖，最终状态唯一且可识别 | `ResetAllInviteLinks` → `VERSION_CHANGED` | —（API 层验收） | ✅ |
| V11 | 审计态：生成/群发/撤销/重置全部/一次性链接被使用五类可检索；已撤销令牌的访问尝试也有安全审计 | `AuditWriter` | `/admin` `admin-overview-activity` | ⚠ **缺口 2** |

---

## 四、`uc-1-4` R12（14 条）—— F04 F05 F06 F07

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1 四种项目角色请求同一页面路由均返回 200 且渲染同一骨架，差异仅在可见区块与按钮集 | `RenderRoleView` | ⚠ **四视角切换器未建**；`/projects/[id]/files` 已有 `?as=` 预览轴可交叉验 | ⚠ **缺口 5** |
| V2 | AC2 越权字段（别组内容、组员私聊、原始转写）**在响应体中不存在**——非置空非前端隐藏 | `RenderRoleView`（I-27 断言键不存在） | `/group` `?as=member` 与 `?as=observer` 的响应快照 | ✅（API 层可先行） |
| V3 | AC3 观察者按钮集为空；引导师 ⊇ 组长 ⊃ 组员 ⊃ 观察者；组长恰好多 `提交本组产出` | `RenderRoleView.actionEndpoints`（I-26 差集断言） | `/group` `group-lead-actions` `group-raise-hand` `group-submit-output` | ✅ |
| V4 | AC4 临时提权「环节 3 结束失效」：环节 3 内成功→推进到 4 被拒；环节提前结束同样立即失效；授予与失效两条审计可检索 | `GrantTemporaryAccess` / `ExpireTemporaryAccess`（I-28） | ⚠ **授予入口原型未画、未建** | ⚠ **缺口 6** |
| V5 | AC5 管理员边界：个人层只有计数、项目层可读但产生审计、项目负责人能查到这条、管理员「看我的访问记录」也能看到同一条 | `RecordAdminProjectAccess` / `ListMyAccessLog` / `ListProjectAccessLog`（I-29） | `/admin/members` `admin-members-boundary` `admin-members-private-counts` `admin-members-project-access` `admin-members-my-access` `admin-members-access-logs` `admin-members-access-full` | ⚠ 第三方视图缺（缺口 7） |
| V6 | AC6 非能源组成员请求标为「仅能源组」的 agent 被拒，且**拒绝原因标明为组织层限制** | `ResolveResourceScope` → `ORG_SCOPE_DENIED` | `/admin/agent` `admin-agent-list` 的 scope 徽标（`scope-badges.tsx`） | ✅ |
| V7 | 八种身份逐一调用同一批接口，返回数据与可执行动作严格符合 R5 两张表 | `RenderRoleView` + phase-00 `Authorize` | `/group` `?as=` 四值 + `/admin/members` | ✅（API 层可先行） |
| V8 | 管理员在其无项目角色的项目中内容读取一律被拒 | `RecordAdminProjectAccess` → `ADMIN_NOT_SUPERUSER` | `/admin/members` `admin-members-boundary` | ✅ |
| V9 | 预览态：引导师切到组员视角不能写入，也读不到组员本不可见之外的内容；预览动作留痕 | `PreviewAsRole`（I-30） | `preview-switcher.tsx`（`/group` `/join` 的预览控制条，生产不可达） | ⚠ **缺口 5** |
| V10 | 空态：无项目角色的用户打开项目显示**无权限态而非空列表** | `RenderRoleView` → `NO_PROJECT_ROLE` | `?state=denied` 七态（`StateShell`） | ✅ |
| V11 | 依赖失败：鉴权服务不可用时全部请求被拒绝，无任何放行 | phase-00 `AUTH_SERVICE_UNAVAILABLE`（I-31） | `?state=dep-failed` 七态 | ✅ |
| V12 | 并发态：操作过程中角色被撤回或临时读权到期，后续写操作立即失败，已完成步骤保留审计 | `ExpireTemporaryAccess` + `RemoveOrgMember` → `STAGE_GRANT_EXPIRED` | —（API 层验收） | ✅ |
| V13 | 安全态：无权访问时的响应**不泄露资源是否存在**（存在与不存在返回相同结果） | `RenderRoleView` / `Authorize`（沿用 identity 束「拒绝不泄露存在性」） | `?state=denied` 七态文案 | ✅ |
| V14 | 审计态：角色变更/团队变更/可见性范围变更/临时提权授予与失效/管理员项目层访问六类可检索；越权尝试也有安全审计 | `AuditWriter` + `RecordAdminProjectAccess` | `/admin` `admin-overview-activity` `admin-activity-export` | ⚠ **缺口 2** |

---

## 五、`uc-1-6` R12（14 条）—— F10 F11

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | AC1 不存在任何自助加入已有组织的接口；穷举组织 ID 也加不进去 | 反向断言：本束**不提供** join-org 端点 | `/admin/members` `admin-members-list`（唯一入口是管理员邀请） | ✅ |
| V2 | AC2 以「顾问+供应链组」邀请，激活后成员表出现该行且角色与团队就位、可被鉴权中间件直接消费 | `InviteOrgMember` → `ActivateOrgMember` | ⚠ 成员表 `admin-members-list` 已建，但**角色/团队两列与 `[邀请成员]` 未建** | ⚠ **缺口 8** |
| V3 | AC3 同一激活链接用两次：第一次成功第二次被拒；`[重发]` 后旧链接立即失效 | `ActivateOrgMember`（I-1）/ `ResendOrgInvite`（I-6） | ⚠ **激活落地页原型确认缺失、未建** | ⚠ **缺口 8** |
| V4 | AC4 待接受状态：成员表出现 `顾问(待激活)·待接受邀请·已发送 N 天·[重发]`，计入名册不计入活跃成员，激活后两计数同步 | `InviteOrgMember` → 成员表投影 | ⚠ **待激活行未建**（`members-screen.tsx` 无「待激活/重发」） | ⚠ **缺口 8** |
| V5 | AC5 篡改无效：把链接里的角色改为管理员（或改组织/团队）后激活，实际授予仍是服务端记录值；篡改写安全审计 | `ActivateOrgMember`（I-2） | —（API 层验收，安全断言不依赖界面） | ✅ |
| V6 | 已有账号加入不新建账号，同时归属两个组织，两边角色团队互不影响。**V6a** 切到新组织后项目级上下文清空、权限重新求值、团队在每组织内各自唯一 | `ActivateOrgMember(mode="existing-account")` + phase-00 `identity.SwitchOrganization` | 组织切换器 `?org=org-yuanyang|org-hengtai`（`AppShell`） | ✅ |
| V7 | 项目负责人与顾问调 `[邀请成员]` 均被拒，只有管理员成功；非管理员访问「成员与配额」显示无权限态。**V7a** 双人复核；**V7b** 7 天有效期与 60 秒限速；**V7c** 配额硬阻断且响应含 `[调整]` 入口；**V7d** 成员移除保留署名与释放配额 | `InviteOrgMember` / `ReviewAdminInvite` / `ResendOrgInvite` / `RemoveOrgMember`（I-3/I-4/I-8/I-9） | `/admin/members` `?state=denied`；`admin-member-quota-save` 是 `[调整]` 的既有锚点 | ⚠ **缺口 8** |
| V8 | D-18：新激活的管理员在其无项目角色的项目中内容读取被拒；查他人个人层只返回计数 | `RecordAdminProjectAccess`（phase-00 identity I-8 保证个人层） | `/admin/members` `admin-members-private-counts` | ✅ |
| V9 | 原子性/并发：两名管理员同时邀同一邮箱只产生一条邀请与一条成员行；激活中断后不残留「令牌已核销但成员不存在」 | `InviteOrgMember`（I-5）/ `ActivateOrgMember`（I-1） | —（API 层验收） | ✅ |
| V10 | 安全态：激活链接无效/过期/已使用/已撤销四种返回**完全相同**的响应，且不含组织名或成员信息 | `ActivateOrgMember` → `INVITE_NOT_FOUND` 统一码 | ⚠ **激活落地页未建**；防枚举断言在 API 层 | ⚠ **缺口 8** |
| V11 | 空态：新组织成员表只有创建者一人，显示真实空态与「邀请成员」下一步，不生成示例成员 | `InviteOrgMember` 前的列表查询 | `/admin/members` `?state=empty` `admin-members-list` | ✅ |
| V12 | 依赖失败：邮件服务不可用时邀请记录标「发送失败」并可重试，**不产生可激活的链接假象** | `InviteOrgMember` → `MAIL_UNAVAILABLE` | `/admin/members` `?state=dep-failed` | ✅ |
| V13 | 撤销态：撤销未接受的邀请后链接立即失效、成员表移除该行、事件可审计 | `RevokeOrgInvite` | ⚠ **撤销入口原型确认缺失**（待激活行只有 `[重发]`） | ⚠ **缺口 8** |
| V14 | 审计态：邀请/重发/撤销/激活/角色变更/团队变更六类可检索；篡改链接与非管理员调用邀请接口也有安全审计 | `AuditWriter` | `/admin` `admin-overview-activity` | ⚠ **缺口 2** |

---

## 六、缺口清单（这一件的真正价值所在）

> 这 9 条是**这一轮设计的产出，不是失败**。契约束的意义就是把它们在写代码之前找出来。

| # | 缺口 | 性质 | 补法 |
|---|---|---|---|
| **1** | **设备与会话列表整块能力不存在**（V2/uc-1-1）。全仓 grep `kick` / `deviceSession` / 「设备与会话」零命中；原型也是「**原型确认缺失**」（登录页与后台各屏已逐字段抽取，无任何设备/会话入口）。30 天/设备指纹/踢下线**全部出自 [Backlog]** | 界面缺口 + 依据等级不足 | F03 只有 1 点，但它是本束唯一「连需求依据都还没确认」的一件。uc-1-1 R8 原文：**在补画并裁决前不得当作已确认需求实现**。⇒ 建议签核时**明确它是否留在本束**，或与 phase-00 auth 束合并 |
| **2** | **审计查询面跨束且已经有三份写入方**。本束 `AuditWriter` 写进场/邀请/撤销/临时提权/管理员访问；phase-00 `artifact.queryProvenance` 与 `identity.mutateCapability` 都写 `provenance_events` | 跨束 | 提**阶段一致性复核**：统一**一个** provenance 查询面。⚠ 这与 phase-00 artifact 束缺口①、identity 束缺口①是**同一件事**——已经是第三个束提出它了 |
| **3** | **「现场协作 → 分组与签到」屏未建**（V2/uc-1-2、V3/uc-1-3）。到场回写的验收锚点全在这块 | 界面缺口 | 随 06-现场协作交付。⚠ 但它与「项目设置 → 参与者与邀请」**共用同一份数据**（uc-1-3 R8），**不得实现成两套链接** |
| **4** | **「项目设置 → 参与者与邀请」管理屏整屏未建**（uc-1-3 的 V1/V4/V5/V7/V8/V9 六条）。代码中无 `invite` / `participant` / `roster` 相关 testid | 界面缺口 | F15/F16 的 notes 已标 `needs_ui_signoff`。契约与令牌语义可先行 API 断言；⚠ 但「单条撤销的确认弹层」与「一次性链接使用者记录」两处是**原型确认缺失**，须补画 |
| **5** | **四视角切换器与预览态未建**（V1/V9 of uc-1-4）。`/projects/[id]/files` 有 `?as=` 预览轴，但那是文件浏览器自己的，不是项目工作台顶部的四视角切换器 | 界面缺口 | F04 的核心断言（按钮集差集 + 越权字段缺席）**是纯 API 断言，可先行**。切换器本体随项目工作台交付 |
| **6** | **临时提权的授予入口未画未建**，且**失效锚点在另一个模块**：I-28 依赖 06-现场协作的议程环节状态机（含提前结束/跳过/合并三种终止） | 跨模块 + 界面缺口 | 提一致性复核：确认 `StageEventSource` 的**事件形状与三种终止方式**由谁定义。⚠ 本束两条不变量（I-13 撤销后会话保留、I-28 临时读权失效）的锚点**都在那里**——它没定，这两条就写不成断言 |
| **7** | **项目负责人侧「谁读过我的项目」视图未画未建**。D-18 第 ② 条明写「对项目负责人可见」，但只有管理员本人那一侧（`admin-members-my-access`）建成了 | 界面缺口 | I-29 要求**三方查到同一条**：管理员本人 ✅、审计流 ✅、**项目负责人 ❌**。缺这一侧，「留痕对项目负责人可见」就只是一句文档 |
| **8** | **`/admin/members` 只建成了 D-18 边界说明区，UC-1.6 的主体全未建**：`[邀请成员]` 弹层（原型待补，入口在、行为未接线）、激活落地页（原型确认缺失）、待激活行与 `[重发]`、撤销邀请（原型确认缺失）、角色与团队两列、团队维护入口、成员移除 | 界面缺口 | F10 的 notes 判 `needs_ui_signoff=false`（核心是接后端，UI 断言只锚已建成的成员表）——**签核时请确认这个判断**，因为 uc-1-6 的 14 条 R12 里有 6 条落在未建界面上 |
| **9** | **两个 `[待确认]` 数值缺失会让断言写不出来**：验证码有效期/频率阈值（domain [待定 B]）、观察者「脱敏聚合」最小样本量（[待定 C]） | 需人类/合规 | 参照 phase-00 artifact 缺口⑦的处理：**先做结构性断言**（「命中即限速、不得静默放行」「聚合低于阈值即标不可推断」），具体数值后填，不阻塞开工 |

---

## 七、反向检查：有没有多余的 API

| API 操作 | 被哪条验收要求 | 结论 |
|---|---|---|
| `InviteOrgMember` | uc-1-6 V2 V7 V9 V11 V12 | ✅ |
| `ReviewAdminInvite` | uc-1-6 V7a（O-28 ⑥） | ✅ |
| `ResendOrgInvite` | uc-1-6 V3 V4 V7b | ✅ |
| `RevokeOrgInvite` | uc-1-6 V13 | ✅ |
| `ActivateOrgMember` | uc-1-6 V2 V3 V5 V6 V9 V10 | ✅ |
| `MutateTeam` | uc-1-6 V14（团队变更）+ O-29 ④ 占用校验 | ✅ |
| `RemoveOrgMember` | uc-1-6 V7d（O-29 ②） | ✅ |
| `UpsertParticipantRoster` | uc-1-3 V5c | ✅ |
| `IssueInviteLink` | uc-1-3 V1 V5 V5b V5d V7b | ✅ |
| `BroadcastInvites` | uc-1-3 V5c V9 | ✅ |
| `RevokeInviteLink` / `ResetAllInviteLinks` | uc-1-3 V2 V7 V10 | ✅ |
| `GetCheckinBoard` | uc-1-2 V2 · uc-1-3 V3 V6 | ✅ |
| `RequestJoinCode` | uc-1-2 V9 | ✅ |
| `JoinByGroupLink` | uc-1-2 V1 V3 V6 V6a V7 | ✅ |
| `ApplyForJoin` / `ReviewJoinApplication` | uc-1-2 V4 | ✅ |
| `ResumeLiveSession` | uc-1-2 V5 | ✅ |
| `SetMicrophoneState` | uc-1-2 V10 | ✅ |
| `ArchiveGuestIdentities` | uc-1-2 R7「项目结束自动归档」+ V12 | ✅ |
| `WithdrawParticipantPhone` | uc-1-2 V8 | ✅ |
| `RenderRoleView` | uc-1-4 V1 V2 V3 V7 V10 V13 | ✅ |
| `PreviewAsRole` | uc-1-4 V9 | ✅ |
| `GrantTemporaryAccess` / `ExpireTemporaryAccess` | uc-1-4 V4 V12 | ✅ |
| `RecordAdminProjectAccess` / `ListMyAccessLog` / `ListProjectAccessLog` | uc-1-4 V5 V8 · uc-1-6 V8 | ✅ |
| `ResolveResourceScope` | uc-1-4 V6 | ✅ |
| `ListDeviceSessions` / `KickDeviceSession` | uc-1-1 V2 | ⚠ 依据等级仅 [Backlog]，见缺口 1 |

**25 个操作全部有 UC 要求，无孤儿接口。**
⚠ 唯一存疑的是最后一行——**不是接口多余，而是需求依据不足**，两者性质不同，不要混。

---

## 八、签核时请重点看这三处

1. **缺口 6 是本束最重的外部依赖**：I-13（撤销后会话保留至环节结束）与 I-28（临时读权按环节失效）
   **两条不变量的锚点都在 06-现场协作的议程环节状态机里**。O-06 之所以选「环节结束」而不是分钟数，
   正是因为它「有明确锚点、可写 verification」——但那个锚点**目前不在本束、也还不存在**。
   请确认它的归属与事件形状，否则这两条会退化成「文档里写着、断言写不出来」。

2. **缺口 2 已经是第三个束提出同一件事**：artifact 束、identity 束、本束都各自要写 `provenance_events`
   并各自要查它。若三个束各造一个查询面，就是本仓那条老毛病的第 N 次复现。
   ⇒ 这不该在任何单束解决，应在**阶段一致性复核**统一。

3. **缺口 1 的性质与其它八条不同**：其它都是「界面还没画」，它是「**需求依据本身还没确认**」。
   30 天、设备指纹、踢下线三项全部出自 Backlog，原型零命中，uc-1-1 R8 明写
   「在补画并裁决前不得当作已确认需求实现」。请裁决 F03 是留在本束、并入 phase-00 auth，
   还是先撤出 phase-01 的开工范围。
