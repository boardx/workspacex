# 全量 Skills 前台与后台验收标准

状态：新增标准均 NOT_RUN。此文件是测试计划，不是通过报告。以本轮实际仓库全量登记清单为全集，每个 Skill 必须单独记录 stableId、发布 versionId、digest、schema、依赖、输入、runId、预期/实际、环境 SHA 和证据；只跑抽样或通用组件不能宣称所有 Skills 通过。

验收矩阵对应上级 acceptance-cases.csv 的 SKUI-01–16。每一行需按 Skill 展开，不以一条集成测试替代全量业务执行。没有 UI 操作的纯后台 Skill 明确记录该项不适用理由；执行和依赖项仍需验证。销售 Workflow/CRM 连接与完整销售任务 DEFERRED，D005 发现/详情/普通聊天继续验收；共享 Skills 不因销售流程延期而排除。

## 后台和成员标准

管理员：导入真实包并核对来源/版本；candidate 经真实评估、安全扫描和审核后发布；停用/启用刷新持久化；非管理员和跨组织操作拒绝；旧固定版本和历史运行不可变。

成员：中文名称发现/搜索、查看输入要求和能力边界；依真实 schema 输入参数；挂载精确发布版本、确认正文送达及实际执行分别有证据；错误详情与重试可定位；刷新和重登可恢复运行、回复和产物；预览/下载文件内容有效；待验证、版本缺失、停用明确禁用原因。七角色列表与已发布 pins/pending 精确相等，切换后不回退组织全量列表，不能用 workflow ready 声称全部 Skill 可用。

## 现有真实浏览器覆盖能力及限制

| 现有 spec | 可复用场景 | 尚不能据此宣布全量通过 |
| --- | --- | --- |
| digital-human-journey.spec.ts | 七角色启用、详情、精确 pins/pending 集合、切换清理、独立聊天和持久化 | 模型回环仅协议证据；本轮实际 available=0 的角色未证明专业 Skills 真执行 |
| skill-agent-import-usecase-audit.spec.ts | GitHub 真实导入、目录文件、编辑、后台试跑、斜杠挂载 | 特定素材与外网/凭据依赖；未遍历全量 Skill schema/输出 |
| core-journey-03-skill-lifecycle-chat.spec.ts | 导入→挂载→实际执行与唯一回复 | 旧标题“立即上线”须按当前 gate 事实核实，不能授权跳审核；单 Skill 不等于全量 |
| skill-review-gate.spec.ts | 提交扫描、双身份门禁、错误身份反证、启用持久化、草稿挂载拒绝 | 未证明所有 Skill 评估质量/停启/组织切换 |
| chat-path-d4-skill-three-states.spec.ts | 目录可见/正文送达/实际执行三个独立状态 | 需逐 Skill 应用，不能把 visible 或 delivered 等同 executed |
| skill-file-pin-live.spec.ts | 多文件保存/刷新与 Agent pin 恢复 | 仅 STUDIO_LANE=1；skip 无通过证据，未证明旧 pin 在新发布后仍执行旧正文 |
| chat-skill-picker-viewport.spec.ts | 首尾滚动、取消和多视口 | 拦截 /skills 数据，属于布局验证，不能算全量真实目录/运行验收 |

以上仅静态审查现有测试具备的能力，不表示本轮已运行这些 spec。根任务生产浏览器现有成功仅认其实际报告中的范围。全量缺项：每 Skill 参数控件与校验、后台停启及成员拒绝、真实依赖质量、失败重试副作用、每项产物查看/下载、全量搜索映射与刷新后服务端固定版本。

## 优先少量新增真实浏览器断言 proposal

1. 在现有七角色生产旅程中，等待真实 profile 后核对详情中文标题、available/pending 计数与 readiness 文案；pending>0 禁止出现“能力都已开通”，聊天与 workflow 入口仍可用。根已完成修复，复验需截真实 UI。
2. 复用同一生产栈加入一个真实已验证合成 Skill：后台停用→成员刷新搜索→禁用原因→服务端执行拒绝无新 run；重新启用后恢复。仅此项为生命周期技术验收，不替代其他业务 Skill。
3. 同一 Skill 发布 v2，而角色仍 pin v1：选择/挂载/运行事件/服务端快照全部为 v1，刷新保持；组织 B 搜索及详情访问均不能泄漏。保留全部精确集合断言。
4. 选择一个真实 schema 有必填字段且产生 artifact 的非销售 Skill：空输入阻断；合法输入送达真实 rawInput；产物打开/下载非空且内容符合合成输入；刷新后 run/effect/artifact 一致。模型缺凭据则质量项 BLOCKED，不用回环假通过。

不新建重型 server config。优先扩现有生产 E2E 与真实 PG/Redis 夹具；记录任何辅助注入、固定回复或缺依赖，运行与质量结果分列。最终每项 status 只允许有证据后改 PASS；未跑 NOT_RUN、依赖缺失 BLOCKED、发现缺陷 FAIL、明确授权延期 DEFERRED。
