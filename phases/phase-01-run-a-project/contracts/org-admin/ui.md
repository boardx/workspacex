# 契约束 `org-admin` — ① UI（签核第一件）

> **自检：本文件引用 48 张截图，目录下实际 48 张。**
> 目录 = `phases/phase-01-run-a-project/ui-preview/org-admin/`（另有一份 `README.md`，不计入）。
> 两数相等 ⇒ 无死链、无幽灵引用、无漏列。机械核对：
> ```bash
> D=phases/phase-01-run-a-project/ui-preview/org-admin
> ls -1 $D/*.png | wc -l                                             # → 48（实存 M）
> grep -o 'ui-preview/org-admin/[a-z0-9-]*\.png' phases/phase-01-run-a-project/contracts/org-admin/ui.md \
>   | sort -u | wc -l                                                # → 48（引用 N）
> # 逐张存在性：引用集 ⊆ 实存集，且实存集 ⊆ 引用集
> ```

> ## 现状：截图已产出，但**只覆盖三个 UC 的新建原型屏**
>
> **ui-prototyper 已交付 48 张真实截图**（`ui-preview/org-admin/`），用 `apps/web` 真实组件跑
> `next dev` 抓的（1360×900，2×，fullPage，0 条控制台报错），覆盖
> **UC-1.3（邀请 / 名册）· UC-1.4（四视角 / 临时提权 / 管理员边界）· UC-1.6（成员配额 / 激活）**
> 七块屏。完整索引见第三节，逐张对应的 UC 节次见该目录下的 `README.md`。
>
> ⚠ **但覆盖面不等于全部**：本文件第二节 2.1 列的**六块早已建成的真实屏**
> （`/login` `/join` `/consent` `/group` `/session` `/admin/members`）**仍然一张截图都没有**——
> 原型 agent 按「已有原型不重画、免造第二套」的纪律**有意跳过**了它们（见其 `README.md` 第五节），
> 这是**明示的取舍，不是遗漏**，但对签核而言它仍是**看不见的界面**。
> 缺口逐条汇总在**第五节「第 ① 件材料缺口」**。
>
> ⇒ 第 ① 件现在**具备实质签核材料**，但**不是全覆盖**：人类签核时必须同时回答
> ①「已截的 48 张对不对」与 ②「未截的那几块屏，本次是接受不看、还是要求补图」。
> ⇒ ⚠ **agent 不得因为截图数字对得上就认为第 ① 件已完成**——`requiredBundleFiles()` 只检查文件在不在。
> 这是本仓「规范在、脚本没有」的老毛病；上面那段 `grep` 是给它配的最小机械核对。

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

⚠ 本小节的「未建」指**产品代码里没有这块屏**，这一点至今成立。
但其中 **#9–#18 已由 ui-prototyper 在 `/org-admin/preview` 下用真实组件 + mock 画出并截图**
（mock 原型 ≠ 已建成产品屏，两者不要混为一谈）。逐条对应关系见表后的「原型截图对应」。

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

#### 原型截图对应（逐条核实，一条不落）

| # | 原设想的屏 | 原型截图 | 判定 |
|---|---|---|---|
| 9 | 参与者与邀请（管理面） | `uc-1-3-invites-*`（10 张） | ✅ 已画。⚠ 屏内两处「原型确认缺失」都补上了：单条撤销确认弹层 = `-revoke`；一次性链接使用者记录 `used_by` = `-default` 第 3 组（**呈现位置仍标 [待确认]**） |
| 10 | 现场协作 → 分组与签到（现场面） | `uc-1-3-roster-*`（7 张） | ✅ 已画。与 #9 同屏切换、共用同一份 mock 数据，未画成两套链接 |
| 11 | 项目工作台 · 四视角切换器 | `uc-1-4-roles-*`（7 张） | ✅ 已画。四视角 + 观察者按钮集为空 + 差集断言；顶部 `roles-single-source-note` 明写「是服务端单一判定的投影，不是第二套规则」 |
| 12 | 角色说明条（两层身份） | `uc-1-4-roles-*` 屏顶部常驻条 | ✅ 已画（**原「未建，且原型未画」已不成立**）：`uc-1-4-roles-facilitator` 顶部逐字渲染「顾问 · 能源组 ｜ 本项目：**组长 · 第 2 组**」，与 uc-1-4 R8 [设计] 的措辞一致。⚠ 它**没有独立截图**，随四视角屏一起看 |
| 13 | 临时提权授予入口 | `uc-1-4-grant-*`（4 张） | ✅ 已画（**原「原型未画」已不成立**）：选人→选资源→选失效环节 + 二次确认 + 留痕。⚠ 只画了**按流程节点失效**，见缺口 K-8 |
| 14 | 项目负责人侧「谁读过我的项目」 | `uc-1-4-boundary-default` 第三区 | ✅ 已画（**原「原型未画」已不成立**）：`boundary-who-read` 访问时间线，屏上自标「项目负责人视图 · 需补原型」。D-18 ② 的另一半（管理员本人侧 `[看我的访问记录]`）同屏 |
| 15 | `[邀请成员]` 弹层 | `uc-1-6-members-invite` / `-invite-admin` | ✅ 已画（**原「原型待补」已闭合**）：邮箱 + 角色三选 + 团队下拉；邀请管理员触发双人复核 |
| 16 | 激活落地页 | `uc-1-6-activate-*`（6 张） | ✅ 已画（**原「原型确认缺失」已闭合**）：免登独立卡片，新用户 / 已有账号两分支 |
| 17 | 待激活行 + `[重发]` + 撤销邀请 | `uc-1-6-members-default` 行内 | ✅ 已画：待激活 4 行分别演示「已发送 2 天 / 发送失败 / 已过期 9 天前 / 已撤销」，**行内同时有 `[重发]` 与 `[撤销]`**（原型旧版只有 `[重发]`，此处已补）。⚠ **撤销的二次确认弹层无截图**，见缺口 K-6 |
| 18 | 团队维护入口（增 / 删 / 改 + 占用阻断） | `uc-1-6-members-team-delete-blocked` | ⚠ **半画**：删除前占用校验阻断有图；团队区块自标「增删改 · 需补原型」，`[新建团队]` 入口在但**新建 / 编辑弹层无截图**，见缺口 K-7 |
| 19 | 设置 → 设备与会话 | **无** | ⚠ **未产出**，见缺口 K-5。原型 agent 明示不画（F03 属 UC-1.1，不在本束四个 UC 内） |

---

## 三、截图索引（真实文件，48 张，逐张可点开）

路径前缀一律 `phases/phase-01-run-a-project/ui-preview/org-admin/`，下表只写文件名部分。
**这不是约定文件名，是磁盘上实际存在的文件**——下面每一行都对应一个真实 `.png`。

原型入口：`/org-admin/preview`（dev `http://localhost:3211/org-admin/preview`），
七块屏用 `?screen=` 切，视角 `?as=`，七态 `?state=`。
代码：`apps/web/app/org-admin/preview/page.tsx` ＋ `apps/web/components/org-admin/*`
＋ `apps/web/lib/mock/org-admin.ts`（**纯 mock，不接后端**）。

⚠ 全部截图是**静态陈列**，不是真状态机流转；邀请 / 撤销 / 授予 / 移除 / 激活都只切本地状态。

---

### 3.1 UC-1.3 生成与撤销邀请链接 —— 屏「参与者与邀请」（管理面，R8 载体一）· 10 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-3-invites-default.png` | default · facilitator | 四条分组链接（**统一带一次性令牌** `?t=`，与 O-06 裁决一致）+ `[复制]` `[二维码]` + `used_by`（`郑好 · 今天 09:12`）。⚠ `used_by` 呈现位置在界面上显式打了 `[待确认]` badge |
| `ui-preview/org-admin/uc-1-3-invites-loading.png` | loading | 链接列表加载骨架 |
| `ui-preview/org-admin/uc-1-3-invites-empty.png` | empty | 尚未生成任何邀请链接 |
| `ui-preview/org-admin/uc-1-3-invites-invalid.png` | invalid | 校验失败（名单 / 分组输入不合法） |
| `ui-preview/org-admin/uc-1-3-invites-dep-failed.png` | dep-failed | 依赖服务不可用 + 兜底路径 |
| `ui-preview/org-admin/uc-1-3-invites-denied.png` | denied | 无生成/撤销权限的拒绝面 |
| `ui-preview/org-admin/uc-1-3-invites-success.png` | success | 生成成功回执 |
| `ui-preview/org-admin/uc-1-3-invites-grouplead.png` | default · **groupLead** | 组长视角：本组只读，**不可撤销 / 不可重置**（UC-1.3 R5 的默认取值，仍待产品确认，见第四节与 K-9） |
| `ui-preview/org-admin/uc-1-3-invites-revoke.png` | **特殊态：单条撤销确认弹层** | 二次确认 + 影响范围 + **填理由（≥4 字）解锁**。影响范围正文直接写进 O-06 两条裁决：「已在场者不被踢出，保留至当前环节结束」「新访问 5 秒内失效」。⚠ 这一屏原本属「原型确认缺失」，是本轮补画的关键件（F16 的界面锚点） |
| `ui-preview/org-admin/uc-1-3-invites-reset.png` | **特殊态：重置全部确认弹层** | 一次性作废全部链接并重签（R3 第 5 步 / AC5），与单条撤销是**两个不同动作**，弹层分开 |

### 3.2 UC-1.3 —— 屏「分组与签到」（现场面，R8 载体二）· 7 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-3-roster-default.png` | default · facilitator | 签到名单 + 到场三态 + 每组 n/m + 全场计数（R3 第 6 步）。**与 3.1 共用同一份链接数据**，不是第二套 |
| `ui-preview/org-admin/uc-1-3-roster-loading.png` | loading | 名册加载态 |
| `ui-preview/org-admin/uc-1-3-roster-empty.png` | empty | 尚无人签到 |
| `ui-preview/org-admin/uc-1-3-roster-dep-failed.png` | dep-failed | 签到回写依赖不可用 |
| `ui-preview/org-admin/uc-1-3-roster-success.png` | success | 到场回写成功 |
| `ui-preview/org-admin/uc-1-3-roster-observer.png` | default · **observer** | 观察者只看**脱敏聚合到场数**：隐藏姓名明细 / 链接 / 二维码，保留 n/m 计数（这个「脱敏聚合」的具体尺度是原型 agent 定的，见第四节） |
| `ui-preview/org-admin/uc-1-3-roster-observer-denied.png` | **特殊态：观察者拒绝面** | 观察者点开名单明细时的拒绝面——演示「只读不是靠前端隐藏，是服务端判定拒绝」。⚠ 它与 `-observer` 是一对：前者是**看得见的部分**，后者是**看不见的部分长什么样** |

### 3.3 UC-1.4 —— 屏「四视角判定」（R8 载体一）· 7 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-4-roles-facilitator.png` | default · **facilitator** | 全权限视角 + **角色说明条**「顾问 · 能源组 ｜ 本项目：组长 · 第 2 组」（= 2.2 #12）+ 常驻的 `roles-single-source-note`（X-1 单一判定声明）+ 差集断言原文 |
| `ui-preview/org-admin/uc-1-4-roles-grouplead.png` | default · **groupLead** | 组长恰多 `[提交本组产出]` |
| `ui-preview/org-admin/uc-1-4-roles-member.png` | default · **member** | 组员有且仅有 `[举手]` |
| `ui-preview/org-admin/uc-1-4-roles-observer.png` | default · **observer** | **按钮集为空**——UC-1.4 AC3 / V3 的界面证据，这张是本屏最关键的一张 |
| `ui-preview/org-admin/uc-1-4-roles-denied.png` | denied | 无项目角色（R4 E3） |
| `ui-preview/org-admin/uc-1-4-roles-dep-failed.png` | dep-failed | 鉴权服务不可用（R4 E4）——⚠ 演示**失败时收紧而非放行** |
| `ui-preview/org-admin/uc-1-4-roles-invalid.png` | invalid | 角色数据不一致（R4 E6） |

### 3.4 UC-1.4 —— 屏「临时提权」（R8 载体二）· 4 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-4-grant-default.png` | default · facilitator | 授予入口三步：**选人 → 选资源 → 选失效环节** + 审计留痕行（R3 第 6 步） |
| `ui-preview/org-admin/uc-1-4-grant-confirm.png` | **特殊态：授予二次确认** | 明示**失效环节**与影响范围再落笔——对应 I-28「按议程环节失效」。⚠ 该环节锚点在 06-现场协作，本束外 |
| `ui-preview/org-admin/uc-1-4-grant-denied.png` | denied | 非引导师无授予权（R5） |
| `ui-preview/org-admin/uc-1-4-grant-empty.png` | empty | 当前无任何生效中的临时提权 |

### 3.5 UC-1.4 —— 屏「管理员边界」（R8 载体三 / D-18）· 3 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-4-boundary-default.png` | default | 三区一屏：**个人层只有计数**（内容不可见）· **项目层可读但留痕** + `[看我的访问记录]` · **「谁读过我的项目」**（项目负责人视图，屏上自标「需补原型」）。这是 D-18 两侧**首次同屏出现** |
| `ui-preview/org-admin/uc-1-4-boundary-loading.png` | loading | 审计数据加载态 |
| `ui-preview/org-admin/uc-1-4-boundary-dep-failed.png` | dep-failed | 审计服务不可用——⚠ 演示**审计不可用时不放开读权** |

### 3.6 UC-1.6 —— 屏「成员与配额」· 11 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-6-members-default.png` | default | 48 位成员 · 活跃 41/48 · 配额条 · **双人复核待批队列**（`members-approval-queue`，标「发起人不可自批」）· 成员行（角色/团队/配额/状态/`[移除]`）· **待激活 4 行**分别演示「已发送 2 天 / 发送失败 / 已过期 / 已撤销」且行内有 `[重发]` `[撤销]` · 团队区（标「增删改 · 需补原型」+ `[新建团队]`） |
| `ui-preview/org-admin/uc-1-6-members-empty.png` | empty | 尚无成员 |
| `ui-preview/org-admin/uc-1-6-members-invalid.png` | invalid | 邀请输入校验失败 |
| `ui-preview/org-admin/uc-1-6-members-dep-failed.png` | dep-failed | 邮件 / 配额依赖不可用（E6） |
| `ui-preview/org-admin/uc-1-6-members-denied.png` | denied | 非管理员访问「成员与配额」（E2） |
| `ui-preview/org-admin/uc-1-6-members-success.png` | success | 邀请发出成功回执 |
| `ui-preview/org-admin/uc-1-6-members-invite.png` | **特殊态：邀请成员弹层** | 邮箱 + 角色三选 + 团队下拉（= 2.2 #15，原属「原型待补」） |
| `ui-preview/org-admin/uc-1-6-members-invite-admin.png` | **特殊态：邀请管理员 → 双人复核** | **不可自批**；并把 O-28 ⑥ 的边界写在界面上：「仅一名管理员时转待批队列（需平台运营方协助），不退化为单人可批」 |
| `ui-preview/org-admin/uc-1-6-members-quota-block.png` | **特殊态：配额用尽硬阻断** | 按钮 disabled + 红条 + **直达「去调整配额」**——演示 O-29 ⑤「阻断必须伴随可执行下一步」，且是**事前阻断**不是点了才报错 |
| `ui-preview/org-admin/uc-1-6-members-remove.png` | **特殊态：成员移除确认** | 停用访问 · **保留署名标「已离职」** · 释放配额；弹层内明写「与授权撤回 UC-17.2 是两条不同路径，**不共用同一条代码**」（I-8 / I-34） |
| `ui-preview/org-admin/uc-1-6-members-team-delete-blocked.png` | **特殊态：删除团队被阻断** | 删除前占用校验：团队下仍有成员/资源时阻断（O-29 ④） |

### 3.7 UC-1.6 —— 屏「激活落地页」（R3 第 6 步）· 6 张

| 截图 | 状态 / 视角 | 这张在演示什么 |
|---|---|---|
| `ui-preview/org-admin/uc-1-6-activate-new.png` | **特殊态：新用户分支**（R3 6a） | 免登独立居中卡片（**不套后台三栏**）· 设姓名 + 密码 · 链接有效期 7 天。⚠ 「7 天」目前**不在 `AUTH_POLICY` 单一事实源里**，由 mock 的 `ACTIVATION_CONTEXT.linkValidDays` 承载——第二份副本的温床 |
| `ui-preview/org-admin/uc-1-6-activate-existing.png` | **特殊态：已有账号分支**（R3 6b / O-12） | 同一链接落到已有账号：**加入组织而不新建账号**——与 `-new` 是同屏两分支，不是两块屏 |
| `ui-preview/org-admin/uc-1-6-activate-invalid.png` | invalid | 链接失效**统一提示**（已用 / 过期 / 已撤销 / 不存在四种情况文案完全相同）——**防枚举**，对应 V10 |
| `ui-preview/org-admin/uc-1-6-activate-loading.png` | loading | 令牌校验中 |
| `ui-preview/org-admin/uc-1-6-activate-dep-failed.png` | dep-failed | 激活依赖不可用 |
| `ui-preview/org-admin/uc-1-6-activate-success.png` | success | 激活完成 |

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

---

## 五、第 ① 件材料缺口（原设想里有、实际没截到的）

> **这一节存在的唯一目的是：不让「48 == 48」这个好看的数字掩盖没画的东西。**
> 第三节的 48 张是**实际拍到的**，本节 14 条是**实际没拍到的**。
> ⚠ 本节条目**不含任何截图路径**——它们在磁盘上没有文件，所以不影响顶部的 N == M 自检。
> 谁要是为了让数字更好看而把下面某条挪进第三节，那就是造死链。

### 5.1 已建成、但本轮**有意跳过**的六块真实屏（原型 agent 明示取舍，非遗漏）

- **K-1** ⚠ 未产出：`/join` 链接落地页（默认态 · 手机号 + 验证码 + 掩码回显）—— 该屏尚未画。
  原设想 6 张（`-default` `-wrong-group` `-not-listed` `-apply-pending` `-reconnect` `-dep-failed`）全数为零。
  组件 `entry/join-form.tsx` **已建成并接线**，跳过理由是「已有原型不重画、免造第二套」。
  ⚠ 但**已建成 ≠ 已被人看过**：F12/F13 合计 6 点的界面证据目前只能靠现场起 dev server 看。
- **K-2** ⚠ 未产出：`/group` 小组工作台（组员 / 组长 / **观察者按钮集为空** / 空态四张）—— 该屏尚未画。
  ⚠ 其中 `?as=observer` 那张是 **AC3 在 `/group` 侧的界面证据**；本轮只在 `uc-1-4-roles-observer`
  拍到了**原型屏**的空按钮集，**真实已建成屏**的那张仍缺。
- **K-3** ⚠ 未产出：`/consent` 受访者同意书 · 撤回同意全流程（含「我已了解影响范围」勾选）—— 该屏尚未画。
  跳过理由：F14 属 UC-17.2 合规最小切片，不在 org-admin 的邀请激活链路里。
- **K-4** ⚠ 未产出：`/session` 受访者会话 · 四项独立授权 + 撤回入口 —— 该屏尚未画。同 K-3。
- **K-10** ⚠ 未产出：`/admin/members` D-18 边界说明区 / `[看我的访问记录]` 展开态 / `denied` 态三张 —— 该屏尚未画。
  ⚠ **不要把它和 `uc-1-4-boundary-*` 混为一谈**：后者是新画的 **mock 原型屏**，前者是**已经在跑的真实屏**
  （`admin-members-boundary` `admin-members-my-access` 等 testid 都在代码里）。
  两者现在**各说各的 D-18**——这正是「同一事实两处声明」的早期形态，签核时应裁定哪一处是唯一载体。
- **K-11** ⚠ 未产出：`/admin/{agent,skill,model,mcp}` 资源可见性徽标（全组织可用 / 仅某团队）
  ＋ MCP 的**另一套**授权范围枚举 —— 该屏尚未画。
  ⚠ **F07 整条 feature 目前零截图**：`scope-badges.tsx` 已建成，但没有任何图能证明
  「MCP 的授权范围没有被合并进团队可见性」这条硬约束在界面上真的成立。

### 5.2 原设想里有、原型也确实没画的

- **K-5** ⚠ 未产出：设置 → 设备与会话（设备 / 地点 / 最后活跃 / `[踢下线]`，2.2 #19）—— 该屏尚未画。
  ⚠ **本条不建议直接补图**：30 天 / 设备指纹 / 踢下线三项全部出自 `[Backlog]`，
  uc-1-1 R8 原文「**在补画并裁决前不得当作已确认需求实现**」。⇒ 先裁需求依据（见 `coverage.md` 缺口 1），再画。
- **K-6** ⚠ 未产出：**撤销待激活的组织邀请**的二次确认弹层（2.2 #17）—— 该弹层尚未画。
  `uc-1-6-members-default` 行内 `[撤销]` 按钮已渲染，**点开之后是什么没有图**。
  ⚠ 别拿 `uc-1-3-invites-revoke` 顶替：那是**分组邀请链接**的撤销（作用于令牌），
  与**组织成员邀请**的撤销是两个不同对象、两套影响范围。
- **K-7** ⚠ 未产出：团队**新建 / 编辑**弹层（2.2 #18 的「增」与「改」）—— 该弹层尚未画。
  只有 `uc-1-6-members-team-delete-blocked` 覆盖了「删」。团队区块自己在界面上标着「需补原型」。
- **K-8** ⚠ 未产出：临时提权的**按时间失效**与**手动提前收回**入口（UC-1.4 R4 A2 `[待确认]`）—— 该交互尚未画。
  `uc-1-4-grant-*` 只画了按流程节点失效。若产品要这两种补充失效方式，需补交互后重截。
- **K-9** ⚠ 未产出：**项目负责人**视角下的邀请撤销权（UC-1.3 R5 留问号）—— 该视角尚未画。
  预览器只有四个**项目角色**（`?as=facilitator|groupLead|member|observer`），
  项目负责人是**组织角色**，落不进这条轴。⇒ 撤销这个「链接外泄唯一止血手段」到底谁能按，
  在界面上无证可看，需产品先裁。

### 5.3 已截到、但覆盖不完整的

- **K-12** ⚠ 未产出：部分屏的部分状态 —— 七态**未截齐**。逐屏差集如下（只有 `invites` 是满的）：

  | 屏 | 已截 | 缺 |
  |---|---|---|
  | 参与者与邀请 | 七态齐 + grouplead + revoke + reset | — |
  | 分组与签到 | default / loading / empty / dep-failed / success | **invalid · denied**（有 `observer-denied`，但那是观察者面，不是通用 denied） |
  | 四视角判定 | 四视角 + denied / dep-failed / invalid | **loading · empty · success** |
  | 临时提权 | default / empty / denied / confirm | **loading · invalid · dep-failed · success** |
  | 管理员边界 | default / loading / dep-failed | **empty · invalid · denied · success**（⚠ 缺 `denied` 尤其可疑：一个讲权力边界的屏没有拒绝面） |
  | 成员与配额 | default / empty / invalid / dep-failed / denied / success + 5 个特殊态 | **loading** |
  | 激活落地页 | new / existing / invalid / loading / dep-failed / success | **empty · denied**（此屏免登，二者可能本就不适用 —— 需确认是「不适用」还是「漏了」） |

- **K-13** ⚠ 未产出：移动端 375 / 768 两档 —— 该视口尚未截。全部 48 张都是 1360 宽桌面图。
  ⚠ uc-1-2 R9 明确要求移动端保证现场关键动作，而**现场组员基本都在手机上**；
  本束的移动端缺口权重高于其它束。
- **K-14** ⚠ 未产出：二维码本体 —— `[二维码]` 在 `uc-1-3-roster-default` / `-invites-default` 上是**占位**，
  点击只弹 toast，不真出图（服务端 / 前端生成方式 UC-1.3 R10 `[待确认]`）。

### 5.4 签核时怎么用这一节

第 ① 件**可以签**，但签的是**有边界的一件事**。请人类在签核时明确回答两问：

1. **48 张覆盖的三个 UC（1.3 / 1.4 / 1.6）的界面，对不对？** —— 这是第三节的事。
2. **K-1 ~ K-14 这 14 条，本次是「接受不看、留到开工后补」，还是「必须先补图再签」？** ——
   ⚠ 其中 **K-11（F07 零截图）** 与 **K-10（D-18 两处载体打架）** 建议**不要顺延**：
   前者让 F07 完全没有界面证据，后者是一个**已经发生的双声明**，越晚裁越贵。
   **K-5** 则相反，它应当**先裁需求、后画图**，顺序反了会把 Backlog 当成已确认需求做进去。
