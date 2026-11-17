# FR01 课程与真实成员组入口

用户经 root 在本次会话明确批准“方案 A，继续实现”。批准来源和边界见 `docs/design/aidt-courses/design-signoff.md` 的决策记录；保留原 frontmatter，未代理签名。新能力仅 AIDT，默认关闭，不部署生产、不发真人邀请、不自动修改成员权限。

## 实现

- 真正课程登记与课程→既有 general Project 映射：四操作、两表、同 org 复合 FK、一组一课、FORCE RLS；当前 org lead/admin 创建课程，关联还要求原生小组当前 owner、AIDT profile 与 active 状态。元数据管理不赋予小组内容访问权。
- 后端每次从认证 Principal 重新读当前组织/小组成员，锁定授权输入；仅返回真实所属小组的组名和成员，不返回不可见组的名称或计数。使用现有 Project authorize/disclose 出口。当前移除 AIDT profile 的项目不再从课程组列表提供入口。
- `/aidt` 正式课程 UI 通过 API 保存、分页读取、创建幂等和明确关联；点击课程组仍进入原生 `/aidt/:projectId`。既有成员组入口保留，采用完整 `/projects` 加成员 roster 的分批 4 项读取，不用最多 6 个首页 preview 冒充全量。
- actor/org/token 生命周期改变时 host 重新挂载且立即隐藏旧内容；所有请求捕获 token、可取消、核对 request identity，旧课程/旧身份的迟到结果不会恢复到页面。失败显示重试，不宣称成功或空态。

## 已执行证据与边界

- `loader-red.log`：最初缺少 group loader 的真实红采集；不是课堂或真实服务验收。
- `role-lifecycle-red.log` / `role-lifecycle-green.log`：原生AidtHome父宿主的同actor/token组织角色降权3个真实组件反例先全红，修复后5文件48项通过。Home实际orgRole和Panel权限key均纳入生命周期，旧列表/组读取/保存请求销毁，迟到结果不恢复管理范围。不是后台真实账号撤权验收。
- `access-race-red.log` / `access-race-green.log`：当前课程组403后旧课程分页成功迟回的真实红→绿组件反例；修复后清授权上下文并取消旧请求，不将其算成课堂迭代。
- `backend-unit.log`：课程服务、Controller、SQL/迁移边界的定向测试（内存 port / 捕获 SQL，**不是 PG**）。当前3文件33项通过；不代表PG。
- `course-ui-targeted.log`：前端 client、group loader、课程组件及原入口/模块隔离的定向测试（组件/受控 API，**不是浏览器全链路**）。最新数量以日志末尾为准。
- `backend-typecheck.log` / `web-typecheck.log`：只选课程模块、测试及其 imports 的 scoped TypeScript；没有重跑全仓 build。
- `eslint.log`、`permission-paths.log`：定向 Web ESLint 和既有 guarded SQL 路径机械门。

scoped类型检查使用已入库配置 `apps/api/tsconfig.aidt-courses.json` 与 `apps/web/tsconfig.aidt-courses.json`，命令为 `node_modules/.bin/tsc --noEmit -p <配置>`。

A1 已通过既有 migrate-cli 在同一隔离 PG 应用 `20261116093000_aidt_courses.sql`，退出 0，随后 API health=200。这个状态只证明迁移/启动成功，不能代替真实建课、关联、跨组拒绝、新登录和重启后读回。Web 当前运行中的生产快照由 root 协调最终重建，A6 负责新课程 HTTP/浏览器/双身份验收；完成前不声明 FR01 端到端通过。

稳定 UI 锚点：`aidt-courses`、`aidt-course-name`、`aidt-course-create-save`、`aidt-course-<id>`、`aidt-course-link-project`、`aidt-course-link-save`、`aidt-course-project-<projectId>`。原 `aidt-project-<projectId>` 继续表示全部已加入的小组。

## 可复跑的轻量命令

```bash
# 在 apps/api
../../node_modules/.bin/vitest run --config vitest.aidt-course-unit.config.ts

# 仓库根，单 worker
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 apps/web/node_modules/.bin/vitest run \
  --config vitest.config.ts --root apps/web \
  tests/aidt-course-client.test.ts tests/aidt-course-context.test.ts \
  tests/ui/aidt-courses-panel.test.tsx tests/ui/aidt-course-entry.test.tsx \
  tests/ui/aidt-entry.test.tsx tests/aidt-module-boundary.test.ts \
  tests/ui/aidt-entry-isolation.test.tsx
```

## 独立真实课程验收准备（尚未实跑）

新增 `apps/web/e2e/aidt-v2-courses.spec.ts` 三场：真实UI建课与owner关联、同课双组隔离与新登录；归档组可读与新关联拒绝；真实服务cursor分页及浏览器offline失败/显式重试。复用A6既有同源API/建组/共享保存support，使用既有collaboration三种子账号的真实admin/consultant/admin角色，不造Teacher、不改orgRole。仅本spec合成新group显式添加现有student为collaborator；课程关联前后读取roster相等，不借课程自动授权。

`course-e2e-list.log`仅证明专属配置发现3场，不代表浏览器已跑；A6已给普通fullstack精确ignore本文件。`course-e2e-typecheck.log`在2GB人工heap上限下通过；先前把spec并入UI scoped检查时1GB上限OOM，原失败单独保留，未伪称成功。

运行使用A6安全wrapper `/tmp/run-aidt-v2-acceptance.mjs`、A1现有私密runtime路径与既有共享ledger（均不将凭据写回证据）。课程不reserve收费条目，不调用Agent/模型；必须等待root最终API/Web刷新与允许窗口。仅专属文件选择即可运行三场，不使用锚定完整title的grep。

## 统一回归回流：旧资源隔离fixture

Root最终82文件回归暴露 `aidt-resource-isolation.test.tsx` 的2红：旧测试只替身live-projects.listProjects，新Home已经通过真实apiRequest读取 /projects 与 /collaborators，因此fixture缺实际成员响应。原失败摘要为 `resource-fixture-before.json`（来源root统一回归，不冒充本agent另跑红测）。只补该test的API边界fixture并保留真正loader/filter：显式成员roster、空课程响应；所有原actor/org表单丢弃、迟到列表不恢复断言保留，另加旧请求aborted和admin非成员不展示反证。`resource-fixture-green.log` 3文件21项绿，其中该文件11项；没有改生产源或放松成员检查。

## 真实API回流：课程错误信封

在A1刷新后的真实API PID144538（Web尚未验）执行受限API-only预检：实际账号/组织/角色核对、GET课程、创建真实课程、相同操作编号重放前8项通过；不同输入的相同操作编号返回真实409，但body只有error/traceId，缺少合同声明的AIDT_COURSE_OPERATION_CONFLICT。原因是全局AllExceptionsFilter未登记新增封闭CourseError，controller-only单测未覆盖此层。脱敏真实失败为 `course-api-before-filter.json`，不是模拟PG。

Root授权最小Filter登记。新增真实Filter反例先6红/2绿（`filter-red.log`）；仅对已有CourseError enum safeParse后全部4文件41项绿（`filter-green.log`），未知码和debug/current/role仍剥离，HTTP状态语义不变。Raw既有FilesError已登记，A3确认两个未入合同的transport补充拒绝保留通用422，不添加任意字符串白名单。Filter修复后的真实HTTP重测等待A1刷新，不把单测绿当API预检全过。全程未调用模型、改orgRole或更改项目成员。

A1随后按既有机制再刷新API（PID148475、health200，PG/Python/旧Web保留），同一受限API-only预检实际17项全通过：真实建课/回读/同op重放/改输入409带正确封闭码、普通consultant建课403、未关联课程不构成学生入课、非成员课程组404，账号角色通过真实identity核对。证据 `course-api-after-filter.json`。未调用模型或修改组织角色/项目成员；此结果仍不替代新Web上的三场UI验收。

共享Filter原有普通路径另跑指定两文件：`all-exceptions-filter-error-log.test.ts` 6项、`all-exceptions-filter-headers-sent.test.ts` 2项，独立8项通过，日志 `shared-filter-regressions.log`。没有改原测试或普通策略；该结果和课程41项分列，不冒充全仓回归。

Root另要求仅以现有collaboration admin给A3合成primary组配置AIDT profile。真实登录200后发现该admin的Auth.orgs不含primary org，且组织不同，故在读取/写入目标tags之前停止；没有PATCH、跨org、改成员或角色。`primary-profile-scope-check.json`记录此拒绝边界，该组原状态保留。

## 首轮真实课程UI回流：同源路由缺失

在实际固定source7235b9cd、新Web25483上，独立三场均真实失败，0重试，浏览器已关闭；`course-ui-final-01-summary.json`保留结果。新建合成组/共享保存检查已在前两场执行，但到了课程入口时浏览器的 `/__fullstack_api/aidt/courses` 收到Next HTML404；第三场同源API helper也404。此前直接API17项通过不能证明Web代理已接通。没有改测试直连API掩盖问题。共享模型账本前后hash按summary记录，未观察模型发送。建组复用原生UI，既存P3缺provenanceEventId单列，未伪造receipt或修改公共schema。

Root授权最小补同源rewrite：精确3课程资源路径，以及已批准且原family真实可达的raw exact `/ingestion-runs/:ingestionRunId/content`（使controller静态覆盖与实际一致）。新课程配置反例先2红/1绿（`rewrite-red.log`），补修后含raw、原projects/report-files回归3文件10项通过（`rewrite-green.log`）；严格coverage/shadow/970合同路由均通过（`rewrite-coverage.log`），类型/ESLint通过。未增origin、访问权或宽 `/aidt/:path*`，原raw family保留。真实UI重测须等root提交新SHA、A1重build；此时仍不声明3场通过。

## 最终真实课程UI：4bfb三场通过

统一同源路由修复后，在真实source **4bfb82e268a618d57af25e5596a11ddc04cf38cf**、新Web25483运行原三场，**3 passed / 15.4s / runner exit0 / 0 retries**。完整安全索引 [course-final-index.json](course-final-index.json)，机器结果 [course-ui-final-02-summary.json](course-ui-final-02-summary.json)，三场实际attachments全文 [course-ui-final-02-attachments.json](course-ui-final-02-attachments.json)。旧7235上的三红 [course-ui-final-01-summary.json](course-ui-final-01-summary.json) 保留，没有改写成新SHA成功。

真实覆盖：UI建课及owner关联、原生成员名单前后不变；相同组第二课409；普通consultant建课/关联403；同课不同组隔离、admin非成员link/阶段读404；新登录回到原组并逐字读回原保存问题与revision；已关联归档组只读且原稿保留、新归档组关联403；课程和组cursor无重叠，21合成课程触发原生更多页；浏览器真实offline错误与明确重试。全部使用现有collaboration三账号，实际identity响应验证admin/consultant/admin；未造Teacher、未改组织角色。只给本spec新建组显式添加既有学生，课程关联本身不增员。

未观察模型发送，共享账本前后SHA256均为 `a12c648eacd3bf54a22d87c266273af290db6f972328109febc83b29b5c93806`。浏览器已关闭并明确释放A6作原件GET只读复验。此为合成技术验收，不宣称真人课堂、教师反馈或Agent上下文行为已验证；本spec没有自行重启运行时或部署生产。建组既存P3缺失provenanceEventId仍单列known gap，未伪造receipt或放宽公共schema。
