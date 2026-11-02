# 人类业务决定记录

2026-11-02，本会话用户明确选择“继续原计划发放至已付期结束（推荐）”，对应问题 call_bd1b02c8ed0c4927b6aa414932208831：Team年付剩9个月时升级Enterprise后的已付额度处理。

该选择已回填domain.md“Enterprise的单源和升级”，并同步用例、反例矩阵、API说明及升级确认文案。可执行闭集为EnterprisePrepaidTeamPolicy；调用方不能通过升级body选择停止或更改期限。既有基础及已购增员计划保留，停止未来Team续费，Enterprise额外额度仍由管理员手动添加。

这是上述业务问题的明确答复，不是整份Team契约束的正式签核；design-signoff.md保持pending，平台摘要/操作/错误定义及正式一致性复核仍待完成。当前不执行生产清理、epoch激活或部署。

## 完整束人工签核

用户在本会话对“PR6101及design-signoff.md完整UI／用例／API，含七人初购、增员折算、升级状态恢复和保留已付发放”明确回复：**确认整束设计，授权回填并分阶段实现**。记录时刻2026-11-02T03:30:01Z。据本次直接授权回填唯一design-signoff.md的confirmed字段；不把此前单项业务答复当本次授权。运行时切片仍须独立issue/PR/真实验证，既有正常develop集成授权及检查门禁继续适用，不扩大为生产部署/reset/epoch权限。
