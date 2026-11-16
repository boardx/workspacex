# 覆盖与真实验收边界

| FR01验收 | 用例 | API/既有能力 | 证据要求 |
|---|---|---|---|
| 建立课程 | C1 | 新create/listCourse | 数据库存储、幂等、新登录可读；源码实现；内存/组件已验，PG/新登录待验 |
| 课程→小组受约束关系 | C2 | 新link/listCourseGroups + FK | 同org/general/一组一课；不得用自由tags代替 |
| 成员关系 | C3/C5 | 既有Project collaborators + membership projection | 真实添加/读取及逐请求授权；不复制权限表 |
| 进入所属组、重新进入 | C3 | 课程读取→现有AIDT project路由 | 新登录/重启后的同Project与已保存revision |
| 不同组隔离 | C4/C6 | 既有Stage/Chat/资源授权 + 新映射只做投影 | 两真实普通账号、跨组URL/API拒绝，无元数据泄漏 |
| 默认模块隔离 | C6 | AIDT flags/route guard | 普通模块未开启AIDT时无课程UI或新服务调用 |

阶段一可独立交付：现有真实成员小组入口优化，使用完整 `/projects` AIDT profile候选及真实 `/collaborators` 成员名单，捕获bearer、分批4项；仅实际在册者展示，不制造课程。新loader/组件需要本轮U/C及A6原生新登录验证。

阶段二：用户已明确批准方案A，已写正式Zod契约、controller、RLS migration与课程UI。33项后端内存/协议/捕获SQL用例及前端定向用例通过（最新计数见fr01-course-entry日志）；不将这些当成PG或真实浏览器验收。FR01课程端到端仍待A6隔离栈验证；批准来源见design-signoff.md，未代理修改其frontmatter。
