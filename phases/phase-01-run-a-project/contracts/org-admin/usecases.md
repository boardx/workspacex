# 契约束 `org-admin` — ② 用例接口（application 层端口）

> 洋葱中层。**只依赖 `domain`**，不知道 HTTP、不知道 PostgreSQL。
> `infrastructure` 实现这里定义的端口（依赖倒置）；`interface` 调用这里的用例。
> 这是签核第 **②** 件。人类看这一件时重点看：**失败模式穷举了吗**——界面的异常态全靠它。

⚠ **已有原型是 happy path 演示、零异常态，别继承这个缺陷。**
本文件每个用例的 `err` 都必须覆盖七类：**并发 / 越权 / 依赖失败 / 幂等重放 / 部分成功 / 超时 / 撤回中**。
不适用的类别显式写「N/A + 一句话理由」，**不许沉默略过**。

---

## 零、失败码归属

⚠ **权限类失败一律复用 phase-00 `identity` 束的 `PermissionReason`**
（`NO_ORG_MEMBERSHIP` / `ORG_SCOPE_DENIED` / `NO_PROJECT_ROLE` / `PROJECT_ROLE_INSUFFICIENT` /
`ADMIN_NOT_SUPERUSER` / `PERSONAL_LAYER_CLOSED` / `LOCAL_ORG_ISOLATED` / `AUTH_SERVICE_UNAVAILABLE`）。
本束**不另立一套权限错误语义**——同一种失败在两个束里是两个码，就是第 N 次「同一事实两处声明」。

本束新增的是**业务类**失败码，全部在本文件定义：

| 码 | 含义 | 注意 |
|---|---|---|
| `INVITE_NOT_FOUND` | 邀请令牌无效 / 过期 / 已使用 / 已撤销 | ⚠ **四种情况必须返回完全相同的响应**（防枚举，V10），响应体不含组织名与任何成员信息 |
| `INVITE_ALREADY_MEMBER` | 该邮箱已是本组织成员 | 引导到「直接登录」 |
| `INVITE_DUPLICATE` | 已存在未失效的同邮箱邀请 | 并发第二路收到它 |
| `INVITE_AWAITING_REVIEW` | 管理员邀请待另一名管理员批准 | 此时链接尚未签发 |
| `INVITE_SELF_REVIEW_FORBIDDEN` | 发起人不可自批 | |
| `QUOTA_EXHAUSTED` | 组织未分配额度为零 | 响应**必须**含直达 `[调整]` 的入口标识——阻断要伴随可执行的下一步 |
| `TEAM_IN_USE` | 团队仍被成员或资源引用 | 响应**必须**列出占用项；不做级联删除 |
| `LINK_TOKEN_REQUIRED` | 请求未携带 `?t=` | O-06：令牌是必需的不是装饰 |
| `LINK_REVOKED` / `LINK_EXPIRED` / `LINK_ALREADY_USED` | 链接三种失效 | ⚠ 对**参与者**统一渲染为「找引导师重发」，不泄露项目/组是否存在 |
| `PHONE_NOT_ON_ROSTER` | 手机号不在本场名单 | **不是错误页**，是「门口页」+ `[向引导师申请加入]` |
| `JOIN_PENDING_APPROVAL` | 申请加入待批中 | 待批期间读任何本组资源返回 0 行 |
| `SMS_UNAVAILABLE` | 短信服务不可用 | **不得静默成功**；须给「让引导师直接把我加进来」兜底路径 |
| `MAIL_UNAVAILABLE` | 邮件服务不可用 | 邀请记录标 `send-failed` 并可重试 |
| `RATE_LIMITED` | 验证码/重发触发限速 | 重发统一 60 秒冷却 / 每日 5 次（O-28 ④） |
| `STAGE_GRANT_EXPIRED` | 临时读权已随环节失效 | |
| `VERSION_CHANGED` | 乐观并发：目标已被他人修改 | 不静默覆盖 |
| `PARTIAL_DELIVERY` | 群发部分失败 | ⚠ **不是错误，是一等返回形态**——见 `BroadcastInvites` |
| `WITHDRAWAL_IN_PROGRESS` | 目标处于撤回/待删除队列中 | 撤回中的对象不得被新引用 |

---

## 一、组织成员邀请与激活（UC-1.6 → F10 F11）

### `InviteOrgMember`

```
UC: 管理员邀请一个人进组织
  in:  { orgId, actorId, email, orgRole: OrgRole, teamId: TeamId }
  out: { inviteId, status: "pending" | "awaiting-review", quotaReserved }
  pre: · actor 的 orgRole = "admin"（[原型] 只有管理员进后台）
       · 组织未分配额度 > 0（O-29 ⑤ 硬阻断）
       · 该 email 不是本组织现有成员
  err: PROJECT_ROLE_INSUFFICIENT   越权：项目负责人/顾问调用一律拒（V7）
     | INVITE_ALREADY_MEMBER
     | INVITE_DUPLICATE            并发：两名管理员同时邀同一邮箱，恰好一条成功（I-5）
     | QUOTA_EXHAUSTED             依赖失败面之外的业务阻断，响应带 [调整] 入口
     | MAIL_UNAVAILABLE            依赖失败：记录标 send-failed，不产生可激活链接假象（V12）
     | AUTH_SERVICE_UNAVAILABLE    依赖失败：一律拒，不降级放行
     | VERSION_CHANGED             并发：邀请前角色/团队被他人改动
  幂等重放：同 (orgId, email) 的重复提交返回既有 inviteId，不新建行、不重复扣额度
  超时：邮件发送异步；接口在 1 秒内返回 pending，送达结果由 sentAt 与 status 表达
  部分成功：N/A —— 单收件人。批量入口是否存在见 domain [待定 K]
  撤回中：N/A —— 邀请阶段尚无个人数据关联
```

⚠ **`orgRole = "admin"` 时返回 `awaiting-review` 而不是 `pending`，且此时不签发 token**（I-3）。
这是 O-28 ⑥ 的落点：**提权动作被单个被盗账号执行即等于整个组织沦陷**。

### `ReviewAdminInvite`

```
UC: 另一名管理员批准/拒绝一条管理员邀请（O-28 ⑥ 双人复核）
  in:  { inviteId, reviewerId, decision: "approve" | "reject", reason? }
  out: { status: "pending" | "revoked", tokenIssued: boolean }
  pre: · reviewer 的 orgRole = "admin" 且 reviewerId ≠ invite.invitedBy
       · invite.status = "awaiting-review"
  err: INVITE_SELF_REVIEW_FORBIDDEN   越权：发起人自批（I-4）
     | PROJECT_ROLE_INSUFFICIENT      越权：非管理员批准
     | INVITE_NOT_FOUND               邀请已被撤销
     | VERSION_CHANGED                并发：两名管理员同时批，只生效一次
     | AUTH_SERVICE_UNAVAILABLE
  幂等重放：同一 reviewer 重复 approve 返回同一结果，不重复签发 token
  边界：组织内只有一名管理员时，该邀请**停在待批队列**并提示需平台运营方协助——
        ⚠ 不得因无人复核而退化为单人可批，否则规则形同虚设
```

### `ResendOrgInvite` / `RevokeOrgInvite`

```
UC: 重发 / 撤销一条未接受的邀请
  in:  { inviteId, actorId }
  out: { newTokenIssued: boolean } | { status: "revoked" }
  pre: actor 的 orgRole = "admin"；invite.status = "pending"
  err: RATE_LIMITED                60 秒冷却 / 每日 5 次（O-28 ④）
     | INVITE_NOT_FOUND
     | PROJECT_ROLE_INSUFFICIENT
     | MAIL_UNAVAILABLE
     | VERSION_CHANGED             并发：撤销与重发同时发生，最终状态唯一且可识别
  幂等重放：重复撤销返回同一 revoked 状态（撤销是幂等的）；
            重复重发**不是**幂等的——它会作废旧 token，故受 RATE_LIMITED 保护
  语义：重发 = 签发新令牌 + 作废旧令牌，**不是把同一条链接再发一次**（I-6）
```

### `ActivateOrgMember`

```
UC: 受邀人点开激活链接，成为组织成员
  in:  { token, mode: "new-account" | "existing-account",
         profile?: { name, password },      // mode=new-account
         sessionId?: SessionId }             // mode=existing-account
  out: { userId, orgId, orgRole, teamId, sessionId }
  pre: · token 有效、未使用、未撤销、未过期（7 天，O-28 ④）
       · 组织未被停用
       · mode=new-account 时密码满足 ≥12 位 + 弱口令库（策略实现复用 phase-00 auth，不另写一份）
  err: INVITE_NOT_FOUND            ⚠ 无效/过期/已用/已撤销**四种返回完全相同**（V10）
     | INVITE_ALREADY_MEMBER
     | VERSION_CHANGED             并发：管理员在激活途中改了角色/团队 → 以服务端最新值为准（A3）
     | AUTH_SERVICE_UNAVAILABLE
  幂等重放：同一 token 第二次调用返回 INVITE_NOT_FOUND（I-1），**不返回"已激活成功"**
  部分成功：**禁止** —— 核销令牌、创建 org_member、写角色与团队、初始化配额
            必须在**同一事务**内完成（I-1）。事务失败后 token 仍未核销
  超时：事务超时按失败处理并回滚，不残留半成品成员行
  撤回中：管理员在激活途中撤销了邀请 → 当前步骤立即失败并说明原因（E7）
  ⚠ 安全：请求里携带的 orgId / orgRole / teamId **一律忽略**，实际授予恒为服务端记录值（I-2），
     篡改尝试写安全审计。这是本用例最大的越权面——链接里明文写着角色，客户端可改
  ⚠ O-28 ⑤：点击一次性激活链接**即足以证明邮箱所有权**，不再二次发信
```

### `MutateTeam`

```
UC: 团队增 / 删 / 改（O-29 ④）
  in:  { orgId, actorId, op: "create" | "rename" | "delete", teamId?, name? }
  out: { team } | { blocked: { memberCount, aclBindingCount, items[] } }
  pre: actor 的 orgRole = "admin"
  err: TEAM_IN_USE                 删除前占用校验失败，**响应必须列出占用项**（I-7）
     | PROJECT_ROLE_INSUFFICIENT
     | VERSION_CHANGED             并发：两名管理员同时改同一团队
     | AUTH_SERVICE_UNAVAILABLE
  幂等重放：create 同名返回既有 team（组织内名称唯一）；delete 已删除的返回同一结果
  语义：**rename 不改 id**，已有 acl_binding 绑定不受影响；**不做级联删除**
```

### `RemoveOrgMember`

```
UC: 移除组织成员（O-29 ②）—— ⚠ 与 UC-17.2 的授权撤回**结果相反，不得共用代码路径**
  in:  { orgId, actorId, userId }
  out: { revokedSessions: number, revokedInvites: number,
         quotaReleased: number, pendingTasks: TaskRef[] }
  pre: actor 的 orgRole = "admin"；userId ≠ actorId（不可自移）
  err: PROJECT_ROLE_INSUFFICIENT
     | VERSION_CHANGED
     | AUTH_SERVICE_UNAVAILABLE
  幂等重放：重复移除返回同一结果，配额不重复释放
  部分成功：**禁止** —— 吊销会话、作废邀请、释放配额三件在同一事务
  语义（I-8）：停用访问 ≠ 删除产出。历史产出**保留并归属组织，署名保留**，
        界面显示「已离职」标记而非匿名化——匿名化会让历史决策失去可问责性
  out.pendingTasks 是**契约的一部分**：确认弹窗要显示「他还负责着哪些未完成任务」
```

---

## 二、项目邀请链接（UC-1.3 → F15 F16）

### `UpsertParticipantRoster`

```
UC: 按邮箱/手机号批量邀请参与者并指派身份四选
  in:  { projectId, actorId, recipients: string[],   // 「邮箱或手机号，逗号分隔」
         identity: "member" | "groupLead" | "observer" | "coFacilitator" }
  out: { created: ParticipantRef[], deduped: string[], invalid: {value, reason}[] }
  pre: actor 在本项目的 projectRole = "facilitator"
  err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT
     | VERSION_CHANGED
     | AUTH_SERVICE_UNAVAILABLE
  部分成功：**一等返回形态** —— 格式非法/重复项逐条标出并允许改正后重提，
            **不整批失败，也不静默丢弃**（E3）
  幂等重放：同一手机号/邮箱按 A2 去重，不产生重复名单条目
  ⚠ `coFacilitator` 是**展示别名**，落库 projectRole = "facilitator"（O-03 / I-17），
     不产生第五种取值。界面文案须明示「协同引导师 ＝ 以引导师身份加入」
```

### `IssueInviteLink`

```
UC: 签发主链接 / 分组链接 / 邀请码
  in:  { projectId, actorId, kind: "main" | "group", groupId?,
         identity: 四选, validity: "24h" | "7d" | "once" }
  out: { linkId, url, token, inviteCode?, qrPayload }
  pre: actor 的 projectRole = "facilitator"
  err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT
     | VERSION_CHANGED             并发：两名引导师同改同一条链接配置（E6）
     | AUTH_SERVICE_UNAVAILABLE    二维码服务不可用时降级为可复制的纯 URL，不静默失败
  幂等重放：同 (projectId, kind, groupId, identity, validity) 返回**同一条**有效链接，
            不每次新签一条（否则「单条撤销」的语义会被稀释成撤销其中一条）
  超时：N/A —— 纯本地签发
  部分成功：N/A
  撤回中：N/A
  ⚠ token 恒非空（I-10）；`?r=member` 只是展示层的可读参数，**权威在服务端的 linkId → projectRole 映射**
  ⚠ **观察者链接的只读约束落在服务端角色判定上**（identity 束 Authorize），
     **不为链接单做一套过滤**——两处会漂移（uc-1-3 R7 / uc-1-4 R7 互相印证）
```

### `BroadcastInvites`

```
UC: [群发邀请] 按名单批量发出
  in:  { projectId, actorId, participantIds: ParticipantId[], channel: "sms" | "email" | "both" }
  out: { delivered: ParticipantId[], failed: {id, reason}[] }
  pre: actor 的 projectRole = "facilitator"
  err: PARTIAL_DELIVERY            ⚠ **不得把部分失败呈现为整批成功**（E4）
     | SMS_UNAVAILABLE | MAIL_UNAVAILABLE
     | RATE_LIMITED
     | PROJECT_ROLE_INSUFFICIENT
  部分成功：**这是本用例的常态** —— out 同时带 delivered 与 failed，失败项可单条重试
  幂等重放：同一 participantId 的重复群发受 RATE_LIMITED 保护，不重复计送达
  ⚠ 渠道与模板尚未定（uc-1-3 R10 `[待确认]`，与 uc-1-2 的短信服务商是同一条）
```

### `RevokeInviteLink` / `ResetAllInviteLinks`

```
UC: 单条撤销 / [重置全部]
  in:  { projectId, actorId, linkId? }          // linkId 省略 = 重置全部
  out: { revokedLinkIds: LinkId[], onsiteSessions: number, survivesUntilStageId }
  pre: actor 的 projectRole = "facilitator"     // 组长/项目负责人是否有此权见 domain [待定 H]
  err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT
     | VERSION_CHANGED             并发：两名引导师同时 [重置全部]，最终状态唯一且可识别（E6/V10）
     | AUTH_SERVICE_UNAVAILABLE
  幂等重放：重复撤销同一条返回同一结果
  语义（I-12 ~ I-15）：
    · **新访问** ≤5 秒内失效（[Backlog] 数字，见 domain [待定 G]）
    · **已在场者不被立即踢出**，其 LiveSession 保留至 survivesUntilStageId 结束
    · [重置全部] 与逐人移出**立即生效，不等环节结束**（紧急手段）
    · 单条撤销只作废该条，其余不受波及
  out.onsiteSessions 是**契约的一部分**：二次确认弹层要显示
    「已在场的 N 人不会被踢出，但这 M 条链接的新访问将立即失效」
```

### `GetCheckinBoard`

```
UC: 分组与签到（现场面）
  in:  { projectId, actorId }
  out: { groups: {groupId, title, present, total, links: {url, qrPayload}[],
                  roster: {alias, attendance}[]}[],
         overall: {present, total} }
  pre: actor 的 projectRole = "facilitator"（组长只见本组，观察者只见脱敏聚合）
  err: NO_PROJECT_ROLE | PROJECT_ROLE_INSUFFICIENT | AUTH_SERVICE_UNAVAILABLE
  ⚠ 观察者视角下 roster 中**不含**任何手机号与令牌明文（I-16），至多脱敏聚合「11/12 已到」
  ⚠ 管理面与现场面**共用同一份数据**，不得实现成两套链接（uc-1-3 R8 信息架构）
  降级：实时通道不可用时降级轮询并**显示「非实时」**——不得伪装已同步
```

---

## 三、免注册进场（UC-1.2 → F12 F13 F14）

### `RequestJoinCode`

```
UC: 落地页填手机号，[获取] 验证码
  in:  { linkToken, phone }
  out: { sent: true, maskedPhone: "138 •••• 2049", cooldownSec }
  pre: 链接令牌有效
  err: LINK_TOKEN_REQUIRED | LINK_REVOKED | LINK_EXPIRED | LINK_ALREADY_USED
     | RATE_LIMITED           频率上限与失败次数上限——⚠ 阈值见 domain [待定 B]
     | SMS_UNAVAILABLE        ⚠ **明确失败并保留输入**，提供「让引导师直接把我加进来」兜底（E5/V9）
  幂等重放：冷却期内重复请求返回同一 cooldownSec，不重复发短信
  ⚠ 验证码仅用于**证明手机号本人持有**，**不构成账号认证**，
     且**不得用于登录正式账号**（正式登录只走 phase-00 auth）
  ⚠ 三种链接失效对参与者渲染为同一句「找引导师重发」，不泄露该项目/组是否存在（E1）
```

### `JoinByGroupLink`

```
UC: 用分组链接免注册进场（D-01 名单实名 + O-06 令牌）
  in:  { linkToken, phone?, code?, existingSessionId? }
  out: { guestIdentityId, projectId, groupId, projectRole, alias,
         stage: {id, index, total}, redirectedFromLinkGroup: boolean }
  pre: **两个条件同时成立**（I-19）：令牌有效 ∧ 手机号在本场名单内
       （已是组织成员时走 existingSessionId 免登分支，不再要手机号）
  err: LINK_TOKEN_REQUIRED     去掉 ?t= 直接访问被拒（V6a ①）
     | LINK_REVOKED | LINK_EXPIRED | LINK_ALREADY_USED
     | PHONE_NOT_ON_ROSTER     ⚠ **不是错误页**：停在门口 + [向引导师申请加入]（E2）
     | RATE_LIMITED
     | SMS_UNAVAILABLE
     | AUTH_SERVICE_UNAVAILABLE
     | WITHDRAWAL_IN_PROGRESS  该手机号已发起撤回，处于待删除队列
  幂等重放：同一名单条目重复进场返回**同一** guestIdentityId，不产生第二个身份
  并发：同一 once 令牌被两人同时使用，恰好一个写入 usedBy（I-11）
  部分成功：**禁止** —— 建身份 + 授项目角色 + 写到场状态在同一事务
  超时：短信/名单查询超时保留用户输入并可安全重试，不产生「看似已进场」的假成功
  语义：
    · **不创建账号**（I-18）——账号表行数前后相等
    · 落地组号恒取名单条目的 groupId（I-20）；打开别组链接 **不报错**，
      redirectedFromLinkGroup = true 并提示「你在第 2 组」（AC3）
    · 组长令牌额外授予 projectRole = "groupLead"，多 [向引导师举手] [提交本组产出] 两个动作端点
    · 已是组织成员者**直接免登**，其项目角色仍由链接授予，**不因组织角色自动升级**
      （承接「管理员不是超级用户」）
```

### `ApplyForJoin` / `ReviewJoinApplication`

```
UC: 名单外访客申请加入 / 引导师批准或拒绝
  in:  { linkToken, phone } | { applicationId, actorId, decision: "approve"|"reject", groupId? }
  out: { applicationId, status: "pending"|"approved"|"rejected" }
  pre: 申请侧：手机号已验证但不在名单；审批侧：actor 的 projectRole = "facilitator"
  err: JOIN_PENDING_APPROVAL   重复申请返回既有单据（幂等）
     | PROJECT_ROLE_INSUFFICIENT
     | VERSION_CHANGED         并发：两名引导师同时处理同一条待批
     | AUTH_SERVICE_UNAVAILABLE
  ⚠ **批准前该访客不进入任何组、读不到任何内容**（I-21）——
     断言是「返回 0 行」而不是「界面上没渲染」
  批准语义：把该手机号写入名单并指定组号，参与者刷新即进场；拒绝则明确告知
```

### `ResumeLiveSession`

```
UC: 掉线 / 换设备重开链接
  in:  { linkToken, phone, code, deviceId }
  out: { guestIdentityId, groupId, stage, takeoverOf: DeviceId | null }
  pre: 已验证手机号 + 名单条目（**不依赖浏览器 Cookie**，I-23）
  err: 同 JoinByGroupLink
  语义：回到**同一组、同一环节**，本组产出不丢；
        换设备接管后**旧设备会话立即失效并提示**
  幂等重放：同一 deviceId 重复恢复返回同一会话，不产生第二条 LiveSession
```

### `SetMicrophoneState`

```
UC: 麦克风开关
  in:  { guestIdentityId, enabled: boolean }
  out: { enabled, transcribing: boolean }
  pre: 持有效 LiveSession
  err: NO_PROJECT_ROLE | AUTH_SERVICE_UNAVAILABLE
  幂等重放：设为同一值返回同一结果
  语义（I-25）：**拒绝或关闭麦克风不阻断进场**，只关闭本人语音转写；
        工作台需**常驻可见**的开关与当前状态（转录中 / 已关闭）
```

### `ArchiveGuestIdentities`

```
UC: 项目结束，免注册身份自动归档
  in:  { projectId, actorId | systemTrigger }
  out: { archived: number }
  err: VERSION_CHANGED | AUTH_SERVICE_UNAVAILABLE
  幂等重放：重复归档返回 archived = 0
  语义（I-24）：归档后该身份**不可再进场**，其产出仍按项目留存策略保留并可追溯到名单条目
```

### `WithdrawParticipantPhone`

```
UC: 受访者/参与者手机号纳入撤回与删除范围（D-01 + D-13/D-15）
  in:  { participantId, requestedBy: "data-subject" | "facilitator", ackImpact: true }
  out: { queuedAt, logicalRetireDeadline, physicalDeleteDeadline, affectedReportSegments: Ref[] }
  pre: ackImpact = true —— 界面须先展示影响范围并由本人勾选「我已了解影响范围」
  err: WITHDRAWAL_IN_PROGRESS    幂等重放：已在队列中返回同一单据，不重复排队
     | NO_PROJECT_ROLE
     | AUTH_SERVICE_UNAVAILABLE
  部分成功：**禁止** —— 入队、退出检索、标失效三件的**触发**在同一事务；
            级联执行本身是异步的，其进度由 out 的两个 deadline 表达
  语义（I-34）：① 入待删除队列 ② 关联可识别信息 ≤5 分钟退出检索
        ③ 引用过它的报告段落**标为失效而非静默删除** ④ ≤30 天物理删除并出回执
  ⚠ **两个时限一律引用 D-13/D-15 的单一事实源**（`apps/web/lib/withdrawal-flow.ts`，
     由 `lint-withdrawal-flow.mjs` 门控），本束**不另立数值**
  ⚠ 级联引擎本体属 22-files（T86）与 17-gov（UC-17.2），本束只负责**触发与手机号接入**
```

---

## 四、角色可见性与管理员边界（UC-1.4 → F04 F05 F06 F07）

### `RenderRoleView`

```
UC: 同一套屏按项目角色裁剪
  in:  { userId, orgId, projectId, screen: ScreenId }
  out: { skeleton: ScreenSkeleton,           // 四种角色**同一套**
         visibleBlocks: BlockId[],
         actionEndpoints: EndpointId[],      // 观察者恒为空集（I-26）
         roleBanner: { orgRole, teamName, projectRole, groupLabel } }
  pre: —（无项目角色时正常返回，见下）
  err: 不抛错。无权限时返回 allowed=false 的 PermissionDecision（沿用 identity 束的取向：
       鉴权结果是**可解释的数据**，不是异常）。无项目角色 → NO_PROJECT_ROLE ⇒ 界面渲染
       **无权限态而非空列表**（V10）
  ⚠ 越权字段在响应体中**键不存在**（I-27），不是置空、不是前端隐藏
  ⚠ roleBanner 同时显示两层身份「顾问 · 能源组 ｜ 本项目：组长 · 第 2 组」——**原型未画，需补**
```

### `PreviewAsRole`

```
UC: 视角切换器（引导师/项目负责人预览别人看到什么）
  in:  { userId, projectId, asRole: ProjectRole }
  out: 同 RenderRoleView，外加 { previewing: true, exitTo }
  pre: 调用者的真实 projectRole = "facilitator"（低权角色能否见此控件见 domain [待定 I]）
  err: PROJECT_ROLE_INSUFFICIENT | AUTH_SERVICE_UNAVAILABLE
  语义（I-30）：**切换视角不改数据，只改可见范围**；
        · **不得因此获得任何超出真实角色的读权**
        · **不得以被预览角色的身份写入** —— 预览态下全部写端点返回 PROJECT_ROLE_INSUFFICIENT
        · 预览动作本身留痕
```

### `GrantTemporaryAccess` / `ExpireTemporaryAccess`

```
UC: 临时提权，按议程环节自动失效
  in:  { projectId, actorId, subjectId, object: {kind, id}, expiresAtStageId }
     | { stageId, terminationKind: "completed" | "skipped" | "merged" | "early-ended" }
  out: { grantId, auditEventId } | { expiredGrantIds: GrantId[], auditEventIds: [] }
  pre: actor 的 projectRole = "facilitator" 或 orgRole = "lead"（项目负责人）
  err: PROJECT_ROLE_INSUFFICIENT
     | STAGE_GRANT_EXPIRED         幂等重放：对已失效的 grant 重复收回返回同一结果
     | VERSION_CHANGED             并发：环节推进与授予同时发生 —— **以环节状态机为准**，
                                    授予到一个已结束的环节直接失败
     | AUTH_SERVICE_UNAVAILABLE
  语义（I-28）：
    · 失效条件是**流程节点不是时间点**
    · 环节被**提前结束 / 跳过 / 合并**时同样立即失效 —— 四种终止方式各一条断言
    · **失效由服务端在环节状态机变更时主动收回**，不得依赖前端或定时轮询兜底
    · 授予、每次使用、失效**三个时刻**都写审计；失效事件通知授予人
  ⚠ 外部依赖：环节状态机属 06-现场协作。**本用例两条不变量的锚点在另一个模块里**
```

### `RecordAdminProjectAccess` / `ListMyAccessLog` / `ListProjectAccessLog`

```
UC: 管理员权力边界（D-18）
  in:  { adminId, projectId, objectRef } | { adminId } | { projectId, actorId }
  out: { logId } | { entries: AdminAccessLog[] } | { entries: AdminAccessLog[] }
  pre: ListProjectAccessLog 的 actor 是该项目的**项目负责人**
  err: ADMIN_NOT_SUPERUSER    管理员在其**无项目角色**的项目中内容读取一律被拒（V8）
     | PERSONAL_LAYER_CLOSED  查他人个人层只返回计数（**已由 phase-00 identity I-8 保证**）
     | NO_PROJECT_ROLE
     | AUTH_SERVICE_UNAVAILABLE
  语义（I-29）：管理员每次项目层读取产生**恰好一条**日志，
        且该条**同时**对项目负责人与管理员本人可见 —— 三方查询查到的是**同一条**
  ⚠ 「个人层只见计数」不在本束重复声明（phase-00 identity I-8）。
     本束声明的是它的**项目层对偶**：可读，但留痕且对项目负责人可见
  ⚠ 项目负责人侧「谁读过我的项目」视图**原型未画，需补**
```

### `ResolveResourceScope`

```
UC: 资源可见性范围过滤（全组织可用 / 仅某团队）
  in:  { userId, orgId, resource: {kind: "agent"|"canvas-template"|…, id} }
  out: PermissionDecision            // scopeLayer 带 scope 与 passed
  err: ORG_SCOPE_DENIED             拒绝原因**必须标明是组织层限制**，不是项目层（V6）
     | AUTH_SERVICE_UNAVAILABLE
  语义：标为「仅某团队」的资源对非该团队成员一律拒绝，**无论其项目角色为何**；
        团队单一归属（O-12）⇒ 判定是**相等比较**不是集合包含
  ⚠ MCP 的「授权范围」（仅项目负责人 / 全体成员 / 待安全评审）是**另一套枚举**，
     表达「谁能调这台服务器」，**禁止与团队可见性合并成同一字段**
  ⚠ 判定实现属 phase-00 identity 的 Authorize；本用例是它在本束场景下的**调用契约**，
     不是第二个实现
```

---

## 五、设备与会话（UC-1.1 → F03）

### `ListDeviceSessions` / `KickDeviceSession`

```
UC: 设置 → 设备与会话，踢下线
  in:  { userId } | { userId, targetSessionId, confirmed: true }
  out: { sessions: {id, device, location, lastActiveAt, current: boolean}[] }
      | { revokedAt, affectedDevice }
  pre: 只能列/踢**自己**的会话（本用例不给管理员踢别人的能力——那是 RemoveOrgMember 的事）
  err: NO_ORG_MEMBERSHIP | AUTH_SERVICE_UNAVAILABLE
     | VERSION_CHANGED       并发：两处同时踢同一会话，最终状态唯一
  幂等重放：重复踢同一会话返回同一 revokedAt
  语义（I-32）：被踢会话的**下一次请求即失效**，不等自然过期；
        吊销是写标记不是删行（沿用 phase-00 auth I-7）
  ⚠ 二次确认并说明影响范围
  ⚠ **整块能力在原型中是「原型确认缺失」**（登录页与后台各屏均已逐字段抽取，无任何设备/会话入口）。
     30 天有效期、设备指纹、踢下线三项全部出自 [Backlog]。
     ⇒ **在补画并裁决前不得当作已确认需求实现**（uc-1-1 R8 sign-off 原文）
```

---

## 六、端口（`infrastructure` 实现这些）

| 端口 | 职责 | 实现 |
|---|---|---|
| `OrgInviteRepository` | 组织邀请与双人复核队列 | PostgreSQL（RLS 强制） |
| `TeamRepository` | 团队增删改 + 占用查询 | PostgreSQL |
| `ParticipantRosterRepository` | 参与者名单、到场状态 | PostgreSQL |
| `InviteLinkRepository` | 链接、令牌、使用记录 | PostgreSQL |
| `GuestIdentityRepository` | 免注册身份与现场会话 | PostgreSQL |
| `TempGrantRepository` | 临时提权 | PostgreSQL |
| `DeviceSessionRepository` | 设备会话 | 与 phase-00 的 `SessionStore` **同一个存储**，不新建第二处会话真相 |
| `SmsSender` / `MailSender` | 验证码、邀请、群发 | 外部服务商 `[待确认]`（uc-1-2/1-3 同一条） |
| `StageEventSource` | **订阅**议程环节的结束/跳过/合并事件 | 06-现场协作提供。⚠ 本束是消费者不是定义者 |
| `AuditWriter` | append-only 审计事件 | ⚠ 与 phase-00 `ProvenanceWriter` **必须是同一个查询面**，见 coverage.md 缺口 ① |
| `QuotaLedger` | 邀请时预留 / 移除时释放 | 后台配额模块提供 |
| `WithdrawalOrchestrator` | 撤回链触发 | 22-files T86 / 17-gov UC-17.2 提供 |
