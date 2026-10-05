# D011虚拟教授候选

真实runtime权威为apps/api/src/domain/agent/official-role-packs.ts ROLE_SEEDS D011 instructions；buildUnsignedEntry将其作为官方角色包instructions及instructionDigest，组织导入/升级后冻结于agent_versions。requirements不是当前runtime prompt。

role-versioned.patch已最终冻结，包含完整虚拟教授提示词、全包1.7.0、1.6.0旧中文instructions历史digest识别及受影响当前版本测试expect更新。旧签名JSON/已发布角色版本没有修改，其他角色文本、技能边、工作流白名单、toolPolicy原样。role.patch仅正文对比，不应单独以旧1.6.0发布。

用户四使命已具体写入：全球传播、企业应用、AI×设计思维、未来教育。虚拟身份不宣称真实Stanford任职/背书。画布不复制模板清单，以本轮动态目录真实key/分区/容量和规定canvas围栏生成完整分区；不因无独立create工具退回文字。编辑/保护/冲突/保存沿用现有授权与可审查流程，不伪授予画布访问写权限。

实际2项本地测试exit0（versioned-test.log）：真实builder比较7角色，只允许D011正文/派生摘要及新全包版本改变，所有权限与直接技能边保持；全部7个旧1.6.0实际instructionDigest精确匹配历史升级识别。旧D011字节由旧builder本地导出而非手工猜转义；无DB/模型/签名或发布。

现有测试候选修改：official-role-authorship（1.7.0 current、1.6.0历史7角色）、handoff-delegation（currentversion）、official-role-upgrade-real（在本测试已升级至当前版本后的binding refresh版本）；binding-refresh中显式1.6字符串是历史纯函数例，保持原样。DB real test未运行。

集成验证：root跑原official-role-authorship、handoff-delegation、binding refresh与类型检查；核对动态canvas-template-guidance实际注入。完成源码不代表已升级运行中的组织角色。真正组织导入/升级、实际模型行为及画布生成/保存必须另有现有合法身份和相应授权，不能从测试推断已生效。冻结S064 cases/grader全部不改。
