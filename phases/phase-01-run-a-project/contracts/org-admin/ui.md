# 契约束 `org-admin` — ① UI（签核第一件）

> ## ⚠ 截图未产出 —— 在此之前第 ① 件**不具备签核条件**
>
> `phases/phase-01-run-a-project/ui-preview/` 下**只有三份 markdown 与一个 `files/` 目录**，
> 后者的 15 张截图**全部属于 22-files 束**（`uc-22-1-*` / `uc-22-2-*` / `uc-22-4-*`）。
> **本束的六块已建成屏（`/login` `/join` `/consent` `/group` `/session` `/admin/members`）
> 一张截图都没有。**
>
> ⇒ 本文件现在是**骨架**：它写清了「本束需要哪几块屏、哪些已建成、真实 `data-testid` 是什么」，
> 但「人看到的界面对不对」这个问题，在截图补齐之前**人类无法回答**。
> ⇒ 请 **ui-prototyper** 按第三节的清单补图，再签第 ① 件。
> ⇒ ⚠ **agent 不得因为本文件已存在就认为第 ① 件已完成**——`requiredBundleFiles()` 只检查文件在不在，
> 不检查它有没有内容。这正是本仓「规范在、脚本没有」的老毛病；此处显式标注以免被静默通过。

---

## 一、怎么看现有界面

```bash
pnpm --filter web dev      # → http://localhost:3100
```

- **七态**：任意屏加 `?state=loading|empty|invalid|dep-failed|denied|success`
- **四视角**：`?as=facilitator|groupLead|member|observer`
- **双组织**：`?org=org-yuanyang|org-hengtai`
- 组件与七态的活文档：`/kitchen-sink`

⚠ 三个预览开关**在生产构建下不可达**（`scripts/verify-prod-gates.sh` 断言）——
**它们是预览手段，不是权限**。真实权限在服务端（NestJS Guard + PostgreSQL RLS）。

---

## 二、本束需要哪几块屏

`data-testid` 全部**已在代码中核实**（`grep -rn 'data-testid' apps/web/components/{entry,admin}`），不是推测。

### 2.1 已建成

| # | 屏 | 路由 | 组件 | 服务哪些 feature | 真实 `data-testid` |
|---|---|---|---|---|---|
| 1 | **链接落地页** | `/join` | `apps/web/components/entry/join-form.tsx` | **F12 F13** | `join-verify-form` `join-phone` `join-get-code` `join-code` `join-code-sent` `join-enter` `join-continue` `join-member-continue` `join-member-sso` `join-lead-note` `join-mic-note` |
| 2 | 同上 · **三种意外** | `/join` | 同上 | **F13** | `join-wrong-group`（别组跳回）`join-not-listed` `join-apply` `join-apply-status` `join-apply-sim` `join-apply-approve` `join-apply-reject`（申请加入待批）`join-reconnect` `join-reconnect-verify`（换设备恢复） |
| 3 | **小组工作台** | `/group` | `apps/web/components/entry/group-workbench.tsx` | **F12 F13 F04** | `group-broadcast` `group-canvas` `group-stickies` `group-add-row` `group-add-sticky` `group-add-sticky-input` `group-voice-sticky` `group-mic-toggle` `group-mic-status`（麦克风常驻开关）`group-lead-actions` `group-raise-hand` `group-hand-raised-note` `group-submit-output` `group-submit-confirm` `group-submit-impact` `group-submit-commit` `group-submit-cancel` `group-submit-done` `group-fc-suggestion` `group-fc-accept` `group-fc-accepted` |
| 4 | **受访者同意书** | `/consent` | `apps/web/components/entry/consent-form.tsx` | **F14** | `consent-body` `consent-controller` `consent-confirm` `consent-decline-all` `consent-withdraw-entry` `consent-withdraw-open` `consent-withdraw-panel` `consent-withdraw-flow` `consent-withdraw-ack` `consent-withdraw-confirm` `consent-withdraw-cancel` `consent-withdraw-back` `consent-withdraw-done` |
| 5 | **受访者会话** | `/session` | `apps/web/components/entry/session-panel.tsx` · `session-authorizations.tsx` · `session-withdraw.tsx` | **F14** | `session-status` `session-status-elapsed` `session-actions` `session-authorizations` `session-grant-alias` `session-transcript` `session-transcript-request` `session-transcript-receipt` `session-controller` `session-withdraw-entry` `session-withdraw-open` `session-withdraw-panel` `session-withdraw-flow` `session-withdraw-ack` `session-withdraw-confirm` `session-withdraw-cancel` `session-withdraw-back` `session-withdraw-done` |
| 6 | **登录页** | `/login` | `apps/web/components/entry/login-form.tsx` | 主体属 phase-00 auth；本束**只借它验 F03 的入口** | `login-form` `login-email` `login-password` `login-password-toggle` `login-submit` `login-forgot-link` `login-forgot-panel` `login-forgot-email` `login-forgot-submit` `login-forgot-sent` `login-forgot-back` `login-providers` `login-create-org` `login-create-org-panel` `login-invite-code` `login-org-name` `login-create-org-submit` `login-create-org-done` `login-create-org-back` |
| 7 | **后台 · 成员与配额（仅 D-18 边界区）** | `/admin/members` | `apps/web/components/admin/members-screen.tsx` | **F06**（完整）· F10 F11（**仅成员表壳**） | `admin-members-list` `admin-member-row-<id>` `admin-member-quota-<id>` `admin-member-quota-cancel` `admin-member-quota-save` `admin-members-boundary` `admin-members-private-counts` `admin-member-private-<id>` `admin-members-project-access` `admin-members-my-access` `admin-members-access-logs` `admin-access-log-<id>` `admin-members-access-full` `admin-members-access-item` |
| 8 | 后台 · **能力清单的可见性徽标** | `/admin/{agent,skill,model,mcp}` | `apps/web/components/admin/scope-badges.tsx` | **F07** | `admin-agent-list` `admin-skill-list` `admin-model-filters` `admin-mcp-list` `admin-mcp-scope-note`（MCP 授权范围是**另一套枚举**，界面上已分开） |

### 2.2 未建（明确的缺口，不是遗漏）

| # | 屏 | 期望路由 | 服务哪些 feature | 现状与依据等级 |
|---|---|---|---|---|
| 9 | **项目设置 → 参与者与邀请**（管理面） | `/projects/[id]/settings/participants` | **F15 F16** | **未建** —— 全仓无 `invite` / `participant` / `roster` 相关 testid。原型**两处载体均已画**（proto-08），但代码里整屏没有。⚠ 屏内两处是**原型确认缺失**：**单条撤销的确认弹层**、**一次性链接的使用者记录** |
| 10 | **现场协作 → 分组与签到**（现场面） | `/projects/[id]/live/checkin` | **F15 F16 F12 F13** | **未建**。原型已画（proto-06）：每组链接 + `[复制]` + `[二维码]` + 签到名单 + 到场三态 + n/m + 全场计数 + `[看加入页]`。⚠ 它与 #9 **共用同一份数据**，不得实现成两套链接 |
| 11 | **项目工作台 · 四视角切换器** | `/projects/[id]`（顶部常驻） | **F04** | **未建**。原型已画（proto-05）：`视角切换：引导师 ｜ 组长 ｜ 组员 ｜ 观察者` + 四段权限说明原文 + 各视角独有按钮。⚠ 现有的 `?as=` 是**各屏自己的预览轴**（`preview-switcher.tsx` / `files-app.tsx`），不是这个控件 |
| 12 | **角色说明条**（两层身份） | 同上 | **F04** | **未建，且原型未画**。形如「顾问 · 能源组 ｜ 本项目：组长 · 第 2 组」（uc-1-4 R8 [设计]） |
| 13 | **临时提权授予入口**（选人→选资源→选失效环节） | `/projects/[id]/settings/grants` | **F05** | **未建，且原型未画**。原型只有**审计侧的留痕**（`09:41:07 角色 授予客户方王毅「观察者」＋ 第 2 组原始内容临时读权 / 环节 3 结束自动失效`） |
| 14 | **项目负责人侧「谁读过我的项目」** | `/projects/[id]/settings/access-log` | **F06** | **未建，且原型未画**。⚠ D-18 第 ② 条明写「对项目负责人可见」——只建了管理员本人那一侧（`admin-members-my-access`），**这一侧缺失就等于 D-18 只兑现了一半** |
| 15 | **`[邀请成员]` 弹层**（邮箱 + 角色三选 + 团队下拉） | `/admin/members` 弹层 | **F10 F11** | **未建**。原型属「**原型待补**」——按钮在「成员与配额」屏上**确实存在且已探明**，点击后没有任何屏（入口在、行为未接线） |
| 16 | **激活落地页**（设姓名与密码） | `/activate?token=…` | **F10** | **未建**。原型属「**原型确认缺失**」——底部演示场景条 11 项已完整枚举且无任何注册/激活场景。⚠ 说明页却自称「登录/注册…已完成」，**原型自身矛盾** |
| 17 | **待激活行 + `[重发]` + 撤销邀请** | `/admin/members` | **F10 F11** | **未建**。`members-screen.tsx` 里 grep「邀请 / 待激活 / 重发 / 团队 / 离职 / 角色」**零命中**。⚠ 撤销属「原型确认缺失」——待激活行已逐字段渲染，**行内只有 `[重发]`，没有撤销** |
| 18 | **团队维护入口**（增 / 删 / 改 + 占用阻断） | `/admin/members` 或 `/admin/teams` | **F11** | **未建，且原型确认缺失**（O-29 ④ 已裁定「团队由管理员维护、可增删改」，界面归属须补画） |
| 19 | **设置 → 设备与会话**（设备/地点/最后活跃/`[踢下线]`） | `/settings/devices` | **F03** | **未建**。⚠ **依据等级最低的一块**：原型属「原型确认缺失」（登录页与后台各屏均已逐字段抽取，**无任何设备/会话入口**），30 天/设备指纹/踢下线三项**全部出自 [Backlog]**。uc-1-1 R8 原文：**在补画并裁决前不得当作已确认需求实现** |

---

## 三、截图清单（待补）

约定文件名 `phases/phase-01-run-a-project/ui-preview/<slug>.png`。
⚠ 已建成的屏**必须连七态一起截**——原型是 happy path 演示、零异常态，
只截默认态等于把那个缺陷带进签核。

### 已建成，可立即截

| slug | 屏 / 状态 |
|---|---|
| `org-admin-join-default.png` | `/join` 默认态（手机号 + 验证码 + 掩码回显） |
| `org-admin-join-wrong-group.png` | `/join?…` 别组跳回提示条（**不是错误页**） |
| `org-admin-join-not-listed.png` | `/join` 门口页 + `[向引导师申请加入]` |
| `org-admin-join-apply-pending.png` | 申请加入的等待中 / 已批准 / 已拒绝三态 |
| `org-admin-join-reconnect.png` | 换设备恢复中的加载态 + 「已回到环节 3」 |
| `org-admin-join-dep-failed.png` | `?state=dep-failed` 短信服务不可用 + 兜底路径 |
| `org-admin-group-default.png` | `/group` 组员视角（含麦克风开关与状态） |
| `org-admin-group-lead.png` | `/group?as=groupLead` 多 `[向引导师举手]` `[提交本组产出]` |
| `org-admin-group-observer.png` | `/group?as=observer` **按钮集为空**（AC3 的界面证据） |
| `org-admin-group-empty.png` | `?state=empty` 本组尚无画布/便签的真实空态 |
| `org-admin-consent-withdraw.png` | `/consent` 撤回同意全流程（含「我已了解影响范围」勾选） |
| `org-admin-session-authorizations.png` | `/session` 四项独立授权 + 撤回入口 |
| `org-admin-admin-members-boundary.png` | `/admin/members` D-18 边界说明区（个人层只见计数 + 项目层留痕） |
| `org-admin-admin-members-my-access.png` | `[看我的访问记录]` 展开态 |
| `org-admin-admin-members-denied.png` | `?state=denied` 非管理员访问「成员与配额」 |
| `org-admin-scope-badges.png` | `/admin/agent` 全组织可用 / 仅某团队徽标 + MCP 的另一套枚举 |

### 待 ui-prototyper 先建屏再截

`org-admin-participants-invite.png`（#9）· `org-admin-checkin-board.png`（#10）·
`org-admin-perspective-switcher.png`（#11）· `org-admin-role-banner.png`（#12）·
`org-admin-temp-grant.png`（#13）· `org-admin-lead-access-log.png`（#14）·
`org-admin-invite-member-modal.png`（#15）· `org-admin-activate-landing.png`（#16）·
`org-admin-pending-activation-row.png`（#17）· `org-admin-team-crud.png`（#18）·
`org-admin-device-sessions.png`（#19 —— ⚠ 建屏前先裁决它的需求依据，见 coverage.md 缺口 1）

---

## 四、`ui-preview` 三份 markdown 里与本束相关的已知缺口

> 这些是「**UC 没写、由实现者替 UC 做了的决定**」。它们不是 bug，是缺口被填的位置。

### 🔴 S-02 / S-03 —— 合规负责人与场景角色不在 `ProjectRole` 四值里

`README.md` 把这两条列为「必须先定」，并写着实现用 `?as=compliance` / `?view=` 临时投影绕过、
「**这动摇了 O-03**」，还把它排进「建议优先核对的 5 处」第 3 位。

**⚠ 这一段是旧的。事实核对结果如下：**

- `phase-00/requirements/00-core/uc-0-3` 第 101 / 121 行：
  **[已裁决 D-U3，2026-07-28] 合规负责人归组织角色；不新增第三层「场景角色」。**
- `phase-00/contracts/identity/domain.md` 第 30 / 42 行已据此把 `orgRole` 定为**四值**（含 `compliance`），
  并声明**研究员 / 参与者是展示别名、不落库**。
- `apps/web/lib/identity.ts` 已有 `SCENE_ALIAS`，`OrgRole` 从 `@repo/contracts` 派生并含 `compliance`。
- ⇒ **O-03 没有被动摇，它被 D-U3 保住了。**

**真正剩下的是实现漂移**：`apps/web/components/files/files-app.tsx:85` 把 `compliance`
塞进了 `(ProjectRole | "compliance")[]` 这条**项目角色**预览轴：

```ts
const roleView: (ProjectRole | "compliance")[] = ["facilitator", "groupLead", "member", "observer", "compliance"];
```

一个**组织**角色被画在了**项目**角色的切换器里。签核时需确认：
① D-U3 覆盖 phase-01（本束据此**不新增第五个项目角色**）；
② `?as=compliance` 要不要拆成 `?asOrg=` / `?as=` 两条正交轴，还是留作已知的预览期简化。
⇒ **不阻塞本束的数据模型**（`ProjectRole` 恒四值），但**阻塞本束第 ① 件的签核**——
上面 #11 那块四视角切换器要建成几个视角，取决于这个答案。
⇒ **建议同时更新 `ui-preview/README.md`**，否则它会继续把一件已裁决的事呈现为待裁决。

### 🟠 S-08 —— 「组织停用只读条」不放登录页

UC-1.1 R8 要求只读说明条常驻可见，但那属于**已登录**成员（A1）；登录页尚无会话。
实现判定它归 `AppShell` 顶栏，登录页的 `denied` 态映射的是 **E2 账号被停用（组织层）**。
⇒ 与本束 F03 同屏，签核时顺带确认这个归属。

### 🟠 S-10 —— 代称格式并用了两种

小组工作台用「参与者 B（你）」，访谈侧用「某物流园区运营总监」；UC 列为 `[待确认]`。
手机号一律掩码 `138 •••• 2049`。⇒ 对应 `domain.md` 的 `[待定 D]`。

### 🟡 S-11 —— 观察者能看到多少，三处判断不同

- **对话**：滤掉批准卡与转录卡，不渲染输入区/改派条/分享，仅留 AI 发言与产物卡
- **访谈现场**：不硬拒，而是**转录只读 + 说话人掩码到角色标签**（连代称都不给）+ 显式横幅
- **研究**：观察者被挡在**丢弃清单明细**之外

⇒ 直接打在 F04 上。uc-1-4 R7 与 uc-1-3 R7 互相印证要求
「**观察者的只读约束落在服务端的角色判定上，不为链接单做一套过滤**」——
现在是三个模块各判各的。⚠ 这正是「同一事实声明在多处」的形态，请在签核时统一。

### 🟡 S-14 —— 危险动作补了二次确认与影响范围（UC 只给了一个按钮）

与本束相关的两条：
- **组长「提交本组产出」**：锁定 N 张便签快照 / 引导师与大屏可见 / 需引导师退回才能改
  —— ⚠ 「**这段发布语义全是拟的**」（README 原文）
- **受访者撤回**：加了「我已了解影响范围」勾选才解锁红色确认键 —— 对应本束 `WithdrawParticipantPhone` 的 `ackImpact`

### 未建的屏（README 第四节，与本束相关）

- **忘记密码后两屏**：依赖邮件里的一次性链接，属登录入口之外 —— 主体在 phase-00 auth，本束不管
- **移动端各业务屏**：只做了 `AppShell` 层的三档折叠。⚠ 本束的 `/join` `/group` 是
  uc-1-2 R9 明确要求「移动端保证加入、查看、输入、投票/确认等现场关键动作」的屏——
  **现场组员基本都在手机上**，这条缺口对本束的权重高于其它束
