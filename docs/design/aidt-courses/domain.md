# 领域与复用边界（待签核）

## 已存在的事实

- `packages/contracts/src/project.ts`：ProjectKind只有workshop/general；列表tags是自由文本，契约明确不含父子Project。`createProject`保存真实Project，已有general_project_members保存owner/collaborator。
- `templates.getProjectGrouping/updateGrouping`：Workshop内分组，同一Project内编排。它不创建子Project；`getProjectGrouping`对已有项目成员公开内部全量分组。
- `aidt-stages`以org/project/stage/revision隔离，Chat共享阶段材料只接受plenary且group_id为空的同Project附件。因此把Workshop当课程、其groups当AIDT小组会把组六步状态合并，不能复用为FR01的隔离关系。
- `project.getHomeProjectPreviews`只返回actor成员项目，但实际controller只扫描前8项、最多6项且排除归档组，不能当完整小组目录。当前入口须使用完整Project列表及已授权collaborators读取，分批4项；课程关系不存在前，不从名称/tag猜课程。

## 新的最小关系

Course是仅AIDT的组织内登记实体，不是新ProjectKind。CourseGroup把一个现有general Project关联到一个课程；该Project仍是独立数据与授权边界。课程“学生成员”是CourseGroup JOIN general_project_members的当前投影，不复制另一份成员权限表。

不变量：

1. 课程与小组必须同org，且小组必须是实际general Project；复合FK在数据库强制，不依赖UI或自由标签。
2. 同一小组最多一个课程，数据库唯一键约束。首版不提供跨课程搬移/解除绑定/删除课程；避免悄悄改变历史学习归属。后续若需要须单独设计。
3. lead/admin可以创建及管理课程登记；关联已有组时还须是该组当前owner。该权限提案须人类确认，不能从“管理员”一词推导超级权限。
4. 管理课程不授予组数据读写。课程组列表仅返回actor当前在册的组；老师要读/点评某组，仍须被原生Project成员功能明确加入该组。成员增删继续原生授权，不自动批量修改。
5. 普通成员只有当其属于已关联组时能读取该课程的元数据；无关课程GET表现为404，不能借课程ID探查其他组。lead/admin可见课程登记，不附带无权组名、人数或成果。
6. 成员移除/组织切换下一请求立即生效；不能用课程列表缓存恢复已撤回的组权限。新登录只回读服务器关系。
7. AIDT的tag仅标识入口profile，不是成员/课程权限。关联时核对profile；若之后被管理者改掉，显示类型待核对，不自动改tag或擅自解绑。
8. 创建/关联由学生或管理者明确操作，失败保留输入。创建重试的operationId同actor/org下幂等；同ID不同内容冲突。PUT相同关联返回replayed，不重复建Project。

风险：一组一课程与最小管理授权是本提案的显式选择；不支持独立课程注册、多个教师角色或跨课程共享组。上述扩展不可偷偷以自由标签、localStorage或浏览器权限判断实现。
