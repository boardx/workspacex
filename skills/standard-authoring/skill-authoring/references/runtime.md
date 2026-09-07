# 来源与部署边界

适配自 OpenAI skill-creator，固定提交 `4ab6e0fd99c6667163bc34173e3ed3a3fed75ebc`：
https://github.com/openai/skills/blob/4ab6e0fd99c6667163bc34173e3ed3a3fed75ebc/skills/.system/skill-creator/SKILL.md
上游该技能 LICENSE.txt 为 Apache-2.0，随包保留。修改：用WorkspaceX现有完整包、沙箱、产物与管理员治理替换Codex本机初始化/安装步骤，保留具体例子、渐进披露、实际脚本验证与迭代原则。

草稿格式为现有 SkillStarterPack schemaVersion 1，包含完整files/contentBase64/digest；不创建第二Skill registry。当前只接受UTF-8资源和既有沙箱大小上限。验证报告把未执行的依赖/fixture验证明确列出；不声称有通用动态依赖扫描器。

管理员导入从agent artifact的当前可见固定版本读取实际JSON bytes及hash，并调用已有importSkillStarterPack。组织admin检查、幂等、名称冲突和原Skill表为原有机制。生成者不能借草稿写平台技能。
