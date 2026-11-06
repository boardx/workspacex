---
name: mod-org-identity
description: >
  身份/组织/权限模块的活知识库：identity、auth、org-admin、security。动手改
  登录/会话、鉴权守卫、组织后台或安全相关逻辑之前必读——这是全站权限判断的
  唯一权威落点，任何模块新增鉴权都应复用这里而不是另起一套。
---

# 身份/组织/权限（mod-org-identity） — 模块知识库

> 本文件是 org-identity 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载登录/会话/鉴权（identity/auth）、安全守卫（security）与组织后台
（org-admin）——是全站"谁能做什么"的唯一权威落点。

## 代码地图
- 页面：`apps/web/app/(entry)`（`join`/`auth`/`group`/`consent`/`login`/`session`）、
  `apps/web/app/org-admin`（`org-admin/preview`）、`apps/web/app/admin/[module]`
- API 领域：`apps/api/src/application/{identity,auth,security,org-admin}`
  （对应 `apps/api/src/{infrastructure,domain}/{identity,auth}`）
- 鉴权守卫：`apps/api/src/interface/guards`、`apps/api/src/interface/middleware`

## 关键契约与不变量（改代码前必读）
- **鉴权顺序**：新端点必须逐行复用 `apps/api/src/interface/guards` 里既有实现，
  禁止另起一套——这是全站唯一权威落点，其他模块（chat/canvas/research 等）的
  鉴权判断也应该复用这里，不要在各自模块里重新实现一遍判断逻辑。
- <会话/consent 的生命周期状态机——待核实，`apps/web/app/(entry)/{consent,session}`
  是入口，具体状态流转看代码不要猜>
- <公开面/未登录可达的页面与端点清单——待核实，任何改动过一遍未授权视角>

## 架构知识
这是全站鉴权的"上游"模块——[[mod-chat]]、[[mod-asset-artifact]]、
[[mod-research-studio]] 等所有模块的权限判断理论上都应该收敛到这里的 guards，
而不是各自维护一份判断逻辑（这正是本仓"单一事实源"原则在鉴权领域的应用）。
外部参照：WorkOS/Clerk 这类身份产品把"组织×成员×角色"建模成独立于业务领域的
一层，本仓 `org-admin` 的角色划分可以对照这个思路检查是否有跟具体业务模块
耦合过深的地方。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；本模块几乎所有改动都算敏感 area，默认
   主动挂安全 review，不要等被要求。
3. 交付：`verify --sprint` 门控；PR 描述里写清对鉴权/权限面的影响面。

## 踩坑与经验（append-only，最新在上）
- 2026-11-06：组织邀请按人类要求取消复核，新邀请固定普通成员（consultant），邮件投递使用既有事务邮件端口；已有账号用 guarded accept 路由明确确认，单人邀请必须绑定 credentials 邮箱、共享链接重复加入不重复扣使用次数。企业成员默认月度 Credit 上限独立于 Token 配额，不发放钱包资金；未知成本调用预留余额度并在真实回执后检查，不能承诺回执间绝无超额（issue #6316；evidence/org-invitation-6316/）。
- 2026-11-06：组织导出清单须按同一应用连接的 PostgreSQL SELECT ACL 枚举可读租户表；org_id 外键不代表 app 可读，内部历史归档撤权后不得切特权账号、吞错误或伪报零行。保留普通租户表计数完整、active/disabled 管理员真实 HTTP 与跨组织归档拒读反例（issue #6290 / PR #6298）。
- 2026-11-04：排查 run 行锁要追到 `PgDatabase.inTx` 的 `currentRunLease` 隐式围栏，不能只看仓储显式 SQL；真实 PG 并发反例须带 `withRunLease`。run 键不变时用相容的 `FOR NO KEY UPDATE` 保持写者/租约接管互斥并允许计费 FK `KEY SHARE`；改锁后同时验证 takeover 等待提交、过期/旧 epoch 在执行事务体前被拒绝（issue #6235，`docs/evidence/chat-event-metering-deadlock-6235/`）。
- 2026-11-04：后台配额/用量说明先核对 canonical `apps/api/src/infrastructure/auth/pg-token-quota-repository.ts` 聚合及 F159 迁移，不从调用失败推导 Token 为零；通用错误文案复用 `apps/web/lib/design-failure.ts` → `http-failure-text.ts`，语义反馈回调在渲染时接收当前 locale。对应反例与回归：`apps/web/tests/ui/admin-member-quotas-i18n.test.tsx`、`ai-usage-i18n.test.tsx`（issue #6212）。
- 2026-11-04：组织工作流授权的长文案会同时造成纵向按钮不可达和撤销页横向裁剪；保留共享弹窗边界，在页面所属容器提供滚动、footer 允许换行，并用真实 wheel + Confirm/Cancel 完整入屏断言验收。控制值、API 与权限不随显示修复变化（issue #6207；`evidence/workflow-grants-i18n-6207/browser-first/`、`browser-second/`、`final-run/`）。
- 2026-11-04：首页配置采用保留挂载状态的标签页时，原生 `hidden` 与无条件 Tailwind `flex` 会发生样式覆盖；应按当前页切换 `flex` / `hidden` 并真实断言非活动面板不可见。只跑完成主链的浏览器绿灯不能替代逐屏截图检查（issue #6204；`evidence/org-home-config-i18n-6204/visibility-red/`）。
- 2026-11-03：契约 mock 再生成的字节同步不能证明样例有效；新增 schema 类型时需以真实响应 safeParse 校验生成样例，判别联合缺生成支持会默默产出 null（issue #6145）。
- 2026-11-03：strict 事件响应新增展示元数据需显式版本协商并保留旧摘要回退；query 校验复用 ZodBodyPipe，裸 schema.parse 的 ZodError 不会自动成为400。白名单投影与真实新旧HTTP证据见 issue #6145 / evidence/i18n-activity-6145。
- 2026-11-03：成员/邀请的真实路由在 `org-admin-screen.tsx`，同名 `members-screen.tsx`/`roster-screen.tsx` 是预览；国际化不能只改预览。角色标签复用共享 `role.*` 字典，错误/反馈保留原始载荷并在渲染时翻译，locale 不进入读取 effect 依赖，避免语言切换重发请求（issue #6179）。
- 2026-11-02：验证邮件重发不能只依赖24小时注册cookie；过期/换浏览器恢复须先复用登录密码校验与锁定规则，再将可信userId传入事务重发，保持challenge→credential锁顺序、限频与旧链接原子失效；API存活不证明发信配置完整（issue #6085）。

- 2026-11-02：成员加入容量检查必须在同一真实事务内先取计费 epoch 共享锁、再锁组织行，然后读 canonical 商业许可并数实际 membership；新账号创建会触发赠送钱包，因此项目邀请的容量检查要放在 `INSERT credentials` 之前，避免钱包→组织的反向锁序。单邀须在组织锁之后锁定权威邀请，再条件核销 token；重发同样先邀请后 token，避免反向锁序。单邀、共享组织邀、项目邀三个实际写入入口复用 `infrastructure/org-capacity/pg-commercial-capacity.ts`；项目纯来宾不写组织 membership。真实末席跨连接反例与失败零副作用证据见 `evidence/org-capacity-6107/`（issue #6107）。
- 2026-10-07：现有账号创建组织必须独立于匿名注册；幂等 key 绑定认证用户，组织/管理员成员/系统 Agent/收据共用同一 `withTenant` 事务。套餐缺省保持未配置，不继承来源租户预算/模型；会话列表须在存储锁内合并最新版本避免并发响应覆盖（issue #5494；`evidence/org-create-5494/README.md`）。
- 2026-09-15：反馈正文 D3 遮蔽后，收件箱侧表标签合并仍可能重新暴露提交人自由文本；共用 `applyTags` 必须保留 `body === null` 的既有披露结果，在标签筛选和 byTag 计数之前清空标签。只测 listFeedback 输出不足，必须覆盖最终 Inbox 列表、私有/共享标签过滤与计数、归档视图（issue #3633）。
- 2026-09-13：注册入口验收须分别走组织自助注册、单人邀请 `?t=` 与共享邀请 `?lt=`；邀请激活曾调用会话存储却丢弃返回的 bearer，仅回传不能认证的 sessionId，导致完成页仍要求登录。交付应验证标准会话 hydrate、正确组织与刷新持久，且不得覆盖已有/并发切换的账号；会话签发在 PG 激活提交之后，失败不能承诺邀请未消费（出处：issue #3600，前序修复 #3596 / PR #3599 的漏覆盖）。
- 2026-09-13：邮箱确认的 `completed` 包含幂等重放，不能据此签发会话。注册自动登录仅接受本次原子核销且匹配当前浏览器 HttpOnly pendingVerification proof 的 challenge；签发复用 `issueAuthenticatedSession`，返回标准 bearer，由 SessionProvider 持久化。跨浏览器、已登录与重放只确认邮箱，签发失败后用正常登录恢复，不能重新兑换已消费链接（issue #3596）。
- 2026-09-02：成员管理分两级——组织级 `PATCH /organizations/:orgId/members/:userId/role`（组织 admin）与平台级 `GET|PATCH /platform/members…`（`PlatformSuperuserGuard`，env 白名单）改的是同一列，「最后一名 admin 不可降级」的判定只有一份（`domain/auth/org-role-change.ts`），且必须与 UPDATE 同一事务、先 `FOR UPDATE` 锁 admin 行再数——事务外先数后写会让两名 admin 并发互降剩零 admin。平台级名册**不要**新造整表 SECURITY DEFINER 函数（`app_rw` 可调 = 没有隔离，见 `20260902012105` 迁移头注三次教训），拼既有的 `credentials` + `kernel_user_org_ids` + `withTenant` 三段读即可。`NOT_PLATFORM_SUPERUSER` 此前从未登记进 `all-exceptions.filter.ts` 的闭集，guard 抛的 403 到前端其实是裸 `forbidden`——现已随 `platformMembers.PlatformMembersError` 接入。（出处：分支 `claude/member-management-two-level-v7ymax`；待裁缺口 `orgAdmin.KNOWN_CONTRACT_GAPS.OA13`：改角色提升 admin 未走邀请路径的双人复核）

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
