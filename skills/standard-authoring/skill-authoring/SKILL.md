---
name: skill-authoring
description: 将用户反复执行的工作流程整理成有明确触发条件、完整资源和正反例的技能草稿包，并交付管理员导入；草稿不自动发布。
metadata:
  capability_id: WX-S015
  version: 1.0.0
---

# 技能草稿制作

先用一个真实成功例子和一个不该触发的反例确认范围。保留用户的目标和权限边界，描述清楚何时应加载技能；避免把某次错误变成所有任务的禁令。只写能改变决策的知识，不重复模型已经知道的泛泛步骤。

按照渐进披露组织完整目录：`SKILL.md` 包含 name、description 和必要流程；较长指南放 `references/`，稳定且需要重复执行的操作才写 `scripts/`，输出模板放 `assets/`。每个引用都必须有真实文件，不生成无用途占位文档。所有工作文件写在 `/workspace`；原上传文件先复制，不能修改 `/inputs`。

制作步骤及反证清单见 `references/verification.md`。先实际运行有风险的脚本样例或验证产物格式，再记录执行命令和结果。脚本不能靠技能文字新增工具权限、获取密钥或安装运行时依赖。缺少依赖时说明失败，不编造通过。不要把静态包校验称为技能已通过真实模型测试。

使用 `wx_skill_create_draft`：提供 stableName、显示名、description、semanticVersion、每个实际workspacePath到packagePath的映射、inputSchema、outputSchema和运行时依赖声明。Python/Node脚本必须声明对应运行时和所需包；工具不会替你安装或完整证明所有动态依赖。只有完整UTF-8文本资源在此增量中受支持，二进制模板明确拒绝。

工具返回 `artifact_draft` 和workspacePath后，用 `read_file` 核对包内容，保留packDigest、fileDigest、validationReport。这个结果没有skillId，也没有自动启用任何技能。同一次工具调用重放要求全部文件和元数据相同；变更需作为新调用，不覆盖旧草稿。

需要交付时调用 `wx_artifact_publish`，使用返回的JSON文件路径和 `application/json`，等待既有正式交付回执。只有当前有权查看这个产物版本的组织管理员，才能从该artifactId/version和fileDigest进入已有管理员导入器。普通用户不能借工具调用 `/skills`，该POST入口仍为410；也不能通过写平台文件或伪造角色发布。

交付时区分：包完整性已验证、脚本测试证据、尚未验证的依赖、管理员尚未导入。导入是显式管理员动作，不能替用户声称已发布或完成审批。完整运行时边界和上游来源见 `references/runtime.md`。
