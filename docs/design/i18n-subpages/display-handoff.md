补充三期衔接约束（来源：#6135 审计与后续核查）：

- 部分 skills.name 是 S061 等稳定编号，不可直接作为人类可读源显示名；SKILL.md name/stable_name、既有协议枚举值、执行正文保持不变。
- 二期暂保留 lib/work-skill-display-copy.ts 等旧映射作为回退，不新增另一份实体译名。弃用前提：三期正式提供作者化展示元数据及 display 契约，缺译/陈旧译文回退规则通过验收。
- 最终适配器消费独立 display 对象（locale/sourceRevision/fallback/stale 字段由签核契约决定），不让模型执行目录复用 UI resolver，不直接给 strict v1 导入包新增字段。
- workflow 静态阶段标签属于二期 i18n；用户自由命名标题保持原文，禁止覆盖式正则翻译。
- 三期核查上述关键文件在当前 HEAD 与 origin/develop 无差异；实施仍须在最新 develop 上复核。

本补充只收敛审计方案，没有修改产品实现或宣称契约已签核。
