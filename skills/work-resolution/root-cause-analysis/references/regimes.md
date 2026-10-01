# 法规出处与复核记录（§11）

封顶开关本身在输入 `regimeFlags` 与判定表；本文件只记出处与复核状态。**标 UNVERIFIED 的条目在实现接线前必须逐条复核**，复核后把状态改为已核并写明日期与来源。

| 场景 | 出处 | 对输出的影响 | 状态 |
|---|---|---|---|
| CN 生产安全事故 | 《生产安全事故报告和调查处理条例》（国务院令第 493 号）；「四不放过」 | `jurisdiction=CN` 且 `casualtyOrStatutoryGrade` ⇒ status 最高 provisional，`openQuestions` 写「以官方事故调查报告为准」 | 条例名称与文号取自实体文档；未复核 |
| US 严重伤害报告 | OSHA 29 CFR 1904.39（时限） | 仅提示，不做法律责任认定 | UNVERIFIED（时限需复核） |
| US 上市公司网络安全事件披露 | SEC Form 8-K Item 1.05 | 受众 regulator/customer 的输出须经人类门放行，`openQuestions` 写「是否需在法律顾问指导下定稿」 | UNVERIFIED（规则现状需复核） |
| CN 网络安全事件报告 | 《网络安全法》及网信部门关于事件报告的规定 | 事件初报先于根因结论，不把本 Skill 当作初报前置条件 | UNVERIFIED（具体办法名称与生效日期） |
| 医疗器械 CAPA | US 21 CFR 820（QMSR 转向生效状态）；CN NMPA《医疗器械生产质量管理规范》 | `medicalDeviceCapa` 且根因候选 `verificationSignal=null` ⇒ 封顶 provisional | UNVERIFIED（QMSR 生效状态） |
