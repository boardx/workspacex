# ③ API/迁移设计（方案A已获会话批准，真实验收中）

运行时单源为 `packages/contracts/src/aidt-courses.ts`；这里是同束审阅说明，实际输入输出以Zod为准。共用现有API进程、认证principal、org事务/RLS、Project成员仓储与apiRequest；不建服务/账号/聊天/小组引擎。

| 操作 | 严格输入 | 成功输出 | 拒绝与幂等 |
|---|---|---|---|
| GET `/aidt/courses` | `cursor?:string,limit?:int(1..50,默认20)`；org/actor仅principal | `{items:[{id,name,createdAt}],nextCursor:string|null}` | 普通actor仅见实际所属组关联的课程；lead/admin可见登记元数据；不返回无权小组或计数 |
| POST `/aidt/courses` | `{name:string(1..120),operationId:UUID}` | `{course:{id,name,createdAt},replayed:boolean}` | 当前lead/admin才能创建；org/actor/op唯一；同op不同name为409；id/作者/时间由server生成 |
| GET `/aidt/courses/:courseId/groups` | 路径courseId及同上分页 | `{course:{id,name,createdAt},items:[{project:ProjectListItem,members:[{userId,displayName}]}],nextCursor:string|null}` | 只投影真实在册的组，按现有Project成员授权逐组投影，不复用截断的home previews；课程不可见时404 |
| PUT `/aidt/courses/:courseId/groups/:projectId` | 路径两个id，空body | `{courseId,projectId,replayed:boolean}` | lead/admin且真实group owner；同org/general/AIDT profile/active核对；相同关联重放；属于另一课程409；不造项目、不增成员 |

**共4个操作、3条资源路径。** 错误：`AIDT_COURSE_NOT_FOUND`404（不存在/无权合一），`AIDT_COURSE_FORBIDDEN`403（已知创建操作能力不足），`AIDT_COURSE_GROUP_CONFLICT`409，`AIDT_COURSE_OPERATION_CONFLICT`409，`AIDT_COURSE_INVALID`400，`AIDT_COURSE_UNAVAILABLE`503。模块关闭时在路由边界404。错误不附未授权当前记录。

## 实现位置与验证边界

- `apps/api/src/application/aidt-courses`：list/create/listGroups/linkExistingGroup；每次以principal查现有组织角色和Project成员，不接收客户端actor/role/org授权声明。
- `apps/api/src/infrastructure/aidt-courses`：两表存储；复用既有事务port，link的归属检查和INSERT在同一事务，竞争由唯一键兜底。
- 一个受ENABLE_AIDT_MODULE约束的controller；仅AIDT路由前端adapter消费。普通Project/Workshop/Chat无新增引用。
- 正式迁移为 `apps/api/migrations/20261116093000_aidt_courses.sql`：同org FK/唯一约束、FORCE RLS、org冻结、归档组写入限制、app_rw最小授权；[migration-review.sql](migration-review.sql)保留批准前设计快照。PG实际执行与重放仍待隔离栈验收。
- 首版不提供课程内新建Project的“伪事务”。UI先用已有AIDT新建小组，再明确关联；关联失败保持真实小组可重进。新增course不会给任何人发邀请或改角色。

正式实现固定每页默认20、上限50，使用上次服务端返回的nextCursor；null表示本次范围读完。课程和小组均分页，服务端不一次加载无界组织。前端须区分载入、失败、真实空态、无权和更多页，不能把首屏当全量。
