# 七角色与 W029 实际浏览器验收

第16轮：源版本 `ec3e4ae73033afe98c755eb312a1711644ab0778`，2026-10-01 12:28:37 UTC（北京时间20:28:37）开始，耗时10.6分钟。真实 Chromium → 生产 Next → Nest → 隔离 PostgreSQL/Redis；三个project **3/3 PASS、0 skipped、0 flaky**。上游明确使用本地测试服务；真实模型专业质量、devapp及真实供应方音频不由本轮证明。

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

## 可用性复验与本地语音技术证据

第14轮发现裸编号标题和错误“能力都已开通”提示；第16轮真实七角色详情/聊天已复验中文名称、精确skills和按pending数量说明暂不可用。79项直接绑定仍待验证，不因此宣称专业能力全部开通。第15轮打断动作过短的失败保留为历史失败，不回填PASS。

| 本地真实浏览器语音技术项目 | 第16轮实际证据 | 边界 |
| --- | --- | --- |
| 登录握手与固定模型 | 3个WebSocket会话，固定 qwen3.8-omni-flash-realtime，全部连接最终关闭 | 本地测试上游，非真实vendor连通 |
| 麦克风二进制上传 | 61 binaryFrames、181292 bytes | 真实浏览器采集链，非供应方理解质量 |
| 原生音频播放 | 12次native playback start、57408个nonzero samples | 非真实供应方声音/专业背景质量 |
| 打断与关闭资源 | cancel=1，最后2条tracks ended、4个contexts closed，全部连接关闭 | 仅本地技术通过；七角色真实双向语音/故障恢复仍BLOCKED |

语音4张新增截图见 screenshots/ 目录；VOICE-01–05正式vendor场景保持BLOCKED，不能以本表覆盖。

## 证据

- [执行摘要](execution-summary.json)、[实际坐标与保存记录](persisted-evidence.json)、[70张合成测试截图目录](screenshots/)（含4张新增语音截图）。
- scope准入17项（9实际PG、8队列替身）、升级13项（4实际PG、其余用例/控制器）、详情/选择器/共享弹层29项、模型上下文捕获8项、原生工具快照7项、continuation6项通过；仅各自技术边界。
- 原始trace包含临时认证，保留本地私有证据，不提交。公开材料仅合成截图、允许字段JSON及脱敏日志。
- SCOPE-01七角色列表技术PASS。真实IDENT专业质量BLOCKED；其他覆盖不全场景保留NOT_RUN，不能把3个project通过扩张成全部656项或全部200Skill已通过。
