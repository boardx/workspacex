# 七角色与 W029 实际浏览器验收

第14轮：源版本 `c13426a18eabc09f7ed8412181fc254bfab0aae4`，2026-10-01，北京时间。真实 Chromium → 生产 Next → Nest → 隔离 PostgreSQL/Redis；上游明确使用本地测试服务。2/2 PASS、0 skipped、0 flaky。完整真实模型质量、devapp与实时音频未由这一轮验证。

## 实际通过范围

后台实际导入依赖与角色、刷新后目录；成员七角色独立头像/详情；详情与聊天列表按实际发布角色 pins/pending 精确限制；候选选项禁用且计数准确、无其他组织技能回退。逐角色实际创建独立线程、发送消息、AGUI执行、服务端保存及刷新准确读回。通用临时技能→切产品经理→实际DELETE→API重读与刷新无遗留。

W029 v2实际填写业务输入、授予权限、四次实际审批、十六阶段执行；实际产物与通知回执各1条finalized，PRD打开并刷新。未拦截API成功响应，未伪造Workflow阶段或回执。角色回复来自明确的测试上游，不能用于判定身份/专业回答质量。

| 角色 | 可用 Skill | 待验证 Skill | 背景/详情 | 实际 Skill 列表 |
| --- | ---: | ---: | --- | --- |
| D001 高管与战略伙伴 | 0 | 12 | [详情](screenshots/6a-D001-background-detail.png) | [列表](screenshots/D001-skill-list-panel.png) |
| D002 研究与知识分析师 | 0 | 10 | [详情](screenshots/7a-D002-background-detail.png) | [列表](screenshots/D002-skill-list-panel.png) |
| D003 产品经理 | 0 | 14 | [详情](screenshots/8a-D003-background-detail.png) | [列表](screenshots/D003-skill-list-panel.png) |
| D005 销售代表 | 0 | 14 | [详情](screenshots/9a-D005-background-detail.png) | [列表](screenshots/D005-skill-list-panel.png) |
| D006 客户成功专员 | 0 | 10 | [详情](screenshots/10a-D006-background-detail.png) | [列表](screenshots/D006-skill-list-panel.png) |
| D007 项目与运营经理 | 0 | 10 | [详情](screenshots/11a-D007-background-detail.png) | [列表](screenshots/D007-skill-list-panel.png) |
| D011 设计思维专家 | 0 | 9 | [详情](screenshots/12a-D011-background-detail.png) | [列表](screenshots/D011-skill-list-panel.png) |

79项直接绑定均待验证，0项可用；未提升verified来使测试通过。目录的英文卡片是显式合成测试fixture。完整销售流程/CRM仍DEFERRED。

## 截图审查追加缺陷

这一轮发现待验证Skill显示裸编号，以及详情错误声称“能力都已开通”。对应修复已整合，新增中文标题/就绪说明浏览器断言待下一轮验证；本轮截图仍保留原事实，不算可用性验收完成。

## 证据

- [执行摘要](execution-summary.json)、[实际坐标与保存记录](persisted-evidence.json)、66张合成测试截图。
- scope准入17项（9实际PG、8队列替身）、升级13项（4实际PG、其余用例/控制器）、详情/选择器/共享弹层29项、模型上下文捕获8项、原生工具快照7项、continuation6项通过；仅各自技术边界。
- 原始trace包含临时认证，保留本地私有证据，不提交。公开材料仅合成截图、允许字段JSON及脱敏日志。
- SCOPE-01七角色列表技术PASS。真实IDENT专业质量BLOCKED；其他覆盖不全场景保留NOT_RUN，不能把2条测试扩张成全部656项或全部200Skill已通过。
